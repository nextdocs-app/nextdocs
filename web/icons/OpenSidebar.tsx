import { IconBase, type IconProps } from './IconBase';

export const OpenSidebar = ({ className, size = 18, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <rect width={18} height={18} x={3} y={3} rx={2} />
    <path d="M15 3v18M8 9l3 3-3 3" />
  </IconBase>
);
