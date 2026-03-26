import type { DocumentAccessLevel } from '@/services/document.service';

const cursorColors = ['#2563eb', '#0f766e', '#c2410c', '#6d28d9', '#b45309', '#0ea5e9'];

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
