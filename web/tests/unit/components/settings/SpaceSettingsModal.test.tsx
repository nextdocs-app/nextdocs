import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SpaceSettingsModal } from '../../../../components/settings/workspace/SpaceSettingsModal';
import { ApiError } from '../../../../services/api-client';
import { spaceApiService } from '../../../../services/space.service';
import { workspaceApiService } from '../../../../services/workspace.service';
import type { Space, SpaceMember } from '../../../../types/space.types';
import type { WorkspaceMember } from '../../../../types/workspace.types';

jest.mock('../../../../services/space.service', () => ({
  spaceApiService: {
    update: jest.fn(),
    get: jest.fn(),
    uploadIcon: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    remove: jest.fn(),
    listMembers: jest.fn(),
    addMember: jest.fn(),
    updateMemberAccess: jest.fn(),
    removeMember: jest.fn(),
  },
}));
jest.mock('../../../../services/workspace.service', () => ({
  workspaceApiService: { listMembers: jest.fn() },
}));
jest.mock('../../../../components/page/IconPickerPanel', () => ({
  IconPickerPanel: ({
    panelRef,
    onSelect,
    onRemove,
    canUpload,
    uploadFile,
  }: {
    panelRef?: React.RefObject<HTMLDivElement | null>;
    onSelect: (icon: { type: string; value: string }) => void;
    onRemove: () => void;
    canUpload: boolean;
    uploadFile?: (file: File) => Promise<{ id: string }>;
  }) => (
    <div ref={panelRef}>
      <button type="button" onClick={() => onSelect({ type: 'emoji', value: '🚀' })}>
        Pick rocket
      </button>
      <button type="button" onClick={onRemove}>
        Clear icon
      </button>
      {canUpload && uploadFile ? (
        <button
          type="button"
          onClick={() =>
            void uploadFile(new File(['icon'], 'icon.png', { type: 'image/png' })).then(
              (uploaded) => onSelect({ type: 'upload', value: uploaded.id })
            )
          }
        >
          Upload a custom icon
        </button>
      ) : null}
    </div>
  ),
}));

const update = spaceApiService.update as jest.Mock;
const getSpace = spaceApiService.get as jest.Mock;
const uploadIcon = spaceApiService.uploadIcon as jest.Mock;
const archive = spaceApiService.archive as jest.Mock;
const restore = spaceApiService.restore as jest.Mock;
const remove = spaceApiService.remove as jest.Mock;
const listSpaceMembers = spaceApiService.listMembers as jest.Mock;
const addMember = spaceApiService.addMember as jest.Mock;
const updateMemberAccess = spaceApiService.updateMemberAccess as jest.Mock;
const removeMember = spaceApiService.removeMember as jest.Mock;
const listWorkspaceMembers = workspaceApiService.listMembers as jest.Mock;

const space: Space = {
  id: 'space-1',
  name: 'Design',
  icon: null,
  accessMode: 'CUSTOM',
  everyoneAccessLevel: 'VIEW',
  myAccessLevel: 'OWNER',
  canAdminister: true,
  memberCount: 2,
  pageCount: 4,
  archivedAt: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-02T00:00:00Z',
};

const adaMember: SpaceMember = {
  userId: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada Owner',
  avatarUrl: null,
  accessLevel: 'OWNER',
  addedAt: '2026-05-01T00:00:00Z',
};

const graceMember: SpaceMember = {
  userId: 'user-2',
  email: 'grace@example.com',
  displayName: 'Grace Editor',
  avatarUrl: null,
  accessLevel: 'EDIT',
  addedAt: '2026-05-04T00:00:00Z',
};

const adaWorkspaceMember: WorkspaceMember = {
  userId: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada Owner',
  avatarUrl: null,
  role: 'OWNER',
  joinedAt: '2026-01-05T00:00:00Z',
};

