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

it('uses a neutral placeholder tile when the workspace has no icon', () => {
  render(<WorkspaceLockup name="Acme" />);

  expect(screen.getByTestId('workspace-placeholder')).toBeInTheDocument();
});

it('renders a colored builtin icon with a matching tinted background', () => {
  const { container } = render(
    <WorkspaceLockup
      name="Acme"
      workspaceIcon={{ type: 'builtin', value: 'rocket', color: 'red' }}
    />
  );

  const tile = container.querySelector('span[style*="color-mix"]');
  expect(tile).toBeInTheDocument();
  expect(tile).toHaveStyle({
    backgroundColor: 'color-mix(in srgb, var(--nd-icon-color-red) 18%, transparent)',
    color: 'var(--nd-icon-color-red)',
  });
});

it('renders a default builtin icon with placeholder background', () => {
  const { container } = render(
    <WorkspaceLockup name="Acme" workspaceIcon={{ type: 'builtin', value: 'rocket' }} />
  );

  const tile = container.querySelector('.bg-\\[var\\(--nd-placeholder-bg\\)\\]');
  expect(tile).toBeInTheDocument();
});

it('renders an emoji workspace icon with placeholder background', () => {
  const { container } = render(
    <WorkspaceLockup name="Acme" workspaceIcon={{ type: 'emoji', value: '🚀' }} />
  );

  const tile = container.querySelector('.bg-\\[var\\(--nd-placeholder-bg\\)\\]');
  expect(tile).toBeInTheDocument();
  expect(screen.getByText('🚀')).toBeInTheDocument();
});
