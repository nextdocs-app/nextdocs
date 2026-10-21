import { act, render } from '@testing-library/react';
import { AppShell } from '../../../components/AppShell';
import { useAuth } from '../../../hooks/useAuth.hook';
import { usePendingCloudDocumentCreates } from '../../../hooks/usePendingCloudDocumentCreates.hook';
import { PENDING_DOCUMENT_DISCARDED_EVENT } from '../../../lib/pending-cloud-create.util';
import { addToast } from '../../../stores/toasts/toasts.slice';

jest.mock('../../../components/sidebar', () => ({ __esModule: true, default: () => null }));
jest.mock('../../../components/AuthModal', () => ({ AuthModal: () => null }));
jest.mock('../../../components/ToastContainer', () => ({ ToastContainer: () => null }));
jest.mock('../../../hooks/useMediaQuery.hook', () => ({ useIsMobileLayout: () => false }));
jest.mock('../../../hooks/useAuth.hook', () => ({ useAuth: jest.fn() }));
jest.mock('../../../hooks/usePendingCloudDocumentCreates.hook', () => ({
  usePendingCloudDocumentCreates: jest.fn(),
}));
const mockDispatch = jest.fn();
jest.mock('../../../stores/hooks', () => ({
  useAppDispatch: () => mockDispatch,
  useAppSelector: () => false,
}));

function announceDiscard(announce: boolean) {
  act(() => {
    window.dispatchEvent(
      new CustomEvent(PENDING_DOCUMENT_DISCARDED_EVENT, { detail: { id: 'doc-1', announce } })
    );
  });
}

describe('AppShell', () => {
  it('wires the offline create replay to the signed-in session', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
    });

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    expect(usePendingCloudDocumentCreates).toHaveBeenCalledWith('user-1', 'token-1');
  });

  it('says why a page the user wrote disappeared', () => {
    (useAuth as jest.Mock).mockReturnValue({
      user: { id: 'user-1' },
      accessToken: 'token-1',
      isTokenExpiringSoon: false,
    });
    mockDispatch.mockClear();

    render(
      <AppShell>
        <div>content</div>
      </AppShell>
    );

    announceDiscard(false);
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: addToast.type }));

    announceDiscard(true);
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: addToast.type,
        payload: expect.objectContaining({ type: 'error' }),
      })
    );
  });
});
