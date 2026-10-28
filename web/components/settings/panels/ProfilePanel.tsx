'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Pencil, UserCircle } from '@/icons';
import { useAuth } from '@/hooks/useAuth.hook';
import type { AuthUser } from '@/types/auth.types';
import { SettingsRow, SettingsSection, SettingsValue } from '../SettingsPrimitives';

function SignedInProfile({ user }: { user: AuthUser }) {
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(user.avatarUrl ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
      }
    };
  }, []);

  const effectiveDisplayName = displayName.trim() || user.email || 'User';
  const initial = effectiveDisplayName.charAt(0).toUpperCase() || 'U';

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
        avatarObjectUrlRef.current = null;
      }

      const previewUrl = URL.createObjectURL(file);
      avatarObjectUrlRef.current = previewUrl;
      setAvatarPreview(previewUrl);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Account">
        <SettingsRow
          label="Profile photo"
          description="An avatar helps collaborators recognize you in documents."
          control={
            <div className="relative inline-flex flex-shrink-0">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                disabled
                onChange={handleFileChange}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                type="button"
                disabled
                aria-label="Change profile photo"
                className="group relative flex h-12 w-12 items-center justify-center rounded-full bg-[var(--nd-placeholder-bg)] text-[var(--nd-placeholder-fg)] cursor-not-allowed disabled:cursor-not-allowed focus-visible:outline-none"
              >
                <span className="inline-flex h-full w-full items-center justify-center overflow-hidden rounded-full text-[17px] font-semibold select-none">
                  {avatarPreview ? (
                    // Blob previews are local; next/image would only add an optimization step.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={avatarPreview}
                      alt="Profile photo"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    initial
                  )}
                </span>
                <span
                  aria-hidden="true"
                  className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                >
                  <Pencil size={16} strokeWidth={2} />
                </span>
              </button>
            </div>
          }
        />

        <SettingsRow
          label="Display name"
          description="Your name as shown across documents and comments."
          control={
            <input
              type="text"
              value={displayName}
              disabled
              readOnly
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your display name"
              aria-label="Display name"
              className="h-9 w-full rounded-md border border-border bg-muted/40 px-3 py-1.5 text-[13px] text-muted-foreground shadow-xs cursor-not-allowed focus-visible:outline-none sm:w-64"
            />
          }
        />

        <SettingsRow
          label="Email"
          description="The email address associated with your account."
          control={<SettingsValue>{user.email}</SettingsValue>}
        />
      </SettingsSection>
    </div>
  );
}

export function ProfilePanel() {
  const { user, isAuthenticated, isInitializing } = useAuth();

  if (isInitializing) {
    return <div className="py-6 text-[13.5px] text-muted-foreground">Loading account…</div>;
  }

  if (!isAuthenticated || !user) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 px-6 text-center">
        <span
          aria-hidden="true"
          className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
        >
          <UserCircle size={24} />
        </span>
        <h3 className="text-[15px] font-medium text-foreground">Not signed in</h3>
        <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
          You are currently browsing as a guest. Sign in to customize your profile, collaborate with
          others, and keep documents in your workspace.
        </p>
      </div>
    );
  }

  return (
    <SignedInProfile key={`${user.id}:${user.displayName}:${user.avatarUrl ?? ''}`} user={user} />
  );
}
