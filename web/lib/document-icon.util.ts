import type {
  DocumentCover,
  DocumentCoverType,
  DocumentIcon,
  DocumentIconType,
} from '@/types/document.types';

/**
 * Page icons and covers arrive from the API and from anonymous share payloads,
 * and every value ends up in the DOM — as text, as an `<img src>`, or as a CSS
 * mask URL. Values are therefore re-validated here instead of trusted: a
 * malformed payload must degrade to "no icon/cover", never to a rendered URL.
 *
 * The rules mirror the server-side validator (`DocumentIconCoverApplier`) so a
 * value the client renders is always one the server would have accepted.
 */

const ICON_TYPES: readonly DocumentIconType[] = ['emoji', 'builtin', 'upload', 'link'];
const COVER_TYPES: readonly DocumentCoverType[] = ['upload', 'link'];

export const MAX_ICON_VALUE_LENGTH = 2048;

/** Builtin slugs address files on the API, so they must stay well-formed paths. */
const BUILTIN_SLUG_PATTERN = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;
const MAX_SLUG_LENGTH = 64;

const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zero-width joiner: binds the next code point into the current cluster. */
const ZERO_WIDTH_JOINER = 0x200d;

/** Regional-indicator block; two in a row form a single flag cluster. */
const REGIONAL_INDICATOR_START = 0x1f1e6;
const REGIONAL_INDICATOR_END = 0x1f1ff;

/** Marks, variation selectors, and skin-tone modifiers extend the cluster before them. */
const CLUSTER_EXTENDER = /^[\p{M}\u{1F3FB}-\u{1F3FF}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]$/u;

/**
 * Bidirectional controls that can visually reorder a rendered icon:
 * harmless in storage, a spoofing aid when rendered as text.
 * Mirrors the server's `BIDI_CONTROLS`.
 */
const BIDI_CONTROLS = new Set([
  0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0x061c,
]);

/**
 * Invisible zero-width format characters, none of which can be part of a visible
 * glyph. Unlike the bidi controls they reorder nothing: they are rejected because
 * an icon is exactly one emoji, and a format character placed directly after a
 * joiner folds into the preceding cluster, so the grapheme count alone accepts a
 * value holding extra invisible content. Mirrors the server's
 * `INVISIBLE_FORMAT_CONTROLS`; ZWJ is deliberately absent (a ZWJ sequence is one
 * emoji, not smuggled content).
 */
const INVISIBLE_FORMAT_CONTROLS = new Set([
  0x00ad, 0x200b, 0x200c, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff,
]);

/** Raster types the API accepts for a page icon/cover upload (mirrors `AttachmentContentTypes`). */
export const PAGE_IMAGE_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
];

/**
 * `accept` value for the icon/cover file inputs. Derived from
 * `PAGE_IMAGE_MIME_TYPES` — never a second handwritten list — so the two
 * cannot drift. Lives here so the cover picker does not import from its
 * sibling icon picker. Advisory only: `validatePageImageFile` re-checks
 * MIME/size.
 */
export const PAGE_IMAGE_ACCEPT = PAGE_IMAGE_MIME_TYPES.join(',');

/** Fail-fast client mirror of the server's default `ATTACHMENT_MAX_FILE_SIZE` (25MB). */
export const MAX_PAGE_IMAGE_BYTES = 25 * 1024 * 1024;

export const DEFAULT_COVER_POSITION = 0.5;

export function isDocumentIconType(value: unknown): value is DocumentIconType {
  return typeof value === 'string' && ICON_TYPES.includes(value as DocumentIconType);
}

export function isDocumentCoverType(value: unknown): value is DocumentCoverType {
  return typeof value === 'string' && COVER_TYPES.includes(value as DocumentCoverType);
}

function isUsableValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ICON_VALUE_LENGTH;
}

/** https-only with a host and no userinfo, mirroring the server link check. */
export function isHttpsUrl(value: string): boolean {
  // The `https://` prefix guard matters: WHATWG parses `https:foo` with host
  // `foo`, while Java's URI sees an opaque path and no host — the server
  // rejects it, so the client must too instead of rendering optimistically.
  if (!value.trim().toLowerCase().startsWith('https://')) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.host && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isAttachmentId(value: string): boolean {
  return ATTACHMENT_ID_PATTERN.test(value);
}

/** Java `Character.isISOControl`: U+0000-U+001F and U+007F-U+009F, via code points. */
function isIsoControlCodePoint(codePoint: number): boolean {
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
}

function containsBidiControl(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && BIDI_CONTROLS.has(codePoint)) {
      return true;
    }
  }
  return false;
}

