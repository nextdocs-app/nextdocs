import { IconBase, type IconProps } from './IconBase';

export const Check = ({ className, size = 16, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M4 12l6 6L20 6" />
  </IconBase>
);
