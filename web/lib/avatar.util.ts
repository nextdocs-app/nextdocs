/**
 * The DiceBear "initials" style (CC0), reimplemented locally: a background hue
 * derived from the user id, and up to two initials taken from the display name.
 * No dependency — the style is 18 colours and two text layers.
 */
import { getApiBaseUrl } from '@/lib/api-url.util';

/**
 * DiceBear's `initials` background palette, verbatim. Every value is dark
 * enough that white letters read on it, so the text colour is fixed.
 */
export const AVATAR_BACKGROUNDS = [
  '#c44f4f',
  '#ac6039',
  '#8e6e2f',
  '#777728',
  '#627e2a',
  '#48822b',
  '#2d862d',
  '#2b8248',
  '#2b8265',
  '#2a7e7e',
  '#347a9d',
  '#4b73c3',
  '#6a6acd',
  '#825ec9',
  '#9f53c6',
  '#bb3ebb',
  '#c14497',
  '#c34b73',
] as const;

/** DiceBear renders the `double` letter variant only, so this caps the string. */
const MAX_INITIALS = 2;

/**
 * Word boundaries for a display name or an email: emails and handles use dots,
 * underscores and hyphens where names use spaces.
 */
const WORD_SEPARATOR = /[\s._-]+/u;

export const AVATAR_TEXT_COLOR = '#ffffff';
export const AVATAR_FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
export const AVATAR_FONT_SIZE = 50;
export const AVATAR_FONT_WEIGHT = 700;
export const AVATAR_TEXT_DY = 17.8;

export function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return hash;
}

/**
 * Stable per seed, so the same user wears the same colour in every client
 * session without storing anything.
 */
export function getAvatarBackground(seed: string): string {
  return AVATAR_BACKGROUNDS[hashSeed(seed) % AVATAR_BACKGROUNDS.length];
}

/**
 * The API's default ceiling for an uploaded photo (`app.profile.max-avatar-size`, 2 MB),
 * checked here so no request is wasted. It is deliberately a fixed client-side gate
 * rather than a value fetched from the server: `prepareAvatarUpload` re-encodes to a
 * 512 px WebP first, so a real photo lands far below this, and a server limit raised
 * above it only means this stricter check is the one that answers.
 */
export const MAX_AVATAR_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Absolute image URLs only: a raster `data:` URL or http(s). Everything else — notably
 * `javascript:` and `data:text/html` — has no business reaching an image element, so it
 * resolves to `null` and the caller falls back to initials.
 */
const ABSOLUTE_AVATAR_URL = /^(?:https?:\/\/[^\s]+|data:image\/(?:png|jpe?g|gif|webp|avif)[;,])/i;

/**
 * Avatar values are either absolute (the generated `data:` URLs the comment UI needs) or
 * the host-independent `/api/...` path the API hands out for an uploaded photo. Only the
 * path form needs an origin — without it an `<img>` would ask the web dev server.
 *
 * The value crosses the trust boundary: it comes back from the API, and a snapshot in
 * IndexedDB can be edited by anyone with the device. Anything that is not an http(s)
 * image URL, a raster data URL or one of our own paths is refused rather than rendered.
 */
export function resolveAvatarUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value.startsWith('/api/')) {
    return `${getApiBaseUrl()}${value}`;
  }

  return ABSOLUTE_AVATAR_URL.test(value) ? value : null;
}

/**
 * First character of each name word, uppercased, capped at two: "Ada Lovelace"
 * → "AL", "Ada Lovelace King" → "AL", "Ada" → "A". An email contributes its
 * local part only, so "santhosh.kumar@example.com" → "SK".
 */
export function getAvatarInitials(name: string | null | undefined): string {
  const cleaned = (name ?? '').trim();
  const hostAt = cleaned.indexOf('@');
  const local = (hostAt === -1 ? cleaned : cleaned.slice(0, hostAt)).trim();

  const initials = local
    .split(WORD_SEPARATOR)
    .filter(Boolean)
    .map((word) => Array.from(word)[0] ?? '')
    .join('')
    .toUpperCase();

  return Array.from(initials).slice(0, MAX_INITIALS).join('') || '?';
}

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);
}

/**
 * The same avatar as a data URL, for consumers that can only take an image
 * source (BlockNote's comment UI) rather than the `UserAvatar` element.
 */
export function buildInitialsAvatarDataUrl(seed: string, name: string, size = 96): string {
  const initials = escapeXml(getAvatarInitials(name));
  const background = getAvatarBackground(seed || name || '');
  const text = `x="50%" y="50%" dy="${AVATAR_TEXT_DY}" text-anchor="middle" font-family="${AVATAR_FONT_FAMILY}" font-size="${AVATAR_FONT_SIZE}" font-weight="${AVATAR_FONT_WEIGHT}" fill="${AVATAR_TEXT_COLOR}"`;

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">`,
    `<rect width="100" height="100" rx="50" fill="${background}"/>`,
    // DiceBear's `default` variant draws the letters twice: a blend-mode layer
    // plus a half-opacity one, which reads as a soft emboss rather than flat text.
    `<g style="mix-blend-mode:overlay"><text ${text}>${initials}</text></g>`,
    `<g opacity="0.5"><text ${text}>${initials}</text></g>`,
    '</svg>',
  ].join('');

  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
