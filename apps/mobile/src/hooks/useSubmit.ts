import { useCallback, useRef, useState } from 'react';
import { type IdempotencyHandle, idempotencyFor } from '@ksms/validation';
import { newKey, postData } from '@/api/client';
import { friendlyError } from '@/utils/errors';

/**
 * Sends one money or stock request with double-tap and retry protection.
 *
 * The same Idempotency-Key is reused while the request is unchanged (a retry after a bad signal can never apply
 * twice) and a new one is made as soon as anything in it changes. A key is forgotten once the request succeeds.
 * The button should be disabled while `busy`.
 */
export function useSubmit() {
  const handle = useRef<IdempotencyHandle | null>(null);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T>(path: string, body: unknown): Promise<T | null> => {
    if (inFlight.current) return null; // a second tap while the first is still going
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      handle.current = idempotencyFor(handle.current, { path, body }, newKey);
      const result = await postData<T>(path, body, handle.current.key);
      handle.current = null;
      return result;
    } catch (e) {
      setError(friendlyError(e));
      return null;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, []);

  return { run, busy, error, setError };
}
