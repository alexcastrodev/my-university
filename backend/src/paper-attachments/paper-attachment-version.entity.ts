import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';
import { PaperAttachment } from './paper-attachment.entity';

/**
 * `pending`: stored, waiting for its scan, never served. `approved`: passed, the one that is served.
 * `rejected`: failed the scan, bytes deleted, reason kept. `superseded`: replaced by a newer approved
 * version, bytes deleted, metadata kept so a later feature can tell the file changed.
 */
export const VERSION_STATES = [
  'pending',
  'approved',
  'rejected',
  'superseded',
] as const;
export type VersionState = (typeof VERSION_STATES)[number];

@Entity('paper_attachment_version')
export class PaperAttachmentVersion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  attachmentId: number;

  @ManyToOne(() => PaperAttachment, { onDelete: 'CASCADE' })
  attachment: PaperAttachment;

  @Column()
  version: number;

  @Column({ type: 'varchar' })
  state: VersionState;

  /** Opaque (`papers/<uuid>`), never derived from the file name. Null once the bytes are gone. */
  @Column({ type: 'text', nullable: true })
  objectKey: string | null;

  /** What the uploader called it. Display only: it is never part of a storage path. */
  @Column({ type: 'text' })
  originalName: string;

  /** Decided by the content, never by what the client declared. */
  @Column({ type: 'varchar', default: 'application/pdf' })
  mimeType: 'application/pdf';

  /** Bytes. `bigint` comes back from the driver as a string. */
  @Column({ type: 'bigint' })
  size: string;

  @Column({ type: 'char', length: 64 })
  sha256: string;

  @Column()
  uploadedById: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  uploadedBy: User;

  /** Why it was refused, as a stable code (see ScanCode, or `expired`); a client maps it to its own words. */
  @Column({ type: 'varchar', nullable: true })
  rejectCode: string | null;

  @Column({ type: 'text', nullable: true })
  rejectReason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  scannedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
