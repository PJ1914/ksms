import 'reflect-metadata';
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { parseEnv } from './config/env';
import { DatabaseModule } from './database/database.module';
import { PasswordService } from './modules/identity/password.service';
import { PlatformAdminsService } from './modules/platform/admins/platform-admins.service';
import { PlatformAuditService } from './modules/platform/audit/platform-audit.service';
import { PlatformSessionService } from './modules/platform/auth/platform-session.service';

/**
 * Creates a platform ADMIN (ADMIN_PANEL.md §3.5). There is no public sign-up for admins and none is
 * ever seeded by a migration: this command is the only way in.
 *
 *   pnpm --filter @ksms/api build
 *   pnpm --filter @ksms/api admin:create -- --email you@example.com --name "Your Name"
 *
 * Prints a temporary password ONCE. At first sign-in the admin must change it and set up
 * Google Authenticator (or any TOTP app).
 */
@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [PasswordService, PlatformAuditService, PlatformSessionService, PlatformAdminsService],
})
class CreateAdminModule {}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  parseEnv(); // fail fast on bad configuration
  const email = arg('email')?.trim();
  const fullName = arg('name')?.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || fullName.length < 2) {
    console.error('Usage: admin:create -- --email you@example.com --name "Your Name"');
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(CreateAdminModule, {
    logger: ['warn', 'error'],
  });
  try {
    const { admin, temporaryPassword } = await app
      .get(PlatformAdminsService)
      .create(null, { email, fullName, role: 'ADMIN' }, { correlationId: 'cli:admin:create' });
    console.log(`Created ADMIN ${admin.email} (${admin.id}).`);
    console.log(
      `Temporary password (shown once, change it at first sign-in): ${temporaryPassword}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`admin:create failed: ${message}`);
  process.exit(1);
});
