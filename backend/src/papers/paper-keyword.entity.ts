import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** A keyword of a paper, stored lowercase so the same tag is never twice on one paper. */
@Entity('paper_keyword')
@Unique('UQ_paper_keyword', ['paperId', 'keyword'])
export class PaperKeyword {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  paperId: number;

  @Column({ type: 'text' })
  keyword: string;
}
