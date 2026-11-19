import { Language } from './language.model';

export interface MinuteReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface MinuteSection {
  title: string;
  content: string;
}

export interface MinuteEpisodeSummary {
  slug: string;
  id: number;
  question: string;
  publishedAt: string;
  labUrl?: string;
  read: boolean;
  language: Language;
  availableLanguages: Language[];
}

export interface MinuteEpisode extends MinuteEpisodeSummary {
  version: string | null;
  updatedAt: string | null;
  sections: MinuteSection[];
  references: MinuteReference[];
}
