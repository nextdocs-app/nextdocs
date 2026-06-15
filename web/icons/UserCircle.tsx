import { IconBase, type IconProps } from './IconBase';

export const UserCircle = ({ className, size = 16, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <circle cx="12" cy="8" r="4" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
  </IconBase>
);
