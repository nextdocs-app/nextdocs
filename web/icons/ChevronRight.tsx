import { IconBase, type IconProps } from './IconBase';

export const ChevronRight = ({ className, size = 12, strokeWidth = 2.5 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="m9 18 6-6-6-6" />
  </IconBase>
);
