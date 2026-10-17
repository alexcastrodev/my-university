import { Language } from './language.model';

export interface User {
  id: number;
  displayName: string;
  githubLogin: string;
  avatarUrl: string;
  preferredLanguage: Language | null;
  /** Absent in a user cached before profiles existed; `bootstrap()` refreshes it from the server. */
  profilePublic?: boolean;
  /** Whether replies to the user's comments create notifications; absent in a cached user means on. */
  notifyReplies?: boolean;
  publicProfileId?: string;
  /** The vanity part of the public link the user chose; null or absent means only the id link exists. */
  profileSlug?: string | null;
}
