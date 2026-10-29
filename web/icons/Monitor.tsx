import { IconBase, type IconProps } from './IconBase';

export const Monitor = ({ className, size = 17, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </IconBase>
);
