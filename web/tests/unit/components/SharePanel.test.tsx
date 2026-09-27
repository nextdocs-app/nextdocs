import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SharePanel } from '../../../components/SharePanel';
import { documentService } from '../../../services/document.service';
import { useAuth } from '../../../hooks/useAuth.hook';

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../services/document.service', () => ({
  documentService: {
    listCollaborators: jest.fn(),
    getSharingSettings: jest.fn(),
    upsertCollaborator: jest.fn(),
    updateCollaboratorAccess: jest.fn(),
    removeCollaborator: jest.fn(),
    updateSharingSettings: jest.fn(),
  },
}));

describe('SharePanel', () => {
  const mockOnClose = jest.fn();
  let anchorButton: HTMLButtonElement;
  let anchorRef: React.RefObject<HTMLButtonElement | null>;
  const mockWriteText = jest.fn().mockResolvedValue(undefined);

  const defaultUser = { id: 'user-1', email: 'owner@example.com' };

  beforeEach(() => {
    jest.clearAllMocks();
    anchorButton = document.createElement('button');
    document.body.appendChild(anchorButton);
    anchorRef = { current: anchorButton };

    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: true,
      accessToken: 'test-token',
      user: defaultUser,
    });

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: mockWriteText,
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    if (anchorButton.parentNode) {
      anchorButton.parentNode.removeChild(anchorButton);
    }
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <SharePanel
        documentId="doc-1"
        isOpen={false}
        onClose={mockOnClose}
        anchorRef={anchorRef}
        canManageSharing={true}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders sign in prompt when user is not authenticated', () => {
    (useAuth as jest.Mock).mockReturnValue({
      isAuthenticated: false,
      accessToken: null,
      user: null,
    });

    render(
      <SharePanel
        documentId="doc-1"
        isOpen={true}
        onClose={mockOnClose}
        anchorRef={anchorRef}
        canManageSharing={false}
      />
    );

    expect(screen.getByText('Sign in to manage sharing.')).toBeInTheDocument();
  });

  describe('Non-admin mode (canManageSharing = false)', () => {
    it('fetches only collaborators, hides invite input and general access, and renders read-only collaborator list', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-owner',
          email: 'alice@example.com',
          displayName: 'Alice Owner',
          accessLevel: 'OWNER',
          owner: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-1',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Me CurrentUser',
          accessLevel: 'OWNER',
          owner: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Editor',
          accessLevel: 'EDIT',
          owner: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );

      // Verify getSharingSettings was NOT called
      expect(documentService.getSharingSettings).not.toHaveBeenCalled();
      expect(documentService.listCollaborators).toHaveBeenCalledWith('doc-1', 'test-token');

      // Verify muted hint
      expect(screen.getByText('You need owner access to manage sharing.')).toBeInTheDocument();

      // Verify invite input is absent
      expect(screen.queryByPlaceholderText('Add people by email')).not.toBeInTheDocument();

      // Verify General access section is absent
      expect(screen.queryByText('General access')).not.toBeInTheDocument();

      // Wait for collaborators to render
      await waitFor(() => {
        expect(screen.getByText('People with access')).toBeInTheDocument();
      });

      // Both Alice (direct owner) and Me (collaborator owner) show static "Owner" label
      expect(screen.getByText('Alice Owner')).toBeInTheDocument();
      expect(screen.getByText('Me CurrentUser')).toBeInTheDocument();
      expect(screen.getByText('(you)')).toBeInTheDocument();
      expect(screen.getAllByText('Owner')).toHaveLength(2);

      // Bob Editor shows static "Editor" label
      expect(screen.getByText('Bob Editor')).toBeInTheDocument();
      expect(screen.getByText('Editor')).toBeInTheDocument();

      // No remove buttons or dropdown menus in non-admin mode
      expect(screen.queryByLabelText('Remove collaborator')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Editor/i })).not.toBeInTheDocument();
    });
  });

  describe('Admin mode (canManageSharing = true)', () => {
    beforeEach(() => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
          owner: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'EDIT',
          owner: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);

      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
      });
    });

    it('fetches both collaborators and sharing settings, and renders invite input and general access', async () => {
      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      expect(documentService.listCollaborators).toHaveBeenCalledWith('doc-1', 'test-token');
      expect(documentService.getSharingSettings).toHaveBeenCalledWith('doc-1', 'test-token');

      expect(screen.getByPlaceholderText('Add people by email')).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('People with access')).toBeInTheDocument();
        expect(screen.getByText('General access')).toBeInTheDocument();
      });

      // Direct owner row has "Owner" and (you) without remove or dropdown
      expect(screen.getByText('Doc Owner')).toBeInTheDocument();
      expect(screen.getByText('(you)')).toBeInTheDocument();
      expect(screen.getByText('Owner')).toBeInTheDocument();

      // Collaborator Bob has dropdown and remove button
      expect(screen.getByText('Bob Collab')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Editor/i })).toBeInTheDocument();
      expect(screen.getByLabelText('Remove collaborator')).toBeInTheDocument();
    });

    it('allows inviting a new collaborator with Owner access', async () => {
      const user = userEvent.setup();
      (documentService.upsertCollaborator as jest.Mock).mockResolvedValue({
        id: 'collab-3',
        userId: 'user-3',
        email: 'charlie@example.com',
        displayName: 'Charlie New',
        accessLevel: 'OWNER',
        owner: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      const emailInput = screen.getByPlaceholderText('Add people by email');
      await user.type(emailInput, 'charlie@example.com');

      // The invite container contains the newly appeared access dropdown
      const inviteContainer = emailInput.closest('div');
      expect(inviteContainer).not.toBeNull();
      const inviteDropdown = within(inviteContainer!).getByRole('button', { name: /Editor/i });
      expect(inviteDropdown).toBeInTheDocument();

      await user.click(inviteDropdown);
      // 'Owner' option should be present in collaborator access options
      const ownerOption = screen.getByRole('option', { name: 'Owner' });
      expect(ownerOption).toBeInTheDocument();
      await user.click(ownerOption);

      const addButton = screen.getByRole('button', { name: 'Add' });
      await user.click(addButton);

      expect(documentService.upsertCollaborator).toHaveBeenCalledWith(
        'doc-1',
        { email: 'charlie@example.com', accessLevel: 'OWNER' },
        'test-token'
      );
    });

    it('allows changing collaborator access level', async () => {
      const user = userEvent.setup();
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue({
        id: 'collab-2',
        userId: 'user-2',
        email: 'bob@example.com',
        displayName: 'Bob Collab',
        accessLevel: 'OWNER',
        owner: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Bob Collab')).toBeInTheDocument();
      });

      const bobDropdown = screen.getByRole('button', { name: /Editor/i });
      await user.click(bobDropdown);

      const ownerOption = screen.getByRole('option', { name: 'Owner' });
      await user.click(ownerOption);

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-2',
        'OWNER',
        'test-token'
      );
    });

    it('allows removing a collaborator', async () => {
      const user = userEvent.setup();
      (documentService.removeCollaborator as jest.Mock).mockResolvedValue(undefined);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Bob Collab')).toBeInTheDocument();
      });

      const removeBtn = screen.getByLabelText('Remove collaborator');
      await user.click(removeBtn);

      expect(documentService.removeCollaborator).toHaveBeenCalledWith(
        'doc-1',
        'user-2',
        'test-token'
      );

      await waitFor(() => {
        expect(screen.queryByText('Bob Collab')).not.toBeInTheDocument();
      });
    });

    it('disables self-editing for an owner collaborator acting as admin', async () => {
      // Actor is user-1, who is a collaborator with OWNER role (not the document owner)
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-actual-owner',
          email: 'alice@example.com',
          displayName: 'Alice Owner',
          accessLevel: 'OWNER',
          owner: true,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-1',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Actor OwnerCollab',
          accessLevel: 'OWNER',
          owner: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Editor',
          accessLevel: 'EDIT',
          owner: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Actor OwnerCollab')).toBeInTheDocument();
      });

      // The actor's own row displays (you) and static role text "Owner" without dropdown
      expect(screen.getByText('(you)')).toBeInTheDocument();
      expect(screen.getByText('Actor OwnerCollab')).toBeInTheDocument();

      // Only one remove button should exist (for Bob)
      const removeButtons = screen.getAllByLabelText('Remove collaborator');
      expect(removeButtons).toHaveLength(1);
    });

    it('updates general access mode and restricts link access levels to VIEW, COMMENT, EDIT', async () => {
      const user = userEvent.setup();
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
      });

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Restricted')).toBeInTheDocument();
      });

      const modeDropdown = screen.getByRole('button', { name: /Restricted/i });
      await user.click(modeDropdown);

      const anyoneOption = screen.getByRole('option', { name: 'Anyone with the link' });
      await user.click(anyoneOption);

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-1',
        { generalAccessMode: 'ANYONE_WITH_LINK', linkAccessLevel: 'VIEW' },
        'test-token'
      );

      // Now with ANYONE_WITH_LINK mode, the link access dropdown appears
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Viewer/i })).toBeInTheDocument();
      });

      const linkAccessDropdown = screen.getByRole('button', { name: /Viewer/i });
      await user.click(linkAccessDropdown);

      // Options must include Viewer, Commenter, Editor, but NOT Owner
      expect(screen.getByRole('option', { name: 'Viewer' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Commenter' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Editor' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
    });
  });

  describe('Utility actions and error handling', () => {
    it('copies page URL when Copy link is clicked', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );

      const copyBtn = screen.getByRole('button', { name: /Copy link/i });
      fireEvent.click(copyBtn);

      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(window.location.href);
      });
      expect(screen.getByText('Copied!')).toBeInTheDocument();
    });

    it('calls onClose when Done is clicked', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );

      const doneBtn = screen.getByRole('button', { name: 'Done' });
      await user.click(doneBtn);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
    });

    it('surfaces error message when collaborator loading fails', async () => {
      (documentService.listCollaborators as jest.Mock).mockRejectedValue(
        new Error('Network error loading collaborators')
      );

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Network error loading collaborators')).toBeInTheDocument();
      });
    });
  });
});
