'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useAuth } from '@/hooks/useAuth.hook';
import { ChevronRight, Plus, Spaces as SpacesGlyph } from '@/icons';
import { spaceApiService } from '@/services/space.service';
import { dispatchSpacesUpdated } from '@/lib/spaces-event.util';
import { insertSpaceByPersonalOrder } from '@/lib/space-order.util';
import type { Space } from '@/types/space.types';
import {
  WorkspaceIconTile,
  workspaceIconTileStyle,
} from '@/components/workspace/WorkspaceIconTile';
import { CreateSpaceModal } from '../workspace/CreateSpaceModal';
import { SpaceSettingsModal } from '../workspace/SpaceSettingsModal';
import {
  WorkspacePanelError,
  WorkspacePanelLoading,
  WorkspacePanelSignedOut,
} from '../workspace/WorkspacePanelStates';
import {
  SPACE_ACCESS_MODE_LABELS,
  formatSpaceDate,
  spaceDocumentCountLabel,
  spaceMemberCountLabel,
  type SpaceNotice,
} from '../workspace/space-access.util';

type SpacesTab = 'active' | 'archived';

const NEW_SPACE_BUTTON_CLASS_NAME =
  'inline-flex items-center gap-1.5 rounded-md bg-[var(--nd-brand)] px-2.5 py-1 text-[12.5px] font-medium text-[var(--nd-brand-foreground)] shadow-xs transition-colors hover:bg-[var(--nd-brand-hover)] active:bg-[var(--nd-brand-active)] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function tabClassName(isActive: boolean): string {
  return `relative px-3 py-2 text-[14px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
    isActive
      ? 'text-foreground font-semibold after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-[var(--nd-brand)]'
      : 'text-muted-foreground/70 font-medium hover:text-foreground'
  }`;
}

const ACCESS_CHIP_CLASS_NAME =
  'inline-flex max-w-[12rem] flex-shrink-0 items-center truncate rounded border border-border bg-muted px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-muted-foreground';

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function SpaceRow({
  space,
  accessToken,
  onOpen,
}: {
  space: Space;
  accessToken: string | null;
  onOpen: (space: Space) => void;
}) {
  const tile = workspaceIconTileStyle(space.icon ?? null);
  const created = formatSpaceDate(space.createdAt);
  const archivedAt = formatSpaceDate(space.archivedAt);
  const meta = [
    spaceMemberCountLabel(space.memberCount),
    spaceDocumentCountLabel(space.pageCount),
    archivedAt ? `Archived ${archivedAt}` : created ? `Created ${created}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(space)}
        aria-label={`Open settings for ${space.name}`}
        className="group flex w-full items-center gap-3 rounded-md px-1 py-3 text-left transition-colors hover:bg-muted/40 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span
          style={tile.style}
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-md ${tile.className}`}
        >
          <WorkspaceIconTile
            icon={space.icon ?? null}
            size={32}
            accessToken={accessToken}
            fallback="space"
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium leading-snug">{space.name}</span>
            <span className={ACCESS_CHIP_CLASS_NAME}>
              {SPACE_ACCESS_MODE_LABELS[space.accessMode]}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[12px] leading-snug text-muted-foreground/70">
            {meta}
          </span>
        </span>

        <ChevronRight
          size={15}
          aria-hidden="true"
          className="flex-shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </li>
  );
}

function SpacesEmptyState({ tab, onCreate }: { tab: SpacesTab; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <SpacesGlyph size={24} />
      </span>
      <h3 className="text-[15px] font-medium text-foreground">
        {tab === 'active' ? 'No spaces yet' : 'Nothing archived'}
      </h3>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
        {tab === 'active'
          ? 'A space collects related documents and decides who can open them.'
          : 'Spaces you archive land here, so you can restore them later.'}
      </p>
      {tab === 'active' ? (
        <button type="button" onClick={onCreate} className={`mt-4 ${NEW_SPACE_BUTTON_CLASS_NAME}`}>
          <Plus size={13} strokeWidth={2.5} />
          <span>Create a space</span>
        </button>
      ) : null}
    </div>
  );
}

/**
 * The Spaces settings panel. Any workspace member can create a space; the list is what the
 * API lets the caller see — their memberships plus every public space, or the
 * whole workspace for an owner or admin. Converting a row opens that space's
 * own settings popup, which is where its access, members, and archive state
 * live, so this panel stays a list.
 */
