import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { PaperAnnotation } from './paper-annotation.entity';
import type { AnnotationKind } from './paper-annotation.entity';

/** A bookmark says nothing worth publishing; everything else a reader wrote can be shared. */
export const SHAREABLE_KINDS = ['note', 'highlight', 'comment', 'question'] as const;

/** `public` is anyone who opens the paper, signed in or not; `users` is the readers named in the recipients. */
export const VISIBILITIES = ['public', 'users'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/**
 * What a reader chose to publish (#187): a copy of one annotation, made when they shared it, that lives apart
 * from the private one. Nothing in the private annotation is read through it: no rectangles, no context around
 * the quote, no PDF version, no way back to the library entry or the file. The quote is cut short on purpose, so
 * sharing a highlight shares a few words of the paper, never its text at length and never its bytes.
 *
 * Only a public paper has shares (a private paper's very existence is its owner's). Deleting the annotation
 * deletes its share, which is also how removing the paper from the library (and the account) unpublishes it.
 * Replacing the PDF does not: the copy never depended on the file.
 */
@Entity('paper_annotation_share')
@Index('IDX_paper_annotation_share_paper', ['paperSlug', 'visibility'])
export class PaperAnnotationShare {
  @PrimaryColumn({ type: 'uuid', default: () => 'uuidv7()' })
  id: string;

  /** One share per annotation: sharing again replaces the copy and the audience. */
  @Column({ type: 'uuid', unique: true })
  annotationId: string;

  @ManyToOne(() => PaperAnnotation, { onDelete: 'CASCADE' })
  annotation: PaperAnnotation;

  @Column({ type: 'varchar', length: 100 })
  paperSlug: string;

  @Index('IDX_paper_annotation_share_author')
  @Column()
  authorId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  author: User;

  @Column({ type: 'varchar', length: 8 })
  visibility: Visibility;

  @Column({ type: 'varchar', length: 16 })
  kind: AnnotationKind;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  /** Where the author's PDF had it. Another copy of the paper may paginate differently, so it is a hint. */
  @Column({ type: 'integer', nullable: true })
  page: number | null;

  /** The passage, up to `QUOTE_MAX` characters. */
  @Column({ type: 'text', nullable: true })
  quote: string | null;

  @CreateDateColumn()
  createdAt: Date;

  /** The last time the copy was made from the annotation. */
  @UpdateDateColumn()
  updatedAt: Date;
}

/** A reader a `users` share is for. */
@Entity('paper_annotation_share_recipient')
export class PaperAnnotationShareRecipient {
  @PrimaryColumn({ type: 'uuid' })
  shareId: string;

  @ManyToOne(() => PaperAnnotationShare, { onDelete: 'CASCADE' })
  share: PaperAnnotationShare;

  @Index('IDX_paper_annotation_share_recipient_user')
  @PrimaryColumn()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;
}
