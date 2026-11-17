import { ApiError } from '@ksms/api-client';
import { friendlyError } from './errors';

describe('friendlyError', () => {
  it('explains wrong credentials', () => {
    expect(friendlyError(new ApiError(401, 'INVALID_CREDENTIALS', 'x'))).toMatch(/wrong/i);
  });

  it('names the first invalid field in plain words', () => {
    const e = new ApiError(400, 'VALIDATION_ERROR', 'Request validation failed', 'c1', [
      { field: 'phone', messages: ['phone must be a valid Indian mobile number'] },
    ]);
    expect(friendlyError(e)).toBe('Mobile number: phone must be a valid Indian mobile number');
  });

  it('handles rate limits, permissions and server faults', () => {
    expect(friendlyError(new ApiError(429, 'TOO_MANY_REQUESTS', 'x'))).toMatch(/wait/i);
    expect(friendlyError(new ApiError(403, 'FORBIDDEN', 'x'))).toMatch(/permission/i);
    expect(friendlyError(new ApiError(500, 'INTERNAL_ERROR', 'x'))).toMatch(/server/i);
  });

  it('passes through other API messages', () => {
    expect(friendlyError(new ApiError(409, 'SKU_IN_USE', 'SKU already used'))).toBe(
      'SKU already used',
    );
  });

  it('explains an unreachable server (fetch TypeError)', () => {
    expect(friendlyError(new TypeError('Network request failed'))).toMatch(/same Wi-Fi/);
  });

  it('never shows raw internals for unknown errors', () => {
    expect(friendlyError(new Error('stack trace here'))).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
