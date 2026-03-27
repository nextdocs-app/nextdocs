import { IconBase, type IconProps } from './IconBase';

export const Restore = ({ className, size = 16, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M3.5 11.5A8.5 8.5 0 1 1 7 18.5" />
    <path d="M3.5 5.5v6h6" />
  </IconBase>
);
