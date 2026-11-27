import { createScanGuard } from './scan-guard';

describe('createScanGuard', () => {
  it('counts a barcode held steady for 5 seconds only once', () => {
    const g = createScanGuard();
    let accepted = 0;
    for (let t = 0; t <= 5000; t += 100) if (g.accept('8901234567890', t)) accepted += 1;
    expect(accepted).toBe(1);
  });

  it('counts it again after the camera moved away for longer than the gap', () => {
    const g = createScanGuard(1200);
    expect(g.accept('A', 0)).toBe(true);
    expect(g.accept('A', 500)).toBe(false);
    expect(g.accept('A', 2000)).toBe(true); // not seen between 500 and 2000: a new packet
  });

  it('counts a different barcode straight away', () => {
    const g = createScanGuard();
    expect(g.accept('A', 0)).toBe(true);
    expect(g.accept('B', 50)).toBe(true);
  });

  it('keeps ignoring the first barcode while the camera still sees it in between', () => {
    const g = createScanGuard(1200);
    expect(g.accept('A', 0)).toBe(true);
    expect(g.accept('A', 1000)).toBe(false);
    expect(g.accept('A', 2100)).toBe(false); // seen at 1000, so still held at 2100
    expect(g.accept('A', 4000)).toBe(true);
  });

  it('skips a new code while the last scan is still being processed, then takes it later', () => {
    const g = createScanGuard();
    expect(g.accept('A', 0)).toBe(true);
    expect(g.accept('B', 100, true)).toBe(false);
    expect(g.accept('B', 200)).toBe(true);
  });

  it('forgets everything on reset', () => {
    const g = createScanGuard();
    expect(g.accept('A', 0)).toBe(true);
    g.reset();
    expect(g.accept('A', 10)).toBe(true);
  });
});
