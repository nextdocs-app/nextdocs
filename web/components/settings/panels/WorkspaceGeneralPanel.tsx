'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil } from '@/icons';
import { IconPickerPanel } from '@/components/page/IconPickerPanel';
import { PICKER_PANEL_WIDTH } from '@/components/page/PickerShell';
import {
  WorkspaceIconTile,
  workspaceIconTileStyle,
} from '@/components/workspace/WorkspaceIconTile';
import { useAnchoredPanel } from '@/hooks/useAnchoredPanel.hook';
import { useAuth } from '@/hooks/useAuth.hook';
import { toIconRequestPayload } from '@/lib/document-icon.util';
import { dispatchWorkspaceUpdated } from '@/lib/workspace-event.util';
import { ApiError } from '@/services/api-client';
import { workspaceApiService } from '@/services/workspace.service';
import type { DocumentIcon } from '@/types/document.types';
import type { Workspace, WorkspaceUpdateInput } from '@/types/workspace.types';
import { SettingsRow, SettingsSection, SettingsValue } from '../SettingsPrimitives';
import { workspaceRoleLabel } from '../workspace/workspace-role.util';
import {
  WorkspacePanelError,
  WorkspacePanelLoading,
  WorkspacePanelSignedOut,
} from '../workspace/WorkspacePanelStates';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function iconKey(icon: DocumentIcon | null | undefined): string {
  return icon ? `${icon.type}:${icon.value}:${icon.color ?? ''}` : '';
}

const INPUT_CLASS_NAME =
  'h-9 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-[13px] shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-64';

/** The draft a failed save should put back, when that draft is still on screen. */
interface SaveRevert {
  name?: string;
  icon?: DocumentIcon | null;
}

