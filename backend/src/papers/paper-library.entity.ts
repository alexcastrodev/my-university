import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { Paper } from './paper.entity';

export const LIBRARY_STATUSES = ['to-read', 'reading', 'read'] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

/**
 * A paper in one reader's private library. The paper itself stays shared: this row only says "this
 * user keeps it, reads it, rated it". It points at a public paper by its slug (`paperSlug`, the papers are
 * files) or at one of the reader's own private papers by its row (`paperId`), never both. One row per user
 * and paper; removing it leaves a public paper alone.
 */
@Entity('paper_library_entry')
@Index('UQ_paper_library_user_paper', ['userId', 'paperId'], { unique: true })
@Index('UQ_paper_library_user_slug', ['userId', 'paperSlug'], { unique: true })
export class PaperLibraryEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column({ type: 'integer', nullable: true })
  paperId: number | null;

  @ManyToOne(() => Paper, { onDelete: 'CASCADE', nullable: true })
  paper: Paper | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  paperSlug: string | null;

  @Column({ type: 'varchar', default: 'to-read' })
  status: LibraryStatus;

  /** 1 to 5, or null when the reader has not rated it. */
  @Column({ type: 'smallint', nullable: true })
  rating: number | null;

  /** The reader's own labels, lowercase and unique; see paper-library.dto.ts for the limits. */
  @Column('text', { array: true, default: () => "'{}'" })
  tags: string[];

  /** The day the reader finished it (`YYYY-MM-DD`); only a paper with status `read` has one. */
  @Column({ type: 'date', nullable: true })
  completedAt: string | null;

  @CreateDateColumn()
  addedAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
