'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  documentService,
  type Collaborator,
  type CollaboratorAccessLevel,
  type DocumentAccessLevel,
  type DocumentGeneralAccessMode,
  type SharingSettings,
} from '@/services/document.service';
import { useAuth } from '@/hooks/useAuth.hook';
import { getPresenceColor } from '@/lib/realtime.util';
import { ChainLink, Check, ChevronDown, Close, Globe, Lock } from '@/icons';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SharePanelProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  canManageSharing?: boolean;
  onNavigate?: (documentId: string) => void;
}

interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  dividerBefore?: boolean;
  isDestructive?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_LABELS: Record<string, string> = {
  VIEW: 'Can view',
  COMMENT: 'Can comment',
  EDIT: 'Can edit',
  OWNER: 'Full access',
  NO_ACCESS: 'No access',
};

const ACCESS_ACTION_LABELS: Record<string, string> = {
  VIEW: 'view',
  COMMENT: 'comment',
  EDIT: 'edit',
  OWNER: 'manage',
  NO_ACCESS: 'no access',
};

const INVITE_ACCESS_OPTIONS: DropdownOption[] = [
  { value: 'OWNER', label: 'Full access', description: 'Can edit and share' },
  { value: 'EDIT', label: 'Can edit' },
  { value: 'COMMENT', label: 'Can comment' },
  { value: 'VIEW', label: 'Can view' },
];

const LINK_ACCESS_OPTIONS: DropdownOption[] = [
  { value: 'VIEW', label: 'Can view' },
  { value: 'COMMENT', label: 'Can comment' },
  { value: 'EDIT', label: 'Can edit' },
];

const GENERAL_MODE_OPTIONS: DropdownOption[] = [
  { value: 'RESTRICTED', label: 'Restricted', description: 'Only people with access can open' },
  {
    value: 'ANYONE_WITH_LINK',
    label: 'Anyone with the link',
    description: 'Anyone with link can access',
  },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function Avatar({ seed, label }: { seed: string; label: string }) {
  const normalizedLabel = (label ?? '').trim();
  const initial = (normalizedLabel || '?').charAt(0).toUpperCase();
  const bg = getPresenceColor(seed);
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white select-none shadow-xs"
      style={{ backgroundColor: bg }}
    >
      {initial}
    </span>
  );
}

