'use client';

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';

export type BadgeVariant = 'muted' | 'primary';

export interface BadgeProps extends HTMLAttributes<HTMLElement> {
  variant?: BadgeVariant;
  children?: ReactNode;
  /** When provided, renders the badge as an interactive button. */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  title?: string;
}

/**
 * Reusable badge chip matching the design established in Spaces settings and
 * sharing views: compact text, subtle borders, and muted or primary tones.
 * Renders as a `<button>` when interactive or a `<span>` when static.
 */
export const Badge = forwardRef<HTMLElement, BadgeProps>(function Badge(
  {
    variant = 'muted',
    children,
    onClick,
    disabled = false,
    type = 'button',
    className = '',
    title,
    ...rest
  },
  ref
) {
  const isInteractive = typeof onClick === 'function';

  const variantStyles =
    variant === 'primary'
      ? `border-primary/20 bg-primary/10 text-primary ${isInteractive ? 'hover:bg-primary/20' : ''}`
      : `border-border bg-muted text-muted-foreground ${
          isInteractive ? 'hover:bg-muted-foreground/15 hover:text-foreground' : ''
        }`;

  const baseClassName = `inline-flex items-center rounded border px-1.5 py-0.5 text-[10.5px] font-medium leading-none ${variantStyles}`;

  if (isInteractive) {
    return (
      <button
        ref={ref as React.ForwardedRef<HTMLButtonElement>}
        type={type}
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={`${baseClassName} transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      >
        {children}
      </button>
    );
  }

  return (
    <span
      ref={ref as React.ForwardedRef<HTMLSpanElement>}
      title={title}
      className={`${baseClassName} ${className}`}
      {...rest}
    >
      {children}
    </span>
  );
});
