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
