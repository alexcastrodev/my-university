import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export interface PaperConflict {
  field: string;
  current: unknown;
  incoming: unknown;
  /** `kept-current` for an import that disagrees, `replaced` for an explicit correction. */
  resolution: 'kept-current' | 'replaced';
}

/**
 * Where a piece of metadata came from. One row per write that touched the paper, holding the record
 * as received and the disagreements it had with what was already stored, so nothing is lost when an
 * import is not allowed to overwrite a field.
 */
@Entity('paper_source')
export class PaperSource {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  paperId: number;

  /** `manual`, `crossref`, `openalex`, ... */
  @Column({ type: 'varchar' })
  source: string;

  /** The record's id at that source, when it has one. */
  @Column({ type: 'varchar', nullable: true })
  externalId: string | null;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'jsonb', default: () => `'[]'` })
  conflicts: PaperConflict[];

  @CreateDateColumn()
  retrievedAt: Date;
}
