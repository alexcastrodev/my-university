import { ChangeDetectionStrategy, Component, HostListener, computed, signal } from '@angular/core';

@Component({
  selector: 'app-reading-progress-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reading-progress-bar.html',
  styleUrl: './reading-progress-bar.css',
})
export class ReadingProgressBar {
  progress = signal(0);
  percent = computed(() => Math.round(this.progress() * 100));

  @HostListener('window:scroll')
  @HostListener('window:resize')
  onScroll(): void {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    this.progress.set(scrollable > 0 ? Math.min(1, Math.max(0, doc.scrollTop / scrollable)) : 0);
  }
}
