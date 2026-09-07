import { IconBase, type IconProps } from './IconBase';

export const CircleCheck = ({ className, size = 24, strokeWidth = 2, ...rest }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className} {...rest}>
    <circle cx="12" cy="12" r="10" />
    <path d="m9 12 2 2 4-4" />
  </IconBase>
);
