import { IconBase, type IconProps } from './IconBase';

// Dots span 20 of the 24 units, the same ink width as the Comments bubble, so
// both icon buttons leave the same padding and read as one row of controls.
export const MoreHorizontal = ({ className, size = 17, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <circle cx="3.7" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="20.3" cy="12" r="1.7" fill="currentColor" stroke="none" />
  </IconBase>
);
