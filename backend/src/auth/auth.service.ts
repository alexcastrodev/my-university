import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class AuthService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  async login(displayName: string): Promise<User> {
    const cleanName = displayName.trim();
    if (!cleanName) throw new BadRequestException('Name is required.');

    const normalizedName = cleanName.toLocaleLowerCase();
    const existing = await this.repo.findOne({ where: { normalizedName } });
    if (existing) return existing;

    return this.repo.save(this.repo.create({ displayName: cleanName, normalizedName }));
  }

  async findById(id: number): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    return user;
  }
}
