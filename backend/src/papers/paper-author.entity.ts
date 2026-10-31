import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** One author of a paper, in the order the paper lists them. */
@Entity('paper_author')
@Unique('UQ_paper_author_position', ['paperId', 'position'])
export class PaperAuthor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  paperId: number;

  @Column()
  position: number;

  /** Display name as the source gave it, either "Given Family" or "Family, Given". */
  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'varchar', length: 19, nullable: true })
  orcid: string | null;
}
