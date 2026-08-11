import { isPlatformBrowser } from '@angular/common';
import { AfterViewChecked, Directive, ElementRef, PLATFORM_ID, inject } from '@angular/core';
import mermaid from 'mermaid';
import { MermaidViewerService } from '../services/mermaid-viewer.service';

let mermaidInitialized = false;

function ensureMermaidInitialized(): void {
  if (mermaidInitialized) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      primaryColor: '#fff1ef',
      primaryBorderColor: '#c74634',
      primaryTextColor: '#111827',
      lineColor: '#c4cad4',
      secondaryColor: '#f9fafb',
      tertiaryColor: '#f9fafb',
      fontFamily: 'inherit',
      fontSize: '15px',
      noteBkgColor: '#fef9e7',
      noteBorderColor: '#f5cf6b',
      noteTextColor: '#57534e',
      actorBkg: '#fff1ef',
      actorBorder: '#c74634',
      actorTextColor: '#111827',
      signalColor: '#94a3b8',
      signalTextColor: '#374151',
      labelBoxBkgColor: '#fff1ef',
      labelBoxBorderColor: '#c74634',
      labelTextColor: '#111827',
      edgeLabelBackground: '#f9fafb',
    },
    flowchart: {
      curve: 'basis',
      padding: 16,
      htmlLabels: true,
    },
    sequence: {
      actorMargin: 60,
      messageMargin: 40,
      boxMargin: 10,
      mirrorActors: false,
    },
  });
  mermaidInitialized = true;
}

let renderCounter = 0;

@Directive({
  selector: '[appRenderMermaid]',
})
export class RenderMermaidDirective implements AfterViewChecked {
  private host = inject(ElementRef<HTMLElement>);
  private platformId = inject(PLATFORM_ID);
  private viewerService = inject(MermaidViewerService);
  private rendered = new WeakSet<HTMLElement>();

  ngAfterViewChecked(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const element: HTMLElement = this.host.nativeElement;
    const nodes: NodeListOf<HTMLElement> = element.querySelectorAll('.mermaid-diagram[data-mermaid-source]');
    if (!nodes.length) return;

    ensureMermaidInitialized();

    nodes.forEach((node) => {
      if (this.rendered.has(node)) return;
      this.rendered.add(node);

      const source = decodeURIComponent(node.dataset['mermaidSource'] ?? '');
      if (!source) return;

      const id = `mermaid-diagram-${++renderCounter}`;
      mermaid
        .render(id, source)
        .then(({ svg }) => {
          node.innerHTML = svg;
          this.makeZoomable(node, svg);
        })
        .catch((error) => {
          node.textContent = 'Diagram could not be rendered.';
          console.error('Mermaid render failed', error);
        });
    });
  }

  private makeZoomable(node: HTMLElement, svg: string): void {
    node.style.cursor = 'zoom-in';
    node.title = 'Click to zoom';
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', 'Open diagram in zoomable view');

    const open = (): void => this.viewerService.open(svg);

    node.addEventListener('click', open);
    node.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  }
}
