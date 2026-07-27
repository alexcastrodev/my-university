# GitHub-only login + XP/Levels revamp + "Got it!" read-tracking

## Context

The platform currently has a bare-bones, home-grown auth system (login by typing any display name, no password) and a minimal XP counter (a single "⚡ N XP" number in the header, earned only from completing lessons and skill-check exams). This tracks three things:

1. **Login becomes GitHub-only.** Drop the display-name login/signup entirely. Standard OAuth redirect flow (not Device Flow) — 1-click "Continue with GitHub" UX is worth the fixed `GITHUB_CALLBACK_URL` per deploy.
2. **The points system gets a full revamp**, not just a polish — Java/OCP-themed levels, a dedicated Profile page with breakdown/history, a level badge in the header, and a "+XP" toast when points are earned. Inspired by platforms like Duolingo/freeCodeCamp.
3. **Java Concepts and Java Minute now award XP too**, via a "mark as read" action. Button copy: **"⚡ Got it!"** before, **"⚡ Got it +10 XP"** (permanently done, no un-marking) after.

Since this is a self-hosted, early-stage personal project, existing users/progress/XP data will be **wiped** rather than building account-linking logic — there's no email to match GitHub accounts against anyway.

Stack: NestJS 11 + Fastify + TypeORM/Postgres backend (`backend/src/`), Angular (standalone/signals) frontend (`app/src/app/`), single Docker container in prod (nginx :80 → Nest :3000 at `/api/`, Angular SSR :4000 elsewhere — same-origin, see `nginx.conf`/`Dockerfile`). Zero auth libraries exist today; sessions are a hand-rolled signed httpOnly cookie (`backend/src/auth/session.ts`).

---

## Implementation checklist

