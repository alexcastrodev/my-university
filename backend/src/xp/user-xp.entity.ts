import { Column, Entity, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
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
  sourceType: 'lesson' | 'skill-check';

  @Column()
  sourceId: string;

  @Column({ default: 0 })
  exp: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
