import type { ReactNode } from 'react';

type SectionHeadingElement = 'h2' | 'h3' | 'p' | 'span';

interface SectionHeadingProps {
  children: ReactNode;
  className?: string;
  as?: SectionHeadingElement;
}

/**
 * One label treatment for every section title in the app. The main sidebar's
 * document sections are the source of truth; settings groups and settings
 * sections reuse it so new surfaces never invent their own heading style.
 */
export function SectionHeading({ children, className, as: Component = 'p' }: SectionHeadingProps) {
  return (
    <Component
      className={`text-[13.5px] font-medium text-muted-foreground/80 ${className ?? ''}`.trim()}
    >
      {children}
    </Component>
  );
}
