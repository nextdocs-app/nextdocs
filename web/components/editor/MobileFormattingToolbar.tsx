'use client';

import { FormattingToolbar, type FormattingToolbarProps } from '@blocknote/react';
import type { BlockNoteEditor } from '@blocknote/core';
import { useCallback, useEffect, useRef, useState, type FC } from 'react';
import { useMobileKeyboardOffset } from '@/hooks/useMobileKeyboardOffset.hook';
import { MobileBlurEditorButton } from './MobileBlurEditorButton';

/**
 * The formatting toolbar for the mobile layout: the same button set as the
 * desktop toolbar, docked to the bottom of the viewport and lifted clear of the
 * on-screen keyboard.
 *
 * BlockNote's `ExperimentalMobileFormattingToolbarController` does that docking,
 * but it drops the real toolbar on any render where the formatting-toolbar
 * extension reports no non-empty selection to format: it re-renders the bar as a
 * `dangerouslySetInnerHTML` copy of its own markup, which keeps the buttons on
 * screen and takes their React handlers with it. Since the extension clears its
 * state on every selection collapse — and any parent render (title edits,
 * presence, comments) can be the one that lands in that window — the docked bar
 * goes inert almost immediately and its dropdowns (block type, colours) never
 * open.
 *
 * Rendering the toolbar unconditionally is the fix; the bar only ever needs to
 * *look* the same. Keyboard tracking comes from the app's own
 * `useMobileKeyboardOffset` hook, because `--bn-mobile-keyboard-offset` is
 * written by the controller this replaces.
 *
 * Visibility: a cursor is what makes the bar useful, so it is hidden as soon as
 * focus leaves the editor. Focus on the bar itself counts as editing, because
 * tapping a button moves focus out of the contenteditable on some mobile
 * browsers; hiding it under the finger would take the click with it, and a
 * browser that drops focus to the page instead of the button (iOS) is covered
 * by treating a finger that is down on the bar the same way. The bar is toggled
 * with `visibility` rather than unmounted or `display: none`: the dropdowns
 * anchored to its buttons (block type, colours) are portalled out of the bar,
 * and they need its layout box to stay put while one is open.
 *
 * An open dropdown of the bar's own is part of the bar. Its popup is portalled
 * away from the buttons, so its items take focus while it is open, and every
 * touch inside it moves focus again — in and out of the bar between the popup
 * and the button that opened it. Read as "the cursor left the editor", that
 * flickers the bar on each of those touches; the trigger's open state is what
 * separates a popup from a real blur, so it counts as editing too.
 */

/**
 * How Base UI marks the trigger of an open popup: `aria-expanded` for the block
 * type `Select`, `data-popup-open` for the colour `Menu`. Scoped to the bar, so
 * an unrelated menu elsewhere on the page cannot hold it up.
 */
const OPEN_POPUP_SELECTOR = '[aria-expanded="true"], [data-popup-open]';

const POPUP_STATE_ATTRIBUTES = ['aria-expanded', 'data-popup-open'];

