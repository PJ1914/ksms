import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { api, setSession, type AdminProfile } from '../api';
import { Alert, errorText } from '../ui';

type Step =
  | { kind: 'password' }
  | { kind: 'setup'; mfaToken: string; secret?: string; qr?: string }
  | { kind: 'verify'; mfaToken: string; useRecovery: boolean }
  | { kind: 'codes'; codes: string[]; admin: AdminProfile }
  | { kind: 'change'; admin: AdminProfile; currentPassword: string };

interface Session {
  accessToken: string;
  refreshToken: string;
  admin: AdminProfile;
  recoveryCodes?: string[];
}

/**
 * Admin sign-in (ADMIN_PANEL.md section 6, screen 1): email + password → Google Authenticator code
 * (first time: scan the QR and save the 10 recovery codes) → replace a temporary password.
 */
export function Login({ onSignedIn }: { onSignedIn: (a: AdminProfile) => void }) {
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (fn: () => Promise<void>) => (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    fn()
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  // Fetch the authenticator secret and draw its QR code once we reach the setup step.
  useEffect(() => {
    if (step.kind !== 'setup' || step.secret) return;
    api
      .post<{ secret: string; otpauthUri: string }>('/auth/mfa/setup', { mfaToken: step.mfaToken })
      .then(async (r) => {
        const qr = await QRCode.toDataURL(r.otpauthUri, { margin: 1, width: 220 });
        setStep({ ...step, secret: r.secret, qr });
      })
      .catch((err: unknown) => setError(errorText(err)));
  }, [step]);

  const finish = (s: Session) => {
    setSession(s.accessToken, s.refreshToken);
    if (s.recoveryCodes) return setStep({ kind: 'codes', codes: s.recoveryCodes, admin: s.admin });
    if (s.admin.mustChangePassword) {
      return setStep({ kind: 'change', admin: s.admin, currentPassword: password });
    }
    onSignedIn(s.admin);
  };

  return (
    <div className="auth">
      <div className="card">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          Yapaaram Admin
        </div>
        <Alert kind="error">{error}</Alert>

        {step.kind === 'password' && (
          <form
            onSubmit={run(async () => {
              const r = await api.post<{ step: 'MFA_SETUP' | 'MFA_VERIFY'; mfaToken: string }>(
                '/auth/login',
                { email, password },
              );
              setStep(
                r.step === 'MFA_SETUP'
                  ? { kind: 'setup', mfaToken: r.mfaToken }
                  : { kind: 'verify', mfaToken: r.mfaToken, useRecovery: false },
              );
            })}
          >
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            <button className="primary" disabled={busy} style={{ width: '100%' }}>
              {busy ? 'Checking…' : 'Continue'}
            </button>
          </form>
        )}

        {step.kind === 'setup' && (
          <form
            onSubmit={run(async () => {
              finish(
                await api.post<Session>('/auth/mfa/confirm', { mfaToken: step.mfaToken, code }),
              );
            })}
          >
            <h2>Set up Google Authenticator</h2>
            <p className="muted small">
              Open Google Authenticator (or any authenticator app), tap <b>+</b> and scan this code.
              Or choose “Enter a setup key” and type the key below.
            </p>
            {step.qr ? (
              <img src={step.qr} alt="Authenticator QR code" width={220} height={220} />
            ) : (
              <p className="muted">Preparing…</p>
            )}
            {step.secret && (
              <p className="secret small">{step.secret.match(/.{1,4}/g)?.join(' ')}</p>
            )}
            <label>
              6-digit code from the app
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                required
              />
            </label>
            <button
              className="primary"
              disabled={busy || code.length !== 6}
              style={{ width: '100%' }}
            >
              Turn on two-step sign-in
            </button>
          </form>
        )}

        {step.kind === 'verify' && (
          <form
            onSubmit={run(async () => {
              const body = step.useRecovery
                ? { mfaToken: step.mfaToken, recoveryCode: code }
                : { mfaToken: step.mfaToken, code };
              finish(await api.post<Session>('/auth/mfa/verify', body));
            })}
          >
            <h2>{step.useRecovery ? 'Use a recovery code' : 'Enter the code from your app'}</h2>
            <label>
              {step.useRecovery ? 'Recovery code (ABCDE-FGHIJ)' : '6-digit code'}
              <input
                inputMode={step.useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                value={code}
                onChange={(e) =>
                  setCode(step.useRecovery ? e.target.value : e.target.value.replace(/\D/g, ''))
                }
                autoFocus
                required
              />
            </label>
            <button className="primary" disabled={busy} style={{ width: '100%' }}>
              Sign in
            </button>
            <p className="small" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  setCode('');
                  setStep({ ...step, useRecovery: !step.useRecovery });
                }}
              >
                {step.useRecovery
                  ? 'Use the authenticator code instead'
                  : 'Lost your phone? Use a recovery code'}
              </button>
            </p>
          </form>
        )}

        {step.kind === 'codes' && (
          <div>
            <h2>Save your recovery codes</h2>
            <p className="muted small">
              Each code signs you in once if you lose your phone. They are shown <b>only now</b>.
              Write them down or keep them in a password manager.
            </p>
            <div className="codes">
              {step.codes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button onClick={() => void navigator.clipboard?.writeText(step.codes.join('\n'))}>
                Copy
              </button>
              <button
                className="primary"
                onClick={() =>
                  step.admin.mustChangePassword
                    ? setStep({ kind: 'change', admin: step.admin, currentPassword: password })
                    : onSignedIn(step.admin)
                }
              >
                I saved them
              </button>
            </div>
          </div>
        )}

        {step.kind === 'change' && (
          <form
            onSubmit={run(async () => {
              const admin = await api.post<AdminProfile>('/auth/change-password', {
                currentPassword: step.currentPassword,
                newPassword,
              });
              onSignedIn(admin);
            })}
          >
            <h2>Choose your own password</h2>
            <p className="muted small">
              You signed in with a temporary password. At least 12 characters.
            </p>
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </label>
            <button
              className="primary"
              disabled={busy || newPassword.length < 12}
              style={{ width: '100%' }}
            >
              Save and continue
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
