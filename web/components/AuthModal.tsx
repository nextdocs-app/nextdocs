'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useAppDispatch } from '@/stores/hooks';
import { clearError } from '@/stores/auth/auth.slice';
import { useAuth } from '@/hooks/useAuth.hook';
import { GitHub, Google } from '@/icons';

type Mode = 'login' | 'signup';

interface Props {
  onClose: () => void;
}

export function AuthModal({ onClose }: Props) {
  const dispatch = useAppDispatch();
  const { login, register, isLoading, error } = useAuth();
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previousActive = document.activeElement as HTMLElement | null;
    dialog.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
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
  }, []);

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
      className="w-full flex items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground/50 cursor-not-allowed opacity-60"
    >
      <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {provider === 'google' ? <Google /> : <GitHub className="text-foreground/70" />}
      </span>
      Continue with {provider === 'google' ? 'Google' : 'GitHub'}
    </button>
  );
}
