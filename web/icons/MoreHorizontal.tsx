import { IconBase, type IconProps } from './IconBase';

export const MoreHorizontal = ({ className, size = 16, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <circle cx="6" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none" />
  </IconBase>
);
