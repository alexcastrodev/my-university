/**
 * Absolute link to a public profile. Resolved against `<base href>` so it keeps the locale sub path
 * the app is served under (`/` or `/pt-BR/`). `key` is the user's chosen slug or the database-made
 * `publicProfileId`, never a GitHub login.
 */
export function publicProfileUrl(key: string, base: string = document.baseURI): string {
  return new URL(`u/${key}`, base).href;
}

/** What a link to this user's profile ends with: the slug they chose, else the id that always works. */
export function profileKey(user: { profileSlug?: string | null; publicProfileId?: string } | null | undefined): string | null {
  return user?.profileSlug || user?.publicProfileId || null;
}
