'use client';

import { useEffect, useState } from 'react';

function isEditableElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }

  return element.tagName === 'INPUT' || element.tagName === 'TEXTAREA';
}

/**
 * Height of the on-screen keyboard in layout-viewport pixels, for lifting
 * bottom-docked chrome with `bottom: <offset>px`.
 *
 * `position: fixed` resolves against the layout viewport, so the answer depends
 * on whether the browser resizes that viewport for the keyboard:
 *
 *   - Browsers honouring `interactive-widget=resizes-content` (see
 *     app/layout.tsx) shrink the layout viewport too, so the two heights cancel
 *     and this returns 0 — `bottom: 0` already sits on the keyboard's edge.
 *   - iOS Safari ignores `interactive-widget` and keeps the layout viewport at
 *     full height, so the gap has to be measured from the visual viewport and
 *     applied manually.
 *
 * The offset is reported only while an editable element has focus: without that
 * guard a browser whose layout viewport is taller than its visual viewport (an
 * address bar that is currently shown) reports a phantom keyboard and floats the
 * bar above the bottom edge.
 */
export function useMobileKeyboardOffset(enabled: boolean): number {
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      return;
    }

    const viewport = window.visualViewport;
    if (!viewport) {
      return;
    }

    // Remembered so the bar can be lifted on the first frame of the next focus,
    // before the keyboard has finished animating in.
    let lastKnownKeyboardHeight = 0;

    const update = () => {
      const keyboardHeight =
        document.documentElement.clientHeight - viewport.height - viewport.offsetTop;

      if (keyboardHeight > 50) {
        lastKnownKeyboardHeight = keyboardHeight;
      }

      setOffset(
        keyboardHeight > 0 && isEditableElement(document.activeElement) ? keyboardHeight : 0
      );
    };

    const handleFocusIn = () => {
      if (lastKnownKeyboardHeight > 0 && isEditableElement(document.activeElement)) {
        setOffset(lastKnownKeyboardHeight);
      }
    };

    const handleFocusOut = () => setOffset(0);

    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);

    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  }, [enabled]);

  return offset;
}
