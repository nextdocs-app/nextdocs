import { IconBase, type IconProps } from './IconBase';

export const Login = ({ className, size = 16, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="M11 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M18 17l5-5-5-5" />
    <path d="M23 12H11" />
  </IconBase>
);
