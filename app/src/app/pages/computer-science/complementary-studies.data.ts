/**
 * Registry of the existing "Ensinos Complementares" areas and which Computer Science
 * module they relate to — the same mapping tracked as a backlog decision in tasks.md,
 * surfaced here so the Track page can render the relationship instead of just a link list.
 * `apiBase` matches each area's existing NestJS route exactly; nothing here changes those
 * routes or their content.
 */
export interface ComplementaryArea {
  slug: string;
  apiBase: string;
  title: string;
  routerLink: string;
  touchesModule: string;
  touchesTitle: string;
  relationship: string;
}

export const COMPLEMENTARY_AREAS: ComplementaryArea[] = [
  {
    slug: 'java-concepts',
    apiBase: '/api/java-concepts',
    title: 'Java Concepts',
    routerLink: '/java/java-concepts',
    touchesModule: 'foundations',
    touchesTitle: 'Foundations',
    relationship: 'Depth inside one language',
  },
  {
    slug: 'java-minute',
    apiBase: '/api/java-minute',
    title: 'Java Minute',
    routerLink: '/java/java-minute',
    touchesModule: 'foundations',
    touchesTitle: 'Foundations',
    relationship: 'Short-form companion to Java Concepts',
  },
  {
    slug: 'jvm-concepts',
    apiBase: '/api/jvm-concepts',
    title: 'JVM Concepts',
    routerLink: '/java/jvm-concepts',
    touchesModule: 'computer',
    touchesTitle: 'Computer',
    relationship: 'A concrete runtime, in detail',
  },
  {
    slug: 'testing-concepts',
    apiBase: '/api/testing-concepts',
    title: 'Testing',
    routerLink: '/java/testing',
    touchesModule: 'software-distributed',
    touchesTitle: 'Software + Distributed',
    relationship: 'Practice ahead of the theory',
  },
  {
    slug: 'spring-concepts',
    apiBase: '/api/spring-concepts',
    title: 'Spring',
    routerLink: '/spring-concepts',
    touchesModule: 'software-distributed',
    touchesTitle: 'Software + Distributed',
    relationship: 'An applied framework example',
  },
  {
    slug: 'quarkus-concepts',
    apiBase: '/api/quarkus-concepts',
    title: 'Quarkus',
    routerLink: '/quarkus-concepts',
    touchesModule: 'software-distributed',
    touchesTitle: 'Software + Distributed',
    relationship: 'An applied framework example',
  },
  {
    slug: 'ruby-concepts',
    apiBase: '/api/ruby-concepts',
    title: 'Ruby Concepts',
    routerLink: '/ruby-concepts',
    touchesModule: 'algorithms-software',
    touchesTitle: 'Algorithms & Software',
    relationship: 'Same paradigms, another language',
  },
  {
    slug: 'rubyonrails-concepts',
    apiBase: '/api/rubyonrails-concepts',
    title: 'Ruby on Rails',
    routerLink: '/rubyonrails-concepts',
    touchesModule: 'software-distributed',
    touchesTitle: 'Software + Distributed',
    relationship: 'An applied framework example',
  },
  {
    slug: 'database-concepts',
    apiBase: '/api/database-concepts',
    title: 'Database Concepts',
    routerLink: '/databases/database-concepts',
    touchesModule: 'systems',
    touchesTitle: 'Systems',
    relationship: 'The same concepts, informally',
  },
  {
    slug: 'system-design-concepts',
    apiBase: '/api/system-design-concepts',
    title: 'System Design',
    routerLink: '/system-design/system-design-concepts',
    touchesModule: 'systems',
    touchesTitle: 'Systems',
    relationship: 'Practice ahead of the theory',
  },
  {
    slug: 'algorithms-concepts',
    apiBase: '/api/algorithms-concepts',
    title: 'Algorithms',
    routerLink: '/algorithms/algorithms-concepts',
    touchesModule: 'algorithms-software',
    touchesTitle: 'Algorithms & Software',
    relationship: 'Sorting, searching, and graph algorithms',
  },
];
