import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { CurriculumGraph } from '../../models/curriculum-graph.model';
import { CurriculumGraphService } from '../../services/curriculum-graph.service';
import { MapPage } from './map-page';

const GRAPH: CurriculumGraph = {
  modules: [
    { slug: 'foundations', disciplineCount: 6, publishedConceptCount: 125 },
    { slug: 'algorithms-software', disciplineCount: 7, publishedConceptCount: 121 },
  ],
  moduleEdges: [{ from: 'foundations', to: 'algorithms-software' }],
  disciplines: [
    {
      module: 'foundations',
      discipline: 'programming-computational-thinking',
      conceptCount: 23,
      publishedAt: '2026-09-06',
      metrics: { blockingFactor: 4, delayFactor: 2, centrality: 3, complexity: 6 },
    },
    {
      module: 'foundations',
      discipline: 'discrete-math-logic',
      conceptCount: 26,
      publishedAt: '2026-09-06',
      metrics: { blockingFactor: 3, delayFactor: 2, centrality: 3, complexity: 5 },
    },
  ],
  disciplineEdges: [
    {
      from: { module: 'foundations', discipline: 'programming-computational-thinking' },
      to: { module: 'foundations', discipline: 'discrete-math-logic' },
    },
  ],
};

function setup(graphService: Partial<CurriculumGraphService>) {
  TestBed.configureTestingModule({
    imports: [MapPage],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      { provide: CurriculumGraphService, useValue: graphService },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MapPage);
  return fixture;
}

describe('MapPage', () => {
  it('shows a loading state while the graph request is pending', () => {
    const pending = new Subject<CurriculumGraph>();
    const fixture = setup({ getGraph: () => pending.asObservable() });
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Loading');
    expect(fixture.nativeElement.querySelector('.cy-container.hidden')).toBeTruthy();
  });

  it('hides the loading state and renders the graph into the canvas container once data arrives', async () => {
    const fixture = setup({ getGraph: () => of(GRAPH) });
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).not.toContain('Loading');
    expect(fixture.nativeElement.querySelector('.cy-container.hidden')).toBeFalsy();
    expect(fixture.nativeElement.querySelector('.cy-container canvas')).toBeTruthy();
  });

  it('shows an honest error state when the graph fails to load, never a blank canvas', async () => {
    const fixture = setup({ getGraph: () => throwError(() => new Error('network')) });
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Could not load');
    expect(fixture.nativeElement.querySelector('.cy-container.hidden')).toBeTruthy();
  });

  it('resets to the module overview when "back to overview" is used', async () => {
    const fixture = setup({ getGraph: () => of(GRAPH) });
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const component = fixture.componentInstance;
    (component as any).currentModule.set('foundations');
    (component as any).selected.set({ label: 'x', route: null });
    fixture.detectChanges();

    component.showModules();
    fixture.detectChanges();

    expect((component as any).currentModule()).toBeNull();
    expect((component as any).selected()).toBeNull();
  });

  it('resolves real module/discipline titles from the existing CURRICULUM registry, not fabricated labels', async () => {
    const fixture = setup({ getGraph: () => of(GRAPH) });
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    const title = (fixture.componentInstance as any).moduleTitle('foundations');
    expect(title).toBe('Foundations of Computer Science');
  });
});
