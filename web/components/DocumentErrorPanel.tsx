'use client';

export type DocumentErrorPanelTone = 'restricted' | 'error';

interface DocumentErrorPanelProps {
  title: string;
  description: string;
  detail?: string | null;
  statusCode?: number | null;
  tone?: DocumentErrorPanelTone;
  actionLabel?: string;
  onAction?: () => void;
}

export function DocumentErrorPanel({
  title,
  description,
  detail = null,
  statusCode = null,
  tone = 'error',
  actionLabel,
  onAction,
}: DocumentErrorPanelProps) {
  const borderToneClassName =
    tone === 'restricted'
      ? 'border-amber-300/60 bg-amber-50/40 dark:bg-amber-900/10'
      : 'border-destructive/40 bg-destructive/5';

  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className={`w-full max-w-xl rounded-2xl border p-6 ${borderToneClassName}`}>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Document status
        </p>
        <h2 className="mt-2 text-xl font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>

        {(statusCode || detail) && (
          <div className="mt-4 rounded-lg border border-border/60 bg-background/70 p-3 text-xs text-muted-foreground">
            {statusCode ? <p>Response code: {statusCode}</p> : null}
            {detail ? <p className="mt-1">{detail}</p> : null}
          </div>
        )}

        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-5 inline-flex items-center rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-sidebar-accent transition-colors"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
