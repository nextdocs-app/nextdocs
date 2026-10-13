import { IconBase, type IconProps } from './IconBase';

export const Smile = ({ className, size = 15, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.2a4.5 4.5 0 0 0 7 0" />
    <path d="M9 9.5h.01" />
    <path d="M15 9.5h.01" />
  </IconBase>
);
