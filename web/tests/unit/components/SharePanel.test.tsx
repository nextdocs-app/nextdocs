import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { SharePanel } from '../../../components/SharePanel';
import { documentService, DocumentServiceApiError } from '../../../services/document.service';
import { useAuth } from '../../../hooks/useAuth.hook';
import { OPEN_SPACE_SETTINGS_EVENT } from '../../../lib/space-settings-event.util';
import { DOCUMENT_ACCESS_CHANGED_EVENT } from '../../../lib/document-access-event.util';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    prefetch: jest.fn(),
  }),
}));

jest.mock('../../../hooks/useAuth.hook', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../../../services/document.service', () => ({
  documentService: {
    listCollaborators: jest.fn(),
    hasHiddenSharingSources: jest.fn(),
    getMyAccess: jest.fn(),
    getSharingSettings: jest.fn(),
    upsertCollaborator: jest.fn(),
    updateCollaboratorAccess: jest.fn(),
    removeCollaborator: jest.fn(),
    leaveSharedDocument: jest.fn(),
    updateSharingSettings: jest.fn(),
  },
  DocumentServiceApiError: jest.requireActual('../../../services/document.service')
    .DocumentServiceApiError,
}));

describe('SharePanel', () => {
  const mockOnClose = jest.fn();
  let anchorButton: HTMLButtonElement;
  let anchorRef: React.RefObject<HTMLButtonElement | null>;
  const mockWriteText = jest.fn().mockResolvedValue(undefined);

  const defaultUser = { id: 'user-1', email: 'owner@example.com' };

  beforeEach(() => {
    jest.clearAllMocks();
    (documentService.hasHiddenSharingSources as jest.Mock).mockResolvedValue(false);
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

  it('shows a neutral notice for inaccessible sharing sources', async () => {
    (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
    (documentService.hasHiddenSharingSources as jest.Mock).mockResolvedValue(true);
    render(<SharePanel documentId="doc-1" isOpen onClose={mockOnClose} anchorRef={anchorRef} />);
    expect(
      await screen.findByText('Others may have access through locations you can’t view.')
    ).toBeInTheDocument();
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

  it('clears the previous document roster when documentId changes while open', async () => {
    const alice = {
      id: 'collab-alice',
      userId: 'user-alice',
      email: 'alice@example.com',
      displayName: 'Alice Owner',
      accessLevel: 'OWNER',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };
    // Doc B stays pending so we can assert the reset happens before it resolves.
    let resolveDocB: (v: never[]) => void = () => {};
    const docBPending = new Promise<never[]>((resolve) => {
      resolveDocB = resolve;
    });
    (documentService.listCollaborators as jest.Mock).mockImplementation((docId: string) =>
      docId === 'doc-1' ? Promise.resolve([alice]) : docBPending
    );

    const { rerender } = render(
      <SharePanel
        documentId="doc-1"
        isOpen={true}
        onClose={mockOnClose}
        anchorRef={anchorRef}
        canManageSharing={false}
      />
    );
    await screen.findByText('Alice Owner');

    rerender(
      <SharePanel
        documentId="doc-2"
        isOpen={true}
        onClose={mockOnClose}
        anchorRef={anchorRef}
        canManageSharing={false}
      />
    );

    // Stale roster must not linger under the new document while loading.
    expect(screen.queryByText('Alice Owner')).not.toBeInTheDocument();
    expect(documentService.listCollaborators).toHaveBeenLastCalledWith('doc-2', 'test-token');

    resolveDocB([]);
  });

  describe('Non-admin mode (canManageSharing = false)', () => {
    it('hides the invite input and renders read-only general access and collaborator list', async () => {
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'VIEW',
      });
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-owner',
          email: 'alice@example.com',
          displayName: 'Alice Owner',
          accessLevel: 'OWNER',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-1',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Me CurrentUser',
          accessLevel: 'OWNER',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Editor',
          accessLevel: 'EDIT',
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

      expect(documentService.getSharingSettings).toHaveBeenCalledWith('doc-1', 'test-token');
      expect(documentService.listCollaborators).toHaveBeenCalledWith('doc-1', 'test-token');

      expect(screen.getByText('Only owners can manage sharing.')).toBeInTheDocument();
      expect(screen.queryByPlaceholderText('Add people by email')).not.toBeInTheDocument();
      expect(await screen.findByText('General Access')).toBeInTheDocument();
      expect(screen.getByText('Anyone in this workspace')).toBeInTheDocument();
      // The audience is visible but not editable for a reader.
      expect(
        screen.queryByRole('button', { name: 'Workspace general access' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Workspace access level' })
      ).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByText('Me CurrentUser')).toBeInTheDocument();
      });

      expect(screen.getByText('Alice Owner')).toBeInTheDocument();
      expect(screen.getByText('Me CurrentUser')).toBeInTheDocument();
      expect(screen.getByText('(you)')).toBeInTheDocument();
      expect(screen.getAllByText('Owner')).toHaveLength(2);

      expect(screen.getByText('Bob Editor')).toBeInTheDocument();
      expect(screen.getByText('Can edit')).toBeInTheDocument();

      expect(screen.queryByLabelText('Remove collaborator')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Can edit/i })).not.toBeInTheDocument();
    });
  });

  describe('Space-aware sharing', () => {
    const space = {
      id: 'space-1',
      name: 'Engineering',
      accessMode: 'CUSTOM' as const,
      everyoneAccessLevel: 'VIEW' as const,
      myAccessLevel: 'VIEW' as const,
      canAdminister: false,
      archived: false,
    };

    const ownerRow = {
      userId: 'user-1',
      email: 'owner@example.com',
      displayName: 'Doc Owner',
      accessLevel: 'OWNER' as const,
      addedAt: '2026-01-01T00:00:00Z',
    };

    it('shows the stored page grant and no per-row effective access', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([ownerRow]);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
          documentSpace={space}
        />
      );

      expect(await screen.findByText('Doc Owner')).toBeInTheDocument();
      // The old inherited "Space members" section is gone; the only space action is the footer.
      // The row keeps showing the configured OWNER grant; combining independent sources
      // belongs to the viewer-level summary, never to another person's row.
      expect(screen.getByText('Owner')).toBeInTheDocument();
      expect(screen.queryByText(/Effective access:/i)).not.toBeInTheDocument();
      // The page names its access source in the roster; the sharing note belongs at
      // the bottom, not as the panel's opening message.
      expect(
        screen.queryByText(
          'Only page owners or owners of Engineering can manage sharing for this page.'
        )
      ).not.toBeInTheDocument();
      expect(screen.getByText('Only owners can manage sharing.')).toBeInTheDocument();

      // Re-picking the stored level is not an edit for a non-admin.
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Owner' }));
      await user.click(screen.getByRole('option', { name: 'Owner' }));
      expect(documentService.updateCollaboratorAccess).not.toHaveBeenCalled();
    });

    it('shows the resolved audiences read-only instead of the private-share refusal', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.hasHiddenSharingSources as jest.Mock).mockResolvedValue(true);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'EDIT',
        workspaceInherited: true,
        workspaceInheritedFromKind: 'SPACE',
        workspaceInheritedFromId: 'space-1',
        workspaceInheritedFromTitle: 'Engineering',
      });

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
          documentSpace={{
            ...space,
            accessMode: 'PUBLIC',
            everyoneAccessLevel: 'EDIT',
            myAccessLevel: 'EDIT',
          }}
        />
      );

      // A reader sees the same General Access rows as an owner, as text. The active
      // audience explains the roster, so no hidden-source warning is repeated.
      expect(await screen.findByText('General Access')).toBeInTheDocument();
      expect(screen.getByText('Anyone in this workspace')).toBeInTheDocument();
      expect(screen.getByText('Can edit')).toBeInTheDocument();
      expect(screen.getByText('Only owners can manage sharing.')).toBeInTheDocument();
      expect(
        screen.queryByText(
          'Only page owners or owners of Engineering can manage sharing for this page.'
        )
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Others may have access through locations you can’t view.')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Workspace general access' })
      ).not.toBeInTheDocument();
    });

    it('shows the public space audience to a sharing admin above link access', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      // The API resolves the space audience as the page's inherited workspace setting.
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'COMMENT',
        workspaceInherited: true,
        workspaceInheritedFromKind: 'SPACE',
        workspaceInheritedFromId: 'space-1',
        workspaceInheritedFromTitle: 'Engineering',
      });

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
          documentSpace={{
            ...space,
            accessMode: 'PUBLIC',
            everyoneAccessLevel: 'COMMENT',
            myAccessLevel: 'EDIT',
          }}
        />
      );

      const generalAccess = within((await screen.findByText('General Access')).closest('section')!);
      expect(generalAccess.getByText('Anyone in this workspace')).toBeInTheDocument();
      expect(generalAccess.getByText('Can comment')).toBeInTheDocument();
      expect(generalAccess.getByText('From “Engineering”')).toBeInTheDocument();
      expect(generalAccess.queryByText(/Only page owners/)).not.toBeInTheDocument();

      // The link row is intentionally absent until link access is enabled; the
      // same General Access dropdown is where a manager adds it.
      const user = userEvent.setup();
      await user.click(generalAccess.getByRole('button', { name: 'Workspace general access' }));
      expect(screen.getByRole('option', { name: 'Anyone with the link' })).toBeInTheDocument();
    });

    it('keeps the owner-only notice and read-only audiences in an archived space', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'VIEW',
      });

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
          documentSpace={{ ...space, archived: true, canAdminister: true }}
        />
      );

      expect(await screen.findByText('Only owners can manage sharing.')).toBeInTheDocument();
      // The archive freezes the controls, not the projection: both rows still render
      // as text so a reader can see what the page resolves to.
      expect(screen.getByText('General Access')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Workspace general access' })
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/Only page owners/)).not.toBeInTheDocument();
    });

    it('keeps one roster row for the viewer and no synthetic row', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([ownerRow]);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
          documentSpace={space}
        />
      );

      expect(await screen.findByText('Doc Owner')).toBeInTheDocument();
      expect(screen.getAllByText('(you)')).toHaveLength(1);
      expect(screen.getByText('Owner')).toBeInTheDocument();
      expect(screen.queryByText(/Effective access:/i)).not.toBeInTheDocument();
    });

    it('surfaces the clear refusal when No access would block an inherited owner', async () => {
      const user = userEvent.setup();
      const inheritedOwner = {
        userId: 'user-2',
        email: 'spaceowner@example.com',
        displayName: 'Space Owner',
        accessLevel: 'OWNER' as const,
        inherited: true,
        inheritedFromId: 'space-1',
        inheritedFromTitle: 'Engineering',
        inheritedAccessLevel: 'OWNER' as const,
      };
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([inheritedOwner]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
      });
      (documentService.updateCollaboratorAccess as jest.Mock).mockRejectedValue(
        new Error('An owner of “Engineering” cannot be set to No access on this page.')
      );

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
          documentSpace={{ ...space, canAdminister: true, myAccessLevel: 'OWNER' }}
        />
      );

      await screen.findByText('Space Owner');
      await user.click(screen.getByRole('button', { name: 'Owner' }));
      await user.click(screen.getByRole('option', { name: 'No access' }));

      expect(
        await screen.findByText(
          'An owner of “Engineering” cannot be set to No access on this page.'
        )
      ).toBeInTheDocument();
    });

    it('offers Owner access from a space-page invite', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([ownerRow]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
      });

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
          documentSpace={{ ...space, canAdminister: true, myAccessLevel: 'OWNER' }}
        />
      );

      await user.type(await screen.findByPlaceholderText('Add people by email'), 'new@example.com');
      await user.click(screen.getByRole('button', { name: 'Can edit' }));

      expect(screen.getByRole('listbox')).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Owner' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Can edit' })).toBeInTheDocument();
    });

    it('offers Owner access on a space member row', async () => {
      const user = userEvent.setup();
      const inheritedMember = {
        userId: 'user-2',
        email: 'member@example.com',
        displayName: 'Space Collab',
        accessLevel: 'EDIT' as const,
        inherited: true,
        inheritedFromTitle: 'Engineering',
        inheritedFromId: 'space-1',
        createdAt: '2026-01-01T00:00:00Z',
      };
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([inheritedMember]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
      });

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
          documentSpace={{ ...space, canAdminister: true, myAccessLevel: 'OWNER' }}
        />
      );

      const groupButton = await screen.findByRole('button', { name: /From “Engineering”/ });
      await user.click(groupButton);
      await user.click(await screen.findByRole('button', { name: /Can edit/i }));

      expect(screen.getByRole('option', { name: 'Owner' })).toBeInTheDocument();
    });

    it('opens space members settings from the footer', async () => {
      const user = userEvent.setup();
      const listener = jest.fn();
      window.addEventListener(OPEN_SPACE_SETTINGS_EVENT, listener);

      try {
        const inheritedMember = {
          userId: 'user-2',
          email: 'member@example.com',
          displayName: 'Space Collab',
          accessLevel: 'EDIT' as const,
          inherited: true,
          inheritedFromTitle: 'Engineering',
          inheritedFromId: 'space-1',
        };
        (documentService.listCollaborators as jest.Mock).mockResolvedValue([inheritedMember]);

        render(
          <SharePanel
            documentId="doc-1"
            isOpen={true}
            onClose={mockOnClose}
            anchorRef={anchorRef}
            canManageSharing={true}
            documentSpace={{ ...space, canAdminister: true, myAccessLevel: 'OWNER' }}
          />
        );

        await user.click(
          await screen.findByRole('button', { name: 'Space members in Engineering' })
        );

        expect(mockOnClose).toHaveBeenCalled();
        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
          spaceId: 'space-1',
          tab: 'members',
        });
      } finally {
        window.removeEventListener(OPEN_SPACE_SETTINGS_EVENT, listener);
      }
    });

    it('opens space members settings when clicking an override of the space', async () => {
      const user = userEvent.setup();
      const listener = jest.fn();
      window.addEventListener(OPEN_SPACE_SETTINGS_EVENT, listener);

      try {
        const overriddenMember = {
          userId: 'user-3',
          email: 'override@example.com',
          displayName: 'Overridden Collab',
          accessLevel: 'COMMENT' as const,
          inherited: false,
          inheritedFromTitle: 'Engineering',
          inheritedFromId: 'space-1',
          inheritedAccessLevel: 'EDIT' as const,
        };
        (documentService.listCollaborators as jest.Mock).mockResolvedValue([overriddenMember]);

        render(
          <SharePanel
            documentId="doc-1"
            isOpen={true}
            onClose={mockOnClose}
            anchorRef={anchorRef}
            canManageSharing={true}
            documentSpace={{ ...space, canAdminister: true, myAccessLevel: 'OWNER' }}
          />
        );

        const overridesBtn = await screen.findByRole('button', {
          name: /Overrides “Engineering”/,
        });
        expect(overridesBtn).toBeInTheDocument();
        await user.click(overridesBtn);

        expect(mockOnClose).toHaveBeenCalled();
        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
          spaceId: 'space-1',
          tab: 'members',
        });
      } finally {
        window.removeEventListener(OPEN_SPACE_SETTINGS_EVENT, listener);
      }
    });
  });

  describe('General Access rows', () => {
    beforeEach(() => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
    });

    it('shows inherited workspace access and creates an override when its level changes', async () => {
      const user = userEvent.setup();
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'COMMENT',
        workspaceInherited: true,
        workspaceInheritedFromId: 'doc-parent',
        workspaceInheritedFromTitle: 'Parent Wiki',
      });
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'EDIT',
        workspaceInherited: false,
        workspaceInheritedFromId: 'doc-parent',
        workspaceInheritedFromTitle: 'Parent Wiki',
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

      expect(await screen.findByText('General Access')).toBeInTheDocument();
      expect(screen.getByText('Anyone in this workspace')).toBeInTheDocument();
      expect(screen.getByText('From “Parent Wiki”')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Workspace access level' })).toHaveTextContent(
        'Can comment'
      );

      await user.click(screen.getByRole('button', { name: 'Workspace access level' }));
      await user.click(screen.getByRole('option', { name: 'Can edit' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { workspaceAccessMode: 'WORKSPACE_MEMBERS', workspaceAccessLevel: 'EDIT' },
        'test-token'
      );
      expect(
        await screen.findByRole('button', { name: 'Overrides “Parent Wiki”' })
      ).toBeInTheDocument();
    });

    it('lets a page inside a public space block the space audience', async () => {
      const user = userEvent.setup();
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'EDIT',
        workspaceInherited: true,
        workspaceInheritedFromKind: 'SPACE',
        workspaceInheritedFromId: 'space-1',
        workspaceInheritedFromTitle: 'Engineering',
      });
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'EDIT',
        workspaceInheritBlocked: true,
        workspaceInheritedFromKind: 'SPACE',
        workspaceInheritedFromId: 'space-1',
        workspaceInheritedFromTitle: 'Engineering',
      });

      render(
        <SharePanel
          documentId="doc-in-space"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
          documentSpace={{
            id: 'space-1',
            name: 'Engineering',
            accessMode: 'PUBLIC',
            everyoneAccessLevel: 'EDIT',
            myAccessLevel: 'OWNER',
            canAdminister: true,
            archived: false,
          }}
        />
      );

      expect(await screen.findByText('From “Engineering”')).toBeInTheDocument();

      // A space is a permission container: the page may turn its audience off, which is
      // the same block a page under a shared ancestor uses.
      await user.click(screen.getByRole('button', { name: 'Workspace general access' }));
      await user.click(screen.getByRole('option', { name: 'Restricted' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-in-space',
        { workspaceAccessMode: 'RESTRICTED', workspaceInheritBlocked: true },
        'test-token'
      );
      expect(
        await screen.findByRole('button', { name: 'Blocked from “Engineering”' })
      ).toBeInTheDocument();
      expect(screen.getByText('Restricted')).toBeInTheDocument();
    });

    it('shows workspace and link rows with their own levels when both are active', async () => {
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: true,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'EDIT',
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

      expect(await screen.findByText('General Access')).toBeInTheDocument();
      expect(screen.getByText('Anyone in this workspace')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Anyone with the link' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Workspace access level' })).toHaveTextContent(
        'Can edit'
      );
      expect(screen.getByRole('button', { name: 'Can view' })).toBeInTheDocument();
      expect(screen.getByText('Everyone in this workspace can edit')).toBeInTheDocument();
      expect(screen.getByText('Anyone on the internet with the link can view')).toBeInTheDocument();
    });

    it('lets the link row add workspace access from its own dropdown', async () => {
      const user = userEvent.setup();
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: true,
      });
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: true,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'VIEW',
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

      await screen.findByRole('button', { name: 'Anyone with the link' });
      await user.click(screen.getByRole('button', { name: 'Anyone with the link' }));
      expect(screen.getByRole('option', { name: 'Anyone in this workspace' })).toBeInTheDocument();
      await user.click(screen.getByRole('option', { name: 'Anyone in this workspace' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { workspaceAccessMode: 'WORKSPACE_MEMBERS', workspaceAccessLevel: 'VIEW' },
        'test-token'
      );
      expect(await screen.findByText('Anyone in this workspace')).toBeInTheDocument();
      expect(screen.getByText('Everyone in this workspace can view')).toBeInTheDocument();
    });

    it('lets the workspace row add link access from its own dropdown', async () => {
      const user = userEvent.setup();
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'EDIT',
      });
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: true,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'EDIT',
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

      await screen.findByRole('button', { name: 'Workspace general access' });
      await user.click(screen.getByRole('button', { name: 'Workspace general access' }));
      expect(screen.getByRole('option', { name: 'Anyone with the link' })).toBeInTheDocument();
      await user.click(screen.getByRole('option', { name: 'Anyone with the link' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { generalAccessMode: 'ANYONE_WITH_LINK', linkAccessLevel: 'VIEW' },
        'test-token'
      );
      expect(
        await screen.findByRole('button', { name: 'Anyone with the link' })
      ).toBeInTheDocument();
      expect(screen.getByText('Anyone on the internet with the link can view')).toBeInTheDocument();
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
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'EDIT',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ]);

      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
      });
    });

    it('fetches both collaborators and sharing settings, and renders invite input and link access', async () => {
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
      expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

      await waitFor(() => {
        expect(screen.getByText('Doc Owner')).toBeInTheDocument();
        expect(screen.getByText('General Access')).toBeInTheDocument();
      });

      expect(screen.getByText('Doc Owner')).toBeInTheDocument();
      expect(screen.getByText('(you)')).toBeInTheDocument();
      expect(screen.getByText('Owner')).toBeInTheDocument();

      expect(screen.getByText('Bob Collab')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Can edit/i })).toBeInTheDocument();
      expect(screen.queryByLabelText('Remove collaborator')).not.toBeInTheDocument();
    });

    it('allows inviting a new collaborator with Owner access', async () => {
      const user = userEvent.setup();
      // The write answers with the recalculated list, including the invited row.
      (documentService.upsertCollaborator as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'EDIT',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-3',
          userId: 'user-3',
          email: 'charlie@example.com',
          displayName: 'Charlie New',
          accessLevel: 'OWNER',
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

      const emailInput = screen.getByPlaceholderText('Add people by email');
      await user.type(emailInput, 'charlie@example.com');

      const inviteContainer = emailInput.closest('div');
      expect(inviteContainer).not.toBeNull();
      const inviteDropdown = within(inviteContainer!).getByRole('button', { name: /Can edit/i });
      expect(inviteDropdown).toBeInTheDocument();

      await user.click(inviteDropdown);
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

      const newDetail = await screen.findByText('Added just now');
      const newRow = newDetail.closest('li');
      expect(newRow).toHaveTextContent('charlie@example.com');
    });

    it('allows changing collaborator access level', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'EDIT',
        },
      ]);
      // The mutation answers with the recalculated list, so the panel renders the
      // new level without following the write with a list request.
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'VIEW',
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

      // The mutation's own response carries the recalculated list, so the panel renders
      // the new level without asking for the list a second time.
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Can view/i })).toBeInTheDocument();
      });
      expect(documentService.listCollaborators).toHaveBeenCalledTimes(1);
    });

    it('serializes collaborator writes so an older roster cannot overwrite a newer one', async () => {
      const user = userEvent.setup();
      const roster = [
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'EDIT',
        },
      ];
      (documentService.listCollaborators as jest.Mock).mockResolvedValue(roster);
      const viewRoster = roster.map((collab) =>
        collab.userId === 'user-2' ? { ...collab, accessLevel: 'VIEW' } : collab
      );
      const commentRoster = roster.map((collab) =>
        collab.userId === 'user-2' ? { ...collab, accessLevel: 'COMMENT' } : collab
      );
      let releaseFirst: ((value: typeof roster) => void) | undefined;
      const firstWrite = new Promise<typeof roster>((resolve) => {
        releaseFirst = resolve;
      });
      (documentService.updateCollaboratorAccess as jest.Mock)
        .mockReturnValueOnce(firstWrite)
        .mockResolvedValueOnce(commentRoster);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      await screen.findByText('Bob Collab');
      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Can view' }));
      await waitFor(() => {
        expect(documentService.updateCollaboratorAccess).toHaveBeenCalledTimes(1);
      });

      // The roster still shows EDIT, so a second change queues behind the pending write.
      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Can comment' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledTimes(1);

      await act(async () => {
        releaseFirst?.(viewRoster);
        await firstWrite;
      });
      await waitFor(() => {
        expect(documentService.updateCollaboratorAccess).toHaveBeenCalledTimes(2);
      });
      expect(documentService.updateCollaboratorAccess).toHaveBeenNthCalledWith(
        2,
        'doc-1',
        'user-2',
        'COMMENT',
        'test-token'
      );
      // The second response is the newest state, not the queued write's own roster.
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Can comment/i })).toBeInTheDocument();
      });
    });

    it('drops a collaborator write queued for a document the panel has left', async () => {
      const user = userEvent.setup();
      const rosterA = [
        {
          id: 'collab-owner-a',
          userId: 'user-a',
          email: 'alice@example.com',
          displayName: 'Alice A',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-bob',
          userId: 'user-b',
          email: 'bob@example.com',
          displayName: 'Bob A',
          accessLevel: 'EDIT',
        },
      ];
      const rosterB = [
        {
          id: 'collab-owner-b',
          userId: 'user-c',
          email: 'cara@example.com',
          displayName: 'Cara B',
          accessLevel: 'OWNER',
        },
      ];
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce(rosterA)
        .mockResolvedValueOnce(rosterB);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'VIEW',
      });
      let releaseFirst: ((value: typeof rosterA) => void) | undefined;
      const firstWrite = new Promise<typeof rosterA>((resolve) => {
        releaseFirst = resolve;
      });
      (documentService.updateCollaboratorAccess as jest.Mock)
        .mockReturnValueOnce(firstWrite)
        .mockResolvedValueOnce(rosterA);

      const { rerender } = render(
        <SharePanel
          documentId="doc-a"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await screen.findByText('Bob A');
      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Can view' }));
      await waitFor(() =>
        expect(documentService.updateCollaboratorAccess).toHaveBeenCalledTimes(1)
      );

      // The first response has not landed, so a second change queues behind it.
      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Can comment' }));
      await act(async () => {
        await Promise.resolve();
      });
      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledTimes(1);

      rerender(
        <SharePanel
          documentId="doc-b"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await screen.findByText('Cara B');

      await act(async () => {
        releaseFirst?.(rosterA);
        await firstWrite;
      });
      await act(async () => {});

      // The queued write belonged to A; it must not run against the document now open.
      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Cara B')).toBeInTheDocument();
      expect(screen.queryByText('Bob A')).not.toBeInTheDocument();
    });

    it('drops a roster response that arrives after switching documents', async () => {
      const user = userEvent.setup();
      const rosterA = [
        {
          id: 'collab-owner-a',
          userId: 'user-a',
          email: 'alice@example.com',
          displayName: 'Alice A',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-bob',
          userId: 'user-b',
          email: 'bob@example.com',
          displayName: 'Bob A',
          accessLevel: 'EDIT',
        },
      ];
      const rosterB = [
        {
          id: 'collab-owner-b',
          userId: 'user-c',
          email: 'cara@example.com',
          displayName: 'Cara B',
          accessLevel: 'OWNER',
        },
      ];
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce(rosterA)
        .mockResolvedValueOnce(rosterB);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'VIEW',
      });
      let releaseUpdate: ((value: unknown[]) => void) | undefined;
      (documentService.updateCollaboratorAccess as jest.Mock).mockReturnValue(
        new Promise<unknown[]>((resolve) => {
          releaseUpdate = resolve;
        })
      );

      const { rerender } = render(
        <SharePanel
          documentId="doc-a"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await screen.findByText('Bob A');
      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Can view' }));
      await waitFor(() =>
        expect(documentService.updateCollaboratorAccess).toHaveBeenCalledTimes(1)
      );

      rerender(
        <SharePanel
          documentId="doc-b"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await screen.findByText('Cara B');

      await act(async () => {
        releaseUpdate?.(rosterA);
      });
      await act(async () => {});

      // The late roster belonged to A; it must not replace B's people list.
      expect(screen.getByText('Cara B')).toBeInTheDocument();
      expect(screen.queryByText('Alice A')).not.toBeInTheDocument();
      expect(screen.queryByText('Bob A')).not.toBeInTheDocument();
    });

    it('drops a settings save that resolves after switching documents', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock)
        .mockResolvedValueOnce({
          generalAccessMode: 'ANYONE_WITH_LINK',
          linkAccessLevel: 'VIEW',
          hasActiveLink: true,
          workspaceAccessMode: 'RESTRICTED',
          workspaceAccessLevel: 'VIEW',
        })
        .mockResolvedValueOnce({
          generalAccessMode: 'RESTRICTED',
          linkAccessLevel: 'VIEW',
          workspaceAccessMode: 'RESTRICTED',
          workspaceAccessLevel: 'VIEW',
        });
      let releaseSave: ((value: unknown) => void) | undefined;
      (documentService.updateSharingSettings as jest.Mock).mockReturnValue(
        new Promise<unknown>((resolve) => {
          releaseSave = resolve;
        })
      );

      const { rerender } = render(
        <SharePanel
          documentId="doc-a"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await user.click(await screen.findByRole('button', { name: 'Anyone with the link' }));
      await user.click(screen.getByRole('option', { name: 'Restricted' }));
      await waitFor(() => expect(documentService.updateSharingSettings).toHaveBeenCalledTimes(1));

      rerender(
        <SharePanel
          documentId="doc-b"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await waitFor(() =>
        expect(documentService.getSharingSettings).toHaveBeenCalledWith('doc-b', 'test-token')
      );

      await act(async () => {
        releaseSave?.({
          generalAccessMode: 'ANYONE_WITH_LINK',
          linkAccessLevel: 'VIEW',
          hasActiveLink: true,
          workspaceAccessMode: 'RESTRICTED',
          workspaceAccessLevel: 'VIEW',
        });
      });
      await act(async () => {});

      // B still shows its own Restricted link row, not A's late link answer.
      expect(screen.getByRole('button', { name: 'Restricted' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Anyone with the link' })
      ).not.toBeInTheDocument();
    });

    it('allows changing collaborator access level to Owner from dropdown', async () => {
      const user = userEvent.setup();
      const collaborators = [
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'EDIT',
        },
      ];
      (documentService.listCollaborators as jest.Mock).mockResolvedValue(collaborators);
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(collaborators);

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

      const ownerOption = screen.getByRole('option', { name: 'Owner' });
      expect(ownerOption).toBeInTheDocument();
      await user.click(ownerOption);

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-2',
        'OWNER',
        'test-token'
      );
    });

    it('allows demoting a direct Owner collaborator to Can edit', async () => {
      const user = userEvent.setup();
      const collaborators = [
        {
          id: 'collab-owner',
          userId: 'user-actual-owner',
          email: 'creator@example.com',
          displayName: 'Doc Creator',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob DirectOwner',
          accessLevel: 'OWNER',
          inherited: false,
        },
      ];
      (documentService.listCollaborators as jest.Mock).mockResolvedValue(collaborators);
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(collaborators);

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

      // The creator's OWNER row is editable too, so pick Bob's (pinned row first).
      const ownerDropdowns = screen.getAllByRole('button', { name: /Owner/i });
      expect(ownerDropdowns).toHaveLength(2);
      await user.click(ownerDropdowns[1]);

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

    it('lets the creator step down from their own full-access row', async () => {
      const user = userEvent.setup();
      const collaborators = [
        {
          id: 'collab-me',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Alice Chen',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-jonas',
          userId: 'user-2',
          email: 'jonas@example.com',
          displayName: 'Jonas Weber',
          accessLevel: 'OWNER',
          inherited: false,
        },
      ];
      (documentService.listCollaborators as jest.Mock).mockResolvedValue(collaborators);
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(collaborators);

      const accessChanged = jest.fn();
      window.addEventListener(DOCUMENT_ACCESS_CHANGED_EVENT, accessChanged);

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
        expect(screen.getByText('Alice Chen')).toBeInTheDocument();
      });

      // The viewer is pinned first; both full-access rows have a dropdown.
      await user.click(screen.getAllByRole('button', { name: /Owner/i })[0]);
      // The creator row is a level, not a removable membership: levels only. A second
      // owner means they can also hand the page over by leaving.
      expect(screen.queryByRole('option', { name: 'No access' })).not.toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Leave page' })).toBeInTheDocument();

      await user.click(screen.getByRole('option', { name: 'Can edit' }));

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-1',
        'EDIT',
        'test-token'
      );
      expect(accessChanged).toHaveBeenCalled();

      window.removeEventListener(DOCUMENT_ACCESS_CHANGED_EVENT, accessChanged);
    });

    it('lets the creator leave once another owner holds the page', async () => {
      const user = userEvent.setup();
      const roster = [
        {
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Alice Chen',
          accessLevel: 'OWNER',
          inherited: false,
        },
        {
          userId: 'user-2',
          email: 'jonas@example.com',
          displayName: 'Jonas Weber',
          accessLevel: 'OWNER',
          inherited: false,
        },
      ];
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce(roster)
        .mockRejectedValueOnce(new DocumentServiceApiError('gone', 404));
      (documentService.getMyAccess as jest.Mock).mockResolvedValueOnce({
        documentId: 'doc-1',
        allowed: false,
        accessLevel: null,
        owner: false,
      });
      (documentService.leaveSharedDocument as jest.Mock).mockResolvedValue(undefined);

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
        expect(screen.getByText('Alice Chen')).toBeInTheDocument();
      });
      await user.click(screen.getAllByRole('button', { name: /Owner/i })[0]);
      await user.click(screen.getByRole('option', { name: 'Leave page' }));

      expect(documentService.leaveSharedDocument).toHaveBeenCalledWith('doc-1', 'test-token');
      expect(mockOnClose).toHaveBeenCalled();
      expect(mockReplace).toHaveBeenCalledWith('/');
    });

    it('lets a non-admin remove themselves from their own row', async () => {
      const user = userEvent.setup();
      const roster = [
        {
          id: 'collab-me',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Alice Chen',
          accessLevel: 'EDIT',
          inherited: false,
        },
      ];
      (documentService.listCollaborators as jest.Mock).mockResolvedValue(roster);
      (documentService.leaveSharedDocument as jest.Mock).mockResolvedValue(undefined);

      const accessChanged = jest.fn();
      window.addEventListener(DOCUMENT_ACCESS_CHANGED_EVENT, accessChanged);

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
        expect(screen.getByText('Alice Chen')).toBeInTheDocument();
      });

      // This caller cannot write levels, so the menu holds the level they hold plus
      // the leave entry: removing yourself is not a sharing write.
      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Leave page' }));

      expect(documentService.leaveSharedDocument).toHaveBeenCalledWith('doc-1', 'test-token');
      await waitFor(() => {
        expect(accessChanged).toHaveBeenCalled();
      });
      expect(mockOnClose).not.toHaveBeenCalled();

      window.removeEventListener(DOCUMENT_ACCESS_CHANGED_EVENT, accessChanged);
    });

    it('closes the panel and leaves the page when the dropped grant was the only access', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce([
          {
            id: 'collab-me',
            userId: 'user-1',
            email: 'owner@example.com',
            displayName: 'Alice Chen',
            accessLevel: 'EDIT',
            inherited: false,
          },
        ])
        .mockRejectedValueOnce(
          new DocumentServiceApiError('The requested resource was not found.', 404)
        );
      (documentService.getMyAccess as jest.Mock).mockResolvedValueOnce({
        documentId: 'doc-1',
        allowed: false,
        accessLevel: null,
        owner: false,
      });
      (documentService.leaveSharedDocument as jest.Mock).mockResolvedValue(undefined);

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
        expect(screen.getByText('Alice Chen')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Leave page' }));

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      });
      expect(mockReplace).toHaveBeenCalledWith('/');
    });

    it('surfaces the refusal when the last owner tries to leave', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-me',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Alice Chen',
          accessLevel: 'OWNER',
          inherited: false,
        },
      ]);
      (documentService.leaveSharedDocument as jest.Mock).mockRejectedValue(
        new Error('Make another person a full-access collaborator before leaving this page.')
      );

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
        expect(screen.getByText('Alice Chen')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /Owner/i }));
      await user.click(screen.getByRole('option', { name: 'Leave page' }));

      expect(
        await screen.findByText(
          'Make another person a full-access collaborator before leaving this page.'
        )
      ).toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('allows overriding an inherited full-access collaborator', async () => {
      const user = userEvent.setup();
      const collaborators = [
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Creator',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-ancestor-owner',
          userId: 'user-ancestor',
          email: 'ancestor@example.com',
          displayName: 'Ancestor Owner',
          accessLevel: 'OWNER',
          inherited: true,
          inheritedFromTitle: 'Parent Doc',
          inheritedFromId: 'doc-parent',
        },
      ];
      (documentService.listCollaborators as jest.Mock).mockResolvedValue(collaborators);
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(collaborators);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      const groupButton = await screen.findByRole('button', { name: /From “Parent Doc”/ });
      expect(groupButton).toBeInTheDocument();
      await user.click(groupButton);

      expect(screen.getByText('Ancestor Owner')).toBeInTheDocument();

      // Any inherited grant - including OWNER - is overridable on a child. The
      // creator's own full-access row is editable too, so take the inherited one.
      const dropdowns = screen.getAllByRole('button', { name: /Owner/i });
      await user.click(dropdowns[1]);

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
        },
        {
          id: 'collab-ancestor-owner',
          userId: 'user-ancestor',
          email: 'ancestor@example.com',
          displayName: 'Ancestor Owner',
          accessLevel: 'OWNER',
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

      expect(screen.getByText('Overrides “Parent Doc”')).toBeInTheDocument();

      // Pinned creator row first, then the overriding collaborator's row.
      const dropdowns = screen.getAllByRole('button', { name: 'Owner' });
      await user.click(dropdowns[1]);

      expect(
        screen.getByRole('option', { name: 'Inherit from Parent Doc (owner)' })
      ).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Can edit' })).toBeInTheDocument();
    });

    it('allows removing direct collaborator by selecting "No access"', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'EDIT',
        },
      ]);
      // The recalculation drops the row the write just removed.
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
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

    it('offers one revoke entry per row instead of No access plus Remove', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'EDIT',
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

      await user.click(screen.getByRole('button', { name: /Can edit/i }));

      expect(screen.getByRole('option', { name: 'No access' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Remove' })).not.toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Leave page' })).not.toBeInTheDocument();
    });

    it('shows the stored access level in a collaborator dropdown', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Collab',
          accessLevel: 'VIEW',
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

      expect(screen.getByRole('button', { name: 'Can view' })).toBeInTheDocument();
    });

    it('lets a full-access collaborator acting as admin edit their own level', async () => {
      const user = userEvent.setup();
      const roster = [
        {
          id: 'collab-owner',
          userId: 'user-actual-owner',
          email: 'alice@example.com',
          displayName: 'Alice Owner',
          accessLevel: 'OWNER',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-1',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Actor OwnerCollab',
          accessLevel: 'OWNER',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-2',
          userId: 'user-2',
          email: 'bob@example.com',
          displayName: 'Bob Editor',
          accessLevel: 'EDIT',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ];
      (documentService.listCollaborators as jest.Mock).mockResolvedValue(roster);
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue(roster);

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

      // Both OWNER rows are editable: the caller's own (pinned first) and the
      // creator's. Bob stays an editor row.
      const ownerDropdowns = screen.getAllByRole('button', { name: /Owner/i });
      expect(ownerDropdowns).toHaveLength(2);
      expect(screen.getByRole('button', { name: /Can edit/i })).toBeInTheDocument();

      await user.click(ownerDropdowns[0]);
      await user.click(screen.getByRole('option', { name: 'Can view' }));

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-1',
        'VIEW',
        'test-token'
      );
    });

    it('lets a demoted hierarchy owner restore their own Owner row', async () => {
      const user = userEvent.setup();
      const demotedSelf = {
        id: 'collab-1',
        userId: 'user-1',
        email: 'owner@example.com',
        displayName: 'Actor Owner',
        accessLevel: 'EDIT',
        inheritedFromId: 'parent-1',
        inheritedFromTitle: 'Parent Doc',
        inheritedAccessLevel: 'OWNER',
      };
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([demotedSelf]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
      });
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue([
        { ...demotedSelf, accessLevel: 'OWNER' },
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

      await screen.findByText('Actor Owner');
      // The caller demoted themselves on this child but still owns the parent, so
      // their own row remains editable and can be restored to OWNER.
      await user.click(screen.getByRole('button', { name: 'Can edit' }));
      await user.click(screen.getByRole('option', { name: 'Owner' }));

      expect(documentService.updateCollaboratorAccess).toHaveBeenCalledWith(
        'doc-1',
        'user-1',
        'OWNER',
        'test-token'
      );
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
      expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
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

    it('calls onClose from the header button', async () => {
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

      await user.click(screen.getByRole('button', { name: 'Close' }));

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

    it('reports an expired link to a reader without asking them to update it', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: false,
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

      expect(await screen.findByText('The share link has expired')).toBeInTheDocument();
      expect(screen.queryByText(/update link access/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Can view' })).not.toBeInTheDocument();
    });

    it('hides the roster instead of erroring for readers without an identity grant', async () => {
      const { DocumentServiceApiError } = jest.requireActual('../../../services/document.service');
      (documentService.listCollaborators as jest.Mock).mockRejectedValue(
        new DocumentServiceApiError('Not found', 404)
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
        expect(documentService.listCollaborators).toHaveBeenCalled();
      });
      // Flush the pending 404 rejection so the roster-hidden state has
      // rendered before asserting absence.
      await act(async () => {});
      expect(screen.queryByText('Not found')).not.toBeInTheDocument();
    });
  });

  describe('Hierarchical access and provenance (Notion-style)', () => {
    it('shows a single inherited source as a flat row with source detail', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-owner',
          email: 'alice@example.com',
          displayName: 'Alice Owner',
          accessLevel: 'OWNER',
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
        expect(screen.getByText('Charlie Direct')).toBeInTheDocument();
      });

      const bobRow = screen.getByText('Bob Inherited').closest('li');
      expect(bobRow).toContainElement(screen.getByText('bob@example.com'));
      expect(within(bobRow!).getByText('From “Engineering Wiki”')).toBeInTheDocument();
      expect(screen.queryByText(/Document · 1 person/)).not.toBeInTheDocument();
      const charlieRow = screen.getByText('Charlie Direct').closest('li');
      expect(charlieRow).toContainElement(screen.getByText('charlie@example.com'));

      expect(screen.getByRole('button', { name: /Can edit/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Can view/i })).toBeInTheDocument();
      expect(screen.queryByLabelText('Remove collaborator')).not.toBeInTheDocument();
    });

    it('navigates to ancestor document when clicking override badge', async () => {
      const user = userEvent.setup();
      const mockNavigate = jest.fn();

      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-owner',
          email: 'owner@example.com',
          displayName: 'Owner',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-override',
          userId: 'user-bob',
          email: 'bob@example.com',
          displayName: 'Bob Overridden',
          accessLevel: 'VIEW',
          inherited: false,
          inheritedFromId: 'doc-parent',
          inheritedFromTitle: 'Parent Wiki',
          inheritedAccessLevel: 'EDIT',
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

      const overrideBadge = await screen.findByRole('button', {
        name: 'Overrides “Parent Wiki”',
      });
      expect(overrideBadge).toBeInTheDocument();
      await user.click(overrideBadge);

      expect(mockOnClose).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('doc-parent');
    });

    it('collapses and expands a source group', async () => {
      const user = userEvent.setup();

      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-inherited',
          userId: 'user-inherited',
          email: 'bob@example.com',
          displayName: 'Bob Inherited',
          accessLevel: 'EDIT',
          inherited: true,
          inheritedFromId: 'doc-parent',
          inheritedFromTitle: 'Product Docs',
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'collab-inherited-2',
          userId: 'user-inherited-2',
          email: 'carol@example.com',
          displayName: 'Carol Inherited',
          accessLevel: 'VIEW',
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
        />
      );

      const originGroup = await screen.findByRole('button', {
        name: /From “Product Docs”/,
      });
      expect(originGroup).toBeInTheDocument();
      expect(originGroup).toHaveTextContent('Document · 2 people');

      // Absence checks only mean something after the roster has loaded.
      expect(screen.queryByText(/Permissions inherited from/i)).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Collaborators with access to ancestor pages inherit access/i)
      ).not.toBeInTheDocument();

      expect(screen.queryByText('Bob Inherited')).not.toBeInTheDocument();
      await user.click(originGroup);
      expect(screen.getByText('Bob Inherited')).toBeInTheDocument();

      await user.click(originGroup);
      expect(screen.queryByText('Bob Inherited')).not.toBeInTheDocument();
    });

    it('allows overriding an inherited collaborator to a direct access level', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-inherited',
          userId: 'user-inherited',
          email: 'bob@example.com',
          displayName: 'Bob Inherited',
          accessLevel: 'EDIT',
          inherited: true,
          inheritedFromId: 'doc-parent',
          inheritedFromTitle: 'Parent Wiki',
          inheritedAccessLevel: 'EDIT',
        },
      ]);
      // The recalculated row is direct again, so it overrides the ancestor grant.
      (documentService.updateCollaboratorAccess as jest.Mock).mockResolvedValue([
        {
          id: 'collab-inherited',
          userId: 'user-inherited',
          email: 'bob@example.com',
          displayName: 'Bob Inherited',
          accessLevel: 'VIEW',
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

      const groupButton = await screen.findByRole('button', { name: /From “Parent Wiki”/ });
      await user.click(groupButton);

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
        expect(screen.getByText('Overrides “Parent Wiki”')).toBeInTheDocument();
      });
      expect(screen.queryByText('From “Parent Wiki”')).not.toBeInTheDocument();
    });

    it('marks an additional source and moves the row back to it on inherit', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-overridden',
          userId: 'user-bob',
          email: 'bob@example.com',
          displayName: 'Bob Overridden',
          accessLevel: 'VIEW',
          inherited: false,
          inheritedFromId: 'doc-parent',
          inheritedFromTitle: 'Design System',
          inheritedAccessLevel: 'EDIT',
        },
      ]);
      // Deleting the override uncovers the inherited row again.
      (documentService.removeCollaborator as jest.Mock).mockResolvedValue([
        {
          id: 'collab-overridden',
          userId: 'user-bob',
          email: 'bob@example.com',
          displayName: 'Bob Overridden',
          accessLevel: 'EDIT',
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
      expect(screen.getByText('Overrides “Design System”')).toBeInTheDocument();

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
        expect(screen.getByText('From “Design System”')).toBeInTheDocument();
      });
      expect(screen.queryByText('Overrides “Design System”')).not.toBeInTheDocument();

      const groupButton = screen.getByRole('button', { name: /From “Design System”/ });
      await user.click(groupButton);
      expect(screen.getByText('Bob Overridden')).toBeInTheDocument();
    });

    it('keeps blocked people out of the flat list and in a collapsed group', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([
        {
          id: 'collab-owner',
          userId: 'user-1',
          email: 'owner@example.com',
          displayName: 'Doc Owner',
          accessLevel: 'OWNER',
        },
        {
          id: 'collab-active',
          userId: 'user-2',
          email: 'alice@example.com',
          displayName: 'Alice Active',
          accessLevel: 'EDIT',
        },
        {
          id: 'collab-blocked',
          userId: 'user-3',
          email: 'bob@example.com',
          displayName: 'Bob Blocked',
          accessLevel: 'NO_ACCESS',
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

      await screen.findByText('Alice Active');

      await user.click(screen.getByRole('button', { name: /Blocked/ }));
      await screen.findByText('Bob Blocked');

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
        },
        {
          id: 'collab-blocked',
          userId: 'user-3',
          email: 'bob@example.com',
          displayName: 'Bob Blocked',
          accessLevel: 'NO_ACCESS',
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

      await user.click(await screen.findByRole('button', { name: /Blocked/ }));
      await screen.findByText('Bob Blocked');

      // The link provenance control replaces the description when needed.
      const viaButton = await screen.findByRole('button', { name: 'From “Parent Wiki”' });
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
          'Bob Blocked is blocked while signed in; anyone with the public link can still comment on this document.'
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

      await screen.findByRole('button', { name: 'From “Parent Wiki”' });
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

      await screen.findByRole('button', { name: 'From “Parent Wiki”' });
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
      await screen.findByRole('button', { name: 'From “Parent Wiki”' });
      expect(
        screen.queryByText('Anyone on the internet with the link can edit')
      ).not.toBeInTheDocument();
    });

    it('offers the generic Resume inheriting action when a blocked link has no visible source', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: false,
        inheritedFromId: null,
        inheritedFromTitle: null,
        linkInheritBlocked: true,
      });
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
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

      await user.click(await screen.findByRole('button', { name: 'Restricted' }));
      await user.click(screen.getByRole('option', { name: 'Resume inheriting' }));

      // Resuming inheritance clears the block; it must not enable an own link.
      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { generalAccessMode: 'RESTRICTED', linkInheritBlocked: false },
        'test-token'
      );
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

      await screen.findByRole('button', { name: 'From “Parent Wiki”' });
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

    it('blocks inheritance when Restricted is chosen on an override', async () => {
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
        linkAccessLevel: 'EDIT',
        hasActiveLink: false,
        inherited: false,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
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

      await screen.findByRole('button', { name: 'Overrides Parent Wiki' });
      await user.click(screen.getByRole('button', { name: 'Anyone with the link' }));
      await user.click(screen.getByRole('option', { name: 'Restricted' }));

      // Restricted must make the document private on the link channel, so the
      // ancestor grant is blocked; the Inherit option is what drops the override.
      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { generalAccessMode: 'RESTRICTED', linkInheritBlocked: true },
        'test-token'
      );
    });

    it('blocks the link channel when restricting a pure-own link with no visible ancestor', async () => {
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
      (documentService.updateSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'RESTRICTED',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: false,
        inheritedFromId: null,
        inheritedFromTitle: null,
        linkInheritBlocked: false,
      });

      render(
        <SharePanel
          documentId="doc-top"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      const modeButton = await screen.findByRole('button', { name: 'Anyone with the link' });
      await user.click(modeButton);
      await user.click(screen.getByRole('option', { name: 'Restricted' }));

      // The ancestor source can be redacted, so the client always sends the block;
      // the server clears it when nothing is left to shadow.
      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-top',
        { generalAccessMode: 'RESTRICTED', linkInheritBlocked: true },
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

      await screen.findByRole('button', { name: 'From “Parent Wiki”' });
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

    it('shows expired public link message and revives link on access level change', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: false,
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

      await screen.findByText('Link expired — update link access or re-enable to revive');

      const levelDropdown = screen.getByRole('button', { name: 'Can view' });
      await user.click(levelDropdown);
      await user.click(screen.getByRole('option', { name: 'Can edit' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-1',
        {
          generalAccessMode: 'ANYONE_WITH_LINK',
          linkAccessLevel: 'EDIT',
          clearLinkExpiresAt: true,
        },
        'test-token'
      );
    });

    it('clears expired own timestamp when overriding an inherited public link', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: false,
        inherited: true,
        inheritedFromId: 'doc-parent',
        inheritedFromTitle: 'Parent Wiki',
        linkExpiresAt: '2020-01-01T00:00:00Z',
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

      await screen.findByRole('button', { name: 'From “Parent Wiki”' });
      const levelDropdown = screen.getByRole('button', { name: 'Can view' });
      await user.click(levelDropdown);
      await user.click(screen.getByRole('option', { name: 'Can edit' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        {
          generalAccessMode: 'ANYONE_WITH_LINK',
          linkAccessLevel: 'EDIT',
          clearLinkExpiresAt: true,
        },
        'test-token'
      );
    });
  });

  describe('General access branch coverage', () => {
    const base = {
      generalAccessMode: 'RESTRICTED',
      linkAccessLevel: 'VIEW',
      workspaceAccessMode: 'RESTRICTED',
      workspaceAccessLevel: 'VIEW',
    };

    it('restores inherited workspace access instead of keeping an override', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'EDIT',
        workspaceInherited: false,
        workspaceInheritedFromId: 'doc-parent',
        workspaceInheritedFromTitle: 'Parent Wiki',
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

      await user.click(await screen.findByRole('button', { name: 'Workspace general access' }));
      await user.click(screen.getByRole('option', { name: 'Inherit from Parent Wiki' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { workspaceAccessMode: 'RESTRICTED', workspaceInheritBlocked: false },
        'test-token'
      );
    });

    it('does not rewrite the workspace mode when it is already enabled', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'EDIT',
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

      await user.click(await screen.findByRole('button', { name: 'Workspace general access' }));
      await user.click(screen.getByRole('option', { name: 'Anyone in this workspace' }));

      expect(documentService.updateSharingSettings).not.toHaveBeenCalled();
    });

    it('clears a workspace block when the link row enables workspace access', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        generalAccessMode: 'ANYONE_WITH_LINK',
        hasActiveLink: true,
        workspaceInheritBlocked: true,
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

      await user.click(await screen.findByRole('button', { name: 'Anyone with the link' }));
      await user.click(screen.getByRole('option', { name: 'Anyone in this workspace' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-1',
        {
          workspaceAccessMode: 'WORKSPACE_MEMBERS',
          workspaceAccessLevel: 'VIEW',
          workspaceInheritBlocked: false,
        },
        'test-token'
      );
    });

    it('revives an expired link without a stored level using the default level', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: null,
        hasActiveLink: false,
        inherited: false,
        linkExpiresAt: '2020-01-01T00:00:00Z',
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'VIEW',
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

      await user.click(await screen.findByRole('button', { name: 'Anyone with the link' }));
      await user.click(screen.getByRole('option', { name: /^Anyone with the link/i }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-1',
        {
          generalAccessMode: 'ANYONE_WITH_LINK',
          linkAccessLevel: 'VIEW',
          clearLinkExpiresAt: true,
        },
        'test-token'
      );
    });

    it('does not rewrite the workspace mode when it is already restricted', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        workspaceInheritBlocked: true,
        workspaceInheritedFromId: 'doc-parent',
        workspaceInheritedFromTitle: 'Parent Wiki',
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

      await user.click(await screen.findByRole('button', { name: 'Workspace general access' }));
      await user.click(screen.getByRole('option', { name: 'Restricted' }));

      expect(documentService.updateSharingSettings).not.toHaveBeenCalled();
    });

    it('blocks an inherited workspace audience when Restricted is chosen', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        workspaceAccessLevel: 'EDIT',
        workspaceInherited: true,
        workspaceInheritedFromId: 'doc-parent',
        workspaceInheritedFromTitle: 'Parent Wiki',
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

      await user.click(await screen.findByRole('button', { name: 'Workspace general access' }));
      await user.click(screen.getByRole('option', { name: 'Restricted' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { workspaceAccessMode: 'RESTRICTED', workspaceInheritBlocked: true },
        'test-token'
      );
    });

    it('does not rewrite a link that is already blocked', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        linkInheritBlocked: true,
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

      await user.click(await screen.findByRole('button', { name: 'Restricted' }));
      await user.click(screen.getByRole('option', { name: 'Restricted' }));

      expect(documentService.updateSharingSettings).not.toHaveBeenCalled();
    });

    it('blocks when only the ancestor id marks the workspace source', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'EDIT',
        workspaceInherited: false,
        workspaceInheritedFromId: 'doc-parent',
        workspaceInheritedFromTitle: 'Parent Wiki',
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

      await user.click(await screen.findByRole('button', { name: 'Workspace general access' }));
      await user.click(screen.getByRole('option', { name: 'Restricted' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-child',
        { workspaceAccessMode: 'RESTRICTED', workspaceInheritBlocked: true },
        'test-token'
      );
    });

    it('blocks the workspace audience even when no ancestor metadata is visible', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'EDIT',
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

      await user.click(await screen.findByRole('button', { name: 'Workspace general access' }));
      await user.click(screen.getByRole('option', { name: 'Restricted' }));

      expect(documentService.updateSharingSettings).toHaveBeenCalledWith(
        'doc-1',
        { workspaceAccessMode: 'RESTRICTED', workspaceInheritBlocked: true },
        'test-token'
      );
    });

    it('falls back to view when the workspace level has no action label', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'CUSTOM' as never,
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

      expect(await screen.findByText('Everyone in this workspace can view')).toBeInTheDocument();
    });

    it('renders a source badge as static when it has only a title', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'EDIT',
        workspaceInheritedFromTitle: 'Parent Wiki',
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

      expect(await screen.findByText('Overrides “Parent Wiki”')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Overrides “Parent Wiki”' })).toBeNull();
    });

    it('explains a blocked workspace row', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        workspaceInheritBlocked: true,
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

      expect(await screen.findByText('Only people with access can open')).toBeInTheDocument();
    });

    it('defaults an active link level to Can view when the server omits it', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: null,
        hasActiveLink: true,
        workspaceAccessMode: 'RESTRICTED',
        workspaceAccessLevel: 'VIEW',
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

      expect(await screen.findByRole('button', { name: 'Can view' })).toBeInTheDocument();
    });

    it('uses the space as the inherited link source when the ancestor id is absent', async () => {
      const user = userEvent.setup();
      const listener = jest.fn();
      window.addEventListener(OPEN_SPACE_SETTINGS_EVENT, listener);

      try {
        (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
        (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
          ...base,
          inherited: true,
          inheritedFromId: null,
          inheritedFromTitle: 'Engineering',
        });

        render(
          <SharePanel
            documentId="doc-in-space"
            isOpen={true}
            onClose={mockOnClose}
            anchorRef={anchorRef}
            canManageSharing={true}
            documentSpace={{
              id: 'space-1',
              name: 'Engineering',
              accessMode: 'PUBLIC',
              everyoneAccessLevel: 'VIEW',
              myAccessLevel: 'OWNER',
              canAdminister: true,
              archived: false,
            }}
          />
        );

        await user.click(await screen.findByRole('button', { name: 'From “Engineering”' }));

        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
          spaceId: 'space-1',
          tab: 'members',
        });
      } finally {
        window.removeEventListener(OPEN_SPACE_SETTINGS_EVENT, listener);
      }
    });

    it('renders an inherited source badge as static when no source id exists', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...base,
        inherited: true,
        inheritedFromId: null,
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

      expect(await screen.findByText('From “Parent Wiki”')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'From “Parent Wiki”' })).not.toBeInTheDocument();
    });
  });

  describe('Refresh and failure paths', () => {
    const selfRoster = [
      {
        id: 'collab-me',
        userId: 'user-1',
        email: 'owner@example.com',
        displayName: 'Alice Chen',
        accessLevel: 'EDIT',
        inherited: false,
      },
    ];

    const baseSettings = {
      generalAccessMode: 'RESTRICTED',
      linkAccessLevel: 'VIEW',
      workspaceAccessMode: 'RESTRICTED',
      workspaceAccessLevel: 'VIEW',
    };

    it('warns instead of closing when the roster cannot be reloaded after leaving', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce(selfRoster)
        .mockRejectedValueOnce(new Error('refresh failed'));
      (documentService.leaveSharedDocument as jest.Mock).mockResolvedValue(undefined);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );
      await screen.findByText('Alice Chen');
      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Leave page' }));

      expect(
        await screen.findByText('You left the page, but its people list could not be refreshed.')
      ).toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();
    });

    it('uses a fallback when leaving fails with a non-Error value', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue(selfRoster);
      (documentService.leaveSharedDocument as jest.Mock).mockRejectedValue('offline');

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );
      await screen.findByText('Alice Chen');
      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Leave page' }));

      expect(await screen.findByText('Failed to leave page')).toBeInTheDocument();
    });

    it('surfaces a settings write failure', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        generalAccessMode: 'ANYONE_WITH_LINK',
        hasActiveLink: true,
      });
      (documentService.updateSharingSettings as jest.Mock).mockRejectedValue(
        new Error('Settings failed')
      );

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await user.click(await screen.findByRole('button', { name: 'Can view' }));
      await user.click(screen.getByRole('option', { name: 'Can edit' }));

      expect(await screen.findByText('Settings failed')).toBeInTheDocument();
    });

    it('uses a fallback message when a settings write fails with a non-Error value', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        generalAccessMode: 'ANYONE_WITH_LINK',
        hasActiveLink: true,
      });
      (documentService.updateSharingSettings as jest.Mock).mockRejectedValue('offline');

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await user.click(await screen.findByRole('button', { name: 'Can view' }));
      await user.click(screen.getByRole('option', { name: 'Can edit' }));

      expect(await screen.findByText('Failed to update link access')).toBeInTheDocument();
    });

    it('opens an inherited workspace source page', async () => {
      const user = userEvent.setup();
      const mockNavigate = jest.fn();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        workspaceAccessLevel: 'EDIT',
        workspaceInherited: true,
        workspaceInheritedFromId: 'doc-parent',
        workspaceInheritedFromTitle: 'Parent Wiki',
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

      await user.click(await screen.findByRole('button', { name: 'From “Parent Wiki”' }));

      expect(mockOnClose).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith('doc-parent');
    });

    it('opens the inherited workspace source space settings', async () => {
      const user = userEvent.setup();
      const listener = jest.fn();
      window.addEventListener(OPEN_SPACE_SETTINGS_EVENT, listener);

      try {
        (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
        (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
          ...baseSettings,
          workspaceAccessLevel: 'EDIT',
          workspaceInherited: true,
          workspaceInheritedFromKind: 'SPACE',
          workspaceInheritedFromId: 'space-1',
          workspaceInheritedFromTitle: 'Engineering',
        });

        render(
          <SharePanel
            documentId="doc-in-space"
            isOpen={true}
            onClose={mockOnClose}
            anchorRef={anchorRef}
            canManageSharing={true}
          />
        );

        await user.click(await screen.findByRole('button', { name: 'From “Engineering”' }));

        expect(mockOnClose).toHaveBeenCalled();
        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
          spaceId: 'space-1',
          tab: 'general',
        });
      } finally {
        window.removeEventListener(OPEN_SPACE_SETTINGS_EVENT, listener);
      }
    });

    it('skips the hidden-sources probe when the service does not expose it', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      const original = documentService.hasHiddenSharingSources;
      (
        documentService as unknown as { hasHiddenSharingSources?: unknown }
      ).hasHiddenSharingSources = undefined;

      try {
        render(
          <SharePanel
            documentId="doc-1"
            isOpen={true}
            onClose={mockOnClose}
            anchorRef={anchorRef}
            canManageSharing={false}
          />
        );
        await waitFor(() => expect(documentService.listCollaborators).toHaveBeenCalled());
      } finally {
        (
          documentService as unknown as { hasHiddenSharingSources?: unknown }
        ).hasHiddenSharingSources = original;
      }
    });

    it('drops a hidden-sources answer that arrives after unmount', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      let resolveHidden: (value: boolean) => void = () => {};
      (documentService.hasHiddenSharingSources as jest.Mock).mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveHidden = resolve;
        })
      );

      const { unmount } = render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );
      await waitFor(() => expect(documentService.listCollaborators).toHaveBeenCalled());

      unmount();
      resolveHidden(true);
      await act(async () => {});
    });

    it('drops document A’s late visibility probe after switching to document B', async () => {
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue(baseSettings);
      let resolveA: (value: boolean) => void = () => {};
      (documentService.hasHiddenSharingSources as jest.Mock).mockImplementation((docId: string) =>
        docId === 'doc-a'
          ? new Promise<boolean>((resolve) => {
              resolveA = resolve;
            })
          : Promise.resolve(false)
      );

      const { rerender } = render(
        <SharePanel
          documentId="doc-a"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );
      await waitFor(() =>
        expect(documentService.hasHiddenSharingSources).toHaveBeenCalledWith('doc-a', 'test-token')
      );

      rerender(
        <SharePanel
          documentId="doc-b"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );
      await waitFor(() =>
        expect(documentService.hasHiddenSharingSources).toHaveBeenCalledWith('doc-b', 'test-token')
      );

      await act(async () => {
        resolveA(true);
      });
      await act(async () => {});

      expect(
        screen.queryByText('Others may have access through locations you can’t view.')
      ).not.toBeInTheDocument();
    });

    it('keeps the page open after leave when roster is withheld but content remains readable via link', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock)
        .mockResolvedValueOnce(selfRoster)
        .mockRejectedValueOnce(new DocumentServiceApiError('Not found', 404));
      (documentService.getMyAccess as jest.Mock).mockResolvedValueOnce({
        documentId: 'doc-1',
        allowed: true,
        accessLevel: 'VIEW',
        owner: false,
      });
      (documentService.leaveSharedDocument as jest.Mock).mockResolvedValue(undefined);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={false}
        />
      );

      await screen.findByText('Alice Chen');
      await user.click(screen.getByRole('button', { name: /Can edit/i }));
      await user.click(screen.getByRole('option', { name: 'Leave page' }));

      await waitFor(() =>
        expect(documentService.getMyAccess).toHaveBeenCalledWith('doc-1', 'test-token')
      );
      expect(screen.queryByText('Alice Chen')).not.toBeInTheDocument();
      expect(mockOnClose).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('dispatches access-changed even if the panel closes before self-demotion or leave resolves', async () => {
      const user = userEvent.setup();
      let resolveUpdate: (value: unknown[]) => void = () => {};
      (documentService.listCollaborators as jest.Mock).mockResolvedValue(selfRoster);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue(baseSettings);
      (documentService.updateCollaboratorAccess as jest.Mock).mockReturnValue(
        new Promise<unknown[]>((resolve) => {
          resolveUpdate = resolve;
        })
      );

      const accessChanged = jest.fn();
      window.addEventListener(DOCUMENT_ACCESS_CHANGED_EVENT, accessChanged);

      try {
        const { rerender } = render(
          <SharePanel
            documentId="doc-1"
            isOpen={true}
            onClose={mockOnClose}
            anchorRef={anchorRef}
            canManageSharing={true}
          />
        );
        await screen.findByText('Alice Chen');
        await user.click(screen.getByRole('button', { name: /Can edit/i }));
        await user.click(screen.getByRole('option', { name: 'Can view' }));

        rerender(
          <SharePanel
            documentId="doc-1"
            isOpen={false}
            onClose={mockOnClose}
            anchorRef={anchorRef}
            canManageSharing={true}
          />
        );

        await act(async () => {
          resolveUpdate([]);
        });

        expect(accessChanged).toHaveBeenCalledTimes(1);
        expect((accessChanged.mock.calls[0][0] as CustomEvent).detail).toEqual({
          documentId: 'doc-1',
        });
      } finally {
        window.removeEventListener(DOCUMENT_ACCESS_CHANGED_EVENT, accessChanged);
      }
    });

    it('prevents a stale in-flight load from overwriting a roster installed by a collaborator write', async () => {
      const user = userEvent.setup();
      let resolveLoad: (value: unknown[]) => void = () => {};
      const invitedRoster = [
        {
          id: 'collab-bob',
          userId: 'user-bob',
          email: 'bob@example.com',
          displayName: 'Bob Smith',
          accessLevel: 'EDIT',
          inherited: false,
        },
      ];
      (documentService.listCollaborators as jest.Mock).mockReturnValueOnce(
        new Promise<unknown[]>((resolve) => {
          resolveLoad = resolve;
        })
      );
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue(baseSettings);
      (documentService.upsertCollaborator as jest.Mock).mockResolvedValueOnce(invitedRoster);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await waitFor(() => expect(documentService.listCollaborators).toHaveBeenCalledTimes(1));

      // Invite Bob while the initial load is still in flight (same effect, not cancelled)
      const input = screen.getByPlaceholderText('Add people by email');
      await user.type(input, 'bob@example.com');
      await user.click(screen.getByRole('button', { name: 'Add' }));
      await waitFor(() => expect(documentService.upsertCollaborator).toHaveBeenCalled());

      // Now the earlier load finishes with a stale roster: Bob must remain installed
      await act(async () => {
        resolveLoad([
          {
            id: 'collab-stale',
            userId: 'user-stale',
            email: 'stale@example.com',
            displayName: 'Stale User',
            accessLevel: 'EDIT',
            inherited: false,
          },
        ]);
      });

      expect(await screen.findByText('Bob Smith')).toBeInTheDocument();
      expect(screen.queryByText('Stale User')).not.toBeInTheDocument();
    });

    it('prevents a stale in-flight load from overwriting settings saved by updateSharingSettings', async () => {
      const user = userEvent.setup();
      let resolveSecondLoad: (value: unknown) => void = () => {};
      let resolveSave: (value: unknown) => void = () => {};
      const publicSettings = {
        ...baseSettings,
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: true,
      };
      const editedSettings = {
        ...publicSettings,
        linkAccessLevel: 'EDIT',
      };
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock)
        .mockResolvedValueOnce(publicSettings)
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveSecondLoad = resolve;
          })
        );
      (documentService.updateSharingSettings as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveSave = resolve;
        })
      );

      const { rerender } = render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await screen.findByRole('button', { name: 'Can view' });

      await user.click(screen.getByRole('button', { name: 'Can view' }));
      await user.click(screen.getByRole('option', { name: 'Can edit' }));
      await waitFor(() => expect(documentService.updateSharingSettings).toHaveBeenCalledTimes(1));

      // Trigger a second load (e.g. token refresh) before the save resolves
      (useAuth as jest.Mock).mockReturnValue({
        isAuthenticated: true,
        accessToken: 'test-token-2',
        user: defaultUser,
      });
      rerender(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      await waitFor(() => expect(documentService.getSharingSettings).toHaveBeenCalledTimes(2));

      await act(async () => {
        resolveSave(editedSettings);
      });
      await act(async () => {
        resolveSecondLoad(publicSettings);
      });

      expect(await screen.findByRole('button', { name: 'Can edit' })).toBeInTheDocument();
    });

    it('queues the invite when Enter is pressed in the email field', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue(baseSettings);
      (documentService.upsertCollaborator as jest.Mock).mockResolvedValue([]);

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      const input = await screen.findByPlaceholderText('Add people by email');
      await user.type(input, 'bob@example.com');
      fireEvent.keyDown(input, { key: 'Enter' });

      await waitFor(() =>
        expect(documentService.upsertCollaborator).toHaveBeenCalledWith(
          'doc-1',
          { email: 'bob@example.com', accessLevel: 'EDIT' },
          'test-token'
        )
      );
    });

    it('shows the saving marker while an invite is in flight', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue(baseSettings);
      let resolveInvite: (value: unknown[]) => void = () => {};
      (documentService.upsertCollaborator as jest.Mock).mockReturnValue(
        new Promise<unknown[]>((resolve) => {
          resolveInvite = resolve;
        })
      );

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );
      const input = await screen.findByPlaceholderText('Add people by email');
      await user.type(input, 'bob@example.com');
      await user.click(screen.getByRole('button', { name: 'Add' }));

      await waitFor(() => {
        const addButton = screen.getByRole('button', { name: 'Add' });
        expect(addButton).toBeDisabled();
        expect(addButton).toHaveTextContent('…');
      });
      resolveInvite([]);
      await act(async () => {});
    });

    it('serializes settings saves and preserves saving state until the write completes', async () => {
      const user = userEvent.setup();
      (documentService.listCollaborators as jest.Mock).mockResolvedValue([]);
      (documentService.getSharingSettings as jest.Mock).mockResolvedValue({
        ...baseSettings,
        workspaceAccessMode: 'WORKSPACE_MEMBERS',
        workspaceAccessLevel: 'VIEW',
        generalAccessMode: 'ANYONE_WITH_LINK',
        linkAccessLevel: 'VIEW',
        hasActiveLink: true,
      });

      let resolveFirst: (value: unknown) => void = () => {};
      (documentService.updateSharingSettings as jest.Mock).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
      );

      render(
        <SharePanel
          documentId="doc-1"
          isOpen={true}
          onClose={mockOnClose}
          anchorRef={anchorRef}
          canManageSharing={true}
        />
      );

      const workspaceLevelBtn = await screen.findByRole('button', {
        name: 'Workspace access level',
      });
      await user.click(workspaceLevelBtn);
      const workspaceEditOption = screen.getByRole('option', { name: 'Can edit' });
      fireEvent.click(workspaceEditOption);
      await waitFor(() => expect(documentService.updateSharingSettings).toHaveBeenCalledTimes(1));

      expect(screen.getByRole('button', { name: 'Anyone with the link' })).toBeDisabled();

      await act(async () => {
        resolveFirst({
          ...baseSettings,
          workspaceAccessMode: 'WORKSPACE_MEMBERS',
          workspaceAccessLevel: 'EDIT',
          generalAccessMode: 'ANYONE_WITH_LINK',
          linkAccessLevel: 'VIEW',
          hasActiveLink: true,
        });
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Workspace access level' })).toHaveTextContent(
          'Can edit'
        );
      });
      expect(screen.getByRole('button', { name: 'Anyone with the link' })).toBeEnabled();
    });
  });
});
