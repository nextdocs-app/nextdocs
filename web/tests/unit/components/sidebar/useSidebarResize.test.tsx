import { renderHook as baseRenderHook, act } from '@testing-library/react';
import React from 'react';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_WIDTH_CSS_VAR,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from '../../../../lib/sidebar-width.util';
import { useSidebarResize } from '../../../../components/sidebar/useSidebarResize';

const renderHook = (hookFn: () => ReturnType<typeof useSidebarResize>) =>
  baseRenderHook(hookFn, {
    wrapper: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  });

const appliedWidth = () => document.documentElement.style.getPropertyValue(SIDEBAR_WIDTH_CSS_VAR);

/** Stand in for the head script: the rail already has its stored width. */
const seedAppliedWidth = (width: number) =>
  document.documentElement.style.setProperty(SIDEBAR_WIDTH_CSS_VAR, `${width}px`);

const startDrag = (result: { current: ReturnType<typeof useSidebarResize> }) => {
  act(() => {
    result.current.startResizing({ preventDefault: jest.fn() });
  });
};

describe('useSidebarResize', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.body.classList.remove('nd-sidebar-resizing');
    document.documentElement.classList.remove('nd-sidebar-resizing');
    document.documentElement.style.removeProperty(SIDEBAR_WIDTH_CSS_VAR);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('leaves the width the page already painted alone on mount', () => {
    seedAppliedWidth(420);

    const { result } = renderHook(() => useSidebarResize());

    expect(result.current.isResizing).toBe(false);
    expect(appliedWidth()).toBe('420px');
  });

  it('starts a drag from the width that is actually painted', () => {
    seedAppliedWidth(420);
    const { result } = renderHook(() => useSidebarResize());

    startDrag(result);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    // No movement: the dragged width is what was on screen, not a default.
    expect(appliedWidth()).toBe('420px');
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe('420');
  });

  it('falls back to the default width when the page has none', () => {
    const { result } = renderHook(() => useSidebarResize());

    startDrag(result);
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(appliedWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_DEFAULT_WIDTH));
  });

  it('locks body styles and classes on startResizing', () => {
    const { result } = renderHook(() => useSidebarResize());

    startDrag(result);

    expect(result.current.isResizing).toBe(true);
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.classList.contains('nd-sidebar-resizing')).toBe(true);
    expect(document.documentElement.classList.contains('nd-sidebar-resizing')).toBe(true);
  });

  it('cleans up body lock styles and classes if unmounted mid-drag', () => {
    const { result, unmount } = renderHook(() => useSidebarResize());

    startDrag(result);

    expect(document.body.classList.contains('nd-sidebar-resizing')).toBe(true);
    expect(document.body.style.userSelect).toBe('none');

    // Unmount while still resizing
    unmount();

    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
    expect(document.body.classList.contains('nd-sidebar-resizing')).toBe(false);
    expect(document.documentElement.classList.contains('nd-sidebar-resizing')).toBe(false);
  });

  it('resizes smoothly, saves on mouseup, and coalesces rAF without a second pass', () => {
    seedAppliedWidth(SIDEBAR_DEFAULT_WIDTH);
    const { result } = renderHook(() => useSidebarResize());

    startDrag(result);

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
    });

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(result.current.isResizing).toBe(false);
    expect(appliedWidth()).toBe('350px');
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe('350');
    expect(document.body.classList.contains('nd-sidebar-resizing')).toBe(false);
    expect(document.documentElement.classList.contains('nd-sidebar-resizing')).toBe(false);
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('clamps the dragged width into range', () => {
    seedAppliedWidth(SIDEBAR_DEFAULT_WIDTH);
    const { result } = renderHook(() => useSidebarResize());

    startDrag(result);
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 }));
    });
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(appliedWidth()).toBe(`${SIDEBAR_MAX_WIDTH}px`);
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_MAX_WIDTH));
  });

  it('flushes the CSS var synchronously on mouseup even if rAF callback was pending', () => {
    let capturedRafCallback: FrameRequestCallback | null = null;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      capturedRafCallback = cb;
      return 123;
    });
    const cancelSpy = jest.spyOn(window, 'cancelAnimationFrame');
    seedAppliedWidth(SIDEBAR_DEFAULT_WIDTH);

    const { result } = renderHook(() => useSidebarResize());

    startDrag(result);

    // Mousemove to 420 — this schedules rAF without invoking it immediately
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 420 }));
    });

    expect(capturedRafCallback).not.toBeNull();
    expect(appliedWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);

    // Mouseup occurs while rAF is still pending
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(cancelSpy).toHaveBeenCalledWith(123);
    expect(appliedWidth()).toBe('420px');
  });

  it('coalesces rapid mousemove events via requestAnimationFrame', () => {
    let rafCallback: FrameRequestCallback | null = null;
    let rafCallCount = 0;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCallCount++;
      rafCallback = cb;
      return rafCallCount;
    });
    seedAppliedWidth(SIDEBAR_DEFAULT_WIDTH);

    const { result } = renderHook(() => useSidebarResize());

    startDrag(result);

    // Fire 3 rapid mouse movements
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 340 }));
    });

    // Only 1 rAF should be scheduled for the burst
    expect(rafCallCount).toBe(1);
    expect(appliedWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);

    act(() => {
      rafCallback?.(performance.now());
    });

    // CSS var should now reflect the latest width (340px)
    expect(appliedWidth()).toBe('340px');

    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
  });

  it('supports resizing via pointer events if window.PointerEvent is supported', () => {
    const originalPointerEvent = (window as unknown as { PointerEvent?: unknown }).PointerEvent;
    (window as unknown as { PointerEvent: unknown }).PointerEvent = MouseEvent;
    seedAppliedWidth(SIDEBAR_DEFAULT_WIDTH);

    try {
      const { result } = renderHook(() => useSidebarResize());

      startDrag(result);

      expect(result.current.isResizing).toBe(true);

      // In pointer mode, mousemove should NOT trigger resize
      act(() => {
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 450 }));
      });
      expect(appliedWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);

      act(() => {
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 380 }));
      });

      act(() => {
        window.dispatchEvent(new MouseEvent('pointerup'));
      });

      expect(result.current.isResizing).toBe(false);
      expect(appliedWidth()).toBe('380px');
    } finally {
      if (originalPointerEvent === undefined) {
        delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
      } else {
        (window as unknown as { PointerEvent: unknown }).PointerEvent = originalPointerEvent;
      }
    }
  });

  it('allows startResizing to be called without arguments', () => {
    const { result } = renderHook(() => useSidebarResize());

    act(() => {
      result.current.startResizing();
    });

    expect(result.current.isResizing).toBe(true);
    expect(document.body.classList.contains('nd-sidebar-resizing')).toBe(true);
  });

  it('does not throw when localStorage.setItem throws on drag end', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError', 'QuotaExceededError');
    });

    const { result } = renderHook(() => useSidebarResize());

    startDrag(result);

    expect(() => {
      act(() => {
        window.dispatchEvent(new MouseEvent('mouseup'));
      });
    }).not.toThrow();

    expect(result.current.isResizing).toBe(false);
  });
});
