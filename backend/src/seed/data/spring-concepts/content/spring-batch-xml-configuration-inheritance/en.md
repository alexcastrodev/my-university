---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

A batch application with several similar jobs or steps — an "import products"
step and an "import customers" step that share the same commit interval,
skip policy, and listeners, say — ends up duplicating the same XML fragment
across every one of them. Spring Batch's XML vocabulary reuses a mechanism
plain Spring XML has offered since version 2.0 — `abstract`/`parent` bean
inheritance — so a "parent" job or step definition can hold the shared
defaults once, with each "child" definition inheriting and selectively
overriding them.

## Use Cases

- Defining default step parameters (commit interval, restart behavior, skip
  policy) once for a family of similar batch steps, instead of repeating the
  same `<tasklet>`/`<chunk>` attributes on every step.
- Changing one shared default (a commit interval, a skip limit) in exactly
  one place and having every step that inherits it pick up the change
  automatically.
- Combining a job-wide listener that every job should run with a
  job-specific listener, without either list silently replacing the other.

## Deep Dive

### Where this comes from: plain Spring bean inheritance

Spring Batch doesn't invent its own inheritance mechanism — it reuses the
`abstract`/`parent` attributes plain Spring XML has supported on the `<bean>`
element since Spring 2.0, built specifically to modularize configuration and
avoid duplication:

```xml
<bean id="parentBean" abstract="true">
  <property name="propertyOne" value="(...)"/>
</bean>
<bean id="childBean" parent="parentBean">
  <property name="propertyOne" value="(...)"/>
  <property name="propertyTwo" value="(...)"/>
</bean>
```

A bean marked `abstract="true"` is a template only — Spring never instantiates
it directly. `parent="parentBean"` links a concrete bean to that template: the
child inherits every property the parent defines and can override any of
them. Spring Batch's `job`/`step` elements accept the exact same two
attributes, described in the book's table 3.13:

| Attribute | Description |
|---|---|
| `abstract` | When `true`, the job or step element is a template only — never instantiated, present purely to modularize configuration for other elements. |
| `parent` | The parent element a given job or step inherits from; the child has all of the parent's properties and can override them. |

### Step inheritance in practice

A `parentStep` holds the shared tasklet/chunk defaults; `productStep`
inherits them via `parent="parentStep"`, keeping what it doesn't override and
supplying the reader/writer/processor and commit interval that are specific
to it:

```xml
<step id="parentStep">
  <tasklet allow-start-if-complete="true">
    <chunk commit-interval="100"/>
  </tasklet>
</step>

<step id="productStep" parent="parentStep">
  <tasklet start-limit="5">
    <chunk reader="productItemReader"
           writer="productItemWriter"
           processor="productItemProcessor"
           commit-interval="15"/>
  </tasklet>
</step>
```

`productStep` ends up with the same element hierarchy as `parentStep` (a
`tasklet` wrapping a `chunk`), plus its own reader/writer/processor and a
`commit-interval` of `15` overriding the parent's `100`. Where the parent
defines an attribute the child doesn't repeat, the child simply inherits it
unchanged; where both define the same attribute, the child's value wins.

### Merging lists instead of replacing them: the `merge` attribute

By default, a child's list-valued element (like a job's `<listeners>`)
*replaces* the parent's list rather than combining with it. Setting
`merge="true"` on the child's list element switches to additive behavior:

```xml
<job id="parentJob" abstract="true">
  <listeners>
    <listener ref="globalListener"/>
  <listeners>
</job>

<job id="importProductsJob" parent="parentJob">
  (...)
  <listeners merge="true">
    <listener ref="specificListener"/>
  <listeners>
</job>
```

With `merge="true"`, `importProductsJob` ends up with *both* listeners
registered — `globalListener` from the parent and `specificListener` of its
own — instead of `specificListener` silently replacing `globalListener`.
Without the `merge` flag, the child's list would completely override the
parent's.

## Trade-offs

- **Inheritance saves duplication, but makes a step's effective
  configuration harder to see in one place.** Reading `productStep` in
  isolation doesn't show `allow-start-if-complete="true"` — that's only
  visible by also reading `parentStep`. This is the same readability trade
  every inheritance mechanism makes: less repetition, more indirection to
  trace through when debugging.
- **List-valued elements default to override, not merge — `merge="true"` is
  opt-in, not the default, and easy to forget.** A child job's `<listeners>`
  block silently replacing rather than extending the parent's is a common
  surprise the first time someone relies on inheritance for listeners
  specifically, since most other attributes behave as expected (child
  overrides only what it explicitly sets).
- **`abstract="true"` templates aren't instantiated, so a typo or missing
  required attribute on an abstract job/step won't surface until a concrete
  child actually tries to use it** — the abstract definition itself is never
  validated as a runnable job or step on its own.
- **Book vs. today: this entire mechanism is specific to the XML batch
  namespace, which has no direct Java-configuration equivalent — not
  because it was replaced by something else, but because Java configuration
  solves the same "avoid duplicating shared step/job settings" problem with
  plain language features instead of a dedicated inheritance keyword.**
  Confirmed via the current Spring Batch reference: the `abstract`/`parent`
  attributes and the `Inheriting from a Parent Step` documentation page
  describe XML configuration only, with no Java-config counterpart
  documented. In Java configuration, the same reuse is typically achieved by
  extracting shared step/job settings into an ordinary method or constant
  that multiple `StepBuilder`/`JobBuilder` chains call into:
  ```java
  private StepBuilder commonStep(String name, JobRepository jobRepository,
          PlatformTransactionManager tx) {
      return new StepBuilder(name, jobRepository)
          .allowStartIfComplete(true);
      // shared defaults set here; each call site adds its own
      // reader/writer/processor/chunk size on top
  }

  @Bean
  public Step productStep(JobRepository jobRepository,
          PlatformTransactionManager tx) {
      return commonStep("productStep", jobRepository, tx)
          .<Product, Product>chunk(15, tx)
          .reader(productItemReader())
          .writer(productItemWriter())
          .processor(productItemProcessor())
          .build();
  }
  ```
  This is composition via plain Java, not a framework-level inheritance
  feature — there's no `merge="true"`-equivalent switch for combining two
  listener lists; that behavior would need to be written out explicitly
  (e.g., concatenating two lists before passing them to `.listener(...)`
  calls) rather than declared. The XML batch namespace itself — and this
  inheritance mechanism along with it — has been deprecated since Spring
  Batch 6.0, with removal planned for 7.0, the same migration already noted
  for the job/step/chunk vocabulary elsewhere in this workflow.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", section 3.4.4, "Configuration inheritance", p. 83-86 — doc
- [Spring Batch Reference — Inheriting from a Parent Step](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/inheriting-from-parent.html) — doc
- [Spring Batch Reference — Configuring a Step (StepBuilder)](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/configuring.html) — doc
- [Spring Batch 6.0 Migration Guide — XML namespace deprecation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