export function MobileFormattingToolbarController({
  editor,
  formattingToolbar,
  dismissButton = false,
}: {
  editor: Pick<BlockNoteEditor, 'isFocused'>;
  formattingToolbar?: FC<FormattingToolbarProps>;
  /**
   * Renders the dismiss-editing button (see `MobileBlurEditorButton`) beside
   * the bar's scrolling row instead of inside it: the row scrolls, and a pin
   * that has to survive the scroll either drifts with the row's padding or
   * needs per-frame work. As a sibling it never scrolls at all.
   */
  dismissButton?: boolean;
}) {
  const keyboardOffset = useMobileKeyboardOffset(true);
  const barRef = useRef<HTMLDivElement>(null);
  const [hasCursor, setHasCursor] = useState(false);

  // Set while a finger is down on the bar, and cleared once its gesture has
  // been dispatched. `pointerup` is too early to clear it: some browsers blur
  // the editor to the page rather than focusing the button, so the bar would
  // hide between the press and the click and the click would land behind it.
  const pointerIsDownOnBar = useRef(false);

  const isEditing = useCallback(
    () =>
      editor.isFocused() ||
      pointerIsDownOnBar.current ||
      !!barRef.current?.querySelector(OPEN_POPUP_SELECTOR) ||
      !!barRef.current?.contains(document.activeElement),
    [editor]
  );

  useEffect(() => {
    // `focusout` is dispatched before `document.activeElement` settles on its
    // new owner, so deciding inside the handler would briefly read "nothing is
    // focused" on every tap that moves focus from the editor onto the bar (or,
    // on a browser that blurs to the page, on every tap at all). A microtask
    // lets both focus events land first and keeps that flicker out of the
    // render.
    const sync = () => setHasCursor(isEditing());
    const syncAfterFocusChange = () => queueMicrotask(sync);

    sync();
    document.addEventListener('focusin', syncAfterFocusChange);
    document.addEventListener('focusout', syncAfterFocusChange);

    // Opening or closing a popup changes no focus by itself on every browser
    // (and on none of them is the change prompt), so the attribute is watched
    // rather than inferred from a focus event: without this the bar would keep
    // whatever the popup's first touch decided until something else moved focus.
    const bar = barRef.current;
    const popupObserver = new MutationObserver(sync);
    if (bar) {
      popupObserver.observe(bar, {
        attributes: true,
        attributeFilter: POPUP_STATE_ATTRIBUTES,
        subtree: true,
      });
    }

    return () => {
      document.removeEventListener('focusin', syncAfterFocusChange);
      document.removeEventListener('focusout', syncAfterFocusChange);
      popupObserver.disconnect();
    };
  }, [isEditing]);

  const gestureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBarPointerDown = () => {
    if (gestureTimeoutRef.current) {
      clearTimeout(gestureTimeoutRef.current);
      gestureTimeoutRef.current = null;
    }
    pointerIsDownOnBar.current = true;
    setHasCursor(true);
  };

  // The gesture is over by the time the click reaches the bar, so whatever the
  // button did to focus has already happened.
  const endBarGesture = useCallback(() => {
    if (gestureTimeoutRef.current) {
      clearTimeout(gestureTimeoutRef.current);
      gestureTimeoutRef.current = null;
    }
    pointerIsDownOnBar.current = false;
    setHasCursor(isEditing());
  }, [isEditing]);

  const scheduleEndBarGesture = useCallback(() => {
    if (!pointerIsDownOnBar.current) return;
    if (gestureTimeoutRef.current) {
      clearTimeout(gestureTimeoutRef.current);
    }
    gestureTimeoutRef.current = setTimeout(() => {
      gestureTimeoutRef.current = null;
      if (pointerIsDownOnBar.current) {
        endBarGesture();
      }
    }, 0);
  }, [endBarGesture]);

  useEffect(() => {
    const handleWindowPointerUp = () => {
      scheduleEndBarGesture();
    };

    window.addEventListener('pointerup', handleWindowPointerUp);
    return () => {
      window.removeEventListener('pointerup', handleWindowPointerUp);
      if (gestureTimeoutRef.current) {
        clearTimeout(gestureTimeoutRef.current);
      }
    };
  }, [scheduleEndBarGesture]);

  const Toolbar = formattingToolbar ?? FormattingToolbar;

  return (
    // `bn-mobile-formatting-toolbar` keeps BlockNote's contract for the bar:
    // fixed to the viewport, full width, horizontally scrollable, and themed by
    // the mobile rules in `styles/globals.css`.
    <div
      ref={barRef}
      className="bn-mobile-formatting-toolbar"
      style={{
        bottom: keyboardOffset,
        visibility: hasCursor ? undefined : 'hidden',
        pointerEvents: hasCursor ? undefined : 'none',
      }}
      aria-hidden={!hasCursor}
      onPointerDown={handleBarPointerDown}
      onClick={endBarGesture}
      onPointerUp={scheduleEndBarGesture}
      onPointerCancel={endBarGesture}
      onLostPointerCapture={endBarGesture}
    >
      <Toolbar />
      {dismissButton && <MobileBlurEditorButton />}
    </div>
  );
}
