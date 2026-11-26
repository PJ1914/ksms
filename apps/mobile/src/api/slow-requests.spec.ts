import { SLOW_AFTER_MS, subscribeSlow, trackRequest } from './slow-requests';

describe('slow request notice (FIXES F20)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('turns on only after 5 s and off when the request ends', () => {
    const seen: boolean[] = [];
    const stop = subscribeSlow((s) => seen.push(s));
    const done = trackRequest();
    jest.advanceTimersByTime(SLOW_AFTER_MS - 1);
    expect(seen).toEqual([false]);
    jest.advanceTimersByTime(1);
    expect(seen).toEqual([false, true]);
    done();
    expect(seen).toEqual([false, true, false]);
    stop();
  });

  it('a fast request never shows the notice', () => {
    const seen: boolean[] = [];
    const stop = subscribeSlow((s) => seen.push(s));
    trackRequest()();
    jest.advanceTimersByTime(SLOW_AFTER_MS * 2);
    expect(seen).toEqual([false]);
    stop();
  });
});
