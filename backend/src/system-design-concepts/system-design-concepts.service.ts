import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';

export type SystemDesignConceptDifficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface SystemDesignConceptReference {
  label: string;
  url: string;
  type: 'book' | 'paper' | 'engineering' | 'doc' | 'video';
}

export interface SystemDesignConceptSection {
  title: string;
  content: string;
}

export interface SystemDesignConceptSummary {
  slug: string;
  id: number;
  title: string;
  summary: string;
  publishedAt: string;
  difficulty: SystemDesignConceptDifficulty;
  readingTime: number;
  tags: string[];
  prerequisites: string[];
  related: string[];
}

export interface SystemDesignConceptDetail extends SystemDesignConceptSummary {
  sections: SystemDesignConceptSection[];
  references: SystemDesignConceptReference[];
}

interface ConceptMeta extends SystemDesignConceptSummary {
  references: SystemDesignConceptReference[];
}

interface SystemDesignConceptFrontmatter {
  title?: string;
  description?: string;
  difficulty?: SystemDesignConceptDifficulty;
  readingTime?: number;
  tags?: string[];
  prerequisites?: string[];
  related?: string[];
}

const DATA_DIR = join(__dirname, '../seed/data/system-design-concepts');

function parseFrontmatter(raw: string): {
  body: string;
  frontmatter: SystemDesignConceptFrontmatter;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) return { body: raw, frontmatter: {} };
  const [, frontmatterBlock, body] = match;
  const frontmatter = (yaml.load(frontmatterBlock) as SystemDesignConceptFrontmatter) ?? {};
  return { body, frontmatter };
}

function splitSections(body: string): SystemDesignConceptSection[] {
  const matches = [...body.matchAll(/^## (.+)$/gm)];
  return matches.map((match, i) => {
    const contentStart = (match.index ?? 0) + match[0].length;
    const contentEnd =
      i + 1 < matches.length
        ? (matches[i + 1].index ?? body.length)
        : body.length;
    return {
      title: match[1].trim(),
      content: body.slice(contentStart, contentEnd).trim(),
    };
  });
}

@Injectable()
export class SystemDesignConceptsService {
  private readonly conceptsMeta: ConceptMeta[] = (
    require(join(DATA_DIR, 'concepts.json')) as ConceptMeta[]
  )
    .slice()
    .sort((a, b) => b.id - a.id);

  findAll(): SystemDesignConceptSummary[] {
    return this.conceptsMeta.map(
      ({ slug, id, title, summary, publishedAt, difficulty, readingTime, tags, prerequisites, related }) => ({
        slug,
        id,
        title,
        summary,
        publishedAt,
        difficulty,
        readingTime,
        tags,
        prerequisites,
        related,
      }),
    );
  }

  findBySlug(slug: string): SystemDesignConceptDetail | null {
    const meta = this.conceptsMeta.find((concept) => concept.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta);
  }

  findAllDetailed(): SystemDesignConceptDetail[] {
    return this.conceptsMeta.map((meta) => this.readDetail(meta));
  }

  private readDetail(meta: ConceptMeta): SystemDesignConceptDetail {
    const raw = readFileSync(
      join(DATA_DIR, 'content', `${meta.slug}.md`),
      'utf-8',
    );
    // js-yaml parses the frontmatter block so it can be typed/validated; the
    // structured metadata below still comes from concepts.json (same source
    // of truth as the other concept modules), matching this module's frontmatter.
    const { body } = parseFrontmatter(raw);

    return {
      slug: meta.slug,
      id: meta.id,
      title: meta.title,
      summary: meta.summary,
      publishedAt: meta.publishedAt,
      difficulty: meta.difficulty,
      readingTime: meta.readingTime,
      tags: meta.tags,
      prerequisites: meta.prerequisites,
      related: meta.related,
      sections: splitSections(body),
      references: meta.references,
    };
  }
}
