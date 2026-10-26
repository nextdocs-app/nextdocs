import type { IconProps } from './IconBase';

/**
 * Sidebar collapse control: a landscape panel with a narrow left rail and a
 * chevron pointing into it. The panel keeps a tight corner radius and reads as
 * chrome, not a pill, at the 18px header size. The 24×20 canvas renders at
 * 0.9× at 18px, so a 1.2 stroke lands at the same ~1.1px weight as the 24×24
 * action icons instead of reading heavier than them.
 */
export const CloseSidebar = ({
  className,
  size = 18,
  strokeWidth = 1.2,
  ...rest
}: Omit<IconProps, 'size'> & { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={(size * 24) / 20}
    height={size}
    viewBox="0 0 24 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...rest}
  >
    <rect x={1.5} y={2.5} width={21} height={15} rx={2.5} />
    <path d="M7.5 2.5v15" />
    <path d="M16.5 7.5 13.5 10l3 2.5" />
  </svg>
);
