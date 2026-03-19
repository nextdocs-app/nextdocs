'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useAppDispatch } from '@/stores/hooks';
import { clearError } from '@/stores/auth/auth.slice';
import { useAuth } from '@/hooks/useAuth.hook';

type Mode = 'login' | 'signup';

interface Props {
  onClose: () => void;
}

export function AuthModal({ onClose }: Props) {
  const dispatch = useAppDispatch();
  const { login, register, isLoading, error } = useAuth();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousActive = document.activeElement as HTMLElement | null;
    dialog.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

      if (focusable.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (!active || active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener('keydown', onKeyDown);

    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      previousActive?.focus();
    };
  }, [onClose]);

  function switchMode(next: Mode) {
    dispatch(clearError());
    setEmail('');
    setPassword('');
    setDisplayName('');
    setMode(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    const action =
      mode === 'login' ? login({ email, password }) : register({ email, displayName, password });

    try {
      await action.unwrap();
      onClose();
    } catch {
      // We just need to prevent closing the modal on failure.
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4 will-change-transform"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-sm border border-border rounded-lg bg-card px-8 py-7 shadow-xl"
      >
        <h1 id={titleId} className="text-lg font-semibold text-foreground mb-1">
          {mode === 'login' ? 'Sign in' : 'Create an account'}
        </h1>
        <p className="text-sm text-foreground/50 mb-6">
          {mode === 'login'
            ? 'Welcome back. Enter your details below.'
            : 'Start for free. Fully open-source and self-hostable.'}
        </p>

        {/* OAuth buttons */}
        <div className="flex flex-col gap-2 mb-5">
          <OAuthButton provider="google" />
          <OAuthButton provider="github" />
        </div>

        <Divider />

        {/* Error */}
        {error && <p className="text-sm text-red-500 mb-4 px-1">{error}</p>}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {mode === 'signup' && (
            <Field
              id="auth-displayName"
              label="Display Name"
              type="text"
              value={displayName}
              onChange={setDisplayName}
              autoComplete="name"
              placeholder="Jane Doe"
            />
          )}
          <Field
            id="auth-email"
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            placeholder="you@example.com"
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="auth-password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
              minLength={mode === 'signup' ? 8 : undefined}
              required
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:ring-1 focus:ring-foreground/30 transition"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="mt-1 w-full rounded-md bg-foreground text-background text-sm font-medium py-2 px-4 transition-opacity hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {isLoading
              ? mode === 'login'
                ? 'Signing in…'
                : 'Creating account…'
              : mode === 'login'
                ? 'Continue'
                : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-sm text-foreground/50 text-center">
          {mode === 'login' ? (
            <>
              No account?{' '}
              <button
                type="button"
                onClick={() => switchMode('signup')}
                className="text-foreground underline underline-offset-4 hover:opacity-70 cursor-pointer"
              >
                Create one
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                className="text-foreground underline underline-offset-4 hover:opacity-70 cursor-pointer"
              >
                Sign in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3 mb-5">
      <span className="flex-1 h-px bg-border" />
      <span className="text-xs text-foreground/40">or</span>
      <span className="flex-1 h-px bg-border" />
    </div>
  );
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  placeholder,
}: {
  id: string;
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-foreground/30 outline-none focus:ring-1 focus:ring-foreground/30 transition"
      />
    </div>
  );
}

function OAuthButton({ provider }: { provider: 'google' | 'github' }) {
  return (
    <button
      type="button"
      title="Coming soon"
      disabled
      className="w-full flex items-center justify-center gap-2.5 rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground/50 cursor-not-allowed opacity-60"
    >
      {provider === 'google' ? <GoogleIcon /> : <GitHubIcon />}
      Continue with {provider === 'google' ? 'Google' : 'GitHub'}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="text-foreground/70"
    >
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}
