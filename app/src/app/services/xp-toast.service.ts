import { Injectable, signal } from '@angular/core';

export interface XpToast {
  id: number;
  amount: number;
  /** Set for an award ("Badge unlocked: ..."); a plain XP toast has none. */
  label?: string;
  icon?: string;
}

const AUTO_DISMISS_MS = 3000;
const AWARD_DISMISS_MS = 5000;

@Injectable({ providedIn: 'root' })
export class XpToastService {
  toasts = signal<XpToast[]>([]);

  private nextId = 0;

  show(amount: number, award?: { label: string; icon: string }): void {
    const id = this.nextId++;
    this.toasts.update((toasts) => [...toasts, { id, amount, ...award }]);
    setTimeout(() => this.dismiss(id), award ? AWARD_DISMISS_MS : AUTO_DISMISS_MS);
  }

  dismiss(id: number): void {
    this.toasts.update((toasts) => toasts.filter((toast) => toast.id !== id));
  }
}
