import { normalizeIndianPhone } from './phone';

describe('normalizeIndianPhone', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+91 98765 43210', '9876543210'],
    ['+91-98765-43210', '9876543210'],
    ['09876543210', '9876543210'],
    ['919876543210', '9876543210'],
  ])('normalises %s', (input, expected) => {
    expect(normalizeIndianPhone(input)).toBe(expected);
  });

  it.each(['12345', '5876543210', 'abcdefghij', '98765432101', '', null, undefined, 9876543210])(
    'rejects %s',
    (input) => {
      expect(normalizeIndianPhone(input)).toBeNull();
    },
  );
});
