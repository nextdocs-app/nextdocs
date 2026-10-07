import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import sharedTreeReducer, { resetTree } from '@/stores/sharedTree/sharedTree.slice';
import authReducer from '@/stores/auth/auth.slice';
import { useSharedTreeRootSync } from '@/hooks/useSharedTreeRootSync.hook';
import type { SharedDocumentEntry } from '@/stores/documentList/documentList.types';
import { useAuth } from '../../../hooks/useAuth.hook';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));

const sharedDocument = (id: string): SharedDocumentEntry => ({
  id,
  relationship: 'collaborator',
  parentId: null,
  accessLevel: 'EDIT',
  meta: { title: id, updatedAt: '2024-01-01T10:00:00Z', createdAt: '2024-01-01T10:00:00Z' },
});

describe('useSharedTreeRootSync', () => {
  function createStore() {
    return configureStore({
      reducer: {
        sharedTree: sharedTreeReducer,
        auth: authReducer,
      },
    });
  }

  function createWrapper(store: ReturnType<typeof createStore>) {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      return <Provider store={store}>{children}</Provider>;
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('re-syncs after logout and login with an unchanged document list', async () => {
    const store = createStore();
    const documents = [sharedDocument('doc-1')];
    let authState: { isAuthenticated: boolean } = { isAuthenticated: true };
    (useAuth as jest.Mock).mockImplementation(() => authState);

    const { rerender } = renderHook(() => useSharedTreeRootSync(documents), {
      wrapper: createWrapper(store),
    });

    await waitFor(() => {
      expect(store.getState().sharedTree.rootIds).toEqual(['doc-1']);
    });

    // Logout resets the tree (useGuestSharedTree does this in the app).
    authState = { isAuthenticated: false };
    rerender();
    store.dispatch(resetTree());
    expect(store.getState().sharedTree.rootIds).toEqual([]);

    // Login again with the same document list: the stale signature must not
    // skip the rebuild.
    authState = { isAuthenticated: true };
    rerender();

    await waitFor(() => {
      expect(store.getState().sharedTree.rootIds).toEqual(['doc-1']);
    });
    expect(store.getState().sharedTree.nodes['doc-1']).toBeDefined();
  });

  it('skips syncing while signed out', () => {
    const store = createStore();
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: false });

    renderHook(() => useSharedTreeRootSync([sharedDocument('doc-1')]), {
      wrapper: createWrapper(store),
    });

    expect(store.getState().sharedTree.rootIds).toEqual([]);
    expect(store.getState().sharedTree.nodes).toEqual({});
  });

  it('re-syncs when only the access level changes at a constant updatedAt', async () => {
    const store = createStore();
    (useAuth as jest.Mock).mockReturnValue({ isAuthenticated: true });

    const documents = [sharedDocument('doc-1')];
    const { rerender } = renderHook(
      ({ docs }: { docs: SharedDocumentEntry[] }) => useSharedTreeRootSync(docs),
      {
        wrapper: createWrapper(store),
        initialProps: { docs: documents },
      }
    );

    await waitFor(() => {
      expect(store.getState().sharedTree.nodes['doc-1']).toMatchObject({
        effectiveAccessLevel: 'EDIT',
      });
    });

    const downgraded = [{ ...sharedDocument('doc-1'), accessLevel: 'VIEW' as const }];
    rerender({ docs: downgraded });

    await waitFor(() => {
      expect(store.getState().sharedTree.nodes['doc-1']).toMatchObject({
        effectiveAccessLevel: 'VIEW',
      });
    });
  });
});