### Phase 1 — GitHub OAuth backend
- [ ] New migration `backend/src/migrations/1764000000004-ReplaceUserWithGithubAuth.ts`: `TRUNCATE "user_xp_entry", "user_lesson_progress", "user" RESTART IDENTITY CASCADE`, `UPDATE "exam_attempt" SET "userId" = NULL` (nullable, no FK), drop `normalizedName`/its unique constraint, add `githubId` (unique), `githubLogin`, `avatarUrl` as `NOT NULL` (safe post-truncate). No migration needed for `user_xp_entry.sourceType` — it's an unconstrained varchar already.
- [ ] `backend/src/auth/user.entity.ts` — replace `displayName`/`normalizedName` with `githubId` (unique), `githubLogin`, `displayName` (github `name` ?? `login`), `avatarUrl`.
- [ ] `backend/src/auth/github-oauth.service.ts` (new) — `buildAuthorizeUrl(state)`, `exchangeCode(code)` (POST `https://github.com/login/oauth/access_token`), `fetchProfile(token)` (GET `https://api.github.com/user`, needs `User-Agent` header). Plain `fetch`, no new dependency — codebase already hand-rolls session cookies with zero auth libs, and `@fastify/oauth2` fights the Nest-controller structure for a 3-call flow.
- [ ] `backend/src/auth/auth.service.ts` — replace `login`/`signup` with `upsertFromGithub(profile)` (find by `githubId`, update or create). Keep `findById`.
- [ ] `backend/src/auth/session.ts` — export a reusable cookie-signing helper (for real login + the test helper in Phase 6). Add short-lived signed state cookie `gh_oauth_state` (~600s, **`sameSite: 'lax'`** — `'strict'` would drop it on the redirect back from github.com).
- [ ] `backend/src/auth/auth.controller.ts` — replace `login`/`signup` with `GET /auth/github` (redirect to GitHub with state cookie set) and `GET /auth/github/callback` (verify state, exchange code, fetch profile, upsert user, `setSession`, redirect to `FRONTEND_URL ?? '/'`; on failure redirect to `/login?error=oauth_failed`). Keep `POST /auth/logout` and `GET /auth/me`.
- [ ] Add env vars `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `FRONTEND_URL` to `docker-compose.yml`'s `app.environment` (same pass-through style as `SESSION_SECRET`).

### Phase 2 — Get the test suite green again
- [ ] Add a `NODE_ENV !== 'production'`-gated test-only endpoint (e.g. `POST /auth/_test/login`) that creates a `User` row directly and mints the `uid` cookie via the exported signing helper.
- [ ] Rewrite `backend/spec/helpers.ts`'s `login(displayName)` to call that endpoint instead of `POST /auth/signup`, keeping the same `{id, cookie}` return shape.
- [ ] Rewrite `backend/spec/auth.spec.ts` — drop obsolete signup/login/case-insensitivity tests, add a `GET /auth/github` redirect + state-cookie test, keep `GET /auth/me` coverage.

### Phase 3 — Frontend auth
- [ ] `app/src/app/models/auth.model.ts` → `User { id, displayName, githubLogin, avatarUrl }`.
- [ ] `app/src/app/services/auth.service.ts` — replace `login()`/`signup()` with `bootstrap()` (`GET /api/auth/me`, client-only, sets/clears `currentUser` + localStorage cache), called once from `app/src/app/app.ts` on init.
- [ ] `app/src/app/pages/login/login-page.ts`/`.html` — gut the tabbed form entirely; single real anchor `<a href="/api/auth/github">Continue with GitHub</a>` (must be a real navigation, not XHR). Show `?error=oauth_failed` message via `ActivatedRoute`. Redirect to `/` immediately if already logged in.
- [ ] `app/src/app/components/header/header.ts`/`.html` — render `avatarUrl` as `<img>` instead of initials when available.

### Phase 4 — XP & Levels backend
- [ ] `backend/src/xp/user-xp.entity.ts` — widen `sourceType` to `'lesson' | 'skill-check' | 'concept-read' | 'episode-watched'`.
- [ ] `backend/src/xp/xp.service.ts` — extract private `awardOnce(userId, sourceType, sourceId, exp)` from `grantLessonXp`'s `orIgnore()` block; add `grantConceptReadXp`/`grantEpisodeWatchedXp` (10 XP each) on top of it; add `hasEntry(userId, sourceType, sourceId)`; add `getSummary(userId)` and `getHistory(userId, limit=50)`.
- [ ] `backend/src/xp/levels.ts` (new) — themed level table (backend-computed, server already owns XP logic):

  | # | Title | Min XP |
  |---|-------|--------|
  | 1 | Hello World | 0 |
  | 2 | Syntax Sprout | 100 |
  | 3 | Compiler Whisperer | 300 |
  | 4 | Loop Wrangler | 600 |
  | 5 | Exception Handler | 1000 |
  | 6 | Stream Sorcerer | 1500 |
  | 7 | Concurrency Tamer | 2200 |
  | 8 | Generics Jedi | 3000 |
  | 9 | JVM Whisperer | 4000 |
  | 10 | OCP Master | 5500 |

- [ ] `backend/src/xp/xp.controller.ts` — keep `GET /xp → {total}`; add `GET /xp/summary` (`{total, level, breakdown}`) and `GET /xp/history` (up to 50 entries, newest first).

### Phase 5 — Read-tracking endpoints (no new entity)
- [ ] `java-concepts.module.ts` / `java-minute.module.ts` — `imports: [XpModule]`.
- [ ] `java-concepts.controller.ts` — `GET /java-concepts/:slug` gains `@OptionalUserId()`, response includes `read: boolean` via `xp.hasEntry(userId, 'concept-read', slug)`. Add `PUT /java-concepts/:slug/read` (`@CurrentUserId()`, 404 on unknown slug, else `grantConceptReadXp` → `{read: true}`).
- [ ] Mirror in `java-minute.controller.ts` with `sourceType: 'episode-watched'`.
- [ ] Specs: `PUT .../read` for both — 404 unknown slug, 401 anonymous, idempotent XP grant (mirror the lesson-completion test in `xp.spec.ts`).

### Phase 6 — Frontend XP layer (toast + summary)
- [ ] `app/src/app/services/xp.service.ts` — load `GET /xp/summary` (`summary` signal; keep `xp = computed(() => summary()?.total ?? 0)` so existing call sites don't change); add `loadHistory()`. Track `hasLoadedOnce`; on later loads, diff `newTotal - oldTotal` and fire the toast service if positive (baseline load is silent).
- [ ] `app/src/app/services/xp-toast.service.ts` (new) + `app/src/app/components/xp-toast/` (new) — signal-based toast queue, auto-dismiss, mounted once in the root app template so it's visible on every route.
- [ ] `header.html` — wrap the XP badge in `routerLink="/profile"`, add a level chip (`Lv {{ summary()?.level?.number }}`, tooltip = level title).

### Phase 7 — Profile page
- [ ] `app/src/app/pages/profile/profile-page.ts`/`.html`/`.css` (new) + route `path: 'profile'` in `app.routes.ts`. Loads summary + history on init. Logged-out: inline "Log in with GitHub to track your progress" prompt (no redirect — matches the locked-button pattern elsewhere). Renders avatar+name, level title/number, progress bar to next level, XP breakdown by source, recent history.

### Phase 8 — "Got it!" buttons
- [ ] `JavaConceptView` / Java-Minute-episode component — add `read = input<boolean>(false)`, `marking = input<boolean>(false)`, `markRead = output<void>()`; render button in the header, following `course-page.html`'s `complete-btn` pattern (🔒 + disabled + tooltip when logged out, `[class.completed]`, label swap).
- [ ] Label: **"⚡ Got it!"** → **"⚡ Got it +10 XP"** (permanently disabled once read — no un-marking).
- [ ] `JavaConceptsDetailPage`/`JavaMinuteDetailPage` — `read = signal(false)` seeded from the detail response; on `(markRead)` call the new `markRead(slug)` service method, then `read.set(true)` + `xpService.loadSummary()` (triggers toast).
- [ ] Add `read: boolean` to `JavaConcept`/`JavaMinuteEpisode` frontend models.

---

## Manual setup (outside code — you must do this)
- [ ] Register a GitHub OAuth App (github.com → Settings → Developer settings → OAuth Apps). Homepage URL = public site URL; **Authorization callback URL** = exactly the value used for `GITHUB_CALLBACK_URL` (e.g. `https://your-domain/api/auth/github/callback`).
- [ ] Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` in the deploy environment (same mechanism as `SESSION_SECRET`); set `FRONTEND_URL=http://localhost:4200` for local dev only.

---

## Verification
- [ ] `cd backend && pnpm spec` — full vitest suite green.
- [ ] Manual end-to-end: `docker compose up`, register a GitHub OAuth App pointed at `http://localhost/api/auth/github/callback`, log in via "Continue with GitHub", confirm header shows avatar + level + XP.
- [ ] Complete a lesson and a skill-check — confirm XP toasts fire and the Profile page's breakdown/history update.
- [ ] Open a Java Concept and a Java Minute episode, click "⚡ Got it!" — confirm it flips to "⚡ Got it +10 XP", stays that way on reload, header XP/level update.
- [ ] Confirm logged-out state still renders Concepts/Minute pages normally with the button locked (🔒) rather than erroring.
