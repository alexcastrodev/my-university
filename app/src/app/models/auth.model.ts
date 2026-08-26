import { Language } from './language.model';

export interface User {
  id: number;
  displayName: string;
  githubLogin: string;
  avatarUrl: string;
  preferredLanguage: Language | null;
}
