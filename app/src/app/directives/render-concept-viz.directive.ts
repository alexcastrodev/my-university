import { isPlatformBrowser } from '@angular/common';
import { AfterViewChecked, Directive, ElementRef, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { renderConceptViz } from 'algorithmator';

@Directive({
  selector: '[appRenderConceptViz]',
})
export class RenderConceptVizDirective implements AfterViewChecked, OnDestroy {
  private host = inject(ElementRef<HTMLElement>);
  private platformId = inject(PLATFORM_ID);
  private rendered = new WeakSet<HTMLElement>();
  private cleanups: (() => void)[] = [];

  ngAfterViewChecked(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const element: HTMLElement = this.host.nativeElement;
    const nodes = element.querySelectorAll<HTMLElement>('.concept-viz[data-viz-source]');
    if (!nodes.length) return;

    nodes.forEach((node) => {
      if (this.rendered.has(node)) return;
      this.rendered.add(node);

      const source = decodeURIComponent(node.dataset['vizSource'] ?? '');
      this.cleanups.push(renderConceptViz(node, source));
    });
  }

  ngOnDestroy(): void {
    this.cleanups.forEach((cleanup) => cleanup());
  }
}
