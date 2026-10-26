'use client';

import { useEffect, useRef, useState } from 'react';
import { useIsTouchInput } from '@/hooks/useMediaQuery.hook';
import { useResolvedAssetUrl } from '@/hooks/useResolvedAssetUrl.hook';
import { useAppSelector } from '@/stores/hooks';
import {
  clampCoverPosition,
  commitDragPosition,
  coverObjectPosition,
  coverPositionAfterDrag,
  sanitizeDocumentCover,
} from '@/lib/document-icon.util';
import type { DocumentCover } from '@/types/document.types';

const KEYBOARD_STEP = 0.02;
const KEYBOARD_STEP_COARSE = 0.1;

/**
 * Class that shows or hides the action strip.
 *
 * Touch input has nothing to hover with, so a strip that only revealed itself on
 * hover would be permanently parked over the image. Tapping the banner reveals it
 * instead, and while it is hidden it is also inert: a tap in that bottom corner
 * would otherwise land on a button nobody can see, one of which removes the cover.
 */
function actionsVisibilityClass(isVisible: boolean, isTouchInput: boolean): string {
  if (isVisible) {
    return 'opacity-100';
  }
  if (isTouchInput) {
    return 'opacity-0 pointer-events-none';
  }
  return 'opacity-0 group-hover/cover:opacity-100 group-focus-within/cover:opacity-100';
}

/**
 * The page's cover banner.
 *
 * The focal offset is stored as a single number in [0, 1] rather than a pixel
 * offset, so the same value crops a phone banner and a desktop one sensibly,
 * and it survives every viewport change. Repositioning is a 1:1 vertical drag
 * (with arrow-key equivalents) that commits once, on release.
 */
