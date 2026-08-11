import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class MermaidViewerService {
  svg = signal<string | null>(null);

  open(svg: string): void {
    this.svg.set(svg);
  }

  close(): void {
    this.svg.set(null);
  }
}
