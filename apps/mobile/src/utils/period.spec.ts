import { addDays, periodRange } from './period';

describe('report periods', () => {
  it('today is one day', () => {
    expect(periodRange('today', '2026-11-20')).toEqual({ from: '2026-11-20', to: '2026-11-20' });
  });

  it('7 and 30 days include today', () => {
    expect(periodRange('7d', '2026-11-20')).toEqual({ from: '2026-11-14', to: '2026-11-20' });
    expect(periodRange('30d', '2026-11-20')).toEqual({ from: '2026-10-22', to: '2026-11-20' });
  });

  it('this month starts on the 1st', () => {
    expect(periodRange('month', '2026-11-20')).toEqual({ from: '2026-11-01', to: '2026-11-20' });
    expect(periodRange('month', '2026-12-01')).toEqual({ from: '2026-12-01', to: '2026-12-01' });
  });

  it('counts across month and year ends', () => {
    expect(periodRange('7d', '2027-01-03').from).toBe('2026-12-28');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
