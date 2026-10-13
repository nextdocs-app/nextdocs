import {
  DEFAULT_COVER_POSITION,
  builtinIconPath,
  builtinSvgDataUrl,
  clampCoverPosition,
  coverObjectPosition,
  coverPositionAfterDrag,
  sanitizeDocumentCover,
  sanitizeDocumentIcon,
  storedAttachmentUrl,
  toCoverRequestPayload,
  toIconRequestPayload,
} from '@/lib/document-icon.util';

const ATTACHMENT_ID = '11111111-2222-4333-8444-555555555555';

describe('document-icon.util', () => {
  describe('sanitizeDocumentIcon', () => {
    it('accepts each source with a valid value', () => {
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '📝' })).toEqual({
        type: 'emoji',
        value: '📝',
      });
      expect(sanitizeDocumentIcon({ type: 'builtin', value: 'airplane' })).toEqual({
        type: 'builtin',
        value: 'airplane',
      });
      expect(sanitizeDocumentIcon({ type: 'upload', value: ATTACHMENT_ID })).toEqual({
        type: 'upload',
        value: ATTACHMENT_ID,
      });
      expect(sanitizeDocumentIcon({ type: 'link', value: 'https://example.com/i.png' })).toEqual({
        type: 'link',
        value: 'https://example.com/i.png',
      });
      expect(sanitizeDocumentIcon({ type: 'builtin', value: 'airplane', color: 'blue' })).toEqual({
        type: 'builtin',
        value: 'airplane',
        color: 'blue',
      });
      expect(
        sanitizeDocumentIcon({ type: 'builtin', value: 'airplane', color: 'default' })
      ).toEqual({
        type: 'builtin',
        value: 'airplane',
      });
      expect(
        sanitizeDocumentIcon({ type: 'builtin', value: 'airplane', color: 'invalid-color' })
      ).toEqual({
        type: 'builtin',
        value: 'airplane',
      });
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '📝', color: 'blue' })).toEqual({
        type: 'emoji',
        value: '📝',
      });
    });

    it('normalizes an upper-case type from the wire', () => {
      expect(sanitizeDocumentIcon({ type: 'EMOJI', value: '🔥' })).toEqual({
        type: 'emoji',
        value: '🔥',
      });
    });

    it('rejects anything that is not a well-formed icon', () => {
      expect(sanitizeDocumentIcon(null)).toBeUndefined();
      expect(sanitizeDocumentIcon(undefined)).toBeUndefined();
      expect(sanitizeDocumentIcon('📝')).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'emoji' })).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '' })).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'photo', value: 'x' })).toBeUndefined();
    });

    it('rejects a builtin slug that could climb out of the catalog path', () => {
      expect(sanitizeDocumentIcon({ type: 'builtin', value: '../../etc/passwd' })).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'builtin', value: 'air plane' })).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'builtin', value: 'a'.repeat(65) })).toBeUndefined();
    });

    it('rejects an upload id that is not a UUID and a link that is not https', () => {
      expect(sanitizeDocumentIcon({ type: 'upload', value: 'not-an-id' })).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'upload', value: '../attachments/1' })).toBeUndefined();
      expect(
        sanitizeDocumentIcon({ type: 'link', value: 'http://example.com/i.png' })
      ).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'link', value: 'javascript:alert(1)' })).toBeUndefined();
      expect(
        sanitizeDocumentIcon({ type: 'link', value: 'https://user:pass@example.com/i.png' })
      ).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'link', value: 'https:foo' })).toBeUndefined();
    });

    it('rejects prose masquerading as an emoji', () => {
      expect(sanitizeDocumentIcon({ type: 'emoji', value: 'x'.repeat(33) })).toBeUndefined();
    });

    it('accepts keycap and flag emoji from the full emoji family', () => {
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '1️⃣' })).toEqual({
        type: 'emoji',
        value: '1️⃣',
      });
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '🇺🇸' })).toEqual({
        type: 'emoji',
        value: '🇺🇸',
      });
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '1' })).toBeUndefined();
    });

    it('rejects more than one emoji', () => {
      // The reviewed counterexample: sixteen separate 😀 fit inside a 16-code-point
      // budget and passed as "a single emoji".
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '😀'.repeat(16) })).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '😀🚀' })).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '🇺🇸🇨🇦' })).toBeUndefined();
    });

    it('rejects invisible format characters smuggled behind a joiner', () => {
      // Each folds into the preceding cluster, so the grapheme count above accepted
      // them: '👨\u200d\u200b' is one cluster by those rules alone.
      for (const invisible of ['\u200b', '\ufeff', '\u2060', '\u00ad', '\u200c', '\u2063']) {
        expect(
          sanitizeDocumentIcon({ type: 'emoji', value: `👨\u200d${invisible}` })
        ).toBeUndefined();
      }
    });

    it('rejects bidi controls that visually reorder a rendered icon', () => {
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '📝\u202a' })).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '📝\u202e' })).toBeUndefined();
    });

    it('accepts a joined, skin-toned family as one cluster', () => {
      // Joiner escapes rather than literal ZWJ glyphs: the sequence must be
      // exactly one cluster however it is written, and a lost joiner would turn
      // it into four emoji.
      const family = ['👨🏽', '\u200d', '👩🏿', '\u200d', '👧🏻', '\u200d', '👦🏾'].join('');

      expect(sanitizeDocumentIcon({ type: 'emoji', value: family })).toEqual({
        type: 'emoji',
        value: family,
      });
    });

    it('rejects a joiner that does not join a pictograph', () => {
      // UAX #29 joins only a pictograph to the cluster before the joiner, so these
      // are two glyphs each: the count used to fold whatever followed the joiner
      // into the preceding cluster and store them as one emoji.
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '😀\u200da' })).toBeUndefined();
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '😀\u200d#' })).toBeUndefined();
      // An extender between the joiner and the pictograph spends the join.
      expect(sanitizeDocumentIcon({ type: 'emoji', value: '😀\u200d\u0301😀' })).toBeUndefined();
    });

    it('keeps joining a pictograph that follows the joiner directly', () => {
      // The sequences this rule exists for: skin tones and variation selectors sit
      // on either side of the joiner without spending it.
      for (const joined of ['👋🏽\u200d♀️', '🫱🏽\u200d🫲🏻', '👨\u200d👩\u200d👧']) {
        expect(sanitizeDocumentIcon({ type: 'emoji', value: joined })).toEqual({
          type: 'emoji',
          value: joined,
        });
      }
    });

    it('accepts one cluster longer than the old code-point budget', () => {
      // A base glyph plus combining marks is one emoji in 21 code points, which
      // the code-point budget rejected.
      const decorated = '😀' + '\u0301'.repeat(20);
      expect(sanitizeDocumentIcon({ type: 'emoji', value: decorated })).toEqual({
        type: 'emoji',
        value: decorated,
      });
    });

    it('rejects an emoji value past the 2048 storage bound', () => {
      expect(
        sanitizeDocumentIcon({ type: 'emoji', value: '😀' + '\u0301'.repeat(2100) })
      ).toBeUndefined();
    });
  });

  describe('sanitizeDocumentCover', () => {
    it('accepts uploads and links, clamping the focal offset', () => {
      expect(
        sanitizeDocumentCover({ type: 'upload', value: ATTACHMENT_ID, position: 0.3 })
      ).toEqual({ type: 'upload', value: ATTACHMENT_ID, position: 0.3 });
      expect(
        sanitizeDocumentCover({ type: 'link', value: 'https://example.com/c.jpg', position: 4 })
      ).toEqual({ type: 'link', value: 'https://example.com/c.jpg', position: 1 });
    });

    it('centres a cover that arrives without a position', () => {
      expect(sanitizeDocumentCover({ type: 'upload', value: ATTACHMENT_ID })?.position).toBe(
        DEFAULT_COVER_POSITION
      );
    });

    it('rejects icon-only types and malformed values', () => {
      expect(sanitizeDocumentCover({ type: 'emoji', value: '📝' })).toBeUndefined();
      expect(
        sanitizeDocumentCover({ type: 'link', value: 'ftp://example.com/c.jpg' })
      ).toBeUndefined();
      expect(
        sanitizeDocumentCover({ type: 'link', value: 'https://user:pass@example.com/c.jpg' })
      ).toBeUndefined();
      expect(sanitizeDocumentCover({ type: 'upload', value: 'nope' })).toBeUndefined();
      expect(sanitizeDocumentCover(null)).toBeUndefined();
    });
  });

  describe('clampCoverPosition', () => {
    it('clamps into [0, 1] and falls back to centred for non-numbers', () => {
      expect(clampCoverPosition(-2)).toBe(0);
      expect(clampCoverPosition(2)).toBe(1);
      expect(clampCoverPosition(0.42)).toBe(0.42);
      expect(clampCoverPosition('0.3')).toBe(0.3);
      expect(clampCoverPosition(Number.NaN)).toBe(DEFAULT_COVER_POSITION);
      expect(clampCoverPosition(undefined)).toBe(DEFAULT_COVER_POSITION);
    });

    it('treats a missing position as middle, never top', () => {
      // Number(null) is 0 (top) while Number(undefined) is NaN (centred).
      expect(clampCoverPosition(null)).toBe(DEFAULT_COVER_POSITION);
      expect(
        sanitizeDocumentCover({ type: 'upload', value: ATTACHMENT_ID, position: null })?.position
      ).toBe(DEFAULT_COVER_POSITION);
    });
  });

  describe('urls', () => {
    it('builds the stored attachment path file blocks use', () => {
      expect(storedAttachmentUrl(ATTACHMENT_ID)).toBe(`/api/v1/attachments/${ATTACHMENT_ID}`);
    });

    it('encodes the builtin slug into the catalog path', () => {
      expect(builtinIconPath('airplane')).toBe('/api/v1/icons/airplane');
      expect(builtinIconPath('a/b')).toBe('/api/v1/icons/a%2Fb');
    });

    it('embeds bundle glyph text as a mask data URL', () => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>';
      const url = builtinSvgDataUrl(svg);
      expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      expect(decodeURIComponent(url!.split(',', 2)[1])).toBe(svg);
    });

    it('rejects non-SVG bundle text so callers fall back to the glyph URL', () => {
      // Shape-only on purpose: the server sanitizes glyphs at boot, so the
      // client just needs to tell "glyph text" from "not glyph text".
      expect(builtinSvgDataUrl('not an svg')).toBeNull();
      expect(builtinSvgDataUrl(42)).toBeNull();
      expect(builtinSvgDataUrl(null)).toBeNull();
    });
  });

  describe('cover geometry', () => {
    it('maps a focal offset onto object-position', () => {
      expect(coverObjectPosition(0)).toBe('center 0.00%');
      expect(coverObjectPosition(0.5)).toBe('center 50.00%');
      expect(coverObjectPosition(2)).toBe('center 100.00%');
    });

    it('tracks a downward drag 1:1 and sticks at the edges', () => {
      // Dragging down by half the frame reveals the top half of the picture.
      expect(
        coverPositionAfterDrag({
          startPosition: 0.5,
          startPointerY: 100,
          pointerY: 200,
          coverHeight: 200,
        })
      ).toBe(0);
      // Dragging up past the edge clamps at the bottom of the picture.
      expect(
        coverPositionAfterDrag({
          startPosition: 0.5,
          startPointerY: 100,
          pointerY: -600,
          coverHeight: 200,
        })
      ).toBe(1);
    });

    it('leaves the position alone when the frame has no height yet', () => {
      expect(
        coverPositionAfterDrag({
          startPosition: 0.25,
          startPointerY: 10,
          pointerY: 400,
          coverHeight: 0,
        })
      ).toBe(0.25);
    });
  });

  describe('request payloads', () => {
    it('clears the icon or cover with an explicit null payload', () => {
      expect(toIconRequestPayload(null)).toEqual({ type: null, value: null });
      expect(toCoverRequestPayload(null)).toEqual({ type: null, value: null, position: null });
    });

    it('sends color for builtin icon or null if uncolored', () => {
      expect(toIconRequestPayload({ type: 'builtin', value: 'airplane', color: 'blue' })).toEqual({
        type: 'builtin',
        value: 'airplane',
        color: 'blue',
      });
      expect(toIconRequestPayload({ type: 'builtin', value: 'airplane' })).toEqual({
        type: 'builtin',
        value: 'airplane',
        color: null,
      });
    });

    it('sends the clamped offset for a set cover', () => {
      expect(
        toCoverRequestPayload({ type: 'link', value: 'https://x/y.jpg', position: 5 })
      ).toEqual({
        type: 'link',
        value: 'https://x/y.jpg',
        position: 1,
      });
    });
  });
});
