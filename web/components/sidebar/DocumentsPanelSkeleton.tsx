type DocumentsPanelSkeletonProps = {
  rows?: number;
  compact?: boolean;
};

export function DocumentsPanelSkeleton({ rows = 6, compact = false }: DocumentsPanelSkeletonProps) {
  return (
    <div
      className={`flex flex-col ${compact ? 'gap-0.5 py-0.5' : 'gap-1 py-1'}`}
      data-testid={compact ? 'documents-panel-loading-more-skeleton' : 'documents-panel-skeleton'}
      aria-hidden="true"
    >
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={`documents-panel-skeleton-${compact ? 'compact' : 'default'}-${index + 1}`}
          className="flex items-center gap-2.5 px-2 py-1.5 rounded-sm"
        >
          {/* Icon placeholder */}
          <div className="h-4 w-4 flex-shrink-0 rounded-sm bg-sidebar-foreground/10 dark:bg-sidebar-foreground/15 animate-pulse" />

          {/* Text placeholder */}
          <div className="min-w-0 flex-1 space-y-1">
            <div
              className={`h-3 rounded-sm bg-sidebar-foreground/10 dark:bg-sidebar-foreground/15 animate-pulse ${
                index % 3 === 0 ? 'w-[72%]' : index % 3 === 1 ? 'w-[58%]' : 'w-[66%]'
              }`}
            />
            {!compact && (
              <div
                className={`h-2 rounded-sm bg-sidebar-foreground/5 dark:bg-sidebar-foreground/10 animate-pulse ${
                  index % 2 === 0 ? 'w-[34%]' : 'w-[28%]'
                }`}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
