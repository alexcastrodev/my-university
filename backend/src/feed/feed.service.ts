import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CurriculumService } from '../curriculum/curriculum.service';
import { curriculumSourceId, toSourceId } from '../review/review.constants';
import { ReviewService } from '../review/review.service';
import { CONTENT_CACHE_ENABLED } from '../shared/concept-content';
import { Language } from '../shared/language';
import { toUtcDateKey } from '../xp/streak';
import { XpService } from '../xp/xp.service';
import { hashSeed, orderFeed } from './feed-order';

/**
 * Chip filters on the feed. Each one groups the Complementary Studies modules it covers; `cs`
 * is the Computer Science curriculum, whose concepts live under (module, discipline) pairs.
 */
export const FEED_AREAS: Record<string, readonly string[]> = {
  java: ['java-concepts', 'jvm-concepts', 'testing-concepts'],
  spring: ['spring-concepts'],
  quarkus: ['quarkus-concepts'],
  databases: ['database-concepts'],
  'system-design': ['system-design-concepts'],
  kubernetes: ['kubernetes-concepts'],
  algorithms: ['algorithms-concepts'],
  ruby: ['ruby-concepts', 'rubyonrails-concepts'],
  dotnet: ['dotnet-concepts', 'dotnet-testing-concepts'],
  csharp: ['csharp-concepts'],
  cs: [],
};

const MAX_LIMIT = 30;
const DEFAULT_LIMIT = 10;
/** A feed card shows a glimpse of code, not a listing: longer blocks are cut and marked. */
const MAX_CODE_LINES = 8;
/** Fences that are not source code: diagrams the concept page renders, and plain text/output. */
const NON_CODE_FENCES = new Set(['', 'mermaid', 'viz', 'text', 'console']);
const NON_CONTENT_SECTIONS = new Set([
  'references',
  'referências',
  'documentation links',
]);
const FENCE_RE = /```([\w+-]*)\n([\s\S]*?)```/g;

/** First fenced block, in document order, that is real source code of at least two lines. */
export function firstSourceSnippet(
  sections: { title: string; content: string }[],
): { lang: string; code: string } | null {
  for (const section of sections) {
    if (NON_CONTENT_SECTIONS.has(section.title.trim().toLowerCase())) continue;
    for (const match of section.content.matchAll(FENCE_RE)) {
      const lang = match[1].toLowerCase();
      const code = match[2].trim();
      if (NON_CODE_FENCES.has(lang)) continue;
      if (code.split('\n').filter((l) => l.trim()).length < 2) continue;
      return { lang, code };
    }
  }
  return null;
}

export interface FeedItem {
  module: string;
  /** Only for Computer Science concepts, which are addressed by module + discipline + slug. */
  discipline?: string;
  slug: string;
  title: string;
  summary: string;
  code?: { lang: string; source: string };
  route: string[];
  read: boolean;
}

export interface FeedPage {
  items: FeedItem[];
  total: number;
  nextOffset: number | null;
  /** Concepts marked "Got it" since the start of the current UTC day, from anywhere in the app. */
  gotItToday: number;
}

interface Candidate {
  module: string;
  discipline?: string;
  slug: string;
  title: string;
  summary: string;
  sourceId: string;
  route: string[];
  read: boolean;
}

