import type { ReactNode } from 'react';
import { SectionHeading } from '@/components/SectionHeading';

/**
 * Shared building blocks for settings panels. A panel is just sections of
 * rows, so a new setting is one `<SettingsRow>` — no dialog changes needed.
 */

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="border-b border-border pb-2.5">
        <SectionHeading as="h3">{title}</SectionHeading>
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 py-3.5 md:flex-row md:items-center md:justify-between md:gap-8">
      <div className="min-w-0">
        <p className="text-[14px] font-medium leading-snug">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <div className="flex min-w-0 max-w-full flex-shrink-0 items-center">{control}</div>
    </div>
  );
}

/** A read-only value in a settings row. */
export function SettingsValue({ children }: { children: ReactNode }) {
  return (
    <span
      className="min-w-0 max-w-[16rem] truncate text-[13px] text-muted-foreground"
      title={typeof children === 'string' ? children : undefined}
    >
      {children}
    </span>
  );
}
