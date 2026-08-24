import { IconBase, type IconProps } from './IconBase';

export const Plus = ({ className, size = 12, strokeWidth = 2 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M5 12h14M12 5v14" />
  </IconBase>
);
