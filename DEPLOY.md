# Deploying Momentica

Target: a single EC2 instance running the API in Docker, Postgres 16 on the host, and nginx terminating TLS.

## 1. Host preparation

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-plugin nginx certbot python3-certbot-nginx postgresql-16
sudo usermod -aG docker "$USER"   # log out and back in
```

## 2. Database

Postgres runs on the host rather than in the compose stack, so a container rebuild can never take the data with it.

```bash
sudo -u postgres createuser --pwprompt momentica
sudo -u postgres createdb --owner=momentica momentica
```

Leave it listening on localhost only (the default). The API container reaches it through `host.docker.internal`, which `docker-compose.prod.yml` maps to the host gateway:

```
DATABASE_URL="postgresql://momentica:PASSWORD@host.docker.internal:5432/momentica?schema=public"
```

## 3. Configuration

Create `.env.production` next to the compose file. It is read by both the `api` and `migrate` services.

```bash
NODE_ENV=production
PORT=3000
DATABASE_URL="postgresql://momentica:PASSWORD@host.docker.internal:5432/momentica?schema=public"
JWT_SECRET="$(openssl rand -base64 48)"
GOOGLE_CLIENT_ID="....apps.googleusercontent.com"
PUBLIC_WEB_ORIGIN="https://momentica.ferbotz.com"

AWS_REGION=ap-south-1
AWS_S3_BUCKET=momentica-media
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_PUBLIC_BASE_URL=https://momentica-media.s3.ap-south-1.amazonaws.com

REVENUECAT_API_KEY=...
REVENUECAT_PROJECT_ID=...
REVENUECAT_WEBHOOK_SECRET="$(openssl rand -base64 32)"
```

Do **not** set `TEST_LOGIN_SECRET`. The process refuses to start in production if it is present.

Feature groups are all-or-nothing. Setting three of the five AWS keys stops the boot with a message naming the missing ones — that is intentional, because silently disabling image uploads on a production deploy is worse than not starting.

## 4. Migrations — a separate step, every time

Never on container start: two API containers coming up together would race, and a failed migration would take the service down with it.

```bash
# 1) migrate first, so the new columns exist before the app that expects them.
#    --build is not optional: without it the migrate service can run a stale
#    image and cheerfully report "No pending migrations" (HOA protocol 05).
docker compose -f docker-compose.prod.yml run --rm --build migrate
# 2) then rebuild and recreate the app, so its baked-in Prisma client matches.
docker compose -f docker-compose.prod.yml up -d --build app
```

Migrate **before** rebuilding the app, never after. Roll forward only — to undo,
write a new migration.


## Deploying from git (HOA protocol 05)

The box holds a git checkout at `/opt/apps/momentica/Momentica-Backend`, tracking
`master` on `git@github.com:techferbotz/Momentica-Backend.git`. The instance
authenticates to GitHub as `techferbotz` with a key already on it — the same way
AuraPix, Billanta and Curiously are checked out.

**Deploy, no schema change:**

```bash
ssh -i <box-key>.pem ubuntu@13.205.128.80
cd /opt/apps/momentica/Momentica-Backend
git pull
sudo docker compose -f docker-compose.prod.yml up -d --build app
curl -fsS https://momentica.ferbotz.com/api/health
```

**Deploy WITH a migration** — order matters, migrate first so the columns exist
before the app that expects them:

```bash
cd /opt/apps/momentica/Momentica-Backend
git pull
sudo docker compose -f docker-compose.prod.yml run --rm --build migrate
sudo docker compose -f docker-compose.prod.yml up -d --build app
```

`--build` on the migrate service is not optional. Without it Compose can run a
stale image and cheerfully report "No pending migrations".

**`.env` files never come from git.** `.env.production` (runtime config) and
`.env` (Compose's `HOST_PORT` substitution) live only on the box and are
gitignored. A fresh clone must have both restored before the app will start.

**Verify:**

```bash
git -C /opt/apps/momentica/Momentica-Backend rev-parse --short HEAD
sudo docker compose -f docker-compose.prod.yml ps app
sudo docker compose -f docker-compose.prod.yml logs --tail=100 app
```

## 5. nginx and TLS

```bash
sudo cp docker/nginx/momentica.conf /etc/nginx/sites-available/momentica
sudo ln -s /etc/nginx/sites-available/momentica /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d momentica.ferbotz.com
```

Certbot installs its own renewal timer; confirm with `systemctl list-timers | grep certbot`.

The `X-Forwarded-For` header in that config is load-bearing. The app sets `trust proxy`, and without the header every request looks like it came from loopback — all per-IP rate limits would collapse into a single shared bucket that throttles every recipient at once.

## 6. Scheduled jobs

```cron
# Photos uploaded but never attached to a creation (48h grace)
17 3 * * *  cd /srv/momentica && docker compose -f docker-compose.prod.yml run --rm api node dist/scripts/cleanup-orphan-images.js

