/** Sign-up rules, shared by the screen and its tests. The server enforces the same rules. */

/** Keeps only the 10 digits of an Indian mobile number (the +91 is shown separately). Handles pasted +91 / 0 forms. */
export function phoneDigits(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length > 10 && d.startsWith('91')) d = d.slice(2);
  else if (d.length > 10 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

/** What is wrong with the number so far, or null when it is fine (or still empty). */
export function phoneProblem(digits: string): string | null {
  if (!digits) return null;
  if (!/^[6-9]/.test(digits)) return 'Indian mobile numbers start with 6, 7, 8 or 9.';
  if (digits.length < 10) return `${digits.length} of 10 digits`;
  return null;
}

export interface PasswordCheck {
  label: string;
  ok: boolean;
}

export function passwordChecks(password: string, phone = ''): PasswordCheck[] {
  return [
    { label: 'At least 8 characters', ok: password.length >= 8 },
    { label: 'A letter and a number', ok: /[A-Za-z]/.test(password) && /\d/.test(password) },
    {
      label: 'Not your mobile number',
      ok: password.length > 0 && !(phone && password.includes(phone)),
    },
  ];
}

export function passwordOk(password: string, phone = ''): boolean {
  return passwordChecks(password, phone).every((c) => c.ok);
}
