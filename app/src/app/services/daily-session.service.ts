import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { DailySession } from '../models/daily.model';

/**
 * Assembles the daily session.
 *
 * For now this returns a curated session client-side so the whole mobile
 * flow is functional and demonstrable end-to-end. It is the single seam
 * where a backend "session builder" endpoint (tasks.md · grupo F —
 * GET /api/daily/session) will plug in: it must return the same
 * `DailySession` shape, mixing marks-due (recall), last-read (read),
 * real source (notice) and a write prompt. XP/streak are NOT part of this
 * payload — they stay owned by XpService and are read live by the pages.
 */
@Injectable({ providedIn: 'root' })
export class DailySessionService {
  build(): Observable<DailySession> {
    return of(this.sampleSession());
  }

  private sampleSession(): DailySession {
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
          title: 'When does a weakly reachable object become eligible for collection?',
          context:
            'You marked this "got it" 6 months ago. Answer from memory first — the mark renews only if you still can.',
          options: [
            'As soon as the garbage collector runs',
            'When no strong reference to it exists anywhere',
            'When the map holding it is cleared',
            'Immediately after the reference is created',
          ],
          correctIndex: 1,
          wrongNote:
            "Getting it wrong is not a penalty. It reopens the topic and puts the reading back in tomorrow's session.",
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
        },
      ],
    };
  }
}