# Anonymous draft sessions nobody ever claimed (7 days)
34 3 * * *  cd /srv/momentica && docker compose -f docker-compose.prod.yml run --rm api node dist/scripts/purge-abandoned-drafts.js

# Accounts past the 30-day deletion retention window
51 3 * * 0  cd /srv/momentica && docker compose -f docker-compose.prod.yml run --rm api node dist/scripts/purge-deleted-users.js
```

Nothing expires links on a schedule — expiry is derived from `expiresAt` at read time, so a missed cron run cannot accidentally keep a lapsed link alive or kill a live one.

## 7. S3 bucket

Objects must be readable without credentials: recipients are anonymous and the page loads images directly. Privacy comes from the key being unguessable (`img/{uuid}/full.webp`), not from access control, and keys carry no user or creation segment so two links cannot be tied back to the same author.

- Block public **ACLs**, allow public **read** via bucket policy on `img/*`
- CORS: allow `GET` from `https://momentica.ferbotz.com`
- Lifecycle: none — cleanup is handled by the cron jobs above

Putting CloudFront in front later is a drop-in change: point `S3_PUBLIC_BASE_URL` at the distribution.

## 8. RevenueCat

1. Create the products in Play Console. The grid is 3 tiers × 5 durations, named `publish_tier{A|B|C}_{1|3|7|30|90}d` — `npm run check:pricing` enumerates exactly what must exist.
2. Import them into RevenueCat and expose them as Offerings.
3. In the app, set the RevenueCat **app user id to this backend's user id** after sign-in. Purchase verification is scoped to that customer, and a mismatch means a user's own purchase will not verify.
4. Point the RevenueCat webhook at `https://momentica.ferbotz.com/api/v1/webhooks/revenuecat` and set its Authorization header to `REVENUECAT_WEBHOOK_SECRET`.

**Confirm before launch:** `src/billing/revenueCat.ts` reads the purchase fields (`store_purchase_identifier`, `product_id`, `id`, `purchased_at_ms`) from the documented v2 customer-purchases response. Make one real sandbox purchase and check the logs. If the shape has drifted, the module raises and logs the raw payload rather than granting anything — a mismatch shows up as publishes failing, never as free hosting.

## 9. After deploying

```bash
curl -fsS https://momentica.ferbotz.com/api/health
curl -fsS https://momentica.ferbotz.com/api/health/db
curl -fsS https://momentica.ferbotz.com/api/v1/feed | head -c 400
```

`/api/health/db` returns 503 if Postgres is unreachable, which makes it the right target for an uptime check.

## Rollback

Images are tagged `momentica-api:latest`; keep the previous one tagged before building so a rollback is `docker compose up -d` with the old tag. Since migrations run separately and roll forward only, a rollback of the app is safe as long as the previous version tolerates the newer schema — which is why additive migrations are strongly preferred.

---

## The live instance (as deployed 2026-08-26)

Momentica runs as the fourth app on a shared `t3.micro` in `ap-south-1`
(`i-0ee7ba0922056100d`, `13.205.128.80`) alongside AuraPix, Billanta and
Curiously. The house pattern there is: one Docker container per app publishing
to a loopback port, one nginx site per hostname, and a single host Postgres with
a database and role per app.

| | |
| --- | --- |
| App directory | `/opt/apps/momentica/Momentica-backend` |
| Container | `momentica-app`, host port `127.0.0.1:8092` |
| nginx site | `/etc/nginx/sites-available/momentica` → `momentica.ferbotz.com` |
| Public base | `https://momentica.ferbotz.com/api` |
| Database | `momentica` / role `momentica` on the host Postgres 18 |
| DB password | `~/.momentica-dbpass` on the instance (mode 600) |
| S3 bucket | `momentica-media` (`ap-south-1`) |
| S3 IAM user | `momentica-app`, inline policy `momentica-media-rw` |

Loopback ports already taken on that box: `8080` AuraPix, `8090` Curiously,
`8091` Billanta, `8092` Momentica.

### Two things that will bite you

**`.env` and `.env.production` are different files with different jobs.**
`docker-compose.prod.yml` reads `env_file: .env.production` for the container's
runtime configuration, but Compose's own `${HOST_PORT}` substitution does *not*
see `env_file` values — it reads `./.env`. So the published port lives in `.env`
and everything else lives in `.env.production`. Getting this wrong silently
publishes on the default port instead of failing.

**Postgres needs a per-app `pg_hba.conf` line.** Containers reach the host
database over the Docker bridge, so each app has its own entry:

```
host    momentica       momentica       172.16.0.0/12           scram-sha-256
```

Append it and `systemctl reload postgresql`. Without it the container gets a
connection refusal that looks like a credentials problem.

### Capacity

The box has 908 MB RAM and runs four apps plus Postgres and nginx; it sits
around 340 MB available with ~700 MB of swap in use. Before building an image
there, reclaim space first — `docker builder prune -af` recovered 6.5 GB and
took the disk from 89% to 63%. If a fifth app is ever added, move to a larger
instance rather than squeezing.

### Media storage as actually provisioned

Bucket `momentica-media` in `ap-south-1`, created 2026-08-26:

- **Public ACLs blocked**, but `BlockPublicPolicy` is off so the scoped policy
  can apply. Public `s3:GetObject` is granted **only** on `img/*` — nothing else
  in the bucket is world-readable, and there is no `ListBucket` for anyone.
- **CORS** allows `GET`/`HEAD` from `https://momentica.ferbotz.com`.
- The application authenticates as IAM user **`momentica-app`**, whose only
  permission is `PutObject`/`GetObject`/`DeleteObject` on
  `arn:aws:s3:::momentica-media/img/*`. It cannot list the bucket, touch other
  prefixes, or reach any other AWS service. Rotate its key with
  `aws iam create-access-key --user-name momentica-app` followed by deleting the
  old one.

Verified end to end on the live instance: upload → sharp → WebP → S3, both
variants publicly readable with the correct `image/webp` content type, and
delete working.

### One hostname, two halves

`momentica.ferbotz.com` serves both the API and (eventually) the renderer:

| Path | Served by |
| --- | --- |
| `/api/*` | this backend, proxied to `127.0.0.1:8092` |
| `/api/health`, `/api/health/db` | ops endpoints, rewritten to the app's `/health*` |
| `/*` | the web renderer — **not deployed yet**, currently returns 404 |

Share codes are always exactly 8 base62 characters, so they can never collide
with `/api`, `/health` or `/.well-known`. When the renderer ships, replace the
`location /` block; nothing under `/api/` needs to change.

TLS was issued by certbot on 2026-08-26 (expires 2026-11-24, auto-renewing) and
HTTP is redirected to HTTPS.

### Still outstanding on the live deployment

- **The web renderer does not exist**, so `/` and every share link return 404.
- **RevenueCat is unset**, so publish and renew answer 503 by design.