export function WorkspaceSpacesPanel() {
  const { isAuthenticated, isInitializing, accessToken, user } = useAuth();
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [archivedSpaces, setArchivedSpaces] = useState<Space[]>([]);
  const [tab, setTab] = useState<SpacesTab>('active');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<SpaceNotice | null>(null);
  const [selected, setSelected] = useState<Space | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const archivedTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const archived = tab === 'archived';
    setIsLoading(true);

    spaceApiService
      .list(accessToken, { archived, signal: controller.signal })
      .then((list) => {
        if (cancelled) {
          return;
        }

        if (archived) {
          setArchivedSpaces(list);
        } else {
          setSpaces(list);
        }
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (!cancelled && !controller.signal.aborted) {
          setLoadError(
            messageFor(
              error,
              archived ? 'Could not load archived spaces.' : 'Could not load spaces.'
            )
          );
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
  }, [isAuthenticated, accessToken, tab, reloadKey]);

  const retry = () => {
    setLoadError(null);
    setReloadKey((key) => key + 1);
  };

  /**
   * One write landed. The modal owns the edited copy, so this only reconciles
   * the lists: an archived space leaves the active tab, a restored one comes
   * back at its personal position.
   */
  const handleSpaceChange = useCallback((next: Space) => {
    setSelected((previous) => (previous && previous.id === next.id ? next : previous));

    setSpaces((previous) => {
      if (next.archivedAt) {
        return previous.filter((space) => space.id !== next.id);
      }

      const exists = previous.some((space) => space.id === next.id);
      return exists
        ? previous.map((space) => (space.id === next.id ? next : space))
        : insertSpaceByPersonalOrder(previous, next);
    });

    setArchivedSpaces((previous) => {
      const exists = previous.some((space) => space.id === next.id);

      if (!next.archivedAt) {
        return previous.filter((space) => space.id !== next.id);
      }

      return exists
        ? previous.map((space) => (space.id === next.id ? next : space))
        : [next, ...previous];
    });

    dispatchSpacesUpdated();
  }, []);

  const handleSpaceRemoved = useCallback((spaceId: string) => {
    setSpaces((previous) => previous.filter((space) => space.id !== spaceId));
    setArchivedSpaces((previous) => previous.filter((space) => space.id !== spaceId));
    setSelected((previous) => (previous?.id === spaceId ? null : previous));
    dispatchSpacesUpdated();
  }, []);

  const handleCreated = (space: Space) => {
    setTab('active');
    setSpaces((previous) => insertSpaceByPersonalOrder(previous, space));
    setIsCreateOpen(false);
    dispatchSpacesUpdated();
  };

  const selectTab = (next: SpacesTab) => {
    setTab(next);
    (next === 'active' ? activeTabRef : archivedTabRef).current?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    selectTab(tab === 'active' ? 'archived' : 'active');
  };

  if (isInitializing) {
    return <WorkspacePanelLoading label="Loading account…" />;
  }

  if (!isAuthenticated) {
    return <WorkspacePanelSignedOut />;
  }

  const visibleSpaces = tab === 'active' ? spaces : archivedSpaces;

  return (
    <div className="flex flex-col gap-6">
      {loadError && visibleSpaces.length > 0 ? (
        <p role="alert" className="text-[12.5px] leading-snug text-destructive">
          {loadError}
        </p>
      ) : null}

      {notice ? (
        <p
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={`text-[12.5px] leading-snug ${
            notice.kind === 'error' ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {notice.message}
        </p>
      ) : null}

      <section aria-busy={isLoading}>
        <div className="flex items-center justify-between border-b border-border pb-0">
          <div
            role="tablist"
            aria-label="Spaces"
            onKeyDown={handleTabKeyDown}
            className="flex select-none items-center gap-1"
          >
            <button
              ref={activeTabRef}
              type="button"
              role="tab"
              id="tab-spaces-active"
              aria-controls="panel-spaces-active"
              aria-selected={tab === 'active'}
              tabIndex={tab === 'active' ? 0 : -1}
              onClick={() => selectTab('active')}
              className={tabClassName(tab === 'active')}
            >
              Active
            </button>
            <button
              ref={archivedTabRef}
              type="button"
              role="tab"
              id="tab-spaces-archived"
              aria-controls="panel-spaces-archived"
              aria-selected={tab === 'archived'}
              tabIndex={tab === 'archived' ? 0 : -1}
              onClick={() => selectTab('archived')}
              className={tabClassName(tab === 'archived')}
            >
              Archived
            </button>
          </div>

          <div className="pb-1.5">
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className={NEW_SPACE_BUTTON_CLASS_NAME}
            >
              <Plus size={13} strokeWidth={2.5} />
              <span>New space</span>
            </button>
          </div>
        </div>

        <div
          id={tab === 'active' ? 'panel-spaces-active' : 'panel-spaces-archived'}
          role="tabpanel"
          aria-labelledby={tab === 'active' ? 'tab-spaces-active' : 'tab-spaces-archived'}
          className="flex flex-col pt-1"
        >
          {isLoading && visibleSpaces.length === 0 ? (
            <p className="py-6 text-[13px] text-muted-foreground">
              {tab === 'active' ? 'Loading spaces…' : 'Loading archived spaces…'}
            </p>
          ) : loadError && visibleSpaces.length === 0 ? (
            <div className="py-4">
              <WorkspacePanelError message={loadError} onRetry={retry} />
            </div>
          ) : visibleSpaces.length === 0 ? (
            <div className="py-4">
              <SpacesEmptyState tab={tab} onCreate={() => setIsCreateOpen(true)} />
            </div>
          ) : (
            <ul className="m-0 flex list-none flex-col divide-y divide-border/60 p-0">
              {visibleSpaces.map((space) => (
                <SpaceRow
                  key={space.id}
                  space={space}
                  accessToken={accessToken}
                  onOpen={setSelected}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {selected ? (
        <SpaceSettingsModal
          space={selected}
          accessToken={accessToken ?? ''}
          selfId={user?.id ?? null}
          onClose={() => setSelected(null)}
          onSpaceChange={handleSpaceChange}
          onSpaceRemoved={handleSpaceRemoved}
          onNotice={setNotice}
        />
      ) : null}

      {isCreateOpen ? (
        <CreateSpaceModal
          isOpen
          accessToken={accessToken ?? ''}
          onClose={() => setIsCreateOpen(false)}
          onCreated={handleCreated}
          onNotice={setNotice}
        />
      ) : null}
    </div>
  );
}
