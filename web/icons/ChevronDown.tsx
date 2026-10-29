import { IconBase, type IconProps } from './IconBase';

export const ChevronDown = ({ className, size = 17, strokeWidth = 1.75, ...rest }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className} {...rest}>
    <path d="M6 9 12 15 18 9" />
  </IconBase>
);
