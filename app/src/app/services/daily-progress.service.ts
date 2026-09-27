import { Injectable, computed, signal } from '@angular/core';
import { DailySession } from '../models/daily.model';

/** Where the card runner was when the user left it: enough to put them back on the same card. */
export interface DailyProgress {
  session: DailySession;
  index: number;
  earned: number;
  earnedCards: number[];
  completedKeys: string[];
  recallAnswered: 'remembered' | 'forgot' | null;
  revealed: boolean;
  writeText: string;
  writeSaved: boolean;
}

/**
 * Keeps a daily session alive while the user follows "Read the full topic" out of it.
 * `DailySessionPage` parks its state here right before leaving and takes it back when it is
 * opened again, instead of rebuilding a new session (which could come back different: the
 * Recall just rated is no longer due). `topicUrl` drives `DailyReturnPill`, the way back.
 * In memory only: a full reload starts a fresh session, which is fine.
 */
@Injectable({ providedIn: 'root' })
export class DailyProgressService {
  private readonly parked = signal<{ progress: DailyProgress; topicUrl: string } | null>(null);

  /** Path of the topic opened from the session, while a session is parked. */
  readonly topicUrl = computed(() => this.parked()?.topicUrl ?? null);

  park(progress: DailyProgress, topicUrl: string): void {
    this.parked.set({ progress, topicUrl });
  }

  /** Hands the parked state back once and forgets it. */
  take(): DailyProgress | null {
    const parked = this.parked();
    this.parked.set(null);
    return parked?.progress ?? null;
  }

  discard(): void {
    this.parked.set(null);
  }
}
