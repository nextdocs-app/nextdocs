import {
  createViewportBounds,
  DOC_TOOLBAR_INSET_CSS_VAR,
  FLOATING_VIEWPORT_MARGIN_PX,
} from '../../../lib/viewport-bounds.util';

describe('createViewportBounds', () => {
  it('keeps floating UI off the toolbar and inside the viewport', () => {
    expect(createViewportBounds(52)).toEqual({ top: 52, right: 12, bottom: 12, left: 12 });
  });

  it('moves the whole boundary with the toolbar', () => {
    expect(createViewportBounds(88).top).toBe(88);
    expect(createViewportBounds(44)).toEqual({
      top: 44,
      right: FLOATING_VIEWPORT_MARGIN_PX,
      bottom: FLOATING_VIEWPORT_MARGIN_PX,
      left: FLOATING_VIEWPORT_MARGIN_PX,
    });
  });

  it('names the custom property the inset hook publishes for CSS popups', () => {
    expect(DOC_TOOLBAR_INSET_CSS_VAR).toBe('--nd-doc-toolbar-inset');
  });
});
