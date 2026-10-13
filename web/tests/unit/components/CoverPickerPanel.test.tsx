import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoverPickerPanel } from '../../../components/page/CoverPickerPanel';
import { attachmentService } from '../../../services/attachment.service';

jest.mock('../../../services/attachment.service', () => ({
  attachmentService: {
    uploadAttachment: jest.fn(),
    resolveAttachmentUrl: jest.fn(),
  },
}));

function renderPanel(canUpload: boolean) {
  const handlers = {
    onSelect: jest.fn(),
    onClose: jest.fn(),
  };
  const utils = render(
    <CoverPickerPanel
      documentId="doc-1"
      accessToken={canUpload ? 'token' : null}
      canUpload={canUpload}
      panelRef={{ current: null }}
      panelStyle={{}}
      onSelect={handlers.onSelect}
      onClose={handlers.onClose}
    />
  );
  return { ...utils, ...handlers };
}

describe('CoverPickerPanel tab sync', () => {
  it('shows only the link tab when uploads are unavailable', () => {
    renderPanel(false);

    expect(screen.getByRole('tab', { name: 'Link' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Upload' })).toBeNull();
    expect(screen.getByLabelText('Image URL')).toBeInTheDocument();
  });

  it('falls back to the link tab when uploads go away after mount', () => {
    const { rerender } = renderPanel(true);

    expect(screen.getByText('Drag an image here, or')).toBeInTheDocument();

    rerender(
      <CoverPickerPanel
        documentId="doc-1"
        accessToken={null}
        canUpload={false}
        panelRef={{ current: null }}
        panelStyle={{}}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );

    // Previously stranded on the upload UI with no upload ability.
    expect(screen.queryByText('Drag an image here, or')).toBeNull();
    expect(screen.getByLabelText('Image URL')).toBeInTheDocument();
  });

  it('offers the upload tab again when uploads come back, keeping the link tab', () => {
    const { rerender } = renderPanel(false);

    rerender(
      <CoverPickerPanel
        documentId="doc-1"
        accessToken="token"
        canUpload
        panelRef={{ current: null }}
        panelStyle={{}}
        onSelect={jest.fn()}
        onClose={jest.fn()}
      />
    );

    expect(screen.getByRole('tab', { name: 'Upload' })).toBeInTheDocument();
    // The stored tab preference ('link') survives: coming back online must
    // not yank the user onto a different tab.
    expect(screen.getByLabelText('Image URL')).toBeInTheDocument();
  });
});

describe('CoverPickerPanel selection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('applies a link cover with the centred position and closes', async () => {
    const user = userEvent.setup();
    const { onSelect, onClose } = renderPanel(false);

    await user.type(screen.getByLabelText('Image URL'), 'https://cdn.example/cover.jpg');
    await user.click(screen.getByRole('button', { name: 'Use image' }));

    expect(onSelect).toHaveBeenCalledWith({
      type: 'link',
      value: 'https://cdn.example/cover.jpg',
      position: 0.5,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps submission disabled for a non-https link', async () => {
    const user = userEvent.setup();
    renderPanel(false);

    await user.type(screen.getByLabelText('Image URL'), 'http://insecure.example/c.jpg');

    expect(screen.getByRole('button', { name: 'Use image' })).toBeDisabled();
  });

  it('uploads a file and selects the attachment as the cover', async () => {
    const user = userEvent.setup();
    (attachmentService.uploadAttachment as jest.Mock).mockResolvedValue({
      id: '11111111-2222-4333-8444-555555555555',
    });
    const { onSelect, onClose } = renderPanel(true);

    const file = new File(['cover'], 'cover.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    expect(attachmentService.uploadAttachment).toHaveBeenCalledWith('doc-1', file, 'token');
    expect(onSelect).toHaveBeenCalledWith({
      type: 'upload',
      value: '11111111-2222-4333-8444-555555555555',
      position: 0.5,
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
