import { CircleAlert, Workspace } from '@/icons';

/** Shared states for the two workspace panels. */

export function WorkspacePanelLoading({ label = 'Loading workspace…' }: { label?: string }) {
  return <div className="py-6 text-[13.5px] text-muted-foreground">{label}</div>;
}

export function WorkspacePanelSignedOut() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <span
        aria-hidden="true"
        className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <Workspace size={24} />
      </span>
      <h3 className="text-[15px] font-medium text-foreground">Not signed in</h3>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">
        Sign in to see the workspace you belong to and the people in it.
      </p>
    </div>
  );
}

export function WorkspacePanelError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-10 text-center"
    >
      <span
        aria-hidden="true"
        className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground"
      >
        <CircleAlert size={20} />
      </span>
      <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-md border border-border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-foreground/[0.06] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        Try again
      </button>
    </div>
  );
}
