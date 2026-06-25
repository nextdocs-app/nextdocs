'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  documentService,
  type Collaborator,
  type DocumentAccessLevel,
  type DocumentGeneralAccessMode,
  type SharingSettings,
} from '@/services/document.service';
import { useAuth } from '@/hooks/useAuth.hook';
import { getPresenceColor } from '@/lib/realtime.util';
import { ChainLink, Check, ChevronDown, Close, GlobeSolid, Lock } from '@/icons';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SharePanelProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_LABELS: Record<string, string> = {
  VIEW: 'Viewer',
  COMMENT: 'Commenter',
  EDIT: 'Editor',
  OWNER: 'Owner',
};

const ACCESS_ACTION_LABELS: Record<string, string> = {
  VIEW: 'view',
  COMMENT: 'comment',
  EDIT: 'edit',
  OWNER: 'own',
};

const ACCESS_OPTIONS: DocumentAccessLevel[] = ['VIEW', 'COMMENT', 'EDIT'];

// ─── Avatar ───────────────────────────────────────────────────────────────────
// Uses the same getPresenceColor as the realtime cursor so colours always match.

function Avatar({ seed, label }: { seed: string; label: string }) {
  const normalizedLabel = (label ?? '').trim();
  const initial = (normalizedLabel || '?').charAt(0).toUpperCase();
  const bg = getPresenceColor(seed);
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[14px] font-semibold text-white select-none"
      style={{ backgroundColor: bg }}
    >
      {initial}
    </span>
  );
}

// ─── Custom Dropdown ─────────────────────────────────────────────────────────
// Styled to look like native Google-Docs-style inline text dropdown.

interface DropdownOption {
  value: string;
  label: string;
  description?: string;
}

