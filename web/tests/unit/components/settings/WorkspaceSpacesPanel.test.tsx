import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceSpacesPanel } from '../../../../components/settings/panels/WorkspaceSpacesPanel';
import { useAuth } from '../../../../hooks/useAuth.hook';
import { spaceApiService } from '../../../../services/space.service';
import type { Space } from '../../../../types/space.types';

jest.mock('../../../../hooks/useAuth.hook', () => ({ useAuth: jest.fn() }));
jest.mock('../../../../services/space.service', () => ({
  spaceApiService: {
    list: jest.fn(),
  },
}));
jest.mock('../../../../components/settings/workspace/SpaceSettingsModal', () => ({
  SpaceSettingsModal: ({
    space,
    onClose,
    onSpaceChange,
    onSpaceRemoved,
  }: {
    space: Space;
    onClose: () => void;
    onSpaceChange: (space: Space) => void;
    onSpaceRemoved: (spaceId: string) => void;
  }) => (
    <div role="dialog" aria-label={`Settings for ${space.name}`}>
      <button type="button" onClick={onClose}>
        Close space settings
      </button>
      <button
        type="button"
        onClick={() =>
          onSpaceChange({ ...space, archivedAt: '2026-10-01T00:00:00Z', memberCount: 2 })
        }
      >
        Archive in test
      </button>
      <button
        type="button"
        onClick={() =>
          onSpaceChange({ ...space, archivedAt: null, memberCount: space.memberCount + 1 })
        }
      >
        Restore in test
      </button>
      <button type="button" onClick={() => onSpaceRemoved(space.id)}>
        Delete in test
      </button>
    </div>
  ),
}));
jest.mock('../../../../components/settings/workspace/CreateSpaceModal', () => ({
  CreateSpaceModal: ({
    onCreated,
    onClose,
  }: {
    onCreated: (space: Space) => void;
    onClose: () => void;
  }) => (
    <div role="dialog" aria-label="Create space">
      <button
        type="button"
        onClick={() =>
          onCreated({
            id: 'space-new',
            name: 'Research',
            orderKey: 'a0',
            icon: null,
            accessMode: 'CUSTOM',
            everyoneAccessLevel: 'VIEW',
            myAccessLevel: 'OWNER',
            canAdminister: true,
            memberCount: 1,
            pageCount: 0,
            archivedAt: null,
            createdAt: '2026-10-20T00:00:00Z',
            updatedAt: '2026-10-20T00:00:00Z',
          })
        }
      >
        Emit created
      </button>
      <button type="button" onClick={onClose}>
        Cancel create
      </button>
    </div>
  ),
}));

const list = spaceApiService.list as jest.Mock;

const designSpace: Space = {
  id: 'space-1',
  name: 'Design',
  orderKey: 'a1',
  icon: null,
  accessMode: 'PUBLIC',
  everyoneAccessLevel: 'COMMENT',
  myAccessLevel: 'EDIT',
  canAdminister: true,
  memberCount: 3,
  pageCount: 7,
  archivedAt: null,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-02T00:00:00Z',
};

const opsSpace: Space = {
  id: 'space-2',
  name: 'Ops',
  orderKey: 'a2',
  icon: null,
  accessMode: 'CUSTOM',
  everyoneAccessLevel: 'VIEW',
  myAccessLevel: 'VIEW',
  canAdminister: false,
  memberCount: 1,
  pageCount: 0,
  archivedAt: null,
  createdAt: '2026-06-01T00:00:00Z',
  updatedAt: '2026-06-02T00:00:00Z',
};

const archivedSpace: Space = {
  ...opsSpace,
  id: 'space-3',
  name: 'Archive sale',
  canAdminister: true,
  archivedAt: '2026-09-01T00:00:00Z',
};

function mockAuth(overrides: Record<string, unknown> = {}) {
  (useAuth as jest.Mock).mockReturnValue({
    isAuthenticated: true,
    isInitializing: false,
    accessToken: 'token-1',
    user: { id: 'user-1' },
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth();
  list.mockResolvedValue([designSpace, opsSpace]);
});

describe('WorkspaceSpacesPanel', () => {
  it('shows the signed-out state without probing the API', () => {
    mockAuth({ isAuthenticated: false, accessToken: null, user: null });

    render(<WorkspaceSpacesPanel />);

    expect(screen.getByText('Not signed in')).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it('lists the spaces with their access and counts', async () => {
    render(<WorkspaceSpacesPanel />);

    expect(await screen.findByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText(/3 members · 7 documents/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith('token-1', expect.objectContaining({ archived: false }));
  });

  it('renders the default layers icon for spaces without custom icons', async () => {
    render(<WorkspaceSpacesPanel />);

    const button = await screen.findByRole('button', { name: 'Open settings for Design' });
    expect(button.querySelector('svg')?.querySelectorAll('path')).toHaveLength(3);
  });

  it('opens the configuration popup for the chosen space', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSpacesPanel />);

    await user.click(await screen.findByRole('button', { name: 'Open settings for Design' }));

    expect(screen.getByRole('dialog', { name: 'Settings for Design' })).toBeInTheDocument();
  });

  it('loads archived spaces only when that tab is opened', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSpacesPanel />);
    await screen.findByText('Design');
    list.mockResolvedValue([archivedSpace]);

    await user.click(screen.getByRole('tab', { name: 'Archived' }));

    expect(await screen.findByText('Archive sale')).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith('token-1', expect.objectContaining({ archived: true }));
    expect(screen.queryByText('Design')).not.toBeInTheDocument();
  });

  it('shows an empty state when the caller has no spaces', async () => {
    list.mockResolvedValue([]);
    render(<WorkspaceSpacesPanel />);

    expect(await screen.findByText('No spaces yet')).toBeInTheDocument();
  });

  it('moves a space out of the active list once the popup archives it', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSpacesPanel />);

    await user.click(await screen.findByRole('button', { name: 'Open settings for Design' }));
    await user.click(screen.getByRole('button', { name: 'Archive in test' }));

    await waitFor(() => expect(screen.queryByText('Design')).not.toBeInTheDocument());
    expect(screen.getByText('Ops')).toBeInTheDocument();
  });

  it('drops a deleted space from the list and closes its popup', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSpacesPanel />);

    await user.click(await screen.findByRole('button', { name: 'Open settings for Ops' }));
    await user.click(screen.getByRole('button', { name: 'Delete in test' }));

    await waitFor(() => expect(screen.queryByText('Ops')).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog', { name: 'Settings for Ops' })).not.toBeInTheDocument();
  });

  it('keeps the personal order the API returns instead of creation order', async () => {
    list.mockResolvedValue([
      { ...opsSpace, orderKey: 'a0' },
      { ...designSpace, orderKey: 'a1' },
    ]);
    render(<WorkspaceSpacesPanel />);

    await screen.findByText('Ops');
    const rows = screen.getAllByRole('button', { name: /^Open settings for / });
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Open settings for Ops',
      'Open settings for Design',
    ]);
  });

  it('adds a created space to the active list', async () => {
    const user = userEvent.setup();
    render(<WorkspaceSpacesPanel />);
    await screen.findByText('Design');

    await user.click(screen.getByRole('button', { name: 'New space' }));
    await user.click(screen.getByRole('button', { name: 'Emit created' }));

    expect(await screen.findByText('Research')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Create space' })).not.toBeInTheDocument();

    // A new space lands before every existing one, matching the API's key.
    const rows = screen.getAllByRole('button', { name: /^Open settings for / });
    expect(rows[0]).toHaveAccessibleName('Open settings for Research');
  });
});
