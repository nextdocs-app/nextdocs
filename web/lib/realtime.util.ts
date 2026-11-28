import type { DocumentAccessLevel } from '@/services/document.service';

export function isReadOnlyAccessLevel(level: DocumentAccessLevel | null): boolean {
  return level === 'VIEW' || level === 'COMMENT';
}
