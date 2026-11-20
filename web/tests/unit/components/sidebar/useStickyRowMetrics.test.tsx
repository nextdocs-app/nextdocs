import { act, render, waitFor } from '@testing-library/react';
import { useStickyRowMetrics } from '../../../../components/sidebar/useStickyRowMetrics';

function SidebarHarness() {
  const scrollerRef = useStickyRowMetrics<HTMLDivElement>();
  return (
    <div ref={scrollerRef}>
      <div data-sidebar-space-row="" />
      <ul style={{ display: 'flex', flexDirection: 'column', rowGap: '1px' }}>
        <li style={{ display: 'flex', flexDirection: 'column', rowGap: '1px' }}>
          <div data-sidebar-row="" />
        </li>
      </ul>
    </div>
  );
}

/** Rows inside a list that declares no gap at all. */
function GaplessHarness() {
  const scrollerRef = useStickyRowMetrics<HTMLDivElement>();
  return (
    <div ref={scrollerRef}>
      <ul>
        <li>
          <div data-sidebar-row="" />
        </li>
      </ul>
    </div>
  );
}

/** The real rail renders a placeholder first; the scroller mounts one commit later. */
function DelayedHarness({ ready }: { ready: boolean }) {
  const scrollerRef = useStickyRowMetrics<HTMLDivElement>();

  return ready ? (
    <div ref={scrollerRef}>
      <div data-sidebar-space-row="" />
      <ul style={{ display: 'flex', flexDirection: 'column', rowGap: '1px' }}>
        <li style={{ display: 'flex', flexDirection: 'column', rowGap: '1px' }}>
          <div data-sidebar-row="" />
        </li>
      </ul>
    </div>
  ) : (
    <aside />
  );
}

let spaceRowHeight = 33;
let docRowHeight = 41;

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  readonly observe = jest.fn();
  readonly unobserve = jest.fn();
  readonly disconnect = jest.fn();
  constructor(private readonly callback: ResizeObserverCallback) {
    MockResizeObserver.instances.push(this);
  }
  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

let frames: FrameRequestCallback[] = [];

async function flushFrames() {
  const queued = frames;
  frames = [];
  await act(async () => {
    queued.forEach((callback) => callback(0));
    // MutationObserver delivers on a microtask, and the frame it schedules
    // lands on the next one.
    await Promise.resolve();
  });
  const followUp = frames;
  frames = [];
  if (followUp.length > 0) {
    await act(async () => {
      followUp.forEach((callback) => callback(0));
      await Promise.resolve();
    });
  }
}

describe('useStickyRowMetrics', () => {
  beforeEach(() => {
    spaceRowHeight = 33;
    docRowHeight = 41;
    frames = [];
    MockResizeObserver.instances = [];
    // jsdom has no layout: report the row heights the CSS actually renders.
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const height = this.hasAttribute('data-sidebar-space-row')
        ? spaceRowHeight
        : this.hasAttribute('data-sidebar-row')
          ? docRowHeight
          : 0;
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: height, width: 0, height } as DOMRect;
    });
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => frames.push(callback));
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockResizeObserver;
  });

  afterEach(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    jest.restoreAllMocks();
  });

  it('publishes the rendered row height and pitch on the scroll container', () => {
    const { container } = render(<SidebarHarness />);
    const scroller = container.firstElementChild as HTMLElement;

    // The space row keeps the fine-pointer height; document rows are taller on
    // touch devices and sit one 1px flex gap apart.
    expect(scroller.style.getPropertyValue('--nd-sticky-row-height')).toBe('33px');
    expect(scroller.style.getPropertyValue('--nd-sticky-row-pitch')).toBe('42px');
  });

  it('measures a scroll container that mounts after the first commit', async () => {
    const { container, rerender } = render(<DelayedHarness ready={false} />);
    rerender(<DelayedHarness ready />);

    await waitFor(() => {
      const scroller = container.querySelector('div');
      expect(scroller?.style.getPropertyValue('--nd-sticky-row-pitch')).toBe('42px');
    });
  });

  it('publishes no variables while the rows have no rendered height', () => {
    spaceRowHeight = 0;
    docRowHeight = 0;

    const { container } = render(<SidebarHarness />);
    const scroller = container.firstElementChild as HTMLElement;

    expect(scroller.style.getPropertyValue('--nd-sticky-row-height')).toBe('');
    expect(scroller.style.getPropertyValue('--nd-sticky-row-pitch')).toBe('');
  });

  it('treats a list with no declared gap as having none', () => {
    const { container } = render(<GaplessHarness />);
    const scroller = container.firstElementChild as HTMLElement;

    expect(scroller.style.getPropertyValue('--nd-sticky-row-pitch')).toBe('41px');
  });

  it('publishes the first measurement without a MutationObserver', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver');
    Object.defineProperty(globalThis, 'MutationObserver', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      const { container } = render(<SidebarHarness />);
      const scroller = container.firstElementChild as HTMLElement;
      expect(scroller.style.getPropertyValue('--nd-sticky-row-pitch')).toBe('42px');
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'MutationObserver', original);
      }
    }
  });

  it('re-measures the tracked row when it changes size', async () => {
    const { container } = render(<SidebarHarness />);
    const scroller = container.firstElementChild as HTMLElement;
    const observer = MockResizeObserver.instances[0];

    docRowHeight = 48;
    observer.trigger();
    await flushFrames();
    expect(scroller.style.getPropertyValue('--nd-sticky-row-pitch')).toBe('49px');

    const setProperty = jest.spyOn(scroller.style, 'setProperty');
    observer.trigger();
    await flushFrames();
    // The same numbers do not touch the CSSOM again.
    expect(setProperty).not.toHaveBeenCalled();
  });

  it('observes the replacement when the tree re-renders the measured row', async () => {
    const { container } = render(<SidebarHarness />);
    const row = container.querySelector('[data-sidebar-row]') as HTMLElement;
    const observer = MockResizeObserver.instances[0];
    expect(observer.observe).toHaveBeenCalledWith(row);

    const replacement = document.createElement('div');
    replacement.setAttribute('data-sidebar-row', '');
    row.replaceWith(replacement);
    await flushFrames();

    expect(observer.unobserve).toHaveBeenCalledWith(row);
    expect(observer.observe).toHaveBeenCalledWith(replacement);
  });
});
