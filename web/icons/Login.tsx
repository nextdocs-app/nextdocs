import { IconBase, type IconProps } from './IconBase';

export const Login = ({ className, size = 16, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <path d="m10 17 5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
  </IconBase>
);
