import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

// Argon2id, OWASP-recommended minimum profile (19 MiB, 2 iterations, 1 lane).
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, password);
    } catch {
      return false; // malformed hash: treat as mismatch
    }
  }

  /**
   * Verifies against the real hash, or against a dummy hash when the user does not exist, so the
   * response time does not reveal whether an account exists.
   */
  async verifyOrDummy(storedHash: string | null | undefined, password: string): Promise<boolean> {
    if (storedHash) return this.verify(storedHash, password);
    this.dummyHash ??= this.hash('dummy-password-for-timing-equalisation');
    await this.verify(await this.dummyHash, password);
    return false;
  }
}
