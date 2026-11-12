import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { describeErrorForLog, requestLoggerMiddleware } from './middleware/requestLogger.js';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { actionsRouter } from './routes/actions.routes.js';
import { accessRouter } from './routes/access.routes.js';
import { profileRouter } from './routes/profile.routes.js';
import { availabilityRouter } from './routes/availability.routes.js';
import { presenceRouter } from './routes/presence.routes.js';
import { chatRouter } from './routes/chat.routes.js';
import { teamChatRouter } from './routes/teamChat.routes.js';
import { directMessageRouter } from './routes/directMessage.routes.js';
import { notificationsRouter } from './routes/notifications.routes.js';
import { teamRouter } from './routes/team.routes.js';
import { invitationsRouter } from './routes/invitations.routes.js';
import { applicationsRouter } from './routes/applications.routes.js';
import { scoringRouter } from './routes/scoring.routes.js';
import { teamRecommendationsRouter } from './routes/teamRecommendations.routes.js';
import { moderationRouter } from './routes/moderation.routes.js';
import { reportsRouter } from './routes/reports.routes.js';
import { accountsRouter } from './routes/accounts.routes.js';
import { auditRecordsRouter } from './routes/auditRecords.routes.js';
import { securityConfig } from './config/security.js';
import { createRequireHttps } from './middleware/requireHttps.js';

export const app: Express = express();

app.set('trust proxy', securityConfig.trustProxy);

// Security and utility headers (helmet sends HSTS so browsers stay on HTTPS)
app.use(helmet());
app.use(createRequireHttps(securityConfig.enforceHttps));
app.use(
  cors({
    origin: config.clientUrl,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-CSRF-Token'],
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
app.use('/api/access', accessRouter);
app.use('/api/profiles', profileRouter);
app.use('/api/availability', availabilityRouter);
app.use('/api/presence', presenceRouter);
app.use('/api/chat', chatRouter);
app.use('/api/direct-messages', directMessageRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/teams/:teamId/chat', teamChatRouter);
app.use('/api/teams', teamRouter);
app.use('/api/invitations', invitationsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/scoring', scoringRouter);
app.use('/api/recommendations', teamRecommendationsRouter);
app.use('/api/admin/moderation', moderationRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/admin/accounts', accountsRouter);
app.use('/api/admin/audit-records', auditRecordsRouter);
app.use('/api', actionsRouter);

// Fallback 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not Found' });
});

// Centralized error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  // #270: never print the raw error object — body-parser errors carry the request body.
  const safeError = describeErrorForLog(err);
  console.error('[SERVER ERROR]', JSON.stringify({ requestId: req.id || 'unknown', ...safeError }));
  const errWithStatus = err as Error & { status?: number; statusCode?: number };
  const status = errWithStatus.status || errWithStatus.statusCode || 500;
  const isDev = config.nodeEnv === 'development';
  const defaultError = status === 400 ? 'Bad Request' : 'Internal Server Error';

  res.status(status).json({
    error: defaultError,
    ...(isDev ? { message: safeError.message, stack: safeError.stack } : {}),
  });
});
