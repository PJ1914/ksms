import { randomBytes } from 'node:crypto';
import { base32Encode } from './totp';

/** How many single-use recovery codes an admin gets when enrolling MFA (ADMIN_PANEL.md decision 9). */
export const RECOVERY_CODE_COUNT = 10;

/** `ABCDE-FGHIJ`: 50 random bits, easy to read out loud and write down. */
export function newRecoveryCode(): string {
  const raw = base32Encode(randomBytes(7)).slice(0, 10);
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

/** What is hashed: upper-case with spaces and dashes removed, so "abcde fghij" matches too. */
export function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

/** A temporary password shown once to the creator; the admin must replace it at first sign-in. */
export function newTemporaryPassword(): string {
  return `${randomBytes(12).toString('base64url')}-Tmp9`;
}

export const PLATFORM_PASSWORD_MIN_LENGTH = 12;
