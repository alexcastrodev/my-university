import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, OnInit, PLATFORM_ID, ViewChild, afterNextRender, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import cytoscape, { Core, ElementDefinition, NodeSingular } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import { CurriculumGraphService } from '../../services/curriculum-graph.service';
import { CurriculumGraph } from '../../models/curriculum-graph.model';
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

type ViewLevel = 'modules' | { module: string };

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
          <span class="breadcrumb-current">{{ mod }}</span>
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

  ngOnInit(): void {
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
    this.cy?.destroy();
  }

  private moduleTitle(slug: string): string {
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
    this.cy = cytoscape({
      container: this.cyContainer.nativeElement,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            label: 'data(label)',
            color: '#111827',
            'font-size': '11px',
            'text-valign': 'bottom',
            'text-margin-y': 8,
            'text-wrap': 'wrap',
            'text-max-width': '90px',
            'text-halign': 'center',
            width: 32,
            height: 32,
            'border-width': 2,
            'border-color': '#ffffff',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 1.5,
            'line-color': '#c7cbd1',
            'target-arrow-color': '#c7cbd1',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
          },
        },
        {
          selector: 'node:selected',
          style: { 'border-color': '#c74634', 'border-width': 3 },
        },
      ],
      layout: { name: 'dagre', rankDir: 'LR', nodeSep: 60, rankSep: 100, fit: false } as unknown as cytoscape.LayoutOptions,
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
      cy.fit(undefined, 40);
    });
  }

  openNode(route: string[]): void {
    this.router.navigate(route);
  }
}
