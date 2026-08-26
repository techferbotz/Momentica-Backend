# Momentica Backend

API for Momentica — people create a personalized, interactive page for a moment (a first birthday, a wedding invitation, a proposal) and share it as a link that stays live for as long as they paid for.

This service is **API-only**. The templates themselves are pages in a separate web app at `momentica.ferbotz.com`; this backend serves the catalogue, stores the personalization data, and decides what a given link is allowed to show.

## The flow it serves

```
feed → template detail → [Preview]        → renders the template's sample data
                       → [Use template]   → generated input form
                                          → preview with the user's own data
                                          → sign in → pay → shareable link
```

Creation is anonymous. A device gets a **draft session token** on first use and owns everything it makes; sign-in is required only at publish, and the session's drafts are adopted onto the account at that moment. This is deliberate — asking for an account before someone has seen their own page is where these products lose people.

## Running it

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL, JWT_SECRET, GOOGLE_CLIENT_ID, PUBLIC_WEB_ORIGIN
docker compose up -d          # Postgres 16 on 127.0.0.1:55432
npx prisma migrate deploy
npm run dev
```

Port 55432 rather than 5432 because a locally installed Postgres commonly owns the default.

| Script | What it does |
| --- | --- |
| `npm run dev` | ts-node-dev with hot reload |
| `npm run build` | `prisma generate` then `tsc` into `dist/` |
| `npm start` | runs `dist/app.js` |
| `npm run typecheck` | `tsc --noEmit` — the primary safety net |
| `npm run check:all` | every pure fixture suite (no database needed) |
| `npm run smoke` | end-to-end journey against a running dev stack |

### Verification

There is no test framework. Correctness is held by `tsc --noEmit` plus fixture scripts under `src/scripts/`:

- `check:errors` — every failure goes through one handler and one envelope
- `check:registry` — every template's sample data satisfies its own field contract
- `check:validate` — accept/reject cases for each placeholder field type
- `check:sharecode` — share codes are the right shape and uniformly distributed
- `check:pricing` — every store product maps to exactly one tier and duration

`npm run smoke` needs Postgres and a running server; it walks draft session → create → preview → sign in → claim → refresh rotation → stats → delete, and reports steps skipped because a feature group is unconfigured.

## Response shape

Success is always `{ "success": true, "data": ... }`. Failure is always `{ "success": false, "message": "...", "code": "..." }`, produced by a single error handler. Nothing builds an error response by hand.

Ownership is scoped to the calling principal on every query, and a row belonging to somebody else is reported as **404, never 403** — whether a particular creation exists is not something the API will confirm.

## API

Base path `/api/v1`. Ops endpoints (`/health`, `/health/db`) sit at the root.

### Identity

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/draft-sessions` | none | Issues the anonymous device token, sent afterwards as `X-Draft-Token` |
| POST | `/auth/google` | none | `{ idToken, draftToken? }` — passing `draftToken` signs in and adopts the device's drafts in one call |
| POST | `/auth/refresh` | none | `{ refreshToken }`, rotating |
| POST | `/auth/logout` | none | `{ refreshToken }` |
| POST | `/auth/claim-drafts` | user | `{ draftToken }` |
| GET / DELETE | `/me` | user | Profile; delete soft-deletes and revokes tokens |

### Catalogue (public, cacheable)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/feed` | Live categories, each with its templates |
| GET | `/categories` | |
| GET | `/categories/:id/templates` | `?cursor=&limit=` |
| GET | `/templates/:id` | Description, media, **`fields`** (drives the input form), pricing bundles, `previewCode` |

### Creations (device or user)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/creations` | `{ templateId, data }` |
| GET | `/creations` | `?cursor=&limit=` |
| GET / PUT / DELETE | `/creations/:id` | PUT accepts only `templateId`, `data`, `coverImageId` |
| POST | `/creations/:id/preview-token` | Short-lived `d_…` code for the pre-payment preview |
| GET | `/creations/:id/pricing` | Bundles for this template's tier |
| GET | `/creations/:id/stats` | Total views plus a 30-day daily series |
| GET | `/creations/:id/rsvps` | Paginated, with a yes/no/maybe summary |

