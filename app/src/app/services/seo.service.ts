import { Injectable, REQUEST, RESPONSE_INIT, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';

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
}

const SITE_NAME = 'My University';
const JSON_LD_ID = 'seo-json-ld';

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

    this.setCanonical(url);
    this.setJsonLd(this.buildJsonLd(tags, url, image));
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
    let script = this.document.getElementById(JSON_LD_ID) as HTMLScriptElement | null;
    if (!script) {
      script = this.document.createElement('script');
      script.id = JSON_LD_ID;
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
