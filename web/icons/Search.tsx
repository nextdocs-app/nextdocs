import { IconBase, type IconProps } from './IconBase';

export const Search = ({ className, size = 18, strokeWidth = 1.5 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </IconBase>
);
