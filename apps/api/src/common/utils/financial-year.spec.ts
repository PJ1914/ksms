import { financialYear } from './financial-year';

describe('financialYear', () => {
  it('uses April-March years', () => {
    expect(financialYear(new Date('2026-11-18T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2027-02-10T10:00:00Z'))).toBe('2026-27');
    expect(financialYear(new Date('2026-04-01T10:00:00+05:30'))).toBe('2026-27');
  });

  it('switches at midnight India time, not UTC', () => {
    // 31 Mar 2027 23:30 IST is still the old year; 00:30 IST on 1 Apr is the new year
    expect(financialYear(new Date('2027-03-31T23:30:00+05:30'))).toBe('2026-27');
    expect(financialYear(new Date('2027-04-01T00:30:00+05:30'))).toBe('2027-28');
    // 31 Mar 2027 19:00 UTC == 1 Apr 00:30 IST
    expect(financialYear(new Date('2027-03-31T19:00:00Z'))).toBe('2027-28');
  });

  it('handles the century boundary', () => {
    expect(financialYear(new Date('2099-06-01T00:00:00Z'))).toBe('2099-00');
  });
});
