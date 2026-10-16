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

  /** User's saved content-language preference (e.g. 'en', 'pt-BR'). Null means no preference saved yet. */
  @Column({ type: 'varchar', nullable: true })
  preferredLanguage: string | null;

  /** Whether the public profile (`/u/<publicProfileId>`) and the leaderboard may show this user. On by default. */
  @Column({ default: true })
  profilePublic: boolean;

  /** Stable public id of the profile, set once by the database (`uuidv7()`). Never derived from the login, never client-writable. */
  @Column({ type: 'uuid', unique: true, default: () => 'uuidv7()' })
  publicProfileId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
