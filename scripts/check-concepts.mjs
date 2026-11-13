#!/usr/bin/env node
// Validates the dotnet-concepts, csharp-concepts, rust-concepts and go-concepts tracks: concepts.json shape,
// taxonomy, links between concepts, content files and the no-dash rule.
// Usage: node scripts/check-concepts.mjs   (exit code 1 when anything fails)
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'backend/src/seed/data');

// Category -> topics, in display order. Frozen by Wave 0 of the C# / .NET backlog (the release
// overview topic, shown last in the app, is shared by the categories that have one);
// the only other copy is TOPIC_ORDER / CATEGORY_OPTIONS in the app list pages.
const TAXONOMY = {
  'dotnet-concepts': {
    'Platform & Tooling': ['Runtime & SDK', 'Project System', 'NuGet & Packaging', 'Publishing & Native AOT', 'Diagnostics', "What's New & Migration"],
    'ASP.NET Core': ['ASP.NET Core Fundamentals', 'Hosting & Pipeline', 'Minimal APIs', 'MVC & Razor Pages', 'API Documentation', 'HTTP Clients', 'Security', 'Resilience & Protection', 'Caching & Performance', 'Observability', 'Operations', 'Real-Time', 'Remote APIs', 'Web API Design', 'Cloud-Native', 'Globalization', "What's New & Migration"],
    Blazor: ['Blazor Fundamentals', 'Components & Forms'],
    'Data Access': ['Data Access Choices', 'EF Core', 'EF Core Modeling', 'EF Core Querying', 'Migrations', "What's New & Migration"],
    Architecture: ['Application Architecture', 'Modular Architecture', 'DDD'],
    'Concurrency & Background Work': ['Background Jobs', 'Concurrency'],
  },
  'csharp-concepts': {
    Language: ['Language Basics', 'Strings & Formatting', 'Numbers & Conversions', 'Operators & Control Flow', 'Pattern Matching', 'Exceptions', 'Methods & Lambdas', "What's New"],
    'Type Design': ['Classes & Members', 'Properties & Initialization', 'Records & Equality', 'Inheritance & Polymorphism', 'Interfaces & Generics', 'Delegates & Events', 'Nullability', 'Extension Members'],
    'Base Class Library': ['Text & Regex', 'Common Types', 'Collections', 'Files & I/O', 'Streams', 'Serialization', 'Reflection & Attributes'],
    LINQ: ['LINQ'],
    'Memory & Concurrency': ['Memory & Value Semantics', 'Interop & Unsafe', 'Threads'],
  },
  'rust-concepts': {
    Language: ['Type System', 'Unsafe & Memory', 'Systems Programming'],
    'Concurrency & Async': ['Threads & Atomics', 'Async'],
    Production: ['Services', 'Tooling & Quality'],
  },
  'go-concepts': {
    Runtime: ['Scheduler & GC', 'Memory & Compiler'],
    Language: ['Concurrency', 'Type System'],
    Operations: ['Diagnostics', 'Production & Tooling'],
  },
};
// Tracks that also cite books and papers (their services widen the reference type).
const BOOK_AND_PAPER_TRACKS = new Set(['rust-concepts', 'go-concepts']);

const REQUIRED_FIELDS = ['slug', 'id', 'category', 'title', 'topic', 'summary', 'publishedAt', 'references', 'related'];
const FRONTMATTER = { 'en.md': ['version', 'updatedAt'], 'pt-BR.md': ['version', 'updatedAt', 'title', 'summary'] };
const SECTIONS = ['Objective', 'Use Cases', 'Deep Dive', 'Trade-offs', 'Documentation Links'];
const DASHES = /[\u2013\u2014]/;

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);

// Load both tracks first so related links between them can be checked too.
const slugsByTrack = {};
const conceptsByTrack = {};
for (const track of Object.keys(TAXONOMY)) {
  const file = join(DATA, track, 'concepts.json');
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('top level is not an array');
    conceptsByTrack[track] = parsed;
    slugsByTrack[track] = new Set(parsed.map((c) => c.slug));
  } catch (e) {
    fail(relative(ROOT, file), `invalid JSON (${e.message})`);
  }
}

