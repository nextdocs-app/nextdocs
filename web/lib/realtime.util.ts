import type { DocumentAccessLevel } from '@/services/document.service';

const cursorColors = [
  '#bf2626', // Red
  '#bf7226', // Orange-Brown
  '#bfbf26', // Yellow-Olive
  '#bf2672', // Pink-Red
  '#bf26bf', // Magenta
  '#2672bf', // Blue
  '#72bf26', // Lime Green
  '#26bf26', // Green
  '#26bf72', // Teal-Green
  '#26bfbf', // Cyan
  '#2626bf', // Indigo
  '#7226bf', // Purple
];

export function isReadOnlyAccessLevel(level: DocumentAccessLevel | null): boolean {
  return level === 'VIEW' || level === 'COMMENT';
}

export function getPresenceColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }

  return cursorColors[hash % cursorColors.length];
}
