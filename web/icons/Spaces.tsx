import { IconBase, type IconProps } from './IconBase';

/** Two offset cards: a space is a collection of documents. */
export const Spaces = ({ className, size = 17, strokeWidth = 1.75 }: IconProps) => (
  <IconBase size={size} strokeWidth={strokeWidth} className={className}>
    <rect x="3" y="3" width="11" height="11" rx="2.5" />
    <rect x="10" y="10" width="11" height="11" rx="2.5" />
  </IconBase>
);
