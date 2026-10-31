import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const PAPER_TYPES = [
  'journal-article',
  'conference-paper',
  'preprint',
  'book-chapter',
  'book',
  'thesis',
  'report',
  'other',
] as const;
export type PaperType = (typeof PAPER_TYPES)[number];

/**
 * A paper one reader keeps for themselves (#203, #212): added by DOI, by hand or by PDF, and reachable by that
 * reader only. The public papers are authored files, not rows (see papers-catalog.service.ts, #213), so every
 * row here has an owner and is deleted with it.
 *
 * Identity, within one reader's papers: `doi` when there is one, otherwise `fingerprint` (see paper.normalize.ts
 * and the README). Nothing in the database enforces it; adds by one reader take turns instead (PapersService).
 */
@Entity('paper')
export class Paper {
  @PrimaryGeneratedColumn()
  id: number;

  /**
   * What addresses the paper from outside (URLs and the API): an opaque UUIDv7 made by PostgreSQL. The
   * integer `id` never leaves the server.
   */
  @Column({ type: 'uuid', default: () => 'uuidv7()', update: false })
  @Index('UQ_paper_publicId', { unique: true })
  publicId: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  abstract: string | null;

  /** Normalized: lowercase, no URL or `doi:` prefix. Many papers have none. */
  @Column({ type: 'text', nullable: true })
  doi: string | null;

  /** The reader's user id: only that reader can reach the paper. */
  @Column({ type: 'integer' })
  ownerId: number;

  /** Hash of normalized title, year and first author's family name; recomputed when they change. */
  @Column({ type: 'text' })
  fingerprint: string;

  @Column({ type: 'text', nullable: true })
  venue: string | null;

  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`: scholarly dates are often only a year. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  publicationDate: string | null;

  @Column({ type: 'text', nullable: true })
  url: string | null;

  @Column({ type: 'text', nullable: true })
  researchArea: string | null;

  @Column({ type: 'varchar', default: 'other' })
  type: PaperType;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
