import { Language } from './language.model';

export interface JavaMinuteReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface JavaMinuteSection {
  title: string;
  content: string;
}

export interface JavaMinuteEpisodeSummary {
  slug: string;
  id: number;
  question: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface JavaMinuteEpisode extends JavaMinuteEpisodeSummary {
  version: string | null;
  updatedAt: string | null;
  sections: JavaMinuteSection[];
  references: JavaMinuteReference[];
}
