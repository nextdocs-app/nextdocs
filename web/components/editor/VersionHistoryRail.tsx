'use client';

import { useLayoutEffect, useRef } from 'react';
import type { VersioningController } from '@blocknote/core/extensions';
import { useBlockNoteEditor, useComponentsContext, useStore } from '@blocknote/react';
import { DefaultVersionMenuItems } from '@blocknote/react/versioning';
import { menuSurfaceClassName } from '@/components/menu-surface';
import { useIsMobileLayout } from '@/hooks/useMediaQuery.hook';
import { Close, Restore } from '@/icons/index';
import { computeMenuPosition } from '@/lib/menu-position.util';
import { useAppDispatch } from '@/stores/hooks';
import { addToast } from '@/stores/toasts/toasts.slice';

/**
 * Places the open version-row menu the way the navigation sidebar places its
 * document-actions menu: below the row's trigger, straddling the rail's right
 * edge. BlockNote clamps its own menu inside the rail, which hides the surface
 * and stacks it over the neighbouring rows.
 */
function VersionSnapshotMenuPositioner() {
  const isMobileLayout = useIsMobileLayout();
  const markerRef = useRef<HTMLSpanElement | null>(null);

  useLayoutEffect(() => {
    const menu = markerRef.current?.parentElement;
    const positioner = menu?.parentElement;
    const rail = menu?.closest<HTMLElement>('.nd-version-history-rail');
    if (!menu || !positioner || !rail) {
      return;
    }

    const resetPlacement = () => {
      delete positioner.dataset.ndVersionMenuPositioned;
      positioner.style.removeProperty('--nd-version-menu-left');
      positioner.style.removeProperty('--nd-version-menu-top');
      menu.style.visibility = '';
    };

    const place = () => {
      const trigger = rail.querySelector<HTMLElement>(
        '.bn-snapshot-menu-trigger[aria-expanded="true"]'
      );
      if (!trigger) {
        // Fail open: BlockNote's own placement is better than a hidden menu.
        resetPlacement();
        return;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const railRect = rail.getBoundingClientRect();
      // The dropdown's open animation scales it to 95%, which would make a
      // bounding-rect measurement undersize the menu during the first frame.
      // Layout dimensions ignore that transform.
      const { left, top } = computeMenuPosition({
        trigger: triggerRect,
        menu: { width: menu.offsetWidth, height: menu.offsetHeight },
        viewport: { width: window.innerWidth, height: window.innerHeight },
        anchorEdgeX: railRect.right,
        alignment: isMobileLayout ? 'after-edge' : 'straddle',
      });

      // The positioned element is `position: fixed`, so its offsets are viewport
      // coordinates even though it lives inside the rail (which only carries a
      // transform during its entry animation).
      positioner.style.setProperty('--nd-version-menu-left', `${left}px`);
      positioner.style.setProperty('--nd-version-menu-top', `${top}px`);
      positioner.dataset.ndVersionMenuPositioned = 'true';
      menu.style.visibility = '';
    };

    // A layout effect runs before paint, so hiding the menu until it is measured
    // costs no visible frame and leaves BlockNote's placement in charge when the
    // rail or the trigger cannot be found.
    menu.style.visibility = 'hidden';
    const sizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    sizeObserver?.observe(menu);
    place();
    window.addEventListener('resize', place);
    return () => {
      sizeObserver?.disconnect();
      window.removeEventListener('resize', place);
      menu.style.visibility = '';
    };
  }, [isMobileLayout]);

  return <span ref={markerRef} hidden aria-hidden="true" />;
}

export function VersionSnapshotMenu() {
  const components = useComponentsContext();
  if (!components) {
    return null;
  }

  // BlockNote's “...” dropdown, wearing the same surface as every other
  // floating menu in the app. `ring-0` cancels the shadcn dropdown's default
  // ring so only the shared border shows.
  return (
    <components.Generic.Menu.Dropdown
      className={`bn-menu-dropdown bn-version-menu ${menuSurfaceClassName} ring-0`}
    >
      <VersionSnapshotMenuPositioner />
      <DefaultVersionMenuItems />
    </components.Generic.Menu.Dropdown>
  );
}

/**
 * Restore / close controls for the history view. This component is portaled into
 * the document toolbar but stays inside BlockNoteView, so it can read the Yhub
 * version controller and mirror the sidebar's restore action.
 */
export function VersionHistoryToolbarActions({ onClose }: { onClose: () => void }) {
  const editor = useBlockNoteEditor();
  const versioning = editor.getExtension('versioning') as VersioningController | undefined;

  return (
    <>
      {versioning && <VersionRestoreButton versioning={versioning} onClose={onClose} />}
      {/* Close is unconditional: a missing controller must never trap the view. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close version history"
        title="Close version history"
        className="
          inline-flex h-9 w-9 items-center justify-center rounded-sm
          text-foreground transition-colors duration-150
          hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-primary
          focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
          md:h-[30px] md:w-[30px]
        "
      >
        <Close size={16} />
      </button>
    </>
  );
}

function VersionRestoreButton({
  versioning,
  onClose,
}: {
  versioning: VersioningController;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const state = useStore(versioning.store);

  const pending = state.mode === 'versions' ? state.pending : undefined;
  const displayed = state.mode === 'versions' ? state.displayed : undefined;
  const selection = pending ?? displayed;
  const snapshotId = selection?.type === 'snapshot' ? selection.id : undefined;
  // Yhub's continuous-history storage sets showCurrentVersion false, so its
  // newest checkpoint is the row the sidebar labels Current. Restoring it would
  // be a no-op and must stay disabled, just like the sidebar's own menu item.
  const currentSnapshotId =
    state.mode === 'versions' && state.showCurrentVersion === false
      ? state.history.data?.[0]?.id
      : undefined;
  const isCurrent = selection?.type !== 'snapshot' || selection.id === currentSnapshotId;
  const restoring = state.mode === 'versions' && state.restoring;
  const canRestore =
    versioning.canRestore && !!snapshotId && !isCurrent && pending === undefined && !restoring;

  const handleRestore = async () => {
    if (!snapshotId || !canRestore) {
      return;
    }

    try {
      const result = await versioning.restore(snapshotId);
      if (result.status === 'done') {
        onClose();
        return;
      }
      if (result.status !== 'cancelled') {
        dispatch(
          addToast({
            type: 'error',
            message: 'Could not restore this version. Please try again.',
          })
        );
      }
    } catch (error) {
      console.warn('Failed to restore document version:', error);
      dispatch(
        addToast({
          type: 'error',
          message: 'Could not restore this version. Please try again.',
        })
      );
    }
  };

  if (!versioning.canRestore) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleRestore}
      disabled={!canRestore}
      aria-label="Restore version"
      title={canRestore ? 'Restore this version' : 'Select an earlier version to restore'}
      className="
        nd-version-restore inline-flex h-9 items-center justify-center gap-1.5 rounded-sm
        px-2.5 text-[13.5px] font-medium leading-none text-neutral-950
        transition-colors duration-150
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nd-brand-ring)]/60
        md:h-[30px] md:px-3
      "
    >
      <Restore size={15} />
      <span className="hidden sm:inline">Restore</span>
    </button>
  );
}
