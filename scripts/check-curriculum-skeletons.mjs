#!/usr/bin/env node
// Validates docs/curriculum-skeletons/*.json against the live curriculum: unique ids and slugs,
// `requires` that resolve inside the discipline, `related` that land on a lesson with a real en.md,
// no dash punctuation, the resulting study order, and no cycle in the discipline graph.
//
// Usage: node --experimental-strip-types --no-warnings scripts/check-curriculum-skeletons.mjs [--order]
// --order also prints the final lesson order of every discipline. Exit code 1 when anything fails.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sortByPrerequisites } from '../backend/src/shared/concept-order.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'backend/src/seed/data');
const CURRICULUM = join(DATA, 'curriculum');
const SKELETONS = join(ROOT, 'docs/curriculum-skeletons');

// Delivery order from the plan: a lesson may only link to a skeleton delivered before it.
const PHASE_ORDER = ['6a', '7', '1', '2', '5', '3', '4', '6b'];
const FEATURE_DIRS = { 'system-design': 'system-design-concepts' };
const DASHES = /[–—]/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const errors = [];
const fail = (where, msg) => errors.push(`${where}: ${msg}`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

const liveDisciplines = new Map();
for (const mod of readdirSync(CURRICULUM)) {
  if (!isDir(join(CURRICULUM, mod))) continue;
  for (const discipline of readdirSync(join(CURRICULUM, mod))) {
    const file = join(CURRICULUM, mod, discipline, 'concepts.json');
    if (existsSync(file)) liveDisciplines.set(`${mod}/${discipline}`, readJson(file));
  }
}

const skeletons = readdirSync(SKELETONS)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({ name, ...readJson(join(SKELETONS, name)) }));
const skeletonByKey = new Map(skeletons.map((s) => [`${s.module}/${s.discipline}`, s]));

const hasRealContent = (dir, slug) => {
  const file = join(dir, 'content', slug, 'en.md');
  return existsSync(file) && readFileSync(file, 'utf8').trim().length > 0;
};

/** A `related` label is what readers see, so it has to match the title of the lesson it opens. */
function checkLabel(where, ref, dir) {
  const target = readJson(join(dir, 'concepts.json')).find((c) => c.slug === ref.slug);
  if (target && target.title !== ref.label) fail(where, `label "${ref.label}" differs from the title "${target.title}"`);
}

/** Where a `related` entry lands: a lesson with content on disk, or a lesson of an earlier skeleton. */
function checkRelatedTarget(where, ref, skeleton) {
  if (typeof ref !== 'object' || !ref.label || !ref.slug) return fail(where, 'related must be {label, slug, feature?}');
  if (!ref.feature) {
    const own = skeleton.concepts.some((c) => c.slug === ref.slug);
    const live = (liveDisciplines.get(`${skeleton.module}/${skeleton.discipline}`) ?? []).some((c) => c.slug === ref.slug);
    if (!own && !live) fail(where, `related ${ref.slug} is not in this discipline`);
    return;
  }
  if (ref.feature.startsWith('curriculum/')) {
    const key = ref.feature.slice('curriculum/'.length);
    const target = skeletonByKey.get(key);
    if (target?.concepts.some((c) => c.slug === ref.slug)) {
      if (PHASE_ORDER.indexOf(target.phase) >= PHASE_ORDER.indexOf(skeleton.phase)) {
        fail(where, `related ${ref.slug} is delivered in phase ${target.phase}, not before phase ${skeleton.phase}`);
      }
      const title = target.concepts.find((c) => c.slug === ref.slug).title;
      if (title !== ref.label) fail(where, `label "${ref.label}" differs from the title "${title}"`);
      return;
    }
    if (!hasRealContent(join(CURRICULUM, key), ref.slug)) fail(where, `related ${key}/${ref.slug} has no en.md`);
    else checkLabel(where, ref, join(CURRICULUM, key));
    return;
  }
  const dir = join(DATA, FEATURE_DIRS[ref.feature] ?? ref.feature);
  if (!hasRealContent(dir, ref.slug)) fail(where, `related ${ref.feature}/${ref.slug} has no en.md`);
  else checkLabel(where, ref, dir);
}

