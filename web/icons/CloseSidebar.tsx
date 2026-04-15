import { IconBase, type IconProps } from './IconBase';

export const CloseSidebar = ({ className, size = 18, strokeWidth = 1.5 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <rect width={18} height={18} x={3} y={3} rx={2} />
    <path d="M15 3v18M10 15l-3-3 3-3" />
  </IconBase>
);
