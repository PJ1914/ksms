# KSMS — Kirana Store Management System

Mobile-first (Android) store management for Indian kirana shops: inventory, POS billing, GST invoices, customer credit (Khata), suppliers, collections, cashbook and reports.

- `apps/api` — NestJS REST API (Prisma + PostgreSQL on Neon)
- `apps/mobile` — Expo / React Native app
- `packages/*` — shared constants, types, validation and API client
- `docs/` — requirements, architecture, database, decisions

## Requirements

- Node **24 LTS** (`.nvmrc`), pnpm **12** (`npm i -g pnpm`)
- A Neon PostgreSQL project (use a **dev** branch for development)
- An Android phone with **Expo Go** for day-to-day testing (no emulator needed)

## First-time setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env      # then fill in the two Neon URLs
cp apps/mobile/.env.example apps/mobile/.env
pnpm db:generate                            # generate the Prisma client
pnpm db:migrate:deploy                      # apply migrations to your dev database
```

`apps/api/.env` needs:

- `DATABASE_URL` — Neon **pooled** URL (host contains `-pooler`), used by the running API
- `DIRECT_URL` — Neon **direct** URL, used only for migrations

Tip: use `sslmode=verify-full` in both URLs (Neon certificates are publicly trusted). It avoids a `pg` deprecation warning about `sslmode=require`.

## Run

```bash
pnpm dev:api        # http://localhost:3000/api/v1/health  and /health/ready
pnpm dev:mobile     # shows a QR code; scan it with Expo Go on your phone (see docs/guides/PHONE_TESTING.md)
```

For a phone to reach the API, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your PC's LAN address (for example `http://192.168.1.10:3000/api/v1`); the phone and PC must be on the same Wi-Fi.

## Admin panel (platform) API

The admin panel API lives at `/admin/v1` (Swagger: `/admin/v1/docs`), separate from the shop API (ADR-001, `ADMIN_PANEL.md`).

- Set `PLATFORM_JWT_SECRET` (`openssl rand -base64 48`, different from `JWT_ACCESS_SECRET`) and `PLATFORM_MFA_KEY` (`openssl rand -base64 32`) in `apps/api/.env`. They are **required in production**. Without them in development, `/admin/v1` answers `503`.
- Create the first admin. This is the only way to create one; there is no sign-up and nothing is seeded:

  ```bash
  pnpm --filter @ksms/api build
  pnpm --filter @ksms/api admin:create -- --email you@example.com --name "Your Name"
  ```

  It prints a temporary password once. At first sign-in you set up Google Authenticator (or any TOTP app), save the 10 recovery codes offline, and choose a new password.

### Admin web app (`apps/admin`)

```bash
cp apps/admin/.env.example apps/admin/.env   # VITE_API_ORIGIN=http://localhost:3000
pnpm --filter @ksms/admin dev                # http://localhost:5174
```

Add `http://localhost:5174` to `PLATFORM_ADMIN_ORIGINS` in `apps/api/.env`. The panel has these screens: Dashboard, Shops (lock/unlock, record payment, change plan, adjust dates, refund, force logout, block device, reset owner password), Tickets, Plans, Payments (CSV), Support contact, Admins, Audit log. SUPPORT users see only what they may use; the API enforces every rule.

## Quality checks

```bash
pnpm check          # format, lint, typecheck, unit tests
pnpm --filter @ksms/api test:e2e
pnpm --filter @ksms/mobile export:check   # proves the Android bundle compiles
```

CI (`.github/workflows/ci.yml`) runs all of the above plus a clean-Postgres migration check.

## Security

Never commit `.env` files or credentials. See `AGENTS.md` for engineering rules.

## Status

Phases 0-9 complete (planning, architecture, database, monorepo, backend foundation, authentication and RBAC, product catalogue, inventory engine, procurement and suppliers, sales and POS engine). See `docs/IMPLEMENTATION_ROADMAP.md`.

## Tests in more detail

```bash
pnpm --filter @ksms/api test:int    # real-database concurrency tests (uses DATABASE_URL from apps/api/.env)
```

API docs while the API runs: http://localhost:3000/api/docs. See `docs/api/API_CONVENTIONS.md` and `docs/testing/TEST_STRATEGY.md`.
