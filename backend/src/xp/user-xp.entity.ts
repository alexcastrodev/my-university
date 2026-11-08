import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../auth/user.entity';

@Entity('user_xp_entry')
export class UserXpEntry {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  sourceType:
    | 'lesson'
    | 'skill-check'
    | 'concept-read'
    | 'episode-watched'
    // A reader said they finished a concept's lab; worth more than reading it, and counts for no award.
    | 'lab-done'
    // The daily session was removed; its XP stays in the ledger.
    | 'daily-card'
    | 'badge'
    | 'trophy';

  @Column()
  sourceId: string;

  @Column({ default: 0 })
  exp: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
