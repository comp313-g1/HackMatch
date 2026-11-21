import { beforeEach, describe, expect, it } from 'vitest';
import { AttachmentStorageError, MemoryAttachmentStore } from './attachmentStorage.js';

describe('MemoryAttachmentStore contract', () => {
  let store: MemoryAttachmentStore;

  beforeEach(() => {
    store = new MemoryAttachmentStore();
  });

  it('stores private bytes under the supplied opaque key without returning a URL', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(store.put('0af8e661-04da-45d1-81ad-bbbaba2bc68d', bytes, 'image/png')).resolves.toBeUndefined();
    bytes[0] = 9;
    await expect(store.get('0af8e661-04da-45d1-81ad-bbbaba2bc68d')).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it('never overwrites an existing object and reports only a generic provider-safe error', async () => {
    await store.put('opaque', new Uint8Array([1]), 'image/png');
    await expect(store.put('opaque', new Uint8Array([2]), 'image/png')).rejects.toEqual(new AttachmentStorageError('put'));
    expect((await store.get('opaque'))[0]).toBe(1);
  });

  it('removes objects idempotently and exposes deterministic failure seams', async () => {
    await store.put('a', new Uint8Array([1]), 'text/plain');
    store.failNext.remove = true;
    await expect(store.remove(['a'])).rejects.toMatchObject({ operation: 'remove' });
    await expect(store.get('a')).resolves.toEqual(new Uint8Array([1]));
    await expect(store.remove(['a', 'missing'])).resolves.toBeUndefined();
    await expect(store.get('a')).rejects.toMatchObject({ operation: 'get' });
  });
});
