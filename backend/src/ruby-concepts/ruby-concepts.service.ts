import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface RubyConceptReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface RubyConceptSection {
  title: string;
  content: string;
}

export type ConceptLinkRef =
  | string
  | { label: string; slug: string; feature?: string };

export interface RubyConceptSummary {
  slug: string;
  id: number;
  title: string;
  topic: string;
  summary: string;
  publishedAt: string;
  labUrl?: string;
}

export interface RubyConceptDetail extends RubyConceptSummary {
  version: string | null;
  updatedAt: string | null;
  sections: RubyConceptSection[];
  references: RubyConceptReference[];
  related: ConceptLinkRef[];
}

interface ConceptMeta extends RubyConceptSummary {
  references: RubyConceptReference[];
  related: ConceptLinkRef[];
}

const DATA_DIR = join(__dirname, '../seed/data/ruby-concepts');

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

function splitSections(body: string): RubyConceptSection[] {
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
export class RubyConceptsService {
  private readonly conceptsMeta: ConceptMeta[] = (
    require(join(DATA_DIR, 'concepts.json')) as ConceptMeta[]
  )
    .slice()
    .sort((a, b) => b.id - a.id);

  findAll(): RubyConceptSummary[] {
    return this.conceptsMeta.map(
      ({ slug, id, title, topic, summary, publishedAt, labUrl }) => ({
        slug,
        id,
        title,
        topic,
        summary,
        publishedAt,
        ...(labUrl && { labUrl }),
      }),
    );
  }

  findBySlug(slug: string): RubyConceptDetail | null {
    const meta = this.conceptsMeta.find((concept) => concept.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta);
  }

  findAllDetailed(): RubyConceptDetail[] {
    return this.conceptsMeta.map((meta) => this.readDetail(meta));
  }

  private readDetail(meta: ConceptMeta): RubyConceptDetail {
    const raw = readFileSync(
      join(DATA_DIR, 'content', meta.slug, 'en.md'),
      'utf-8',
    );
    const { body, version, updatedAt } = parseFrontmatter(raw);

    return {
      slug: meta.slug,
      id: meta.id,
      title: meta.title,
      topic: meta.topic,
      summary: meta.summary,
      publishedAt: meta.publishedAt,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      version,
      updatedAt,
      sections: splitSections(body),
      references: meta.references,
      related: meta.related,
    };
  }
}
