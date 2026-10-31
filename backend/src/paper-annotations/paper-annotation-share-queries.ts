import { DataSource } from 'typeorm';
import type { Visibility } from './paper-annotation-share.entity';

/** What the author sees of their own share, on the annotation it was made from. */
export interface ShareView {
  visibility: Visibility;
  /** The readers a `users` share is for, by the id of their public profile. Empty for `public`. */
  recipients: { id: string; name: string }[];
  sharedAt: Date;
  /** The last time the copy was made from the annotation: editing the annotation does not change it. */
  updatedAt: Date;
}

/** What anyone allowed to see a share gets of it: the copy and who published it, nothing of the private side. */
export interface SharedAnnotationView {
  id: string;
  kind: string;
  body: string | null;
  page: number | null;
  quote: string | null;
  visibility: Visibility;
  /** True for the viewer's own, so the page can say so and point to where it is managed. */
  mine: boolean;
  author: { name: string; avatarUrl: string; profile: string | null };
  sharedAt: Date;
}

/** How much of a passage is shared: a few lines, so a share is a pointer to the paper and not a copy of it. */
export const QUOTE_MAX = 500;

/** The passage cut at a whole character (never inside a surrogate pair), with an ellipsis when it was cut. */
export function excerpt(quote: string | null): string | null {
  if (!quote) return null;
  const chars = Array.from(quote);
  return chars.length > QUOTE_MAX ? `${chars.slice(0, QUOTE_MAX).join('').trimEnd()}…` : quote;
}

/** What `/u/<x>` names: the vanity slug or the profile id. Accepts the bare name, `@name` or the whole link. */
export function profileKeyOf(raw: string): string {
  const last = raw.trim().replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '';
  return last.replace(/^@/, '').toLowerCase();
}

/** The shares of these annotations, for the author's own list. One query, whatever the number of annotations. */
export async function sharesOf(dataSource: DataSource, annotationIds: string[]): Promise<Map<string, ShareView>> {
  const out = new Map<string, ShareView>();
  if (!annotationIds.length) return out;
  const rows: { annotationId: string; visibility: Visibility; createdAt: Date; updatedAt: Date; recipients: { id: string; name: string }[] }[] =
    await dataSource.query(
      `SELECT s."annotationId", s.visibility, s."createdAt", s."updatedAt",
              COALESCE(
                (SELECT json_agg(json_build_object('id', u."publicProfileId", 'name', COALESCE(NULLIF(trim(u."displayNameOverride"), ''), u."displayName"))
                                 ORDER BY u."displayName")
                   FROM paper_annotation_share_recipient r JOIN "user" u ON u.id = r."userId"
                  WHERE r."shareId" = s.id),
                '[]'::json) AS recipients
         FROM paper_annotation_share s
        WHERE s."annotationId" = ANY($1::uuid[])`,
      [annotationIds],
    );
  for (const r of rows) {
    out.set(r.annotationId, { visibility: r.visibility, recipients: r.recipients, sharedAt: r.createdAt, updatedAt: r.updatedAt });
  }
  return out;
}
