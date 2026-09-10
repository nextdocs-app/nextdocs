import { IconBase, type IconProps } from './IconBase';

export const Info = ({ className, size = 24, strokeWidth = 2, ...rest }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className} {...rest}>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4" />
    <path d="M12 8h.01" />
  </IconBase>
);