function containsInvisibleFormatControl(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && INVISIBLE_FORMAT_CONTROLS.has(codePoint)) {
      return true;
    }
  }
  return false;
}

function containsIsoControl(value: string): boolean {
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && isIsoControlCodePoint(codePoint)) {
      return true;
    }
  }
  return false;
}

/**
 * Single-code-point mirror of the server's `isPictographic`: a symbol, a
 * supplementary-plane glyph, or the keycap combiner (which carries no
 * pictographic base of its own). One predicate for both "this value holds a
 * pictograph" and "this joiner actually joins".
 */
function isPictographicCodePoint(codePoint: number): boolean {
  if (codePoint >= 0x1d000 || codePoint === 0x20e3) {
    return true;
  }
  try {
    return /[\p{So}\p{Sk}]/u.test(String.fromCodePoint(codePoint));
  } catch {
    return false;
  }
}

/**
 * True when at least one code point is pictographic. Uses the
 * `Extended_Pictographic` property so prose ("click here", "<script>")
 * never passes as an emoji; joiners and variation selectors alone do not.
 * Keycap sequences (1️⃣, #️⃣) have no pictographic base, so U+20E3
 * explicitly counts — mirroring the server's `validateEmoji`.
 */
function hasPictographicCodePoint(value: string): boolean {
  try {
    if (/\p{Extended_Pictographic}/u.test(value)) {
      return true;
    }
  } catch {
    // Older runtimes without property escapes: fall through to the heuristic.
  }
  // Beyond Extended_Pictographic: keycap sequences (1️⃣) have no pictographic
  // base (U+20E3), and some runtimes exclude regional-indicator flags from the
  // property — both mirror the server's `validateEmoji` heuristic, per code point.
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && isPictographicCodePoint(codePoint)) {
      return true;
    }
  }
  return false;
}

/**
 * Counts the extended grapheme clusters a reader sees as emoji: marks, variation
 * selectors, and skin-tone modifiers extend the cluster before them, a zero-width
 * joiner binds a following pictograph into the current cluster (a ZWJ family is
 * one emoji, not several), and two regional indicators in a row are one flag.
 * Mirrors the server's `countGraphemeClusters`.
 */
function countGraphemeClusters(value: string): number {
  let clusters = 0;
  let afterJoiner = false;
  let afterRegionalIndicator = false;
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint === ZERO_WIDTH_JOINER) {
      afterJoiner = true;
      continue;
    }
    if (CLUSTER_EXTENDER.test(char)) {
      // GB9 glues an extender, but it also spends the join: GB11 joins only a
      // pictograph that follows the joiner directly, so an extender in between
      // leaves the two glyphs separate.
      afterJoiner = false;
      continue;
    }
    if (codePoint >= REGIONAL_INDICATOR_START && codePoint <= REGIONAL_INDICATOR_END) {
      if (afterRegionalIndicator) {
        afterRegionalIndicator = false;
        continue;
      }
      clusters += 1;
      afterRegionalIndicator = true;
      afterJoiner = false;
      continue;
    }
    afterRegionalIndicator = false;
    if (afterJoiner) {
      afterJoiner = false;
      // GB11: a joiner folds a following pictograph into the cluster before it.
      // Any other code point starts a new cluster, which is what makes
      // "😀\u200Da" two glyphs instead of one.
      if (isPictographicCodePoint(codePoint)) {
        continue;
      }
    }
    clusters += 1;
  }
  return clusters;
}

/**
 * Trims and validates a raw emoji value, mirroring
 * `DocumentIconCoverApplier.validateEmoji`: stripped, free of control/bidi/
 * invisible-format characters, exactly one grapheme cluster, and containing at least one
 * pictographic code point. Returns the stripped value or null. The 2048 storage
 * bound is already enforced by `isUsableValue`.
 */
function validateEmojiValue(raw: string): string | null {
  // Bidi and zero-width format characters are checked before the trim: JavaScript's
  // trim() treats a leading/trailing U+FEFF as whitespace and drops it, while Java's
  // strip() does not, so a trailing one would otherwise be normalized away here and
  // rejected on the server — the two would disagree about a stored value.
  if (containsBidiControl(raw) || containsInvisibleFormatControl(raw)) {
    return null;
  }
  const value = raw.trim();
  if (!value) {
    return null;
  }
  // ISO controls are checked after the trim, which drops the leading/trailing
  // whitespace ones exactly as the server's strip() does.
  if (containsIsoControl(value)) {
    return null;
  }
  // One grapheme cluster, not a code-point budget: a budget contradicts "a single
  // emoji" in both directions — sixteen separate 😀 fit inside it and passed as
  // one, while a single base glyph carrying combining marks was rejected for
  // length.
  if (countGraphemeClusters(value) !== 1) {
    return null;
  }
  if (!hasPictographicCodePoint(value)) {
    return null;
  }
  return value;
}