### Media (device or user; 503 when S3 is unconfigured)

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/images` | multipart, single `file` field, ≤ 8 MB → WebP full + thumb |
| DELETE | `/images/:id` | |

### Publish and billing

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/creations/:id/publish` | user | `{ storeTransactionId }`, verified against RevenueCat; idempotent |
| POST | `/creations/:id/renew` | user | Extends the same link, so shared URLs keep working |
| GET | `/creations/:id/entitlements` | device or user | |
| GET | `/me/purchases` | user | |
| POST | `/webhooks/revenuecat` | secret | Refunds and chargebacks expire the link |

### Public render

One endpoint serves every rendered page, so the web app has a single fetch path. The code's shape decides what it gets:

| Code | Means | Source |
| --- | --- | --- |
| `pv_<templateId>` | Feed preview | Registry sample data |
| `d_<token>` | The creator's own unpaid draft | Signed, ~30 min |
| 8 base62 chars | A published, paid link | Database |

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/public/render/:code` | Returns `{ templateId, values, meta, og, features }` |
| POST | `/public/render/:code/view` | Separate from the GET so crawlers don't inflate counts |
| POST | `/public/render/:code/rsvp` | Only when the template supports it |

`meta.mode` is `preview`, `draft`, `published`, or **`expired`**. An expired link returns 200 with `values: null` and the link-preview copy intact, so the renderer can show a branded "this experience has ended" page with a renew prompt rather than a dead 404.

## Adding a template

1. Build the page in the web app at `/templates/{id}`.
2. Add a `TemplateDef` to `src/templates/registry.ts` with `live: false`.
3. Deploy the web app, then flip `live: true` and deploy this service.

That order matters: the feed must never advertise a template whose page does not exist yet.

A template declares its own inputs, and the mobile app builds the form from that declaration — so a new template needs no app release. Field types are `text`, `longText`, `number`, `date`, `dateTime`, `image`, `imageList`, `choice`, `boolean`, `color`, `location`, and `groupList` (a repeating group of scalars, one level deep — this is what a memory timeline is made of).

`npm run check:registry` will refuse a template whose sample data does not satisfy its own contract, whose category or tier does not exist, or whose link-preview copy references a field it does not have.

## Layout

```
src/
  app.ts             bootstrap: trust proxy, CORS, body limit, routes, error handler
  config/            env.ts is the ONLY reader of process.env; constants; pricing grid
  errors/            AppError subclasses and machine-readable codes
  middleware/        auth + principal, rate limiting, upload, error handler, logging
  routes/            thin route tables
  controllers/       parse input → call a service → respond
  services/          business rules
  repositories/      all Prisma access, scoped by principal
  templates/         registry, field-contract types, validator
  auth/  storage/  media/  billing/    one file per external SDK
  scripts/           check:* fixtures, smoke test, maintenance jobs
```

Each external dependency sits behind exactly one file: `auth/googleAuth.ts` (google-auth-library), `auth/jwt.ts` (jsonwebtoken), `storage/s3Storage.ts` (AWS SDK), `media/imageCompressor.ts` (sharp), `middleware/upload.ts` (multer), `billing/revenueCat.ts` (RevenueCat REST), `repositories/prisma.ts` (Prisma). Swapping any of them is a one-file change.

## Configuration

`src/config/env.ts` validates everything at startup and refuses to boot on a bad configuration. Feature groups are all-or-nothing: set every key or none. A group that is absent leaves the app running and makes only its own endpoints answer 503; a group that is *half* set is treated as a mistake and stops the process.

Required: `DATABASE_URL`, `JWT_SECRET` (≥ 32 chars), `GOOGLE_CLIENT_ID`, `PUBLIC_WEB_ORIGIN`.
Optional groups: AWS S3 (5 keys), RevenueCat (3 keys), `ANTHROPIC_API_KEY`.

`TEST_LOGIN_SECRET` enables a development sign-in that mints tokens without Google. The process **refuses to start** if it is set while `NODE_ENV=production`, so a copied `.env` cannot quietly re-enable it.

## Deployment

See [DEPLOY.md](DEPLOY.md).
