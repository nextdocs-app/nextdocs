import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateSpaceModal } from '../../../../components/settings/workspace/CreateSpaceModal';
import { spaceApiService } from '../../../../services/space.service';
import type { Space } from '../../../../types/space.types';

jest.mock('../../../../services/space.service', () => ({
  spaceApiService: { create: jest.fn(), uploadIcon: jest.fn() },
}));
jest.mock('../../../../components/page/IconPickerPanel', () => ({
  IconPickerPanel: ({
    panelRef,
    onSelect,
    canUpload,
    uploadFile,
  }: {
    panelRef?: React.RefObject<HTMLDivElement | null>;
    onSelect: (icon: { type: string; value: string }) => void;
    canUpload: boolean;
    uploadFile?: (file: File) => Promise<{ id: string }>;
  }) => (
    <div ref={panelRef}>
      <button type="button" onClick={() => onSelect({ type: 'emoji', value: '🚀' })}>
        Pick rocket
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

const create = spaceApiService.create as jest.Mock;
const uploadIcon = spaceApiService.uploadIcon as jest.Mock;

const createdSpace: Space = {
  id: 'space-new',
  name: 'Design',
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
};

function renderModal() {
  const onClose = jest.fn();
  const onCreated = jest.fn();
  const onNotice = jest.fn();

  render(
    <CreateSpaceModal
      isOpen
      accessToken="token-1"
      onClose={onClose}
      onCreated={onCreated}
      onNotice={onNotice}
    />
  );

  return { onClose, onCreated, onNotice };
}

beforeEach(() => jest.clearAllMocks());

describe('CreateSpaceModal', () => {
  it('renders the default layers icon for a space', () => {
    renderModal();

    const iconButton = screen.getByRole('button', { name: 'Add a space icon' });
    expect(iconButton.querySelector('svg')?.querySelectorAll('path')).toHaveLength(3);
  });

  it('renders the icon button sized to match the height of the name section', () => {
    renderModal();

    const iconButton = screen.getByRole('button', { name: 'Add a space icon' });
    expect(iconButton.className).toContain('h-[60px]');
    expect(iconButton.className).toContain('w-[60px]');
  });

  it('focuses the name and keeps submission disabled until it has one', async () => {
    const user = userEvent.setup();
    renderModal();

    const name = screen.getByLabelText('Name');
    expect(name).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Create space' })).toBeDisabled();

    await user.type(name, 'Design');

    expect(screen.getByRole('button', { name: 'Create space' })).toBeEnabled();
  });

  it('creates a custom space by default', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue(createdSpace);
    const { onClose, onCreated, onNotice } = renderModal();

    await user.type(screen.getByLabelText('Name'), 'Design');
    await user.click(screen.getByRole('button', { name: 'Create space' }));

    expect(create).toHaveBeenCalledWith('token-1', {
      name: 'Design',
      accessMode: 'CUSTOM',
      everyoneAccessLevel: 'VIEW',
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdSpace));
    expect(onNotice).toHaveBeenCalledWith({ kind: 'status', message: 'Design was created.' });
    expect(onClose).toHaveBeenCalled();
  });

  it('creates a public space with the chosen everyone level', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({
      ...createdSpace,
      accessMode: 'PUBLIC',
      everyoneAccessLevel: 'EDIT',
    });
    renderModal();

    await user.type(screen.getByLabelText('Name'), 'Design');
    await user.click(screen.getByRole('radio', { name: /Public/ }));
    await user.click(
      screen.getByRole('button', { name: 'Everyone access in this space: Can view' })
    );
    await user.click(screen.getByRole('option', { name: 'Can edit' }));
    await user.click(screen.getByRole('button', { name: 'Create space' }));

    expect(create).toHaveBeenCalledWith('token-1', {
      name: 'Design',
      accessMode: 'PUBLIC',
      everyoneAccessLevel: 'EDIT',
    });
  });

  it('does not apply focus ring classes to access level option cards', async () => {
    const user = userEvent.setup();
    renderModal();

    const publicCard = screen.getByRole('radio', { name: /Public/ }).closest('label');
    const customCard = screen.getByRole('radio', { name: /Custom/ }).closest('label');

    expect(publicCard?.className).not.toContain('ring');
    expect(customCard?.className).not.toContain('ring');

    await user.click(screen.getByRole('radio', { name: /Public/ }));

    expect(publicCard?.className).not.toContain('ring');
    expect(publicCard?.className).toContain('border-[var(--nd-brand)]/50');
  });

  it('sends the picked icon with the new space', async () => {
    const user = userEvent.setup();
    create.mockResolvedValue({ ...createdSpace, icon: { type: 'emoji', value: '🚀' } });
    renderModal();

    await user.type(screen.getByLabelText('Name'), 'Design');
    await user.click(screen.getByRole('button', { name: 'Add a space icon' }));
    await user.click(screen.getByRole('button', { name: 'Pick rocket' }));
    await user.click(screen.getByRole('button', { name: 'Create space' }));

    expect(create).toHaveBeenCalledWith('token-1', {
      name: 'Design',
      accessMode: 'CUSTOM',
      everyoneAccessLevel: 'VIEW',
      icon: { type: 'emoji', value: '🚀' },
    });
  });

  it('uploads an image for the space it is about to create', async () => {
    const user = userEvent.setup();
    const uploadedIcon = { type: 'upload', value: 'upload-1' };
    uploadIcon.mockResolvedValue({ id: 'upload-1' });
    create.mockResolvedValue({ ...createdSpace, icon: uploadedIcon });
    renderModal();

    await user.type(screen.getByLabelText('Name'), 'Design');
    await user.click(screen.getByRole('button', { name: 'Add a space icon' }));
    await user.click(screen.getByRole('button', { name: 'Upload a custom icon' }));
    await waitFor(() => expect(uploadIcon).toHaveBeenCalledWith('token-1', expect.any(File)));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Change space icon' })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: 'Create space' }));

    expect(create).toHaveBeenCalledWith('token-1', {
      name: 'Design',
      accessMode: 'CUSTOM',
      everyoneAccessLevel: 'VIEW',
      icon: uploadedIcon,
    });
  });

  it('shows the server message and stays open when creation fails', async () => {
    const user = userEvent.setup();
    create.mockRejectedValue(new Error('That name is already taken.'));
    const { onClose } = renderModal();

    await user.type(screen.getByLabelText('Name'), 'Design');
    await user.click(screen.getByRole('button', { name: 'Create space' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That name is already taken.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });
});
