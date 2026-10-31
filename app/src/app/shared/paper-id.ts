/** A paper's public id: a UUID (a version 7 one, made by the database). It is all a URL or the API ever carries. */
export const isPaperId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/** The id a paper had before public ids: digits only. Links with it exist, so the pages answer them with a redirect. */
export const isLegacyPaperId = (value: string): boolean => /^[1-9]\d{0,9}$/.test(value);
