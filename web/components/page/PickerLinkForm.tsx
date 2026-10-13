'use client';

import { pickerInputClassName } from '@/components/page/PickerShell';

/**
 * Shared image-URL form for the icon and cover pickers.
 *
 * Both panels share one link tab with Enter-to-apply; callers own the value
 * state and the apply callback.
 *
 * Mirrors the file block's Embed tab (`form.bn-form`: URL field plus apply
 * button on one row, no description) so the two "paste a link" moments read
 * as the same pattern, down to the brand apply button.
 */
export function PickerLinkForm({
  inputId,
  value,
  placeholder,
  submitLabel,
  isValid,
  onChange,
  onSubmit,
}: {
  inputId: string;
  value: string;
  placeholder: string;
  submitLabel: string;
  isValid: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="px-2.5 py-3">
      {/* Screen-reader only: the Embed tab shows no visible label, just the
          placeholder, and this keeps that look without losing the name. */}
      <label className="sr-only" htmlFor={inputId}>
        Image URL
      </label>
      <form
        className="flex w-full gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (isValid) {
            onSubmit();
          }
        }}
      >
        <input
          id={inputId}
          type="url"
          inputMode="url"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`min-w-0 flex-1 ${pickerInputClassName}`}
        />
        <button
          type="submit"
          disabled={!isValid}
          className="shrink-0 cursor-pointer rounded-md bg-[var(--nd-brand)] px-3 py-1.5 text-[13px] font-semibold whitespace-nowrap text-[var(--nd-brand-foreground)] transition-colors hover:bg-[var(--nd-brand-hover)] active:bg-[var(--nd-brand-active)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitLabel}
        </button>
      </form>
    </div>
  );
}
