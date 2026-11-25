'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  documentService,
  DocumentServiceApiError,
  type Collaborator,
  type CollaboratorAccessLevel,
  type DocumentBreadcrumbItem,
  type DocumentAccessLevel,
  type DocumentGeneralAccessMode,
  type DocumentSpaceSummary,
  type SharingSettings,
} from '@/services/document.service';
import { useAuth } from '@/hooks/useAuth.hook';
import { dispatchDocumentAccessChanged } from '@/lib/document-access-event.util';
import { ChainLink, Close, Globe, Lock, Users } from '@/icons';
import { dispatchOpenSpaceSettings } from '@/lib/space-settings-event.util';
import { Badge } from '@/components/Badge';
import { AccessDropdown } from './share/AccessDropdown';
import { PeopleSection } from './share/PeopleSection';
import { getPeopleGroups } from './share/peopleGroups';
import {
  ACCESS_ACTION_LABELS,
  GENERAL_ACCESS_LEVEL_OPTIONS,
  getGeneralAccessModeOptions,
  getGeneralAccessViewModel,
  getWorkspaceAccessViewModel,
  INVITE_ACCESS_OPTIONS,
  type CollaboratorDropdownValue,
  type GeneralAccessModeDropdownValue,
} from './share/shareOptions';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SharePanelProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  canManageSharing?: boolean;
  documentSpace?: DocumentSpaceSummary | null;
  onNavigate?: (documentId: string) => void;
}

// ─── Shared row shell ─────────────────────────────────────────────────────────

/**
 * One General Access row: an icon tile, the audience mode control, an optional level
 * control, and a provenance line. Both audiences render through it so their layout
 * cannot drift apart.
 */
