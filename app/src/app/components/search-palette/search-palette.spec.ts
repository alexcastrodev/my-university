import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { LanguageService } from '../../services/language.service';
import { SearchService } from '../../services/search.service';
import { SearchResponse, toHighlightSegments } from '../../models/search.model';
import { SearchPalette } from './search-palette';

@Component({ template: '' })
class Blank {}

const RESPONSE: SearchResponse = {
  query: 'heap',
  total: 3,
  facets: { 'curriculum-concept': 2, 'jvm-concept': 1 },
  results: [
    {
      type: 'jvm-concept',
      title: 'Heap layout',
      subtitle: 'JVM Concepts',
      url: '/java/jvm-concepts/heap-layout',
      highlightedTitle: '\uE000Heap\uE001 layout',
      snippet: 'How the \uE000heap\uE001 is split',
      language: 'pt-BR',
    },
    {
      type: 'curriculum-concept',
      title: 'Binary heaps',
      subtitle: 'Data Structures I',
      url: '/computer-science/foundations/data-structures-i/binary-heaps',
      highlightedTitle: 'Binary \uE000heaps\uE001',
      snippet: null,
      language: 'en',
    },
  ],
};

function setup() {
  try {
    localStorage.removeItem('recent-searches');
  } catch {
    // storage unavailable in this runner: recent searches simply start empty
  }
  TestBed.configureTestingModule({
    imports: [SearchPalette],
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([{ path: '**', component: Blank }]),
      { provide: LanguageService, useValue: { language: 'pt-BR' } },
    ],
  });
  const fixture = TestBed.createComponent(SearchPalette);
  const search = TestBed.inject(SearchService);
  const http = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  return { fixture, search, http, component: fixture.componentInstance };
}

async function typeAndFlush(ctx: ReturnType<typeof setup>, query: string, response = RESPONSE) {
  ctx.component.onInput(query);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const req = ctx.http.expectOne((r) => r.url === '/api/search');
  req.flush(response);
  await ctx.fixture.whenStable();
  ctx.fixture.detectChanges();
  return req;
}

describe('toHighlightSegments', () => {
  it('splits matches from plain text', () => {
    expect(toHighlightSegments('a \uE000b\uE001 c')).toEqual([
      { text: 'a ', match: false },
      { text: 'b', match: true },
      { text: ' c', match: false },
    ]);
  });

  it('keeps text with no markers whole', () => {
    expect(toHighlightSegments('plain')).toEqual([{ text: 'plain', match: false }]);
  });
});

describe('SearchPalette', () => {
  it('renders nothing until opened', () => {
    const { fixture } = setup();
    expect(fixture.nativeElement.querySelector('.sp-panel')).toBeNull();
  });

  it('opens with Ctrl+K', async () => {
    const { fixture, search } = setup();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
    await fixture.whenStable();
    expect(search.paletteOpen()).toBeTrue();
  });

  it('searches in the reader language and shows highlighted results with per-track counts', async () => {
    const ctx = setup();
    ctx.search.open();
    await ctx.fixture.whenStable();
    const req = await typeAndFlush(ctx, 'heap');

    expect(req.request.params.get('q')).toBe('heap');
    expect(req.request.params.get('lang')).toBe('pt-BR');

    const el: HTMLElement = ctx.fixture.nativeElement;
    expect(el.querySelectorAll('.sp-result').length).toBe(2);
    expect(el.querySelector('.sp-result-title .sp-hl')?.textContent).toBe('Heap');
    expect(el.querySelector('.sp-result-snippet .sp-hl')?.textContent).toBe('heap');
    // Only the untranslated (English) result is flagged.
    expect(el.querySelectorAll('.sp-result-lang').length).toBe(1);

    const pills = Array.from(el.querySelectorAll('.sp-pill')).map((p) =>
      p.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(pills[0]).toContain('3');
    expect(pills.length).toBe(3);
    // More hits than shown, so paging is offered.
    expect(el.querySelector('.sp-more-btn')).not.toBeNull();
    ctx.http.verify();
  });

  it('re-queries with the type filter when a pill is picked', async () => {
    const ctx = setup();
    ctx.search.open();
    await ctx.fixture.whenStable();
    await typeAndFlush(ctx, 'heap');

    ctx.component.setType('jvm-concept');
    const req = ctx.http.expectOne((r) => r.url === '/api/search');
    expect(req.request.params.get('type')).toBe('jvm-concept');
    req.flush(RESPONSE);
    ctx.http.verify();
  });

  it('moves the active result with the arrow keys', async () => {
    const ctx = setup();
    ctx.search.open();
    await ctx.fixture.whenStable();
    await typeAndFlush(ctx, 'heap');

    ctx.component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(ctx.component.activeIndex()).toBe(1);
    ctx.component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    expect(ctx.component.activeIndex()).toBe(1);
    ctx.component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    expect(ctx.component.activeIndex()).toBe(0);
  });

  it('remembers the query of an opened result and closes', async () => {
    const ctx = setup();
    ctx.search.open();
    await ctx.fixture.whenStable();
    await typeAndFlush(ctx, 'heap');

    ctx.component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(ctx.search.paletteOpen()).toBeFalse();
    expect(ctx.search.recent()).toEqual(['heap']);
  });
});
