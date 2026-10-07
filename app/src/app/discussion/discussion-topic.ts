import { FEATURE_ROUTES } from '../shared/concept-links';
import { DiscussionTopic } from './discussion.model';

/** Route prefix of every track that has discussions -> the module name the API knows it by. */
const TRACKS: [prefix: string, module: string][] = [
  ...Object.entries(FEATURE_ROUTES).map(
    ([feature, base]): [string, string] => [base, feature === 'system-design' ? 'system-design-concepts' : feature],
  ),
  ['/java/java-minute', 'java-minute'],
  ['/csharp-minute', 'csharp-minute'],
];

const CURRICULUM = /^\/computer-science\/([a-z0-9-]+)\/([a-z0-9-]+)\/([a-z0-9-]+)$/;

/** Which concept a page URL shows, or null for a page that has no discussions (lists, lessons, the dashboard...). */
export function topicFromUrl(url: string): Omit<DiscussionTopic, 'lang'> | null {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');

  const curriculum = CURRICULUM.exec(path);
  if (curriculum) return { module: curriculum[1], discipline: curriculum[2], slug: curriculum[3] };

  for (const [prefix, module] of TRACKS) {
    if (!path.startsWith(`${prefix}/`)) continue;
    const slug = path.slice(prefix.length + 1);
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return { module, slug };
  }
  return null;
}
