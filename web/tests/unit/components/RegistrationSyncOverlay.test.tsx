import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegistrationSyncOverlay } from '../../../components/RegistrationSyncOverlay';

describe('RegistrationSyncOverlay', () => {
  it('renders loading state with spinner and document count badge', () => {
    render(<RegistrationSyncOverlay count={3} isLoading={true} error={null} onRetry={jest.fn()} />);

    expect(screen.getByText('Moving local documents to your account')).toBeInTheDocument();
    expect(
      screen.getByText('Please wait while we persist your local documents to the backend.')
    ).toBeInTheDocument();
    expect(screen.getByText('3 documents')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/i })).not.toBeInTheDocument();
  });

  it('renders loading state with singular document text', () => {
    render(<RegistrationSyncOverlay count={1} isLoading={true} error={null} onRetry={jest.fn()} />);

    expect(screen.getByText('1 document')).toBeInTheDocument();
  });

  it('renders error state and triggers retry', async () => {
    const user = userEvent.setup();
    const onRetry = jest.fn();

    render(
      <RegistrationSyncOverlay
        count={2}
        isLoading={false}
        error={'Network timeout'}
        onRetry={onRetry}
      />
    );

    expect(screen.getByText('Could not move documents to your account')).toBeInTheDocument();
    expect(screen.getByText('Network timeout')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