/**
 * Whether `value` is a syntactically valid builtin slug: 1-64 characters of
 * alphanumerics in hyphen-separated groups. Mirrors the server's
 * `IconSlugs.isWellFormed` — membership in the catalog is a separate question.
 * Exported so the bundle cache can reject malformed keys the same way.
 */
export function isWellFormedBuiltinSlug(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_SLUG_LENGTH &&
    BUILTIN_SLUG_PATTERN.test(value)
  );
}

/** Validates one icon type/value pair; unknown shapes yield null. */
function validateIconValue(type: DocumentIconType, rawValue: string): string | null {
  switch (type) {
    case 'emoji':
      return validateEmojiValue(rawValue);
    case 'builtin': {
      const value = rawValue.trim();
      return isWellFormedBuiltinSlug(value) ? value : null;
    }
    case 'upload': {
      const value = rawValue.trim();
      return isAttachmentId(value) ? value : null;
    }
    case 'link': {
      const value = rawValue.trim();
      return isHttpsUrl(value) ? value : null;
    }
  }
}

/**
 * The single icon-color list: every picker, renderer, and validator imports
 * this — never a second handwritten copy. The CSS hex values in
 * `styles/theme.css` (`--nd-icon-color-*`) and the server's
 * `ALLOWED_ICON_COLORS` + `V18` migration mirror it; drift is caught by
 * `DocumentIconColorPaletteTest` (server) and the palette test below (web).
 */
export const ICON_COLORS = [
  { id: 'default', label: 'Default' },
  { id: 'gray', label: 'Gray' },
  { id: 'brown', label: 'Brown' },
  { id: 'orange', label: 'Orange' },
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'purple', label: 'Purple' },
  { id: 'pink', label: 'Pink' },
  { id: 'red', label: 'Red' },
] as const;

export type IconColorId = (typeof ICON_COLORS)[number]['id'];

export function isIconColorId(value: unknown): value is IconColorId {
  return typeof value === 'string' && ICON_COLORS.some((c) => c.id === value.toLowerCase());
}

/**
 * Fail-fast guard for picker uploads. The `accept` attribute is advisory only,
 * so MIME and size are re-checked here before any network request. The server
 * remains authoritative (size limit, quota, and the icon/cover raster-type
 * check in `DocumentIconCoverApplier`); this only avoids a doomed upload.
 * Returns an error message or null when the file may be uploaded.
 */
export function validatePageImageFile(file: File): string | null {
  const contentType = (file.type || '').toLowerCase();
  if (!PAGE_IMAGE_MIME_TYPES.includes(contentType)) {
    return 'Image must be PNG, JPEG, GIF, WebP or AVIF.';
  }
  if (file.size > MAX_PAGE_IMAGE_BYTES) {
    return 'File exceeds the maximum allowed size of 25.0 MB.';
  }
  if (file.size <= 0) {
    return 'The selected file is empty.';
  }
  return null;
}

/** Page icon from an untrusted payload, or undefined when there is none/there is garbage. */
export function sanitizeDocumentIcon(raw: unknown): DocumentIcon | undefined {
  if (raw == null || typeof raw !== 'object') {
    return undefined;
  }
  const candidate = raw as { type?: unknown; value?: unknown; color?: unknown };
  const type = typeof candidate.type === 'string' ? candidate.type.toLowerCase() : null;
  if (!isDocumentIconType(type) || !isUsableValue(candidate.value)) {
    return undefined;
  }
  const value = validateIconValue(type, candidate.value);
  if (value === null) {
    return undefined;
  }
  let color: IconColorId | undefined;
  if (type === 'builtin' && typeof candidate.color === 'string') {
    const lower = candidate.color.toLowerCase();
    if (isIconColorId(lower) && lower !== 'default') {
      color = lower;
    }
  }
  return { type, value, ...(color ? { color } : {}) };
}

