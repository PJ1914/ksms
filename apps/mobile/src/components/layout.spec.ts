import { layoutMode } from './layout';
describe('responsive navigation', () => {
  it.each([
    [375, 'phone'],
    [767, 'phone'],
    [768, 'tablet'],
    [1024, 'tablet'],
    [1199, 'tablet'],
    [1200, 'desktop'],
    [1440, 'desktop'],
  ] as const)('maps %i points to %s', (width, mode) => {
    expect(layoutMode(width)).toBe(mode);
  });
});
