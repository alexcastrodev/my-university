import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * A paragraph (or code block) of a concept that has a discussion. Rows are created lazily by
 * the first comment on that block, so the "+" marker of an empty paragraph has no row.
 * `topicKey` is `<sourceType>:<sourceId>`, the identity XP and review already use for a concept.
 */
@Entity('discussion_marker')
@Unique('UQ_discussion_marker_anchor', [
  'topicKey',
  'lang',
  'anchorKey',
  'blockIndex',
])
export class DiscussionMarker {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  topicKey: string;

  @Column()
  lang: string;

  /** Hash of the block's normalized text, computed by the client. */
  @Column()
  anchorKey: string;

  /** Position among the concept's blocks, to tell apart blocks with identical text. */
  @Column()
  blockIndex: number;

  /** Start of the block's text, shown on top of the discussion and used to re-find it after edits. */
  @Column()
  quote: string;

  @CreateDateColumn()
  createdAt: Date;
}
