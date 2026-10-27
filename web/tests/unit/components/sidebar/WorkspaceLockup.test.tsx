import { render, screen } from '@testing-library/react';
import { WorkspaceLockup } from '../../../../components/sidebar/WorkspaceLockup';

it('renders the provided workspace name', () => {
  render(<WorkspaceLockup name="Acme Docs" />);

  expect(screen.getByText('Acme Docs')).toBeInTheDocument();
});

it('exposes the full name as a title when the lockup truncates', () => {
  render(<WorkspaceLockup name="A very long workspace name that will not fit" />);

  expect(screen.getByTitle('A very long workspace name that will not fit')).toBeInTheDocument();
});

it('uses a custom icon in place of the default mark', () => {
  render(<WorkspaceLockup name="Acme" icon={<span data-testid="workspace-icon" />} />);

  expect(screen.getByTestId('workspace-icon')).toBeInTheDocument();
  expect(screen.queryByTestId('workspace-placeholder')).not.toBeInTheDocument();
});

it('uses a neutral placeholder tile when the workspace has no icon', () => {
  render(<WorkspaceLockup name="Acme" />);

  expect(screen.getByTestId('workspace-placeholder')).toBeInTheDocument();
});
