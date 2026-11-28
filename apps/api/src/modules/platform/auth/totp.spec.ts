import { open, seal } from './secret-box';
import {
  base32Decode,
  base32Encode,
  matchingStep,
  newTotpSecret,
  otpauthUri,
  stepAt,
  totpAt,
} from './totp';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890", 8 digits.
  const rfcSecret = Buffer.from('12345678901234567890', 'ascii');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC test vector at T=%i', (seconds, expected) => {
    expect(totpAt(rfcSecret, stepAt(seconds * 1000), 8)).toBe(expected);
  });

  it('6-digit codes are the last 6 digits of the RFC values', () => {
    expect(totpAt(rfcSecret, stepAt(59_000))).toBe('287082');
  });

  it('base32 round-trips and matches the RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    const secret = newTotpSecret();
    expect(base32Decode(base32Encode(secret)).equals(secret)).toBe(true);
    expect(() => base32Decode('not*base32')).toThrow();
  });

  it('accepts the current step and one step either side, nothing further', () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    expect(matchingStep(secret, totpAt(secret, step), now)).toBe(step);
    expect(matchingStep(secret, totpAt(secret, step - 1), now)).toBe(step - 1);
    expect(matchingStep(secret, totpAt(secret, step + 1), now)).toBe(step + 1);
    const far = totpAt(secret, step - 3);
    if (![step - 1, step, step + 1].some((s) => totpAt(secret, s) === far)) {
      expect(matchingStep(secret, far, now)).toBeNull();
    }
  });

  it('rejects malformed codes', () => {
    const secret = newTotpSecret();
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 456']) {
      expect(matchingStep(secret, bad, Date.now())).toBeNull();
    }
  });

  it('builds an otpauth link authenticator apps understand', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'a@b.in', 'Yapaaram Admin');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Yapaaram%20Admin%3Aa%40b\.in\?/);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('issuer=Yapaaram+Admin');
  });
});

describe('secret box (AES-256-GCM)', () => {
  const key = Buffer.alloc(32, 9);

  it('round-trips and never stores the plaintext', () => {
    const sealed = seal(key, 'JBSWY3DPEHPK3PXP');
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(open(key, sealed)).toBe('JBSWY3DPEHPK3PXP');
    expect(seal(key, 'x')).not.toBe(seal(key, 'x')); // random IV
  });

  it('refuses a wrong key or a tampered value', () => {
    const sealed = seal(key, 'secret');
    expect(() => open(Buffer.alloc(32, 1), sealed)).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => open(key, parts.join('.'))).toThrow();
    expect(() => open(key, 'garbage')).toThrow();
  });
});
