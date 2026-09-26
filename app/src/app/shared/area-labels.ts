import { CURRICULUM } from '../pages/computer-science/curriculum.data';

/**
 * Short, human labels for where a concept lives, used by the mobile cards' breadcrumbs
 * ("Java › JVM", "Computer Science › Data Structures I"). `module` is what the backend sends:
 * a Complementary Studies module slug (`jvm-concepts`) or a Computer Science module slug
 * (`foundations`), with `discipline` set only for the latter.
 */
const COMPLEMENTARY: Record<string, [group: string, track?: string]> = {
  'java-concepts': ['Java', $localize`:@@area.track.concepts:Concepts`],
  'jvm-concepts': ['Java', 'JVM'],
  'testing-concepts': ['Java', $localize`:@@area.track.testing:Testing`],
  'java-minute': ['Java', 'Java Minute'],
  'spring-concepts': ['Spring'],
  'quarkus-concepts': ['Quarkus'],
  'database-concepts': [$localize`:@@area.group.databases:Databases`],
  'system-design-concepts': [$localize`:@@header.nav.systemDesign:System Design`],
  'kubernetes-concepts': ['Kubernetes'],
  'algorithms-concepts': [$localize`:@@area.group.algorithms:Algorithms`],
  'ruby-concepts': ['Ruby'],
  'rubyonrails-concepts': ['Ruby', 'Rails'],
};

export const COMPUTER_SCIENCE_LABEL = $localize`:@@header.nav.computerScience:Computer Science`;

export function areaBreadcrumb(module: string | undefined, discipline?: string): string[] {
  if (!module) return [];
  const complementary = COMPLEMENTARY[module];
  if (complementary) return complementary.filter((part): part is string => !!part);
  if (module === 'computer-science') return [COMPUTER_SCIENCE_LABEL];

  const mod = CURRICULUM.find((m) => m.slug === module);
  if (!mod) return [];
  const disc =
    mod.disciplines?.find((d) => d.slug === discipline) ??
    mod.tracks?.find((t) => t.slug === discipline);
  return [COMPUTER_SCIENCE_LABEL, disc?.title ?? mod.title];
}
