import { createDb, runMigrations } from './client.js';
import { loadConfig } from '../config.js';

const cfg = loadConfig();
const handle = await createDb(cfg.databaseUrl);
await runMigrations(handle);
await handle.close();
console.log('Migrations applied.');
