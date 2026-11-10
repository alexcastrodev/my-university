import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PaperFullText } from './paper-full-text';

// The pages themselves are drawn by pdf.js in a worker, which the Playwright specs cover on the real stack;
// here is what the reader sees before and around the PDF.
describe('PaperFullText', () => {
  let fixture: ComponentFixture<PaperFullText>;
  let http: HttpTestingController;
  const root = () => fixture.nativeElement as HTMLElement;
  const button = (label: RegExp) => [...root().querySelectorAll('button')].find((b) => label.test(b.textContent ?? ''));
  const URL = '/api/papers/paxos-made-simple/full-text';

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    fixture = TestBed.createComponent(PaperFullText);
    fixture.componentRef.setInput('slug', 'paxos-made-simple');
    fixture.detectChanges();
    await fixture.whenStable();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks the API for the PDF on its own once the page has rendered, and shows a loading state meanwhile', async () => {
    expect(root().querySelector('[role="status"]')).toBeTruthy();
    expect(button(/Read the paper here/)).toBeUndefined();
    http.expectOne(URL).flush(new ArrayBuffer(0), { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
  });

  it('says the preview is not available, and lets the reader try again, when the PDF cannot be fetched', async () => {
    http.expectOne(URL).flush(new ArrayBuffer(0), { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(root().querySelector('[role="alert"]')?.textContent).toContain('Preview not available');
    button(/Try again/)!.click();
    http.expectOne(URL).flush(new ArrayBuffer(0), { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
  });
});
