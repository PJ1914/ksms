# Dependency audit allowlist

CI (`security` job in `.github/workflows/ci.yml`) runs `pnpm audit --prod --audit-level=high` and fails on any
high or critical advisory in production dependencies. An advisory that cannot be fixed yet may be accepted
**only** by adding its GHSA id to `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` AND a row here, with
the reason and a date to look at it again.

| GHSA     | Package | Severity | Why accepted | Review by |
| -------- | ------- | -------- | ------------ | --------- |
| _(none)_ |         |          |              |           |

Status on 2026-11-26: no high or critical advisories. One moderate (GHSA-g3hv-75wg-m249, `minimatch` via the
Expo toolchain, build-time only) is below the CI threshold and needs no entry.

## Secret scan

The same job runs gitleaks on the pushed commits. Values in tests, `*.example` files and CI workflow
throwaway credentials are placeholders; `.gitleaks.toml` allows those paths only.