function GeneralAccessRow({
  active,
  icon,
  modeControl,
  levelControl,
  footer,
}: {
  active: boolean;
  icon: ReactNode;
  modeControl: ReactNode;
  levelControl?: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 py-2 px-1.5 rounded-lg hover:bg-sidebar-accent/40 transition-colors">
      <span
        className={`
          inline-flex h-8 w-8 rounded-lg flex-shrink-0 items-center justify-center select-none transition-colors
          ${
            active
              ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
              : 'bg-sidebar-accent text-muted-foreground'
          }
        `}
      >
        {icon}
      </span>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div className="flex items-center justify-between gap-1 min-w-0">
          <div className="-ml-1">{modeControl}</div>
          {levelControl && <div className="flex-shrink-0">{levelControl}</div>}
        </div>
        {footer}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SharePanel({
  documentId,
  isOpen,
  onClose,
  anchorRef,
  canManageSharing = false,
  documentSpace = null,
  onNavigate,
}: SharePanelProps) {
  const router = useRouter();
  const { isAuthenticated, accessToken, user } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const collaboratorsRef = useRef<Collaborator[]>([]);
  collaboratorsRef.current = collaborators;
  const [hiddenSharingSources, setHiddenSharingSources] = useState(false);
  const [settings, setSettings] = useState<SharingSettings | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteAccess, setInviteAccess] = useState<DocumentAccessLevel>('EDIT');
  const [isSavingInvite, setIsSavingInvite] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recentlyAddedUserIds, setRecentlyAddedUserIds] = useState<Set<string>>(new Set());
  const [breadcrumbs, setBreadcrumbs] = useState<DocumentBreadcrumbItem[]>([]);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const collaboratorWrites = useRef<Promise<void>>(Promise.resolve());
  const settingsWrites = useRef<Promise<void>>(Promise.resolve());
  // Shared between the load effect and collaborator write handlers so an in-flight
  // load cannot overwrite a roster installed by a newer write.
  const rosterGenerationRef = useRef(0);
  // Shared between the load effect and settings writes so an in-flight load cannot
  // overwrite settings installed by a newer save.
  const settingsGenerationRef = useRef(0);
  const inFlightSettingsCountRef = useRef(0);
  // Identifies the open panel session (document + visibility). A response from a
  // save or roster write sent for an older session is discarded instead of being
  // painted onto the document the panel shows now.
  const panelSessionRef = useRef(0);
  const panelSessionKeyRef = useRef('');
  const panelSessionKey = `${documentId}:${isOpen}`;
  if (panelSessionKeyRef.current !== panelSessionKey) {
    panelSessionKeyRef.current = panelSessionKey;
    panelSessionRef.current += 1;
  }

  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  const space = documentSpace;

  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    []
  );

  useEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }
    if (!anchorRef.current) return;

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) {
        let right = window.innerWidth - rect.right;
        const panelWidth = Math.min(460, window.innerWidth - 32);
        const minMargin = 16;
        const maxRightValue = Math.max(minMargin, window.innerWidth - panelWidth - minMargin);
        right = Math.max(minMargin, Math.min(right, maxRightValue));

        setCoords({
          top: rect.bottom + 8,
          right: right,
        });
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, anchorRef]);

  // ── Load ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen || !isAuthenticated || !accessToken) return;
    let cancelled = false;
    const generation = ++rosterGenerationRef.current;
    const settingsGeneration = ++settingsGenerationRef.current;

    // Reset stale roster state up front: DocToolbar keeps isShareOpen across
    // documentId changes (no key remount), so without this the previous
    // document's collaborators briefly render under the new document.
    setCollaborators([]);
    setHiddenSharingSources(false);
    setSettings(null);
    setBreadcrumbs([]);
    setError(null);
    setIsSavingInvite(false);
    inFlightSettingsCountRef.current = 0;
    setIsSavingSettings(false);
    // "New" is a session marker, not a property of the grant. A reopen or a
    // document switch starts a new session.
    setRecentlyAddedUserIds(new Set());

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);

        if (typeof documentService.getDocumentBreadcrumbs === 'function') {
          void documentService
            .getDocumentBreadcrumbs(documentId, accessToken)
            .then((crumbs) => {
              if (!cancelled && crumbs) {
                setBreadcrumbs(crumbs);
              }
            })
            .catch(() => {
              if (!cancelled) {
                setBreadcrumbs([]);
              }
            });
        }

        if (typeof documentService.hasHiddenSharingSources === 'function') {
          void documentService
            .hasHiddenSharingSources(documentId, accessToken)
            .then((hidden) => {
              if (!cancelled) setHiddenSharingSources(hidden);
            })
            .catch(() => {});
        }

        const [cols, sett] = await Promise.all([
          documentService.listCollaborators(documentId, accessToken),
          documentService.getSharingSettings(documentId, accessToken),
        ]);
        if (!cancelled) {
          if (rosterGenerationRef.current === generation) {
            setCollaborators(cols);
          }
          if (settingsGenerationRef.current === settingsGeneration) {
            setSettings(sett);
          }
        }
      } catch (e) {
        // A link-only outsider has no workspace identity: the API withholds the roster
        // and the settings together. Hide both instead of surfacing an error.
        if (e instanceof DocumentServiceApiError && (e.status === 403 || e.status === 404)) {
          if (!cancelled) {
            if (rosterGenerationRef.current === generation) {
              setCollaborators([]);
            }
            if (settingsGenerationRef.current === settingsGeneration) {
              setSettings(null);
            }
          }
        } else if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load sharing settings');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen, isAuthenticated, accessToken, documentId, canManageSharing]);

  // ── Outside click / Escape ───────────────────────────────────────────────

  useEffect(() => {
    if (!isOpen) return;
    const onOut = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        panelRef.current &&
        !panelRef.current.contains(t) &&
        anchorRef.current &&
        !anchorRef.current.contains(t)
      ) {
        onClose();
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', onOut);
      document.addEventListener('keydown', onEsc);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onOut);
      document.removeEventListener('keydown', onEsc);
    };
  }, [isOpen, onClose, anchorRef]);

  if (!isOpen) return null;

  // ── Handlers ────────────────────────────────────────────────────────────

  // Each response contains the whole roster, so concurrent writes can otherwise
  // replace a newer roster with an older response. The session is captured when the
  // write is queued: a write that only starts after the panel switched documents must
  // not run against the document it was queued for.
  const queueCollaboratorWrite = (write: () => Promise<void>) => {
    const session = panelSessionRef.current;
    const run = () => (panelSessionRef.current === session ? write() : Promise.resolve());
    collaboratorWrites.current = collaboratorWrites.current.then(run, run);
  };

  const handleInvite = async () => {
    if (!accessToken || !inviteEmail.trim()) return;
    const session = panelSessionRef.current;
    try {
      setIsSavingInvite(true);
      setError(null);
      const knownIds = new Set(collaboratorsRef.current.map((collab) => collab.userId));
      const next = await documentService.upsertCollaborator(
        documentId,
        { email: inviteEmail.trim(), accessLevel: inviteAccess },
        accessToken
      );
      if (panelSessionRef.current !== session) return;
      const generation = ++rosterGenerationRef.current;
      const added = next.find((collab) => !knownIds.has(collab.userId));
      if (added) {
        setRecentlyAddedUserIds((current) => new Set(current).add(added.userId));
      }
      if (rosterGenerationRef.current === generation) {
        setCollaborators(next);
      }
      setInviteEmail('');
    } catch (e) {
      if (panelSessionRef.current !== session) return;
      setError(e instanceof Error ? e.message : 'Failed to add collaborator');
    } finally {
      if (panelSessionRef.current === session) setIsSavingInvite(false);
    }
  };

  const handleAccessChange = async (userId: string, level: CollaboratorAccessLevel) => {
    if (!accessToken) return;
    const session = panelSessionRef.current;
    try {
      setError(null);
      const next = await documentService.updateCollaboratorAccess(
        documentId,
        userId,
        level,
        accessToken
      );
      // A self-change invalidates the access level this tab resolved at load: the
      // editor, share button and trash affordances all follow it, even if the panel
      // closed or switched documents while the write was in flight.
      if (user?.id === userId) {
        dispatchDocumentAccessChanged(documentId);
      }
      if (panelSessionRef.current !== session) return;
      const generation = ++rosterGenerationRef.current;
      if (rosterGenerationRef.current === generation) {
        setCollaborators(next);
      }
    } catch (e) {
      if (panelSessionRef.current !== session) return;
      setError(e instanceof Error ? e.message : 'Failed to update access');
    }
  };

  const handleRemove = async (userId: string) => {
    if (!accessToken) return;
    const session = panelSessionRef.current;
    try {
      setError(null);
      const next = await documentService.removeCollaborator(documentId, userId, accessToken);
      if (panelSessionRef.current !== session) return;
      const generation = ++rosterGenerationRef.current;
      if (rosterGenerationRef.current === generation) {
        setCollaborators(next);
      }
    } catch (e) {
      if (panelSessionRef.current !== session) return;
      setError(e instanceof Error ? e.message : 'Failed to remove collaborator');
    }
  };

  /**
   * Removing yourself goes through `DELETE /collaborators/me`: the API refuses a self
   * No access row (only an admin could undo that breakpoint), and leaving a page you
   * inherit from a space or an ancestor is not possible at all. When the grant you
   * dropped was your only channel the roster is no longer readable, so the panel closes
   * and the workspace root replaces the page that just became unreachable.
   */
  const handleLeave = async () => {
    if (!accessToken) return;
    const session = panelSessionRef.current;
    try {
      setError(null);
      await documentService.leaveSharedDocument(documentId, accessToken);
      dispatchDocumentAccessChanged(documentId);
      if (panelSessionRef.current !== session) return;
      const generation = ++rosterGenerationRef.current;

      // Roster 403/404 can mean either no access at all or a link-only reader whose
      // roster is withheld. Confirm document readability before redirecting home.
      let lostAccess = false;
      try {
        const next = await documentService.listCollaborators(documentId, accessToken);
        if (panelSessionRef.current !== session) return;
        if (rosterGenerationRef.current === generation) {
          setCollaborators(next);
        }
      } catch (e) {
        if (panelSessionRef.current !== session) return;
        const rosterDenied =
          e instanceof DocumentServiceApiError && (e.status === 403 || e.status === 404);
        if (!rosterDenied) {
          setError('You left the page, but its people list could not be refreshed.');
        } else {
          if (rosterGenerationRef.current === generation) {
            setCollaborators([]);
          }
          settingsGenerationRef.current += 1;
          setSettings(null);
          try {
            const myAccess = await documentService.getMyAccess(documentId, accessToken);
            if (panelSessionRef.current !== session) return;
            lostAccess = !myAccess.allowed || !myAccess.accessLevel;
          } catch (accessErr) {
            if (panelSessionRef.current !== session) return;
            lostAccess =
              accessErr instanceof DocumentServiceApiError &&
              (accessErr.status === 403 || accessErr.status === 404);
          }
        }
      }

      if (lostAccess) {
        onClose();
        router.replace('/');
      }
    } catch (e) {
      if (panelSessionRef.current !== session) return;
      setError(e instanceof Error ? e.message : 'Failed to leave page');
    }
  };

  const handleCollaboratorAccessSelect = (
    collab: Collaborator,
    nextValue: CollaboratorDropdownValue
  ) => {
    // A non-admin's own row is read-only; re-selecting its configured grant is not an edit.
    if (!canManageSharing && collab.userId === user?.id && nextValue === collab.accessLevel) {
      return;
    }
    if (nextValue === 'INHERIT') {
      queueCollaboratorWrite(() => handleRemove(collab.userId));
    } else if (nextValue === 'LEAVE') {
      queueCollaboratorWrite(handleLeave);
    } else {
      queueCollaboratorWrite(() => handleAccessChange(collab.userId, nextValue));
    }
  };

  // Every general-access write answers with the whole settings document, so
  // serialize them per panel session and bump settingsGenerationRef on completion
  // so neither an older save nor an in-flight load can overwrite newer settings.
  const queueSettingsWrite = (write: () => Promise<void>) => {
    const session = panelSessionRef.current;
    const run = () => (panelSessionRef.current === session ? write() : Promise.resolve());
    settingsWrites.current = settingsWrites.current.then(run, run);
  };

  const saveSettings = (
    payload: Parameters<typeof documentService.updateSharingSettings>[1],
    failureMessage: string
  ) => {
    if (!accessToken) return;
    const session = panelSessionRef.current;
    inFlightSettingsCountRef.current += 1;
    setIsSavingSettings(true);
    setError(null);
    queueSettingsWrite(async () => {
      try {
        const next = await documentService.updateSharingSettings(documentId, payload, accessToken);
        if (panelSessionRef.current !== session) return;
        const settingsGeneration = ++settingsGenerationRef.current;
        if (settingsGenerationRef.current === settingsGeneration) {
          setSettings(next);
        }
      } catch (e) {
        if (panelSessionRef.current !== session) return;
        setError(e instanceof Error ? e.message : failureMessage);
      } finally {
        if (panelSessionRef.current === session) {
          inFlightSettingsCountRef.current = Math.max(0, inFlightSettingsCountRef.current - 1);
          if (inFlightSettingsCountRef.current === 0) {
            setIsSavingSettings(false);
          }
        }
      }
    });
  };

  // Both general-access rows use the same mode values: each row shows its
  // own audience and also offers the other audience while it is inactive, so
  // setting both creates two independent rows without a separate add flow.
  const handleGeneralAccessModeSelect = (
    row: 'workspace' | 'link',
    nextValue: GeneralAccessModeDropdownValue
  ) => {
    if (!accessToken || !settings) return;
    const workspace = getWorkspaceAccessViewModel(settings);
    const link = getGeneralAccessViewModel(settings);
    const workspaceFailure = 'Failed to update workspace access';

    // Restore parent inheritance (mirrors deleting a collaborator override row
    // via its Inherit option).
    if (nextValue === 'INHERIT') {
      return saveSettings(
        row === 'workspace'
          ? { workspaceAccessMode: 'RESTRICTED', workspaceInheritBlocked: false }
          : { generalAccessMode: 'RESTRICTED', linkInheritBlocked: false },
        `Failed to restore ${row === 'workspace' ? 'workspace' : 'link'} inheritance`
      );
    }

    if (nextValue === 'WORKSPACE_MEMBERS') {
      // Selecting the audience that already owns this row is a no-op. The
      // link row can still use the same option to turn workspace access on.
      if (row === 'workspace' && workspace.displayMode === 'WORKSPACE_MEMBERS') return;
      return saveSettings(
        {
          workspaceAccessMode: 'WORKSPACE_MEMBERS',
          workspaceAccessLevel: workspace.level,
          ...(settings.workspaceInheritBlocked ? { workspaceInheritBlocked: false } : {}),
        },
        workspaceFailure
      );
    }

    if (nextValue === 'ANYONE_WITH_LINK') {
      // An own active link is already represented; an expired own link is not.
      if (row === 'link' && link.state === 'own') return;
      return saveSettings(
        {
          generalAccessMode: 'ANYONE_WITH_LINK',
          linkAccessLevel: settings.linkAccessLevel || 'VIEW',
          ...(link.state === 'expired' ? { clearLinkExpiresAt: true } : {}),
        },
        'Failed to update sharing settings'
      );
    }

    // RESTRICTED turns the channel off. The block is what makes the page private when
    // something still supplies the audience (an ancestor page or the space). Send it
    // unconditionally: redaction can hide that source, and the server normalizes a block
    // away when no reachable ancestor supplies one, so a hidden source is never mistaken
    // for "nothing to shadow".
    if (row === 'workspace') {
      if (workspace.displayMode === 'RESTRICTED') return;
      return saveSettings(
        { workspaceAccessMode: 'RESTRICTED', workspaceInheritBlocked: true },
        workspaceFailure
      );
    }

    if (link.state === 'private' || link.state === 'blocked') return;
    return saveSettings(
      { generalAccessMode: 'RESTRICTED', linkInheritBlocked: true },
      'Failed to update sharing settings'
    );
  };

  const handleWorkspaceAccessChange = (level: DocumentAccessLevel) => {
    if (!settings) return;
    return saveSettings(
      {
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: level,
        ...(settings.workspaceInheritBlocked ? { workspaceInheritBlocked: false } : {}),
      },
      'Failed to update workspace access'
    );
  };

  const handleLinkAccessChange = (level: DocumentAccessLevel) => {
    if (!settings) return;
    // Changing the level on an inherited link creates an override on this
    // document (same as changing an inherited collaborator row), so the
    // mode must be ANYONE_WITH_LINK even though the stored own mode is RESTRICTED.
    const modeToSend =
      isInheritedPublicLink && !hasOwnPublicLink ? 'ANYONE_WITH_LINK' : settings.generalAccessMode;
    return saveSettings(
      {
        generalAccessMode: modeToSend,
        linkAccessLevel: level,
        ...(generalAccessState === 'expired' ||
        (generalAccessState === 'inherited' && Boolean(settings.linkExpiresAt))
          ? { clearLinkExpiresAt: true }
          : {}),
      },
      'Failed to update link access'
    );
  };

  const handleCopyLink = async () => {
    try {
      const url = typeof window !== 'undefined' ? window.location.href : '';
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError('Failed to copy link. Please check clipboard permissions and try again.');
      console.error('Failed to copy share link to clipboard', e);
    }
  };

  /**
   * The badge beside the workspace row names the page or space that supplies the setting.
   * A page opens in the editor; a space opens the settings that own the audience.
   */
  const handleWorkspaceSourceClick = () => {
    if (!workspaceVm.sourceId) return;
    if (workspaceVm.sourceKind === 'SPACE') {
      onClose();
      dispatchOpenSpaceSettings({ spaceId: workspaceVm.sourceId, tab: 'general' });
      return;
    }
    handleNavigate(workspaceVm.sourceId);
  };

  const handleNavigate = (targetDocId: string) => {
    if (space && targetDocId === space.id) {
      openSpaceSettings('members');
      return;
    }
    onClose();
    if (onNavigate) {
      onNavigate(targetDocId);
    } else {
      router.push(`/doc/${targetDocId}`);
    }
  };

  const {
    state: generalAccessState,
    hasOwnPublicLink,
    isInheritedPublicLink,
    hasEffectivePublicLink,
    showInheritOption: showLinkInheritOption,
    showProvenanceBadge,
    provenanceBadgePrefix,
    provenanceBadgeTooltip,
    inheritedFromTitle,
    displayMode: displayGeneralMode,
  } = getGeneralAccessViewModel(settings);
  const workspaceVm = getWorkspaceAccessViewModel(settings);
  const effectiveLinkAction = ACCESS_ACTION_LABELS[settings?.linkAccessLevel ?? 'VIEW'] ?? 'view';
  // An effective workspace audience already explains who else can open this page. The
  // hidden sources warning exists for sources and rosters the viewer cannot see; repeating
  // it under the workspace row would contradict that row.
  const showHiddenSharingSources = hiddenSharingSources && !workspaceVm.hasEffectiveWorkspaceAccess;
  const roster = collaborators;
  const {
    pinned: pinnedCollaborator,
    flat: flatCollaborators,
    groups: peopleGroups,
  } = getPeopleGroups(roster, {
    spaceId: space?.id ?? null,
    pinnedUserId: user?.id ?? null,
  });

  // Every reader who can see the roster sees the same General Access rows; the controls
  // render as text when the caller is not an owner. The workspace row appears when it
  // carries a setting, and the link row doubles as the empty state, exactly as it does
  // for a manager.
  const showsWorkspaceAccessRow = Boolean(settings) && workspaceVm.state !== 'private';
  const showsLinkAccessRow =
    Boolean(settings) && (generalAccessState !== 'private' || !showsWorkspaceAccessRow);
  const showsGeneralAccessSection = showsWorkspaceAccessRow || showsLinkAccessRow;
  const workspaceModeOptions = settings
    ? getGeneralAccessModeOptions({
        current: workspaceVm.displayMode,
        canRestrict: canManageSharing,
        canAddWorkspace: canManageSharing,
        canAddLink: canManageSharing && !hasEffectivePublicLink,
        showInheritOption: canManageSharing && workspaceVm.showInheritOption,
        inheritFromTitle: workspaceVm.inheritFromTitle,
      })
    : [];

  const openSpaceSettings = (tab: 'general' | 'members' = 'members') => {
    if (!space) return;
    onClose();
    dispatchOpenSpaceSettings({ spaceId: space.id, tab });
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label="Share document"
      style={
        coords
          ? {
              top: coords.top,
              right: coords.right,
            }
          : { opacity: 0 }
      }
      className="
        fixed z-50
        w-[29rem] max-w-[calc(100vw-2rem)]
        flex flex-col
        max-h-[calc(100dvh-4.5rem)]
        rounded-2xl
        bg-card text-card-foreground
        shadow-[0_12px_40px_-6px_rgba(0,0,0,0.15),0_4px_12px_-2px_rgba(0,0,0,0.08)]
        dark:shadow-[0_12px_40px_-6px_rgba(0,0,0,0.65)]
        border border-border dark:border-white/10
        overflow-hidden
        animate-in fade-in slide-in-from-top-1 duration-150
      "
    >
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border/70 dark:border-white/10 px-4 py-2.5">
        <span className="text-[15px] font-semibold text-card-foreground">Share</span>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1.5 rounded-md text-muted-foreground/70 hover:text-card-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
        >
          <Close size={16} />
        </button>
      </div>

      {/* ── Invite bar / read-only notice ─────────────────────── */}
      <div className="px-4 pt-3.5 pb-2">
        {!isAuthenticated || !accessToken ? (
          <p className="py-2 text-[13.5px] text-muted-foreground">Sign in to manage sharing.</p>
        ) : !canManageSharing ? (
          <div className="py-1">
            <p className="text-[13px] text-muted-foreground">Only owners can manage sharing.</p>
            {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') queueCollaboratorWrite(handleInvite);
                }}
                placeholder="Add people by email"
                className="
                  flex-1 min-w-0 rounded-lg border border-border dark:border-white/10 bg-muted/40 dark:bg-muted/20
                  px-3 py-1.5 text-[13.5px] text-card-foreground
                  placeholder:text-muted-foreground/60
                  outline-none focus:border-foreground/30 focus:bg-background
                  transition-colors
                "
              />

              {inviteEmail.trim().length > 0 && (
                <AccessDropdown
                  value={inviteAccess}
                  options={INVITE_ACCESS_OPTIONS}
                  onChange={setInviteAccess}
                  align="right"
                />
              )}
              <button
                type="button"
                onClick={() => queueCollaboratorWrite(handleInvite)}
                disabled={isSavingInvite || !inviteEmail.trim()}
                aria-label="Add"
                className="
                    flex-shrink-0 rounded-lg
                    bg-[var(--nd-brand)] hover:bg-[var(--nd-brand-hover)] active:bg-[#d57768]
                    text-neutral-950 font-medium
                    px-3.5 py-1.5
                    text-[13px] transition-all cursor-pointer shadow-xs
                    outline-none focus-visible:ring-2 focus-visible:ring-[var(--nd-brand)]/50
                    disabled:opacity-50 disabled:cursor-not-allowed
                    active:scale-95
                  "
              >
                {isSavingInvite ? '…' : 'Add'}
              </button>
            </div>

            {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
          </>
        )}
      </div>

      {/* ── Body (Scrollable) ─────────────────────────────────── */}
      {isAuthenticated && accessToken && (
        <div className="min-h-0 flex-1 max-h-[52vh] overflow-y-auto px-4 py-2">
          {isLoading ? (
            <div className="space-y-3 py-2">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-sidebar-accent/40 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-32 rounded bg-sidebar-accent/40 animate-pulse" />
                    <div className="h-2.5 w-44 rounded bg-sidebar-accent/30 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* ── People ── */}
              {(roster.length > 0 || showHiddenSharingSources) && (
                <section className="pb-3">
                  <PeopleSection
                    pinned={pinnedCollaborator}
                    flat={flatCollaborators}
                    groups={peopleGroups}
                    canManageSharing={canManageSharing}
                    currentUserId={user?.id}
                    spaceId={space?.id ?? null}
                    documentSpace={space}
                    accessToken={accessToken}
                    breadcrumbs={breadcrumbs}
                    hasEffectivePublicLink={hasEffectivePublicLink}
                    effectiveLinkAction={effectiveLinkAction}
                    recentlyAddedUserIds={recentlyAddedUserIds}
                    onAccessSelect={handleCollaboratorAccessSelect}
                    onNavigate={handleNavigate}
                  />
                  {showHiddenSharingSources && (
                    <p className="px-1.5 py-2 text-xs text-muted-foreground">
                      Others may have access through locations you can’t view.
                    </p>
                  )}
                </section>
              )}

              {/* ── General Access ── */}
              {showsGeneralAccessSection && (
                <section className="pt-3 border-t border-border/70 dark:border-white/10">
                  <p className="mb-0.5 text-[12px] font-medium text-muted-foreground/70 select-none">
                    General Access
                  </p>

                  {showsWorkspaceAccessRow && (
                    <GeneralAccessRow
                      active={workspaceVm.hasEffectiveWorkspaceAccess}
                      icon={
                        workspaceVm.hasEffectiveWorkspaceAccess ? (
                          <Users size={17} strokeWidth={1.75} />
                        ) : (
                          <Lock size={17} strokeWidth={1.75} />
                        )
                      }
                      modeControl={
                        <AccessDropdown
                          value={workspaceVm.displayMode}
                          options={workspaceModeOptions}
                          onChange={(v) => void handleGeneralAccessModeSelect('workspace', v)}
                          disabled={isSavingSettings}
                          readOnly={!canManageSharing}
                          align="left"
                          ariaLabel="Workspace general access"
                        />
                      }
                      levelControl={
                        workspaceVm.hasEffectiveWorkspaceAccess && settings ? (
                          <AccessDropdown
                            value={workspaceVm.level}
                            options={GENERAL_ACCESS_LEVEL_OPTIONS}
                            onChange={(v) => void handleWorkspaceAccessChange(v)}
                            disabled={isSavingSettings}
                            readOnly={!canManageSharing}
                            align="right"
                            ariaLabel="Workspace access level"
                          />
                        ) : undefined
                      }
                      footer={
                        workspaceVm.showSourceBadge ? (
                          <div className="pl-1 pt-0.5 flex items-center gap-1.5 min-w-0">
                            <Badge
                              onClick={
                                workspaceVm.sourceId ? handleWorkspaceSourceClick : undefined
                              }
                              title={workspaceVm.sourceBadgeTooltip}
                              className="max-w-[140px] truncate flex-shrink-0"
                            >
                              {workspaceVm.sourceBadgePrefix} “{workspaceVm.sourceTitle}”
                            </Badge>
                          </div>
                        ) : (
                          <p className="pl-1 pt-0.5 text-[11.5px] text-muted-foreground/70 leading-snug">
                            {workspaceVm.hasEffectiveWorkspaceAccess
                              ? `Everyone in this workspace can ${
                                  ACCESS_ACTION_LABELS[workspaceVm.level] ?? 'view'
                                }`
                              : 'Only people with access can open'}
                          </p>
                        )
                      }
                    />
                  )}

                  {showsLinkAccessRow && settings && (
                    <GeneralAccessRow
                      active={hasEffectivePublicLink}
                      icon={
                        hasEffectivePublicLink ? (
                          <Globe size={17} strokeWidth={1.75} />
                        ) : (
                          <Lock size={17} strokeWidth={1.75} />
                        )
                      }
                      modeControl={
                        <AccessDropdown
                          value={displayGeneralMode}
                          options={getGeneralAccessModeOptions({
                            current: displayGeneralMode,
                            canRestrict: canManageSharing,
                            canAddWorkspace:
                              canManageSharing && !workspaceVm.hasEffectiveWorkspaceAccess,
                            canAddLink: canManageSharing,
                            showInheritOption: canManageSharing && showLinkInheritOption,
                            inheritFromTitle: settings.inheritedFromTitle,
                          })}
                          onChange={(v) => void handleGeneralAccessModeSelect('link', v)}
                          disabled={isSavingSettings}
                          readOnly={!canManageSharing}
                          align="left"
                        />
                      }
                      levelControl={
                        hasEffectivePublicLink || generalAccessState === 'expired' ? (
                          <AccessDropdown
                            value={settings.linkAccessLevel ?? 'VIEW'}
                            options={GENERAL_ACCESS_LEVEL_OPTIONS}
                            onChange={(v) => void handleLinkAccessChange(v)}
                            disabled={isSavingSettings}
                            readOnly={!canManageSharing}
                            align="right"
                          />
                        ) : undefined
                      }
                      footer={
                        isInheritedPublicLink || showProvenanceBadge ? (
                          <div className="pl-1 pt-0.5 flex items-center gap-1.5 min-w-0">
                            {isInheritedPublicLink && (
                              <Badge
                                onClick={
                                  settings.inheritedFromId || space?.id
                                    ? () => handleNavigate(settings.inheritedFromId || space!.id)
                                    : undefined
                                }
                                title={`From “${inheritedFromTitle}”`}
                                className="max-w-[140px] truncate flex-shrink-0"
                              >
                                From “{inheritedFromTitle}”
                              </Badge>
                            )}
                            {showProvenanceBadge && (
                              <Badge
                                onClick={() => handleNavigate(settings.inheritedFromId!)}
                                title={provenanceBadgeTooltip}
                                className="max-w-[140px] truncate flex-shrink-0"
                              >
                                {provenanceBadgePrefix} {inheritedFromTitle}
                              </Badge>
                            )}
                          </div>
                        ) : (
                          <p className="pl-1 pt-0.5 text-[11.5px] text-muted-foreground/70 leading-snug">
                            {hasEffectivePublicLink
                              ? `Anyone on the internet with the link can ${effectiveLinkAction}`
                              : generalAccessState === 'expired'
                                ? canManageSharing
                                  ? 'Link expired — update link access or re-enable to revive'
                                  : 'The share link has expired'
                                : 'Only people with access can open with the link'}
                          </p>
                        )
                      }
                    />
                  )}
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-border/70 dark:border-white/10 bg-muted/20 dark:bg-muted/10">
        {space ? (
          <button
            type="button"
            onClick={() => handleNavigate(space.id)}
            aria-label={`Space members in ${space.name}`}
            className="rounded-md px-1 py-1 text-[12px] font-medium text-muted-foreground hover:text-card-foreground transition-colors cursor-pointer"
          >
            Space members
          </button>
        ) : (
          <span />
        )}

        <button
          type="button"
          onClick={() => void handleCopyLink()}
          className={`
            inline-flex items-center gap-1.5 rounded-lg
            border px-3 py-1.5
            text-[13px] font-medium
            active:scale-95 transition-all cursor-pointer
            ${
              copied
                ? 'border-[var(--nd-brand)] bg-[var(--nd-brand)]/15 text-[#c06d62] dark:text-[var(--nd-brand)]'
                : 'border-border dark:border-white/10 text-card-foreground hover:bg-sidebar-accent'
            }
          `}
        >
          <ChainLink className="h-4 w-4" />
          <span>{copied ? 'Copied!' : 'Copy link'}</span>
        </button>
      </div>
    </div>
  );
}