function AccessDropdown({
  value,
  options,
  onChange,
  disabled,
  align = 'right',
}: {
  value: string;
  options: DropdownOption[];
  onChange: (val: string) => void;
  disabled?: boolean;
  align?: 'left' | 'right';
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

  // Close on outside click
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

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleOpen}
        className="
          inline-flex items-center gap-1 rounded-md px-1.5 py-1
          text-[13px] font-medium text-foreground
          hover:bg-sidebar-accent
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-colors cursor-pointer select-none
          outline-none focus-visible:ring-1 focus-visible:ring-foreground/30
        "
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown
          size={14}
          className={`h-3.5 w-3.5 flex-shrink-0 text-foreground/50 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
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
            z-[9999] min-w-[8.5rem]
            rounded-xl border border-border bg-background
            shadow-[0_4px_20px_-2px_rgba(0,0,0,0.14),0_2px_6px_-2px_rgba(0,0,0,0.08)]
            dark:shadow-[0_4px_20px_-2px_rgba(0,0,0,0.5)]
            py-1 overflow-hidden
            animate-in fade-in slide-in-from-top-1 duration-100
          "
        >
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`
                  w-full flex items-center gap-2.5 px-3 py-2 text-left
                  text-[13px] text-foreground cursor-pointer
                  hover:bg-sidebar-accent transition-colors
                  ${isSelected ? 'font-semibold' : 'font-normal'}
                `}
              >
                <span className="flex-shrink-0 w-3.5">
                  {isSelected && <Check size={14} className="h-3.5 w-3.5 text-foreground" />}
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SharePanel({ documentId, isOpen, onClose, anchorRef }: SharePanelProps) {
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

  const owner = useMemo(
    () => collaborators.find((c) => c.accessLevel === 'OWNER') ?? null,
    [collaborators]
  );
  const nonOwners = useMemo(
    () => collaborators.filter((c) => c.accessLevel !== 'OWNER'),
    [collaborators]
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

        // Ensure it doesn't go off screen
        const panelWidth = 448; // 28rem
        const minMargin = 16;

        // maxRightValue ensures panel's left edge doesn't go off screen left
        const maxRightValue = Math.max(minMargin, window.innerWidth - panelWidth - minMargin);

        // Keep right within [minMargin, maxRightValue]
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
        const [cols, sett] = await Promise.all([
          documentService.listCollaborators(documentId, accessToken),
          documentService.getSharingSettings(documentId, accessToken),
        ]);
        if (!cancelled) {
          setCollaborators(cols);
          setSettings(sett);
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
  }, [isOpen, isAuthenticated, accessToken, documentId]);

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
      )
        onClose();
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

  const handleAccessChange = async (userId: string, level: DocumentAccessLevel) => {
    if (!accessToken) return;
    try {
      const updated = await documentService.updateCollaboratorAccess(
        documentId,
        userId,
        level,
        accessToken
      );
      setCollaborators((prev) => prev.map((c) => (c.userId === userId ? updated : c)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update access');
    }
  };

  const handleRemove = async (userId: string) => {
    if (!accessToken) return;
    try {
      await documentService.removeCollaborator(documentId, userId, accessToken);
      setCollaborators((prev) => prev.filter((c) => c.userId !== userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove collaborator');
    }
  };

  const handleGeneralModeChange = async (mode: DocumentGeneralAccessMode) => {
    if (!accessToken || !settings) return;
    try {
      setIsSavingSettings(true);
      const payload =
        mode === 'ANYONE_WITH_LINK'
          ? { generalAccessMode: mode, linkAccessLevel: settings.linkAccessLevel }
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

  // Copy the current page URL — no token generation needed.
  // The document's generalAccessMode controls who can open it.
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

  const isAnyoneWithLink = settings?.generalAccessMode === 'ANYONE_WITH_LINK';
  const accessOpts = ACCESS_OPTIONS.map((o) => ({ value: o, label: ACCESS_LABELS[o] }));
  const generalModeOpts: DropdownOption[] = [
    { value: 'RESTRICTED', label: 'Restricted' },
    { value: 'ANYONE_WITH_LINK', label: 'Anyone with the link' },
  ];

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
        w-[28rem]
        rounded-2xl
        bg-background
        shadow-[0_8px_40px_-4px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.1)]
        dark:shadow-[0_8px_40px_-4px_rgba(0,0,0,0.55)]
        border border-border/60
        overflow-hidden
        animate-in fade-in slide-in-from-top-1 duration-150
      "
    >
      {/* ── Invite input ─────────────────────────────── */}
      <div className="px-5 pt-5 pb-4">
        {!isAuthenticated || !accessToken ? (
          <p className="py-2 text-sm text-muted-foreground">Sign in to manage sharing.</p>
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
                  flex-1 min-w-0 rounded-lg border border-border bg-background
                  px-3.5 py-2 text-[13.5px] text-foreground
                  placeholder:text-muted-foreground/55
                  outline-none focus:border-foreground/35
                  transition-colors
                "
              />

              {inviteEmail.trim().length > 0 && (
                <>
                  <AccessDropdown
                    value={inviteAccess}
                    options={accessOpts}
                    onChange={(v) => setInviteAccess(v as DocumentAccessLevel)}
                    align="right"
                  />
                  <button
                    type="button"
                    onClick={() => void handleInvite()}
                    disabled={isSavingInvite}
                    className="
                      flex-shrink-0 rounded-full bg-[#d7897f] hover:bg-[#C97B71]
                      focus-visible:ring-2 focus-visible:ring-[#C06D5B]/50 focus:bg-[#F2BEB6]
                      px-5 py-2 text-black/85 font-medium tracking-wide
                      text-[13px]
                      active:bg-[#B86D63] active:scale-95 transition-all cursor-pointer
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

      {/* ── Body ─────────────────────────────────────── */}
      {isAuthenticated && accessToken && (
        <div className="max-h-[58vh] overflow-y-auto">
          {isLoading ? (
            <div className="space-y-4 px-5 pb-4">
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-sidebar-accent/40 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-36 rounded bg-sidebar-accent/40 animate-pulse" />
                    <div className="h-2.5 w-52 rounded bg-sidebar-accent/30 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              {/* ── People with access ── */}
              {(owner || nonOwners.length > 0) && (
                <section className="px-5 pb-3">
                  <p className="mb-2 text-[13px] font-semibold text-foreground">
                    People with access
                  </p>
                  <ul className="space-y-0.5">
                    {/* Owner */}
                    {owner && (
                      <li className="flex items-center gap-3 py-1.5">
                        <Avatar seed={owner.userId} label={owner.displayName || owner.email} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13.5px] font-medium text-foreground truncate leading-snug">
                            {owner.displayName || owner.email}
                            {owner.userId === user?.id && (
                              <span className="font-normal text-muted-foreground"> (you)</span>
                            )}
                          </p>
                          <p className="text-[12px] text-muted-foreground/65 truncate leading-snug">
                            {owner.email}
                          </p>
                        </div>
                        <span className="flex-shrink-0 pr-1 text-[13px] text-muted-foreground">
                          Owner
                        </span>
                      </li>
                    )}

                    {/* Non-owners */}
                    {nonOwners.map((collab) => (
                      <li
                        key={collab.userId}
                        className="flex items-center gap-3 py-1.5 group/collab"
                      >
                        <Avatar seed={collab.userId} label={collab.displayName || collab.email} />
                        <div className="flex-1 min-w-0">
                          <p className="text-[13.5px] font-medium text-foreground truncate leading-snug">
                            {collab.displayName || collab.email}
                            {collab.userId === user?.id && (
                              <span className="font-normal text-muted-foreground"> (you)</span>
                            )}
                          </p>
                          <p className="text-[12px] text-muted-foreground/65 truncate leading-snug">
                            {collab.email}
                          </p>
                        </div>
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                          <AccessDropdown
                            value={collab.accessLevel}
                            options={accessOpts}
                            onChange={(v) =>
                              void handleAccessChange(collab.userId, v as DocumentAccessLevel)
                            }
                            align="right"
                          />
                          <button
                            type="button"
                            onClick={() => void handleRemove(collab.userId)}
                            aria-label="Remove collaborator"
                            className="
                              p-1 rounded-md opacity-0 group-hover/collab:opacity-100 focus-visible:opacity-100
                              text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10
                              focus-visible:text-destructive focus-visible:bg-destructive/10
                              transition-all cursor-pointer
                            "
                          >
                            <Close size={14} className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {/* ── General access ── */}
              <section className="mt-1">
                <p className="px-5 mb-2 text-[13px] font-semibold text-foreground">
                  General access
                </p>

                <div className="mx-3 rounded-xl px-3 py-3 flex items-center gap-3 hover:bg-sidebar-accent/50 dark:hover:bg-sidebar-accent/35 transition-colors cursor-default">
                  <span
                    className={`
                      inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full
                      ${
                        isAnyoneWithLink
                          ? 'bg-emerald-600/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400'
                          : 'bg-sidebar-accent text-muted-foreground'
                      }
                    `}
                  >
                    {isAnyoneWithLink ? (
                      <GlobeSolid className="h-5 w-5" />
                    ) : (
                      <Lock className="h-5 w-5" />
                    )}
                  </span>

                  <div className="flex-1 min-w-0">
                    <AccessDropdown
                      value={settings?.generalAccessMode ?? 'RESTRICTED'}
                      options={generalModeOpts}
                      onChange={(v) => void handleGeneralModeChange(v as DocumentGeneralAccessMode)}
                      disabled={isSavingSettings}
                      align="left"
                    />
                    <p className="text-[12px] text-muted-foreground/70 leading-snug mt-0.5 pl-1">
                      {isAnyoneWithLink
                        ? `Anyone on the internet with the link can ${ACCESS_ACTION_LABELS[settings?.linkAccessLevel ?? 'VIEW'] ?? 'view'}`
                        : 'Only people with access can open with the link'}
                    </p>
                  </div>

                  {isAnyoneWithLink && (
                    <AccessDropdown
                      value={settings?.linkAccessLevel ?? 'VIEW'}
                      options={accessOpts}
                      onChange={(v) => void handleLinkAccessChange(v as DocumentAccessLevel)}
                      disabled={isSavingSettings}
                      align="right"
                    />
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      )}

      {/* ── Footer ──────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-4 mt-2 border-t border-border/50">
        <button
          type="button"
          onClick={() => void handleCopyLink()}
          className="
            inline-flex items-center gap-2 rounded-full
            border border-border px-4 py-2
            text-[13px] font-medium text-foreground
            hover:bg-sidebar-accent
            active:scale-95 transition-all cursor-pointer
          "
        >
          <ChainLink className="h-4 w-4" />
          {copied ? 'Copied!' : 'Copy link'}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="
            rounded-full bg-[#d7897f] hover:bg-[#C97B71]
            focus-visible:ring-2 focus-visible:ring-[#C06D5B]/50 focus:bg-[#F2BEB6]
            px-6 py-2 text-black/85 font-semibold tracking-wide
            text-[13px]
            active:bg-[#B86D63] active:scale-95 transition-all cursor-pointer
          "
        >
          Done
        </button>
      </div>
    </div>
  );
}
