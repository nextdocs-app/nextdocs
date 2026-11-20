import { IconBase, type IconProps } from './IconBase';

export const History = ({ className, size = 17, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4.5v4h4" />
    <path d="M12 7.5V12l3 1.8" />
  </IconBase>
);
