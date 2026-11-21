import { app } from './app.js';
import { config, validateEnv } from './config/index.js';
import {
  startNotificationRealtimeBridge,
  type NotificationRealtimeBridge,
} from './services/notificationRealtime.js';
import { areAttachmentsUsable, runAttachmentMaintenance } from './services/chatAttachments.js';

// Validate environment variables strictly at process startup
validateEnv();

const server = app.listen(config.port, () => {
  console.log(`[SERVER] HackMatch API running on http://localhost:${config.port} (${config.nodeEnv})`);
});

// US-021 live notification delivery; failure must never stop the API from serving.
let notificationBridge: NotificationRealtimeBridge | null = null;
try {
  notificationBridge = startNotificationRealtimeBridge();
} catch (err) {
  console.warn('[SERVER] Notification Realtime bridge not started:', err);
}

// US-035 / #409: expire unsent uploads (24 h) and delete storage objects whose
// metadata is gone. Bounded work per run; uploads also trigger it opportunistically.
const ATTACHMENT_MAINTENANCE_MS = 15 * 60_000;
const attachmentMaintenance = setInterval(() => {
  if (areAttachmentsUsable()) void runAttachmentMaintenance().catch(() => undefined);
}, ATTACHMENT_MAINTENANCE_MS);
attachmentMaintenance.unref();

// Graceful shutdown handling
function handleShutdown(signal: string) {
  console.log(`[SERVER] Received ${signal}. Closing HTTP server...`);
  void notificationBridge?.stop().catch(() => undefined);
  clearInterval(attachmentMaintenance);
  server.close(() => {
    console.log('[SERVER] HTTP server closed gracefully.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
