---
version: 1.0
updatedAt: 2026-05-28
---
# Overview — Java 22 to 25 Roadmap for OCP 21 Holders

> Bridge module for developers who already passed **1Z0-830 (OCP Java SE 21)** and are upgrading to **1Z0-831 (OCP Java SE 25)**. We assume Java 21 fluency — no re-explaining records, sealed types, pattern matching basics, or virtual threads. The focus is strictly what changed in Java 22, 23, 24 and 25.

---

## Why This Module Exists

The OCP 25 exam reuses most of the 21 objective map but layers in everything that finalized between Java 22 and Java 25. Four releases happened in that window (22, 23, 24, 25), and several features that were preview in 21 finally became permanent. This module is the delta — ten short lessons that catch you up without making you re-read the rest of the course.

If a topic is unchanged since 21 (try-with-resources, sealed classes, the `switch` pattern matching grammar finalized in 21, virtual threads as a permanent feature, sequenced collections), it lives in its original chapter and is **not** repeated here.

---

## Release Cadence Recap

| Release | GA | LTS? | Notes |
|---------|----|------|-------|
| Java 21 | Sep 2023 | Yes | Previous LTS, 1Z0-830 baseline |
| Java 22 | Mar 2024 | No | Foreign Memory API finalized; unnamed variables finalized |
| Java 23 | Sep 2024 | No | ZGC generational default; module imports preview |
| Java 24 | Mar 2025 | No | Virtual thread pinning fix; gatherers finalized |
| Java 25 | Sep 2025 | **Yes** | New LTS — exam target |

Six-month cadence means features promote through preview rounds. For 1Z0-831 the rule is simple: **only features that finalized by Java 25 are testable as language constructs**. Preview/incubator features are testable only at the "you must recognise it exists and how to enable it" level — covered in [[0-8-preview-incubator-features]].

---

## JEP Inventory (Java 22 to 25)

The table below is the spine of this module. "Exam relevance" is either **yes** (you must know syntax, semantics, and edge cases) or **context** (recognise the name, know it exists, no deep coding required).

