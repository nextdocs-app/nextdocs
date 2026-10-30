'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ConfirmationModal } from '@/components/ConfirmationModal';
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
import { ApiError } from '@/services/api-client';
import { spaceApiService } from '@/services/space.service';
import type { DocumentIcon } from '@/types/document.types';
import type {
  Space,
  SpaceAccessMode,
  SpaceEveryoneAccessLevel,
  SpaceMember,
  SpaceUpdateInput,
} from '@/types/space.types';
import { SettingsRow, SettingsSection, SettingsValue } from '../SettingsPrimitives';
import { SpaceAccessFields } from './SpaceAccessFields';
import { SpaceMembersTab } from './SpaceMembersTab';
import {
  SPACE_LEVEL_LABELS,
  formatSpaceDate,
  spaceDocumentCountLabel,
  spaceMemberCountLabel,
  type SpaceNotice,
} from './space-access.util';

export type SpaceSettingsTab = 'general' | 'members';
type SpaceConfirmAction = 'archive' | 'delete';

/** How the everyone-else grant reads in a sentence. */
const EVERYONE_VERBS: Record<SpaceEveryoneAccessLevel, string> = {
  EDIT: 'edit',
  COMMENT: 'comment on',
  VIEW: 'read',
};

const SECONDARY_BUTTON_CLASS_NAME =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-2.5 py-1 text-[12.5px] font-medium text-foreground transition-colors hover:bg-foreground/[0.06] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

