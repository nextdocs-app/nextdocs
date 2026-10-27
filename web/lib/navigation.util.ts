/** Full-page navigation helpers for routes that must boot the app cleanly. */
export function hardNavigate(url: string): void {
  window.location.assign(url);
}

export function hardReplace(url: string): void {
  window.location.replace(url);
}
