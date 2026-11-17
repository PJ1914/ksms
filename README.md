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
pnpm dev:mobile     # shows a QR code; scan it with Expo Go on your phone
```

For a phone to reach the API, set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your PC's LAN address (for example `http://192.168.1.10:3000/api/v1`); the phone and PC must be on the same Wi-Fi.

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

Phase 3 (monorepo and dev environment) complete. See `docs/IMPLEMENTATION_ROADMAP.md`.
