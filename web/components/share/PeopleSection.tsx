'use client';

import { useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ReactReduxContext } from 'react-redux';
import { ChevronRight, DocumentText, Layers, Lock } from '@/icons';
import { PageIcon } from '@/components/page/PageIcon';
import { workspaceIconTileStyle } from '@/components/workspace/WorkspaceIconTile';
import type {
  Collaborator,
  DocumentBreadcrumbItem,
  DocumentSpaceSummary,
} from '@/services/document.service';
import type { DocumentIcon } from '@/types/document.types';
import type { RootState } from '@/stores/store';
import { CollaboratorRow } from './CollaboratorRow';
import { getPersonDetail, type PeopleGroup, type PeopleGroupKind } from './peopleGroups';
import type { CollaboratorDropdownValue } from './shareOptions';

interface PeopleSectionProps {
  pinned: Collaborator | null;
  flat: Collaborator[];
  groups: PeopleGroup[];
  canManageSharing: boolean;
  currentUserId?: string | null;
  spaceId?: string | null;
  documentSpace?: DocumentSpaceSummary | null;
  breadcrumbs?: DocumentBreadcrumbItem[];
  accessToken?: string | null;
  resolveIcon?: (sourceId: string | null, kind: PeopleGroupKind) => DocumentIcon | null | undefined;
  hasEffectivePublicLink: boolean;
  effectiveLinkAction: string;
  recentlyAddedUserIds: ReadonlySet<string>;
  onAccessSelect: (collab: Collaborator, value: CollaboratorDropdownValue) => void;
  onNavigate: (documentId: string) => void;
}

function findIconInState(
  state: RootState | undefined,
  sourceId: string | null,
  kind: PeopleGroupKind
): DocumentIcon | null | undefined {
  if (!state || !sourceId) return undefined;

  if (kind === 'space') {
    const spaceSummary = state.spaceTree?.spaces?.[sourceId];
    if (spaceSummary) return spaceSummary.icon ?? null;
    return undefined;
  }

  if (kind === 'document') {
    const privateNode = state.sidebarTree?.nodes?.[sourceId];
    if (privateNode) return privateNode.icon ?? null;

    const sharedNode = state.sharedTree?.nodes?.[sourceId];
    if (sharedNode) return sharedNode.icon ?? null;

    const trees = state.spaceTree?.trees;
    if (trees) {
      for (const tree of Object.values(trees)) {
        const node = tree?.nodes?.[sourceId];
        if (node) return node.icon ?? null;
      }
    }
  }

  return undefined;
}

function useStoreIcon(
  sourceId: string | null,
  kind: PeopleGroupKind
): DocumentIcon | null | undefined {
  const context = useContext(ReactReduxContext);
  const store = context?.store;

  return useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    store ? () => findIconInState(store.getState() as RootState, sourceId, kind) : () => undefined,
    () => undefined
  );
}

