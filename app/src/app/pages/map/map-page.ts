import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, OnInit, PLATFORM_ID, ViewChild, afterNextRender, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import cytoscape, { Core, ElementDefinition, NodeSingular } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { CurriculumGraphService } from '../../services/curriculum-graph.service';
import { CurriculumGraph } from '../../models/curriculum-graph.model';
import { Theme, ThemeService } from '../../services/theme.service';
import { CURRICULUM, CurriculumModule } from '../computer-science/curriculum.data';

cytoscape.use(dagre);

/** The dataviz skill's validated 8-color categorical palette (light mode) — one fixed slot
 *  per CC module, in module-declaration order, never reassigned based on what's filtered/
 *  expanded (color follows the entity, not its rank). */
const MODULE_COLORS: Record<string, string> = {
  foundations: '#2a78d6',
  'algorithms-software': '#eb6834',
  computer: '#1baf7a',
  systems: '#eda100',
  'software-distributed': '#e87ba4',
  'ai-theory': '#008300',
  specialization: '#4a3aa7',
  research: '#e34948',
};

/** Canvas colors per theme. Cytoscape paints on a <canvas>, so it can't read the CSS
 *  custom properties itself; these mirror styles.css's --mu-ink / --mu-surface /
 *  --mu-divider / --mu-accent for each theme. Keyed on ThemeService's signal instead of
 *  `getComputedStyle`, which would race the effect that flips `data-theme` on <html>. */
const GRAPH_THEME: Record<Theme, { label: string; labelBg: string; nodeBorder: string; edge: string; selected: string }> = {
  light: { label: '#111827', labelBg: '#ffffff', nodeBorder: '#ffffff', edge: '#c7cbd1', selected: '#c74634' },
  dark: { label: '#f3f4f6', labelBg: '#17212f', nodeBorder: '#17212f', edge: '#4b5563', selected: '#e2574a' },
};

/** Below this container width the graph is laid out top-to-bottom: a phone in portrait is
 *  tall and narrow, so a left-to-right chain fit into it shrinks every label to unreadable. */
const NARROW_WIDTH = 640;

/**
 * `/map` — the Computer Science curriculum as an explorable graph (tasks.md · "Fase futura —
 * Knowledge Graph"), instead of only the strictly hierarchical `/computer-science` table.
 * Two levels, not one flat graph of all ~550 CC concepts (which would be an unreadable
 * hairball and exactly the "expensive in-house solution" this feature was asked to avoid):
 * module-level overview by default, drilling into one module's disciplines on click. Every
 * node is always clickable — this never gates navigation (see feedback_no_mastery_gating).
 */
