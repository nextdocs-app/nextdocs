import { IconBase, type IconProps } from './IconBase';

export const Close = ({ className, size = 16, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M18 6 6 18M6 6l12 12" />
  </IconBase>
);
