'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  documentService,
  DocumentServiceApiError,
  type Collaborator,
  type CollaboratorAccessLevel,
  type DocumentAccessLevel,
  type DocumentGeneralAccessMode,
  type SharingSettings,
} from '@/services/document.service';
import { useAuth } from '@/hooks/useAuth.hook';
import { ChainLink, Close, Globe, Lock } from '@/icons';
import { AccessDropdown } from './share/AccessDropdown';
import { CollaboratorRow } from './share/CollaboratorRow';
import {
  ACCESS_ACTION_LABELS,
  getGeneralAccessViewModel,
  getGeneralModeOptions,
  INVITE_ACCESS_OPTIONS,
  LINK_ACCESS_OPTIONS,
  type CollaboratorDropdownValue,
  type GeneralModeDropdownValue,
} from './share/shareOptions';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SharePanelProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  canManageSharing?: boolean;
  onNavigate?: (documentId: string) => void;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SharePanel({
  documentId,
  isOpen,
  onClose,
  anchorRef,
  canManageSharing = false,
  onNavigate,
}: SharePanelProps) {
  const router = useRouter();
  const { isAuthenticated, accessToken, user } = useAuth();
  const panelRef = useRef<HTMLDivElement>(null);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [settings, setSettings] = useState<SharingSettings | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteAccess, setInviteAccess] = useState<DocumentAccessLevel>('EDIT');
  const [isSavingInvite, setIsSavingInvite] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

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

    // Reset stale roster state up front: DocToolbar keeps isShareOpen across
    // documentId changes (no key remount), so without this the previous
    // document's collaborators briefly render under the new document.
    setCollaborators([]);
    setSettings(null);
    setError(null);

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        if (!canManageSharing) {
          try {
            const cols = await documentService.listCollaborators(documentId, accessToken);
            if (!cancelled) {
              setCollaborators(cols);
              setSettings(null);
            }
          } catch (e) {
            // Readers without an identity grant cannot enumerate the roster:
            // hide the section instead of surfacing an error.
            if (e instanceof DocumentServiceApiError && (e.status === 403 || e.status === 404)) {
              if (!cancelled) {
                setCollaborators([]);
                setSettings(null);
              }
            } else {
              throw e;
            }
          }
        } else {
          const [cols, sett] = await Promise.all([
            documentService.listCollaborators(documentId, accessToken),
            documentService.getSharingSettings(documentId, accessToken),
          ]);
          if (!cancelled) {
            setCollaborators(cols);
            setSettings(sett);
          }
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Failed to load sharing settings');
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

  const handleInvite = async () => {
    if (!accessToken || !inviteEmail.trim()) return;
    try {
      setIsSavingInvite(true);
      setError(null);
      const next = await documentService.upsertCollaborator(
        documentId,
        { email: inviteEmail.trim(), accessLevel: inviteAccess },
        accessToken
      );
      setCollaborators(next);
      setInviteEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add collaborator');
    } finally {
      setIsSavingInvite(false);
    }
  };

  const handleAccessChange = async (userId: string, level: CollaboratorAccessLevel) => {
    if (!accessToken) return;
    try {
      setError(null);
      const next = await documentService.updateCollaboratorAccess(
        documentId,
        userId,
        level,
        accessToken
      );
      setCollaborators(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update access');
    }
  };

  const handleRemove = async (userId: string) => {
    if (!accessToken) return;
    try {
      setError(null);
      const next = await documentService.removeCollaborator(documentId, userId, accessToken);
      setCollaborators(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove collaborator');
    }
  };

  const handleCollaboratorAccessSelect = (
    collab: Collaborator,
    nextValue: CollaboratorDropdownValue
  ) => {
    if (nextValue === 'INHERIT') {
      void handleRemove(collab.userId);
    } else {
      void handleAccessChange(collab.userId, nextValue);
    }
  };

  // Mode selection mirrors a collaborator row's single dropdown: picking a
  // state writes it (override), and the Inherit option deletes the override.
  // Driven off the view-model state so dropdown, badges and payloads share
  // one source of truth instead of re-deriving override/block branches.
  const handleGeneralModeSelect = async (nextValue: GeneralModeDropdownValue) => {
    if (!accessToken || !settings) return;
    // Restore parent inheritance (mirrors deleting a collaborator override row
    // via its Inherit option).
    if (nextValue === 'INHERIT') {
      try {
        setIsSavingSettings(true);
        setError(null);
        const next = await documentService.updateSharingSettings(
          documentId,
          { generalAccessMode: 'RESTRICTED', linkInheritBlocked: false },
          accessToken
        );
        setSettings(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to restore link inheritance');
      } finally {
        setIsSavingSettings(false);
      }
      return;
    }
    const mode: DocumentGeneralAccessMode = nextValue;
    const vm = getGeneralAccessViewModel(settings);
    // Already in this explicit own mode: nothing to write (guards against no-op re-select).
    // An inherited link CAN be re-selected as ANYONE_WITH_LINK to pin it as an own override.
    if (mode === 'ANYONE_WITH_LINK' && vm.state === 'own') return;
    if (mode === 'RESTRICTED' && (vm.state === 'private' || vm.state === 'blocked')) return;
    try {
      setIsSavingSettings(true);
      setError(null);
      let payload: {
        generalAccessMode: DocumentGeneralAccessMode;
        linkAccessLevel?: DocumentAccessLevel;
        linkInheritBlocked?: boolean;
      };
      if (mode === 'ANYONE_WITH_LINK') {
        payload = { generalAccessMode: mode, linkAccessLevel: settings.linkAccessLevel || 'VIEW' };
      } else if (
        vm.state === 'inherited' ||
        vm.state === 'blocked' ||
        (vm.state === 'own' && settings.inheritedFromId)
      ) {
        // Restricted means the document is private on the link channel. With
        // an inherited or blocked link that requires blocking inheritance,
        // or the ancestor grant would keep it public; dropping only the own
        // link is the explicit Inherit option instead. Pure-own links with
        // no ancestor send a bare RESTRICTED so no parentless Inherit
        // option appears.
        payload = { generalAccessMode: mode, linkInheritBlocked: true };
      } else {
        payload = { generalAccessMode: mode };
      }
      const next = await documentService.updateSharingSettings(documentId, payload, accessToken);
      setSettings(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update sharing settings');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleLinkAccessChange = async (level: DocumentAccessLevel) => {
    if (!accessToken || !settings) return;
    try {
      setIsSavingSettings(true);
      // Changing the level on an inherited link creates an override on this
      // document (same as changing an inherited collaborator row), so the
      // mode must be ANYONE_WITH_LINK even though the stored own mode is RESTRICTED.
      const modeToSend =
        isInheritedPublicLink && !hasOwnPublicLink
          ? 'ANYONE_WITH_LINK'
          : settings.generalAccessMode;
      const next = await documentService.updateSharingSettings(
        documentId,
        { generalAccessMode: modeToSend, linkAccessLevel: level },
        accessToken
      );
      setSettings(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update link access');
    } finally {
      setIsSavingSettings(false);
    }
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

  const handleNavigate = (targetDocId: string) => {
    onClose();
    if (onNavigate) {
      onNavigate(targetDocId);
    } else {
      router.push(`/doc/${targetDocId}`);
    }
  };

  const {
    hasOwnPublicLink,
    isInheritedPublicLink,
    hasEffectivePublicLink,
    showInheritOption,
    showProvenanceBadge,
    provenanceBadgePrefix,
    provenanceBadgeTooltip,
    inheritedFromTitle,
    displayMode: displayGeneralMode,
  } = getGeneralAccessViewModel(settings);
  const effectiveLinkAction = ACCESS_ACTION_LABELS[settings?.linkAccessLevel ?? 'VIEW'] ?? 'view';
  const activeCollaboratorsCount = collaborators.filter(
    (c) => c.accessLevel !== 'NO_ACCESS'
  ).length;

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
      <div className="flex items-center justify-between border-b border-border/70 dark:border-white/10 px-4 pt-2.5 pb-0">
        <span
          className="
            px-3 py-2 text-[15px] transition-colors relative cursor-default
            text-card-foreground font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2px] after:bg-[var(--nd-brand)]
          "
        >
          Share
        </span>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="p-1.5 rounded-md text-muted-foreground/70 hover:text-card-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
        >
          <Close size={16} />
        </button>
      </div>

      {/* ── Invite bar ────────────────────────────────────────── */}
      <div className="px-4 pt-3.5 pb-2">
        {!isAuthenticated || !accessToken ? (
          <p className="py-2 text-[13.5px] text-muted-foreground">Sign in to manage sharing.</p>
        ) : !canManageSharing ? (
          <div className="py-1">
            <p className="text-[13px] text-muted-foreground">
              You need owner access to manage sharing.
            </p>
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
                  if (e.key === 'Enter') void handleInvite();
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
                <>
                  <AccessDropdown
                    value={inviteAccess}
                    options={INVITE_ACCESS_OPTIONS}
                    onChange={setInviteAccess}
                    align="right"
                  />
                  <button
                    type="button"
                    onClick={() => void handleInvite()}
                    disabled={isSavingInvite}
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
                </>
              )}
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
              {/* ── People with access ── */}
              {activeCollaboratorsCount > 0 && (
                <section className="pb-3">
                  <p className="mb-2 text-[13.5px] font-medium text-muted-foreground/80 select-none flex items-center gap-1.5">
                    <span>People with access</span>
                    <span className="text-[12px] text-muted-foreground/60 font-normal">
                      ({activeCollaboratorsCount})
                    </span>
                  </p>
                  <ul className="space-y-1">
                    {collaborators.map((collab) => {
                      const isSelf = collab.userId === user?.id;
                      const isDirectOwner = Boolean(collab.owner);
                      // Any inherited grant is overridable here, including an ancestor
                      // full-access grant; only the document's own owner stays locked.
                      const canEditRow = canManageSharing && !isSelf && !isDirectOwner;

                      return (
                        <CollaboratorRow
                          key={collab.userId}
                          collab={collab}
                          isSelf={isSelf}
                          canEditRow={canEditRow}
                          hasEffectivePublicLink={hasEffectivePublicLink}
                          effectiveLinkAction={effectiveLinkAction}
                          onAccessSelect={(v) => handleCollaboratorAccessSelect(collab, v)}
                          onNavigateTo={handleNavigate}
                        />
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* ── General access ── */}
              {canManageSharing && settings && (
                <section className="pt-4 border-t border-border/70 dark:border-white/10">
                  <p className="mb-1 text-[13.5px] font-medium text-muted-foreground/80 select-none">
                    General
                  </p>

                  <div className="flex items-center gap-2 py-1.5 px-1.5 rounded-lg hover:bg-sidebar-accent/40 transition-colors">
                    <span
                      className={`
                        inline-flex h-10 w-10 rounded-full flex-shrink-0 items-center justify-center select-none shadow-xs transition-colors
                        ${
                          hasEffectivePublicLink
                            ? 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
                            : 'bg-sidebar-accent text-muted-foreground'
                        }
                      `}
                    >
                      {hasEffectivePublicLink ? (
                        <Globe size={20} strokeWidth={1.75} />
                      ) : (
                        <Lock size={20} strokeWidth={1.75} />
                      )}
                    </span>

                    <div className="flex-1 min-w-0">
                      {/* Row 1: state + level */}
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <div className="-ml-1">
                          <AccessDropdown
                            value={displayGeneralMode}
                            options={getGeneralModeOptions({
                              showInheritOption,
                              inheritedFromTitle: settings?.inheritedFromTitle,
                            })}
                            onChange={(v) => void handleGeneralModeSelect(v)}
                            disabled={isSavingSettings}
                            align="left"
                          />
                        </div>

                        {hasEffectivePublicLink && (
                          <div className="flex-shrink-0">
                            <AccessDropdown
                              value={settings?.linkAccessLevel ?? 'VIEW'}
                              options={LINK_ACCESS_OPTIONS}
                              onChange={(v) => void handleLinkAccessChange(v)}
                              disabled={isSavingSettings}
                              align="right"
                            />
                          </div>
                        )}
                      </div>

                      {/* Row 2: provenance (via / Overrides) replaces the description, mirroring People rows */}
                      {isInheritedPublicLink || showProvenanceBadge ? (
                        <div className="pl-1">
                          {isInheritedPublicLink &&
                            (settings?.inheritedFromId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  settings?.inheritedFromId &&
                                  handleNavigate(settings.inheritedFromId)
                                }
                                title={`Inherited via ${inheritedFromTitle}`}
                                className="inline-block max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted text-muted-foreground align-middle flex-shrink-0 hover:bg-muted-foreground/15 hover:text-foreground transition-colors cursor-pointer"
                              >
                                via {inheritedFromTitle}
                              </button>
                            ) : (
                              <span
                                title={`Inherited via ${inheritedFromTitle}`}
                                className="inline-block max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted text-muted-foreground align-middle flex-shrink-0"
                              >
                                via {inheritedFromTitle}
                              </span>
                            ))}
                          {showProvenanceBadge &&
                            (settings?.inheritedFromId ? (
                              <button
                                type="button"
                                onClick={() =>
                                  settings?.inheritedFromId &&
                                  handleNavigate(settings.inheritedFromId)
                                }
                                title={provenanceBadgeTooltip}
                                className="inline-block max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted text-muted-foreground align-middle flex-shrink-0 hover:bg-muted-foreground/15 hover:text-foreground transition-colors cursor-pointer"
                              >
                                {provenanceBadgePrefix} {inheritedFromTitle}
                              </button>
                            ) : null)}
                        </div>
                      ) : (
                        <p className="pl-1 text-[12px] text-muted-foreground/70 leading-snug">
                          {hasEffectivePublicLink
                            ? `Anyone on the internet with the link can ${effectiveLinkAction}`
                            : 'Only people with access can open with the link'}
                        </p>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/70 dark:border-white/10 bg-muted/20 dark:bg-muted/10">
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

        <button
          type="button"
          onClick={onClose}
          className="
            rounded-lg
            bg-[var(--nd-brand)] hover:bg-[var(--nd-brand-hover)] active:bg-[#d57768]
            text-neutral-950 font-medium
            px-4 py-1.5
            text-[13px]
            outline-none focus-visible:ring-2 focus-visible:ring-[var(--nd-brand)]/50
            active:scale-95 transition-all cursor-pointer shadow-xs
          "
        >
          Done
        </button>
      </div>
    </div>
  );
}
