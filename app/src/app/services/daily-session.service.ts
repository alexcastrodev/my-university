import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { DailyCardType, DailySession } from '../models/daily.model';
import { ReviewRating, ReviewSourceType } from '../models/review.model';
import { AuthService } from './auth.service';

/**
 * Assembles the daily session.
 *
 * Logged-in: `GET /api/daily/session` (`DailyController`/`DailyService`, tasks.md · grupo F) —
 * built from the user's real due reviews (Recall) and read history (Read/Notice/Write), never
 * fabricated. `POST /api/daily/complete` records each card's outcome (rating, write text) and
 * grants XP, called by `DailySessionPage` as the user finishes each card.
 *
 * Logged-out: there is no session to build (no user, no history, no due reviews), so this
 * serves a static, clearly-illustrative preview instead of a 401 — same shape, so the page
 * renders identically either way.
 */
@Injectable({ providedIn: 'root' })
export class DailySessionService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  build(): Observable<DailySession> {
    if (!this.auth.currentUser()) {
      return of(this.previewSession());
    }
    return this.http.get<DailySession>('/api/daily/session');
  }

  complete(
    type: DailyCardType,
    sourceId: string,
    extra: { sourceType?: ReviewSourceType; rating?: ReviewRating; text?: string } = {},
  ): Observable<{ xpAwarded: number }> {
    return this.http.post<{ xpAwarded: number }>('/api/daily/complete', {
      type,
      sourceId,
      ...extra,
    });
  }

  /** Logged-out-only illustrative sample — never persisted, never posted back. */
  private previewSession(): DailySession {
    return {
      estimatedMinutes: 5,
      summary: {
        headline: 'You renewed a mark and changed one sentence',
        tomorrow: {
          title: 'ThreadLocal · where weak references actually leak',
          body: 'It depends on what you just renewed. Nothing is scheduled — the session is assembled when you open it.',
        },
      },
      cards: [
        {
          type: 'recall',
          xp: 20,
          previewTitle: 'Reference reachability',
          previewSubtitle: 'Marked in March · Java Concepts',
          recap: 'Recall · reference reachability',
          kicker: 'RECALL · NO LOOKING BACK',
          title: 'Reference reachability',
          context: 'You marked "Reference reachability" as "Got it" before. Does it still hold?',
          sourceType: 'concept-read',
          sourceId: 'reference-reachability',
          route: ['/java/java-concepts', 'reference-reachability'],
          wrongNote:
            "Getting it wrong is not a penalty. It reopens the topic and puts it back in a future session.",
        },
        {
          type: 'read',
          xp: 20,
          previewTitle: 'WeakHashMap · one screen',
          previewSubtitle: 'Where you stopped on Monday',
          recap: 'Read · WeakHashMap internals',
          kicker: 'READ · ONE SCREEN',
          breadcrumb: 'Java Concepts · Collections · WeakHashMap',
          title: 'The key lives inside a WeakReference, not as an ordinary field',
          body:
            "Each entry holds its key through a WeakReference<K> registered on the map's own reference queue.\n\n" +
            'While anything outside the map keeps a strong reference, the entry behaves exactly like a HashMap entry. ' +
            'The moment that reference disappears, the key becomes collectable — regardless of the map holding it.',
          code: {
            header: 'JAVA',
            source: 'key = null;\nSystem.gc();\nregistry.size();  // eventually 0',
          },
          note: 'This is the whole card. The full topic stays in Java Concepts.',
          fullTopicRoute: ['/java/java-concepts'],
          sourceId: 'weakhashmap',
        },
        {
          type: 'notice',
          xp: 20,
          previewTitle: 'One line of real JDK source',
          previewSubtitle: 'JVM Internals · complementary',
          recap: 'Notice · expungeStaleEntries',
          kicker: 'NOTICE · FROM THE REAL SOURCE',
          title: 'What does expungeStaleEntries tell you about timing?',
          code: {
            header: 'JAVA.UTIL.WEAKHASHMAP',
            badge: 'JDK 21',
            source:
              'private void expungeStaleEntries() {\n' +
              '  for (Object x; (x = queue.poll())\n' +
              '       != null; ) {\n' +
              '    // removes entries whose keys\n' +
              '    // were already collected\n' +
              '  }\n' +
              '}',
          },
          lead: 'This method is called by size(), get() and put() — not by the collector.',
          takeawayLabel: 'SO',
          takeaway:
            'The map shrinks when you touch it, not when the object dies. An untouched WeakHashMap holds stale entries indefinitely.',
          sourceId: 'weakhashmap',
        },
        {
          type: 'write',
          xp: 20,
          previewTitle: 'One line, in your own words',
          previewSubtitle: 'Kept next to your March answer',
          recap: 'Write · answer saved',
          kicker: 'WRITE · ONE LINE',
          title: 'In your own words: who decides when the entry disappears?',
          placeholderHint: 'One or two sentences is enough',
          maxLength: 240,
          pastAnswer: {
            when: 'YOU WROTE IN MARCH',
            text: '"Weak keys get deleted when the GC runs."',
            note: 'Both answers are kept. Neither replaces the other.',
          },
          footnote:
            'Marking this topic renews it for six months and adds 20 XP. The lab in JVM Internals is worth 120, when you want proof rather than a claim.',
          sourceId: 'weakhashmap',
        },
      ],
    };
  }
}
