'use client';

import { getApiBaseUrl } from '@/lib/api-url.util';
import {
  builtinIconPath,
  builtinSvgDataUrl,
  isIconColorId,
  sanitizeDocumentIcon,
} from '@/lib/document-icon.util';
import { useResolvedAssetUrl } from '@/hooks/useResolvedAssetUrl.hook';
import { useAppSelector } from '@/stores/hooks';
import type { DocumentIcon } from '@/types/document.types';

export interface PageIconProps {
  icon: DocumentIcon;
  /** Rendered box in px; emoji scale from it and images are cropped square. */
  size?: number;
  className?: string;
  /**
   * Accessible name. Omit it where the icon merely decorates a title, and the
   * glyph is hidden from assistive tech rather than announced twice.
   */
  label?: string;
  /**
   * Session token for minting upload URLs. Falls back to the auth store so
   * sidebar/breadcrumb callers do not have to thread it; the page header
   * passes it explicitly as the single source for its subtree.
   */
  accessToken?: string | null;
  /**
   * Pre-fetched glyph text for a builtin icon, from the bundle download. When
   * present the glyph embeds as a data URL instead of fetching its own HTTP
   * request; callers without bundle access omit it and the per-glyph URL
   * (aggressively cached) is used.
   */
  svg?: string | null;
}

/**
 * One page icon, whatever its source.
 *
 * Emoji render as text (colour comes from the emoji font). Catalog glyphs are
 * `currentColor` SVGs, so they are masked into the inherited text
 * colour instead of loaded as `<img>` — an image would paint them black in both
 * themes. Uploads and links are real images and carry `no-referrer` so a
 * third-party host cannot learn which page was viewed.
 */
export function PageIcon({
  icon,
  size = 20,
  className = '',
  label,
  accessToken,
  svg,
}: PageIconProps) {
  // Render boundary: icon props arrive from Yjs, IndexedDB, and share payloads,
  // any of which may hold stale or hand-crafted values. Re-validate here so a
  // compromised payload degrades to nothing instead of reaching text, img, or CSS.
  const safeIcon = sanitizeDocumentIcon(icon);
  if (!safeIcon) {
    return null;
  }

  if (safeIcon.type === 'emoji') {
    return (
      <span
        role={label ? 'img' : 'presentation'}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={`nd-page-icon-emoji inline-flex flex-shrink-0 items-center justify-center leading-none ${className}`}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.85) }}
      >
        {safeIcon.value}
      </span>
    );
  }

  if (safeIcon.type === 'builtin') {
    // `sanitizeDocumentIcon` already restricts color to the allowlist, but the
    // value is interpolated into a CSS var, so re-check before interpolating.
    const safeColor =
      safeIcon.color && safeIcon.color !== 'default' && isIconColorId(safeIcon.color)
        ? safeIcon.color
        : null;
    const colorStyle = safeColor ? { color: `var(--nd-icon-color-${safeColor})` } : {};
    // Embedded bundle text wins over the per-glyph request; untrusted shapes
    // fall back to the glyph URL rather than reaching CSS.
    const maskUrl =
      builtinSvgDataUrl(svg) ?? `${getApiBaseUrl()}${builtinIconPath(safeIcon.value)}`;
    return (
      <span
        role={label ? 'img' : 'presentation'}
        aria-label={label}
        aria-hidden={label ? undefined : true}
        className={`nd-page-icon-mask ${className}`}
        style={
          {
            width: size,
            height: size,
            // `safeIcon.value` is a validated catalog slug; `builtinIconPath`
            // encodes it, so no path traversal can reach the mask URL. The
            // double cast is only for the `--nd-icon-url` custom property,
            // which `CSSProperties` does not declare; both interpolated values
            // above are allowlisted before reaching CSS.
            '--nd-icon-url': `url("${maskUrl}")`,
            ...colorStyle,
          } as unknown as React.CSSProperties
        }
      />
    );
  }

  return (
    <PageIconImage
      icon={safeIcon}
      size={size}
      className={className}
      label={label}
      accessToken={accessToken}
    />
  );
}

/** Uploaded and linked icons need their signed URL before they can render. */
function PageIconImage({ icon, size = 20, className = '', label, accessToken }: PageIconProps) {
  const storeToken = useAppSelector((state) => state?.auth?.accessToken ?? null);
  const url = useResolvedAssetUrl(icon, accessToken ?? storeToken);

  if (!url) {
    // Reserve the box so the title does not jump once the URL resolves.
    return (
      <span
        aria-hidden
        className={`inline-block flex-shrink-0 rounded-[4px] bg-muted ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={label ?? ''}
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      className={`flex-shrink-0 rounded-[1px] object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
