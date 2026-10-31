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
import { Paper } from '../papers/paper.entity';

/**
 * A reader's own PDF for a paper. Private: the owner is the only one who can reach it, and a public
 * `Paper` never lists it. One per paper and owner; replacing the file adds a version.
 */
@Entity('paper_attachment')
@Index('UQ_paper_attachment_paper_owner', ['paperId', 'ownerId'], {
  unique: true,
})
export class PaperAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  paperId: number;

  @ManyToOne(() => Paper, { onDelete: 'CASCADE' })
  paper: Paper;

  @Column()
  ownerId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  owner: User;

  /** Only `private` exists. Sharing a PDF is a copyright decision that needs its own product call. */
  @Column({ type: 'varchar', default: 'private' })
  visibility: 'private';

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
