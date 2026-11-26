/**
 * Tracks requests that take longer than SLOW_AFTER_MS so the app can say "Waking up the server..."
 * instead of looking frozen (FIXES F20: the free server sleeps when idle and takes a while to start).
 */
export const SLOW_AFTER_MS = 5_000;

type Listener = (slow: boolean) => void;
const listeners = new Set<Listener>();
let slowCount = 0;

function emit(): void {
  for (const l of listeners) l(slowCount > 0);
}

/** Pass as `onRequest` to createApiClient. */
export function trackRequest(): () => void {
  let slow = false;
  const timer = setTimeout(() => {
    slow = true;
    slowCount += 1;
    emit();
  }, SLOW_AFTER_MS);
  return () => {
    clearTimeout(timer);
    if (slow) {
      slowCount -= 1;
      emit();
    }
  };
}

export function subscribeSlow(listener: Listener): () => void {
  listeners.add(listener);
  listener(slowCount > 0);
  return () => listeners.delete(listener);
}
