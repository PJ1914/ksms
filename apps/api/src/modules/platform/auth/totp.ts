import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s): what Google Authenticator and
 * every other authenticator app use. Implemented on node:crypto instead of adding a dependency; checked
 * against the RFC 6238 test vectors in totp.spec.ts.
 */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Codes from one step before or after the current one are accepted (clock drift on the phone). */
export const TOTP_WINDOW = 1;
const SECRET_BYTES = 20; // 160 bits, the RFC 4226 recommendation

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newTotpSecret(): Buffer {
  return randomBytes(SECRET_BYTES);
}

export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for one time step. `digits` is only varied by the RFC test vectors. */
export function totpAt(secret: Buffer, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The time step whose code matches, within ±TOTP_WINDOW of now, or null. The caller must still refuse a
 * step that was already used (replay), see PlatformAuthService.
 */
export function matchingStep(secret: Buffer, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  const given = Buffer.from(code);
  let found: number | null = null;
  // Check every candidate (no early exit) so timing does not reveal which step matched.
  for (let s = now - TOTP_WINDOW; s <= now + TOTP_WINDOW; s++) {
    if (timingSafeEqual(Buffer.from(totpAt(secret, s)), given) && found === null) found = s;
  }
  return found;
}

/** The link an authenticator app reads from the QR code. */
export function otpauthUri(secretBase32: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
