import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { AppShell, getDocsEligibleForAccountMove } from '../../../components/AppShell';
import { documentService } from '../../../services/document.service';
import { useAuth } from '../../../hooks/useAuth.hook';
import { useAppDispatch } from '../../../stores/hooks';
import type { StoredDocument } from '../../../types/document.types';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../stores/hooks', () => ({
  useAppDispatch: jest.fn(),
}));

jest.mock('../../../components/Sidebar', () => ({
  __esModule: true,
  default: () => <aside data-testid="sidebar" />,
}));

jest.mock('../../../components/AuthModal', () => ({
  AuthModal: () => <div data-testid="auth-modal" />,
}));

jest.mock('../../../components/LocalDocsPromotionModal', () => ({
  LocalDocsPromotionModal: ({ onDiscardLocalData }: { onDiscardLocalData: () => void }) => (
    <button type="button" onClick={onDiscardLocalData}>
      Discard local data
    </button>
  ),
}));

jest.mock('../../../components/RegistrationSyncOverlay', () => ({
  RegistrationSyncOverlay: () => <div data-testid="registration-sync-overlay" />,
}));

function createStoredDocument(id: string, title: string, hasContent: boolean): StoredDocument {
  const ydoc = new Y.Doc();

  if (hasContent) {
    const fragment = ydoc.getXmlFragment('blocknote');
    fragment.push([new Y.XmlElement('paragraph')]);
  }

  const yjsState = Y.encodeStateAsUpdate(ydoc);

  return {
    id,
    meta: {
      title,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    },
    yjsState,
    version: 1,
  };
}

describe('getDocsEligibleForAccountMove', () => {
  it('filters out empty untitled placeholders', () => {
    const docs = [
      createStoredDocument('empty-untitled', 'Untitled', false),
      createStoredDocument('untitled-with-content', 'Untitled', true),
      createStoredDocument('named-empty', 'Project notes', false),
    ];

    const eligible = getDocsEligibleForAccountMove(docs);

    expect(eligible.map((doc) => doc.id)).toEqual(['untitled-with-content', 'named-empty']);
  });

  it('treats blank titles as untitled for filtering', () => {
    const docs = [
      createStoredDocument('blank-title-empty', '   ', false),
      createStoredDocument('blank-title-content', '   ', true),
    ];

    const eligible = getDocsEligibleForAccountMove(docs);

    expect(eligible.map((doc) => doc.id)).toEqual(['blank-title-content']);
  });
});

describe('AppShell local guest document promotion', () => {
  const mockDispatch = jest.fn();
  let getAllGuestDocumentsSpy: jest.SpyInstance;
  let deleteGuestDocumentsByIdsSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();

    jest.mocked(useAppDispatch).mockReturnValue(mockDispatch);
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      isTokenExpiringSoon: false,
      isAuthenticated: true,
      accessToken: 'token-1',
      lastAuthAction: 'login',
    });

    getAllGuestDocumentsSpy = jest.spyOn(documentService, 'getAllGuestDocuments');
    deleteGuestDocumentsByIdsSpy = jest
      .spyOn(documentService, 'deleteGuestDocumentsByIds')
      .mockResolvedValue(undefined);
    jest.spyOn(documentService, 'bulkImportLocalDocuments').mockResolvedValue({ imported: [] });
  });

  afterEach(() => {
    window.localStorage.clear();
    getAllGuestDocumentsSpy.mockRestore();
    deleteGuestDocumentsByIdsSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('cleans up empty untitled guest documents without deleting promotable drafts', async () => {
    getAllGuestDocumentsSpy.mockResolvedValue([
      createStoredDocument('empty-untitled', 'Untitled', false),
      createStoredDocument('named-empty', 'Project notes', false),
    ]);

    render(
      <AppShell>
        <div>Editor</div>
      </AppShell>
    );

    await waitFor(() => {
      expect(deleteGuestDocumentsByIdsSpy).toHaveBeenCalledWith(['empty-untitled']);
    });

    expect(deleteGuestDocumentsByIdsSpy).not.toHaveBeenCalledWith(['named-empty']);
  });

  it('discards promotable local drafts through the guest-document delete path', async () => {
    getAllGuestDocumentsSpy.mockResolvedValue([
      createStoredDocument('named-empty', 'Project notes', false),
    ]);

    render(
      <AppShell>
        <div>Editor</div>
      </AppShell>
    );

    const discardButton = await screen.findByRole('button', { name: 'Discard local data' });

    fireEvent.click(discardButton);

    await waitFor(() => {
      expect(deleteGuestDocumentsByIdsSpy).toHaveBeenCalledWith(['named-empty']);
    });
  });
});
