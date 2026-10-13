import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmojiMartPicker, resetEmojiMartLoader } from '../../../components/page/EmojiMartPicker';

const mockPickerInstance = {
  update: jest.fn(),
};

const MockPicker = jest.fn().mockImplementation((props) => {
  if (props.ref?.current) {
    const btn = document.createElement('button');
    btn.textContent = '🎉 Party';
    btn.onclick = () => props.onEmojiSelect({ native: '🎉', id: 'tada', name: 'Party Popper' });
    props.ref.current.appendChild(btn);
  }
  return mockPickerInstance;
});

const mockInit = jest.fn().mockResolvedValue(undefined);

jest.mock(
  'emoji-mart',
  () => ({
    __esModule: true,
    Picker: MockPicker,
    init: mockInit,
  }),
  { virtual: true }
);

jest.mock(
  '@emoji-mart/data',
  () => ({
    __esModule: true,
    default: { categories: [] },
  }),
  { virtual: true }
);

describe('EmojiMartPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('initializes emoji-mart with data and mounts the picker', async () => {
    const onEmojiSelect = jest.fn();

    render(
      <EmojiMartPicker
        onEmojiSelect={onEmojiSelect}
        theme="dark"
        autoFocus
        perLine={8}
        previewPosition="none"
        skinTonePosition="search"
      />
    );

    // Wait for the async load and initialization to complete
    const btn = await screen.findByRole('button', { name: '🎉 Party' });
    expect(btn).toBeInTheDocument();

    expect(mockInit).toHaveBeenCalledWith({ data: { categories: [] } });
    expect(MockPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: 'dark',
        autoFocus: true,
        perLine: 8,
        previewPosition: 'none',
        skinTonePosition: 'search',
      })
    );
  });

  it('forwards emoji selection to the callback', async () => {
    const user = userEvent.setup();
    const onEmojiSelect = jest.fn();

    render(<EmojiMartPicker onEmojiSelect={onEmojiSelect} theme="light" />);

    const btn = await screen.findByRole('button', { name: '🎉 Party' });
    await user.click(btn);

    expect(onEmojiSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        native: '🎉',
        id: 'tada',
        name: 'Party Popper',
      })
    );
  });

  it('updates the picker instance when props change', async () => {
    const { rerender } = render(<EmojiMartPicker onEmojiSelect={jest.fn()} theme="light" />);

    await screen.findByRole('button', { name: '🎉 Party' });

    rerender(<EmojiMartPicker onEmojiSelect={jest.fn()} theme="dark" />);

    expect(mockPickerInstance.update).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark' })
    );
  });

  it('does not push an update on parent renders with unchanged picker props', async () => {
    const { rerender } = render(<EmojiMartPicker onEmojiSelect={jest.fn()} theme="light" />);

    await screen.findByRole('button', { name: '🎉 Party' });

    mockPickerInstance.update.mockClear();

    // A new callback identity alone (every inline arrow) must not update.
    rerender(<EmojiMartPicker onEmojiSelect={jest.fn()} theme="light" />);

    expect(mockPickerInstance.update).not.toHaveBeenCalled();
  });

  it('cleans up on unmount', async () => {
    const { unmount, container } = render(
      <EmojiMartPicker onEmojiSelect={jest.fn()} theme="light" />
    );

    await screen.findByRole('button', { name: '🎉 Party' });

    unmount();
    expect(container.firstChild).toBeNull();
  });

  it('reuses the singleton loader across mounts instead of re-initializing', async () => {
    resetEmojiMartLoader();
    mockInit.mockClear();
    MockPicker.mockClear();

    const first = render(<EmojiMartPicker onEmojiSelect={jest.fn()} theme="light" />);
    await screen.findByRole('button', { name: '🎉 Party' });
    const second = render(<EmojiMartPicker onEmojiSelect={jest.fn()} theme="light" />);
    await screen.findAllByRole('button', { name: '🎉 Party' });

    // One dataset download and one init for both pickers.
    expect(mockInit).toHaveBeenCalledTimes(1);
    expect(MockPicker).toHaveBeenCalledTimes(2);

    first.unmount();
    second.unmount();
    resetEmojiMartLoader();
  });

  it('mounts nothing when unmounted before the loader resolves', async () => {
    resetEmojiMartLoader();

    const { unmount, container } = render(
      <EmojiMartPicker onEmojiSelect={jest.fn()} theme="light" />
    );
    unmount();

    // Let the pending loader settle: the orphaned resolution must be dropped.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.firstChild).toBeNull();
    expect(MockPicker).not.toHaveBeenCalled();

    resetEmojiMartLoader();
  });
});
