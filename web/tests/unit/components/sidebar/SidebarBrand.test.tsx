import { render, screen } from '@testing-library/react';
import { SidebarBrand } from '../../../../components/sidebar/SidebarBrand';

it('renders the provided workspace name', () => {
  render(<SidebarBrand name="Acme Docs" />);

  expect(screen.getByText('Acme Docs')).toBeInTheDocument();
});

it('exposes the full name as a title when the lockup truncates', () => {
  render(<SidebarBrand name="A very long workspace name that will not fit" />);

  expect(screen.getByTitle('A very long workspace name that will not fit')).toBeInTheDocument();
});

it('uses a custom icon in place of the default mark', () => {
  render(<SidebarBrand name="Acme" icon={<span data-testid="workspace-icon" />} />);

  expect(screen.getByTestId('workspace-icon')).toBeInTheDocument();
});
