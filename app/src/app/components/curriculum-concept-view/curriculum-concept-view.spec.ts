import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CurriculumConceptDetail } from '../../models/curriculum-concept.model';
import { CurriculumConceptView } from './curriculum-concept-view';

const BASE_PATH = '/computer-science/software-distributed/compilers';

function makeConcept(related: CurriculumConceptDetail['related']): CurriculumConceptDetail {
  return {
    slug: 'instruction-selection-tree-pattern-matching',
    id: 18,
    title: 'Instruction Selection: Tree Pattern Matching',
    summary: 'Summary.',
    publishedAt: '2026-09-07',
    read: false,
    language: 'en',
    availableLanguages: ['en'],
    version: '1.0',
    updatedAt: null,
    sections: [],
    references: [],
    related,
  };
}

describe('CurriculumConceptView', () => {
  function setup(related: CurriculumConceptDetail['related']) {
    TestBed.configureTestingModule({
      imports: [CurriculumConceptView],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(CurriculumConceptView);
    fixture.componentRef.setInput('concept', makeConcept(related));
    fixture.componentRef.setInput('basePath', BASE_PATH);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('resolves a related entry with no feature to a same-discipline route', () => {
    const component = setup([{ label: 'Register Allocation', slug: 'register-allocation-via-graph-coloring' }]);

    expect(component.relatedItems()).toEqual([
      { label: 'Register Allocation', route: [BASE_PATH, 'register-allocation-via-graph-coloring'] },
    ]);
  });

  it('resolves a "curriculum/<module>/<discipline>" feature to a cross-discipline CC route', () => {
    const component = setup([
      {
        label: 'x86-64 Registers and Data Movement',
        slug: 'x86-64-registers-and-data-movement',
        feature: 'curriculum/computer/c-and-assembly',
      },
    ]);

    expect(component.relatedItems()).toEqual([
      {
        label: 'x86-64 Registers and Data Movement',
        route: ['/computer-science', 'computer', 'c-and-assembly', 'x86-64-registers-and-data-movement'],
      },
    ]);
  });

  it('resolves a Complementary Studies track feature to that track\'s real route', () => {
    const component = setup([
      { label: 'Quicksort', slug: 'quicksort', feature: 'algorithms-concepts' },
    ]);

    expect(component.relatedItems()).toEqual([
      { label: 'Quicksort', route: ['/algorithms/algorithms-concepts', 'quicksort'] },
    ]);
  });

  it('degrades an unrecognized feature to a plain-text label instead of a broken link', () => {
    const component = setup([
      { label: 'Some Future Track', slug: 'some-slug', feature: 'not-a-real-feature' },
    ]);

    expect(component.relatedItems()).toEqual([{ label: 'Some Future Track', route: null }]);
  });

  it('keeps a plain-string related entry as a label with no route', () => {
    const component = setup(['A free-text mention with no page yet']);

    expect(component.relatedItems()).toEqual([
      { label: 'A free-text mention with no page yet', route: null },
    ]);
  });
});
