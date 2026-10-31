import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** An object that must be removed from storage. A key stays here until the object is really gone. */
@Entity('storage_deletion')
export class StorageDeletion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  objectKey: string;

  @Column({ default: 0 })
  attempts: number;

  @CreateDateColumn({ name: 'queuedAt' })
  queuedAt: Date;
}
