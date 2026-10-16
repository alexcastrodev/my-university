import { DOCUMENT } from '@angular/common';
import { provideZonelessChangeDetection } from '@angular/core';
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
