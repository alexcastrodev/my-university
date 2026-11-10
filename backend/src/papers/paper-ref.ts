/**
 * A paper a reader can hold. A public paper lives in files (`seed/data/papers`) and is named by its slug; a
 * private one (#203) is a row only its owner can reach and is named by the row. Library entries and PDFs
 * point at one or the other (`paperSlug` or `paperId`, exactly one).
 */
export type PaperRef =
  | { kind: 'public'; slug: string }
  | { kind: 'private'; id: number; publicId: string };

/** What URLs and the API call the paper: the slug of a public one, the UUIDv7 of a private one. */
export const publicIdOf = (ref: PaperRef): string =>
  ref.kind === 'public' ? ref.slug : ref.publicId;

/** The column of `paper_library_entry` and `paper_attachment` that holds this ref, with its value. */
export const refColumn = (
  ref: PaperRef,
): { column: 'paperSlug' | 'paperId'; value: string | number } =>
  ref.kind === 'public'
    ? { column: 'paperSlug', value: ref.slug }
    : { column: 'paperId', value: ref.id };

/** The shape of a private paper's public id (`paper.publicId`), case-insensitive. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** Lowercase words joined by single hyphens, short enough for the column, and never shaped like a UUID. */
export const PAPER_SLUG_MAX = 100;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isPaperSlug = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= PAPER_SLUG_MAX &&
  SLUG.test(value) &&
  !isUuid(value);
