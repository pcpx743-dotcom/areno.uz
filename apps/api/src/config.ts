export interface Config {
  databaseUrl: string;
  jwtSecret: string;
  jwtTtl: string;
  port: number;
  corsOrigin: string;
  telegramBotToken: string | null;
  /** Serve the built web app from this folder (production, single container). */
  webDist: string | null;
  /** Behind a reverse proxy (nginx, ngrok): read the client IP from X-Forwarded-For. */
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const jwtSecret = env.JWT_SECRET ?? '';
  if (env.NODE_ENV === 'production' && jwtSecret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters in production');
  }
  return {
    databaseUrl: env.DATABASE_URL ?? 'pglite://./.data/pg',
    jwtSecret: jwtSecret || 'dev-only-secret-do-not-use-in-production',
    jwtTtl: env.JWT_TTL ?? '12h',
    port: Number(env.PORT ?? 4000),
    corsOrigin: env.CORS_ORIGIN ?? 'http://localhost:5173',
    telegramBotToken: env.TELEGRAM_BOT_TOKEN?.trim() || null,
    webDist: env.WEB_DIST?.trim() || null,
    trustProxy: env.TRUST_PROXY === 'true',
  };
}
