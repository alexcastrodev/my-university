export type SearchResultType = 'course' | 'lesson' | 'java-minute' | 'java-concept';

export interface SearchResult {
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  url: string;
}
