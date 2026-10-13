import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageCover } from '../../../components/page/PageCover';
import type { DocumentCover } from '../../../types/document.types';

jest.mock('../../../stores/hooks', () => ({
  useAppSelector: () => null,
  useAppDispatch: () => jest.fn(),
}));

jest.mock('../../../hooks/useMediaQuery.hook', () => ({
  ...jest.requireActual('../../../hooks/useMediaQuery.hook'),
  useIsTouchInput: () => false,
}));

const cover: DocumentCover = {
  type: 'link',
  value: 'https://cdn.example/cover.jpg',
  position: 0.5,
};

function renderCover() {
  const handlers = {
    onRequestChange: jest.fn(),
    onRemove: jest.fn(),
    onPositionChange: jest.fn(),
  };
  render(
    <PageCover
      cover={cover}
      canEdit
      onRequestChange={handlers.onRequestChange}
      onRemove={handlers.onRemove}
      onPositionChange={handlers.onPositionChange}
    />
  );
  return handlers;
}

async function enterRepositionMode() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Reposition' }));
  return screen.getByRole('application');
}

describe('PageCover keyboard repositioning', () => {
  it('keeps arrow-key steps local and commits once on Enter', async () => {
    const { onPositionChange } = renderCover();
    const frame = await enterRepositionMode();

    fireEvent.keyDown(frame, { key: 'ArrowDown' });
    fireEvent.keyDown(frame, { key: 'ArrowDown' });
    fireEvent.keyDown(frame, { key: 'ArrowDown' });

    // A held key must not fan out a PATCH per repeat.
    expect(onPositionChange).not.toHaveBeenCalled();

    fireEvent.keyDown(frame, { key: 'Enter' });

    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onPositionChange.mock.calls[0][0]).toBeCloseTo(0.44, 5);
  });

  it('discards pending steps on Escape', async () => {
    const { onPositionChange } = renderCover();
    const frame = await enterRepositionMode();

    fireEvent.keyDown(frame, { key: 'ArrowUp' });
    fireEvent.keyDown(frame, { key: 'Escape' });

    expect(onPositionChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('application')).toBeNull();
  });
});

describe('PageCover drag repositioning', () => {
  // jsdom has no PointerEvent, so testing-library's pointer-event helper
  // drops clientX/clientY. Dispatch MouseEvents with a pointer-event type
  // instead: React listens for the type string and reads the coordinates.
  function dispatchPointer(
    target: Element,
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    clientY: number
  ) {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientY }));
  }

  it('tracks the pointer and commits once on release', async () => {
    const { onPositionChange } = renderCover();
    const frame = await enterRepositionMode();

    frame.getBoundingClientRect = () =>
      ({ height: 200, width: 800, top: 0, left: 0, right: 800, bottom: 200 }) as DOMRect;

    dispatchPointer(frame, 'pointerdown', 100);
    dispatchPointer(frame, 'pointermove', 120);

    // Pointermove coalesces into one state update per animation frame; poll
    // for the staged position rather than assuming a single frame flushes it.
    await waitFor(() => {
      expect((frame.querySelector('img') as HTMLElement | null)?.style?.objectPosition).toBe(
        'center 40.00%'
      );
    });

    dispatchPointer(frame, 'pointerup', 120);

    // Dragging down 20px of a 200px banner reveals more of the top: 0.5 - 0.1.
    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onPositionChange).toHaveBeenCalledWith(0.4);
  });

  it('does not commit when the pointer never moves', async () => {
    const { onPositionChange } = renderCover();
    const frame = await enterRepositionMode();

    dispatchPointer(frame, 'pointerdown', 100);
    dispatchPointer(frame, 'pointerup', 100);

    expect(onPositionChange).not.toHaveBeenCalled();
  });

  it('commits the latest position when released before the next frame', async () => {
    const { onPositionChange } = renderCover();
    const frame = await enterRepositionMode();

    frame.getBoundingClientRect = () =>
      ({ height: 200, width: 800, top: 0, left: 0, right: 800, bottom: 200 }) as DOMRect;

    // No frame flush between move and release: the staged (not yet rendered)
    // position must win over the last flushed one.
    dispatchPointer(frame, 'pointerdown', 100);
    dispatchPointer(frame, 'pointermove', 120);
    dispatchPointer(frame, 'pointerup', 120);

    expect(onPositionChange).toHaveBeenCalledTimes(1);
    expect(onPositionChange).toHaveBeenCalledWith(0.4);
  });
});
