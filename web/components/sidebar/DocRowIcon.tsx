import { DocumentText } from '@/icons';
import { PageIcon } from '@/components/page/PageIcon';
import type { DocumentIcon } from '@/types/document.types';

/**
 * One document row glyph: the page icon when set, the document glyph
 * otherwise. Shared by the documents panel rows and the sidebar tree items so
 * the 17px box, opacity, and fallback stay identical in both places.
 */
export function DocRowIcon({
  icon,
  size = 16,
  className = 'flex h-[17px] w-[17px] flex-shrink-0 items-center justify-center opacity-80',
  glyphClassName = 'flex-shrink-0 opacity-80',
}: {
  icon?: DocumentIcon | null;
  size?: number;
  /** Outer box classes; tree rows pass absolute-positioned hover-fade classes. */
  className?: string;
  /** Fallback glyph classes. */
  glyphClassName?: string;
}) {
  if (icon) {
    return (
      <span className={className}>
        <PageIcon icon={icon} size={size} />
      </span>
    );
  }
  return <DocumentText size={17} className={glyphClassName} />;
}
