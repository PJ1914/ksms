# Technology Stack

Status: confirmed as specified; exact versions pinned in Phase 3 after checking npm at that time (not guessed here).

## Mobile

React Native + Expo (development builds, not Expo Go, because camera/notifications/native modules) · TypeScript strict · Expo Router · Zustand · TanStack Query · React Hook Form + Zod · NativeWind (chosen styling system, see TD-06) · Expo SQLite + Drizzle ORM · Expo SecureStore · Expo Camera · Expo Notifications · EAS Build.

## Backend

Node.js (LTS) · NestJS · TypeScript strict · REST · Prisma · Swagger/OpenAPI · class-validator (chosen, see TD-04) · decimal.js · pino structured logging · @nestjs/throttler · Jest + Supertest.

## Data

PostgreSQL on Neon · Prisma migrations · UUID PKs · NUMERIC money/quantities · UTC.

## Infrastructure

Google Cloud Run (asia-south1) · Neon · Cloudflare R2 (S3-compatible API) · Firebase Cloud Messaging · GitHub Actions · Expo EAS · Docker for local Postgres and API container image.

## Tooling

pnpm workspaces monorepo · ESLint · Prettier · Husky/lint-staged (optional) · Conventional Commits.

## Dev environment status (2026-11-17)

| Tool                     | Status                                | Action                                                                         |
| ------------------------ | ------------------------------------- | ------------------------------------------------------------------------------ |
| Node                     | v24.18.0 present — kept (TD-09)       | None; pin 24 in Phase 3                                                        |
| npm                      | 10.9.0                                | —                                                                              |
| pnpm                     | 12.21.0 installed globally 2026-11-17 | None                                                                           |
| git                      | 2.44                                  | `git init` in Phase 3                                                          |
| Java                     | OpenJDK 21                            | Check compatibility with the Android Gradle plugin used by the chosen Expo SDK |
| Docker                   | missing                               | Not needed; Neon dev branch used (TD-10)                                       |
| Android SDK/adb/emulator | missing, intentionally not installed  | Use Expo Go + physical phones, EAS cloud builds (TD-19)                        |
| EAS CLI                  | missing                               | Install in Phase 3; requires an Expo account                                   |
| psql                     | missing                               | Optional; Prisma Studio suffices                                               |

## Accounts / external prerequisites (owner to provide before the listed phase)

Expo account ✅ have · GitHub account ✅ have (repo to create in 3) · Neon account ✅ have (project/dev branch in 3) · Google Cloud project with billing (17) · Cloudflare account + R2 (17) · Firebase project (15/17) · Google Play developer account only if Play distribution is wanted (17).
