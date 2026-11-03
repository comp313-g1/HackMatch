import { app } from './app.js';
import { config, validateEnv } from './config/index.js';
import {
  startNotificationRealtimeBridge,
  type NotificationRealtimeBridge,
} from './services/notificationRealtime.js';

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

// Graceful shutdown handling
function handleShutdown(signal: string) {
  console.log(`[SERVER] Received ${signal}. Closing HTTP server...`);
  void notificationBridge?.stop().catch(() => undefined);
  server.close(() => {
    console.log('[SERVER] HTTP server closed gracefully.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
