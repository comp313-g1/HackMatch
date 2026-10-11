import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { requestLoggerMiddleware } from './middleware/requestLogger.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';

export const app: Express = express();

// Security and utility headers
app.use(helmet());
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  })
);

// Payload parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Request tracing and structured logging
app.use(requestIdMiddleware);
app.use(requestLoggerMiddleware);

// API Routes
app.use('/api', healthRouter);
app.use('/api/auth', authRouter);

// Fallback 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
});

// Centralized error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const errWithStatus = err as Error & { status?: number; statusCode?: number };
  const status = errWithStatus.status || errWithStatus.statusCode || 500;
  const isDev = config.nodeEnv === 'development';
  const defaultError = status === 400 ? 'Bad Request' : 'Internal Server Error';

  res.status(status).json({
    error: defaultError,
    ...(isDev ? { message: err.message } : {}),
  });
});
