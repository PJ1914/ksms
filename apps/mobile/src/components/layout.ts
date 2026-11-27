export const SIDEBAR_WIDTH = 272;
export const RAIL_WIDTH = 88;
export function layoutMode(width: number) {
  if (width < 768) return 'phone';
  return width < 1200 ? 'tablet' : 'desktop';
}
