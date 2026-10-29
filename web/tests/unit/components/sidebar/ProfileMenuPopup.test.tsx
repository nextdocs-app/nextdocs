import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { ProfileMenuPopup } from '../../../../components/sidebar/ProfileMenuPopup';

describe('ProfileMenuPopup', () => {
  const defaultProps = {
    theme: 'light' as const,
    isAuthenticated: true,
    onOpenProfile: jest.fn(),
    onOpenPreferences: jest.fn(),
    onOpenSettings: jest.fn(),
    onLogout: jest.fn(),
    onSignIn: jest.fn(),
    style: { left: '0.5rem', bottom: '3.5rem' },
    popupRef: createRef<HTMLDivElement>(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders all authenticated menu options with separators for separation of concerns', () => {
    render(<ProfileMenuPopup {...defaultProps} />);

    expect(screen.getByRole('menu', { name: 'Account options' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Preferences' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Log out' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Trash Documents' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Trash' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Log in' })).not.toBeInTheDocument();
  });

  it('renders unauthenticated menu options including Profile, Preferences and Log in', () => {
    render(<ProfileMenuPopup {...defaultProps} isAuthenticated={false} />);

    expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Preferences' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Trash Documents' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Log out' })).not.toBeInTheDocument();
  });

  it('fires callbacks on clicking each menu item', async () => {
    const user = userEvent.setup();
    render(<ProfileMenuPopup {...defaultProps} />);

    await user.click(screen.getByRole('menuitem', { name: 'Profile' }));
    expect(defaultProps.onOpenProfile).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('menuitem', { name: 'Preferences' }));
    expect(defaultProps.onOpenPreferences).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('menuitem', { name: 'Settings' }));
    expect(defaultProps.onOpenSettings).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('menuitem', { name: 'Log out' }));
    expect(defaultProps.onLogout).toHaveBeenCalledTimes(1);
  });

  it('fires onSignIn when Log in is clicked for guests', async () => {
    const user = userEvent.setup();
    render(<ProfileMenuPopup {...defaultProps} isAuthenticated={false} />);

    await user.click(screen.getByRole('menuitem', { name: 'Log in' }));
    expect(defaultProps.onSignIn).toHaveBeenCalledTimes(1);
  });
});
