'use client';

import { act, renderHook } from '@testing-library/react';
import {
  DOCUMENT_TOOLBAR_INSET_FALLBACK_PX,
  DOCUMENT_TOOLBAR_SELECTOR,
  measureDocumentToolbarInset,
  useDocumentToolbarInset,
} from '../../../hooks/useDocumentToolbarInset.hook';
import { DOC_TOOLBAR_INSET_CSS_VAR } from '../../../lib/viewport-bounds.util';

/**
 * jsdom lays nothing out, so the strips report their own rects here. Only
 * `bottom` is read by the measurement.
 */
function stubToolbar(className: string, bottom: number) {
  const element = document.createElement('div');
  element.className = className;
  element.getBoundingClientRect = () => ({ bottom, top: 0, height: bottom }) as DOMRect;
  document.body.appendChild(element);
  return element;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.documentElement.style.removeProperty(DOC_TOOLBAR_INSET_CSS_VAR);
  delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
});

/** jsdom has no ResizeObserver; this records what was observed and lets a test fire it. */
function stubResizeObserver() {
  const callbacks: Array<() => void> = [];
  const observed: Element[] = [];

  class FakeResizeObserver {
    private readonly callback: () => void;

    constructor(callback: () => void) {
      this.callback = callback;
      callbacks.push(callback);
    }

    observe(element: Element) {
      observed.push(element);
    }

    disconnect() {
      callbacks.splice(callbacks.indexOf(this.callback), 1);
    }
  }

  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;

  return { observed, fire: () => callbacks.forEach((callback) => callback()) };
}

describe('measureDocumentToolbarInset', () => {
  it('falls back to the toolbar’s tallest row when there is no toolbar', () => {
    expect(measureDocumentToolbarInset(document)).toBe(DOCUMENT_TOOLBAR_INSET_FALLBACK_PX);
  });

  it('measures past the lowest toolbar strip, with the gap', () => {
    // The left strip is the taller one below `md`; the right one is the controls.
    stubToolbar('nd-doc-toolbar-left', 44);
    stubToolbar('nd-doc-toolbar', 36);

    expect(measureDocumentToolbarInset(document)).toBe(52);
  });

  it('ignores a strip that is not laid out, keeping the other one', () => {
    stubToolbar('nd-doc-toolbar-left', 0);
    stubToolbar('nd-doc-toolbar', 64);

    expect(measureDocumentToolbarInset(document)).toBe(72);
  });

  it('only reads the toolbar strips, not anything else on the page', () => {
    const other = document.createElement('div');
    other.className = 'nd-comments-sidebar';
    other.getBoundingClientRect = () => ({ bottom: 900, top: 0, height: 900 }) as DOMRect;
    document.body.appendChild(other);

    expect(measureDocumentToolbarInset(document)).toBe(DOCUMENT_TOOLBAR_INSET_FALLBACK_PX);
    expect(DOCUMENT_TOOLBAR_SELECTOR).not.toContain('nd-comments-sidebar');
  });
});

describe('useDocumentToolbarInset', () => {
  it('follows the toolbar as its own height changes', () => {
    const observer = stubResizeObserver();
    const toolbar = stubToolbar('nd-doc-toolbar', 36);
    const { result } = renderHook(() => useDocumentToolbarInset());

    expect(result.current).toBe(44);
    expect(observer.observed).toContain(toolbar);

    // A notice wrapping the toolbar onto a second row: the strip resizes without
    // the window doing anything.
    toolbar.getBoundingClientRect = () => ({ bottom: 80, top: 0, height: 80 }) as DOMRect;
    act(() => observer.fire());

    expect(result.current).toBe(88);
  });

  it('re-measures when the breakpoint swaps the toolbar rows', () => {
    stubToolbar('nd-doc-toolbar-left', 44);
    const { result } = renderHook(() => useDocumentToolbarInset());

    expect(result.current).toBe(52);

    // Back over `md`, where the strips are `h-7` rather than `h-9`.
    document.body.innerHTML = '';
    stubToolbar('nd-doc-toolbar-left', 36);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(result.current).toBe(44);
  });

  it('updates the inset when a toolbar strip mounts after initial render', async () => {
    const { result } = renderHook(() => useDocumentToolbarInset());
    expect(result.current).toBe(DOCUMENT_TOOLBAR_INSET_FALLBACK_PX);

    await act(async () => {
      stubToolbar('nd-doc-toolbar', 60);
    });

    expect(result.current).toBe(68);
  });

  it('ignores unrelated DOM mutations inside the document body', async () => {
    const { result } = renderHook(() => useDocumentToolbarInset());
    expect(result.current).toBe(DOCUMENT_TOOLBAR_INSET_FALLBACK_PX);

    const editorBlock = document.createElement('div');
    editorBlock.className = 'bn-block';
    await act(async () => {
      document.body.appendChild(editorBlock);
    });

    expect(result.current).toBe(DOCUMENT_TOOLBAR_INSET_FALLBACK_PX);
  });

  it('publishes the inset for CSS-positioned popups and clears it on unmount', () => {
    stubResizeObserver();
    stubToolbar('nd-doc-toolbar', 36);

    const { unmount } = renderHook(() => useDocumentToolbarInset());

    // Read by `styles/globals.css` to cap upward-opening toolbar popups
    // (block-type select, colour menu) below the toolbar.
    expect(document.documentElement.style.getPropertyValue(DOC_TOOLBAR_INSET_CSS_VAR)).toBe('44px');

    unmount();

    expect(document.documentElement.style.getPropertyValue(DOC_TOOLBAR_INSET_CSS_VAR)).toBe('');
  });
});
