const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }

  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
  );
}

/**
 * Keeps Tab focus inside an open dialog. The dialog itself counts as the
 * boundary: it is focusable via its `tabIndex={-1}` surface, and without this
 * check focus would escape to the page behind the portal.
 */
export function trapTabKey(event: KeyboardEvent, dialog: HTMLElement | null): boolean {
  if (event.key !== 'Tab' || !dialog) {
    return false;
  }

  const focusableElements = getFocusableElements(dialog);
  if (focusableElements.length === 0) {
    event.preventDefault();
    dialog.focus();
    return true;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement as HTMLElement | null;
  const isAtBoundary =
    !activeElement || activeElement === dialog || !dialog.contains(activeElement);

  if (event.shiftKey) {
    if (isAtBoundary || activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
      return true;
    }
    return false;
  }

  if (isAtBoundary || activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
    return true;
  }

  return false;
}
