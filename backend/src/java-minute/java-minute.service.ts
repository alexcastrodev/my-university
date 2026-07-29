import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface JavaMinuteReference {
  label: string;
  url: string;
  type: 'video' | 'doc';
}

export interface JavaMinuteSection {
  title: string;
  content: string;
}

export interface JavaMinuteEpisodeSummary {
  slug: string;
  id: number;
  question: string;
  publishedAt: string;
  labUrl?: string;
}

export interface JavaMinuteEpisodeDetail extends JavaMinuteEpisodeSummary {
  version: string | null;
  updatedAt: string | null;
  sections: JavaMinuteSection[];
  references: JavaMinuteReference[];
}

interface EpisodeMeta extends JavaMinuteEpisodeSummary {
  references: JavaMinuteReference[];
}

const DATA_DIR = join(__dirname, '../seed/data/java-minute');

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

function splitSections(body: string): JavaMinuteSection[] {
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
export class JavaMinuteService {
  private readonly episodesMeta: EpisodeMeta[] = (
    require(join(DATA_DIR, 'episodes.json')) as EpisodeMeta[]
  )
    .slice()
    .sort((a, b) => b.id - a.id);

  findAll(): JavaMinuteEpisodeSummary[] {
    return this.episodesMeta.map(({ slug, id, question, publishedAt, labUrl }) => ({
      slug,
      id,
      question,
      publishedAt,
      ...(labUrl && { labUrl }),
    }));
  }

  findBySlug(slug: string): JavaMinuteEpisodeDetail | null {
    const meta = this.episodesMeta.find((episode) => episode.slug === slug);
    if (!meta) return null;

    return this.readDetail(meta);
  }

  findAllDetailed(): JavaMinuteEpisodeDetail[] {
    return this.episodesMeta.map((meta) => this.readDetail(meta));
  }

  private readDetail(meta: EpisodeMeta): JavaMinuteEpisodeDetail {
    const raw = readFileSync(
      join(DATA_DIR, 'content', `${meta.slug}.md`),
      'utf-8',
    );
    const { body, version, updatedAt } = parseFrontmatter(raw);

    return {
      slug: meta.slug,
      id: meta.id,
      question: meta.question,
      publishedAt: meta.publishedAt,
      ...(meta.labUrl && { labUrl: meta.labUrl }),
      version,
      updatedAt,
      sections: splitSections(body),
      references: meta.references,
    };
  }
}
