export function normalizeDocumentTitle(title: string | undefined): string {
  return title?.trim() ? title : 'Untitled';
}
