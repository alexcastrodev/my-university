import { Injectable, signal } from '@angular/core';

export interface XpToast {
  id: number;
  amount: number;
}

const AUTO_DISMISS_MS = 3000;

@Injectable({ providedIn: 'root' })
export class XpToastService {
  toasts = signal<XpToast[]>([]);

  private nextId = 0;

  show(amount: number): void {
    const id = this.nextId++;
    this.toasts.update((toasts) => [...toasts, { id, amount }]);
    setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
  }

  dismiss(id: number): void {
    this.toasts.update((toasts) => toasts.filter((toast) => toast.id !== id));
  }
}
