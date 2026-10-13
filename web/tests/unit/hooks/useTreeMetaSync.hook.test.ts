import { renderHook, act } from '@testing-library/react';
import { useTreeMetaSync } from '../../../hooks/useTreeMetaSync.hook';
import { dispatchDocumentMetaUpdated } from '../../../lib/document-meta-event.util';
import type { DocumentMeta } from '../../../types/document.types';

const baseMeta: DocumentMeta = {
  title: 'Doc',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('useTreeMetaSync', () => {
  it('leaves the icon absent on a title-only fan-out', () => {
    const dispatch = jest.fn();
    const updateNodeMeta = jest.fn(() => ({ type: 'trees/updateNodeMeta' }));

    renderHook(() => useTreeMetaSync(dispatch, updateNodeMeta));

    act(() => {
      dispatchDocumentMetaUpdated('doc-1', { ...baseMeta, title: 'Renamed' });
    });

    // `?? null` here would turn every title keystroke into an icon write, making
    // the slice re-normalize and JSON-compare the icon each time.
    expect(updateNodeMeta).toHaveBeenCalledWith({ id: 'doc-1', title: 'Renamed', icon: undefined });
    expect(dispatch).toHaveBeenCalledWith({ type: 'trees/updateNodeMeta' });
  });

  it('forwards the icon when the fan-out carries one', () => {
    const dispatch = jest.fn();
    const updateNodeMeta = jest.fn(() => ({ type: 'trees/updateNodeMeta' }));
    const icon = { type: 'builtin' as const, value: 'arrow-right', color: 'blue' as const };

    renderHook(() => useTreeMetaSync(dispatch, updateNodeMeta));

    act(() => {
      dispatchDocumentMetaUpdated('doc-1', { ...baseMeta, icon });
    });

    expect(updateNodeMeta).toHaveBeenCalledWith({ id: 'doc-1', title: 'Doc', icon });
  });

  it('stops listening once the tree unmounts', () => {
    const dispatch = jest.fn();
    const updateNodeMeta = jest.fn(() => ({ type: 'trees/updateNodeMeta' }));

    const { unmount } = renderHook(() => useTreeMetaSync(dispatch, updateNodeMeta));
    unmount();

    act(() => {
      dispatchDocumentMetaUpdated('doc-1', { ...baseMeta, title: 'Renamed' });
    });

    expect(updateNodeMeta).not.toHaveBeenCalled();
  });
});
