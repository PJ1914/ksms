import { randomBytes } from 'node:crypto';

let lastMs = 0;
let sequence = 0;

/**
 * A UUID version 7 (RFC 9562): the first 48 bits are the time in milliseconds, then a counter, then random bits.
 * IDs made later always sort after earlier ones (also within the same millisecond, in this process), so rows such
 * as bill lines keep the order they were entered when sorted by id. Used where the id is needed before the insert
 * (e.g. stock movements reference a sale line that is written later in the same transaction).
 */
export function uuidv7(): string {
  let ms = Date.now();
  if (ms <= lastMs) {
    ms = lastMs;
    sequence += 1;
    if (sequence > 0xfff) {
      ms += 1;
      sequence = 0;
    }
  } else {
    sequence = 0;
  }
  lastMs = ms;

  const b = randomBytes(16);
  b.writeUIntBE(ms, 0, 6); // 48-bit timestamp
  b[6] = 0x70 | ((sequence >> 8) & 0x0f); // version 7 + high bits of the counter
  b[7] = sequence & 0xff;
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC variant
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
