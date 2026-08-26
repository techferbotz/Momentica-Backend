# Momentica Backend

Backend for Momentica — a mobile-first app where users create personalized, interactive digital experiences (birthdays, invitations, proposals, greetings) and share them via `momentica.ferbotz.com/{shareCode}`. Templates render on the frontend; this backend stores personalization data, serves public creation reads, and handles media, auth, and paid publishing.

## House of Apps protocols

This project follows the shared HOA playbook in `G:\My Drive\HOA Protocols\`. Read
`README.md` there first; it indexes the rest. The ones that bind this repo:

- **00 — New project setup**: Drive folder, details doc, credentials registry, docs mirror, contract folder.
- **02 — Claude ↔ AWS access**: security-group edits, IAM changes and public-bucket policies are **human-run**, never agent-run. Prepare the exact command and hand it over.
- **03 — AWS infrastructure**: shared t3.micro, host Postgres (database + role per project), one `<project>-media` bucket, loopback-only container port, nginx vhost + certbot.
- **04 — Tech stack & conventions**: the stack below is that protocol. Deviate only with a written reason.
- **05 — Deployment runbook**: migrate **before** rebuilding the app, and always pass `--build` to the migrate service or it silently runs a stale image.

### Deviations from protocol 04, and why

- **No offline-first sync.** Creation is inherently online here (image upload, template fetch, payment), and a client-controlled `updatedAt` would break the sync watermark for no benefit. Protocol 04 scopes this to "where applicable".
- **No `decimal.js` / `money.ts`.** The app stores no computed money — Play and RevenueCat own every amount. `Purchase.priceMinorUnits` is a `BigInt` recorded for reference and serialized as a string.
- **One hostname, not one per service.** `momentica.ferbotz.com/api/*` is the API; `/` is reserved for the web renderer, which owns share links at `/{8-char code}`. Protocol 03's default is a whole subdomain per app.

## Language & Runtime

- TypeScript (strict; CommonJS; target ES2020; `src/` -> `dist/`)
- Node.js 22
- Build with plain `tsc` — no bundler, no framework CLI.
- Scripts: `dev` = ts-node-dev hot reload; `build` = tsc -> dist; `start` = node dist/app.js; `typecheck` = tsc --noEmit

## Web / API

- Express 5, cors, dotenv
- Response envelope ALWAYS: success `{ success: true, data }`; failure `{ success: false, message, code? }`.
- One central error-handler middleware produces every failure. Throw typed `AppError` subclasses (`BadRequest`/`Unauthorized`/`Forbidden`/`NotFound`/`Conflict`/`ServiceUnavailable`) — never `res.status().json()` an error by hand.

## Data

- PostgreSQL 16
- Prisma 6 — PIN to v6 (v7 removes `url = env("DATABASE_URL")` and requires a driver adapter).
- ALL Prisma calls live in repositories. No Prisma anywhere outside the repository layer.

## Auth

- Google Sign-In via google-auth-library: verify the idToken, `aud` must equal `GOOGLE_CLIENT_ID`. Never trust an unverified idToken.
- Short-lived access JWT (~15m) via jsonwebtoken.
- Refresh tokens: opaque 32 random bytes, stored ONLY as sha256 hash, rotating with theft detection. Never store a raw refresh token.

## Config

- Fail fast: one `config/env.ts` validates required env at startup and throws if missing. NOTHING else reads `process.env`.

## Architecture / Conventions

- Strict layering: route -> middleware -> controller -> service -> repository -> Prisma.
- Controllers thin (parse input, call a service, respond); services hold business rules; all DB access in repositories.
- Each external SDK sits behind exactly ONE file (isolated + swappable), e.g. `s3Storage.ts`, `imageCompressor.ts`, `googleVerifier.ts`.
- Ownership scoped by `userId` on every query; a foreign/missing row returns 404, never 403 (don't leak existence).
- Offline-first sync (if applicable): client-generated UUID ids, idempotent by `(userId, id)`, client-controlled `updatedAt` as the last-write-wins key, soft-delete tombstones (`deletedAt`).

## Verification (no test framework by default)

- Primary safety net: `tsc --noEmit` after every change.
- Correctness fixtures as small ts-node scripts under `src/scripts/` (`check:*`), runnable without a bundler or DB where possible.

## Infra / Deploy

- Docker multi-stage (builder + runner), node:22-slim base, non-root user.
- docker-compose: dev includes postgres:16; prod has NO Postgres (connect to host DB via `host.docker.internal`), publish only on loopback.
- Migrations are a DISCRETE step, never run on container start — a separate `migrate` service running `prisma migrate deploy`.
- EC2 + nginx (TLS termination) + certbot.

## Add-if-needed modules

### Media / Images

- AWS S3 via @aws-sdk/client-s3 (sole importer: `storage/s3Storage.ts`); return 503 when S3 env is unset so the rest of the app still works.
- sharp for processing -> WebP in two sizes (full <=1280px q75 + thumb <=512px q60).
- multer memory storage, single `"file"` field, size cap (e.g. 8 MB), images only.

### Money

- decimal.js, half-up rounding, NEVER floats. Store integer minor units in BigInt columns, serialize as strings.
- All arithmetic in one pure module (`money.ts`). Nothing else computes totals.

### HTML/CSS -> JSON compiler (only if a template pipeline is needed)

- parse5 (HTML) + postcss (CSS), with a hand-written cascade/inheritance/unit-normalization on top.
- Deterministic output (fixed key order, no clock/random) with a sha256 checksum; published versions immutable.

## Exact versions (current, ^caret)

Runtime deps: express ^5.2.1 | @prisma/client ^6.19.3 | google-auth-library ^10.5.0 | jsonwebtoken ^9.0.3 | @aws-sdk/client-s3 ^3.x | sharp ^0.35.1 | multer ^2.1.1 | decimal.js ^10.6.0 | parse5 ^8.0.0 | postcss ^8.5.6 | cors ^2.8.6 | dotenv ^17.4.2

Dev deps: typescript ^5.9.3 | prisma ^6.19.3 | ts-node ^10.9.2 | ts-node-dev ^2.0.0 | @types/node ^25 | @types/express ^5 | @types/jsonwebtoken ^9 | @types/multer ^2 | @types/cors ^2