for (const [track, concepts] of Object.entries(conceptsByTrack)) {
  const taxonomy = TAXONOMY[track];
  const seenIds = new Set();
  const seenSlugs = new Set();

  for (const [index, c] of concepts.entries()) {
    const where = `${track}/concepts.json[${index}] ${c.slug ?? '(no slug)'}`;

    for (const field of REQUIRED_FIELDS) {
      if (c[field] === undefined || c[field] === '') fail(where, `missing "${field}"`);
    }
    if (!Number.isInteger(c.id)) fail(where, `id must be an integer, got ${JSON.stringify(c.id)}`);
    if (seenIds.has(c.id)) fail(where, `duplicate id ${c.id}`);
    if (seenSlugs.has(c.slug)) fail(where, `duplicate slug`);
    seenIds.add(c.id);
    seenSlugs.add(c.slug);

    if (!taxonomy[c.category]) {
      fail(where, `category "${c.category}" is not in the taxonomy`);
    } else if (!taxonomy[c.category].includes(c.topic)) {
      fail(where, `topic "${c.topic}" is not a topic of category "${c.category}"`);
    }

    for (const slug of c.requires ?? []) {
      if (!slugsByTrack[track].has(slug)) fail(where, `requires unknown slug "${slug}"`);
    }
    for (const link of c.related ?? []) {
      const target = slugsByTrack[link.feature];
      if (target && !target.has(link.slug)) fail(where, `related unknown ${link.feature} slug "${link.slug}"`);
    }

    const refs = c.references ?? [];
    if (refs.length < 3) fail(where, `needs at least 3 references, has ${refs.length}`);
    for (const ref of refs) {
      if (!/^https:\/\//.test(ref.url ?? '')) fail(where, `reference url is not https: ${ref.url}`);
      const allowed = BOOK_AND_PAPER_TRACKS.has(track) ? ['doc', 'video', 'book', 'paper'] : ['doc', 'video'];
      if (!allowed.includes(ref.type)) fail(where, `reference type must be ${allowed.join(' or ')}: ${ref.type}`);
    }

    for (const [file, fields] of Object.entries(FRONTMATTER)) {
      const path = join(DATA, track, 'content', c.slug ?? '', file);
      const at = relative(ROOT, path);
      if (!existsSync(path)) {
        fail(at, 'missing');
        continue;
      }
      const raw = readFileSync(path, 'utf8');
      // Same parsing rules as backend/src/shared/concept-content.ts.
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
      if (!match) {
        fail(at, 'no frontmatter block');
        continue;
      }
      for (const field of fields) {
        if (!new RegExp(`^${field}:\\s*\\S`, 'm').test(match[1])) fail(at, `frontmatter missing "${field}"`);
      }
      // The backend splits on every "## " line, so the list must match exactly.
      // "Lab" is optional: the service splits it out (splitLabSection) when the concept has a lab.
      const headings = [...match[2].matchAll(/^## (.+)$/gm)].map((m) => m[1].trim()).filter((h) => h !== 'Lab');
      if (headings.join('|') !== SECTIONS.join('|')) {
        fail(at, `sections must be exactly [${SECTIONS.join(', ')}], found [${headings.join(', ')}]`);
      }
    }
  }
}

// No em-dash or en-dash anywhere in the tracks' .md and .json files (character check).
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
for (const track of Object.keys(TAXONOMY)) {
  for (const path of walk(join(DATA, track)).filter((p) => /\.(md|json)$/.test(p))) {
    readFileSync(path, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (DASHES.test(line)) fail(`${relative(ROOT, path)}:${i + 1}`, 'contains an em-dash (U+2014) or en-dash (U+2013)');
      });
  }
}

// Study order, for every concepts track: concepts.json is the reading order the app shows (the
// services no longer sort). A topic's concepts sit together, and a prerequisite from the same
// topic comes first. Prerequisites in other topics are not checked: topic order lives in the app.
for (const track of readdirSync(DATA).filter((d) => existsSync(join(DATA, d, 'concepts.json')))) {
  const concepts = JSON.parse(readFileSync(join(DATA, track, 'concepts.json'), 'utf8'));
  const topicOf = (c) => c.topic ?? c.session; // algorithms and testing call it session
  const closedTopics = new Set();
  const seen = new Set();
  concepts.forEach((c, index) => {
    const where = `${track}/concepts.json[${index}] ${c.slug}`;
    const topic = topicOf(c);
    if (index > 0 && topicOf(concepts[index - 1]) !== topic) closedTopics.add(topicOf(concepts[index - 1]));
    if (closedTopics.has(topic)) fail(where, `study order: topic "${topic}" is split, keep its concepts together`);
    for (const slug of c.requires ?? []) {
      const required = concepts.find((other) => other.slug === slug);
      if (required && topicOf(required) === topic && !seen.has(slug)) {
        fail(where, `study order: must come after its prerequisite "${slug}"`);
      }
    }
    seen.add(c.slug);
  });
  if (!conceptsByTrack[track]) console.log(`${track}: ${concepts.length} concepts, study order checked`);
}

for (const [track, concepts] of Object.entries(conceptsByTrack)) {
  console.log(`${track}: ${concepts.length} concepts checked`);
}
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('OK');
