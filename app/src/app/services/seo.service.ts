import { Injectable, REQUEST, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Meta, Title } from '@angular/platform-browser';

export interface SeoTags {
  title: string;
  description: string;
  path: string;
  image?: string;
  type?: 'website' | 'article';
}

const DEFAULT_IMAGE = '/favicon.svg';

@Injectable({ providedIn: 'root' })
export class SeoService {
  private meta = inject(Meta);
  private title = inject(Title);
  private document = inject(DOCUMENT);
  private request = inject(REQUEST, { optional: true });

  set(tags: SeoTags): void {
    const image = this.absoluteUrl(tags.image ?? DEFAULT_IMAGE);
    const url = this.absoluteUrl(tags.path);

    this.title.setTitle(tags.title);

    this.meta.updateTag({ name: 'description', content: tags.description });

    this.meta.updateTag({ property: 'og:title', content: tags.title });
    this.meta.updateTag({ property: 'og:description', content: tags.description });
    this.meta.updateTag({ property: 'og:url', content: url });
    this.meta.updateTag({ property: 'og:image', content: image });
    this.meta.updateTag({ property: 'og:type', content: tags.type ?? 'website' });

    this.meta.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
    this.meta.updateTag({ name: 'twitter:title', content: tags.title });
    this.meta.updateTag({ name: 'twitter:description', content: tags.description });
    this.meta.updateTag({ name: 'twitter:image', content: image });
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
