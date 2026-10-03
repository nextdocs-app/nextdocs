import { normalizeDocumentTitle } from '@/lib/document-content.util';

describe('document-content.util normalizeDocumentTitle', () => {
  it('keeps non-blank titles as-is', () => {
    expect(normalizeDocumentTitle('Hello')).toBe('Hello');
  });

  it('falls back to Untitled for empty titles', () => {
    expect(normalizeDocumentTitle('')).toBe('Untitled');
  });

  it('falls back to Untitled for whitespace-only titles', () => {
    expect(normalizeDocumentTitle('   ')).toBe('Untitled');
  });

  it('falls back to Untitled for undefined titles', () => {
    expect(normalizeDocumentTitle(undefined)).toBe('Untitled');
  });
});
