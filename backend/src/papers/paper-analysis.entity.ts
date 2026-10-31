import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Sections } from './paper-analysis.sections';

export const ANALYSIS_STATUSES = [
  'draft',
  'published',
  'superseded',
  'withdrawn',
] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/**
 * One revision of the Research Analysis of a paper. A paper has at most one `draft` (the working copy)
 * and one `published` (what readers see); a published row is never edited, a change is a new draft that
 * replaces it when published, and the old one is kept as `superseded`. Both limits are partial unique
 * indexes in the migration.
 */
@Entity('paper_analysis')
export class PaperAnalysis {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  paperId: number;

  /** 1, 2, 3... per paper; assigned when the draft is created. */
  @Column()
  revision: number;

  @Column({ type: 'varchar' })
  status: AnalysisStatus;

  @Column({ type: 'jsonb', default: () => `'{}'` })
  sections: Sections;

  /** The curator who started this revision. Null once that account is deleted. */
  @Column({ type: 'int', nullable: true })
  authorId: number | null;

  @Column({ type: 'int', nullable: true })
  publishedById: number | null;

  @Column({ type: 'timestamp', nullable: true })
  publishedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

export const ANALYSIS_ACTIONS = [
  'draft_created',
  'draft_edited',
  'published',
  'withdrawn',
] as const;
export type AnalysisAction = (typeof ANALYSIS_ACTIONS)[number];

/** The audit trail: who did what to which revision, in order. */
@Entity('paper_analysis_event')
export class PaperAnalysisEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  analysisId: number;

  @Column({ type: 'varchar' })
  action: AnalysisAction;

  @Column({ type: 'int', nullable: true })
  actorId: number | null;

  @CreateDateColumn()
  createdAt: Date;
}
