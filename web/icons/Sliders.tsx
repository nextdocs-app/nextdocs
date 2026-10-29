import { IconBase, type IconProps } from './IconBase';

export const Sliders = ({ className, size = 17, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M4 6h6" />
    <path d="M14 6h6" />
    <circle cx="12" cy="6" r="2" />
    <path d="M4 12h10" />
    <path d="M18 12h2" />
    <circle cx="16" cy="12" r="2" />
    <path d="M4 18h4" />
    <path d="M12 18h8" />
    <circle cx="10" cy="18" r="2" />
  </IconBase>
);
