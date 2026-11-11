# Deploying a staging / pilot server

One small VPS (2 vCPU, 2–4 GB RAM, Ubuntu 22.04+) runs the whole stack with Docker Compose:

| Service | What it does |
|---|---|
| `db` | PostgreSQL 16, data in the `pgdata` volume |
| `app` | API + web app in one container; applies migrations on start; runs the daily job and the Telegram bot |
| `caddy` | HTTPS with automatic Let's Encrypt certificates (PRD §12: TLS) |
| `backup` | `pg_dump` at start and every night at 02:30, keeps 14 days in `./backups` |

## 1. First install

```bash
# on the server
sudo apt install -y docker.io docker-compose-plugin git
git clone <repo> sport-erp && cd sport-erp
cp .env.production.example .env.production
nano .env.production            # DOMAIN, POSTGRES_PASSWORD, JWT_SECRET, TELEGRAM_BOT_TOKEN
```

Point the domain's DNS **A record** at the server IP, then:

```bash
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production logs -f app   # wait for "Server listening"
```

Open `https://<DOMAIN>`.

## 2. First club

There are no users yet. Create the platform superadmin once:

```bash
docker compose --env-file .env.production exec app node --input-type=module -e "
const { createDb } = await import('./apps/api/dist/db/client.js');
const { users } = await import('./apps/api/dist/db/schema.js');
const { hashPassword } = await import('./apps/api/dist/auth/password.js');
const h = await createDb(process.env.DATABASE_URL);
await h.db.insert(users).values({ email: 'admin@your-domain.uz', fullName: 'Platform Admin', isSuperadmin: true, passwordHash: await hashPassword('CHANGE-THIS-PASSWORD') });
await h.close(); console.log('superadmin created');
"
```

Log in as that user and create the pilot club under **Platforma → Klublar** (this also creates the owner login).
Then change the superadmin password under **Mening hisobim**.

> For a demo-only staging server you can load the demo data instead:
> `docker compose --env-file .env.production exec -e NODE_ENV=staging app node apps/api/dist/db/seed.js`
> (refused when `NODE_ENV=production`).

## 3. Telegram bot

1. In Telegram, open **@BotFather** → `/newbot` → copy the token.
2. Put it in `.env.production` as `TELEGRAM_BOT_TOKEN=…`, then `docker compose --env-file .env.production up -d`.
3. **Kommunikatsiya** page shows `@botname` once connected. Share `https://t.me/<botname>` with parents.

The bot uses long polling, so it needs no public webhook. Messages queued before the token was set are delivered
once the bot starts.

## 4. Backups and restore test

- Files: `./backups/sport_erp-YYYYMMDD-HHMM.dump`. **Copy them off the server** (e.g. nightly `rclone` to cloud storage).
  A backup that only exists on the same disk is not a backup.
- Restore test (do it after the first install, then monthly):

```bash
docker compose --env-file .env.production cp deploy/restore-test.sh backup:/restore-test.sh
docker compose --env-file .env.production exec backup sh /restore-test.sh    # → RESTORE TEST OK
```

- Real restore (disaster): stop `app`, then
  `docker compose exec backup pg_restore --clean --if-exists --no-owner -d sport_erp /backups/<file>.dump`, start `app`.

## 5. Updates

```bash
git pull
docker compose --env-file .env.production up -d --build   # migrations run automatically on start
```

## Not verified here

This setup was written without Docker on the development machine, so `docker compose up` has not been run end to end.
The production mode itself (`NODE_ENV=production`, API serving the built web app, migrations on start, the superadmin
command above) was tested locally with Node. Expect to fix small issues on the first real deploy.