function GroupSourceIcon({
  kind,
  icon,
  accessToken,
}: {
  kind: PeopleGroupKind;
  icon?: DocumentIcon | null;
  accessToken?: string | null;
}) {
  if (kind === 'space') {
    const tile = workspaceIconTileStyle(icon);
    return (
      <span
        style={tile.style}
        className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-md select-none ${tile.className}`}
        data-testid={icon ? undefined : 'space-placeholder'}
      >
        {icon ? (
          <PageIcon
            icon={icon}
            size={icon.type === 'upload' || icon.type === 'link' ? 28 : 16}
            accessToken={accessToken ?? undefined}
          />
        ) : (
          <Layers size={15} />
        )}
      </span>
    );
  }

  if (kind === 'document') {
    const isMedia = icon?.type === 'upload' || icon?.type === 'link';
    return (
      <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center select-none text-muted-foreground">
        {icon ? (
          <PageIcon icon={icon} size={isMedia ? 24 : 20} accessToken={accessToken ?? undefined} />
        ) : (
          <DocumentText size={20} strokeWidth={1.75} className="opacity-80" />
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-muted-foreground select-none">
      <Lock size={15} strokeWidth={1.75} />
    </span>
  );
}

function PeopleGroupBlock({
  group,
  accessToken,
  documentSpace,
  breadcrumbs,
  resolveIcon,
  children,
}: {
  group: PeopleGroup;
  accessToken?: string | null;
  documentSpace?: DocumentSpaceSummary | null;
  breadcrumbs?: DocumentBreadcrumbItem[];
  resolveIcon?: (sourceId: string | null, kind: PeopleGroupKind) => DocumentIcon | null | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const countLabel = `${group.people.length} ${group.people.length === 1 ? 'person' : 'people'}`;
  const subtitle =
    group.kind === 'blocked'
      ? countLabel
      : `${group.kind === 'space' ? 'Space' : 'Document'} · ${countLabel}`;

  const storeIcon = useStoreIcon(group.sourceId, group.kind);

  const resolvedIcon = (() => {
    if (group.icon !== undefined) return group.icon;
    if (resolveIcon) {
      const custom = resolveIcon(group.sourceId, group.kind);
      if (custom !== undefined) return custom;
    }
    if (breadcrumbs && group.sourceId) {
      if (group.kind === 'document') {
        const crumb = breadcrumbs.find((b) => b.id === group.sourceId);
        if (crumb && crumb.icon !== undefined) return crumb.icon;
      } else if (group.kind === 'space') {
        const crumb = breadcrumbs.find((b) => b.space?.id === group.sourceId);
        if (crumb?.space && crumb.space.icon !== undefined) return crumb.space.icon;
      }
    }
    if (
      group.kind === 'space' &&
      group.sourceId &&
      documentSpace &&
      documentSpace.id === group.sourceId &&
      'icon' in documentSpace &&
      (documentSpace as { icon?: DocumentIcon | null }).icon !== undefined
    ) {
      return (documentSpace as { icon?: DocumentIcon | null }).icon ?? null;
    }
    return storeIcon;
  })();

  return (
    <section className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2.5 rounded-lg py-1 px-1.5 text-left hover:bg-sidebar-accent/40 transition-colors cursor-pointer group/group-block"
      >
        <GroupSourceIcon kind={group.kind} icon={resolvedIcon} accessToken={accessToken} />

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-snug text-card-foreground">
            {group.title}
          </span>
          <span className="block truncate text-[11.5px] leading-snug text-muted-foreground/60 mt-0.5">
            {subtitle}
          </span>
        </span>

        <span className="flex-shrink-0 px-1 text-muted-foreground/60 transition-colors duration-150 group-hover/group-block:text-foreground">
          <ChevronRight
            size={13}
            className={`transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
          />
        </span>
      </button>

      {open && <ul className="space-y-0.5 pl-3">{children}</ul>}
    </section>
  );
}

/**
 * Notion's list shape: the viewer first, then ordinary rows, then a collapsible
 * row for each source with more than one other person. A source with one
 * person stays flat and carries a `From “…”` note instead of a header.
 */
export function PeopleSection({
  pinned,
  flat,
  groups,
  canManageSharing,
  currentUserId,
  spaceId,
  documentSpace,
  breadcrumbs,
  accessToken,
  resolveIcon,
  hasEffectivePublicLink,
  effectiveLinkAction,
  recentlyAddedUserIds,
  onAccessSelect,
  onNavigate,
}: PeopleSectionProps) {
  const renderRow = (collab: Collaborator, showSource = collab.userId === currentUserId) => {
    const isSelf = collab.userId === currentUserId;
    const isDirectOwner = Boolean(collab.owner);
    // Any inherited grant is overridable here, including an ancestor
    // full-access grant; only the document's own owner stays locked.
    const canEditRow = canManageSharing && !isSelf && !isDirectOwner;
    const sourceId = collab.inheritedFromId || (collab.inherited && spaceId ? spaceId : null);

    return (
      <CollaboratorRow
        key={collab.userId}
        collab={collab}
        isSelf={isSelf}
        canEditRow={canEditRow}
        detail={getPersonDetail(collab, {
          recentlyAddedUserIds,
          showSource,
        })}
        onDetailClick={sourceId ? () => onNavigate(sourceId) : undefined}
        hasEffectivePublicLink={hasEffectivePublicLink}
        effectiveLinkAction={effectiveLinkAction}
        onAccessSelect={(value) => onAccessSelect(collab, value)}
      />
    );
  };

  const topRows = [...(pinned ? [pinned] : []), ...flat];

  return (
    <div>
      {topRows.length > 0 && (
        <ul className="space-y-0.5">
          {topRows.map((collab) => renderRow(collab, Boolean(collab.inherited)))}
        </ul>
      )}

      {groups.map((group) => (
        <PeopleGroupBlock
          key={group.key}
          group={group}
          accessToken={accessToken}
          documentSpace={documentSpace}
          breadcrumbs={breadcrumbs}
          resolveIcon={resolveIcon}
        >
          {group.people.map((collab) => renderRow(collab, false))}
        </PeopleGroupBlock>
      ))}
    </div>
  );
}
