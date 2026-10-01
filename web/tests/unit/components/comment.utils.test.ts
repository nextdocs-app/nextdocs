import type { Middleware } from '@floating-ui/react';
import { createCommentThreadFloatingOptions } from '../../../components/editor/comment.utils';

type MiddlewareOptions = {
  padding?: { top?: number; right?: number; bottom?: number; left?: number };
  apply?: (args: SizeApplyArgs) => void;
};

type SizeApplyArgs = {
  availableHeight: number;
  elements: { floating: HTMLElement };
};

/**
 * `@floating-ui/react` wraps each middleware so its options can themselves be a
 * function, which means the options it stores are the `[options, override]`
 * tuple the wrapper is built from.
 */
type WrappedMiddleware = Middleware & { options: [MiddlewareOptions, unknown] };

function middlewareOf(toolbarInset: number): WrappedMiddleware[] {
  const options = createCommentThreadFloatingOptions(toolbarInset);

  return options.useFloatingOptions?.middleware as WrappedMiddleware[];
}

function optionsOf(name: string, toolbarInset = 52): MiddlewareOptions {
  const entry = middlewareOf(toolbarInset).find((candidate) => candidate.name === name);

  if (!entry) {
    throw new Error(`No ${name} middleware`);
  }

  return entry.options[0];
}

describe('createCommentThreadFloatingOptions', () => {
  it('replaces BlockNote’s placement rules with ones bounded by the toolbar', () => {
    expect(middlewareOf(52).map((entry) => entry.name)).toEqual([
      'offset',
      'flip',
      'shift',
      'size',
    ]);
  });

  it('keeps the thread off the toolbar and inside the viewport', () => {
    for (const name of ['flip', 'shift', 'size']) {
      expect(optionsOf(name).padding).toEqual({ top: 52, right: 12, bottom: 12, left: 12 });
    }
  });

  it('moves the whole boundary with the toolbar', () => {
    expect(optionsOf('flip', 88).padding?.top).toBe(88);
  });

  it('caps the card to the room left on the side it is placed on', () => {
    const popup = document.createElement('div');

    optionsOf('size').apply?.({ availableHeight: 320, elements: { floating: popup } });

    expect(popup.style.maxHeight).toBe('320px');
  });

  it('marks the popup for the scroll rules and keeps BlockNote’s stacking', () => {
    const options = createCommentThreadFloatingOptions(44);

    expect(options.elementProps?.className).toBe('nd-comment-thread');
    expect(options.elementProps?.style).toMatchObject({ zIndex: 30, flexDirection: 'column' });
  });
});
