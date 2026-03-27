'use client';

import { useCallback, useEffect, useId, useRef } from 'react';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ConfirmationModalProps = {
  id?: string;
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isConfirming?: boolean;
  tone?: 'default' | 'danger';
  onConfirm: () => void | Promise<void>;
  onCancel: () => void | Promise<void>;
};

export function ConfirmationModal({
  id,
  isOpen,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isConfirming = false,
  tone = 'default',
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);
  const isConfirmingRef = useRef(isConfirming);
  const generatedId = useId();
  const baseId = id ?? generatedId;
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-description`;

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);

  useEffect(() => {
    isConfirmingRef.current = isConfirming;
  }, [isConfirming]);

  const restorePreviousFocus = useCallback(() => {
    const previousElement = previouslyFocusedRef.current;

    if (previousElement?.isConnected) {
      previousElement.focus();
    }

    previouslyFocusedRef.current = null;
  }, []);

  const runActionWithFocusRestore = useCallback(
    (action: () => void | Promise<void>) => {
      void Promise.resolve()
        .then(action)
        .finally(() => {
          window.setTimeout(() => {
            if (!dialogRef.current) {
              restorePreviousFocus();
            }
          }, 0);
        });
    },
    [restorePreviousFocus]
  );

  const handleCancel = useCallback(() => {
    if (isConfirmingRef.current) {
      return;
    }

    runActionWithFocusRestore(onCancelRef.current);
  }, [runActionWithFocusRestore]);

  const handleConfirm = useCallback(() => {
    if (isConfirmingRef.current) {
      return;
    }

    runActionWithFocusRestore(onConfirmRef.current);
  }, [runActionWithFocusRestore]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const getFocusableElements = () => {
      return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) =>
          !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
      );
    };

    const focusTarget = cancelButtonRef.current ?? getFocusableElements()[0] ?? dialog;
    focusTarget.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!activeElement || activeElement === firstElement || !dialog.contains(activeElement)) {
          event.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (!activeElement || activeElement === lastElement || !dialog.contains(activeElement)) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    dialog.addEventListener('keydown', handleKeyDown);

    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      restorePreviousFocus();
    };
  }, [isOpen, handleCancel, restorePreviousFocus]);

  if (!isOpen) {
    return null;
  }

  const confirmButtonClassName =
    tone === 'danger'
      ? 'bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed'
      : 'bg-foreground text-background hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/35 backdrop-blur-[1px] px-4"
      onMouseDown={(event) => {
        if (event.target === overlayRef.current) {
          handleCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="w-full max-w-sm rounded-xl border border-sidebar-border bg-popover text-popover-foreground p-4 shadow-2xl"
      >
        <h3 id={titleId} className="text-[15px] font-semibold leading-tight">
          {title}
        </h3>
        <p id={descriptionId} className="mt-2 text-[13px] text-muted-foreground leading-relaxed">
          {description}
        </p>

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={handleCancel}
            disabled={isConfirming}
            className="rounded-md px-3 py-1.5 text-[13px] border border-sidebar-border bg-transparent hover:bg-foreground/[0.07] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isConfirming}
            className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer ${confirmButtonClassName}`}
          >
            {isConfirming ? 'Working...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