function AccessDropdown({
  value,
  options,
  onChange,
  disabled,
  align = 'right',
  ariaLabel,
  muted = false,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (val: string) => void;
  disabled?: boolean;
  align?: 'left' | 'right';
  ariaLabel?: string;
  muted?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  const handleOpen = () => {
    if (disabled) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) {
      setCoords({
        top: rect.bottom + 4,
        left: rect.left,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const isDestructive = value === 'NO_ACCESS';

  return (
    <div className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        aria-label={ariaLabel || selected?.label || ACCESS_LABELS[value] || value}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`
          inline-flex items-center gap-1.5 rounded-md px-2 py-1
          text-[13px] font-medium
          ${
            isDestructive
              ? 'text-destructive dark:text-red-400'
              : muted
                ? 'text-muted-foreground/80'
                : 'text-foreground'
          }
          hover:bg-sidebar-accent
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors cursor-pointer select-none
          outline-none focus-visible:ring-1 focus-visible:ring-ring
        `}
      >
        <span>{selected?.label ?? ACCESS_LABELS[value] ?? value}</span>
        <ChevronDown
          size={13}
          className={`h-3.5 w-3.5 flex-shrink-0 ${
            isDestructive
              ? 'text-destructive dark:text-red-400'
              : muted
                ? 'text-muted-foreground/80'
                : 'text-muted-foreground'
          } transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          ref={menuRef}
          role="listbox"
          style={
            align === 'right'
              ? { position: 'fixed', top: coords.top, right: coords.right }
              : { position: 'fixed', top: coords.top, left: coords.left }
          }
          className="
            z-[9999] min-w-[12rem]
            rounded-xl border border-border dark:border-white/10 bg-card text-card-foreground
            shadow-[0_8px_24px_-4px_rgba(0,0,0,0.12),0_2px_6px_-2px_rgba(0,0,0,0.08)]
            dark:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.55)]
            py-1.5 overflow-hidden
            animate-in fade-in slide-in-from-top-1 duration-100
          "
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div key={opt.value}>
                {opt.dividerBefore && (
                  <div
                    role="separator"
                    className="my-1 border-t border-border/70 dark:border-white/10"
                  />
                )}
                <button
                  type="button"
                  role="option"
                  aria-label={opt.label}
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`
                    w-full flex items-center justify-between px-3 py-2 text-left
                    text-[13px] cursor-pointer transition-colors
                    ${
                      opt.isDestructive
                        ? 'text-destructive dark:text-red-400 hover:bg-destructive/10 dark:hover:bg-red-500/10'
                        : 'text-card-foreground hover:bg-sidebar-accent'
                    }
                    ${isSelected ? 'font-medium bg-sidebar-accent/50' : 'font-normal'}
                  `}
                >
                  <div className="flex flex-col min-w-0 pr-2">
                    <span className="truncate">{opt.label}</span>
                    {opt.description && (
                      <span className="text-[11px] text-muted-foreground">{opt.description}</span>
                    )}
                  </div>
                  {isSelected && (
                    <Check size={14} className="h-3.5 w-3.5 text-foreground flex-shrink-0 ml-2" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
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

  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

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

    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        if (!canManageSharing) {
          setSettings(null);
          const cols = await documentService.listCollaborators(documentId, accessToken);
          if (!cancelled) {
            setCollaborators(cols);
            setSettings(null);
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
      if (e.key === 'Escape') onClose();
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
      await documentService.upsertCollaborator(
        documentId,
        { email: inviteEmail.trim(), accessLevel: inviteAccess },
        accessToken
      );
      const next = await documentService.listCollaborators(documentId, accessToken);
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
      await documentService.updateCollaboratorAccess(documentId, userId, level, accessToken);
      const next = await documentService.listCollaborators(documentId, accessToken);
      setCollaborators(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update access');
    }
  };

  const handleRemove = async (userId: string) => {
    if (!accessToken) return;
    try {
      setError(null);
      await documentService.removeCollaborator(documentId, userId, accessToken);
      const next = await documentService.listCollaborators(documentId, accessToken);
      setCollaborators(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove collaborator');
    }
  };

  const handleCollaboratorAccessSelect = (collab: Collaborator, nextValue: string) => {
    if (nextValue === 'INHERIT') {
      void handleRemove(collab.userId);
    } else {
      void handleAccessChange(collab.userId, nextValue as CollaboratorAccessLevel);
    }
  };

  const getCollaboratorRowOptions = (collab: Collaborator): DropdownOption[] => {
    const options: DropdownOption[] = [
      { value: 'OWNER', label: 'Full access' },
      { value: 'EDIT', label: 'Can edit' },
      { value: 'COMMENT', label: 'Can comment' },
      { value: 'VIEW', label: 'Can view' },
    ];

    if (!collab.inherited && collab.inheritedFromTitle) {
      const parentTitle = collab.inheritedFromTitle.trim().replace(/\s+/g, ' ');
      const parentLevel = collab.inheritedAccessLevel
        ? ACCESS_LABELS[collab.inheritedAccessLevel] || collab.inheritedAccessLevel
        : null;
      const inheritLabel = parentLevel
        ? `Inherit from ${parentTitle} (${parentLevel})`
        : `Inherit from ${parentTitle}`;
      options.push({
        value: 'INHERIT',
        label: inheritLabel,
      });
    }

    options.push({
      value: 'NO_ACCESS',
      label: 'No access',
      dividerBefore: true,
      isDestructive: true,
    });

    return options;
  };

  const handleGeneralModeChange = async (mode: DocumentGeneralAccessMode) => {
    if (!accessToken || !settings) return;
    try {
      setIsSavingSettings(true);
      const payload =
        mode === 'ANYONE_WITH_LINK'
          ? { generalAccessMode: mode, linkAccessLevel: settings.linkAccessLevel || 'VIEW' }
          : { generalAccessMode: mode };
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
      const next = await documentService.updateSharingSettings(
        documentId,
        { generalAccessMode: settings.generalAccessMode, linkAccessLevel: level },
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
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setCopied(false);
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

  const hasOwnPublicLink = settings?.generalAccessMode === 'ANYONE_WITH_LINK';
  const isInheritedPublicLink = Boolean(settings?.inherited);
  // A child can be RESTRICTED and still be effectively public through an ancestor's link.
  const hasEffectivePublicLink =
    Boolean(settings?.hasActiveLink) || hasOwnPublicLink || isInheritedPublicLink;
  const inheritedFromTitle = (settings?.inheritedFromTitle || 'parent').trim().replace(/\s+/g, ' ');
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
                    onChange={(v) => setInviteAccess(v as DocumentAccessLevel)}
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
              {collaborators.length > 0 && (
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
                      const isInherited = Boolean(collab.inherited);
                      // Any inherited grant is overridable here, including an ancestor
                      // full-access grant; only the document's own owner stays locked.
                      const canEditRow = canManageSharing && !isSelf && !isDirectOwner;

                      return (
                        <li
                          key={collab.userId}
                          className="flex flex-col py-1.5 px-1.5 rounded-lg hover:bg-sidebar-accent/40 transition-colors group/collab"
                        >
                          <div className="flex items-center gap-2.5">
                            <Avatar
                              seed={collab.userId}
                              label={collab.displayName || collab.email}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="text-[13.5px] font-medium text-card-foreground truncate leading-snug min-w-0">
                                  {collab.displayName || collab.email}
                                </span>
                                {isSelf && (
                                  <span className="text-[12px] font-normal text-muted-foreground whitespace-nowrap flex-shrink-0">
                                    (you)
                                  </span>
                                )}
                                {isInherited &&
                                  (collab.inheritedFromId ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        collab.inheritedFromId &&
                                        handleNavigate(collab.inheritedFromId)
                                      }
                                      title={`Inherited via ${(collab.inheritedFromTitle || 'parent').trim()}`}
                                      className="inline-block max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted text-muted-foreground align-middle flex-shrink-0 hover:bg-muted-foreground/15 hover:text-foreground transition-colors cursor-pointer"
                                    >
                                      via{' '}
                                      {(collab.inheritedFromTitle || 'parent')
                                        .trim()
                                        .replace(/\s+/g, ' ')}
                                    </button>
                                  ) : (
                                    <span
                                      title={`Inherited via ${(collab.inheritedFromTitle || 'parent').trim()}`}
                                      className="inline-block max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted text-muted-foreground align-middle flex-shrink-0"
                                    >
                                      via{' '}
                                      {(collab.inheritedFromTitle || 'parent')
                                        .trim()
                                        .replace(/\s+/g, ' ')}
                                    </span>
                                  ))}
                                {!isInherited &&
                                  Boolean(collab.inheritedFromTitle) &&
                                  (collab.inheritedFromId ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        collab.inheritedFromId &&
                                        handleNavigate(collab.inheritedFromId)
                                      }
                                      title={`Overrides ${(collab.inheritedFromTitle || 'parent').trim()}`}
                                      className="inline-block max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted text-muted-foreground align-middle flex-shrink-0 hover:bg-muted-foreground/15 hover:text-foreground transition-colors cursor-pointer"
                                    >
                                      Overrides{' '}
                                      {(collab.inheritedFromTitle || 'parent')
                                        .trim()
                                        .replace(/\s+/g, ' ')}
                                    </button>
                                  ) : (
                                    <span
                                      title={`Overrides ${(collab.inheritedFromTitle || 'parent').trim()}`}
                                      className="inline-block max-w-[140px] truncate rounded px-1.5 py-0.5 text-[10.5px] font-medium bg-muted text-muted-foreground align-middle flex-shrink-0"
                                    >
                                      Overrides{' '}
                                      {(collab.inheritedFromTitle || 'parent')
                                        .trim()
                                        .replace(/\s+/g, ' ')}
                                    </span>
                                  ))}
                              </div>
                              <p className="text-[12px] text-muted-foreground/70 truncate leading-snug mt-0.5">
                                {collab.email}
                              </p>
                            </div>

                            {canEditRow ? (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <AccessDropdown
                                  value={collab.accessLevel}
                                  options={getCollaboratorRowOptions(collab)}
                                  onChange={(v) => handleCollaboratorAccessSelect(collab, v)}
                                  align="right"
                                  muted
                                />
                              </div>
                            ) : (
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[13px] text-muted-foreground/80 font-medium select-none">
                                  <span>
                                    {ACCESS_LABELS[collab.accessLevel] ?? collab.accessLevel}
                                  </span>
                                </span>
                              </div>
                            )}
                          </div>

                          {collab.accessLevel === 'NO_ACCESS' && hasEffectivePublicLink && (
                            <p className="mt-1 pl-10 text-[11.5px] text-amber-600 dark:text-amber-400/90 leading-tight">
                              {collab.displayName || collab.email} is blocked while signed in;
                              anyone with the public link can still {effectiveLinkAction} this
                              document.
                            </p>
                          )}
                        </li>
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
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <div className="-ml-1">
                          <AccessDropdown
                            value={settings?.generalAccessMode ?? 'RESTRICTED'}
                            options={GENERAL_MODE_OPTIONS}
                            onChange={(v) =>
                              void handleGeneralModeChange(v as DocumentGeneralAccessMode)
                            }
                            disabled={isSavingSettings}
                            align="left"
                          />
                        </div>

                        {hasOwnPublicLink && (
                          <div className="flex-shrink-0">
                            <AccessDropdown
                              value={settings?.linkAccessLevel ?? 'VIEW'}
                              options={LINK_ACCESS_OPTIONS}
                              onChange={(v) =>
                                void handleLinkAccessChange(v as DocumentAccessLevel)
                              }
                              disabled={isSavingSettings}
                              align="right"
                            />
                          </div>
                        )}
                      </div>

                      <p className="flex flex-wrap items-center gap-x-1 pb-1.5 pl-1 text-[12px] text-muted-foreground/70 leading-snug">
                        <span>
                          {hasEffectivePublicLink
                            ? `Anyone on the internet with the link can ${effectiveLinkAction}`
                            : 'Only people with access can open with the link'}
                        </span>
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
                      </p>
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
