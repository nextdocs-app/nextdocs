import { IconBase, type IconProps } from './IconBase';

export const Trash = ({ className, size = 18, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M4.5 7.5h15" />
    <path d="M9 4.75h6a1 1 0 0 1 1 1V7.5H8V5.75a1 1 0 0 1 1-1Z" />
    <path d="M7.25 7.5 8.2 18.1a1.2 1.2 0 0 0 1.2 1.1h5.2a1.2 1.2 0 0 0 1.2-1.1l.95-10.6" />
    <path d="M10.25 10.25v6" />
    <path d="M13.75 10.25v6" />
  </IconBase>
);