for (const skeleton of skeletons) {
  const key = `${skeleton.module}/${skeleton.discipline}`;
  const live = liveDisciplines.get(key) ?? [];
  if (skeleton.kind === 'new' && liveDisciplines.has(key)) fail(skeleton.name, 'kind is new but the discipline already has a concepts.json');
  if (skeleton.kind === 'extend' && !liveDisciplines.has(key)) fail(skeleton.name, 'kind is extend but the discipline does not exist');
  if (!PHASE_ORDER.includes(skeleton.phase)) fail(skeleton.name, `unknown phase ${skeleton.phase}`);
  if (DASHES.test(JSON.stringify(skeleton))) fail(skeleton.name, 'contains an em-dash or en-dash');

  const slugs = new Set(live.map((c) => c.slug));
  const ids = new Set(live.map((c) => c.id));
  const allSlugs = new Set([...slugs, ...skeleton.concepts.map((c) => c.slug)]);

  for (const concept of skeleton.concepts) {
    const where = `${skeleton.name}#${concept.slug}`;
    for (const field of ['slug', 'title', 'topic', 'summary']) {
      if (typeof concept[field] !== 'string' || !concept[field].trim()) fail(where, `missing ${field}`);
    }
    if (!SLUG.test(concept.slug)) fail(where, 'slug is not kebab-case');
    if (slugs.has(concept.slug)) fail(where, 'duplicate slug in the discipline');
    if (ids.has(concept.id)) fail(where, `duplicate id ${concept.id} in the discipline`);
    slugs.add(concept.slug);
    ids.add(concept.id);
    if (!Array.isArray(concept.requires)) fail(where, 'requires must be an array');
    for (const required of concept.requires ?? []) {
      if (typeof required !== 'string') fail(where, 'requires entries are slugs of the same discipline');
      else if (!allSlugs.has(required)) fail(where, `requires ${required}, which is not in this discipline`);
      else if (required === concept.slug) fail(where, 'requires itself');
    }
    for (const ref of concept.related ?? []) checkRelatedTarget(where, ref, skeleton);
  }

  // A new discipline has no other order than its `requires` chain: a loose lesson would surface by
  // highest id first. An extended one must keep what it had, in the same relative order, with its
  // capstone still last.
  const merged = [...live, ...skeleton.concepts];
  const order = sortByPrerequisites(merged);
  if (order.length !== merged.length) fail(skeleton.name, 'ordering lost lessons');
  const position = new Map(order.map((c, i) => [c.slug, i]));
  for (const concept of merged) {
    for (const required of concept.requires ?? []) {
      if (position.get(required) >= position.get(concept.slug)) fail(skeleton.name, `${concept.slug} is placed before ${required} (cycle?)`);
    }
  }
  if (skeleton.kind === 'new') {
    const declared = [...skeleton.concepts].sort((a, b) => a.id - b.id).map((c) => c.slug);
    if (order.map((c) => c.slug).join() !== declared.join()) fail(skeleton.name, 'final order differs from the id order');
    if (declared.length && skeleton.concepts.at(-1).topic !== 'Capstone') fail(skeleton.name, 'last lesson is not the capstone');
  } else {
    const before = sortByPrerequisites(live).map((c) => c.slug);
    const after = order.map((c) => c.slug).filter((slug) => before.includes(slug));
    if (before.join() !== after.join()) fail(skeleton.name, 'the existing lessons changed relative order');
    const capstone = live.find((c) => c.topic === 'Capstone');
    const lastAdded = Math.max(...skeleton.concepts.map((c) => position.get(c.slug)));
    if (capstone && lastAdded > position.get(capstone.slug)) fail(skeleton.name, `a new lesson lands after capstone ${capstone.slug}`);
  }
  if (process.argv.includes('--order')) {
    console.log(`\n${key} (${merged.length})`);
    const added = new Set(skeleton.concepts.map((c) => c.slug));
    order.forEach((c, i) => console.log(`  ${String(i + 1).padStart(2)} ${added.has(c.slug) ? '+' : ' '} [${c.id}] ${c.slug}`));
  }
}

// `related` encodes prerequisite direction in the /map graph (curriculum-graph.ts): the discipline
// pointed at comes first. A cycle makes its delay and centrality metrics silently wrong.
const edges = new Map();
const addEdge = (from, to) => {
  if (from === to) return;
  if (!edges.has(from)) edges.set(from, new Set());
  edges.get(from).add(to);
};
const addRelated = (key, concepts) => {
  for (const concept of concepts) {
    for (const ref of concept.related ?? []) {
      if (ref.feature?.startsWith('curriculum/')) addEdge(key, ref.feature.slice('curriculum/'.length));
    }
  }
};
for (const [key, concepts] of liveDisciplines) addRelated(key, concepts);
for (const skeleton of skeletons) {
  addRelated(`${skeleton.module}/${skeleton.discipline}`, skeleton.concepts);
  for (const link of skeleton.backlinks ?? []) {
    addEdge(link.from, `${skeleton.module}/${skeleton.discipline}`);
    const lesson = liveDisciplines.get(link.from)?.find((c) => c.slug === link.lesson);
    if (!lesson) fail(skeleton.name, `backlink source ${link.from}/${link.lesson} does not exist`);
    if (!skeleton.concepts.some((c) => c.slug === link.to)) fail(skeleton.name, `backlink target ${link.to} is not in this skeleton`);
  }
}
const state = new Map();
const walk = (node, path) => {
  if (state.get(node) === 'done') return;
  if (state.get(node) === 'active') {
    fail('discipline graph', `cycle: ${[...path.slice(path.indexOf(node)), node].join(' -> ')}`);
    return;
  }
  state.set(node, 'active');
  for (const next of edges.get(node) ?? []) walk(next, [...path, node]);
  state.set(node, 'done');
};
for (const node of edges.keys()) walk(node, []);

const total = skeletons.reduce((sum, s) => sum + s.concepts.length, 0);
if (errors.length) {
  console.error(`${errors.length} problem(s):\n${errors.map((e) => `  ${e}`).join('\n')}`);
  process.exit(1);
}
console.log(`OK: ${skeletons.length} skeletons, ${total} lessons`);