export function WorkspaceGeneralPanel() {
  const { isAuthenticated, isInitializing, accessToken } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<DocumentIcon | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const iconPanel = useAnchoredPanel({ width: PICKER_PANEL_WIDTH, align: 'left' });

  const workspaceRef = useRef<Workspace | null>(null);

  useEffect(() => {
    workspaceRef.current = workspace;
  }, [workspace]);

  const committingNameRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingSavesRef = useRef(0);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    workspaceApiService
      .getCurrent(accessToken, controller.signal)
      .then((next) => {
        if (cancelled) {
          return;
        }

        setWorkspace(next);
        setName(next.name);
        setIcon(next.icon ?? null);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setLoadError(messageFor(error, 'Could not load the workspace.'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isAuthenticated, accessToken, reloadKey]);

  const uploadWorkspaceIcon = useCallback(
    async (file: File) => {
      if (!accessToken) {
        throw new Error('Sign in to upload an image.');
      }

      return workspaceApiService.uploadIcon(accessToken, file);
    },
    [accessToken]
  );

  const retry = () => {
    setIsLoading(true);
    setLoadError(null);
    setReloadKey((key) => key + 1);
  };

  /**
   * Queues a workspace patch. Requests run one at a time so an older response can
   * never land on top of a newer one, and the response updates only the server
   * copy — never the drafts being edited. A failure puts back the value this
   * request sent, and only while that value is still what the user sees.
   */
  const enqueueSave = useCallback(
    (patch: WorkspaceUpdateInput, revert?: SaveRevert) => {
      const current = workspaceRef.current;
      if (!accessToken || !current || current.role !== 'OWNER') {
        return Promise.resolve();
      }

      pendingSavesRef.current += 1;
      setIsSaving(true);
      setSaveError(null);

      const task = saveQueueRef.current
        .then(async () => {
          const next = await workspaceApiService.updateCurrent(accessToken, patch);
          setWorkspace(next);
          dispatchWorkspaceUpdated(next);
        })
        .catch((error: unknown) => {
          setSaveError(messageFor(error, 'Could not save the workspace.'));
          if (revert?.name !== undefined) {
            setName((draft) =>
              draft.trim() === revert.name ? (workspaceRef.current?.name ?? draft) : draft
            );
          }
          if (revert && 'icon' in revert) {
            setIcon((draft) =>
              iconKey(draft) === iconKey(revert.icon) ? (workspaceRef.current?.icon ?? null) : draft
            );
          }
          if (error instanceof ApiError && error.status === 403) {
            // The caller's role changed while the panel was open. Reload so the
            // controls retire instead of offering a save that cannot succeed.
            setReloadKey((key) => key + 1);
          }
        })
        .finally(() => {
          pendingSavesRef.current -= 1;
          if (pendingSavesRef.current === 0) {
            setIsSaving(false);
          }
        });

      saveQueueRef.current = task;
      return task;
    },
    [accessToken]
  );

  if (isInitializing) {
    return <WorkspacePanelLoading label="Loading account…" />;
  }

  if (!isAuthenticated) {
    return <WorkspacePanelSignedOut />;
  }

  if (isLoading && !workspace) {
    return <WorkspacePanelLoading />;
  }

  if (loadError && !workspace) {
    return <WorkspacePanelError message={loadError} onRetry={retry} />;
  }

  if (!workspace) {
    return (
      <WorkspacePanelError message="You are not a member of this workspace." onRetry={retry} />
    );
  }

  const canEdit = workspace.role === 'OWNER';
  const tile = workspaceIconTileStyle(icon);

  const handleNameCommit = () => {
    const current = workspaceRef.current;
    if (!current || current.role !== 'OWNER') {
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setName(current.name);
      return;
    }
    if (trimmed === current.name || trimmed === committingNameRef.current) {
      return;
    }
    committingNameRef.current = trimmed;
    void enqueueSave({ name: trimmed }, { name: trimmed }).finally(() => {
      if (committingNameRef.current === trimmed) {
        committingNameRef.current = null;
      }
    });
  };

  const handleIconChange = (nextIcon: DocumentIcon | null) => {
    setIcon(nextIcon);
    void enqueueSave({ icon: toIconRequestPayload(nextIcon) }, { icon: nextIcon });
  };

  return (
    <div className="flex flex-col gap-6" aria-busy={isSaving}>
      <SettingsSection title="Workspace">
        <SettingsRow
          label="Workspace icon"
          description="An emoji, a built-in icon, an image link, or an uploaded image."
          control={
            <div className="flex items-center gap-2">
              {canEdit ? (
                <button
                  type="button"
                  ref={iconPanel.triggerRef}
                  onClick={iconPanel.toggle}
                  aria-label={icon ? 'Change workspace icon' : 'Add icon'}
                  aria-haspopup="dialog"
                  aria-expanded={iconPanel.isOpen}
                  title={icon ? 'Change workspace icon' : 'Add icon'}
                  style={tile.style}
                  className={`group relative flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${tile.className}`}
                >
                  <span className="inline-flex h-full w-full items-center justify-center overflow-hidden rounded-md">
                    <WorkspaceIconTile icon={icon} size={40} accessToken={accessToken} />
                  </span>
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 flex items-center justify-center rounded-md bg-black/45 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                  >
                    <Pencil size={16} strokeWidth={2} />
                  </span>
                </button>
              ) : (
                <span
                  style={tile.style}
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md ${tile.className}`}
                >
                  <WorkspaceIconTile icon={icon} size={40} accessToken={accessToken} />
                </span>
              )}
            </div>
          }
        />

        <SettingsRow
          label="Workspace name"
          description="Shown in the sidebar and in invitation emails."
          control={
            canEdit ? (
              <input
                type="text"
                value={name}
                maxLength={255}
                onChange={(event) => {
                  setName(event.target.value);
                  setSaveError(null);
                }}
                onBlur={handleNameCommit}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleNameCommit();
                    event.currentTarget.blur();
                  }
                }}
                placeholder="Workspace name"
                aria-label="Workspace name"
                className={INPUT_CLASS_NAME}
              />
            ) : (
              <SettingsValue>{workspace.name}</SettingsValue>
            )
          }
        />

        <SettingsRow
          label="Your role"
          description="Your role controls what you can change in this workspace."
          control={<SettingsValue>{workspaceRoleLabel(workspace.role)}</SettingsValue>}
        />

        {saveError ? (
          <p
            role="alert"
            className="border-t border-border py-3.5 text-[12.5px] leading-snug text-destructive"
          >
            {saveError}
          </p>
        ) : null}

        {!canEdit ? (
          <p className="border-t border-border py-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Only the workspace owner can change the name and icon. You can still see everyone in the
            People page.
          </p>
        ) : null}
      </SettingsSection>

      {canEdit && iconPanel.isOpen ? (
        <IconPickerPanel
          icon={icon ?? undefined}
          accessToken={accessToken}
          canUpload
          panelRef={iconPanel.panelRef}
          panelStyle={iconPanel.panelStyle}
          label="Choose a workspace icon"
          uploadFile={uploadWorkspaceIcon}
          onSelect={(next) => {
            void handleIconChange(next);
            iconPanel.close();
          }}
          onRemove={() => {
            void handleIconChange(null);
            iconPanel.close();
          }}
          onClose={iconPanel.close}
        />
      ) : null}
    </div>
  );
}
