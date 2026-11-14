import { PageIcon } from '@/components/page/PageIcon';
import { DocumentText } from '@/icons';
import type { DocumentIcon } from '@/types/document.types';

/**
 * A document's bare page glyph: no tile, border, or background. This is the
 * treatment beside a two-line row (share-popover source rows, search results),
 * where a boxed icon competes with the title it sits next to. Uploaded and
 * linked icons are images, so they fill a little more of the same 28px box.
 */
export function DocumentGlyph({
  icon,
  accessToken,
  className = '',
}: {
  icon?: DocumentIcon | null;
  accessToken?: string | null;
  className?: string;
}) {
  const isMedia = icon?.type === 'upload' || icon?.type === 'link';

  return (
    <span
      aria-hidden="true"
      className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center select-none text-muted-foreground ${className}`}
    >
      {icon ? (
        <PageIcon icon={icon} size={isMedia ? 24 : 20} accessToken={accessToken ?? undefined} />
      ) : (
        <DocumentText size={20} strokeWidth={1.75} className="opacity-80" />
      )}
    </span>
  );
}