function startOfUtcDay(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

@Injectable()
export class FeedService {
  /**
   * Candidate lists and code snippets come from content that only changes with a deploy, and
   * computing them walks every track (~300 ms per feed page in production traces), so in
   * production they are computed once per area/language (or concept) and reused. Read state is
   * per user and is still applied per request.
   */
  private readonly candidateCache = new Map<
    string,
    Omit<Candidate, 'read'>[]
  >();
  private readonly snippetCache = new Map<string, FeedItem['code'] | null>();

  constructor(
    private review: ReviewService,
    private curriculum: CurriculumService,
    private xp: XpService,
  ) {}

  async getPage(
    userId: number | null,
    options: { area?: string; offset?: number; limit?: number; lang: Language },
  ): Promise<FeedPage> {
    const area = options.area && options.area !== 'all' ? options.area : null;
    if (area && !(area in FEED_AREAS))
      throw new BadRequestException(`unknown area "${area}"`);

    const readIds =
      userId === null
        ? new Set<string>()
        : await this.xp.getReadSourceIds(userId, 'concept-read');

    const candidates = this.cachedCandidates(area, options.lang).map((c) => ({
      ...c,
      read: readIds.has(c.sourceId),
    }));

    const seed = hashSeed(
      `${userId ?? 'guest'}:${area ?? 'all'}:${toUtcDateKey(new Date())}`,
    );
    const ordered = orderFeed(candidates, seed);

    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, Math.floor(options.limit ?? DEFAULT_LIMIT)),
    );
    const slice = ordered.slice(offset, offset + limit);

    return {
      items: slice.map((c) => this.toItem(c, options.lang)),
      total: ordered.length,
      nextOffset: offset + limit < ordered.length ? offset + limit : null,
      gotItToday: userId === null ? 0 : await this.countGotItToday(userId),
    };
  }

  /** "Got it" straight from a feed card: the same read XP and first review a concept page grants. */
  async gotIt(
    userId: number,
    module: string,
    slug: string,
    discipline?: string,
  ): Promise<{ read: true; gotItToday: number }> {
    let sourceId: string;
    if (discipline) {
      if (!this.curriculum.findBySlug(module, discipline, slug))
        throw new NotFoundException();
      sourceId = curriculumSourceId(module, discipline, slug);
    } else {
      const resolved = toSourceId(module, slug);
      if (!resolved || resolved.sourceType !== 'concept-read')
        throw new NotFoundException();
      if (
        !this.review.resolveConceptDetail(
          resolved.sourceType,
          resolved.sourceId,
        )
      ) {
        throw new NotFoundException();
      }
      sourceId = resolved.sourceId;
    }

    await this.xp.grantConceptReadXp(userId, sourceId);
    await this.review.scheduleFirstReview(userId, module, slug, discipline);
    return { read: true, gotItToday: await this.countGotItToday(userId) };
  }

  private cachedCandidates(
    area: string | null,
    lang: Language,
  ): Omit<Candidate, 'read'>[] {
    if (!CONTENT_CACHE_ENABLED) return this.candidates(area, lang);
    const key = `${area ?? 'all'}:${lang}`;
    let cached = this.candidateCache.get(key);
    if (!cached) {
      cached = this.candidates(area, lang);
      this.candidateCache.set(key, cached);
    }
    return cached;
  }

  /**
   * Every concept the feed can show for `area`, only those written in `lang`: a concept not yet
   * translated would otherwise fall back to English, and a card in the wrong language mid-scroll
   * reads as a bug. It stays reachable from its own page.
   */
  private candidates(
    area: string | null,
    lang: Language,
  ): Omit<Candidate, 'read'>[] {
    const out: Omit<Candidate, 'read'>[] = [];

    const modules = area ? new Set(FEED_AREAS[area]) : null;
    if (area !== 'cs') {
      for (const c of this.review.listConceptSummaries(lang)) {
        if (modules && !modules.has(c.module)) continue;
        if (c.language !== lang) continue;
        const resolved = toSourceId(c.module, c.slug);
        if (!resolved) continue;
        out.push({
          module: c.module,
          slug: c.slug,
          title: c.title,
          summary: c.summary,
          sourceId: resolved.sourceId,
          route: this.review.routeFor(c.module, c.slug),
        });
      }
    }

    if (!area || area === 'cs') {
      for (const { module, discipline } of this.curriculum.listDisciplines()) {
        for (const c of this.curriculum.findAll(module, discipline, lang)) {
          if (c.language !== lang) continue;
          out.push({
            module,
            discipline,
            slug: c.slug,
            title: c.title,
            summary: c.summary,
            sourceId: curriculumSourceId(module, discipline, c.slug),
            route: ['/computer-science', module, discipline, c.slug],
          });
        }
      }
    }
    return out;
  }

  private toItem(c: Candidate, lang: Language): FeedItem {
    return {
      module: c.module,
      discipline: c.discipline,
      slug: c.slug,
      title: c.title,
      summary: c.summary,
      code: this.snippet(c.sourceId, lang),
      route: c.route,
      read: c.read,
    };
  }

  private snippet(sourceId: string, lang: Language): FeedItem['code'] {
    const key = `${sourceId}:${lang}`;
    if (CONTENT_CACHE_ENABLED && this.snippetCache.has(key)) {
      return this.snippetCache.get(key) ?? undefined;
    }

    const detail = this.review.resolveConceptDetail(
      'concept-read',
      sourceId,
      lang,
    );
    const block = detail ? firstSourceSnippet(detail.sections) : null;

    let code: FeedItem['code'];
    if (block) {
      const lines = block.code.split('\n');
      const source =
        lines.length > MAX_CODE_LINES
          ? [...lines.slice(0, MAX_CODE_LINES), '…'].join('\n')
          : block.code;
      code = { lang: block.lang, source };
    }

    if (CONTENT_CACHE_ENABLED) this.snippetCache.set(key, code ?? null);
    return code;
  }

  private async countGotItToday(userId: number): Promise<number> {
    const entries = await this.xp.getHistorySince(
      userId,
      startOfUtcDay(new Date()),
    );
    return entries.filter((e) => e.sourceType === 'concept-read').length;
  }
}
