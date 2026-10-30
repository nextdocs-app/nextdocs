'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Portal } from '@/components/Portal';
import { IconPickerPanel } from '@/components/page/IconPickerPanel';
import { PICKER_PANEL_WIDTH } from '@/components/page/PickerShell';
import {
  WorkspaceIconTile,
  workspaceIconTileStyle,
} from '@/components/workspace/WorkspaceIconTile';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel.hook';
import { Close, Pencil } from '@/icons';
import { toIconRequestPayload } from '@/lib/document-icon.util';
import { trapTabKey } from '@/lib/focus-trap.util';
import { spaceApiService } from '@/services/space.service';
import type { DocumentIcon } from '@/types/document.types';
import type { Space, SpaceAccessMode, SpaceEveryoneAccessLevel } from '@/types/space.types';
import { SpaceAccessFields } from './SpaceAccessFields';
import type { SpaceNotice } from './space-access.util';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface CreateSpaceModalProps {
  isOpen: boolean;
  accessToken: string;
  onClose: () => void;
  onCreated: (space: Space) => void;
  onNotice: (notice: SpaceNotice | null) => void;
}

/** Mounted only while open, so a cancelled draft never leaks into the next visit. */
export function CreateSpaceModal({ isOpen, ...props }: CreateSpaceModalProps) {
  return isOpen ? <CreateSpaceDialog {...props} /> : null;
}

function CreateSpaceDialog({
  accessToken,
  onClose,
  onCreated,
  onNotice,
}: Omit<CreateSpaceModalProps, 'isOpen'>) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<DocumentIcon | null>(null);
  const [accessMode, setAccessMode] = useState<SpaceAccessMode>('CUSTOM');
  const [everyoneAccessLevel, setEveryoneAccessLevel] = useState<SpaceEveryoneAccessLevel>('VIEW');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const isSubmittingRef = useRef(isSubmitting);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;
  const nameId = `${baseId}-name`;

  const iconPanel = useAnchoredPanel({ width: PICKER_PANEL_WIDTH, align: 'left' });
  const tile = workspaceIconTileStyle(icon);

  const uploadSpaceIcon = async (file: File) => {
    if (!accessToken) {
      throw new Error('Sign in to upload an image.');
    }

    return spaceApiService.uploadIcon(accessToken, file);
  };

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    nameInputRef.current?.focus();

    const dialog = dialogRef.current;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // The icon picker is portalled outside this dialog and owns its own keys.
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target;
      const owningDialog = target instanceof Element ? target.closest('[role="dialog"]') : null;
      if (owningDialog && owningDialog !== dialog) {
        return;
      }

      if (event.key === 'Escape') {
        if (event.isComposing || isSubmittingRef.current) {
          return;
        }

        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (dialog) {
        trapTabKey(event, dialog);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErrorText('Give the space a name.');
      return;
    }

    setIsSubmitting(true);
    setErrorText(null);
    try {
      const created = await spaceApiService.create(accessToken, {
        name: trimmed,
        accessMode,
        everyoneAccessLevel,
        ...(icon ? { icon: toIconRequestPayload(icon) } : {}),
      });
      onCreated(created);
      onNotice({ kind: 'status', message: `${created.name} was created.` });
      onClose();
    } catch (error) {
      setErrorText(messageFor(error, 'Could not create the space.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSubmitting) {
            onCloseRef.current();
          }
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[440px] flex-col overflow-y-auto rounded-xl border border-border bg-background p-6 text-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150"
        >
          <button
            type="button"
            onClick={() => onCloseRef.current()}
            disabled={isSubmitting}
            aria-label="Close"
            className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Close size={16} />
          </button>

          <h2 id={titleId} className="text-[18px] font-semibold leading-snug tracking-tight">
            Create a space
          </h2>
          <p id={descriptionId} className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            Spaces collect related documents and decide who can open them.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <button
                ref={iconPanel.triggerRef}
                type="button"
                onClick={iconPanel.toggle}
                disabled={isSubmitting}
                aria-label={icon ? 'Change space icon' : 'Add a space icon'}
                aria-haspopup="dialog"
                aria-expanded={iconPanel.isOpen}
                style={tile.style}
                className={`group relative flex h-[60px] w-[60px] flex-shrink-0 items-center justify-center overflow-hidden rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 ${tile.className}`}
              >
                <span className="inline-flex h-full w-full items-center justify-center overflow-hidden rounded-lg">
                  <WorkspaceIconTile
                    icon={icon}
                    size={60}
                    accessToken={accessToken}
                    fallback="space"
                  />
                </span>
                <span
                  aria-hidden="true"
                  className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                >
                  <Pencil size={16} strokeWidth={2} />
                </span>
              </button>

              <div className="flex h-[60px] min-w-0 flex-1 flex-col justify-between">
                <label htmlFor={nameId} className="text-[12.5px] font-medium text-foreground/80">
                  Name
                </label>
                <input
                  ref={nameInputRef}
                  id={nameId}
                  type="text"
                  value={name}
                  maxLength={255}
                  onChange={(event) => {
                    setName(event.target.value);
                    setErrorText(null);
                  }}
                  disabled={isSubmitting}
                  placeholder="Engineering"
                  className="h-9 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-[13.5px] shadow-xs transition-colors placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>

            <SpaceAccessFields
              accessMode={accessMode}
              everyoneAccessLevel={everyoneAccessLevel}
              disabled={isSubmitting}
              onChange={(next) => {
                setAccessMode(next.accessMode);
                setEveryoneAccessLevel(next.everyoneAccessLevel);
              }}
            />

            {errorText ? (
              <p role="alert" className="text-[12.5px] font-medium text-destructive">
                {errorText}
              </p>
            ) : null}

            <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <button
                type="button"
                onClick={() => onCloseRef.current()}
                disabled={isSubmitting}
                className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground disabled:opacity-60 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-auto sm:py-1.5"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || name.trim().length === 0}
                className="w-full rounded-md bg-[var(--nd-brand)] px-3 py-2 text-[13px] font-medium text-[var(--nd-brand-foreground)] shadow-xs transition-colors hover:bg-[var(--nd-brand-hover)] active:bg-[var(--nd-brand-active)] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-auto sm:py-1.5"
              >
                {isSubmitting ? 'Creating…' : 'Create space'}
              </button>
            </div>
          </form>
        </div>

        {iconPanel.isOpen ? (
          <IconPickerPanel
            icon={icon ?? undefined}
            accessToken={accessToken}
            canUpload
            panelRef={iconPanel.panelRef}
            uploadFile={uploadSpaceIcon}
            panelStyle={iconPanel.panelStyle}
            label="Choose a space icon"
            onSelect={(next) => {
              setIcon(next);
              iconPanel.close();
            }}
            onRemove={() => {
              setIcon(null);
              iconPanel.close();
            }}
            onClose={iconPanel.close}
          />
        ) : null}
      </div>
    </Portal>
  );
}
