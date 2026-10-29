'use client';

import { useId } from 'react';
import { Monitor, Moon, Sun } from '@/icons';
import { useTheme, type Theme } from '@/hooks/useTheme.hook';

const THEME_OPTIONS: {
  value: Theme;
  label: string;
  icon: typeof Sun;
}[] = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

export function ThemeSegmentedControl() {
  const { theme, setTheme } = useTheme();
  const groupName = useId();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex w-full items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5 md:w-auto"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isSelected = theme === option.value;

        return (
          <label
            key={option.value}
            className={`relative flex h-8 flex-1 cursor-pointer select-none items-center justify-center gap-1.5 rounded-[7px] border px-2.5 text-[13px] transition-colors duration-150 pointer-coarse:h-9 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 md:flex-none ${
              isSelected
                ? 'border-border bg-background font-medium text-foreground shadow-sm dark:border-white/15 dark:bg-white/10 dark:shadow-none'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={isSelected}
              onChange={() => setTheme(option.value)}
              className="sr-only"
            />
            <Icon
              size={14}
              aria-hidden="true"
              className={`flex-shrink-0 ${isSelected ? 'opacity-90' : 'opacity-60'}`}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
