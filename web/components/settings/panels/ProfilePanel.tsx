'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Pencil, UserCircle } from '@/icons';
import { UserAvatar } from '@/components/UserAvatar';
import { useAuth } from '@/hooks/useAuth.hook';
import { MAX_AVATAR_UPLOAD_BYTES } from '@/lib/avatar.util';
import { prepareAvatarUpload } from '@/lib/avatar-image.util';
import { useAppDispatch } from '@/stores/hooks';
import { updateProfileThunk, type ProfileUpdate } from '@/stores/auth/auth.slice';
import { addToast } from '@/stores/toasts/toasts.slice';
import type { AuthUser } from '@/types/auth.types';
import { SettingsRow, SettingsSection, SettingsValue } from '../SettingsPrimitives';

const INPUT_CLASS_NAME =
  'h-9 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-[13px] shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-64';

/** Raster types only: the API sniffs the bytes and refuses anything else. */
const AVATAR_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif';

function SignedInProfile({ user }: { user: AuthUser }) {
  const dispatch = useAppDispatch();
  const [displayName, setDisplayName] = useState(user.displayName ?? '');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [isSavingPhoto, setIsSavingPhoto] = useState(false);
  /** The last name the server confirmed, so a failed save can fall back to it. */
  const committedNameRef = useRef(user.displayName ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarObjectUrlRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (avatarObjectUrlRef.current) {
        URL.revokeObjectURL(avatarObjectUrlRef.current);
      }
    };
  }, []);

  // The address is required on an account, so it is the last resort for the initials.
  const effectiveDisplayName = displayName.trim() || user.email;
  const hasPhoto = Boolean(user.avatarUrl);

  const releasePreview = () => {
    if (avatarObjectUrlRef.current) {
      URL.revokeObjectURL(avatarObjectUrlRef.current);
      avatarObjectUrlRef.current = null;
    }
    setAvatarPreview(null);
  };

  /**
   * Every mutation answers with the account, so one dispatch updates the store, the
   * sidebar chip, this panel and the persisted session snapshot together.
   */
  const save = async (update: ProfileUpdate, failureMessage: string) => {
    setError(null);
    const result = await dispatch(updateProfileThunk(update));
    if (updateProfileThunk.rejected.match(result)) {
      setError(result.payload ?? failureMessage);
      return null;
    }
    return result.payload;
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0];
    // Clear the input first: re-picking the same file must fire a change event again.
    event.target.value = '';
    if (!picked) {
      return;
    }

    setError(null);
    const prepared = await prepareAvatarUpload(picked);
    if (prepared.size > MAX_AVATAR_UPLOAD_BYTES) {
      setError('That photo is too large. Pick an image under 2 MB.');
      return;
    }

    releasePreview();
    const previewUrl = URL.createObjectURL(prepared);
    avatarObjectUrlRef.current = previewUrl;
    setAvatarPreview(previewUrl);

    setIsSavingPhoto(true);
    const saved = await save({ avatar: prepared }, 'Could not upload that photo.');
    setIsSavingPhoto(false);
    // The local preview is finished either way: on success the store already carries
    // the uploaded URL, and a refused image must not stay on screen.
    releasePreview();

    if (saved) {
      addToast({ message: 'Profile photo updated.', type: 'success' });
    }
  };

  const handleRemovePhoto = async () => {
    setIsSavingPhoto(true);
    const saved = await save({ removeAvatar: true }, 'Could not remove your photo.');
    setIsSavingPhoto(false);

    if (saved) {
      releasePreview();
      addToast({ message: 'Profile photo removed.', type: 'success' });
    }
  };

  const commitDisplayName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      setDisplayName(committedNameRef.current);
      return;
    }
    if (trimmed === committedNameRef.current) {
      setDisplayName(trimmed);
      return;
    }

    const saved = await save({ displayName: trimmed }, 'Could not save your name.');
    if (saved) {
      committedNameRef.current = saved.user.displayName;
      setDisplayName(saved.user.displayName);
      addToast({ message: 'Display name updated.', type: 'success' });
    } else {
      setDisplayName(committedNameRef.current);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Account">
        <SettingsRow
          label="Profile photo"
          description="An avatar helps collaborators recognize you in documents."
          control={
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept={AVATAR_ACCEPT}
                onChange={handleFileChange}
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
              />
              <div className="relative inline-flex flex-shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isSavingPhoto}
                  aria-label="Change profile photo"
                  aria-busy={isSavingPhoto}
                  className="group relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-full cursor-pointer transition-opacity focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait"
                >
                  <UserAvatar
                    seed={user.id}
                    name={effectiveDisplayName}
                    src={avatarPreview ?? user.avatarUrl}
                    size="lg"
                  />
                  <span
                    aria-hidden="true"
                    className={`absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white transition-opacity duration-150 ${
                      isSavingPhoto ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    <Pencil size={16} strokeWidth={2} />
                  </span>
                </button>
              </div>
              {hasPhoto ? (
                <button
                  type="button"
                  onClick={handleRemovePhoto}
                  disabled={isSavingPhoto}
                  className="text-[12.5px] leading-snug text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
                >
                  Remove
                </button>
              ) : null}
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
              maxLength={100}
              onChange={(event) => {
                setDisplayName(event.target.value);
                setError(null);
              }}
              onBlur={() => void commitDisplayName()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
              placeholder="Your display name"
              aria-label="Display name"
              className={INPUT_CLASS_NAME}
            />
          }
        />

        <SettingsRow
          label="Email"
          description="The email address associated with your account."
          control={<SettingsValue>{user.email}</SettingsValue>}
        />
      </SettingsSection>

      {error ? (
        <p
          role="alert"
          className="border-t border-border pt-3.5 text-[12.5px] leading-snug text-destructive"
        >
          {error}
        </p>
      ) : null}
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

  return <SignedInProfile key={user.id} user={user} />;
}