export function PageCover({
  cover,
  canEdit,
  triggerRef,
  accessToken: accessTokenProp,
  onRequestChange,
  onRemove,
  onPositionChange,
}: {
  cover: DocumentCover;
  canEdit: boolean;
  /** The picker anchors to "Change cover"; this is that button. */
  triggerRef?: React.RefObject<HTMLButtonElement | null>;
  /**
   * Session token for minting upload URLs. Falls back to the auth store so
   * non-header callers do not have to thread it.
   */
  accessToken?: string | null;
  onRequestChange: () => void;
  onRemove: () => void;
  onPositionChange: (position: number) => void;
}) {
  const storeToken = useAppSelector((state) => state?.auth?.accessToken ?? null);
  const accessToken = accessTokenProp ?? storeToken;
  // Render boundary: same stale/hand-crafted risk as PageIcon. Resolve the hook
  // before the early return (hooks order), then degrade an invalid cover to nothing.
  const safeCover = sanitizeDocumentCover(cover);
  const url = useResolvedAssetUrl(safeCover, accessToken);
  const isTouchInput = useIsTouchInput();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ pointerY: number; position: number } | null>(null);
  // rAF throttle for pointermove (fires at ~60Hz): the drag math is pure but
  // setState per event re-renders at event cadence, so the latest position is
  // staged here and flushed once per frame.
  const moveFrameRef = useRef<number | null>(null);
  const pendingDragPositionRef = useRef<number | null>(null);
  const [isRepositioning, setIsRepositioning] = useState(false);
  const [isActionsRevealed, setIsActionsRevealed] = useState(false);
  const [dragPosition, setDragPosition] = useState<number | null>(null);

  const position = dragPosition ?? safeCover?.position ?? 0.5;
  const areActionsVisible = isRepositioning || isActionsRevealed;

  // A touch reader usually taps the page somewhere else entirely once they are
  // done, so the strip has to notice that rather than wait to be dismissed.
  useEffect(() => {
    if (!isTouchInput || !isActionsRevealed) {
      return;
    }

    const dismissOnOutsidePointerDown = (event: PointerEvent) => {
      if (frameRef.current?.contains(event.target as Node)) {
        return;
      }
      setIsActionsRevealed(false);
    };

    document.addEventListener('pointerdown', dismissOnOutsidePointerDown);
    return () => document.removeEventListener('pointerdown', dismissOnOutsidePointerDown);
  }, [isTouchInput, isActionsRevealed]);

  // A pending rAF must never fire after unmount (setState on unmounted).
  // Above the early return with the other hooks: hooks order must not depend
  // on whether the cover sanitizes.
  useEffect(() => {
    return () => {
      if (moveFrameRef.current !== null) {
        cancelAnimationFrame(moveFrameRef.current);
        moveFrameRef.current = null;
      }
    };
  }, []);

  if (!safeCover) {
    return null;
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isRepositioning) {
      if (isTouchInput) {
        setIsActionsRevealed((prev) => !prev);
      }
      return;
    }
    if ((event.target as HTMLElement).closest('button')) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    // Start from the displayed position, not the committed one, so pending
    // keyboard steps are not discarded when a drag begins.
    dragStartRef.current = { pointerY: event.clientY, position };
    setDragPosition(position);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    const height = frameRef.current?.getBoundingClientRect().height ?? 0;
    if (!start || height <= 0) {
      return;
    }
    const next = coverPositionAfterDrag({
      startPosition: start.position,
      startPointerY: start.pointerY,
      pointerY: event.clientY,
      coverHeight: height,
    });
    // Coalesce 60Hz pointermove into one state update per frame.
    if (moveFrameRef.current !== null) {
      pendingDragPositionRef.current = next;
      return;
    }
    pendingDragPositionRef.current = next;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      if (pendingDragPositionRef.current !== null) {
        setDragPosition(pendingDragPositionRef.current);
        pendingDragPositionRef.current = null;
      }
    });
  };

  const cancelPendingMove = () => {
    if (moveFrameRef.current !== null) {
      cancelAnimationFrame(moveFrameRef.current);
      moveFrameRef.current = null;
    }
    pendingDragPositionRef.current = null;
  };

  // Single commit gate for the staged drag/keyboard position. Flushes a
  // pending rAF position first: releasing mid-frame must commit the latest
  // pointer position, not the last flushed one.
  const commitStagedPosition = () => {
    const finalPosition = pendingDragPositionRef.current ?? dragPosition;
    cancelPendingMove();
    commitDragPosition({
      dragPosition: finalPosition,
      committedPosition: safeCover.position,
      onPositionChange,
    });
    setDragPosition(null);
  };

  const handlePointerUp = () => {
    if (!dragStartRef.current) {
      return;
    }
    dragStartRef.current = null;
    commitStagedPosition();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!isRepositioning) {
      return;
    }

    // Commits once, like the drag path (pointer-up) and the Done button:
    // keyboard steps stay local in `dragPosition` so a held arrow key does
    // not fan out N optimistic+Yjs+REST writes, one per keypress repeat.
    if (event.key === 'Enter') {
      event.preventDefault();
      commitStagedPosition();
      setIsRepositioning(false);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setDragPosition(null);
      setIsRepositioning(false);
      return;
    }

    const step = event.shiftKey ? KEYBOARD_STEP_COARSE : KEYBOARD_STEP;
    let next: number | null = null;
    if (event.key === 'ArrowUp') {
      next = clampCoverPosition(position + step);
    } else if (event.key === 'ArrowDown') {
      next = clampCoverPosition(position - step);
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = 1;
    }

    if (next === null) {
      return;
    }
    event.preventDefault();
    setDragPosition(next);
  };

  // Losing focus commits a pending keyboard/drag position, like Done does —
  // tabbing away must not silently drop the adjustment.
  const handleBlur = () => {
    if (!isRepositioning) {
      return;
    }
    commitStagedPosition();
  };

  // The strip carries the surface and the shadow; the buttons only add hit area,
  // so the three actions read as one control instead of three floating pills.
  const actionClassName = `
    px-2 py-1 text-[12px] font-medium text-foreground cursor-pointer
    transition-colors hover:bg-[var(--nd-toolbar-hover-bg)]
    focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring
    pointer-coarse:px-3 pointer-coarse:py-2 pointer-coarse:text-[13px]
  `;

  return (
    <div
      ref={frameRef}
      className={`
        nd-page-cover group/cover relative select-none overflow-hidden bg-muted
        h-[24vh] min-h-[140px] max-h-[260px]
        md:h-[30vh] md:min-h-[190px] md:max-h-[340px]
        ${isRepositioning ? 'cursor-grab ring-2 ring-inset ring-[var(--nd-brand-ring)] active:cursor-grabbing' : ''}
      `}
      tabIndex={isRepositioning ? 0 : -1}
      role={isRepositioning ? 'application' : undefined}
      aria-label={isRepositioning ? 'Reposition the cover image' : undefined}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          aria-hidden
          draggable={false}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          style={{ objectPosition: coverObjectPosition(position) }}
        />
      ) : (
        <div aria-hidden className="h-full w-full animate-pulse bg-muted-foreground/10" />
      )}

      {isRepositioning && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <span className="rounded-full bg-background/90 px-2.5 py-1 text-[11.5px] text-muted-foreground shadow-sm backdrop-blur-sm">
            Drag the image, or use ↑ ↓ to adjust
          </span>
        </div>
      )}

      {canEdit && (
        /*
          Bottom-right rather than the conventional top-right: the document
          toolbar is fixed to the top-right of the viewport, and these would sit
          under it.

          They stay put rather than moving on hover, so the strip is where the
          pointer already is by the time it starts showing.

          The cover bleeds into the scrollbar gutter, so the strip offsets by
          that same gutter to keep the last button clear of the scrollbar.
        */
        <div
          role="group"
          aria-label="Cover actions"
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          style={{ right: 'calc(0.625rem + var(--nd-scrollbar-gutter, 0px))' }}
          className={`
            absolute bottom-2.5 z-10 inline-flex items-stretch overflow-hidden
            divide-x divide-border rounded-md bg-background/85 shadow-sm backdrop-blur-sm
            transition-opacity duration-150
            ${actionsVisibilityClass(areActionsVisible, isTouchInput)}
          `}
        >
          {!isRepositioning && (
            <button
              type="button"
              ref={triggerRef}
              className={actionClassName}
              aria-haspopup="dialog"
              onClick={onRequestChange}
            >
              Change cover
            </button>
          )}
          <button
            type="button"
            className={actionClassName}
            aria-pressed={isRepositioning}
            onClick={(e) => {
              e.stopPropagation();
              commitStagedPosition();
              setIsRepositioning((prev) => !prev);
            }}
          >
            {isRepositioning ? 'Done' : 'Reposition'}
          </button>
          {!isRepositioning && (
            <button type="button" className={actionClassName} onClick={onRemove}>
              Remove
            </button>
          )}
        </div>
      )}
    </div>
  );
}
