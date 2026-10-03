import { isPlatformBrowser } from '@angular/common';
import { AfterViewChecked, Directive, ElementRef, OnDestroy, PLATFORM_ID, inject } from '@angular/core';

type Algorithmator = typeof import('algorithmator');

/* algorithmator pulls in mathjs and d3 (~800 KB minified together), and only a handful of
   concepts have a viz block, so the engine is fetched as its own chunk the first time a page
   needs it instead of riding along with every concept route. */
let algorithmator: Promise<Algorithmator> | null = null;

function loadAlgorithmator(): Promise<Algorithmator> {
  algorithmator ??= import('algorithmator');
  return algorithmator;
}

@Directive({
  selector: '[appRenderConceptViz]',
})
export class RenderConceptVizDirective implements AfterViewChecked, OnDestroy {
  private host = inject(ElementRef<HTMLElement>);
  private platformId = inject(PLATFORM_ID);
  private rendered = new WeakSet<HTMLElement>();
  private cleanups: (() => void)[] = [];
  private destroyed = false;

  ngAfterViewChecked(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const element: HTMLElement = this.host.nativeElement;
    const nodes = element.querySelectorAll<HTMLElement>('.concept-viz[data-viz-source]');
    const pending = Array.from(nodes).filter((node) => !this.rendered.has(node));
    if (!pending.length) return;
    pending.forEach((node) => this.rendered.add(node));

    loadAlgorithmator()
      .then(({ renderConceptViz }) => {
        // The page may have been left while the chunk was in flight.
        if (this.destroyed) return;
        pending.forEach((node) => {
          const source = decodeURIComponent(node.dataset['vizSource'] ?? '');
          this.cleanups.push(renderConceptViz(node, source));
        });
      })
      .catch((error) => console.error('Concept viz failed to load', error));
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.cleanups.forEach((cleanup) => cleanup());
  }
}
