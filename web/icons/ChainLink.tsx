import type { IconProps } from './IconBase';

export const ChainLink = ({ className, size = 20 }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.65"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L9.5 5.5" />
    <path d="M11.5 8.5a3.5 3.5 0 0 0-5 0l-2.5 2.5a3.5 3.5 0 0 0 5 5L10.5 14.5" />
  </svg>
);
