import { ApiError } from '@ksms/api-client';

/** Field names from the API mapped to the words used on screen. */
const FIELD_LABELS: Record<string, string> = {
  phone: 'Mobile number',
  identifier: 'Mobile number',
  password: 'Password',
  fullName: 'Your name',
  shopName: 'Shop name',
  name: 'Product name',
  price: 'Price',
};

/** Turns any error into one short sentence a shopkeeper can act on. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'INVALID_CREDENTIALS':
        return 'Wrong mobile number or password.';
      case 'VALIDATION_ERROR': {
        const first = Array.isArray(e.details)
          ? (e.details[0] as { field?: string; messages?: string[] } | undefined)
          : undefined;
        if (first?.field && first.messages?.[0]) {
          const leaf = first.field.split('.').pop() ?? first.field;
          return `${FIELD_LABELS[leaf] ?? leaf}: ${first.messages[0]}`;
        }
        return 'Please check the details you entered.';
      }
    }
    if (e.status === 429) return 'Too many attempts. Please wait a minute and try again.';
    if (e.status === 401) return 'Your session has ended. Please sign in again.';
    if (e.status === 403) return 'You do not have permission to do this.';
    if (e.status >= 500) return 'The server had a problem. Please try again.';
    return e.message;
  }
  // fetch() throws a TypeError when the server cannot be reached at all.
  if (e instanceof TypeError) {
    return 'Cannot reach the server. Check the API is running on the PC and the phone is on the same Wi-Fi.';
  }
  return 'Something went wrong. Please try again.';
}
