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
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml run --rm migrate
docker compose -f docker-compose.prod.yml up -d api
```

Roll forward only. To undo, write a new migration.

## 5. nginx and TLS

```bash
sudo cp docker/nginx/momentica.conf /etc/nginx/sites-available/momentica
sudo ln -s /etc/nginx/sites-available/momentica /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.momentica.ferbotz.com
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
4. Point the RevenueCat webhook at `https://api.momentica.ferbotz.com/api/v1/webhooks/revenuecat` and set its Authorization header to `REVENUECAT_WEBHOOK_SECRET`.

**Confirm before launch:** `src/billing/revenueCat.ts` reads the purchase fields (`store_purchase_identifier`, `product_id`, `id`, `purchased_at_ms`) from the documented v2 customer-purchases response. Make one real sandbox purchase and check the logs. If the shape has drifted, the module raises and logs the raw payload rather than granting anything — a mismatch shows up as publishes failing, never as free hosting.

## 9. After deploying

```bash
curl -fsS https://api.momentica.ferbotz.com/health
curl -fsS https://api.momentica.ferbotz.com/health/db
curl -fsS https://api.momentica.ferbotz.com/api/v1/feed | head -c 400
```

`/health/db` returns 503 if Postgres is unreachable, which makes it the right target for an uptime check.

## Rollback

Images are tagged `momentica-api:latest`; keep the previous one tagged before building so a rollback is `docker compose up -d` with the old tag. Since migrations run separately and roll forward only, a rollback of the app is safe as long as the previous version tolerates the newer schema — which is why additive migrations are strongly preferred.
