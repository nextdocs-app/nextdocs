import { IconBase, type IconProps } from './IconBase';

export const ChevronDown = ({ className, size = 16, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M6 9 12 15 18 9" />
  </IconBase>
);
