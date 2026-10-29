import type { CSSProperties } from 'react';
import { PageIcon } from '@/components/page/PageIcon';
import { Workspace } from '@/icons';
import { isIconColorId } from '@/lib/document-icon.util';
import type { DocumentIcon } from '@/types/document.types';

export interface WorkspaceIconTileStyle {
  className: string;
  style?: CSSProperties;
}

/**
 * Container appearance for a workspace icon tile.
 *
 * A colored builtin glyph gets a wash mixed from its own icon color, so the mark
 * reads as an application tile rather than bare line art. Every other source —
 * no icon, an emoji, and the default builtin color — uses the neutral
 * placeholder surface, which stays legible in both themes. Media icons bring
 * their own pixels, so they get no background at all.
 */
export function workspaceIconTileStyle(
  icon: DocumentIcon | null | undefined
): WorkspaceIconTileStyle {
  if (
    icon?.type === 'builtin' &&
    icon.color &&
    icon.color !== 'default' &&
    isIconColorId(icon.color)
  ) {
    return {
      className: '',
      style: {
        backgroundColor: `color-mix(in srgb, var(--nd-icon-color-${icon.color}) 18%, transparent)`,
        color: `var(--nd-icon-color-${icon.color})`,
      },
    };
  }

  if (icon?.type === 'upload' || icon?.type === 'link') {
    return { className: '' };
  }

  return { className: 'bg-[var(--nd-placeholder-bg)] text-[var(--nd-placeholder-fg)]' };
}

/**
 * The mark inside a workspace icon tile, sized to that tile: builtin glyphs and
 * emoji sit inset, media fills the edge (its signed URL may still be resolving,
 * and the box keeps its size either way).
 */
export function WorkspaceIconTile({
  icon,
  size,
  accessToken,
  className = '',
}: {
  icon?: DocumentIcon | null;
  /** Tile edge in px. */
  size: number;
  accessToken?: string | null;
  className?: string;
}) {
  if (!icon) {
    return <Workspace size={Math.round(size * 0.6)} aria-hidden="true" />;
  }

  const isMedia = icon.type === 'upload' || icon.type === 'link';
  const glyphSize = isMedia ? size : Math.round(size * (icon.type === 'builtin' ? 0.6 : 0.62));

  return (
    <PageIcon
      icon={icon}
      size={glyphSize}
      className={isMedia ? `h-full w-full ${className}`.trim() : className}
      accessToken={accessToken}
    />
  );
}
