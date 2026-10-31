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
 * The canonical bibliographic record of a paper, shared by every reader. It has no owner: a user's
 * relation to it (library entry, annotation, contribution) lives in its own table.
 *
 * Identity: `doi` when there is one, otherwise `fingerprint` (see paper.normalize.ts and the README).
 */
@Entity('paper')
@Index('UQ_paper_fingerprint_without_doi', ['fingerprint'], {
  unique: true,
  where: '"doi" IS NULL',
})
export class Paper {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  abstract: string | null;

  /** Normalized: lowercase, no URL or `doi:` prefix. Unique, and many papers have none. */
  @Column({ type: 'text', nullable: true, unique: true })
  doi: string | null;

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
