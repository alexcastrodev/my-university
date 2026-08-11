import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MermaidViewerService } from '../../services/mermaid-viewer.service';

const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
const ZOOM_STEP = 0.25;

interface Point {
  x: number;
  y: number;
}

@Component({
  selector: 'app-mermaid-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './mermaid-viewer.html',
  styleUrl: './mermaid-viewer.css',
})
export class MermaidViewer {
  private viewerService = inject(MermaidViewerService);
  private sanitizer = inject(DomSanitizer);

  protected isOpen = computed(() => this.viewerService.svg() !== null);
  protected safeSvg = computed<SafeHtml | null>(() => {
    const svg = this.viewerService.svg();
    return svg ? this.sanitizer.bypassSecurityTrustHtml(svg) : null;
  });

  protected scale = signal(1);
  protected translateX = signal(0);
  protected translateY = signal(0);
  protected scalePercent = computed(() => Math.round(this.scale() * 100));
  protected transform = computed(
    () => `translate(${this.translateX()}px, ${this.translateY()}px) scale(${this.scale()})`,
  );

  private pointers = new Map<number, Point>();
  private lastPinchDistance = 0;
  private isPanning = false;
  private panStart: Point = { x: 0, y: 0 };
  private translateStart: Point = { x: 0, y: 0 };

  constructor() {
    effect(() => {
      if (this.isOpen()) this.resetTransform();
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.close();
  }

  protected close(): void {
    this.viewerService.close();
  }

  protected resetTransform(): void {
    this.scale.set(1);
    this.translateX.set(0);
    this.translateY.set(0);
  }

  protected zoomIn(): void {
    this.setScale(this.scale() + ZOOM_STEP);
  }

  protected zoomOut(): void {
    this.setScale(this.scale() - ZOOM_STEP);
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.setScale(this.scale() + (event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP));
  }

  protected onDoubleClick(): void {
    if (this.scale() > 1) {
      this.resetTransform();
    } else {
      this.setScale(2);
    }
  }

  protected onPointerDown(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 1) {
      this.isPanning = true;
      this.panStart = { x: event.clientX, y: event.clientY };
      this.translateStart = { x: this.translateX(), y: this.translateY() };
    } else if (this.pointers.size === 2) {
      this.isPanning = false;
      this.lastPinchDistance = this.getPinchDistance();
    }
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.pointers.has(event.pointerId)) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (this.pointers.size === 2) {
      const distance = this.getPinchDistance();
      if (this.lastPinchDistance > 0) {
        this.setScale(this.scale() * (distance / this.lastPinchDistance));
      }
      this.lastPinchDistance = distance;
      return;
    }

    if (this.isPanning) {
      this.translateX.set(this.translateStart.x + (event.clientX - this.panStart.x));
      this.translateY.set(this.translateStart.y + (event.clientY - this.panStart.y));
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.lastPinchDistance = 0;
    if (this.pointers.size === 0) this.isPanning = false;
  }

  private setScale(next: number): void {
    this.scale.set(Math.min(MAX_SCALE, Math.max(MIN_SCALE, next)));
  }

  private getPinchDistance(): number {
    const [a, b] = Array.from(this.pointers.values());
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