@Component({
  selector: 'app-map-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="map-page">
      <header class="map-header">
        <h1 i18n="@@map.title">Curriculum Map</h1>
        <p class="map-sub" i18n="@@map.subtitle">
          The Computer Science curriculum as a graph, not a table. An edge means "builds on" —
          nothing here is locked, jump anywhere.
        </p>
        @if (currentModule(); as mod) {
          <button type="button" class="back-btn" (click)="showModules()">
            <span i18n="@@map.backToOverview">← Back to overview</span>
          </button>
          <span class="breadcrumb-current">{{ moduleTitle(mod) }}</span>
        }
      </header>

      @if (loading()) {
        <p class="map-status" i18n="@@map.loading">Loading the graph…</p>
      } @else if (error()) {
        <p class="map-status map-error" i18n="@@map.error">Could not load the curriculum graph.</p>
      }

      <div #cyContainer class="cy-container" [class.hidden]="loading() || error()"></div>

      @if (selected(); as node) {
        <aside class="node-detail">
          <button type="button" class="close-btn" (click)="selected.set(null)" aria-label="Close" i18n-aria-label="@@map.close">×</button>
          <h2>{{ node.label }}</h2>
          <dl>
            <dt i18n="@@map.metric.blocking">Blocking factor</dt>
            <dd>{{ node.metrics?.blockingFactor ?? '—' }}</dd>
            <dt i18n="@@map.metric.delay">Delay factor</dt>
            <dd>{{ node.metrics?.delayFactor ?? '—' }}</dd>
            <dt i18n="@@map.metric.centrality">Centrality</dt>
            <dd>{{ node.metrics?.centrality ?? '—' }}</dd>
          </dl>
          @if (node.route) {
            <button type="button" class="open-btn" (click)="openNode(node.route)">
              <span i18n="@@map.open">Open →</span>
            </button>
          }
        </aside>
      }
    </div>
  `,
  styleUrl: './map-page.css',
})
export class MapPage implements OnInit, OnDestroy {
  @ViewChild('cyContainer') private cyContainer!: ElementRef<HTMLDivElement>;

  private graphService = inject(CurriculumGraphService);
  private router = inject(Router);
  private platformId = inject(PLATFORM_ID);
  private injector = inject(Injector);
  private themeService = inject(ThemeService);

  protected readonly loading = signal(true);
  protected readonly error = signal(false);
  protected readonly currentModule = signal<string | null>(null);
  protected readonly selected = signal<{
    label: string;
    route: string[] | null;
    metrics?: { blockingFactor: number; delayFactor: number; centrality: number };
  } | null>(null);

  private graph: CurriculumGraph | null = null;
  private cy: Core | null = null;
  private narrow = false;
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly onWindowResize = () => {
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => this.handleResize(), 150);
  };

  constructor() {
    // Repaint in place when the theme is switched while the map is open.
    effect(() => {
      const theme = this.themeService.theme();
      this.cy?.style(this.graphStyle(theme));
    });
  }

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('resize', this.onWindowResize);
    }

    this.graphService.getGraph().subscribe({
      next: (graph) => {
        this.graph = graph;
        this.loading.set(false);
        // `queueMicrotask` isn't safe here: on a cache-hit (e.g. transfer-state on first
        // client render after SSR) this `next` runs synchronously, racing Angular's own
        // zoneless change detection that still needs to flip the @if and mount
        // `#cyContainer` into the DOM. `afterNextRender` is the platform-provided,
        // browser-only primitive for exactly this — guaranteed to run after that DOM
        // update lands, and a no-op during SSR (paired with `mount()`'s own guard below).
        afterNextRender(() => this.renderModules(), { injector: this.injector });
      },
      error: () => {
        this.loading.set(false);
        this.error.set(true);
      },
    });
  }

  ngOnDestroy(): void {
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.onWindowResize);
    }
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.cy?.destroy();
  }

  /** Rotation or a resized window: re-run the layout if it crossed the narrow/wide
   *  breakpoint (changes rank direction), otherwise just refit to the new box. */
  private handleResize(): void {
    const cy = this.cy;
    if (!cy || cy.destroyed()) return;
    const narrow = this.isNarrow();
    cy.resize();
    if (narrow !== this.narrow) {
      this.narrow = narrow;
      cy.style(this.graphStyle(this.themeService.theme()));
      cy.layout(this.layoutOptions()).run();
    }
    this.fitGraph(cy);
  }

  private isNarrow(): boolean {
    const width = this.cyContainer?.nativeElement.clientWidth || window.innerWidth;
    return width < NARROW_WIDTH;
  }

  private layoutOptions(): cytoscape.LayoutOptions {
    return (
      this.narrow
        ? { name: 'dagre', rankDir: 'TB', nodeSep: 16, rankSep: 40, nodeDimensionsIncludeLabels: true, fit: false }
        : { name: 'dagre', rankDir: 'LR', nodeSep: 60, rankSep: 100, fit: false }
    ) as unknown as cytoscape.LayoutOptions;
  }

  private graphStyle(theme: Theme): cytoscape.StylesheetJson {
    const colors = GRAPH_THEME[theme];
    return [
      {
        selector: 'node',
        style: {
          'background-color': 'data(color)',
          label: 'data(label)',
          color: colors.label,
          'font-size': this.narrow ? '13px' : '11px',
          'font-weight': 600,
          'text-valign': 'bottom',
          'text-margin-y': 6,
          'text-wrap': 'wrap',
          'text-max-width': this.narrow ? '120px' : '90px',
          'text-halign': 'center',
          // A surface-colored pill behind each label keeps it legible where it crosses
          // an edge, in either theme.
          'text-background-color': colors.labelBg,
          'text-background-opacity': 0.85,
          'text-background-padding': '2px',
          'text-background-shape': 'roundrectangle',
          width: 32,
          height: 32,
          'border-width': 2,
          'border-color': colors.nodeBorder,
        },
      },
      {
        selector: 'edge',
        style: {
          width: 1.5,
          'line-color': colors.edge,
          'target-arrow-color': colors.edge,
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
        },
      },
      {
        selector: 'node:selected',
        style: { 'border-color': colors.selected, 'border-width': 3 },
      },
    ];
  }

  private fitGraph(cy: Core): void {
    cy.fit(undefined, this.narrow ? 24 : 40);
    // A tall top-to-bottom graph fit into a phone would zoom out until labels are
    // unreadable; past this floor, keep them legible and let the user pan instead,
    // starting from the top (the roots) rather than the middle.
    const minReadableZoom = 0.75;
    if (this.narrow && cy.zoom() < minReadableZoom) {
      cy.zoom(minReadableZoom);
      const bb = cy.elements().boundingBox();
      cy.pan({
        x: (cy.width() - (bb.x1 + bb.x2) * minReadableZoom) / 2,
        y: 24 - bb.y1 * minReadableZoom,
      });
    }
  }

  protected moduleTitle(slug: string): string {
    const mod = CURRICULUM.find((m: CurriculumModule) => m.slug === slug);
    return mod?.title ?? slug;
  }

  private disciplineTitle(mod: string, discipline: string): string {
    const found = CURRICULUM.find((m: CurriculumModule) => m.slug === mod)?.disciplines?.find(
      (d) => d.slug === discipline,
    );
    return found?.title ?? discipline;
  }

  showModules(): void {
    this.currentModule.set(null);
    this.selected.set(null);
    this.renderModules();
  }

  private renderModules(): void {
    if (!this.graph) return;
    const elements: ElementDefinition[] = [
      ...this.graph.modules.map((m) => ({
        data: {
          id: m.slug,
          label: this.moduleTitle(m.slug),
          color: MODULE_COLORS[m.slug] ?? '#6b7280',
          count: m.publishedConceptCount,
        },
      })),
      ...this.graph.moduleEdges.map((e) => ({
        data: { id: `${e.from}->${e.to}`, source: e.from, target: e.to },
      })),
    ];

    this.mount(elements, (node) => {
      this.currentModule.set(node.id());
      this.selected.set(null);
      this.renderDiscipline(node.id());
    });
  }

  private renderDiscipline(moduleSlug: string): void {
    if (!this.graph) return;
    const disciplines = this.graph.disciplines.filter((d) => d.module === moduleSlug);
    const disciplineSlugs = new Set(disciplines.map((d) => d.discipline));
    const edges = this.graph.disciplineEdges.filter(
      (e) =>
        e.from.module === moduleSlug &&
        e.to.module === moduleSlug &&
        disciplineSlugs.has(e.from.discipline) &&
        disciplineSlugs.has(e.to.discipline),
    );

    const elements: ElementDefinition[] = [
      ...disciplines.map((d) => ({
        data: {
          id: d.discipline,
          label: this.disciplineTitle(d.module, d.discipline),
          color: MODULE_COLORS[moduleSlug] ?? '#6b7280',
          count: d.conceptCount,
          metrics: d.metrics,
          route: ['/computer-science', d.module, d.discipline],
        },
      })),
      ...edges.map((e) => ({
        data: { id: `${e.from.discipline}->${e.to.discipline}`, source: e.from.discipline, target: e.to.discipline },
      })),
    ];

    this.mount(elements, (node) => {
      const data = node.data();
      this.selected.set({
        label: data['label'],
        route: data['route'] ?? null,
        metrics: data['metrics'],
      });
    });
  }

  private mount(elements: ElementDefinition[], onNodeTap: (node: NodeSingular) => void): void {
    // Cytoscape needs a real <canvas> 2D context — the server-side render's DOM emulator
    // (Domino) doesn't implement one and crashes the whole SSR pass if this runs there (the
    // same reason RenderMermaidDirective guards itself the same way). The client re-runs
    // this after hydration with a real browser DOM, same as every other client-only widget.
    if (!isPlatformBrowser(this.platformId)) return;

    this.cy?.destroy();
    this.narrow = this.isNarrow();
    this.cy = cytoscape({
      container: this.cyContainer.nativeElement,
      elements,
      style: this.graphStyle(this.themeService.theme()),
      layout: this.layoutOptions(),
      minZoom: 0.15,
      maxZoom: 2.5,
    });

    this.cy.on('tap', 'node', (evt) => onNodeTap(evt.target));

    // `fit` on the layout options races the container's real size on a fresh SPA
    // navigation (Angular hasn't necessarily finished laying out the route yet when this
    // runs) — most visible on a narrow viewport, where it previously fit against a stale,
    // wider measurement and clipped the leftmost node. Resizing + fitting explicitly, one
    // frame later, reads the container's actual final dimensions instead. Captures this
    // exact `cy` instance rather than re-reading `this.cy`: a fast destroy+remount (a real
    // possibility — a user tapping between modules quickly, or a test's teardown) could
    // otherwise land this callback on a *different*, unrelated instance, or a destroyed one.
    const cy = this.cy;
    requestAnimationFrame(() => {
      if (cy.destroyed()) return;
      cy.resize();
      this.fitGraph(cy);
    });
  }

  openNode(route: string[]): void {
    this.router.navigate(route);
  }
}
