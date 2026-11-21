import { getSupabaseClient } from '../db/client.js';

/**
 * US-035 / #409 — private object storage for chat attachment bytes.
 *
 * Production uses a PRIVATE Supabase Storage bucket (`chat-attachments`, created
 * by migration 0068) through the server's service-role client; the browser never
 * talks to storage. Keys are opaque server-generated UUIDs. Errors are reported
 * as a generic AttachmentStorageError so no key, bucket detail, or provider
 * message reaches responses or logs.
 */

export const ATTACHMENT_BUCKET = 'chat-attachments';

export class AttachmentStorageError extends Error {
  constructor(readonly operation: 'put' | 'get' | 'remove') {
    super(`Attachment storage ${operation} failed.`);
    this.name = 'AttachmentStorageError';
  }
}

export interface AttachmentObjectStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  /** Removing a missing object is not an error. */
  remove(keys: string[]): Promise<void>;
}

export const supabaseAttachmentStore: AttachmentObjectStore = {
  async put(key, bytes, contentType) {
    const { error } = await getSupabaseClient()
      .storage.from(ATTACHMENT_BUCKET)
      .upload(key, bytes, { contentType, upsert: false, cacheControl: 'no-store' });
    if (error) throw new AttachmentStorageError('put');
  },
  async get(key) {
    const { data, error } = await getSupabaseClient().storage.from(ATTACHMENT_BUCKET).download(key);
    if (error || !data) throw new AttachmentStorageError('get');
    return new Uint8Array(await data.arrayBuffer());
  },
  async remove(keys) {
    if (keys.length === 0) return;
    const { error } = await getSupabaseClient().storage.from(ATTACHMENT_BUCKET).remove(keys);
    if (error) throw new AttachmentStorageError('remove');
  },
};

/** In-memory store for tests and local runs without Supabase Storage. */
export class MemoryAttachmentStore implements AttachmentObjectStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  failNext: Partial<Record<'put' | 'get' | 'remove', boolean>> = {};

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    if (this.failNext.put) {
      this.failNext.put = false;
      throw new AttachmentStorageError('put');
    }
    if (this.objects.has(key)) throw new AttachmentStorageError('put'); // never overwrite
    this.objects.set(key, { bytes: new Uint8Array(bytes), contentType });
  }

  async get(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (this.failNext.get || !object) {
      this.failNext.get = false;
      throw new AttachmentStorageError('get');
    }
    return object.bytes;
  }

  async remove(keys: string[]): Promise<void> {
    if (this.failNext.remove) {
      this.failNext.remove = false;
      throw new AttachmentStorageError('remove');
    }
    for (const key of keys) this.objects.delete(key);
  }
}

let activeStore: AttachmentObjectStore = supabaseAttachmentStore;

export function getAttachmentObjectStore(): AttachmentObjectStore {
  return activeStore;
}

/** Tests only: swap the storage backend. */
export function _setAttachmentObjectStore(store: AttachmentObjectStore | null): void {
  activeStore = store ?? supabaseAttachmentStore;
}
