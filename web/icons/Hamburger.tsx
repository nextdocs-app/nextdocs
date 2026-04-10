import { IconBase, type IconProps } from './IconBase';

export const Hamburger = ({ className, size = 18, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M4.5 6h15" />
    <path d="M4.5 12h15" />
    <path d="M4.5 18h15" />
  </IconBase>
);
