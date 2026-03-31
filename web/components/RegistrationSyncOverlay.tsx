'use client';

interface Props {
  count: number;
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function RegistrationSyncOverlay({ count, isLoading, error, onRetry }: Props) {
  return (
    <div className="fixed inset-0 z-[70] bg-background/92 backdrop-blur-sm">
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes float-up {
          0%, 100% { opacity: 0; transform: translateY(8px); }
          50% { opacity: 1; }
        }
        .spinner {
          animation: spin 1s linear infinite;
        }
        .pulse-dot {
          animation: float-up 1.5s ease-in-out infinite;
        }
        .pulse-dot:nth-child(2) {
          animation-delay: 0.3s;
        }
        .pulse-dot:nth-child(3) {
          animation-delay: 0.6s;
        }
      `}</style>

      <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center px-6">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl">
          {/* Spinner */}
          {isLoading && (
            <div className="mb-6 flex justify-center">
              <div className="spinner h-12 w-12 rounded-full border-4 border-muted border-t-foreground" />
            </div>
          )}

          {/* Content */}
          <div className="text-center">
            <h2 className="text-lg font-semibold text-foreground">
              Moving local documents to your account
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              {isLoading
                ? 'Please wait while we persist your local documents to the backend.'
                : 'Could not move documents to your account'}
            </p>

            {/* Document count badge */}
            {isLoading && count > 0 && (
              <div className="mt-4 inline-block rounded-full bg-primary/10 px-3 py-1">
                <span className="text-xs font-medium text-primary">
                  {count === 1 ? '1 document' : `${count} documents`}
                </span>
              </div>
            )}

            {/* Animated dots */}
            {isLoading && (
              <div className="mt-4 flex justify-center gap-1.5">
                <div className="pulse-dot h-2 w-2 rounded-full bg-muted-foreground" />
                <div className="pulse-dot h-2 w-2 rounded-full bg-muted-foreground" />
                <div className="pulse-dot h-2 w-2 rounded-full bg-muted-foreground" />
              </div>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-5 rounded-md bg-destructive/10 p-3">
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          {/* Retry button */}
          {!isLoading && (
            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md bg-foreground px-5 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-75"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
