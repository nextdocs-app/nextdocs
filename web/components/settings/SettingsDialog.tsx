'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Portal } from '@/components/Portal';
import { useAuth } from '@/hooks/useAuth.hook';
import { Close } from '@/icons';
import { trapTabKey } from '@/lib/focus-trap.util';
import { SettingsNav } from './SettingsNav';
import { DEFAULT_SETTINGS_ENTRY_ID, getSettingsGroups } from './settings.registry';
import type { SettingsEntryId } from './types';

function SettingsDialogSurface({
  initialEntryId,
  onClose,
  returnFocusRef,
}: {
  initialEntryId?: SettingsEntryId | null;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [activeId, setActiveId] = useState<SettingsEntryId>(
    initialEntryId ?? DEFAULT_SETTINGS_ENTRY_ID
  );
  const { isAuthenticated } = useAuth();
  const groups = getSettingsGroups(isAuthenticated);
  const entries = groups.flatMap((group) => group.entries);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  const activeEntry = entries.find((entry) => entry.id === activeId) ?? entries[0];
  const ActivePanel = activeEntry.Panel;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Tabs replace the page in place; a scrolled panel must not decide where the
  // next page starts.
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [activeId]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const dialog = dialogRef.current;
    const returnFocusTarget = returnFocusRef?.current ?? null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (event.isComposing) {
          return;
        }

        event.preventDefault();
        onCloseRef.current();
        return;
      }

      trapTabKey(event, dialog);
    };

    document.addEventListener('keydown', handleKeyDown);
    const previousElement = previouslyFocusedRef.current;

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const restoreTarget =
        returnFocusTarget ?? (previousElement?.isConnected ? previousElement : null);
      restoreTarget?.focus();
    };
  }, [returnFocusRef]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] pt-[env(safe-area-inset-top)] backdrop-blur-[2px] sm:items-center sm:pb-6 sm:pl-6 sm:pr-6 sm:pt-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
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
        className="relative flex h-full w-full flex-col overflow-hidden bg-background text-foreground sm:h-[min(49rem,calc(100dvh-3rem))] sm:max-w-[70rem] sm:flex-row sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={() => onCloseRef.current()}
          aria-label="Close settings"
          title="Close settings"
          className="absolute right-3 top-2 sm:right-6 sm:top-3.5 z-30 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors pointer-coarse:h-9 pointer-coarse:w-9 hover:bg-foreground/[0.06] hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Close size={16} />
        </button>

        <SettingsNav groups={groups} activeId={activeEntry.id} onSelect={setActiveId} />

        <div className="flex min-h-0 flex-1 flex-col">
          <div
            ref={bodyRef}
            className="flex-1 overflow-y-auto px-6 py-6 sm:px-14 md:px-16 sm:pb-8 sm:pt-7"
          >
            <div className="w-full max-w-[50rem]">
              <div className="mb-6 sm:mb-7">
                <h2
                  id={titleId}
                  className="text-[20px] font-semibold leading-tight tracking-[-0.01em]"
                >
                  {activeEntry.label}
                </h2>
                <p
                  id={descriptionId}
                  className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground"
                >
                  {activeEntry.description}
                </p>
              </div>

              <ActivePanel />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SettingsDialog({
  initialEntryId,
  onClose,
  returnFocusRef,
}: {
  initialEntryId?: SettingsEntryId | null;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  return (
    <Portal>
      <SettingsDialogSurface
        initialEntryId={initialEntryId}
        onClose={onClose}
        returnFocusRef={returnFocusRef}
      />
    </Portal>
  );
}
