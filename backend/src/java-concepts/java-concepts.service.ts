import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface JavaConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface JavaConceptSection {
  title: string;
  content: string;
}

export interface JavaConceptSummary {
  slug: string;
  id: number;
  title: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
}

export interface JavaConceptDetail extends JavaConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: JavaConceptSection[];
  references: JavaConceptReference[];
}

interface ConceptMeta extends JavaConceptSummary {
  references: JavaConceptReference[];
}

const DATA_DIR = join(__dirname, '../seed/data/java-concepts');

function parseFrontmatter(raw: string): {
  body: string;
  version: string | null;
  updatedAt: string | null;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) return { body: raw, version: null, updatedAt: null };
  const [, frontmatter, body] = match;
  const version = /^version:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null;
  const updatedAt =
    /^updatedAt:\s*(.+)$/m.exec(frontmatter)?.[1]?.trim() ?? null;
  return { body, version, updatedAt };
}

function splitSections(body: string): JavaConceptSection[] {
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
export class JavaConceptsService {
  private readonly conceptsMeta: ConceptMeta[] = (
    require(join(DATA_DIR, 'concepts.json')) as ConceptMeta[]
  )
    .slice()
    .sort((a, b) => b.id - a.id);

  findAll(): JavaConceptSummary[] {
    return this.conceptsMeta.map(({ slug, id, title, summary, publishedAt, labUrl }) => ({
      slug,
      id,
      title,
      summary,
      publishedAt,
      ...(labUrl && { labUrl }),
    }));
  }

  findBySlug(slug: string): JavaConceptDetail | null {
    const meta = this.conceptsMeta.find((concept) => concept.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta);
  }

  findAllDetailed(): JavaConceptDetail[] {
    return this.conceptsMeta.map((meta) => this.readDetail(meta));
  }

  private readDetail(meta: ConceptMeta): JavaConceptDetail {
    const raw = readFileSync(
      join(DATA_DIR, 'content', `${meta.slug}.md`),
      'utf-8',
    );
    const { body, version, updatedAt } = parseFrontmatter(raw);

    return {
      slug: meta.slug,
      id: meta.id,
      title: meta.title,
      summary: meta.summary,
      publishedAt: meta.publishedAt,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      version,
      updatedAt,
      sections: splitSections(body),
      references: meta.references,
    };
  }
}
