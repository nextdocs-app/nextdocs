import * as React from 'react';

export type IconProps = {
  size?: number | string;
  className?: string;
  strokeWidth?: number | string;
};

export const IconBase = ({
  size = 18,
  strokeWidth = 1.75,
  className,
  children,
}: React.PropsWithChildren<IconProps>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    {children}
  </svg>
);
