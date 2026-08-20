import { render, screen, fireEvent } from '@testing-library/react';
import { DocToolbar } from '../../../components/DocToolbar';

jest.mock('../../../components/SharePanel', () => ({
  SharePanel: () => <div data-testid="share-panel" />,
}));

describe('DocToolbar trash notice', () => {
  it('shows the restore action for users who can manage the trashed document', () => {
    const onRestore = jest.fn();

    render(
      <DocToolbar
        documentId="doc-1"
        isShareEnabled={false}
        isOffline={false}
        showTrashNotice
        canManageTrash
        onRestore={onRestore}
      />
    );

    expect(screen.getByText(/This document is in the trash\./)).toBeInTheDocument();
    const restoreButton = screen.getByRole('button', { name: 'Restore' });
    expect(restoreButton).toBeInTheDocument();

    fireEvent.click(restoreButton);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('shows the read-only notice without a restore action for viewers and commenters', () => {
    render(
      <DocToolbar
        documentId="doc-1"
        isShareEnabled={false}
        isOffline={false}
        showTrashNotice
        canManageTrash={false}
        onRestore={jest.fn()}
      />
    );

    expect(
      screen.getByText(/read-only access and can view it, but only people with edit access/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('shows the trash notice without a restore action when canManageTrash is true but onRestore is undefined', () => {
    render(
      <DocToolbar
        documentId="doc-1"
        isShareEnabled={false}
        isOffline={false}
        showTrashNotice
        canManageTrash
      />
    );

    expect(screen.getByText(/This document is in the trash\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('shows no trash notice when the document is not trashed', () => {
    render(<DocToolbar documentId="doc-1" isShareEnabled={false} isOffline={false} />);

    expect(screen.queryByText(/This document is in the/)).not.toBeInTheDocument();
  });
});
