'use client';

import { useState } from 'react';
import {
  AVATAR_FONT_FAMILY,
  AVATAR_FONT_SIZE,
  AVATAR_FONT_WEIGHT,
  AVATAR_TEXT_COLOR,
  AVATAR_TEXT_DY,
  getAvatarBackground,
  getAvatarInitials,
  resolveAvatarUrl,
} from '@/lib/avatar.util';

const SIZES = {
  xs: 24,
  sm: 28,
  md: 32,
  lg: 48,
} as const;

export type UserAvatarSize = keyof typeof SIZES;

/**
 * The one person mark in the app: a photo when the user has one, otherwise the
 * DiceBear-style initials avatar whose hue comes from `seed` (their user id).
 */
export function UserAvatar({
  seed,
  name,
  src = null,
  size = 'md',
  className = '',
  title,
}: {
  seed: string;
  name: string | null | undefined;
  src?: string | null;
  size?: UserAvatarSize;
  className?: string;
  title?: string;
}) {
  const dimension = SIZES[size];
  const baseClassName = `inline-flex flex-shrink-0 items-center justify-center overflow-hidden rounded-full select-none shadow-xs ${className}`;
  const style = { width: dimension, height: dimension };

  // An uploaded photo arrives as an API path, not a URL the browser can fetch on its own.
  const imageSource = resolveAvatarUrl(src);
  // A cached session can outlive the photo, so a 404 must degrade to the initials
  // rather than to a broken-image glyph. A replaced photo is a new URL, which
  // re-arms the attempt on its own.
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (imageSource && failedSource !== imageSource) {
    return (
      <span className={baseClassName} style={style} title={title}>
        {/* Avatars are user-provided URLs; a small crop does not need the
            next/image optimizer hop, and `no-referrer` keeps this host out of
            their logs. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={
            // Origin-scoped image URL, allowlisted by `resolveAvatarUrl` and set as an
            // attribute by React, so nothing here is ever parsed as markup.
            imageSource
          }
          alt=""
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
          onError={() => setFailedSource(imageSource)}
        />
      </span>
    );
  }

  const initials = getAvatarInitials(name);
  const background = getAvatarBackground(seed);
  const text = {
    x: '50%',
    y: '50%',
    dy: AVATAR_TEXT_DY,
    textAnchor: 'middle' as const,
    fontFamily: AVATAR_FONT_FAMILY,
    fontSize: AVATAR_FONT_SIZE,
    fontWeight: AVATAR_FONT_WEIGHT,
    fill: AVATAR_TEXT_COLOR,
  };

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 100"
      className={baseClassName}
      style={style}
    >
      {title ? <title>{title}</title> : null}
      <rect width="100" height="100" fill={background} />
      {/* DiceBear's `default` variant: the letters are drawn twice, blended and
          then at half opacity, which reads as a soft emboss instead of flat text. */}
      <g style={{ mixBlendMode: 'overlay' }}>
        <text {...text}>{initials}</text>
      </g>
      <g opacity={0.5}>
        <text {...text}>{initials}</text>
      </g>
    </svg>
  );
}
