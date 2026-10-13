import { act, render, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { useLoadMoreOnScroll } from '../../../hooks/useLoadMoreOnScroll.hook';

type ObserverInstance = { observe: jest.Mock; unobserve: jest.Mock; disconnect: jest.Mock };

/** Records every observer the hook builds so tests can drive the sentinel. */
function installObserverMock() {
  const instances: (ObserverInstance & { callback: IntersectionObserverCallback })[] = [];
  const OriginalIO = window.IntersectionObserver;
  window.IntersectionObserver = jest.fn().mockImplementation((callback) => {
    const instance = {
      callback,
      observe: jest.fn(),
      unobserve: jest.fn(),
      disconnect: jest.fn(),
    };
    instances.push(instance);
    return instance;
  }) as unknown as typeof IntersectionObserver;
  return {
    instances,
    intersect: (index = instances.length - 1) =>
      act(() => {
        instances[index]?.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          null as never
        );
      }),
    restore: () => {
      window.IntersectionObserver = OriginalIO;
    },
  };
}

function setup({ enabled = true, revision = 0 } = {}) {
  const onReachEnd = jest.fn();
  const rootRef = { current: document.createElement('div') };
  const utils = renderHook(
    ({ currentRevision, currentEnabled }) =>
      useLoadMoreOnScroll({
        rootRef,
        enabled: currentEnabled,
        revision: currentRevision,
        onReachEnd,
      }),
    { initialProps: { currentRevision: revision, currentEnabled: enabled } }
  );
  return { ...utils, onReachEnd };
}

describe('useLoadMoreOnScroll', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('observes the sentinel once it mounts', () => {
    const observer = installObserverMock();
    try {
      const { result } = setup();
      expect(observer.instances).toHaveLength(0);

      const node = document.createElement('div');
      act(() => result.current.sentinelRef(node));

      expect(observer.instances[0].observe).toHaveBeenCalledWith(node);
    } finally {
      observer.restore();
    }
  });

  it('adopts a sentinel that is rendered later, once the data it waits on lands', () => {
    // The bug this hook exists for: the grid renders its sentinel only after
    // the catalog *and* the glyph bundle have landed, so an effect that ran on
    // mount had no node to observe and no reason to run again.
    const observer = installObserverMock();
    const rootRef = { current: document.createElement('div') };

    function Grid({ gridReady }: { gridReady: boolean }) {
      const { sentinelRef } = useLoadMoreOnScroll({
        rootRef,
        enabled: true,
        revision: 0,
        onReachEnd: jest.fn(),
      });
      return gridReady ? <div ref={sentinelRef} data-testid="sentinel" /> : null;
    }

    function Harness() {
      const [gridReady, setGridReady] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setGridReady(true)}>
            ready
          </button>
          <Grid gridReady={gridReady} />
        </>
      );
    }

    try {
      const { getByRole, getByTestId } = render(<Harness />);
      expect(observer.instances).toHaveLength(0);

      act(() => getByRole('button').click());

      expect(observer.instances).toHaveLength(1);
      expect(observer.instances[0].observe).toHaveBeenCalledWith(getByTestId('sentinel'));
    } finally {
      observer.restore();
    }
  });

  it('reveals on each crossing', () => {
    const observer = installObserverMock();
    try {
      const { result, onReachEnd } = setup();
      act(() => result.current.sentinelRef(document.createElement('div')));

      observer.intersect();
      expect(onReachEnd).toHaveBeenCalledTimes(1);
    } finally {
      observer.restore();
    }
  });

  it('re-arms after each reveal so a page still in view keeps filling', () => {
    // IntersectionObserver only reports crossings: without a rebuild, the
    // second page waited for a scroll away and back.
    const observer = installObserverMock();
    try {
      const { result, rerender } = setup();
      act(() => result.current.sentinelRef(document.createElement('div')));
      const first = observer.instances[0];

      rerender({ currentRevision: 1, currentEnabled: true });

      expect(first.disconnect).toHaveBeenCalled();
      expect(observer.instances).toHaveLength(2);

      observer.intersect(1);
      expect(observer.instances[1].observe).toHaveBeenCalledTimes(1);
    } finally {
      observer.restore();
    }
  });

  it('drops the observer when the sentinel unmounts', () => {
    const observer = installObserverMock();
    try {
      const { result } = setup();
      act(() => result.current.sentinelRef(document.createElement('div')));
      const instance = observer.instances[0];

      act(() => result.current.sentinelRef(null));

      expect(instance.disconnect).toHaveBeenCalled();
    } finally {
      observer.restore();
    }
  });

  it('ignores the sentinel while disabled', () => {
    const observer = installObserverMock();
    try {
      const { result } = setup({ enabled: false });
      act(() => result.current.sentinelRef(document.createElement('div')));

      expect(observer.instances).toHaveLength(0);
    } finally {
      observer.restore();
    }
  });

  it('reports no support when the environment has no observer', () => {
    const OriginalIO = window.IntersectionObserver;
    // `delete` rather than `undefined`: an own-property set to undefined still
    // reads as present to an `in` check.
    delete (window as unknown as Record<string, unknown>).IntersectionObserver;

    try {
      const { result } = setup();
      act(() => result.current.sentinelRef(document.createElement('div')));

      expect(result.current.isSupported).toBe(false);
    } finally {
      window.IntersectionObserver = OriginalIO;
    }
  });
});
