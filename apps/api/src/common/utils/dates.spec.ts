import { AppException } from '../errors/app.exception';
import { dateOnly, isRealIsoDate, startOfIndiaDay, timestampRange, todayInIndia } from './dates';

describe('isRealIsoDate', () => {
  it.each([
    ['2026-11-18', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-02-31', false],
    ['2026-13-01', false],
    ['2026-1-1', false],
    ['18-11-2026', false],
    ['', false],
  ])('%s -> %s', (value, expected) => {
    expect(isRealIsoDate(value)).toBe(expected);
  });
});

describe('todayInIndia', () => {
  it('uses the India calendar: 20:00 UTC is already the next day in India', () => {
    expect(todayInIndia(new Date('2026-11-18T20:00:00Z'))).toBe('2026-11-19');
    expect(todayInIndia(new Date('2026-11-18T18:29:00Z'))).toBe('2026-11-18');
  });
});

describe('timestampRange (whole India-time days)', () => {
  it('returns nothing when no filter is given', () => {
    expect(timestampRange()).toBeUndefined();
  });

  it('a plain `from` starts at India midnight', () => {
    expect(timestampRange('2026-11-18')).toEqual({ gte: new Date('2026-11-17T18:30:00.000Z') });
  });

  it('a plain `to` INCLUDES the whole of that day (ends before the next India midnight)', () => {
    const r = timestampRange(undefined, '2026-11-18')!;
    expect(r.lt).toEqual(new Date('2026-11-18T18:30:00.000Z'));
    // a sale at 11:59 pm India time on the 18th is inside; 12:00 am on the 19th is not
    expect(new Date('2026-11-18T18:29:59Z') < r.lt!).toBe(true);
    expect(new Date('2026-11-18T18:30:00Z') < r.lt!).toBe(false);
    // and the whole-day range for one day covers exactly 24 hours
    const one = timestampRange('2026-11-18', '2026-11-18')!;
    expect(one.lt!.getTime() - one.gte!.getTime()).toBe(86_400_000);
  });

  it('full timestamps are used exactly as given', () => {
    expect(timestampRange('2026-11-18T10:00:00Z', '2026-11-18T12:00:00Z')).toEqual({
      gte: new Date('2026-11-18T10:00:00Z'),
      lte: new Date('2026-11-18T12:00:00Z'),
    });
  });

  it.each([
    ['2026-02-31', undefined],
    [undefined, '2026-13-40'],
    ['not a date', undefined],
  ])('refuses %s / %s with a 400', (from, to) => {
    expect(() => timestampRange(from, to)).toThrow(AppException);
  });
});

describe('dateOnly / startOfIndiaDay', () => {
  it('validates and returns UTC midnight for DATE columns', () => {
    expect(dateOnly('2026-11-18', 'from')).toEqual(new Date('2026-11-18T00:00:00Z'));
    expect(() => dateOnly('2026-02-30', 'from')).toThrow(AppException);
  });
  it('start of an India day is 18:30 UTC the evening before', () => {
    expect(startOfIndiaDay('2026-11-18').toISOString()).toBe('2026-11-17T18:30:00.000Z');
  });
});