const graceWorkspaceMember: WorkspaceMember = {
  userId: 'user-2',
  email: 'grace@example.com',
  displayName: 'Grace Editor',
  avatarUrl: null,
  role: 'MEMBER',
  joinedAt: '2026-03-20T00:00:00Z',
};

function renderModal({
  spaceOverride = space,
  selfId = 'user-1',
  initialTab,
}: {
  spaceOverride?: Space;
  selfId?: string | null;
  initialTab?: 'general' | 'members';
} = {}) {
  const onClose = jest.fn();
  const onSpaceChange = jest.fn();
  const onSpaceRemoved = jest.fn();
  const onNotice = jest.fn();

  render(
    <SpaceSettingsModal
      space={spaceOverride}
      initialTab={initialTab}
      accessToken="token-1"
      selfId={selfId}
      onClose={onClose}
      onSpaceChange={onSpaceChange}
      onSpaceRemoved={onSpaceRemoved}
      onNotice={onNotice}
    />
  );

  return { onClose, onSpaceChange, onSpaceRemoved, onNotice };
}

beforeEach(() => {
  jest.clearAllMocks();
  listSpaceMembers.mockResolvedValue([adaMember, graceMember]);
  listWorkspaceMembers.mockResolvedValue([adaWorkspaceMember, graceWorkspaceMember]);
});

