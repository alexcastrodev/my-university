import { isPlatformBrowser } from '@angular/common';
import { AfterViewChecked, Directive, ElementRef, PLATFORM_ID, inject } from '@angular/core';
import mermaid from 'mermaid';
import { MermaidViewerService } from '../services/mermaid-viewer.service';

type MermaidTheme = 'light' | 'dark';

/* Mermaid bakes these colors into each SVG, so they cannot follow the CSS theme
   tokens. The dark palette mirrors styles.css's `:root[data-theme='dark']` values:
   text that sits straight on the diagram background (sequence messages, loop labels,
   cluster titles) needs a light fill there, or it ends up dark-on-dark. */
const THEME_VARIABLES: Record<MermaidTheme, Record<string, string | boolean>> = {
  light: {
    primaryColor: '#fff1ef',
    primaryBorderColor: '#c74634',
    primaryTextColor: '#111827',
    lineColor: '#c4cad4',
    secondaryColor: '#f9fafb',
    tertiaryColor: '#f9fafb',
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
  dark: {
    darkMode: true,
    background: '#1c2734',
    primaryColor: '#3a221e',
    primaryBorderColor: '#e2574a',
    primaryTextColor: '#f3f4f6',
    lineColor: '#8b95a5',
    secondaryColor: '#232d3d',
    tertiaryColor: '#232d3d',
    textColor: '#d7dce3',
    titleColor: '#f3f4f6',
    clusterBkg: '#232d3d',
    clusterBorder: '#38445a',
    noteBkgColor: '#3a2e14',
    noteBorderColor: '#a16207',
    noteTextColor: '#fde68a',
    actorBkg: '#3a221e',
    actorBorder: '#e2574a',
    actorTextColor: '#f3f4f6',
    actorLineColor: '#8b95a5',
    signalColor: '#9ca3af',
    signalTextColor: '#e5e7eb',
    labelBoxBkgColor: '#3a221e',
    labelBoxBorderColor: '#e2574a',
    labelTextColor: '#f3f4f6',
    loopTextColor: '#e5e7eb',
    activationBkgColor: '#2a3444',
    activationBorderColor: '#8b95a5',
    sequenceNumberColor: '#111827',
    edgeLabelBackground: '#1c2734',
  },
};

let initializedTheme: MermaidTheme | null = null;

function currentTheme(): MermaidTheme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** (Re)initializes mermaid whenever the app theme differs from the one it was last
 *  configured for, so diagrams rendered after a theme switch pick the matching palette. */
function ensureMermaidInitialized(): void {
  const theme = currentTheme();
  if (initializedTheme === theme) return;
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    themeVariables: {
      fontFamily: 'inherit',
      fontSize: '15px',
      ...THEME_VARIABLES[theme],
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
  initializedTheme = theme;
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
