import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DomSanitizer } from '@angular/platform-browser';
import { RenderMermaidDirective } from './render-mermaid.directive';

@Component({
  imports: [RenderMermaidDirective],
  template: `<div appRenderMermaid [innerHTML]="html"></div>`,
})
class HostComponent {
  // Trusted the same way parseMarkdown trusts rendered concept HTML, so the data attribute survives.
  html = inject(DomSanitizer).bypassSecurityTrustHtml(
    `<div class="mermaid-diagram" data-mermaid-source="${encodeURIComponent('graph TD; A-->B')}"></div>`,
  );
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('RenderMermaidDirective', () => {
  it('loads mermaid on demand and renders the diagram once', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const node: HTMLElement = fixture.nativeElement.querySelector('.mermaid-diagram');

    await waitFor(() => node.querySelector('svg') !== null);
    expect(node.getAttribute('role')).toBe('button');

    // Later change detection passes must not render the same node again.
    const svg = node.querySelector('svg');
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(node.querySelector('svg')).toBe(svg);
  }, 20_000);
});