/** Clamps a vertical focal offset into [0, 1]; missing input reads as centred. */
export function clampCoverPosition(value: unknown): number {
  // `Number(null)` is 0 (top) while `Number(undefined)` is NaN (centred):
  // a missing position must mean middle, never top.
  if (value === null || value === undefined) {
    return DEFAULT_COVER_POSITION;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_COVER_POSITION;
  }
  return Math.min(1, Math.max(0, numeric));
}

/** Page cover from an untrusted payload, or undefined when there is none/there is garbage. */
export function sanitizeDocumentCover(raw: unknown): DocumentCover | undefined {
  if (raw == null || typeof raw !== 'object') {
    return undefined;
  }
  const candidate = raw as { type?: unknown; value?: unknown; position?: unknown };
  const type = typeof candidate.type === 'string' ? candidate.type.toLowerCase() : null;
  if (!isDocumentCoverType(type) || !isUsableValue(candidate.value)) {
    return undefined;
  }
  const rawValue = candidate.value;
  const value = rawValue.trim();
  const isValidValue = type === 'upload' ? isAttachmentId(value) : isHttpsUrl(value);
  if (!isValidValue) {
    return undefined;
  }
  return { type, value, position: clampCoverPosition(candidate.position) };
}

/**
 * Host-independent stored path for an uploaded attachment, the same shape file
 * blocks keep in Yjs. The signed URL is minted from it at render time.
 */
export function storedAttachmentUrl(attachmentId: string): string {
  return `/api/v1/attachments/${attachmentId}`;
}

/** API path of a builtin catalog glyph; callers prefix it with the API base URL. */
export function builtinIconPath(slug: string): string {
  return `/api/v1/icons/${encodeURIComponent(slug)}`;
}

/**
 * Embeds one bundle glyph as a mask URL, so the picker grid renders without
 * one HTTP request per icon. Returns null for non-SVG input, letting callers
 * fall back to {@link builtinIconPath}.
 */
export function builtinSvgDataUrl(svg: unknown): string | null {
  if (typeof svg !== 'string') {
    return null;
  }
  const text = svg.trim();
  if (!text.startsWith('<svg') || !text.endsWith('</svg>')) {
    return null;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}

/**
 * Focal offset after a vertical drag. The image tracks the pointer 1:1: dragging
 * it down (a positive delta) reveals more of the top, which lowers the offset,
 * and the result sticks at either edge instead of scrolling past it.
 */
export function coverPositionAfterDrag({
  startPosition,
  startPointerY,
  pointerY,
  coverHeight,
}: {
  startPosition: number;
  startPointerY: number;
  pointerY: number;
  coverHeight: number;
}): number {
  if (!Number.isFinite(coverHeight) || coverHeight <= 0) {
    return clampCoverPosition(startPosition);
  }
  return clampCoverPosition(startPosition - (pointerY - startPointerY) / coverHeight);
}

/** `object-position` for a cover at the given focal offset. */
export function coverObjectPosition(position: number): string {
  return `center ${(clampCoverPosition(position) * 100).toFixed(2)}%`;
}

/**
 * Single commit gate for cover repositioning.
 *
 * `PageCover` stages drag/keyboard steps locally in `dragPosition` and commits
 * once (pointer-up, Enter, Done, blur). The four sites previously repeated the
 * same null/equality check; one helper keeps "stays local until committed"
 * true everywhere.
 */
export function commitDragPosition({
  dragPosition,
  committedPosition,
  onPositionChange,
}: {
  dragPosition: number | null;
  committedPosition: number;
  onPositionChange: (position: number) => void;
}): void {
  if (dragPosition !== null && dragPosition !== committedPosition) {
    onPositionChange(dragPosition);
  }
}

export interface IconRequestPayload {
  type: string | null;
  value: string | null;
  color?: string | null;
}

export interface CoverRequestPayload {
  type: string | null;
  value: string | null;
  position: number | null;
}

/** PATCH body for an icon: a null payload clears it (see `DocumentIconRequest`). */
export function toIconRequestPayload(icon: DocumentIcon | null): IconRequestPayload {
  if (!icon) {
    return { type: null, value: null };
  }
  return {
    type: icon.type,
    value: icon.value,
    ...(icon.type === 'builtin' ? { color: icon.color ?? null } : {}),
  };
}

/** PATCH body for a cover: a null payload clears it (see `DocumentCoverRequest`). */
export function toCoverRequestPayload(cover: DocumentCover | null): CoverRequestPayload {
  return cover
    ? { type: cover.type, value: cover.value, position: clampCoverPosition(cover.position) }
    : { type: null, value: null, position: null };
}
