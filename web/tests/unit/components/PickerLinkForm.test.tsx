import { fireEvent, render, screen } from '@testing-library/react';
import { PickerLinkForm } from '../../../components/page/PickerLinkForm';

function renderForm(isValid = false, value = '') {
  const handlers = { onChange: jest.fn(), onSubmit: jest.fn() };
  const utils = render(
    <PickerLinkForm
      inputId="nd-test-link"
      value={value}
      placeholder="https://example.com/x.png"
      submitLabel="Use image"
      isValid={isValid}
      onChange={handlers.onChange}
      onSubmit={handlers.onSubmit}
    />
  );
  return { ...handlers, ...utils };
}

describe('PickerLinkForm', () => {
  it('disables submission for an invalid link', () => {
    renderForm(false, 'http://insecure.example/i.png');

    expect(screen.getByRole('button', { name: 'Use image' })).toBeDisabled();
  });

  it('enables submission for a valid link and submits on click', () => {
    const { onSubmit } = renderForm(true, 'https://cdn.example/i.png');

    const apply = screen.getByRole('button', { name: 'Use image' });
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submits the form on Enter when the link is valid', () => {
    const { onSubmit, container } = renderForm(true, 'https://cdn.example/i.png');

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('ignores form submit when the link is invalid', () => {
    const { onSubmit, container } = renderForm(false, 'not a url');

    fireEvent.submit(container.querySelector('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('lays the field and action out on one row like the file Embed tab', () => {
    const { container } = renderForm(false, '');

    const form = container.querySelector('form')!;
    expect(form.className).toMatch(/flex/);
    expect(form.querySelector('input')).not.toBeNull();
    expect(form.querySelector('button[type="submit"]')).not.toBeNull();
  });

  it('styles the apply button like the file Embed action', () => {
    renderForm(false, '');

    const apply = screen.getByRole('button', { name: 'Use image' });
    expect(apply.className).toMatch(/bg-\[var\(--nd-brand\)\]/);
    expect(apply.className).toMatch(/text-\[var\(--nd-brand-foreground\)\]/);
  });

  it('renders no description, matching the Embed tab', () => {
    const { container } = renderForm(false, '');

    expect(container.querySelector('p')).toBeNull();
  });

  it('forwards edits to the owner', () => {
    const { onChange } = renderForm(false, '');

    fireEvent.change(screen.getByLabelText('Image URL'), {
      target: { value: 'https://cdn.example/i.png' },
    });
    expect(onChange).toHaveBeenCalledWith('https://cdn.example/i.png');
  });
});
