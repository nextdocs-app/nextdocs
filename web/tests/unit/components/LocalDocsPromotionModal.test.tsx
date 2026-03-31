import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocalDocsPromotionModal } from '../../../components/LocalDocsPromotionModal';

describe('LocalDocsPromotionModal', () => {
  it('renders document count and action buttons', () => {
    render(
      <LocalDocsPromotionModal
        count={3}
        isImporting={false}
        error={null}
        onMoveToAccount={jest.fn()}
        onDiscardLocalData={jest.fn()}
      />
    );

    expect(screen.getByText(/We found 3 local documents/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to account' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard local data' })).toBeInTheDocument();
  });

  it('calls handlers for move/discard actions', async () => {
    const user = userEvent.setup();
    const onMoveToAccount = jest.fn();
    const onDiscardLocalData = jest.fn();

    render(
      <LocalDocsPromotionModal
        count={1}
        isImporting={false}
        error={null}
        onMoveToAccount={onMoveToAccount}
        onDiscardLocalData={onDiscardLocalData}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Move to account' }));
    await user.click(screen.getByRole('button', { name: 'Discard local data' }));

    expect(onMoveToAccount).toHaveBeenCalled();
    expect(onDiscardLocalData).toHaveBeenCalled();
  });

  it('shows importing state and disables actions', () => {
    render(
      <LocalDocsPromotionModal
        count={2}
        isImporting={true}
        error={null}
        onMoveToAccount={jest.fn()}
        onDiscardLocalData={jest.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Moving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Discard local data' })).toBeDisabled();
  });

  it('shows backend error message', () => {
    render(
      <LocalDocsPromotionModal
        count={2}
        isImporting={false}
        error={'Import failed'}
        onMoveToAccount={jest.fn()}
        onDiscardLocalData={jest.fn()}
      />
    );

    expect(screen.getByText('Import failed')).toBeInTheDocument();
  });
});
