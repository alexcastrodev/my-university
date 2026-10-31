import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeLanguage } from '../shared/language';
import { GithubProfile } from './github-oauth.service';
import { normalizeSlug, slugProblem } from './profile-slug';
import { ROLES } from './roles';
import { User } from './user.entity';

/** Returns a copy of `user` with `displayName` replaced by the effective value (override, if set). Does not persist anything. */
function withEffectiveDisplayName(user: User): User {
  if (!user.displayNameOverride) return user;
  return { ...user, displayName: user.displayNameOverride };
}

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
    return withEffectiveDisplayName(user);
  }

  /**
   * Sets (or clears, when `displayName` is empty/whitespace) the user's display name override.
   * Never touches the raw `displayName` column, which stays in sync with GitHub via `upsertFromGithub`.
   */
  async updateDisplayNameOverride(id: number, displayName: string | null): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    user.displayNameOverride = displayName?.trim() || null;
    await this.repo.save(user);
    return withEffectiveDisplayName(user);
  }

  /** Sets the user's saved content-language preference (e.g. 'en', 'pt-BR'). Invalid values normalize to English. */
  async updatePreferredLanguage(id: number, language: string): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    user.preferredLanguage = normalizeLanguage(language);
    await this.repo.save(user);
    return withEffectiveDisplayName(user);
  }

  /** Turns the public profile (and the leaderboard listing) on or off for this user. */
  async updateNotifyReplies(id: number, notifyReplies: boolean): Promise<void> {
    await this.repo.update(id, { notifyReplies });
  }

  async updateProfilePublic(id: number, profilePublic: boolean): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    user.profilePublic = profilePublic;
    await this.repo.save(user);
    return withEffectiveDisplayName(user);
  }

  /**
   * Sets the vanity slug of the public link, or clears it (`null` or blank) to go back to the id link only.
   * The slug is normalized to lowercase. A rule broken is a 400 and a name already used is a 409, each with a
   * `code` the app turns into words; the unique index decides who is first, so two requests cannot both win.
   */
  async updateProfileSlug(id: number, raw: string | null): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException();
    const slug = raw === null || raw.trim() === '' ? null : normalizeSlug(raw);
    if (slug !== null) {
      const problem = slugProblem(slug);
      if (problem) throw new BadRequestException({ code: problem, message: `Invalid profile link: ${problem}` });
    }
    if (user.profileSlug === slug) return withEffectiveDisplayName(user);
    user.profileSlug = slug;
    try {
      await this.repo.save(user);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new ConflictException({ code: 'taken', message: 'That profile link is taken' });
      throw error;
    }
    return withEffectiveDisplayName(user);
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

  /** Test-only: gives a user staff roles, the way someone with database access would in production. */
  async setRoles(userId: number, roles: string[]): Promise<void> {
    if (!Array.isArray(roles) || roles.some((r) => !(ROLES as readonly string[]).includes(r))) {
      throw new BadRequestException(`roles must be a list of: ${ROLES.join(', ')}`);
    }
    await this.repo.update(userId, { roles });
  }

  /** Test-only: deletes every user created via `createTestUser`, and their XP rows via cascade, so repeated spec runs don't pollute things like the leaderboard. */
  async deleteTestUsers(): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .delete()
      .where('githubId LIKE :prefix', { prefix: 'test-%' })
      .execute();
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
