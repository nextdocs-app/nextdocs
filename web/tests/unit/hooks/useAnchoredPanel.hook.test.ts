import { act, renderHook } from '@testing-library/react';
import { useAnchoredPanel } from '../../../hooks/useAnchoredPanel.hook';

function attachTrigger(rect: { bottom: number; left: number; right: number; top: number }) {
  const button = document.createElement('button');
  document.body.appendChild(button);
  button.getBoundingClientRect = () =>
    ({ ...rect, width: 100, height: 30, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect;
  return button;
}

describe('useAnchoredPanel', () => {
  it('recomputes coords on scroll and resize while open', () => {
    const { result } = renderHook(() => useAnchoredPanel({ width: 200 }));

    const button = attachTrigger({ bottom: 100, left: 50, right: 150, top: 70 });

    try {
      act(() => {
        result.current.triggerRef.current = button;
      });

      act(() => {
        result.current.open();
      });

      expect(result.current.panelStyle.top).toBe(106);

      // The trigger moved (an overflow ancestor scrolled under the panel).
      button.getBoundingClientRect = () =>
        ({ bottom: 300, left: 50, right: 150, top: 270, width: 100, height: 30 }) as DOMRect;

      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });

      expect(result.current.panelStyle.top).toBe(306);

      button.getBoundingClientRect = () =>
        ({ bottom: 120, left: 400, right: 500, top: 90, width: 100, height: 30 }) as DOMRect;

      act(() => {
        window.dispatchEvent(new Event('resize'));
      });

      expect(result.current.panelStyle).toMatchObject({ top: 126, left: 400 });
    } finally {
      button.remove();
    }
  });

  it('closes when the trigger is gone on reposition', () => {
    const { result } = renderHook(() => useAnchoredPanel({ width: 200 }));

    const button = attachTrigger({ bottom: 100, left: 50, right: 150, top: 70 });

    try {
      act(() => {
        result.current.triggerRef.current = button;
      });

      act(() => {
        result.current.open();
      });

      expect(result.current.isOpen).toBe(true);

      act(() => {
        result.current.triggerRef.current = null;
        window.dispatchEvent(new Event('scroll'));
      });

      expect(result.current.isOpen).toBe(false);
    } finally {
      button.remove();
    }
  });

  it('ignores scrolls from inside the panel but still tracks ancestor scrolls', () => {
    const { result } = renderHook(() => useAnchoredPanel({ width: 200 }));

    const button = attachTrigger({ bottom: 100, left: 50, right: 150, top: 70 });
    const panel = document.createElement('div');
    const scroller = document.createElement('div');
    panel.appendChild(scroller);
    document.body.appendChild(panel);

    try {
      act(() => {
        result.current.triggerRef.current = button;
        result.current.panelRef.current = panel;
      });

      act(() => {
        result.current.open();
      });

      expect(result.current.panelStyle.top).toBe(106);

      // The icon grid scrolling under a fixed panel moves no trigger: coords
      // must stay identical so the panel does not re-render mid-scroll.
      act(() => {
        scroller.dispatchEvent(new Event('scroll'));
      });

      expect(result.current.panelStyle.top).toBe(106);

      // An overflow ancestor scrolling still moves the trigger and repositions.
      button.getBoundingClientRect = () =>
        ({ bottom: 300, left: 50, right: 150, top: 270, width: 100, height: 30 }) as DOMRect;

      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });

      expect(result.current.panelStyle.top).toBe(306);
    } finally {
      button.remove();
      panel.remove();
    }
  });
});
