/**
 * US-035 / #409 — type detection from bytes, filename sanitization, extension
 * agreement (#404 policy, section 6).
 */
import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_ACCESS_TTL_MS,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_QUOTA_BYTES,
  ATTACHMENT_UPLOADS_PER_HOUR,
  ATTACHMENTS_PER_MESSAGE_MAX,
  detectAttachmentType,
  extensionMatchesType,
  sanitizeAttachmentDisplayName,
} from './chatAttachmentModel.js';

const bytes = (...parts: Array<number[] | string>): Uint8Array =>
  new Uint8Array(parts.flatMap((part) => (typeof part === 'string' ? [...Buffer.from(part, 'latin1')] : part)));

const SAMPLES = {
  png: bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], [0, 0, 0, 13]),
  jpeg: bytes([0xff, 0xd8, 0xff, 0xe0], 'JFIF'),
  gif87: bytes('GIF87a', [1, 0, 1, 0]),
  gif89: bytes('GIF89a', [1, 0, 1, 0]),
  webp: bytes('RIFF', [0x24, 0, 0, 0], 'WEBPVP8 '),
  pdf: bytes('%PDF-1.7\n%âãÏÓ\n'),
  text: new TextEncoder().encode('Meeting notes\r\n\t- ship it ✅\n'),
};

describe('approved limits match the #404 policy', () => {
  it('uses the exact approved numbers', () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(10_485_760);
    expect(ATTACHMENTS_PER_MESSAGE_MAX).toBe(5);
    expect(ATTACHMENT_UPLOADS_PER_HOUR).toBe(20);
    expect(ATTACHMENT_QUOTA_BYTES).toBe(104_857_600);
    expect(ATTACHMENT_ACCESS_TTL_MS).toBe(60_000);
  });
});

describe('detectAttachmentType (bytes only)', () => {
  it.each([
    ['PNG', SAMPLES.png, 'image/png'],
    ['JPEG', SAMPLES.jpeg, 'image/jpeg'],
    ['GIF87a', SAMPLES.gif87, 'image/gif'],
    ['GIF89a', SAMPLES.gif89, 'image/gif'],
    ['WebP', SAMPLES.webp, 'image/webp'],
    ['PDF', SAMPLES.pdf, 'application/pdf'],
    ['UTF-8 text', SAMPLES.text, 'text/plain'],
  ])('accepts %s by signature', (_label, sample, type) => {
    expect(detectAttachmentType(sample)).toBe(type);
  });

  it.each([
    ['Windows executable', bytes('MZ', [0x90, 0, 3, 0, 0, 0])],
    ['ELF executable', bytes([0x7f], 'ELF', [2, 1, 1, 0])],
    ['Mach-O', bytes([0xcf, 0xfa, 0xed, 0xfe, 7, 0, 0, 1])],
    ['ZIP / Office archive', bytes('PK', [3, 4, 20, 0, 0, 0])],
    ['RAR', bytes('Rar!', [0x1a, 7, 0])],
    ['7z', bytes('7z', [0xbc, 0xaf, 0x27, 0x1c])],
    ['gzip', bytes([0x1f, 0x8b, 8, 0])],
    ['MP3 frame', bytes([0xff, 0xfb, 0x90, 0x64, 0])],
    ['MP4 video', bytes([0, 0, 0, 0x18], 'ftypmp42', [0, 0, 0, 0])],
    ['WAV audio (RIFF but not WEBP)', bytes('RIFF', [0x24, 0, 0, 0], 'WAVEfmt ')],
    ['invalid UTF-8', bytes([0x48, 0x69, 0xc3, 0x28])],
    ['text with a NUL byte', bytes('hello', [0], 'world')],
    ['text with control characters', bytes('hello', [0x07, 0x1b], 'world')],
    ['empty file', new Uint8Array()],
  ])('rejects %s', (_label, sample) => {
    expect(detectAttachmentType(sample)).toBeNull();
  });

  it('treats script and markup source as plain text (download only), never as a script or image', () => {
    expect(detectAttachmentType(new TextEncoder().encode('#!/bin/sh\nrm -rf /\n'))).toBe('text/plain');
    expect(detectAttachmentType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('text/plain');
  });
});

describe('extensionMatchesType', () => {
  it('requires an extension accepted for the detected type', () => {
    expect(extensionMatchesType('photo.PNG', 'image/png')).toBe(true);
    expect(extensionMatchesType('photo.jpeg', 'image/jpeg')).toBe(true);
    expect(extensionMatchesType('photo.jpg', 'image/png')).toBe(false); // spoofed extension
    expect(extensionMatchesType('notes.txt', 'text/plain')).toBe(true);
    for (const name of ['run.sh', 'app.js', 'page.html', 'logo.svg', 'data.csv', 'invoice.pdf.exe', 'notes']) {
      expect(extensionMatchesType(name, 'text/plain'), name).toBe(false);
    }
  });
});

describe('sanitizeAttachmentDisplayName', () => {
  it('drops any path so a name can never point anywhere', () => {
    expect(sanitizeAttachmentDisplayName('../../etc/passwd.txt')).toBe('passwd.txt');
    expect(sanitizeAttachmentDisplayName('C:\\Users\\me\\Desktop\\plan.pdf')).toBe('plan.pdf');
    expect(sanitizeAttachmentDisplayName('/var/tmp/.hidden.png')).toBe('hidden.png');
  });

  it('removes control, bidirectional-override, and zero-width characters', () => {
    expect(sanitizeAttachmentDisplayName('invoice\u202Etxt.exe.png')).toBe('invoicetxt.exe.png');
    expect(sanitizeAttachmentDisplayName('re\u0000port\u0007\r\n.pdf')).toBe('report.pdf');
    expect(sanitizeAttachmentDisplayName('a\u200Bb\uFEFF.txt')).toBe('ab.txt');
  });

  it('caps the length at 255 while keeping the extension', () => {
    const name = sanitizeAttachmentDisplayName(`${'x'.repeat(400)}.jpeg`)!;
    expect(name).toHaveLength(255);
    expect(name.endsWith('.jpeg')).toBe(true);
  });

  it('returns null when nothing usable remains', () => {
    for (const raw of ['', '   ', '../', '\u202E', '...', null, 42]) {
      expect(sanitizeAttachmentDisplayName(raw)).toBeNull();
    }
  });
});
