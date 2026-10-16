/**
 * Absolute link to a public profile. Resolved against `<base href>` so it keeps the locale sub path
 * the app is served under (`/` or `/pt-BR/`); the id is the database-made `publicProfileId`, never a login.
 */
export function publicProfileUrl(publicProfileId: string, base: string = document.baseURI): string {
  return new URL(`u/${publicProfileId}`, base).href;
}