const DANGER_BUTTON_CLASS_NAME =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-destructive/30 bg-transparent px-2.5 py-1 text-[12.5px] font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function tabClassName(isActive: boolean): string {
  return `relative px-3 py-2 text-[14px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
    isActive
      ? 'text-foreground font-semibold after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[var(--nd-brand)]'
      : 'text-muted-foreground/70 font-medium hover:text-foreground'
  }`;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * One space's settings. Mounted only while open, so a visit always starts from
 * the space as the list last saw it. Every control saves itself — the same
 * contract as the General and People panels — and the panel is told about each
 * result so the list never has to be reloaded to stay honest.
 */
export function SpaceSettingsModal({
  space,
  initialTab = 'general',
  accessToken,
  selfId,
  onClose,
  onSpaceChange,
  onSpaceRemoved,
  onNotice,
}: {
  space: Space;
  /** Which tab to land on; the sidebar's member entry opens Members directly. */
  initialTab?: SpaceSettingsTab;
  accessToken: string;
  selfId: string | null;
  onClose: () => void;
  onSpaceChange: (space: Space) => void;
  onSpaceRemoved: (spaceId: string) => void;
  onNotice: (notice: SpaceNotice | null) => void;
}) {
  const [current, setCurrent] = useState(space);
  const [tab, setTab] = useState<SpaceSettingsTab>(initialTab);
  const [hasOpenedMembers, setHasOpenedMembers] = useState(initialTab === 'members');
  const [name, setName] = useState(space.name);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmAction, setConfirmAction] = useState<SpaceConfirmAction | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const generalTabRef = useRef<HTMLButtonElement>(null);
  const membersTabRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const committingNameRef = useRef<string | null>(null);
  const onCloseRef = useRef(onClose);
  const currentRef = useRef(current);

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const generalTabId = `${baseId}-tab-general`;
  const membersTabId = `${baseId}-tab-members`;
  const generalPanelId = `${baseId}-panel-general`;
  const membersPanelId = `${baseId}-panel-members`;

  const iconPanel = useAnchoredPanel({ width: PICKER_PANEL_WIDTH, align: 'left' });

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const dialog = dialogRef.current;

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      // A nested confirmation or the icon picker is portalled outside this
      // dialog and owns its own keys; Escape must close that first.
      if (event.defaultPrevented) {
        return;
      }

      const target = event.target;
      const owningDialog = target instanceof Element ? target.closest('[role="dialog"]') : null;
      if (owningDialog && owningDialog !== dialog) {
        return;
      }

      if (event.key === 'Escape') {
        if (event.isComposing) {
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

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = 0;
    }
  }, [tab]);

  const commitSpace = useCallback(
    (next: Space) => {
      setCurrent(next);
      onSpaceChange(next);
    },
    [onSpaceChange]
  );

  const applyUpdate = useCallback(
    async (patch: SpaceUpdateInput): Promise<Space> => {
      setIsSaving(true);
      setErrorText(null);
      try {
        const next = await spaceApiService.update(accessToken, currentRef.current.id, patch);
        commitSpace(next);
        return next;
      } catch (error) {
        setErrorText(messageFor(error, 'Could not save this space.'));
        throw error;
      } finally {
        setIsSaving(false);
      }
    },
    [accessToken, commitSpace]
  );

  // A failed update leaves `current` on the server value; the draft only has to
  // snap back for the field that was being edited.
  const handleNameCommit = () => {
    const trimmed = name.trim();
    // Enter commits and then blurs the input; the second call must not undo the
    // draft while the first request is still in flight.
    if (trimmed === committingNameRef.current) {
      return;
    }
    if (!trimmed || trimmed === current.name) {
      setName(current.name);
      return;
    }

    committingNameRef.current = trimmed;
    setName(trimmed);
    void applyUpdate({ name: trimmed })
      .catch(() => setName(currentRef.current.name))
      .finally(() => {
        if (committingNameRef.current === trimmed) {
          committingNameRef.current = null;
        }
      });
  };

  const handleIconChange = (icon: DocumentIcon | null) => {
    void applyUpdate({ icon: toIconRequestPayload(icon) }).catch(() => undefined);
  };

  const uploadSpaceIcon = useCallback(
    async (file: File) => {
      if (!accessToken) {
        throw new Error('Sign in to upload an image.');
      }

      return spaceApiService.uploadIcon(accessToken, file);
    },
    [accessToken]
  );

  const handleAccessChange = (next: {
    accessMode: SpaceAccessMode;
    everyoneAccessLevel: SpaceEveryoneAccessLevel;
  }) => {
    void applyUpdate({
      accessMode: next.accessMode,
      everyoneAccessLevel: next.everyoneAccessLevel,
    }).catch(() => undefined);
  };

  const handleRosterChange = useCallback(
    (roster: SpaceMember[]) => {
      const previous = currentRef.current;
      if (previous.memberCount === roster.length) {
        return;
      }

      const next = { ...previous, memberCount: roster.length };
      setCurrent(next);
      onSpaceChange(next);
    },
    [onSpaceChange]
  );

  /**
   * The caller changed their own membership row: their level, and possibly
   * their right to administer this space, moved with it. Reload the space so
   * the controls retire, and drop it entirely when they can no longer read it.
   */
  const refreshSpace = useCallback(async () => {
    try {
      const next = await spaceApiService.get(accessToken, currentRef.current.id);
      commitSpace(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        onSpaceRemoved(currentRef.current.id);
        onCloseRef.current();
        return;
      }

      setErrorText(messageFor(error, 'Could not reload this space.'));
    }
  }, [accessToken, commitSpace, onSpaceRemoved]);

  const handleRestore = async () => {
    setIsRestoring(true);
    setErrorText(null);
    try {
      const next = await spaceApiService.restore(accessToken, current.id);
      commitSpace(next);
      onNotice({ kind: 'status', message: `${next.name} was restored.` });
    } catch (error) {
      setErrorText(messageFor(error, 'Could not restore this space.'));
    } finally {
      setIsRestoring(false);
    }
  };

  const handleArchive = async () => {
    setIsConfirming(true);
    setErrorText(null);
    try {
      const next = await spaceApiService.archive(accessToken, current.id);
      onSpaceChange(next);
      onNotice({ kind: 'status', message: `${next.name} was archived.` });
      onClose();
    } catch (error) {
      setErrorText(messageFor(error, 'Could not archive this space.'));
    } finally {
      setIsConfirming(false);
      setConfirmAction(null);
    }
  };

  const handleDelete = async () => {
    setIsConfirming(true);
    setErrorText(null);
    try {
      await spaceApiService.remove(accessToken, current.id);
      onSpaceRemoved(current.id);
      onNotice({ kind: 'status', message: `${current.name} was deleted.` });
      onClose();
    } catch (error) {
      setErrorText(messageFor(error, 'Could not delete this space.'));
    } finally {
      setIsConfirming(false);
      setConfirmAction(null);
    }
  };

  const selectTab = (next: SpaceSettingsTab) => {
    setTab(next);
    if (next === 'members') {
      setHasOpenedMembers(true);
    }
    (next === 'general' ? generalTabRef : membersTabRef).current?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    selectTab(tab === 'general' ? 'members' : 'general');
  };

  const canEdit = current.canAdminister && !current.archivedAt;
  const tile = workspaceIconTileStyle(current.icon ?? null);
  const archiveDate = formatSpaceDate(current.archivedAt);
  const createdDate = formatSpaceDate(current.createdAt);
  const everyoneCan = EVERYONE_VERBS[current.everyoneAccessLevel];
  const hasDocuments = current.pageCount > 0;
  const deleteDescription = hasDocuments
    ? 'Only an empty space can be deleted. Permanently delete every document in it first, including documents in trash — or archive the space instead.'
    : 'Delete this empty space permanently. This cannot be undone.';

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !isSaving && !isRestoring && !isConfirming) {
            onCloseRef.current();
          }
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-busy={isSaving || isRestoring}
          tabIndex={-1}
          style={{ overscrollBehavior: 'contain' }}
          className="relative flex max-h-[calc(100dvh-2rem)] w-full max-w-[560px] flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl animate-in fade-in-0 zoom-in-95 duration-150"
        >
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => onCloseRef.current()}
            aria-label="Close space settings"
            title="Close space settings"
            className="absolute right-3 top-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Close size={16} />
          </button>

          <div className="flex flex-shrink-0 items-start gap-3 px-6 pb-4 pt-5 pr-14">
            <button
              ref={iconPanel.triggerRef}
              type="button"
              onClick={iconPanel.toggle}
              disabled={!canEdit}
              aria-label={current.icon ? 'Change space icon' : 'Add a space icon'}
              aria-haspopup="dialog"
              aria-expanded={iconPanel.isOpen}
              style={tile.style}
              className={`group relative flex h-[52px] w-[52px] flex-shrink-0 items-center justify-center overflow-hidden rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring enabled:cursor-pointer disabled:cursor-default ${tile.className}`}
            >
              <span className="inline-flex h-full w-full items-center justify-center overflow-hidden rounded-lg">
                <WorkspaceIconTile
                  icon={current.icon ?? null}
                  size={52}
                  accessToken={accessToken}
                  fallback="space"
                />
              </span>
              {canEdit ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                >
                  <Pencil size={16} strokeWidth={2} />
                </span>
              ) : null}
            </button>

            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="flex min-w-0 items-center px-1 py-0.5">
                {canEdit ? (
                  // A hidden copy sizes the field to the name; the pencil sits inside it.
                  <span className="relative min-w-0 max-w-full">
                    <span
                      aria-hidden="true"
                      className="invisible block overflow-hidden whitespace-pre border border-transparent py-0 pl-0 pr-6 text-[20px] font-semibold leading-tight tracking-[-0.01em]"
                    >
                      {name || 'Space name'}
                    </span>
                    <input
                      type="text"
                      value={name}
                      maxLength={255}
                      readOnly={isSaving}
                      onChange={(event) => setName(event.target.value)}
                      onBlur={handleNameCommit}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          handleNameCommit();
                          event.currentTarget.blur();
                        }
                      }}
                      aria-label="Space name"
                      placeholder="Space name"
                      className="absolute inset-0 w-full min-w-0 rounded-sm border border-transparent bg-transparent py-0 pl-0 pr-6 text-[20px] font-semibold leading-tight tracking-[-0.01em] text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 focus-visible:border-border focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <Pencil
                      size={13}
                      aria-hidden="true"
                      className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground/70"
                    />
                  </span>
                ) : (
                  <span className="truncate px-0 text-[20px] font-semibold leading-tight tracking-[-0.01em]">
                    {current.name}
                  </span>
                )}
              </h2>
              <p className="mt-1 px-1 text-[12.5px] leading-snug text-muted-foreground">
                {spaceMemberCountLabel(current.memberCount)} ·{' '}
                {spaceDocumentCountLabel(current.pageCount)}
                {archiveDate ? ` · Archived ${archiveDate}` : ''}
              </p>
            </div>
          </div>

          {current.archivedAt ? (
            <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-y border-border bg-muted/40 px-6 py-2.5">
              <p className="text-[12.5px] leading-snug text-muted-foreground">
                This space is archived: documents are read-only until it is restored.
              </p>
              {current.canAdminister ? (
                <button
                  type="button"
                  onClick={() => void handleRestore()}
                  disabled={isRestoring}
                  className={SECONDARY_BUTTON_CLASS_NAME}
                >
                  {isRestoring ? 'Restoring…' : 'Restore space'}
                </button>
              ) : null}
            </div>
          ) : null}

          <div
            role="tablist"
            aria-label="Space settings"
            onKeyDown={handleTabKeyDown}
            className="flex flex-shrink-0 select-none items-center gap-1 border-b border-border px-6"
          >
            <button
              ref={generalTabRef}
              type="button"
              role="tab"
              id={generalTabId}
              aria-controls={generalPanelId}
              aria-selected={tab === 'general'}
              tabIndex={tab === 'general' ? 0 : -1}
              onClick={() => selectTab('general')}
              className={tabClassName(tab === 'general')}
            >
              General
            </button>
            <button
              ref={membersTabRef}
              type="button"
              role="tab"
              id={membersTabId}
              aria-controls={membersPanelId}
              aria-selected={tab === 'members'}
              tabIndex={tab === 'members' ? 0 : -1}
              onClick={() => selectTab('members')}
              className={tabClassName(tab === 'members')}
            >
              Members
            </button>
          </div>

          <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {errorText ? (
              <p role="alert" className="mb-4 text-[12.5px] leading-snug text-destructive">
                {errorText}
              </p>
            ) : null}

            <div
              id={generalPanelId}
              role="tabpanel"
              aria-labelledby={generalTabId}
              hidden={tab !== 'general'}
              className="flex flex-col gap-6"
            >
              <SettingsSection title="Who can open this space">
                <div className="py-3.5">
                  <SpaceAccessFields
                    accessMode={current.accessMode}
                    everyoneAccessLevel={current.everyoneAccessLevel}
                    disabled={!canEdit || isSaving}
                    onChange={handleAccessChange}
                  />
                </div>
                <p className="border-t border-border py-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
                  {current.accessMode === 'PUBLIC'
                    ? `Every workspace member can ${everyoneCan} the documents in this space. People listed in Members keep their level.`
                    : 'Only the people listed in Members can open the documents in this space.'}
                </p>
              </SettingsSection>

              <SettingsSection title="Details">
                <SettingsRow
                  label="Your access"
                  description="What you can do in this space."
                  control={
                    <SettingsValue>
                      {current.myAccessLevel
                        ? SPACE_LEVEL_LABELS[current.myAccessLevel]
                        : 'Workspace admin'}
                    </SettingsValue>
                  }
                />
                <SettingsRow
                  label="Created"
                  control={<SettingsValue>{createdDate ?? 'Unknown'}</SettingsValue>}
                />
              </SettingsSection>

              {current.canAdminister ? (
                <SettingsSection title="Manage space">
                  {current.archivedAt ? null : (
                    <SettingsRow
                      label="Archive space"
                      description="Hide it from navigation and make it read-only. Documents, members, and access rules stay."
                      control={
                        <button
                          type="button"
                          onClick={() => setConfirmAction('archive')}
                          className={SECONDARY_BUTTON_CLASS_NAME}
                        >
                          Archive
                        </button>
                      }
                    />
                  )}
                  <SettingsRow
                    label="Delete space"
                    description={deleteDescription}
                    control={
                      <button
                        type="button"
                        onClick={() => setConfirmAction('delete')}
                        disabled={hasDocuments}
                        className={DANGER_BUTTON_CLASS_NAME}
                      >
                        Delete
                      </button>
                    }
                  />
                </SettingsSection>
              ) : (
                <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                  Only the space owner or a workspace admin can change who can open this space.
                </p>
              )}
            </div>

            {hasOpenedMembers ? (
              <div
                id={membersPanelId}
                role="tabpanel"
                aria-labelledby={membersTabId}
                hidden={tab !== 'members'}
              >
                <SpaceMembersTab
                  space={current}
                  accessToken={accessToken}
                  selfId={selfId}
                  onRosterChange={handleRosterChange}
                  onSelfMembershipChange={() => void refreshSpace()}
                  onNotice={onNotice}
                />
              </div>
            ) : null}
          </div>
        </div>

        {canEdit && iconPanel.isOpen ? (
          <IconPickerPanel
            icon={current.icon ?? undefined}
            accessToken={accessToken}
            canUpload
            panelRef={iconPanel.panelRef}
            uploadFile={uploadSpaceIcon}
            panelStyle={iconPanel.panelStyle}
            label="Choose a space icon"
            onSelect={(next) => {
              handleIconChange(next);
              iconPanel.close();
            }}
            onRemove={() => {
              handleIconChange(null);
              iconPanel.close();
            }}
            onClose={iconPanel.close}
          />
        ) : null}

        <ConfirmationModal
          isOpen={confirmAction === 'archive'}
          title={`Archive ${current.name}?`}
          description="It disappears from navigation and becomes read-only. Documents, members, and access rules stay as they are, and you can restore it later."
          confirmLabel="Archive"
          isConfirming={isConfirming}
          onConfirm={() => void handleArchive()}
          onCancel={() => {
            if (!isConfirming) {
              setConfirmAction(null);
            }
          }}
        />

        <ConfirmationModal
          isOpen={confirmAction === 'delete'}
          title={`Delete ${current.name}?`}
          description="The space is removed permanently. This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
          isConfirming={isConfirming}
          onConfirm={() => void handleDelete()}
          onCancel={() => {
            if (!isConfirming) {
              setConfirmAction(null);
            }
          }}
        />
      </div>
    </Portal>
  );
}
