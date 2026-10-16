import { Language } from './language.model';

export interface User {
  id: number;
  displayName: string;
  githubLogin: string;
  avatarUrl: string;
  preferredLanguage: Language | null;
  /** Absent in a user cached before profiles existed; `bootstrap()` refreshes it from the server. */
  profilePublic?: boolean;
  publicProfileId?: string;
}
