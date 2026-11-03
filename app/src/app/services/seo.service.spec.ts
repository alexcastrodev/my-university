import { DOCUMENT } from '@angular/common';
import { LOCALE_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SeoService } from './seo.service';

describe('SeoService robots', () => {
  const robots = () => TestBed.inject(DOCUMENT).querySelector('meta[name="robots"]')?.getAttribute('content');
  const tags = { title: 'T', description: 'D', path: '/x' };

  beforeEach(() => TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] }));

  it('indexes a page by default', () => {
    TestBed.inject(SeoService).set(tags);
    expect(robots()).toBe('index, follow');
  });

  it('asks crawlers to skip a page marked noindex, and goes back to indexing on the next page', () => {
    const seo = TestBed.inject(SeoService);
    seo.set({ ...tags, noindex: true });
    expect(robots()).toBe('noindex, nofollow');
    seo.set(tags);
    expect(robots()).toBe('index, follow');
  });
});

describe('SeoService canonical', () => {
  const head = (selector: string, attr: string) => TestBed.inject(DOCUMENT).querySelector(selector)?.getAttribute(attr);
  const canonical = () => head('link[rel="canonical"]', 'href');
  const ogUrl = () => head('meta[property="og:url"]', 'content');
  const both = [
    { lang: 'en' as const, path: '/java/java-concepts/x' },
    { lang: 'pt-BR' as const, path: '/pt-BR/java/java-concepts/x' },
  ];
  const tags = { title: 'T', description: 'D', path: '/java/java-concepts/x' };

  const as = (locale: string) =>
    TestBed.configureTestingModule({
      providers: [provideZonelessChangeDetection(), { provide: LOCALE_ID, useValue: locale }],
    });

  it('makes a translated pt-BR page its own canonical, og:url included', () => {
    as('pt-BR');
    TestBed.inject(SeoService).set({ ...tags, alternates: both });
    expect(canonical()).toMatch(/\/pt-BR\/java\/java-concepts\/x$/);
    expect(ogUrl()).toMatch(/\/pt-BR\/java\/java-concepts\/x$/);
  });

  it('keeps the English URL canonical on a pt-BR page that has no translation', () => {
    as('pt-BR');
    TestBed.inject(SeoService).set({ ...tags, alternates: [both[0]] });
    expect(canonical()).toMatch(/\/java\/java-concepts\/x$/);
    expect(canonical()).not.toContain('/pt-BR/');
  });

  it('keeps the English URL canonical on the English build, whatever it calls its locale', () => {
    as('en-US');
    TestBed.inject(SeoService).set({ ...tags, alternates: both });
    expect(canonical()).toMatch(/\/java\/java-concepts\/x$/);
    expect(canonical()).not.toContain('/pt-BR/');
  });

  it('keeps the page path when the page declares no alternates', () => {
    as('pt-BR');
    TestBed.inject(SeoService).set(tags);
    expect(canonical()).toMatch(/\/java\/java-concepts\/x$/);
  });
});
