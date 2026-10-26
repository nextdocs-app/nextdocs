import { IconBase, type IconProps } from './IconBase';

export const Eye = ({ className, size = 18, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0" />
    <circle cx="12" cy="12" r="3" />
  </IconBase>
);
