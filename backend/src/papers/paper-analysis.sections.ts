import { BadRequestException } from '@nestjs/common';

/** The six sections of the standard Research Analysis, in the order they are read. */
export const SECTION_KEYS = [
  'overview',
  'contribution',
  'methodology',
  'findings',
  'criticalAnalysis',
  'furtherResearch',
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];

/**
 * A section either says something (`present`) or says why it does not: the paper has nothing of that kind
 * (`not_applicable`, e.g. no experiments in a theory paper), it does not report it (`not_reported`), or the
 * analyst cannot tell (`unable_to_determine`). Nothing forces an unsupported claim.
 */
export const SECTION_STATES = [
  'present',
  'not_applicable',
  'not_reported',
  'unable_to_determine',
] as const;
export type SectionState = (typeof SECTION_STATES)[number];

export interface Section {
  state: SectionState;
  text: string | null;
}

/** A draft may leave sections undecided (missing key); a published analysis has all six. */
export type Sections = Partial<Record<SectionKey, Section>>;

export const SECTION_MAX_CHARS = 6000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Checks the `sections` of a request body and returns it normalized; anything else is a 400 that says what. */
export function parseSections(raw: unknown): Sections {
  if (!isRecord(raw)) throw new BadRequestException('sections must be an object');
  const sections: Sections = {};
  for (const key of Object.keys(raw)) {
    if (!(SECTION_KEYS as readonly string[]).includes(key)) {
      throw new BadRequestException(`Unknown section "${key}"`);
    }
    const value = raw[key];
    if (!isRecord(value)) {
      throw new BadRequestException(`Section "${key}" must be an object`);
    }
    for (const field of Object.keys(value)) {
      if (field !== 'state' && field !== 'text') {
        throw new BadRequestException(`Section "${key}" has an unknown field "${field}"`);
      }
    }
    const state = value.state;
    if (!(SECTION_STATES as readonly unknown[]).includes(state)) {
      throw new BadRequestException(
        `Section "${key}" needs a state: ${SECTION_STATES.join(', ')}`,
      );
    }
    const text = value.text;
    if (text !== undefined && text !== null && typeof text !== 'string') {
      throw new BadRequestException(`Section "${key}" text must be a string`);
    }
    // Postgres jsonb cannot hold U+0000; rejecting it here keeps it a 400 instead of a 500.
    const clean = (text ?? '').replace(/\r\n?/g, '\n').trim();
    if (clean.includes('\u0000')) {
      throw new BadRequestException(`Section "${key}" text has a null character`);
    }
    if (state === 'present') {
      if (!clean) {
        throw new BadRequestException(`Section "${key}" is present but has no text`);
      }
      if (clean.length > SECTION_MAX_CHARS) {
        throw new BadRequestException(
          `Section "${key}" is longer than ${SECTION_MAX_CHARS} characters`,
        );
      }
      sections[key as SectionKey] = { state, text: clean };
    } else {
      if (clean) {
        throw new BadRequestException(
          `Section "${key}" is ${state as string} and cannot have text`,
        );
      }
      sections[key as SectionKey] = { state: state as SectionState, text: null };
    }
  }
  return sections;
}

/** The sections a draft has not decided yet; publishing needs this to be empty. */
export function missingSections(sections: Sections): SectionKey[] {
  return SECTION_KEYS.filter((key) => !sections[key]);
}

/** Postgres `jsonb` does not keep key order; the API always answers in reading order. */
export function inReadingOrder(sections: Sections): Sections {
  const ordered: Sections = {};
  for (const key of SECTION_KEYS) {
    if (sections[key]) ordered[key] = sections[key];
  }
  return ordered;
}
