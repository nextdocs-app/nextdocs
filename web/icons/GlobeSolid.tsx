import type { IconProps } from './IconBase';

export const GlobeSolid = ({ className, size = 20 }: IconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="currentColor"
    aria-hidden="true"
    className={className}
  >
    <path d="M10 2a8 8 0 1 0 0 16A8 8 0 0 0 10 2zm0 1.5a6.5 6.5 0 0 1 4.47 11.26c-.2-.68-.62-1.3-1.25-1.73l-2.38-1.59a1 1 0 0 1-.44-.84V9.5a.5.5 0 0 1 .5-.5h.6c.3 0 .6-.13.8-.37l.77-.92a1 1 0 0 0 .18-1.05l-.26-.65a1 1 0 0 0-.47-.52L10.85 5a1 1 0 0 0-1.26.38L9 6.17a1 1 0 0 1-.87.5H7.5A1.5 1.5 0 0 0 6 8.17v.16a1.5 1.5 0 0 0 .6 1.2l.4.3a1 1 0 0 1 0 1.6l-.35.26a2 2 0 0 0-.78 1.74l.04.82A6.5 6.5 0 0 1 10 3.5z" />
  </svg>
);
