export const SIDEBAR_WIDTH = 240;
export const RAIL_WIDTH = 72;
export function layoutMode(width: number) {
  if (width < 768) return 'phone';
  return width < 1200 ? 'tablet' : 'desktop';
}
