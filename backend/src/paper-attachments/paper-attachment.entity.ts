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
 * A reader's own PDF for a paper. Private: the owner is the only one who can reach it, and no paper
 * ever lists it. One per paper and owner; replacing the file adds a version.
 */
@Entity('paper_attachment')
@Index('UQ_paper_attachment_paper_owner', ['paperId', 'ownerId'], {
  unique: true,
})
@Index('UQ_paper_attachment_slug_owner', ['paperSlug', 'ownerId'], {
  unique: true,
})
export class PaperAttachment {
  @PrimaryGeneratedColumn()
  id: number;

  /** The reader's own private paper; null for a public one, which is named by `paperSlug`. */
  @Column({ type: 'integer', nullable: true })
  paperId: number | null;

  @ManyToOne(() => Paper, { onDelete: 'CASCADE', nullable: true })
  paper: Paper | null;

  /** The slug of a public paper (the papers are files, there is no row); null for a private one. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  paperSlug: string | null;

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
