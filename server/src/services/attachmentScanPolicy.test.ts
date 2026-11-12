import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config/index.js';
import { getRichChatCapabilities } from './chatCapabilities.js';
import {
  SCANNER_AVAILABLE,
  areAttachmentsUsable,
  initialScanStatus,
  isScanStatusDownloadable,
} from './attachmentScanPolicy.js';

describe('honest no-scanner attachment policy', () => {
  const originalNodeEnv = config.nodeEnv;
  const originalFlag = config.richChat.attachmentsEnabled;

  afterEach(() => {
    config.nodeEnv = originalNodeEnv;
    config.richChat.attachmentsEnabled = originalFlag;
  });

  it('defaults unavailable and never describes unscanned bytes as clean', () => {
    config.richChat.attachmentsEnabled = false;
    config.nodeEnv = 'test';
    expect(SCANNER_AVAILABLE).toBe(false);
    expect(areAttachmentsUsable()).toBe(false);
    expect(initialScanStatus()).toBe('not_scanned');
    expect(getRichChatCapabilities().attachments).toEqual({ enabled: false });
  });

  it('permits explicit local/test use with an honest not_available capability', () => {
    config.richChat.attachmentsEnabled = true;
    config.nodeEnv = 'test';
    expect(areAttachmentsUsable()).toBe(true);
    expect(isScanStatusDownloadable('not_scanned')).toBe(true);
    expect(isScanStatusDownloadable('clean')).toBe(false); // no scanner exists to produce this claim
    expect(isScanStatusDownloadable('pending')).toBe(false);
    expect(getRichChatCapabilities().attachments).toMatchObject({ enabled: true, malwareScanning: 'not_available' });
  });

  it('fails closed in production even if the feature flag is set', () => {
    config.richChat.attachmentsEnabled = true;
    config.nodeEnv = 'production';
    expect(areAttachmentsUsable()).toBe(false);
    expect(isScanStatusDownloadable('not_scanned')).toBe(false);
    expect(getRichChatCapabilities().attachments).toEqual({ enabled: false });
  });
});
