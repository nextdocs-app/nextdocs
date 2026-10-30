'use client';

import { useId } from 'react';
import { AccessDropdown } from '@/components/share/AccessDropdown';
import type { SpaceAccessMode, SpaceEveryoneAccessLevel } from '@/types/space.types';
import {
  SPACE_ACCESS_MODE_DESCRIPTIONS,
  SPACE_ACCESS_MODE_LABELS,
  SPACE_EVERYONE_LEVEL_OPTIONS,
  SPACE_LEVEL_LABELS,
} from './space-access.util';

function optionCardClassName(isSelected: boolean): string {
  return `flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors ${
    isSelected
      ? 'border-[var(--nd-brand)]/50 bg-[var(--nd-brand)]/[0.06]'
      : 'border-border hover:bg-foreground/[0.03]'
  }`;
}

function RadioDot({ isSelected }: { isSelected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
        isSelected ? 'border-[var(--nd-brand)]' : 'border-muted-foreground/40'
      }`}
    >
      {isSelected ? <span className="h-2 w-2 rounded-full bg-[var(--nd-brand)]" /> : null}
    </span>
  );
}

/**
 * The two ways a space can be shared. `everyoneAccessLevel` is only meaningful
 * while PUBLIC, so it stays visible (and editable) next to that choice rather
 * than hiding in another row. Rendered as real radios: arrow keys move between
 * the two modes and a label click selects one.
 */
export function SpaceAccessFields({
  accessMode,
  everyoneAccessLevel,
  disabled = false,
  onChange,
}: {
  accessMode: SpaceAccessMode;
  everyoneAccessLevel: SpaceEveryoneAccessLevel;
  disabled?: boolean;
  onChange: (next: {
    accessMode: SpaceAccessMode;
    everyoneAccessLevel: SpaceEveryoneAccessLevel;
  }) => void;
}) {
  const groupName = useId();

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="sr-only">Who can open this space</legend>

      <label className={optionCardClassName(accessMode === 'PUBLIC')}>
        <input
          type="radio"
          name={groupName}
          value="PUBLIC"
          checked={accessMode === 'PUBLIC'}
          onChange={() => onChange({ accessMode: 'PUBLIC', everyoneAccessLevel })}
          className="sr-only"
        />
        <RadioDot isSelected={accessMode === 'PUBLIC'} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium leading-snug text-foreground">
            {SPACE_ACCESS_MODE_LABELS.PUBLIC}
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
            {SPACE_ACCESS_MODE_DESCRIPTIONS.PUBLIC}
          </span>
        </span>
      </label>

      {accessMode === 'PUBLIC' ? (
        <div className="ml-6 flex flex-wrap items-center gap-1.5 border-l border-border pl-3 text-[12.5px] text-muted-foreground">
          <span>Everyone in this workspace</span>
          <AccessDropdown<SpaceEveryoneAccessLevel>
            value={everyoneAccessLevel}
            options={SPACE_EVERYONE_LEVEL_OPTIONS}
            onChange={(level) => onChange({ accessMode: 'PUBLIC', everyoneAccessLevel: level })}
            disabled={disabled}
            align="left"
            ariaLabel={`Everyone access in this space: ${SPACE_LEVEL_LABELS[everyoneAccessLevel]}`}
            muted
          />
        </div>
      ) : null}

      <label className={optionCardClassName(accessMode === 'CUSTOM')}>
        <input
          type="radio"
          name={groupName}
          value="CUSTOM"
          checked={accessMode === 'CUSTOM'}
          onChange={() => onChange({ accessMode: 'CUSTOM', everyoneAccessLevel })}
          className="sr-only"
        />
        <RadioDot isSelected={accessMode === 'CUSTOM'} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-medium leading-snug text-foreground">
            {SPACE_ACCESS_MODE_LABELS.CUSTOM}
          </span>
          <span className="mt-0.5 block text-[12px] leading-snug text-muted-foreground">
            {SPACE_ACCESS_MODE_DESCRIPTIONS.CUSTOM}
          </span>
        </span>
      </label>
    </fieldset>
  );
}
