import { app } from './app.js';
import { config, validateEnv } from './config/index.js';

// Validate environment variables strictly at process startup
validateEnv();

const server = app.listen(config.port, () => {
  console.log(`[SERVER] HackMatch API running on http://localhost:${config.port} (${config.nodeEnv})`);
});

// Graceful shutdown handling
function handleShutdown(signal: string) {
  console.log(`[SERVER] Received ${signal}. Closing HTTP server...`);
  server.close(() => {
    console.log('[SERVER] HTTP server closed gracefully.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
