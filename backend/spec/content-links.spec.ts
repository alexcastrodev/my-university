import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { sitemap } from './sitemap-fixture';

// Every link a concept makes to another page must land on a page that exists. A link that does not
// is a 404 for readers and a wasted crawl for search engines (Search Console reports it as "Not found").
// Pure: it reads the seed content from disk and the routes from the sitemap, no API or Postgres.

const DATA = join(__dirname, '../src/seed/data');

/** The `feature` names a `related` entry may use, with the page each one lives under.
 *  Mirrors FEATURE_ROUTES in app/src/app/shared/concept-links.ts. */
const FEATURE_ROUTES: Record<string, string> = {
  'java-concepts': '/java/java-concepts',
  'jvm-concepts': '/java/jvm-concepts',
  'spring-concepts': '/spring-concepts',
  'database-concepts': '/databases/database-concepts',
  'system-design': '/system-design/system-design-concepts',
  'ruby-concepts': '/ruby-concepts',
  'rubyonrails-concepts': '/rubyonrails-concepts',
  'quarkus-concepts': '/quarkus-concepts',
  'kubernetes-concepts': '/kubernetes-concepts',
  'algorithms-concepts': '/algorithms/algorithms-concepts',
  'testing-concepts': '/java/testing',
  'dotnet-concepts': '/dotnet-concepts',
  'csharp-concepts': '/csharp-concepts',
  'dotnet-testing-concepts': '/dotnet-testing-concepts',
};
/** The system design pages resolve `related` against their own, smaller set of features. */
const SYSTEM_DESIGN_FEATURES = ['system-design', 'database', 'spring-concepts'];
const FEATURE_ALIASES: Record<string, string> = {
  database: 'database-concepts',
};

/** Where a seed folder's concepts are served: `java-concepts` -> /java/java-concepts,
 *  `curriculum/<module>/<discipline>` -> /computer-science/<module>/<discipline>. */
function pageBase(dir: string): string | null {
  const parts = dir.split('/');
  if (parts[0] === 'curriculum' && parts.length === 3)
    return `/computer-science/${parts[1]}/${parts[2]}`;
  const feature = dir === 'system-design-concepts' ? 'system-design' : dir;
  return FEATURE_ROUTES[feature] ?? null;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const seedFiles = walk(DATA).map((f) => ({
  abs: f,
  rel: relative(DATA, f).split(sep).join('/'),
}));

async function knownPaths(): Promise<Set<string>> {
  return new Set((await sitemap.buildUrls()).map((u) => u.path));
}

describe('concept links (pure, no API)', () => {
  it('points every related/prerequisite entry of every concepts.json at a page that exists', async () => {
    const paths = await knownPaths();
    const problems: string[] = [];

    for (const { abs, rel } of seedFiles.filter((f) =>
      f.rel.endsWith('/concepts.json'),
    )) {
      const dir = rel.slice(0, -'/concepts.json'.length);
      const base = pageBase(dir);
      if (!base) continue; // not a concept track (courses, papers, minute episodes)
      const refs: { label: string; slug: string; feature?: string }[] = [];
      const collect = (node: unknown): void => {
        if (Array.isArray(node)) node.forEach(collect);
        else if (node && typeof node === 'object') {
          const o = node as Record<string, unknown>;
          if (typeof o.label === 'string' && typeof o.slug === 'string')
            refs.push(o as never);
          Object.values(o).forEach(collect);
        }
      };
      collect(JSON.parse(readFileSync(abs, 'utf8')));

      for (const ref of refs) {
        let target: string | null;
        if (!ref.feature) target = `${base}/${ref.slug}`;
        else if (ref.feature.startsWith('curriculum/'))
          target = `/computer-science/${ref.feature.slice('curriculum/'.length)}/${ref.slug}`;
        else if (
          dir === 'system-design-concepts' &&
          !SYSTEM_DESIGN_FEATURES.includes(ref.feature)
        )
          target = null;
        else {
          const route =
            FEATURE_ROUTES[FEATURE_ALIASES[ref.feature] ?? ref.feature];
          target = route ? `${route}/${ref.slug}` : null;
        }
        if (!target)
          problems.push(
            `${rel}: "${ref.label}" uses the unknown feature "${ref.feature}"`,
          );
        else if (!paths.has(target))
          problems.push(
            `${rel}: "${ref.label}" links to ${target}, which is not a page`,
          );
      }
    }
    expect(problems).toEqual([]);
  });

  it('points every link written in a concept markdown at a page that exists', async () => {
    const paths = await knownPaths();
    const problems: string[] = [];
    const link = /(?<!!)\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

    for (const { abs, rel } of seedFiles.filter((f) => f.rel.endsWith('.md'))) {
      const parts = rel.split('/');
      const lang = parts[parts.length - 1].replace(/\.md$/, '');
      let page: string | null = null;
      if (parts.length === 4 && parts[1] === 'content') {
        const base = pageBase(parts[0]);
        if (base) page = `${base}/${parts[2]}`;
      } else if (
        parts.length === 6 &&
        parts[0] === 'curriculum' &&
        parts[3] === 'content'
      ) {
        page = `/computer-science/${parts[1]}/${parts[2]}/${parts[4]}`;
      }
      if (!page || (lang !== 'en' && lang !== 'pt-BR')) continue;

      let inCode = false;
      readFileSync(abs, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.trimStart().startsWith('```')) inCode = !inCode;
          if (inCode) return;
          for (const [, target] of line
            .replaceAll(/`[^`]*`/g, '')
            .matchAll(link)) {
            if (/^(https?:|mailto:|tel:|#)/.test(target)) continue;
            // A reader on the pt-BR page follows a relative link inside /pt-BR, an absolute one stays as written.
            const from = (lang === 'pt-BR' ? '/pt-BR' : '') + page;
            const resolved = new URL(
              target,
              `https://university.test${from}`,
            ).pathname.replace(/^\/pt-BR(?=\/)/, '');
            if (
              !paths.has(resolved) &&
              !paths.has(resolved.replace(/\/$/, ''))
            ) {
              problems.push(
                `${rel}:${i + 1}: (${target}) resolves to ${resolved}, which is not a page`,
              );
            }
          }
        });
    }
    expect(problems).toEqual([]);
  });
});
