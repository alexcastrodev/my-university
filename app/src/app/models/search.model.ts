export type SearchResultType =
  | 'course'
  | 'lesson'
  | 'java-minute'
  | 'java-concept'
  | 'jvm-concept'
  | 'database-concept'
  | 'spring-concept'
  | 'system-design-concept'
  | 'testing-concept'
  | 'algorithms-concept'
  | 'ruby-concept'
  | 'rubyonrails-concept';

export interface SearchResult {
  type: SearchResultType;
  title: string;
  subtitle: string | null;
  url: string;
}
