import { IconBase, type IconProps } from './IconBase';

export const ImageIcon = ({ className, size = 15, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.75" cy="9.5" r="1.6" />
    <path d="m20.5 15.5-3.6-3.6a2 2 0 0 0-2.8 0L6.5 19.5" />
  </IconBase>
);
