import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaperLibraryEntry } from '../papers/paper-library.entity';

/** A free-form note has no place in the PDF; the others are anchored to a page of one PDF version. */
export const ANNOTATION_KINDS = [
  'note',
  'highlight',
  'comment',
  'question',
  'bookmark',
] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

/** Where an anchored annotation sits on its page, as fractions (0 to 1) of the page, from the top left. */
export interface AnnotationRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Something a reader wrote while studying a paper: a note, or a highlight, comment, question or bookmark on
 * the reader's own PDF. It belongs to the library entry (so to one user and one paper) and goes with it.
 *
 * Private by construction: nothing here is reachable except through the owner's library entry, and the
 * sharing of annotations (#187) will add its own column rather than loosen this one.
 *
 * An anchored annotation records the PDF it was made on by `pdfSha256`. When the file is replaced by a
 * different one the annotation is kept but called stale, never moved onto text it was not made for. The
 * anchor follows the W3C Web Annotation model: `quote`, `prefix` and `suffix` are a TextQuoteSelector, `page`
 * a FragmentSelector (`page=N`) and `rects` the geometry.
 */
@Entity('paper_annotation')
@Index('IDX_paper_annotation_entry', ['entryId', 'createdAt'])
export class PaperAnnotation {
  /** What the API calls it: a UUIDv7 made by the database, so a count of rows is not a count of anyone's notes. */
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id: string;

  @Column()
  entryId: number;

  @ManyToOne(() => PaperLibraryEntry, { onDelete: 'CASCADE' })
  entry: PaperLibraryEntry;

  @Column({ type: 'varchar', length: 16 })
  kind: AnnotationKind;

  /** What the reader wrote, markdown as typed. Stored as text and rendered escaped: the server never makes HTML. */
  @Column({ type: 'text', nullable: true })
  body: string | null;

  /** The PDF version (as the reader sees it, 1, 2...) the annotation was made on; null for a note. */
  @Column({ type: 'integer', nullable: true })
  pdfVersion: number | null;

  /** The content hash of that PDF: what decides whether a file is still the one the annotation was made on. */
  @Column({ type: 'char', length: 64, nullable: true })
  pdfSha256: string | null;

  @Column({ type: 'integer', nullable: true })
  page: number | null;

  @Column({ type: 'text', nullable: true })
  quote: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  prefix: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  suffix: string | null;

  @Column({ type: 'jsonb', nullable: true })
  rects: AnnotationRect[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