describe('SpaceSettingsModal', () => {
  it('renders the default layers icon for a space', () => {
    renderModal({ spaceOverride: { ...space, icon: null } });

    const iconButton = screen.getByRole('button', { name: 'Add a space icon' });
    expect(iconButton.querySelector('svg')?.querySelectorAll('path')).toHaveLength(3);
  });

  it('shows the space identity, its counts, and the access choices', () => {
    renderModal();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Space name')).toHaveValue('Design');
    expect(screen.getByText('2 members · 4 documents')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Custom/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Public/ })).not.toBeChecked();
  });

  it('renames the space on Enter and reports the saved copy', async () => {
    const user = userEvent.setup();
    update.mockResolvedValue({ ...space, name: 'Platform' });
    const { onSpaceChange } = renderModal();

    const input = screen.getByLabelText('Space name');
    await user.clear(input);
    await user.type(input, 'Platform{Enter}');

    expect(update).toHaveBeenCalledWith('token-1', 'space-1', { name: 'Platform' });
    expect(onSpaceChange).toHaveBeenCalledWith({ ...space, name: 'Platform' });
  });

  it('shares the space with the workspace and saves the everyone level', async () => {
    const user = userEvent.setup();
    update.mockResolvedValue({
      ...space,
      accessMode: 'PUBLIC',
      everyoneAccessLevel: 'VIEW',
    });
    renderModal();

    await user.click(screen.getByRole('radio', { name: /Public/ }));

    expect(update).toHaveBeenCalledWith('token-1', 'space-1', {
      accessMode: 'PUBLIC',
      everyoneAccessLevel: 'VIEW',
    });
    expect(
      await screen.findByText(
        'Every workspace member can read the documents in this space. People listed in Members keep their level.'
      )
    ).toBeInTheDocument();

    update.mockResolvedValue({
      ...space,
      accessMode: 'PUBLIC',
      everyoneAccessLevel: 'EDIT',
    });
    await user.click(
      screen.getByRole('button', { name: 'Everyone access in this space: Can view' })
    );
    await user.click(screen.getByRole('option', { name: 'Can edit' }));

    expect(update).toHaveBeenLastCalledWith('token-1', 'space-1', {
      accessMode: 'PUBLIC',
      everyoneAccessLevel: 'EDIT',
    });
  });

  it('saves a picked icon', async () => {
    const user = userEvent.setup();
    update.mockResolvedValue({
      ...space,
      icon: { type: 'emoji', value: '🚀' },
    });
    const { onSpaceChange } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Add a space icon' }));
    await user.click(screen.getByRole('button', { name: 'Pick rocket' }));

    expect(update).toHaveBeenCalledWith('token-1', 'space-1', {
      icon: { type: 'emoji', value: '🚀' },
    });
    await waitFor(() =>
      expect(onSpaceChange).toHaveBeenCalledWith({
        ...space,
        icon: { type: 'emoji', value: '🚀' },
      })
    );
  });

  it('uploads an image and adopts it as the icon', async () => {
    const user = userEvent.setup();
    const uploadedIcon = { type: 'upload', value: 'upload-1' };
    uploadIcon.mockResolvedValue({ id: 'upload-1' });
    update.mockResolvedValue({ ...space, icon: uploadedIcon });
    const { onSpaceChange } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Add a space icon' }));
    await user.click(screen.getByRole('button', { name: 'Upload a custom icon' }));

    await waitFor(() => expect(uploadIcon).toHaveBeenCalledWith('token-1', expect.any(File)));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('token-1', 'space-1', { icon: uploadedIcon })
    );
    await waitFor(() =>
      expect(onSpaceChange).toHaveBeenCalledWith({ ...space, icon: uploadedIcon })
    );
  });

  it('lists the roster and leaves the last owner without a level menu', async () => {
    const user = userEvent.setup();
    listSpaceMembers.mockResolvedValue([adaMember]);
    const { onSpaceChange } = renderModal();

    await user.click(screen.getByRole('tab', { name: 'Members' }));

    expect(await screen.findByText('Ada Owner')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Access level for Ada Owner' })
    ).not.toBeInTheDocument();
    await waitFor(() => expect(onSpaceChange).toHaveBeenCalledWith({ ...space, memberCount: 1 }));
  });

  it("changes a member's access level", async () => {
    const user = userEvent.setup();
    updateMemberAccess.mockResolvedValue([{ ...graceMember, accessLevel: 'COMMENT' }, adaMember]);
    renderModal();

    await user.click(screen.getByRole('tab', { name: 'Members' }));
    await user.click(await screen.findByRole('button', { name: 'Access level for Grace Editor' }));
    await user.click(screen.getByRole('option', { name: 'Can comment' }));

    expect(updateMemberAccess).toHaveBeenCalledWith('token-1', 'space-1', 'user-2', 'COMMENT');
  });

  it('adds a workspace member from the add-members popover', async () => {
    const user = userEvent.setup();
    listSpaceMembers.mockResolvedValue([adaMember]);
    addMember.mockResolvedValue([adaMember, graceMember]);
    renderModal();

    await user.click(screen.getByRole('tab', { name: 'Members' }));
    await screen.findByText('Ada Owner');
    await user.click(screen.getByRole('button', { name: 'Add members' }));

    const popover = await screen.findByRole('dialog', { name: 'Add members' });
    await user.type(within(popover).getByLabelText('Search workspace members'), 'grace');
    await user.click(await within(popover).findByRole('button', { name: 'Add Grace Editor' }));

    expect(addMember).toHaveBeenCalledWith('token-1', 'space-1', 'grace@example.com', 'VIEW');
    expect(within(popover).getByRole('status')).toHaveTextContent(
      'Grace Editor added to this space.'
    );
    expect(await screen.findByText('Grace Editor')).toBeInTheDocument();
  });

  it('shows suggestions only after a single typed character', async () => {
    const user = userEvent.setup();
    listSpaceMembers.mockResolvedValue([]);
    renderModal();

    await user.click(screen.getByRole('tab', { name: 'Members' }));
    await screen.findByText('No one has been added yet.');
    await user.click(screen.getByRole('button', { name: 'Add members' }));

    const popover = await screen.findByRole('dialog', { name: 'Add members' });
    expect(
      within(popover).getByText('Start typing a name or email to see suggestions.')
    ).toBeInTheDocument();
    expect(
      within(popover).queryByRole('button', { name: 'Add Grace Editor' })
    ).not.toBeInTheDocument();

    await user.type(within(popover).getByLabelText('Search workspace members'), 'g');

    expect(within(popover).getByRole('button', { name: 'Add Grace Editor' })).toBeInTheDocument();
    expect(
      within(popover).queryByRole('button', { name: 'Add Ada Owner' })
    ).not.toBeInTheDocument();
  });

  it('opens directly on the members tab when the sidebar asks for it', async () => {
    listSpaceMembers.mockResolvedValue([adaMember]);
    renderModal({ initialTab: 'members' });

    expect(screen.getByRole('tab', { name: 'Members' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Ada Owner')).toBeInTheDocument();
  });

  it('lists everyone in the workspace as a member row when the space is public', async () => {
    const user = userEvent.setup();
    listSpaceMembers.mockResolvedValue([]);
    renderModal({
      spaceOverride: { ...space, accessMode: 'PUBLIC', everyoneAccessLevel: 'COMMENT' },
    });

    await user.click(screen.getByRole('tab', { name: 'Members' }));

    const panel = screen.getByRole('tabpanel', { name: 'Members' });
    expect(await within(panel).findByText('Everyone in this workspace')).toBeInTheDocument();
    expect(within(panel).getByText('Access is set in General.')).toBeInTheDocument();
    expect(within(panel).getByText('Can comment')).toBeInTheDocument();
    expect(
      within(panel).queryByRole('button', { name: /Access level for Everyone/ })
    ).not.toBeInTheDocument();
  });

  it('does not list everyone in the workspace when the space is custom', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('tab', { name: 'Members' }));
    await screen.findByText('Ada Owner');

    const panel = screen.getByRole('tabpanel', { name: 'Members' });
    expect(within(panel).queryByText('Everyone in this workspace')).not.toBeInTheDocument();
  });

  it('keeps the member row in step with the everyone level from General', async () => {
    const user = userEvent.setup();
    update.mockResolvedValue({
      ...space,
      accessMode: 'PUBLIC',
      everyoneAccessLevel: 'COMMENT',
    });
    renderModal({
      spaceOverride: { ...space, accessMode: 'PUBLIC', everyoneAccessLevel: 'VIEW' },
    });

    await user.click(
      screen.getByRole('button', { name: 'Everyone access in this space: Can view' })
    );
    await user.click(screen.getByRole('option', { name: 'Can comment' }));
    await user.click(screen.getByRole('tab', { name: 'Members' }));

    const panel = screen.getByRole('tabpanel', { name: 'Members' });
    expect(await within(panel).findByText('Can comment')).toBeInTheDocument();
  });

  it('does not offer the add-members control to a member who cannot administer', async () => {
    const user = userEvent.setup();
    renderModal({
      spaceOverride: { ...space, canAdminister: false, myAccessLevel: 'VIEW' },
    });

    await user.click(screen.getByRole('tab', { name: 'Members' }));
    await screen.findByText('Ada Owner');

    expect(screen.queryByRole('button', { name: 'Add members' })).not.toBeInTheDocument();
  });

  it('keeps the access controls read-only for a member who cannot administer', async () => {
    renderModal({
      spaceOverride: {
        ...space,
        canAdminister: false,
        myAccessLevel: 'VIEW',
      },
    });

    expect(screen.queryByLabelText('Space name')).not.toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Public/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Only the space owner or a workspace admin can change who can open this space.'
      )
    ).toBeInTheDocument();
  });

  it('drops the popup when leaving a space the caller can no longer read', async () => {
    const user = userEvent.setup();
    const graceOwner: SpaceMember = { ...graceMember, accessLevel: 'OWNER' };
    const adaEditor: SpaceMember = { ...adaMember, accessLevel: 'EDIT' };
    listSpaceMembers.mockResolvedValue([graceOwner, adaEditor]);
    removeMember.mockResolvedValue([graceOwner]);
    getSpace.mockRejectedValue(new ApiError('Not found', 404));
    const { onClose, onSpaceRemoved } = renderModal({
      spaceOverride: { ...space, canAdminister: false, myAccessLevel: 'EDIT' },
    });

    await user.click(screen.getByRole('tab', { name: 'Members' }));
    await user.click(await screen.findByRole('button', { name: 'Access level for Ada Owner' }));
    await user.click(screen.getByRole('option', { name: 'Leave space' }));
    const confirmation = screen.getByRole('dialog', { name: 'Leave Design?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Leave' }));

    expect(removeMember).toHaveBeenCalledWith('token-1', 'space-1', 'user-1');
    await waitFor(() => expect(onSpaceRemoved).toHaveBeenCalledWith('space-1'));
    expect(onClose).toHaveBeenCalled();
  });

  it('treats an administrator leaving through their own row as a leave', async () => {
    const user = userEvent.setup();
    const graceOwner: SpaceMember = { ...graceMember, accessLevel: 'OWNER' };
    listSpaceMembers.mockResolvedValue([adaMember, graceOwner]);
    removeMember.mockResolvedValue([graceOwner]);
    getSpace.mockRejectedValue(new ApiError('Not found', 404));
    const { onClose, onSpaceRemoved } = renderModal();

    await user.click(screen.getByRole('tab', { name: 'Members' }));
    await user.click(await screen.findByRole('button', { name: 'Access level for Ada Owner' }));
    await user.click(screen.getByRole('option', { name: 'Leave space' }));

    const confirmation = screen.getByRole('dialog', { name: 'Leave Design?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Leave' }));

    expect(removeMember).toHaveBeenCalledWith('token-1', 'space-1', 'user-1');
    // The caller's own membership changed, so the space reloads and then leaves the modal.
    await waitFor(() => expect(getSpace).toHaveBeenCalledWith('token-1', 'space-1'));
    await waitFor(() => expect(onSpaceRemoved).toHaveBeenCalledWith('space-1'));
    expect(onClose).toHaveBeenCalled();
  });

  it('archives the space once the confirmation is accepted', async () => {
    const user = userEvent.setup();
    const archived = { ...space, archivedAt: '2026-10-01T00:00:00Z' };
    archive.mockResolvedValue(archived);
    const { onClose, onSpaceChange, onNotice } = renderModal();

    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const confirmation = screen.getByRole('dialog', { name: 'Archive Design?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Archive' }));

    expect(archive).toHaveBeenCalledWith('token-1', 'space-1');
    await waitFor(() => expect(onSpaceChange).toHaveBeenCalledWith(archived));
    expect(onNotice).toHaveBeenCalledWith({ kind: 'status', message: 'Design was archived.' });
    expect(onClose).toHaveBeenCalled();
  });

  it('refuses to delete a space that still holds documents', () => {
    renderModal();

    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByText(/Only an empty space can be deleted/)).toBeInTheDocument();
  });

  it('deletes an empty space after confirmation', async () => {
    const user = userEvent.setup();
    remove.mockResolvedValue(undefined);
    const { onClose, onSpaceRemoved } = renderModal({
      spaceOverride: { ...space, pageCount: 0 },
    });

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const confirmation = screen.getByRole('dialog', { name: 'Delete Design?' });
    await user.click(within(confirmation).getByRole('button', { name: 'Delete' }));

    expect(remove).toHaveBeenCalledWith('token-1', 'space-1');
    await waitFor(() => expect(onSpaceRemoved).toHaveBeenCalledWith('space-1'));
    expect(onClose).toHaveBeenCalled();
  });

  it('restores an archived space from its banner', async () => {
    const user = userEvent.setup();
    const archived = { ...space, archivedAt: '2026-10-01T00:00:00Z' };
    restore.mockResolvedValue({ ...archived, archivedAt: null });
    const { onSpaceChange } = renderModal({ spaceOverride: archived });

    expect(
      screen.getByText('This space is archived: documents are read-only until it is restored.')
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Public/ })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Restore space' }));

    expect(restore).toHaveBeenCalledWith('token-1', 'space-1');
    await waitFor(() => expect(onSpaceChange).toHaveBeenCalledWith({ ...space, archivedAt: null }));
  });
});
