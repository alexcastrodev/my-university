# The Kurz: security, privacy and cost (#317, #322)

What the Kurz (the assistant of the posts) protects, how, and where each claim is tested. The code is in
`backend/src/kurz` (the assistant), `backend/src/ai` (credits, price, platform budget, the student's limit) and
`backend/src/admin` (who may grant what). This page is the cross-cutting view and the operating rules.

The main guardrail is to limit what the model **can do**, not to ask it in the prompt to behave. The model gets
text and answers with a JSON that the server checks. The worst case of an attack is a bad answer that is
thrown away, not a leak.

## What the model gets, and what it can do

| Thing | Rule | Where it is enforced |
| --- | --- | --- |
| Tools | None. No function calling, Google Search, URL context, code execution or File Search. Text in, JSON out. | `GeminiKurzModel.ask` sends no `tools`; `spec/kurz-api.spec.ts` ("sends one call with no tools...") fails if one is added. |
| What it reads | The post the student is on (loaded by the server from the topic they named) and the summaries of the posts it links as related. Never a private paper, a PDF, a note, an annotation, a discussion, an id of another user, a credential or an env var. | `buildSources`, `ConceptLookupService.resolveRelated`; a test checks the request carries no secret. |
| What the student sends | A question (500 characters), a selection (2000), the topic, and where on the page they asked from. All of it is **data**, in delimited blocks, with `<` and `>` replaced so a student cannot close a block and open one of their own. | `buildInput`, `escapeData`; `kurz-answer.spec.ts` ("keeps a student from closing a block..."). |
| The selection | Counts as a passage of the post only if the post says all of it (letters and digits compared, section titles included). Otherwise it is part of the question and never a source, so it cannot be cited back or published as if the post said it. The `anchorKey` and `blockIndex` are labels the client computes, used only to bring the conversation back to its paragraph. | `selectionInPost`; `kurz-api.spec.ts` ("treats a selection the post does not contain as part of the question"). |
| What it answers | One JSON with a schema. `source` can only be one of this question's sources (an `enum`). Sizes (`maxLength`) are not enforced by the provider, so the server checks them. | `responseSchema`, `validateAnswer`. |
| What the student sees | Only what `validateAnswer` accepts: each citation names an existing source and block and quotes it literally (letters and digits compared); a claim or an example without a valid citation is dropped; what is left is rebuilt from our own data (the numbers `[1]`, `[2]`, the title and the route of each source). If nothing survives, the student reads the fixed refusal. The model's own refusal text is never shown. | `kurz-answer.spec.ts` (among the cases: forged quotes, the wrong block, a missing source, quotes too short). |
| Links and images | Never. The server strips them from the model's text and follow-ups; the page links only to routes of our own table. The UI part of the Kurz renders the answer with a Markdown variant that shows no link and no image (it comes with the screens). | `stripLinks`; `kurz-api.spec.ts` ("never shows a link or an image the model wrote"). |
| Conversation memory | The last two answered exchanges of the same conversation are given back as context, as data. Nothing from other conversations or other students. | `KurzService.history`; `kurz-api.spec.ts` ("continues a conversation with what came before"). |

## Threat model

| Threat | What we do | Residual risk | Tested in |
| --- | --- | --- | --- |
| **Prompt injection** in the question, the selection or the history | Everything but the fixed prompt is data, in delimited blocks the model is told are never instructions. No tool, no link, no other user's data in the context, so a model that obeys still has nothing to leak and no way to act. The validator throws away an answer that cites what the post does not say. | The model may give a poor answer to an attack. It is shown only if it passes the citation checks. | `kurz-answer.spec.ts`; the eval (13 cases, 5 of them attacks: 10/10 showed nothing on `gemini-3.5-flash-lite`, prompt v1) |
| **Indirect injection** (EchoLeak, CVE-2025-32711) | The context holds no third-party content: the posts are ours, the discussions are not read, and the answer renders no image or link written by the model. | A post edited to say something hostile would be a content review failure. | `stripLinks`, `kurz-answer.spec.ts` |
| **A fabricated "passage"** (making the Kurz cite or publish something the post does not say) | The selection and every citation are checked against the post the server loaded. Sharing builds the text from what was stored, never from the client. | None known. | `kurz-api.spec.ts` (selection, `FORGED` model answer, share) |
| **A hallucinated answer** | "Answer only from the sources" in the prompt, and above all the validator: no verified citation, no answer. The student can report a wrong answer (see Reports). | The model can cite a real passage and still misread it. The eval and the reports are how that is measured. | the eval, the reports |
| **IDOR** (reading, answering in, erasing, reporting or publishing someone else's conversation) | Every query starts from the session user. Another student's id is a 404, the same as one that does not exist. | None known. | `kurz-api.spec.ts` ("answers 404 to a conversation that is not theirs", "lets only the owner ...") |
| **CSRF that spends** | Nothing that spends is a GET. The session cookie is `SameSite=Lax`, which a browser sends on a navigation from another site, so a GET that spends would let any link burn a student's credit. A POST is not sent. | None while it stays POST. | `kurz-api.spec.ts` ("has no GET that spends") |
| **Spending without a right to** | The route needs a session and `ai.use`, checked by the database each request (never read from the cookie). Then the terms, the platform budget (month, then day), the student's own limit, the balance, one question at a time. | The platform budget is checked before the call, so questions already in flight can pass it a little: at most one per student (no Redis, two replicas). | `spec/ai-credits.spec.ts`, `kurz-api.spec.ts` ("the order in which a student is stopped") |
| **Granting oneself credit or power** | A grant never goes to the granter and is capped (`AI_CREDIT_MAX_GRANT`); a role can only be given with permissions the giver holds; the last admin cannot be removed (an advisory lock, so two admins cannot demote each other at once); every change is in `admin_audit_event`. | A compromised admin account can do what an admin may. Sessions are revocable (`logout-all`, a role change raises the epoch). | `spec/admin-api.spec.ts`, `spec/roles-permissions.spec.ts` |
| **A broken bill** | The cost is computed from the tokens the API reported, as integers, with a price table by date. A model with no price in force is refused, never billed at zero. The raw `usage` is kept so a wrong formula can be recomputed. A question that fails is closed (never left pending) and billed only if Google charged. | The context cache is not confirmed to reduce the bill the way the formula assumes (`cached` is capped at `input`). Reconcile the monthly sum of `costNanoUsd` against the AI Studio Spend page (a gap over about 5% means a wrong price or a misread field). | `spec/ai-cost.spec.ts`, `spec/ai-credits.spec.ts`, `kurz-api.spec.ts` |
| **A runaway bill** | Platform budget in US$ per day and per month (`KURZ_PLATFORM_BUDGET_DAILY_USD`, `KURZ_PLATFORM_BUDGET_MONTHLY_USD`, default 2 and 20): reached, nobody asks, even with credit, and no call is made. A student's own limit over any 24 hours. A fixed `max_output_tokens` (which includes the thinking). A per-minute throttle per student, nginx `limit_req`, and `KURZ_ENABLED` to stop it all at once. On Google's side: the project spend cap, the tier's monthly cap and billing alerts. | The Google spend cap is experimental and lags by about 10 minutes. | `kurz-api.spec.ts`, the CI check of nginx |
| **Student data at Google** | `store: false` on every call (the default keeps it 55 days). Only the paid plan, in a project made for the Kurz alone (the free plan lets Google use the content to improve its products and have people read it, and its terms forbid personal data). The student confirms the privacy notice and that they are 18 or older before the first question, and the version of that text is recorded (`aiTermsAcceptedAt`, `aiTermsVersion`). | What Google keeps for abuse detection on the paid plan, as its terms say. | `kurz-api.spec.ts` (`store: false`, the terms) |
| **The API key** | Only in the server's environment (`GOOGLE_GEMINI_API_KEY`), never in the repository, never in an image, never in the browser (the CSP `connect-src 'self'` stops a direct call). A restricted key of a dedicated project: Google's newer keys are made restricted, and a plain key in a project where the API is enabled has been seen to gain Gemini access (Truffle Security, Feb 2026). If it leaks, follow Google's checklist and rotate it. | A key in a developer's `.env` is on that machine. | the repository holds only the variable's name |
| **What the student wrote, in logs and error reports** | The server logs counts and ids only (outcome, tokens, credits). `beforeSend` removes the body, the cookies and the breadcrumbs of any event from `/api/kurz`, so an error keeps its stack and loses the words. A provider error carries no text of the conversation. | A text in a database error is not a thing this code puts there (queries use parameters). | `kurz-answer.spec.ts` ("what Sentry is sent"), `kurz-api.spec.ts` ("never carries text ... in an error") |
| **Abuse of the share** | "Share in the discussion" posts only the question and the answer of that one exchange, built on the server from what is stored, labelled as the Kurz's, with the `@` broken so an answer about annotations cannot notify someone. It needs `ai.use` and the Kurz on. | Once published it is an ordinary comment: erasing the conversations does not erase it. | `kurz-api.spec.ts` ("publishing in the discussion") |
| **Fake model in production** | `KURZ_FAKE_MODEL` stands in for the provider in the specs and the e2e suite. With `NODE_ENV=production` the server refuses to start with it set, instead of answering students with canned text. | None. | `kurz-answer.spec.ts` ("refuses the stand-in model in production") |

## What is kept, for how long, and who sees it

| Data | Who sees it | How long | Erasing |
| --- | --- | --- | --- |
| A conversation and its exchanges (question, the answer as shown, whether it was useful) | The student, and nobody else: not an admin, not another student. | 90 days after its last message (`KURZ_RETENTION_DAYS`), by a purge that runs at boot and every 6 hours (idempotent, so both replicas can run it). | The student erases one (`DELETE /api/kurz/conversations/:id`) or all (`DELETE /api/kurz/conversations`, from their profile). Once accounts can be erased, the foreign keys do the same. It works with the Kurz off and without `ai.use`. |
| The usage of each question (`ai_usage`: tokens, cost, credits, status) and the credit ledger | The student (their balance and history) and the admins. It holds no text. | Kept. | Erasing a conversation leaves the row and sets its `conversationId` to null. |
| A report of a wrong answer | Whoever holds `ai_reports.review`, who sees the exchange and never who sent it. | Until reviewed or dismissed, and kept after. | It is a copy that stands alone (question, answer, sources cited, the version of the prompt and of the model, the post and its `version`), with no foreign key to the conversation. Erasing the conversations or the account sets `userId` to null and keeps the copy. A test covers it. The button says so: "the team sees this exchange, and it is kept without your name". |
| What was published in the discussion | Everyone who can read the discussion. | Like any comment. | Erasing the conversations does not erase it. |

## Operating rules

- **Turning it on.** Make a Google Cloud project for the Kurz alone, with Cloud Billing on (the paid plan), a restricted key,
  the spend cap and billing alerts. Put the key in the host `.env` as `GOOGLE_GEMINI_API_KEY`, and `KURZ_ENABLED=1`.
  The model needs a row in `ai_model_price` in force: check the prices against the provider's table first.
  Credit only reaches a student by an admin's grant, and a student confirms the notice before their first question.
- **Turning it off.** Remove `KURZ_ENABLED` (or set it to anything but `1`) and redeploy. Asking and publishing stop at
  once; students can still read, erase and report their own conversations.
- **Changing the prompt or the model.** Run `pnpm kurz:eval` before and after, with `EVAL_RUNS` of 3 or more (newer Gemini
  models ignore the temperature, so one run proves nothing), and compare. Bump `KURZ_PROMPT_VERSION` on every edit of
  the prompt: a report keeps it. The 3.8 Flash does not accept `thinking_level: minimal` (set `KURZ_THINKING_LEVEL=low`
  with it).
- **Changing the text of the privacy notice.** Bump `KURZ_TERMS_VERSION`: every student confirms again.
- **The monthly check.** Sum `costNanoUsd` of the month from `ai_usage` and compare with the AI Studio Spend page.
- **A leaked key.** Rotate it at once in the Google console, change it in the host `.env`, redeploy.
- **Dependencies.** `@google/genai` is pinned to an exact version. The weekly `pnpm audit`, dependency review and Trivy
  apply to it as to the rest; the deadlines of `docs/papers-security.md` (critical in 48 hours, high in 7 days) too.
- **Never run the eval on the free plan**, and never put a real student's question in it.
