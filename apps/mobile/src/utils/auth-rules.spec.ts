import { passwordChecks, passwordOk, phoneDigits, phoneProblem } from './auth-rules';

describe('phoneDigits', () => {
  it('keeps 10 digits and strips pasted prefixes', () => {
    expect(phoneDigits('98765 43210')).toBe('9876543210');
    expect(phoneDigits('+91 98765-43210')).toBe('9876543210');
    expect(phoneDigits('09876543210')).toBe('9876543210');
    expect(phoneDigits('98765432101234')).toBe('9876543210');
  });
});

describe('phoneProblem', () => {
  it('is quiet when empty or valid', () => {
    expect(phoneProblem('')).toBeNull();
    expect(phoneProblem('9876543210')).toBeNull();
  });
  it('rejects a wrong first digit and counts the rest', () => {
    expect(phoneProblem('1234567890')).toMatch(/start with 6/);
    expect(phoneProblem('98765')).toBe('5 of 10 digits');
  });
});

describe('password rules', () => {
  it('needs 8 characters, a letter and a number', () => {
    expect(passwordOk('abcdefgh')).toBe(false);
    expect(passwordOk('12345678')).toBe(false);
    expect(passwordOk('abc12')).toBe(false);
    expect(passwordOk('shop1234')).toBe(true);
  });
  it('rejects a password that contains the mobile number', () => {
    expect(passwordOk('a9876543210', '9876543210')).toBe(false);
    expect(passwordChecks('shop1234', '9876543210').every((c) => c.ok)).toBe(true);
  });
});
