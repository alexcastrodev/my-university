import { AwardView } from './achievements.model';

/** Everything the public profile endpoint returns, and nothing else. */
export interface PublicProfile {
  displayName: string;
  avatarUrl: string;
  level: { number: number; title: string };
  xp: number;
  badges: AwardView[];
  trophies: AwardView[];
}

/** One book on the library tab, as `GET /api/profile/:key/books` returns it. */
export interface PublicBook {
  title: string;
  url: string;
  pages: number;
  cover?: string;
  /** Plain text; paragraphs are separated by a line break. */
  comment?: string;
}
