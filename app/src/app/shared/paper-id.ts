/** A private paper's public id: a UUID (a version 7 one, made by the database). */
export const isUuid = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** A catalog paper's id: its slug, lowercase words joined by hyphens (the same rule as the API). */
export const isPaperSlug = (value: string): boolean => value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && !isUuid(value);

/** Any id a URL or the API carries for a paper: the slug of a catalog paper or the UUID of a private one. */
export const isPaperId = (value: string): boolean => isUuid(value) || isPaperSlug(value);
