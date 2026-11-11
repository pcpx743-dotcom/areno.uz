import { eq } from 'drizzle-orm';
import { createDb, runMigrations } from './client.js';
import { loadConfig } from '../config.js';
import { users } from './schema.js';
import { seedDemo, DEMO_USERS, DEMO_PASSWORD } from './seed-data.js';

const cfg = loadConfig();
if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}
const handle = await createDb(cfg.databaseUrl);
await runMigrations(handle);
const [existing] = await handle.db.select().from(users).where(eq(users.email, DEMO_USERS.owner));
if (existing) {
  console.log('Demo data already present — skipping.');
} else {
  const ids = await seedDemo(handle.db);
  console.log('Demo club seeded:', ids.clubId);
}
console.log('\nDemo logins (password: %s):', DEMO_PASSWORD);
for (const [k, v] of Object.entries(DEMO_USERS)) console.log(`  ${k.padEnd(16)} ${v}`);
await handle.close();
