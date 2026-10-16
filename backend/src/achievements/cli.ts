/**
 * Maintenance CLI for achievements. From backend/: `pnpm achievements <command>`; in the API image:
 * `node dist/achievements/cli.js <command>`.
 *
 *   snapshot                              freeze the units of every active track and session into
 *                                         `published.json`, the compatibility reference the specs compare
 *                                         the live seeds against: later changes may only add units. Run it
 *                                         when a track or session is first published, never to hide a removal.
 *   backfill [--apply] [--report file.json]
 *                                         record awards users already earned, on every active track. A dry
 *                                         run unless `--apply`. Uses the same evaluator as live sync, so
 *                                         re-running changes nothing.
 */
import 'reflect-metadata';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { User } from '../auth/user.entity';
import { UserXpEntry } from '../xp/user-xp.entity';
import { XpService } from '../xp/xp.service';
import { PublishedSnapshot, unitKey } from './catalog';
import { getCatalog } from './load-seed';

export const PUBLISHED_PATH = join(__dirname, '../../src/achievements/published.json');

/** One entry per line so a removed or added unit shows up as a readable diff. */
function format(snapshot: PublishedSnapshot): string {
  const block = (name: string, entries: Record<string, string[]>) =>
    `  "${name}": {\n${Object.entries(entries).map(([id, units]) => `    "${id}": ${JSON.stringify(units)}`).join(',\n')}\n  }`;
  return `{\n${block('tracks', snapshot.tracks)},\n${block('sessions', snapshot.sessions)}\n}\n`;
}

export function buildSnapshot(): PublishedSnapshot {
  const catalog = getCatalog();
  const errors = catalog.problems.filter((p) => p.level === 'error');
  if (errors.length) throw new Error(`refusing to snapshot an invalid catalog:\n${errors.map((e) => e.message).join('\n')}`);
  const snapshot: PublishedSnapshot = { tracks: {}, sessions: {} };
  for (const track of catalog.tracks.filter((t) => t.status === 'active')) {
    snapshot.tracks[track.trackId] = track.units.map(unitKey);
    for (const session of track.sessions) snapshot.sessions[session.sessionId] = session.units.map(unitKey);
  }
  return snapshot;
}

export interface BackfillReport {
  mode: 'dry-run' | 'apply';
  /** Active, valid tracks the run looked at. */
  tracks: number;
  users: number;
  usersAffected: number;
  awards: number;
  xp: number;
  /** Per affected user (ids only, no personal data): what was, or would be, recorded, and the XP total before. */
  perUser: { userId: number; xpBefore: number; awards: { type: string; id: string; title: string; exp: number; awardedAt: string }[] }[];
}

const option = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

export async function backfill(args: string[]): Promise<BackfillReport> {
  const apply = args.includes('--apply');
  const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5432/ocp_java',
    entities: [User, UserXpEntry],
  });
  await dataSource.initialize();
  try {
    const xp = new XpService(dataSource.getRepository(UserXpEntry));
    const users = await dataSource.getRepository(User).find({ select: { id: true }, order: { id: 'ASC' } });
    const tracks = getCatalog().tracks.filter((t) => t.valid && t.status === 'active').length;
    const report: BackfillReport = { mode: apply ? 'apply' : 'dry-run', tracks, users: users.length, usersAffected: 0, awards: 0, xp: 0, perUser: [] };
    for (const { id } of users) {
      const xpBefore = (await xp.getUserXp(id)).total;
      const awards = apply ? await xp.syncAchievements(id) : await xp.previewAchievements(id);
      if (awards.length === 0) continue;
      report.usersAffected += 1;
      report.awards += awards.length;
      report.xp += awards.reduce((sum, a) => sum + a.exp, 0);
      report.perUser.push({ userId: id, xpBefore, awards: awards.map((a) => ({ type: a.type, id: a.id, title: a.title, exp: a.exp, awardedAt: a.awardedAt })) });
    }
    return report;
  } finally {
    await dataSource.destroy();
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'snapshot') {
    writeFileSync(PUBLISHED_PATH, format(buildSnapshot()));
    console.log(`wrote ${PUBLISHED_PATH}`);
  } else if (command === 'backfill') {
    const report = await backfill(args);
    const file = option(args, '--report');
    if (file) writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    const verb = report.mode === 'apply' ? 'recorded' : 'would record';
    console.log(`${report.mode}: ${verb} ${report.awards} award(s), ${report.xp} XP, for ${report.usersAffected} of ${report.users} user(s) on ${report.tracks} track(s)`);
    if (!file) console.log(JSON.stringify(report.perUser, null, 2));
  } else {
    console.error('usage: achievements snapshot | backfill [--apply] [--report file.json]');
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
