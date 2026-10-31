import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The public papers are files (#213). A spec that needs its own writes them into a temporary folder and
 * points `PAPERS_DATA_DIR` at it before the Nest app boots; the real seed in `src/seed/data/papers` is only
 * read by the specs that run against the live stack.
 */
export interface FixturePaper {
  slug: string;
  title: string;
  authors?: string[];
  type?: string;
  venue?: string;
  publicationDate?: string;
  doi?: string;
  url?: string;
  /** The area, the keywords and the abstract live in the markdown, like the analysis: here in `en.md`. */
  researchArea?: string;
  keywords?: string[];
  abstract?: string;
  /** Also write a pt-BR.md; what is given overrides the English text, what is left out falls back to it. */
  portuguese?: { title?: string; researchArea?: string; keywords?: string[]; abstract?: string };
  /** The `updatedAt` of the analysis, `2026-01-02` when left out. */
  updatedAt?: string;
}

/** Three small papers, enough for most specs; each one differs from the others in every filterable field. */
export const DEFAULT_PAPERS: FixturePaper[] = [
  {
    slug: 'attention-is-all-you-need',
    title: 'Attention Is All You Need',
    authors: ['Ashish Vaswani', 'Noam Shazeer'],
    type: 'conference-paper',
    venue: 'NeurIPS',
    publicationDate: '2017-06-12',
    doi: '10.5555/spec.attention',
    url: 'https://example.org/attention',
    researchArea: 'Natural Language Processing',
    keywords: ['transformers', 'attention'],
    abstract: 'We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.',
    portuguese: { title: 'Atenção é tudo que você precisa' },
  },
  {
    slug: 'deep-residual-learning',
    title: 'Deep Residual Learning for Image Recognition',
    authors: ['Kaiming He', 'Xiangyu Zhang'],
    type: 'journal-article',
    publicationDate: '2015-12',
    researchArea: 'Computer Vision',
    keywords: ['resnet', 'attention'],
    abstract: 'Deeper neural networks are more difficult to train.',
  },
  {
    slug: 'zebra-finches-sing',
    title: 'Zebra Finches Sing',
    authors: ['Ada Lovelace'],
    type: 'preprint',
    publicationDate: '2020',
  },
];

const SECTIONS = {
  en: ['Overview', 'Contribution', 'Methodology', 'Findings', 'Critical Analysis', 'Further Research'],
  'pt-BR': ['Visão geral', 'Contribuição', 'Metodologia', 'Resultados', 'Análise crítica', 'Pesquisas futuras'],
};

const ABSTRACT_TITLE = { en: 'Abstract', 'pt-BR': 'Resumo' };

function analysis(
  paper: FixturePaper,
  lang: 'en' | 'pt-BR',
  texts: { title?: string; researchArea?: string; keywords?: string[]; abstract?: string },
): string {
  const head = [
    `title: "${texts.title ?? paper.title}"`,
    `summary: Summary of ${paper.slug} (${lang})`,
    ...(texts.researchArea ? [`researchArea: ${texts.researchArea}`] : []),
    ...(texts.keywords ? [`keywords: ${texts.keywords.join(', ')}`] : []),
    'version: 1.0',
    `updatedAt: ${paper.updatedAt ?? '2026-01-02'}`,
  ];
  const abstract = texts.abstract ? [`## ${ABSTRACT_TITLE[lang]}\n\n${texts.abstract}`] : [];
  const body = SECTIONS[lang].map((name) => `## ${name}\n\nOur ${name} text for ${paper.slug} (${lang}).`);
  return `---\n${head.join('\n')}\n---\n\n${[...abstract, ...body].join('\n\n')}\n`;
}

/**
 * Writes the papers as `papers.json` plus `content/<slug>/<lang>.md` in a new temporary folder and points
 * `PAPERS_DATA_DIR` at it. Returns the function that removes the folder and puts the variable back.
 */
export function usePapers(papers: FixturePaper[] = DEFAULT_PAPERS): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'papers-'));
  const index = papers.map((p) => ({
    slug: p.slug,
    title: p.title,
    authors: (p.authors ?? ['Ada Lovelace']).map((name) => ({ name })),
    type: p.type ?? 'conference-paper',
    venue: p.venue,
    publicationDate: p.publicationDate,
    doi: p.doi,
    url: p.url,
  }));
  writeFileSync(join(dir, 'papers.json'), JSON.stringify(index));
  for (const p of papers) {
    mkdirSync(join(dir, 'content', p.slug), { recursive: true });
    writeFileSync(join(dir, 'content', p.slug, 'en.md'), analysis(p, 'en', p));
    if (p.portuguese) {
      writeFileSync(join(dir, 'content', p.slug, 'pt-BR.md'), analysis(p, 'pt-BR', p.portuguese));
    }
  }
  const saved = process.env.PAPERS_DATA_DIR;
  process.env.PAPERS_DATA_DIR = dir;
  return () => {
    if (saved === undefined) delete process.env.PAPERS_DATA_DIR;
    else process.env.PAPERS_DATA_DIR = saved;
    rmSync(dir, { recursive: true, force: true });
  };
}
