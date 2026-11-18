import { formatDate, formatDateTime, trimZeros, words } from './format';

describe('trimZeros', () => {
  it.each([
    ['98.000', '98'],
    ['1.500', '1.5'],
    ['0.250', '0.25'],
    ['100', '100'],
    ['0.000', '0'],
    ['10.000', '10'],
    ['-2.500', '-2.5'],
  ])('%s -> %s', (input, expected) => {
    expect(trimZeros(input)).toBe(expected);
  });
});

describe('dates', () => {
  it('writes a date as given, without shifting it', () => {
    expect(formatDate('2026-11-20')).toBe('20 Nov 2026');
    expect(formatDate('2026-01-05')).toBe('5 Jan 2026');
    expect(formatDate('not a date')).toBe('not a date');
  });

  it('shows timestamps in India time', () => {
    expect(formatDateTime('2026-11-20T09:35:00Z')).toBe('20 Nov 2026, 3:05 pm');
    expect(formatDateTime('2026-11-20T18:30:00Z')).toBe('21 Nov 2026, 12:00 am');
    expect(formatDateTime('2026-11-20T06:30:00Z')).toBe('20 Nov 2026, 12:00 pm');
  });
});

describe('words', () => {
  it('turns codes into plain words', () => {
    expect(words('PARTIALLY_RECEIVED')).toBe('Part received');
    expect(words('CREDIT_SALE')).toBe('Credit sale');
    expect(words('RECEIVED')).toBe('Received');
    expect(words('SOMETHING_NEW')).toBe('Something new');
  });
});
