/**
 * Counts a barcode once while it stays in front of the camera.
 *
 * The camera reports the same code many times a second. A plain "ignore it for 2 seconds" rule lets a
 * barcode held steady for 3 to 4 seconds count again and again. Instead, every reading of the code
 * keeps it "held": it counts again only after the camera has NOT seen it for `gapMs` (the phone was
 * moved away and back, for the next packet). A different code counts straight away.
 */
export function createScanGuard(gapMs = 1200) {
  let last: { code: string; seenAt: number } | null = null;
  return {
    /**
     * Should this reading be handled? Pass `blocked` while the previous scan is still being processed:
     * a new code is then skipped (and will be offered again by the next camera frame).
     */
    accept(code: string, now: number, blocked = false): boolean {
      if (last && last.code === code && now - last.seenAt < gapMs) {
        last.seenAt = now; // still in front of the camera
        return false;
      }
      if (blocked) return false;
      last = { code, seenAt: now };
      return true;
    },
    reset(): void {
      last = null;
    },
  };
}
