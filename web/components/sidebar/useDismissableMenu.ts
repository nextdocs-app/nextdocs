'use client';

import { useEffect, useRef, type RefObject } from 'react';

type DismissableMenu = {
  isOpen: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  popupRef: RefObject<HTMLElement | null>;
  onDismiss: () => void;
};

/**
 * Closes a rail menu on an outside press or Escape.
 *
 * The menu renders at the rail root rather than beside its trigger, so it
 * cannot rely on focus leaving a wrapper; dismissal listens on the document
 * instead of being re-implemented per menu.
 */
export function useDismissableMenu({ isOpen, triggerRef, popupRef, onDismiss }: DismissableMenu) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleOutsidePress = (event: MouseEvent) => {
      const target = event.target as Node;
      // The press that toggles the trigger must reach the trigger's own click
      // handler; closing here would immediately reopen the menu.
      if (triggerRef.current?.contains(target) || popupRef.current?.contains(target)) {
        return;
      }
      onDismissRef.current();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onDismissRef.current();
      }
    };

    document.addEventListener('mousedown', handleOutsidePress);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsidePress);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, triggerRef, popupRef]);
}
