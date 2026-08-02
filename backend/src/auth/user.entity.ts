import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  githubId: string;

  @Column()
  githubLogin: string;

  @Column()
  displayName: string;

  @Column()
  avatarUrl: string;

  /** User-set override for `displayName`, shown instead of the raw GitHub name. Null means "use the GitHub name". */
  @Column({ type: 'varchar', nullable: true })
  displayNameOverride: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