| JEP | Title | Finalized In | Relevance | Spec | Module Lesson |
|-----|-------|--------------|-----------|------|---------------|
| 423 | Region Pinning for G1 | 22 | context | [openjdk.org/jeps/423](https://openjdk.org/jeps/423) | [[0-10-runtime-performance-changes]] |
| 454 | Foreign Function & Memory API | 22 | context | [openjdk.org/jeps/454](https://openjdk.org/jeps/454) | [[0-9-api-changes-21-to-25]] |
| 456 | Unnamed Variables and Patterns | 22 | **yes** | [openjdk.org/jeps/456](https://openjdk.org/jeps/456) | [[0-7-unnamed-variables-patterns-changes]] |
| 457 | Class-File API (preview) | 22 (preview) | context | [openjdk.org/jeps/457](https://openjdk.org/jeps/457) | [[0-8-preview-incubator-features]] |
| 458 | Launch Multi-File Source-Code Programs | 22 | **yes** | [openjdk.org/jeps/458](https://openjdk.org/jeps/458) | [[0-5-compact-source-files-instance-main-changes]] |
| 461 | Stream Gatherers (preview) | 22 (preview) | superseded by 485 | [openjdk.org/jeps/461](https://openjdk.org/jeps/461) | [[0-2-stream-gatherers-changes]] |
| 467 | Markdown Documentation Comments | 23 | context | [openjdk.org/jeps/467](https://openjdk.org/jeps/467) | [[0-9-api-changes-21-to-25]] |
| 471 | Deprecate Memory-Access in `sun.misc.Unsafe` | 23 | context | [openjdk.org/jeps/471](https://openjdk.org/jeps/471) | [[0-9-api-changes-21-to-25]] |
| 474 | ZGC: Generational Mode by Default | 23 | context | [openjdk.org/jeps/474](https://openjdk.org/jeps/474) | [[0-10-runtime-performance-changes]] |
| 476 | Module Import Declarations (preview) | 23 (preview) | superseded by 511 | [openjdk.org/jeps/476](https://openjdk.org/jeps/476) | [[0-4-module-import-declarations-changes]] |
| 477 | Implicitly Declared Classes & Instance `main` (preview) | 23 (preview) | superseded by 512 | [openjdk.org/jeps/477](https://openjdk.org/jeps/477) | [[0-5-compact-source-files-instance-main-changes]] |
| 482 | Flexible Constructor Bodies (preview) | 23 (preview) | superseded by 513 | [openjdk.org/jeps/482](https://openjdk.org/jeps/482) | [[0-6-flexible-constructor-bodies-changes]] |
| 485 | Stream Gatherers | 25 (finalized; introduced JEP 461 in 22, second preview JEP 473 in 23, third preview 24) | **yes** | [openjdk.org/jeps/485](https://openjdk.org/jeps/485) | [[0-2-stream-gatherers-changes]] |
| 491 | Synchronize Virtual Threads without Pinning | 24 | context | [openjdk.org/jeps/491](https://openjdk.org/jeps/491) | [[0-10-runtime-performance-changes]] |
| 506 | Scoped Values | 25 | **yes** | [openjdk.org/jeps/506](https://openjdk.org/jeps/506) | [[0-3-scoped-values-changes]] |
| 511 | Module Import Declarations | 25 | **yes** | [openjdk.org/jeps/511](https://openjdk.org/jeps/511) | [[0-4-module-import-declarations-changes]] |
| 512 | Compact Source Files and Instance Main Methods | 25 | **yes** | [openjdk.org/jeps/512](https://openjdk.org/jeps/512) | [[0-5-compact-source-files-instance-main-changes]] |
| 513 | Flexible Constructor Bodies | 25 | **yes** | [openjdk.org/jeps/513](https://openjdk.org/jeps/513) | [[0-6-flexible-constructor-bodies-changes]] |
| 519 | Compact Object Headers | 25 | context | [openjdk.org/jeps/519](https://openjdk.org/jeps/519) | [[0-10-runtime-performance-changes]] |
| 488 | Primitive Types in Patterns, `instanceof`, `switch` (preview) | preview in 24/25 | context | [openjdk.org/jeps/488](https://openjdk.org/jeps/488) | [[0-8-preview-incubator-features]] |
| 505 | Structured Concurrency (preview) | preview in 25 | context | [openjdk.org/jeps/505](https://openjdk.org/jeps/505) | [[0-8-preview-incubator-features]] |

> **How to read this table:** every "yes" row is a guaranteed exam topic. Every "context" row may show up as a one-line distractor in a multiple-choice question (e.g. "which of these is a finalized feature in Java 25?") but you will not be asked to write code against it.

---

## Big-Picture Themes

Four narrative threads run through the 22 to 25 delta:

1. **Easier on-ramps** — implicit classes, instance `main`, compact source files, module imports. Java keeps the door wider open for beginners while staying a serious enterprise language.
2. **Safer concurrency** — scoped values finalize, virtual thread pinning is fixed, structured concurrency previews mature.
3. **Sharper streams** — gatherers finalize, plugging the gap between `map`/`filter` and full `Collector`.
4. **Quieter runtime wins** — compact object headers, generational ZGC by default, G1 region pinning. You will not be asked to tune them, but you should recognise them.

---

## Suggested Study Path

Work the lessons in numerical order. Each is self-contained, but the order mirrors how features build on prior knowledge:

| Step | Lesson | Why now |
|------|--------|---------|
| 1 | [[0-1-overview-21-to-25-roadmap]] | You are here |
| 2 | [[0-2-stream-gatherers-changes]] | Touches code you already write daily |
| 3 | [[0-3-scoped-values-changes]] | Replaces `ThreadLocal` patterns in modern code |
| 4 | [[0-4-module-import-declarations-changes]] | New import grammar; affects every source file |
| 5 | [[0-5-compact-source-files-instance-main-changes]] | Replaces the old "implicit class" preview |
| 6 | [[0-6-flexible-constructor-bodies-changes]] | Statements **before** `super(...)` are now legal |
| 7 | [[0-7-unnamed-variables-patterns-changes]] | The `_` placeholder, finalized |
| 8 | [[0-8-preview-incubator-features]] | What is still preview in 25 and how to enable it |
| 9 | [[0-9-api-changes-21-to-25]] | Markdown javadoc, `Unsafe` deprecations, FFM API |
| 10 | [[0-10-runtime-performance-changes]] | ZGC, G1, compact headers, VT pinning |

Budget roughly 30 to 45 minutes per lesson. Total module: one focused day.

---

## Where Each Finalized Feature Lives in the Full Course

The bridge lessons above summarise the **delta**. The full canonical treatment of every finalized feature already lives in the main course chapters — re-read them after the bridge if you want depth:

| Finalized feature | Main-course lesson |
|-------------------|--------------------|
| Stream gatherers (`Stream.gather`, `Gatherers`) | [[6-5-stream-gatherers]] |
| Scoped values (`ScopedValue.where(...).run(...)`) | [[8-4-scoped-values]] |
| Module import declarations (`import module M;`) | [[7-3-module-import-declarations]] |
| Compact source files & multi-file source programs | [[7-5-compact-source-files-and-multi-file-programs]] |
| Instance `main` methods | [[7-6-instance-main-methods]] |
| Flexible constructor bodies (prologue before `super`) | [[3-3-constructors-flexible-bodies-initializers]] |
| Unnamed variables and the `_` pattern | [[3-5-encapsulation-immutability-var-unnamed-variables]] |

If you find yourself fuzzy on the underlying Java 21 concept (sealed hierarchies for pattern switch, the module graph for module imports, the constructor chain for flexible bodies), pause the bridge lesson and re-read the linked main-course chapter first. The bridge assumes that baseline.

---

## What This Module Deliberately Skips

- Anything unchanged since Java 21.
- Tool-chain changes (`javac` flags, `jlink` tweaks) that do not affect language semantics.
- HotSpot internals beyond "this option flipped its default".
- Features still in incubator with no finalized counterpart (e.g. the Vector API).

If a topic is not in the table above, it is not on the 1Z0-831 delta. Spend your time on the eighteen rows that are.

---

## Key Takeaway

The 22 to 25 delta is **smaller than the 17 to 21 jump** but denser in finalized language features. Five language-level JEPs (485, 506, 511, 512, 513) plus one already-finalized-in-22 (456) and one already-finalized-in-22 launcher change (458) make up the bulk of what you must write code against on exam day. Everything else is recognise-and-move-on.
