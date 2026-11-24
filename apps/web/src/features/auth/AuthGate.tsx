import { useEffect, useRef, useState, type ReactNode, type SubmitEvent } from 'react';
import { ApiError } from '../../api/client';
import { useAuthStatus, useLogin } from '../../api/queries';
import { suspendKeybindings } from '../../commands/dispatch';
import { useI18n } from '../../i18n/context';
import { LanguagePicker } from '../../i18n/LanguagePicker';
import { isNativeApp, ReadOnlyContext } from '../readOnly';

/**
 * Asks for the authenticator code when the server wants one.
 *
 * - Not signed in when the app opens: a sign-in page instead of the app.
 * - Signed out while working (the session's time ran out, or signed out in
 *   another tab): a sign-in box *over* the app. The app stays mounted, so an
 *   unsaved edit isn't lost: autosave keeps retrying and goes through as soon
 *   as the code is accepted.
 *
 * Until the first status arrives the app renders as usual (no splash; the API
 * refuses every call without a session anyway). Any 401 refreshes the status
 * (see main.tsx).
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStatus();
  const signedOut = status.data?.enabled === true && !status.data.signedIn;
  // Has the app been shown signed in (or with sign-in off) in this page load?
  const [wasIn, setWasIn] = useState(false);
  if (status.data && !signedOut && !wasIn) setWasIn(true);

  if (signedOut && !wasIn) return <SignInPage />;
  const readOnly = isNativeApp() || status.data?.readOnly === true;
  return (
    <ReadOnlyContext value={readOnly}>
      {children}
      {signedOut && <SignInDialog />}
    </ReadOnlyContext>
  );
}

function SignInPage() {
  const { t } = useI18n();
  return (
    <main className="auth-page">
      <div className="auth-card">
        <span className="auth-logo" aria-hidden="true">
          ◆
        </span>
        <h1>{t('auth.title')}</h1>
        <p className="muted">{t('auth.subtitle')}</p>
        <CodeForm />
        <LanguagePicker />
      </div>
    </main>
  );
}

/** Modal, and can't be dismissed: the only way on is a valid code. */
function SignInDialog() {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return suspendKeybindings(); // app shortcuts would act behind the box
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog auth-dialog"
      aria-labelledby="auth-dialog-title"
      onCancel={(e) => {
        e.preventDefault(); // Escape doesn't close it
      }}
    >
      <h2 id="auth-dialog-title">{t('auth.expiredTitle')}</h2>
      <p className="muted">{t('auth.expired')}</p>
      <CodeForm />
    </dialog>
  );
}

function CodeForm() {
  const { t, errorText } = useI18n();
  const login = useLogin();
  const [code, setCode] = useState('');

  const submit = (value: string) => {
    if (!/^\d{6}$/.test(value) || login.isPending) return;
    // (The phone app never signs in here: it reads its own copy, api/phoneData.ts.)
    login.mutate(
      { code: value, readOnly: false },
      {
        onError: () => {
          setCode(''); // a wrong code is no use; ready for the next one
        },
      },
    );
  };

  let error: string | null = null;
  if (login.error instanceof ApiError) {
    const body = login.error.body?.error;
    if (body?.reason === 'LOCKED_OUT') {
      const ms = (body.details as { retryAfterMs?: number } | undefined)?.retryAfterMs ?? 60_000;
      error = t('auth.lockedOut', { minutes: Math.max(1, Math.ceil(ms / 60_000)) });
    } else {
      error = errorText(login.error);
    }
  } else if (login.error) {
    error = errorText(login.error);
  }

  return (
    <form
      className="code-form"
      onSubmit={(e: SubmitEvent) => {
        e.preventDefault();
        submit(code);
      }}
    >
      <label htmlFor="km-totp-code">{t('auth.codeLabel')}</label>
      <input
        id="km-totp-code"
        className="code-input"
        autoFocus
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        placeholder="000000"
        aria-invalid={error !== null}
        aria-describedby={error ? 'km-totp-error' : undefined}
        value={code}
        disabled={login.isPending}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) submit(digits); // no need to press Enter
        }}
      />
      {error && (
        <p id="km-totp-error" className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" disabled={code.length !== 6 || login.isPending}>
        {t('auth.signIn')}
      </button>
    </form>
  );
}
