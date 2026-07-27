import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GithubProfile } from './github-oauth.service';
import { User } from './user.entity';

@Injectable()
export class AuthService {
  constructor(@InjectRepository(User) private repo: Repository<User>) {}

  async upsertFromGithub(profile: GithubProfile): Promise<User> {
    const githubId = String(profile.id);
    const existing = await this.repo.findOne({ where: { githubId } });
    const displayName = profile.name ?? profile.login;

    if (existing) {
      existing.githubLogin = profile.login;
      existing.displayName = displayName;
      existing.avatarUrl = profile.avatar_url;
      return this.repo.save(existing);
    }

    return this.repo.save(
      this.repo.create({
        githubId,
        githubLogin: profile.login,
        displayName,
        avatarUrl: profile.avatar_url,
      }),
    );
  }

  async findById(id: number): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    return user;
  }

  /** Test-only: creates a fresh user without going through the GitHub OAuth flow. */
  async createTestUser(name: string): Promise<User> {
    return this.repo.save(
      this.repo.create({
        githubId: `test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        githubLogin: name,
        displayName: name,
        avatarUrl: 'https://avatars.githubusercontent.com/u/0',
      }),
    );
  }

  /** Dev-only: finds or creates a single stable local account so XP/progress survive across dev logins. */
  async upsertDevUser(): Promise<User> {
    const githubId = 'local-dev';
    const existing = await this.repo.findOne({ where: { githubId } });
    if (existing) return existing;

    return this.repo.save(
      this.repo.create({
        githubId,
        githubLogin: 'dev',
        displayName: 'Dev User',
        avatarUrl: 'https://avatars.githubusercontent.com/u/0',
      }),
    );
  }
}
