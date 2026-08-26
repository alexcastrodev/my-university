import { Injectable, REQUEST, RESPONSE_INIT, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';
import { Language } from '../models/language.model';

export interface SeoTags {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: 'website' | 'article';
  /** ISO date the underlying content was first published — enables Article structured data. */
  publishedAt?: string;
  /** ISO date the underlying content was last updated. Defaults to publishedAt. */
  modifiedAt?: string | null;
  /**
   * Set for content that genuinely is a question the page answers (e.g. Java Minute).
   * Emits QAPage/Question/Answer structured data instead of Article/WebPage.
   * `answerText` must be an excerpt of content already visible on the page — Google's
   * structured data policy requires JSON-LD to match what a visitor actually sees.
   */
  qa?: { question: string; answerText: string };
  /** Home is implicit — pass the trail after it, e.g. [Java Concepts, Collections, HashMap]. */
  breadcrumbs?: { name: string; path: string }[];
  /** Set on exam/course overview pages — emits Course structured data instead of Article/WebPage. */
  course?: { moduleCount: number };
  /** Language actually served on this page. Defaults to 'en'. Drives <html lang>. */
  language?: Language;
  /** Other language versions of this exact page, for hreflang. Only pass a language when that translation genuinely exists — never the fallback. */
  alternates?: { lang: Language; path: string }[];
}

const SITE_NAME = 'My University';
const JSON_LD_ID = 'seo-json-ld';
const BREADCRUMB_JSON_LD_ID = 'seo-json-ld-breadcrumbs';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private meta = inject(Meta);
  private title = inject(Title);
  private document = inject(DOCUMENT);
  private request = inject(REQUEST, { optional: true });
  private responseInit = inject(RESPONSE_INIT, { optional: true });

  /** Marks the current SSR response as a 404 so crawlers don't index a soft-404 as a real page. */
  setNotFound(): void {
    if (this.responseInit) {
      this.responseInit.status = 404;
    }
    this.meta.updateTag({ name: 'robots', content: 'noindex' });
  }

  set(tags: SeoTags): void {
    const image = this.absoluteUrl(tags.image ?? this.ogImagePath(tags.title));
    const url = this.absoluteUrl(tags.path);

    this.title.setTitle(tags.title);

    this.meta.updateTag({ name: 'robots', content: 'index, follow' });
    this.meta.updateTag({ name: 'description', content: tags.description });

    this.meta.updateTag({ property: 'og:title', content: tags.title });
    this.meta.updateTag({ property: 'og:description', content: tags.description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:image', content: image });
    this.meta.updateTag({ property: 'og:type', content: tags.type ?? 'website' });
    this.meta.updateTag({ property: 'og:site_name', content: SITE_NAME });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: tags.title });
    this.meta.updateTag({ name: 'twitter:description', content: tags.description });
    this.meta.updateTag({ name: 'twitter:image', content: image });

    this.document.documentElement.lang = tags.language ?? 'en';

    this.setCanonical(url);
    this.setAlternateLinks(tags.alternates);
    this.setJsonLd(this.buildJsonLd(tags, url, image));
    this.setBreadcrumbJsonLd(tags.breadcrumbs);
  }

  /** Writes one <link rel="alternate" hreflang="..."> per language variant, plus x-default pointing at the unprefixed (English) URL. */
  private setAlternateLinks(alternates: { lang: Language; path: string }[] | undefined): void {
    this.document
      .querySelectorAll('link[rel="alternate"][data-seo-alternate]')
      .forEach((link) => link.remove());

    if (!alternates || alternates.length === 0) return;

    const xDefaultPath = alternates.find((a) => a.lang === 'en')?.path ?? alternates[0].path;
    const links: { lang: string; path: string }[] = [...alternates, { lang: 'x-default', path: xDefaultPath }];

    for (const alt of links) {
      const link = this.document.createElement('link');
      link.setAttribute('rel', 'alternate');
      link.setAttribute('hreflang', alt.lang);
      link.setAttribute('href', this.absoluteUrl(alt.path));
      link.setAttribute('data-seo-alternate', 'true');
      this.document.head.appendChild(link);
    }
  }

  private setCanonical(url: string): void {
    let link = this.document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = this.document.createElement('link');
      link.setAttribute('rel', 'canonical');
      this.document.head.appendChild(link);
    }
    link.setAttribute('href', url);
  }

  private buildJsonLd(tags: SeoTags, url: string, image: string): Record<string, unknown> {
    if (tags.qa) {
      return {
        '@context': 'https://schema.org',
        '@type': 'QAPage',
        mainEntity: {
          '@type': 'Question',
          name: tags.qa.question,
          text: tags.qa.question,
          answerCount: 1,
          acceptedAnswer: {
            '@type': 'Answer',
            text: tags.qa.answerText,
            url,
          },
        },
      };
    }

    if (tags.course) {
      return {
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: tags.title,
        description: tags.description,
        url,
        provider: { '@type': 'Organization', name: SITE_NAME, url: this.origin() },
        hasCourseInstance: {
          '@type': 'CourseInstance',
          courseMode: 'Online',
          courseWorkload: `${tags.course.moduleCount} modules`,
        },
      };
    }

    if (tags.type === 'article') {
      return {
        '@context': 'https://schema.org',
        '@type': 'TechArticle',
        headline: tags.title,
        description: tags.description,
        url,
        image,
        datePublished: tags.publishedAt,
        dateModified: tags.modifiedAt ?? tags.publishedAt,
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: this.origin() },
        publisher: { '@type': 'Organization', name: SITE_NAME, url: this.origin() },
      };
    }

    if (tags.path === '/') {
      return {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: this.origin(),
        description: tags.description,
      };
    }

    return {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: tags.title,
      description: tags.description,
      url,
      isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: this.origin() },
    };
  }

  private setJsonLd(data: Record<string, unknown>): void {
    this.writeJsonLdScript(JSON_LD_ID, data);
  }

  private setBreadcrumbJsonLd(breadcrumbs: { name: string; path: string }[] | undefined): void {
    const existing = this.document.getElementById(BREADCRUMB_JSON_LD_ID);
    if (!breadcrumbs || breadcrumbs.length === 0) {
      existing?.remove();
      return;
    }

    const trail = [{ name: 'Home', path: '/' }, ...breadcrumbs];
    this.writeJsonLdScript(BREADCRUMB_JSON_LD_ID, {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((crumb, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: crumb.name,
        item: this.absoluteUrl(crumb.path),
      })),
    });
  }

  private writeJsonLdScript(id: string, data: Record<string, unknown>): void {
    let script = this.document.getElementById(id) as HTMLScriptElement | null;
    if (!script) {
      script = this.document.createElement('script');
      script.id = id;
      script.type = 'application/ld+json';
      this.document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(data);
  }

  private ogImagePath(title: string): string {
    return `/api/og?title=${encodeURIComponent(title)}`;
  }

  private absoluteUrl(path: string): string {
    if (/^https?:\/\//.test(path)) return path;
    return `${this.origin()}${path}`;
  }

  private origin(): string {
    if (!this.request) return this.document.location.origin;

    const url = new URL(this.request.url);
    const proto = this.request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
    const host = this.request.headers.get('x-forwarded-host') ?? this.request.headers.get('host') ?? url.host;
    return `${proto}://${host}`;
  }
}
