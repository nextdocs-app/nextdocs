'use client';

import { useEffect, useRef } from 'react';

interface Props {
  count: number;
  isImporting: boolean;
  error: string | null;
  onMoveToAccount: () => void;
  onDiscardLocalData: () => void;
}

export function LocalDocsPromotionModal({
  count,
  isImporting,
  error,
  onMoveToAccount,
  onDiscardLocalData,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-sm px-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="local-docs-modal-title"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
      >
        <h2 id="local-docs-modal-title" className="text-lg font-semibold text-foreground">
          Local documents found
        </h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
          We found {count} local document{count === 1 ? '' : 's'} on this device. Choose whether to
          move them to your account or discard local data from this device.
        </p>

        {error && (
          <p className="mt-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            disabled={isImporting}
            onClick={onMoveToAccount}
            className="w-full rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isImporting ? 'Moving...' : 'Move to account'}
          </button>
          <button
            type="button"
            disabled={isImporting}
            onClick={onDiscardLocalData}
            className="w-full rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            Discard local data
          </button>
        </div>
      </div>
    </div>
  );
}
