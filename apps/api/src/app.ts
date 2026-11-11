import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import type { Db } from './db/client.js';
import type { Config } from './config.js';
import { TokenService } from './auth/tokens.js';
import { resolveAuth } from './auth/context.js';
import { HttpError } from './lib/errors.js';
import { EngineError } from './domain/subscription-engine.js';
import authRoutes from './routes/auth.js';
import platformRoutes from './routes/platform.js';
import clubRoutes from './routes/club.js';
import branchRoutes from './routes/branches.js';
import sportRoutes from './routes/sports.js';
import staffRoutes from './routes/staff.js';
import coachRoutes from './routes/coaches.js';
import groupRoutes from './routes/groups.js';
import athleteRoutes from './routes/athletes.js';
import planRoutes from './routes/plans.js';
import subscriptionRoutes from './routes/subscriptions.js';
import paymentRoutes from './routes/payments.js';
import chargeRoutes from './routes/charges.js';
import cashRoutes from './routes/cash.js';
import sessionRoutes from './routes/sessions.js';
import expenseRoutes from './routes/expenses.js';
import payrollRoutes from './routes/payroll.js';
import reportRoutes from './routes/reports.js';
import notificationRoutes from './routes/notifications.js';
import importRoutes from './routes/import.js';
import documentRoutes from './routes/documents.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    tokens: TokenService;
  }
}

export interface BuildOptions {
  db: Db;
  config: Config;
  logger?: boolean;
}

export async function buildApp({ db, config, logger = false }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.trustProxy,
    logger: logger ? { redact: ['req.headers.authorization', '*.phone', '*.password'] } : false,
  });
  app.decorate('db', db);
  app.decorate('tokens', new TokenService(config.jwtSecret, config.jwtTtl));
  await app.register(cors, { origin: config.corsOrigin.split(',') });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation_error', message: 'Invalid input', details: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof EngineError) {
      return reply.status(422).send({ error: err.code, message: err.message });
    }
    const pgCode = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (pgCode === '23505') return reply.status(409).send({ error: 'duplicate', message: 'Record already exists' });
    if (pgCode === '23503') return reply.status(409).send({ error: 'reference_error', message: 'Referenced record missing or in use' });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.status(status).send({ error: 'bad_request', message: (err as Error).message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal_error', message: 'Internal server error' });
  });

  app.get('/health', async () => ({ ok: true }));

  await app.register(
    async (api) => {
      // Everything except /auth/login requires a valid token.
      api.addHook('preHandler', async (req) => {
        if (req.routeOptions.config && (req.routeOptions.config as { public?: boolean }).public) return;
        req.auth = await resolveAuth(req, db, app.tokens);
      });
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(platformRoutes, { prefix: '/platform' });
      await api.register(clubRoutes, { prefix: '/club' });
      await api.register(branchRoutes, { prefix: '/branches' });
      await api.register(sportRoutes, { prefix: '/sports' });
      await api.register(staffRoutes, { prefix: '/staff' });
      await api.register(coachRoutes, { prefix: '/coaches' });
      await api.register(groupRoutes, { prefix: '/groups' });
      await api.register(athleteRoutes, { prefix: '/athletes' });
      await api.register(documentRoutes, { prefix: '/athletes' });
      await api.register(planRoutes, { prefix: '/plans' });
      await api.register(subscriptionRoutes, { prefix: '/subscriptions' });
      await api.register(paymentRoutes, { prefix: '/payments' });
      await api.register(chargeRoutes, { prefix: '/charges' });
      await api.register(cashRoutes, { prefix: '/cash' });
      await api.register(sessionRoutes, { prefix: '/sessions' });
      await api.register(expenseRoutes, { prefix: '/expenses' });
      await api.register(payrollRoutes, { prefix: '/payroll' });
      await api.register(reportRoutes, { prefix: '/reports' });
      await api.register(notificationRoutes, { prefix: '/notifications' });
      await api.register(importRoutes, { prefix: '/import' });
    },
    { prefix: '/api' },
  );

  // Production: serve the built SPA from the same origin (no CORS, one container).
  if (config.webDist) {
    const fastifyStatic = (await import('@fastify/static')).default;
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'not_found', message: 'Route not found' });
    });
  }

  return app;
}
