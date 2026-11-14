import type { SearchTextSegment } from '@/types/search.types';

export function HighlightedSegments({
  segments,
  fallback,
}: {
  segments: SearchTextSegment[];
  fallback?: string;
}) {
  if (segments.length === 0) {
    return <>{fallback ?? null}</>;
  }

  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <mark key={`${index}-${segment.text}`} className="nd-search-mark">
            {segment.text}
          </mark>
        ) : (
          <span key={`${index}-${segment.text}`}>{segment.text}</span>
        )
      )}
    </>
  );
}
