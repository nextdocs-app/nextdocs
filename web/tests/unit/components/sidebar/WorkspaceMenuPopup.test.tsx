import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { WorkspaceMenuPopup } from '../../../../components/sidebar/WorkspaceMenuPopup';

describe('WorkspaceMenuPopup', () => {
  const defaultProps = {
    theme: 'light' as const,
    canManageMembers: true,
    onOpenWorkspaceSettings: jest.fn(),
    onOpenPeople: jest.fn(),
    onOpenTrash: jest.fn(),
    style: { left: '0.5rem', top: '3rem' },
    popupRef: createRef<HTMLDivElement>(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders "Manage people", "Workspace settings", and "Trash" when the member can manage people', () => {
    render(<WorkspaceMenuPopup {...defaultProps} canManageMembers={true} />);

    expect(screen.getByRole('menu', { name: 'Workspace options' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Workspace settings' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Manage people' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Trash' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'People' })).not.toBeInTheDocument();
  });

  it('renders "People" without prefix when user cannot manage members', () => {
    render(<WorkspaceMenuPopup {...defaultProps} canManageMembers={false} />);

    expect(screen.getByRole('menuitem', { name: 'Workspace settings' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'People' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Manage people' })).not.toBeInTheDocument();
  });

  it('calls onOpenWorkspaceSettings when Workspace settings is clicked', async () => {
    const user = userEvent.setup();
    render(<WorkspaceMenuPopup {...defaultProps} />);

    await user.click(screen.getByRole('menuitem', { name: 'Workspace settings' }));
    expect(defaultProps.onOpenWorkspaceSettings).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenPeople when People / Manage people is clicked', async () => {
    const user = userEvent.setup();
    render(<WorkspaceMenuPopup {...defaultProps} canManageMembers={true} />);

    await user.click(screen.getByRole('menuitem', { name: 'Manage people' }));
    expect(defaultProps.onOpenPeople).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenTrash when Trash is clicked', async () => {
    const user = userEvent.setup();
    render(<WorkspaceMenuPopup {...defaultProps} />);

    await user.click(screen.getByRole('menuitem', { name: 'Trash' }));
    expect(defaultProps.onOpenTrash).toHaveBeenCalledTimes(1);
  });
});
