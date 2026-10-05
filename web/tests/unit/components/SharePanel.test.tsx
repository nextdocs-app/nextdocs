import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SharePanel } from '../../../components/SharePanel';
import { documentService } from '../../../services/document.service';
import { useAuth } from '../../../hooks/useAuth.hook';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
    prefetch: jest.fn(),
  }),
}));

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

      expect(documentService.getSharingSettings).not.toHaveBeenCalled();
      expect(documentService.listCollaborators).toHaveBeenCalledWith('doc-1', 'test-token');

      expect(screen.getByText('You need owner access to manage sharing.')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Add people by email')).not.toBeInTheDocument();
      expect(screen.queryByText('General')).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('People with access')).toBeInTheDocument();
      });

      expect(screen.getByText('Alice Owner')).toBeInTheDocument();
      expect(screen.getByText('Me CurrentUser')).toBeInTheDocument();
      expect(screen.getByText('(you)')).toBeInTheDocument();
      expect(screen.getAllByText('Full access')).toHaveLength(2);

      expect(screen.getByText('Bob Editor')).toBeInTheDocument();
      expect(screen.getByText('Can edit')).toBeInTheDocument();

      expect(screen.queryByLabelText('Remove collaborator')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Can edit/i })).not.toBeInTheDocument();
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
        expect(screen.getByText('General')).toBeInTheDocument();
      });

      expect(screen.getByText('Doc Owner')).toBeInTheDocument();
      expect(screen.getByText('(you)')).toBeInTheDocument();
      expect(screen.getByText('Full access')).toBeInTheDocument();

      expect(screen.getByText('Bob Collab')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Can edit/i })).toBeInTheDocument();
      expect(screen.queryByLabelText('Remove collaborator')).not.toBeInTheDocument();
    });

    it('allows inviting a new collaborator with Full access', async () => {
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

      const inviteContainer = emailInput.closest('div');
      expect(inviteContainer).not.toBeNull();
      const inviteDropdown = within(inviteContainer!).getByRole('button', { name: /Can edit/i });
      expect(inviteDropdown).toBeInTheDocument();

      await user.click(inviteDropdown);
      const ownerOption = screen.getByRole('option', { name: 'Full access' });
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
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(undefined);
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: 'collab-owner',
            userId: 'user-1',
            email: 'owner@example.com',
            displayName: 'Doc Owner',
            accessLevel: 'OWNER',
            owner: true,
          },
          {
            id: 'collab-2',
            userId: 'user-2',
            email: 'bob@example.com',
            displayName: 'Bob Collab',
            accessLevel: 'EDIT',
            owner: false,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'collab-owner',
            userId: 'user-1',
            email: 'owner@example.com',
            displayName: 'Doc Owner',
            accessLevel: 'OWNER',
            owner: true,
          },
          {
            id: 'collab-2',
            userId: 'user-2',
            email: 'bob@example.com',
            displayName: 'Bob Collab',
            accessLevel: 'VIEW',
            owner: false,
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
        expect(screen.getByText('Bob Collab')).toBeInTheDocument();
      });

      const bobDropdown = screen.getByRole('button', { name: /Can edit/i });
      await user.click(bobDropdown);

      const viewOption = screen.getByRole('option', { name: 'Can view' });
      await user.click(viewOption);

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-2',
        'VIEW',
        'test-token'
      );
    });

    it('allows changing collaborator access level to Full access from dropdown', async () => {
      const user = userEvent.setup();
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(undefined);
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
          owner: true,
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'EDIT',
          owner: false,
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
        expect(screen.getByText('Bob Collab')).toBeInTheDocument();
      });

      const bobDropdown = screen.getByRole('button', { name: /Can edit/i });
      await user.click(bobDropdown);

      const fullAccessOption = screen.getByRole('option', { name: 'Full access' });
      expect(fullAccessOption).toBeInTheDocument();
      await user.click(fullAccessOption);

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-2',
        'OWNER',
        'test-token'
      );
    });

    it('allows demoting a direct Full access collaborator to Can edit', async () => {
      const user = userEvent.setup();
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(undefined);
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-actual-owner',
          email: 'creator@example.com',
          displayName: 'Doc Creator',
          accessLevel: 'OWNER',
          owner: true,
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob DirectOwner',
          accessLevel: 'OWNER',
          owner: false,
          inherited: false,
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
        expect(screen.getByText('Bob DirectOwner')).toBeInTheDocument();
      });

      // Direct owner should have an interactive dropdown button
      const bobDropdown = screen.getByRole('button', { name: /Full access/i });
      expect(bobDropdown).toBeInTheDocument();
      await user.click(bobDropdown);

      const editOption = screen.getByRole('option', { name: 'Can edit' });
      expect(editOption).toBeInTheDocument();
      await user.click(editOption);

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-2',
        'EDIT',
        'test-token'
      );
    });

    it('allows overriding an inherited full-access collaborator', async () => {
      const user = userEvent.setup();
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(undefined);
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Creator',
          accessLevel: 'OWNER',
          owner: true,
        },
        {
          id: 'collab-ancestor-owner',
          userId: 'user-ancestor',
          email: 'ancestor@example.com',
          displayName: 'Ancestor Owner',
          accessLevel: 'OWNER',
          owner: false,
          inherited: true,
          inheritedFromTitle: 'Parent Doc',
          inheritedFromId: 'doc-parent',
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
        expect(screen.getByText('Ancestor Owner')).toBeInTheDocument();
      });

      expect(screen.getByText('via Parent Doc')).toBeInTheDocument();

      // Any inherited grant - even full access - is overridable on a child.
      const dropdown = screen.getByRole('button', { name: /Full access/i });
      await user.click(dropdown);

      const viewOption = screen.getByRole('option', { name: 'Can view' });
      await user.click(viewOption);

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-ancestor',
        'VIEW',
        'test-token'
      );
    });

    it('allows editing a direct row that overrides an ancestor full-access grant', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Creator',
          accessLevel: 'OWNER',
          owner: true,
        },
        {
          id: 'collab-ancestor-owner',
          userId: 'user-ancestor',
          email: 'ancestor@example.com',
          displayName: 'Ancestor Owner',
          accessLevel: 'OWNER',
          owner: false,
          inherited: false,
          inheritedFromId: 'doc-parent',
          inheritedFromTitle: 'Parent Doc',
          inheritedAccessLevel: 'OWNER',
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
        expect(screen.getByText('Ancestor Owner')).toBeInTheDocument();
      });

      expect(screen.getByText('Overrides Parent Doc')).toBeInTheDocument();

      const dropdown = screen.getByRole('button', { name: /Full access/i });
      await user.click(dropdown);

      expect(
        screen.getByRole('option', { name: 'Inherit from Parent Doc (full access)' })
      ).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Can edit' })).toBeInTheDocument();
    });

    it('allows removing direct collaborator by selecting "No access"', async () => {
      const user = userEvent.setup();
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(undefined);
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: 'collab-owner',
            userId: 'user-1',
            email: 'owner@example.com',
            displayName: 'Doc Owner',
            accessLevel: 'OWNER',
            owner: true,
          },
          {
            id: 'collab-2',
            userId: 'user-2',
            email: 'bob@example.com',
            displayName: 'Bob Collab',
            accessLevel: 'EDIT',
            owner: false,
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'collab-owner',
            userId: 'user-1',
            email: 'owner@example.com',
            displayName: 'Doc Owner',
            accessLevel: 'OWNER',
            owner: true,
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
        expect(screen.getByText('Bob Collab')).toBeInTheDocument();
      });

      const bobDropdown = screen.getByRole('button', { name: /Can edit/i });
      await user.click(bobDropdown);

      const noAccessOption = screen.getByRole('option', { name: 'No access' });
      await user.click(noAccessOption);

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-2',
        'NO_ACCESS',
        'test-token'
      );

      await waitFor(() => {
        expect(screen.queryByText('Bob Collab')).not.toBeInTheDocument();
      });
    });

    it('disables self-editing for an owner collaborator acting as admin', async () => {
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

      expect(screen.getByText('(you)')).toBeInTheDocument();
      expect(screen.getByText('Actor OwnerCollab')).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /Full access/i })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Can edit/i })).toBeInTheDocument();
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

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Can view/i })).toBeInTheDocument();
      });

      const linkAccessDropdown = screen.getByRole('button', { name: /Can view/i });
      await user.click(linkAccessDropdown);

      expect(screen.getByRole('option', { name: 'Can view' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Can comment' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Can edit' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Full access' })).not.toBeInTheDocument();
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

  describe('Hierarchical access and provenance (Notion-style)', () => {
    it('displays inherited access badge and origin document for collaborators with inherited access', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-owner',
          email: 'alice@example.com',
          displayName: 'Alice Owner',
          accessLevel: 'OWNER',
          owner: true,
          inherited: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-inherited',
          userId: 'user-inherited',
          email: 'bob@example.com',
          displayName: 'Bob Inherited',
          accessLevel: 'EDIT',
          owner: false,
          inherited: true,
          inheritedFromId: 'doc-parent',
          inheritedFromTitle: 'Engineering Wiki',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-direct',
          userId: 'user-direct',
          email: 'charlie@example.com',
          displayName: 'Charlie Direct',
          accessLevel: 'VIEW',
          owner: false,
          inherited: false,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Bob Inherited')).toBeInTheDocument();
      });

      const viaBadge = screen.getByText('via Engineering Wiki');
      expect(viaBadge).toBeInTheDocument();
      expect(viaBadge).toHaveAttribute('title', 'Inherited via Engineering Wiki');
      expect(viaBadge.className).toContain('truncate');

      const nameEl = screen.getByText('Bob Inherited');
      expect(viaBadge.parentElement).toBe(nameEl.parentElement);

      const emailEl = screen.getByText('bob@example.com');
      expect(emailEl.parentElement).not.toBe(nameEl.parentElement);

      expect(screen.getByRole('button', { name: /Can edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Can view/i })).toBeInTheDocument();
      expect(screen.queryByLabelText('Remove collaborator')).not.toBeInTheDocument();
    });

    it('does not display inheritance banner container and navigates to ancestor when clicking via badge', async () => {
      const mockNavigate = jest.fn();
      const user = userEvent.setup();

      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-inherited',
          userId: 'user-inherited',
          email: 'bob@example.com',
          displayName: 'Bob Inherited',
          accessLevel: 'EDIT',
          owner: false,
          inherited: true,
          inheritedFromId: 'doc-parent',
          inheritedFromTitle: 'Product Docs',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
          onNavigate={mockNavigate}
        />
      );

      expect(screen.queryByText(/Permissions inherited from/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Collaborators with access to ancestor pages inherit access/i)
      ).not.toBeInTheDocument();

      const viaBtn = await screen.findByRole('button', { name: 'via Product Docs' });
      expect(viaBtn).toBeInTheDocument();

      await user.click(viaBtn);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('doc-parent');
    });

    it('allows overriding an inherited collaborator to a direct access level', async () => {
      const user = userEvent.setup();
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(undefined);
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: 'collab-inherited',
            userId: 'user-inherited',
            email: 'bob@example.com',
            displayName: 'Bob Inherited',
            accessLevel: 'EDIT',
            owner: false,
            inherited: true,
            inheritedFromId: 'doc-parent',
            inheritedFromTitle: 'Parent Wiki',
            inheritedAccessLevel: 'EDIT',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'collab-inherited',
            userId: 'user-inherited',
            email: 'bob@example.com',
            displayName: 'Bob Inherited',
            accessLevel: 'VIEW',
            owner: false,
            inherited: false,
            inheritedFromId: 'doc-parent',
            inheritedFromTitle: 'Parent Wiki',
            inheritedAccessLevel: 'EDIT',
          },
        ]);

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await screen.findByText('Bob Inherited');
      const bobDropdown = screen.getByRole('button', { name: /Can edit/i });
      await user.click(bobDropdown);

      const viewOption = screen.getByRole('option', { name: 'Can view' });
      await user.click(viewOption);

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-child',
        'user-inherited',
        'VIEW',
        'test-token'
      );

      await waitFor(() => {
        expect(screen.getByText('Overrides Parent Wiki')).toBeInTheDocument();
      });
    });

    it('renders Overrides badge and allows restoring parent inheritance via inherit entry', async () => {
      const user = userEvent.setup();
      (documentService.removeCollaborator as jest.Mock).mockResolvedValue(undefined);
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: 'collab-overridden',
            userId: 'user-bob',
            email: 'bob@example.com',
            displayName: 'Bob Overridden',
            accessLevel: 'VIEW',
            owner: false,
            inherited: false,
            inheritedFromId: 'doc-parent',
            inheritedFromTitle: 'Design System',
            inheritedAccessLevel: 'EDIT',
          },
        ])
        .mockResolvedValueOnce([
          {
            id: 'collab-overridden',
            userId: 'user-bob',
            email: 'bob@example.com',
            displayName: 'Bob Overridden',
            accessLevel: 'EDIT',
            owner: false,
            inherited: true,
            inheritedFromId: 'doc-parent',
            inheritedFromTitle: 'Design System',
            inheritedAccessLevel: 'EDIT',
          },
        ]);

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await screen.findByText('Bob Overridden');
      expect(screen.getByText('Overrides Design System')).toBeInTheDocument();

      const bobDropdown = screen.getByRole('button', { name: /Can view/i });
      await user.click(bobDropdown);

      const inheritOption = screen.getByRole('option', {
        name: 'Inherit from Design System (can edit)',
      });
      expect(inheritOption).toBeInTheDocument();

      await user.click(inheritOption);

      expect(documentService.removeCollaborator).toHaveBeenCalledWith(
        'doc-child',
        'user-bob',
        'test-token'
      );

      await waitFor(() => {
        expect(screen.getByText('via Design System')).toBeInTheDocument();
      });
    });

    it('excludes NO_ACCESS collaborator from People with access count and displays public link warning', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
          owner: true,
        },
        {
          id: 'collab-active',
          userId: 'user-2',
          email: 'alice@example.com',
          displayName: 'Alice Active',
          accessLevel: 'EDIT',
          owner: false,
        },
        {
          id: 'collab-blocked',
          userId: 'user-3',
          email: 'bob@example.com',
          displayName: 'Bob Blocked',
          accessLevel: 'NO_ACCESS',
          owner: false,
          inherited: false,
          inheritedFromTitle: 'Parent Wiki',
        },
      ]);

      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: true,
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

      await screen.findByText('Bob Blocked');

      // People with access count must be (2) since Bob Blocked has NO_ACCESS
      expect(screen.getByText('(2)')).toBeInTheDocument();

      // Warning note rendered for NO_ACCESS when public link is active
      expect(
        screen.getByText(
          'Bob Blocked is blocked while signed in; anyone with the public link can still view this document.'
        )
      ).toBeInTheDocument();
    });

    it('surfaces an inherited public link and its origin even when this document is restricted', async () => {
      const mockNavigate = jest.fn();
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
          owner: true,
        },
        {
          id: 'collab-blocked',
          userId: 'user-3',
          email: 'bob@example.com',
          displayName: 'Bob Blocked',
          accessLevel: 'NO_ACCESS',
          owner: false,
          inherited: false,
          inheritedFromTitle: 'Parent Wiki',
        },
      ]);

      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'COMMENT',
        hasActiveLink: false,
        inherited: true,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
          onNavigate={mockNavigate}
        />
      );

      await screen.findByText('Bob Blocked');

      // The via badge replaces the description when provenance must be shown.
      const viaButton = await screen.findByRole('button', { name: 'via Parent Wiki' });
      expect(
        screen.queryByText('Anyone on the internet with the link can comment')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Only people with access can open with the link')
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Anyone with the link' })).toBeInTheDocument();
      await user.click(viaButton);
      expect(mockNavigate).toHaveBeenCalledWith('doc-parent');

      // The blocked-user warning reflects the inherited link level, not always "view".
      expect(
        screen.getByText(
          'Bob Blocked is blocked while signed in; anyone with the public link can still comment this document.'
        )
      ).toBeInTheDocument();
    });

    it('shows the effective Anyone mode (not Restricted) for an inherited public link', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'EDIT',
        hasActiveLink: false,
        inherited: true,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await screen.findByRole('button', { name: 'via Parent Wiki' });
      // The badge replaces the helper sentence, so the description stays hidden.
      expect(
        screen.queryByText('Anyone on the internet with the link can edit')
      ).not.toBeInTheDocument();
      // The mode dropdown reflects effective access, so it never contradicts
      // the hidden helper sentence with a simultaneous "Restricted".
      expect(screen.getByRole('button', { name: 'Anyone with the link' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Restricted' })).not.toBeInTheDocument();
    });

    it('renders an Overrides badge when the document has its own link over an ancestor link', async () => {
      const mockNavigate = jest.fn();
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'EDIT',
        hasActiveLink: true,
        inherited: false,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
          onNavigate={mockNavigate}
        />
      );

      await screen.findByRole('button', { name: 'Overrides Parent Wiki' });
      expect(
        screen.queryByText('Anyone on the internet with the link can edit')
      ).not.toBeInTheDocument();
      const overridesButton = screen.getByRole('button', { name: 'Overrides Parent Wiki' });
      await user.click(overridesButton);
      expect(mockNavigate).toHaveBeenCalledWith('doc-parent');
    });

    it('creates an override link when the level changes on an inherited public link', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: true,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
      });
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'EDIT',
        hasActiveLink: true,
        inherited: false,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await screen.findByRole('button', { name: 'via Parent Wiki' });
      expect(
        screen.queryByText('Anyone on the internet with the link can view')
      ).not.toBeInTheDocument();
      const linkDropdown = screen.getByRole('button', { name: /Can view/i });
      await user.click(linkDropdown);
      await user.click(screen.getByRole('option', { name: 'Can edit' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { generalAccessMode: 'ANYONE_WITH_LINK', linkAccessLevel: 'EDIT' },
        'test-token'
      );
      await screen.findByRole('button', { name: 'Overrides Parent Wiki' });
      expect(
        screen.queryByText('Anyone on the internet with the link can edit')
      ).not.toBeInTheDocument();
    });

    it('shows a Blocked from badge and Inherit option for a blocked link, without extra buttons', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: false,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
        linkInheritBlocked: true,
      });
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'EDIT',
        hasActiveLink: false,
        inherited: true,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
        linkInheritBlocked: false,
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      const badge = await screen.findByRole('button', { name: 'Blocked from Parent Wiki' });
      expect(badge).toHaveAttribute('title', 'Blocks inheritance from Parent Wiki');
      // The badge replaces the description, so the helper sentence stays hidden.
      expect(
        screen.queryByText('Only people with access can open with the link')
      ).not.toBeInTheDocument();
      // Distinct badge from an own-link override; no bespoke buttons.
      expect(screen.queryByRole('button', { name: 'Restrict access' })).not.toBeInTheDocument();
      expect(screen.queryByText('Inheritance blocked')).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Restricted' }));
      await user.click(screen.getByRole('option', { name: 'Inherit from Parent Wiki' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { generalAccessMode: 'RESTRICTED', linkInheritBlocked: false },
        'test-token'
      );
      await screen.findByRole('button', { name: 'via Parent Wiki' });
      expect(
        screen.queryByText('Anyone on the internet with the link can edit')
      ).not.toBeInTheDocument();
    });

    it('pins an inherited link mode as an explicit own override when selecting Anyone with the link', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        hasActiveLink: true,
        inherited: true,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
        linkInheritBlocked: false,
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await screen.findByRole('button', { name: 'via Parent Wiki' });
      const modeDropdown = screen.getByRole('button', { name: 'Anyone with the link' });
      await user.click(modeDropdown);

      const option = screen.getByRole('option', { name: /^Anyone with the link/i });
      await user.click(option);

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { generalAccessMode: 'ANYONE_WITH_LINK', linkAccessLevel: 'VIEW' },
        'test-token'
      );
    });

    it('does not write an override when re-selecting the explicit own mode', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: true,
        inherited: false,
        inheritedFromId: null,
        inheritedFromTitle: null,
        linkInheritBlocked: false,
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      const modeDropdown = await screen.findByRole('button', { name: 'Anyone with the link' });
      await user.click(modeDropdown);

      const option = screen.getByRole('option', { name: /^Anyone with the link/i });
      await user.click(option);

      expect(documentService.updateSharingSettings).not.toHaveBeenCalled();
    });

    it('offers Inherit from parent in the mode dropdown for an own-link override', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'EDIT',
        hasActiveLink: true,
        inherited: false,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
        linkInheritBlocked: false,
      });
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: true,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
        linkInheritBlocked: false,
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await screen.findByRole('button', { name: 'Overrides Parent Wiki' });
      expect(
        screen.queryByText('Anyone on the internet with the link can edit')
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Anyone with the link' }));
      await user.click(screen.getByRole('option', { name: 'Inherit from Parent Wiki' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { generalAccessMode: 'RESTRICTED', linkInheritBlocked: false },
        'test-token'
      );
    });

    it('blocks via the Restricted mode option on an inherited link', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: true,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
      });
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: false,
        inheritedFromId: null,
        inheritedFromTitle: null,
        linkInheritBlocked: true,
      });

      render(
        <SharePanel
          documentId="doc-child"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await screen.findByRole('button', { name: 'via Parent Wiki' });
      expect(
        screen.queryByText('Anyone on the internet with the link can view')
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Anyone with the link' }));
      await user.click(screen.getByRole('option', { name: 'Restricted' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { generalAccessMode: 'RESTRICTED', linkInheritBlocked: true },
        'test-token'
      );
    });
  });
});
