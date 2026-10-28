'use client';

import { useCallback, useEffect, useState } from 'react';
import { Workspace as WorkspaceGlyph } from '@/icons';
import { IconPickerPanel } from '@/components/page/IconPickerPanel';
import { PageIcon } from '@/components/page/PageIcon';
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

function iconKey(icon: DocumentIcon | null): string {
  return icon ? `${icon.type}:${icon.value}:${icon.color ?? ''}` : '';
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

const INPUT_CLASS_NAME =
  'h-9 w-full rounded-md border border-border bg-transparent px-3 py-1.5 text-[13px] shadow-xs transition-colors placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-64';

const BUTTON_CLASS_NAME =
  'inline-flex h-8 flex-shrink-0 items-center justify-center rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

export function WorkspaceGeneralPanel() {
  const { isAuthenticated, isInitializing, accessToken } = useAuth();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<DocumentIcon | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

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
  const trimmedName = name.trim();
  const nameChanged = trimmedName !== workspace.name;
  const iconChanged = iconKey(icon) !== iconKey(workspace.icon);
  const isDirty = nameChanged || iconChanged;
  const canSave = canEdit && isDirty && trimmedName.length > 0 && !isSaving;

  const handleSave = async () => {
    if (!accessToken || !canSave) {
      return;
    }

    const patch: WorkspaceUpdateInput = {};
    if (nameChanged) {
      patch.name = trimmedName;
    }
    if (iconChanged) {
      patch.icon = toIconRequestPayload(icon);
    }

    setIsSaving(true);
    setSaveError(null);
    setStatus(null);
    try {
      const next = await workspaceApiService.updateCurrent(accessToken, patch);
      setWorkspace(next);
      setName(next.name);
      setIcon(next.icon ?? null);
      setStatus('Workspace saved.');
      dispatchWorkspaceUpdated(next);
    } catch (error) {
      setSaveError(messageFor(error, 'Could not save the workspace.'));
      if (error instanceof ApiError && error.status === 403) {
        // The caller's role changed while the panel was open. Reload so the
        // controls retire instead of offering a save that cannot succeed.
        setReloadKey((key) => key + 1);
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Workspace"
        description="This identity appears at the top of the sidebar for everyone in the workspace."
      >
        <SettingsRow
          label="Workspace icon"
          description="An emoji, a built-in icon, an image link, or an uploaded image."
          control={
            <div className="flex items-center gap-2">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-[var(--nd-placeholder-bg)] text-[var(--nd-placeholder-fg)]">
                {icon ? (
                  <PageIcon
                    icon={icon}
                    size={32}
                    accessToken={accessToken}
                    label="Workspace icon"
                  />
                ) : (
                  <WorkspaceGlyph size={22} aria-hidden="true" />
                )}
              </span>
              {canEdit ? (
                <>
                  <button
                    type="button"
                    onClick={() => setIsPickerOpen((open) => !open)}
                    aria-expanded={isPickerOpen}
                    className={`${BUTTON_CLASS_NAME} border border-border hover:bg-foreground/[0.06]`}
                  >
                    {icon ? 'Change' : 'Add icon'}
                  </button>
                  {icon ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIcon(null);
                        setStatus(null);
                        setSaveError(null);
                      }}
                      className={`${BUTTON_CLASS_NAME} text-muted-foreground hover:text-destructive`}
                    >
                      Remove
                    </button>
                  ) : null}
                </>
              ) : null}
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
                  setStatus(null);
                  setSaveError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canSave) {
                    event.preventDefault();
                    void handleSave();
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

        {canEdit && isPickerOpen ? (
          <div className="border-t border-border py-3.5">
            <IconPickerPanel
              icon={icon ?? undefined}
              accessToken={accessToken}
              canUpload
              inline
              label="Choose a workspace icon"
              uploadFile={uploadWorkspaceIcon}
              onSelect={(next) => {
                setIcon(next);
                setStatus(null);
                setSaveError(null);
              }}
              onRemove={() => {
                setIcon(null);
                setStatus(null);
                setSaveError(null);
              }}
              onClose={() => setIsPickerOpen(false)}
            />
          </div>
        ) : null}

        {canEdit ? (
          <div className="flex flex-col gap-2 border-t border-border py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <p
              role={saveError ? 'alert' : undefined}
              className={`text-[12.5px] leading-snug ${
                saveError ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {saveError ?? status ?? 'Changes are visible to everyone in the workspace.'}
            </p>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canSave}
              className={`${BUTTON_CLASS_NAME} bg-foreground text-background hover:opacity-90 sm:self-auto`}
            >
              {isSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        ) : (
          <p className="border-t border-border py-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Only the workspace owner can change the name and icon. You can still see everyone in the
            People page.
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
