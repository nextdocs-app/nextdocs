import { renderHook as baseRenderHook, act } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import sidebarReducer from '../../../../stores/sidebar/sidebar.slice';
import { useSidebarResize } from '../../../../components/sidebar/useSidebarResize';

const createMockStore = () =>
  configureStore({
    reducer: {
      sidebar: sidebarReducer,
    },
  });

const renderHookWithStore = (
  store: ReturnType<typeof createMockStore>,
  hookFn: () => ReturnType<typeof useSidebarResize>
) => {
  return baseRenderHook(hookFn, {
    wrapper: ({ children }: { children?: React.ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
};

describe('useSidebarResize', () => {
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    localStorage.clear();
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    document.body.classList.remove('nd-sidebar-resizing');
    document.documentElement.classList.remove('nd-sidebar-resizing');
    document.documentElement.style.removeProperty('--nd-sidebar-width');
    store = createMockStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('initializes with default width when localStorage is empty', () => {
    const { result } = renderHookWithStore(store, () => useSidebarResize(256, 200, 500));
    expect(result.current.sidebarWidth).toBe(256);
    expect(result.current.isResizing).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--nd-sidebar-width')).toBe('256px');
    expect(store.getState().sidebar.sidebarWidth).toBe(256);
  });

  it('initializes with stored width from localStorage within constraints', () => {
    localStorage.setItem('nextdocs-sidebar-width', '340');
    const { result } = renderHookWithStore(store, () => useSidebarResize(256, 200, 500));
    expect(result.current.sidebarWidth).toBe(340);
    expect(document.documentElement.style.getPropertyValue('--nd-sidebar-width')).toBe('340px');
  });

  it('falls back to initialWidth if localStorage contains out-of-bounds value', () => {
    localStorage.setItem('nextdocs-sidebar-width', '999');
    const { result } = renderHookWithStore(store, () => useSidebarResize(256, 200, 500));
    expect(result.current.sidebarWidth).toBe(256);
  });

  it('falls back to initialWidth when localStorage.getItem throws SecurityError', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    const { result } = renderHookWithStore(store, () => useSidebarResize(256, 200, 500));
    expect(result.current.sidebarWidth).toBe(256);
  });

  it('locks body styles and classes on startResizing', () => {
    const { result } = renderHookWithStore(store, () => useSidebarResize());

    act(() => {
      const mockEvent = { preventDefault: jest.fn() } as unknown as React.MouseEvent;
      result.current.startResizing(mockEvent);
    });

    expect(result.current.isResizing).toBe(true);
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.classList.contains('nd-sidebar-resizing')).toBe(true);
    expect(document.documentElement.classList.contains('nd-sidebar-resizing')).toBe(true);
  });

  it('cleans up body lock styles and classes if unmounted mid-drag', () => {
    const { result, unmount } = renderHookWithStore(store, () => useSidebarResize());

    act(() => {
      const mockEvent = { preventDefault: jest.fn() } as unknown as React.MouseEvent;
      result.current.startResizing(mockEvent);
    });

    expect(document.body.classList.contains('nd-sidebar-resizing')).toBe(true);
    expect(document.body.style.userSelect).toBe('none');

    // Unmount while still resizing
    unmount();

    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
    expect(document.body.classList.contains('nd-sidebar-resizing')).toBe(false);
    expect(document.documentElement.classList.contains('nd-sidebar-resizing')).toBe(false);
  });

  it('resizes smoothly, saves on mouseup, and dispatches to Redux once without double-dispatch', () => {
    const dispatchSpy = jest.spyOn(store, 'dispatch');
    const { result } = renderHookWithStore(store, () => useSidebarResize(256, 200, 500));

    // Clear initial mount dispatch from spy
    dispatchSpy.mockClear();

    // Start resizing
    act(() => {
      const mockEvent = { preventDefault: jest.fn() } as unknown as React.MouseEvent;
      result.current.startResizing(mockEvent);
    });

    // Mousemove to 350
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 350 }));
    });

    // Releasing mouse
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(result.current.isResizing).toBe(false);
    expect(result.current.sidebarWidth).toBe(350);
    expect(localStorage.getItem('nextdocs-sidebar-width')).toBe('350');
    expect(document.documentElement.style.getPropertyValue('--nd-sidebar-width')).toBe('350px');
    expect(document.body.classList.contains('nd-sidebar-resizing')).toBe(false);
    expect(document.documentElement.classList.contains('nd-sidebar-resizing')).toBe(false);
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');

    // Dispatched exactly once upon completion
    const setWidthDispatches = dispatchSpy.mock.calls.filter(
      (call) => (call[0] as { type?: string }).type === 'sidebar/setSidebarWidth'
    );
    expect(setWidthDispatches).toHaveLength(1);
    expect(setWidthDispatches[0][0]).toEqual({
      type: 'sidebar/setSidebarWidth',
      payload: 350,
    });
  });

  it('flushes --nd-sidebar-width synchronously on mouseup even if rAF callback was pending', () => {
    let capturedRafCallback: FrameRequestCallback | null = null;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      capturedRafCallback = cb;
      return 123;
    });
    const cancelSpy = jest.spyOn(window, 'cancelAnimationFrame');

    const { result } = renderHookWithStore(store, () => useSidebarResize(256, 200, 500));

    act(() => {
      const mockEvent = { preventDefault: jest.fn() } as unknown as React.MouseEvent;
      result.current.startResizing(mockEvent);
    });

    // Mousemove to 420 — this schedules rAF without invoking it immediately
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 420 }));
    });

    expect(capturedRafCallback).not.toBeNull();
    // Before mouseup and before rAF fires, CSS var is still at initial 256px
    expect(document.documentElement.style.getPropertyValue('--nd-sidebar-width')).toBe('256px');

    // Mouseup occurs while rAF is still pending
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });

    // stopResizing should cancel the pending rAF and synchronously flush 420px to DOM
    expect(cancelSpy).toHaveBeenCalledWith(123);
    expect(document.documentElement.style.getPropertyValue('--nd-sidebar-width')).toBe('420px');
    expect(result.current.sidebarWidth).toBe(420);
  });

  it('coalesces rapid mousemove events via requestAnimationFrame', () => {
    let rafCallback: FrameRequestCallback | null = null;
    let rafCallCount = 0;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCallCount++;
      rafCallback = cb;
      return rafCallCount;
    });

    const { result } = renderHookWithStore(store, () => useSidebarResize(256, 200, 500));

    act(() => {
      const mockEvent = { preventDefault: jest.fn() } as unknown as React.MouseEvent;
      result.current.startResizing(mockEvent);
    });

    // Fire 3 rapid mouse movements
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 320 }));
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 340 }));
    });

    // Only 1 rAF should be scheduled for the burst
    expect(rafCallCount).toBe(1);
    expect(document.documentElement.style.getPropertyValue('--nd-sidebar-width')).toBe('256px');

    // Execute the animation frame callback
    act(() => {
      if (rafCallback) {
        rafCallback(performance.now());
      }
    });

    // CSS var should now reflect the latest width (340px)
    expect(document.documentElement.style.getPropertyValue('--nd-sidebar-width')).toBe('340px');

    // Clean up drag
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
  });

  it('supports resizing via pointer events if window.PointerEvent is supported and ignores mouse events', () => {
    const originalPointerEvent = (window as unknown as { PointerEvent?: unknown }).PointerEvent;
    (window as unknown as { PointerEvent: unknown }).PointerEvent = MouseEvent;

    try {
      const { result } = renderHookWithStore(store, () => useSidebarResize(256, 200, 500));

      act(() => {
        result.current.startResizing();
      });

      expect(result.current.isResizing).toBe(true);

      // In pointer mode, mousemove should NOT trigger resize
      act(() => {
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 450 }));
      });
      // Sidebar width should not change via mousemove
      expect(result.current.sidebarWidth).toBe(256);

      // Pointermove should trigger resize
      act(() => {
        window.dispatchEvent(new MouseEvent('pointermove', { clientX: 380 }));
      });

      // Pointerup should complete resize
      act(() => {
        window.dispatchEvent(new MouseEvent('pointerup'));
      });

      expect(result.current.isResizing).toBe(false);
      expect(result.current.sidebarWidth).toBe(380);
      expect(document.documentElement.style.getPropertyValue('--nd-sidebar-width')).toBe('380px');
    } finally {
      if (originalPointerEvent === undefined) {
        delete (window as unknown as { PointerEvent?: unknown }).PointerEvent;
      } else {
        (window as unknown as { PointerEvent: unknown }).PointerEvent = originalPointerEvent;
      }
    }
  });

  it('allows startResizing to be called without arguments', () => {
    const { result } = renderHookWithStore(store, () => useSidebarResize());

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

    const { result } = renderHookWithStore(store, () => useSidebarResize(256, 200, 500));

    act(() => {
      const mockEvent = { preventDefault: jest.fn() } as unknown as React.MouseEvent;
      result.current.startResizing(mockEvent);
    });

    expect(() => {
      act(() => {
        window.dispatchEvent(new MouseEvent('mouseup'));
      });
    }).not.toThrow();

    expect(result.current.isResizing).toBe(false);
  });
});
