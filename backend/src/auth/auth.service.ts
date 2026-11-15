import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeLanguage } from '../shared/language';
import { GithubProfile } from './github-oauth.service';
import { normalizeSlug, slugProblem } from './profile-slug';
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

    return this.createUser({ githubId, githubLogin: profile.login, displayName, avatarUrl: profile.avatar_url });
  }

  /** Every new user is a student, in the same transaction, so nobody exists for a moment without a role. */
  private createUser(data: Pick<User, 'githubId' | 'githubLogin' | 'displayName' | 'avatarUrl'>): Promise<User> {
    return this.repo.manager.transaction(async (m) => {
      const user = await m.save(User, m.create(User, data));
      await m.query(
        `INSERT INTO user_role ("userId", "roleId") SELECT $1, id FROM role WHERE name = 'student' ON CONFLICT DO NOTHING`,
        [user.id],
      );
      return user;
    });
  }

  /** The epoch the session cookie of this user must carry (see `session.ts`). */
  async sessionEpoch(userId: number): Promise<number> {
    const rows: { sessionEpoch: number }[] = await this.repo.query(`SELECT "sessionEpoch" FROM "user" WHERE id = $1`, [userId]);
    return rows[0]?.sessionEpoch ?? 0;
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

  /** Test-only: creates a fresh user without going through the GitHub OAuth flow, optionally with one more role by name. */
  async createTestUser(name: string, role?: string): Promise<User> {
    const user = await this.createUser({
      githubId: `test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      githubLogin: name,
      displayName: name,
      avatarUrl: 'https://avatars.githubusercontent.com/u/0',
    });
    if (role) {
      const found: unknown[] = await this.repo.query(`SELECT 1 FROM role WHERE name = $1`, [role]);
      if (found.length === 0) throw new BadRequestException(`no role named ${role}`);
      await this.repo.query(
        `INSERT INTO user_role ("userId", "roleId") SELECT $1, id FROM role WHERE name = $2 ON CONFLICT DO NOTHING`,
        [user.id, role],
      );
    }
    return user;
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

    return this.createUser({
      githubId,
      githubLogin: 'dev',
      displayName: 'Dev User',
      avatarUrl: 'https://avatars.githubusercontent.com/u/0',
    });
  }
}
