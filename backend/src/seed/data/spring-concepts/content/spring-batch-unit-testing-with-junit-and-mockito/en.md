---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Testing is the process of establishing that the code does what it is supposed to do,
and it matters more for batch than for most software: a batch job runs headless, on a
schedule, processing data with no user watching. A web app that breaks gets a phone
call within minutes; a nightly import that silently writes wrong prices for a week gets
noticed by an accountant. There is no UI to notice a silent failure, so the only early
warning system is a test suite.

The book frames tests along two axes. **Black-box testing** exercises features from the
outside, based on requirements, with no knowledge of the implementation. **White-box
testing** works with internal knowledge of design and algorithms, and cares about code
coverage. Unit and integration tests are white box; functional, system, acceptance, and
performance tests are black box.

This concept covers the **unit** layer only: a single component, tested with plain JUnit
and Mockito, with **no Spring context anywhere** — no `@SpringJUnitConfig`, no
`@SpringBatchTest`, no `JobRepository`, no database. A unit test should address one point
of functionality and be fast, human-readable, fully automatic, and isolated from external
resources (database, file system, web service, message broker). The good news is that
Spring Batch artifacts are unit-testable by construction: `ItemReader`, `ItemProcessor`,
`ItemWriter`, `Tasklet`, `Validator`, `JobParametersValidator`, `JobExecutionDecider`, and
listeners are POJOs implementing narrow interfaces, a direct benefit of the POJO
programming model. Where a component genuinely needs a Spring Batch domain object it can't
easily build — a `StepExecution`, a `JobExecution` — `spring-batch-test` supplies
`MetaDataInstanceFactory`. Wiring a real context, hitting an in-memory database, and
launching whole jobs belongs to *spring-batch-integration-and-functional-testing*.

## Use Cases

- Testing a `Validator` or `ItemProcessor` as a plain object: `new`, feed it an item,
  assert the return value or the thrown `ValidationException` — no framework involved.
- Testing a `FieldSetMapper` without touching a file, either by hand-building a
  `DefaultFieldSet` or by mocking `FieldSet` and verifying exactly which typed reads
  happened.
- Testing an `ItemWriter` whose insert-or-update branch depends on a `JdbcTemplate`
  return value, by stubbing that return value rather than provisioning a database.
- Testing a listener that writes rejected items to a file, with the `FlatFileItemWriter`
  mocked away so the test never touches the file system.
- Testing a `JobExecutionDecider` or a `Tasklet` that requires a `StepExecution`,
  `JobExecution`, or `ChunkContext` — built as fixtures with `MetaDataInstanceFactory`
  instead of by launching a job.
- Driving code-coverage work: unit tests are white box, so you write them per branch
  (positive price / zero price / negative price) rather than per feature.

## Deep Dive

### The test taxonomy, and where the unit layer stops

| Type | What it tests | Strategy |
|---|---|---|
| Unit | A single component in isolation, with internals known | White box |
| Integration | Several modules together (context, database) | White box |
| Functional | Input accepted, expected output produced | Black box |
| System | The application as a whole | Black box |
| Acceptance | Customer-specified requirements | Black box |
| Performance | Throughput/latency requirements | Black box |

The practical dividing line for this concept: a unit test may not touch a database, a
file, a socket, or a Spring `ApplicationContext`. The moment it does, it is an
integration or functional test and belongs to
*spring-batch-integration-and-functional-testing*. Everything below stays on the near
side of that line, which is why every example runs in milliseconds.

### Plain JUnit: a `Validator` needs no framework at all

The book's case study filters products through a `CompositeItemProcessor` made of two
`ValidatingItemProcessor`s, each delegating to a custom `Validator`. `Validator` has one
method that either returns or throws:

```java
package org.springframework.batch.infrastructure.item.validator;

public interface Validator<T> {
    void validate(T value) throws ValidationException;
}
```

So the test is a constructor call, a fixture, and an assertion. In Jupiter, a bad case is
expressed with `assertThrows`, which returns the exception so you can assert on it too:

```java
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.batch.infrastructure.item.validator.ValidationException;

import static org.junit.jupiter.api.Assertions.assertThrows;

class PositivePriceValidatorTest {

  private PositivePriceValidator validator;
  private Product product;

  @BeforeEach
  void setUp() {                       // runs before every @Test — a fresh fixture each time
    validator = new PositivePriceValidator();
    product = new Product();
  }

  @Test
  void positivePriceIsValid() {
    product.setPrice(new BigDecimal("100.0"));
    validator.validate(product);       // no exception == pass
  }

  @Test
  void zeroPriceIsRejected() {
    product.setPrice(new BigDecimal("0.0"));
    assertThrows(ValidationException.class, () -> validator.validate(product));
  }

  @Test
  void negativePriceIsRejected() {
    product.setPrice(new BigDecimal("-800.0"));
    assertThrows(ValidationException.class, () -> validator.validate(product));
  }
}
```

Three test methods for one `if` is the white-box mindset: you enumerate branches, not
features. `@BeforeEach` / `@AfterEach` run per test method (fixture lifecycle);
`@BeforeAll` / `@AfterAll` run once per class, for expensive setup you deliberately share.

### Mockito: replace a collaborator, then interrogate it

Real components have dependencies, and a unit test wants to verify *this* object's
behaviour, not its collaborators'. A mock is a fake, generated at runtime, whose returns
you define and whose calls you can inspect afterwards — no hand-written stub classes.

The book's `ProductFieldSetMapper` turns a tokenized line into a `Product`:

```java
public class ProductFieldSetMapper implements FieldSetMapper<Product> {

  public static final String FIELD_ID = "ID";
  public static final String FIELD_NAME = "NAME";
  public static final String FIELD_DESCRIPTION = "DESCRIPTION";
  public static final String FIELD_PRICE = "PRICE";

  @Override
  public Product mapFieldSet(FieldSet fieldSet) throws BindException {
    Product product = new Product();
    product.setId(fieldSet.readString(FIELD_ID));
    product.setName(fieldSet.readString(FIELD_NAME));
    product.setDescription(fieldSet.readString(FIELD_DESCRIPTION));
    product.setPrice(fieldSet.readBigDecimal(FIELD_PRICE));
    return product;
  }
}
```

Two complementary tests. The state-based one builds a real `DefaultFieldSet` and asserts
on the produced object; the interaction-based one mocks `FieldSet` and asserts on *how*
the mapper read it:

```java
import org.junit.jupiter.api.Test;
import org.springframework.batch.infrastructure.item.file.transform.DefaultFieldSet;
import org.springframework.batch.infrastructure.item.file.transform.FieldSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

class ProductFieldSetMapperTest {

  private final ProductFieldSetMapper mapper = new ProductFieldSetMapper();

  @Test
  void mapsEveryColumnOntoTheProduct() throws Exception {
    FieldSet fieldSet = new DefaultFieldSet(
        new String[] { "id", "name", "desc", "100.25" },
        new String[] { FIELD_ID, FIELD_NAME, FIELD_DESCRIPTION, FIELD_PRICE });

    Product p = mapper.mapFieldSet(fieldSet);

    assertEquals("id", p.getId());
    assertEquals("name", p.getName());
    assertEquals("desc", p.getDescription());
    assertEquals(new BigDecimal("100.25"), p.getPrice());
  }

  @Test
  void readsEachFieldExactlyOnceAndNothingElse() throws Exception {
    FieldSet fieldSet = mock(FieldSet.class);

    mapper.mapFieldSet(fieldSet);

    verify(fieldSet, times(1)).readString(FIELD_ID);
    verify(fieldSet, times(1)).readString(FIELD_NAME);
    verify(fieldSet, times(1)).readString(FIELD_DESCRIPTION);
    verify(fieldSet, times(1)).readBigDecimal(FIELD_PRICE);
    verifyNoMoreInteractions(fieldSet);   // any extra read fails the test
  }
}
```

`verifyNoMoreInteractions` is the sharp edge here: add a stray `readString("SKU")` to the
mapper and the second test fails, even though the first still passes. That is the
white-box payoff — and the maintenance cost, since a legitimate new field also breaks it.

### Stubbing return values to drive a branch

The book's `ProductItemWriter` decides insert-vs-update by looking at the row count an
`UPDATE` returned. That branch is untestable without controlling that number — and
controlling it with a real database means provisioning one. Stubbing controls it for free:

```java
@ExtendWith(MockitoExtension.class)
class ProductItemWriterTest {

  @Mock private JdbcTemplate jdbcTemplate;   // the boundary we refuse to cross
  private ProductItemWriter writer;
  private Chunk<Product> items;

  @BeforeEach
  void setUp() {
    writer = new ProductItemWriter();
    writer.setJdbcTemplate(jdbcTemplate);
    Product p = new Product();
    p.setId("211");
    p.setName("BlackBerry");
    items = Chunk.of(p);
  }

  @Test
  void existingProductIsUpdatedOnly() throws Exception {
    when(jdbcTemplate.update(eq(UPDATE_SQL), any(SqlParameterSource.class)))
        .thenReturn(1);                      // pretend the row existed

    writer.write(items);

    verify(jdbcTemplate, times(1)).update(eq(UPDATE_SQL), any(SqlParameterSource.class));
    verify(jdbcTemplate, never()).update(eq(INSERT_SQL), any(SqlParameterSource.class));
    verifyNoMoreInteractions(jdbcTemplate);
  }

  @Test
  void missingProductFallsBackToInsert() throws Exception {
    when(jdbcTemplate.update(eq(UPDATE_SQL), any(SqlParameterSource.class)))
        .thenReturn(0);                      // pretend nothing was updated

    writer.write(items);

    verify(jdbcTemplate, times(1)).update(eq(UPDATE_SQL), any(SqlParameterSource.class));
    verify(jdbcTemplate, times(1)).update(eq(INSERT_SQL), any(SqlParameterSource.class));
    verifyNoMoreInteractions(jdbcTemplate);
  }
}
```

Two rules worth internalising. First, argument matchers are all-or-nothing: once one
argument uses a matcher, every argument must, which is why the literal SQL string is
wrapped in `eq(...)` next to `any(SqlParameterSource.class)`. Second, `never()` is
`times(0)` spelled to read like a sentence — asserting the *absence* of an INSERT is the
whole point of the first test. Note also that the writer receives a `Chunk`, not a single
item (see *spring-batch-chunk-processing*): `Chunk` is a plain value class, so build it
with `Chunk.of(...)` rather than mocking it.

### Spies: a real object you can still interrogate

A mock replaces an object entirely. A **spy** wraps a real instance, delegating calls to
it while recording them — useful when the object's real behaviour is what you want but you
also care how it was used. The book tests a `JobParametersValidator` this way, spying on
real `JobParameters` to pin down exactly how the validator inspects them, and mocking the
`ResourceLoader` so the test never touches the file system:

```java
@Test
void acceptsCompleteJobParameters() {
  ResourceLoader resourceLoader = mock(ResourceLoader.class, Mockito.RETURNS_DEEP_STUBS);
  when(resourceLoader.getResource(PRODUCTS_PATH).exists()).thenReturn(true);

  ImportValidator validator = new ImportValidator();
  validator.setResourceLoader(resourceLoader);

  JobParameters params = new JobParametersBuilder()
      .addString(PARAM_INPUT_RESOURCE, PRODUCTS_PATH)
      .addString(PARAM_REPORT_RESOURCE, STATISTIC_PATH)
      .toJobParameters();
  JobParameters spy = Mockito.spy(params);      // real behaviour, recorded calls

  validator.validate(spy);

  verify(spy, times(2)).getParameters();
  verify(spy, times(1)).getString(PARAM_INPUT_RESOURCE);
  verifyNoMoreInteractions(spy);
}

@Test
void rejectsEmptyJobParameters() {
  // ... same validator, no parameters at all
  assertThrows(InvalidJobParametersException.class,
      () -> validator.validate(new JobParametersBuilder().toJobParameters()));
}
```

`RETURNS_DEEP_STUBS` makes `resourceLoader.getResource(...)` itself return a mock, so the
chained `.exists()` can be stubbed in one line. It is convenient and it is a documented
code smell — a mock returning a mock encodes the call chain of the implementation into the
test, so any refactoring of that chain breaks it. Spying has the same character: the book
uses it to assert `getParameters()` is called exactly twice, which is coupling to the
implementation rather than to the contract. Reach for spies mainly on legacy code you
can't restructure.

### Mocking a listener's collaborator

A listener is just an interface implementation, so the same technique applies. The book's
item listener writes filtered-out products to a reject file; the test mocks the writer so
no file is created, then asserts the writer was or wasn't called:

```java
public class ProductItemListener implements ItemProcessListener<Product, Product> {

  private ItemWriter<Product> excludeWriter;

  @Override
  public void afterProcess(Product item, Product result) {
    if (result == null) {                    // null == filtered out by the processor
      try {
        excludeWriter.write(Chunk.of(item));
      } catch (Exception e) {
        // ...
      }
    }
  }

  public void setExcludeWriter(ItemWriter<Product> excludeWriter) {
    this.excludeWriter = excludeWriter;
  }
}
```

```java
@ExtendWith(MockitoExtension.class)
class ProductItemListenerTest {

  @Mock private ItemWriter<Product> writer;
  private ProductItemListener listener;
  private Product product;

  @BeforeEach
  void setUp() {
    listener = new ProductItemListener();
    listener.setExcludeWriter(writer);
    product = new Product();
    product.setId("211");
  }

  @Test
  void filteredItemGoesToTheRejectWriter() throws Exception {
    listener.afterProcess(product, null);                  // processor returned null
    verify(writer, times(1)).write(Chunk.of(product));
  }

  @Test
  void keptItemIsNotWrittenToTheRejectWriter() throws Exception {
    listener.afterProcess(product, product);               // processor kept the item
    verify(writer, never()).write(any());
  }
}
```

The `result == null` convention is the filtering contract of `ItemProcessor` (see
*spring-batch-item-processing-and-transformation*); a mocked writer is what lets you
assert on it without a step, a chunk, or a job.

### `MetaDataInstanceFactory`: fixtures for Spring Batch's own domain objects

Some Spring Batch objects are awkward to build by hand because they nest: a
`StepExecution` needs a `JobExecution`, which needs a `JobInstance` and `JobParameters`.
Written out, the fixture dominates the test:

```java
StepExecution stepExecution = new StepExecution("NoProcessingStep",
    new JobExecution(new JobInstance(1L, "NoProcessingJob"), new JobParameters()));
```

`spring-batch-test` ships `MetaDataInstanceFactory` (package
`org.springframework.batch.test`) precisely for this. It is a plain static factory —
**no Spring context, no `JobRepository`, no database** — which is why it belongs in this
unit-test layer rather than the integration one:

```java
StepExecution stepExecution = MetaDataInstanceFactory.createStepExecution();
JobExecution jobExecution  = MetaDataInstanceFactory.createJobExecution();
```

It fills in documented defaults (`DEFAULT_JOB_NAME = "job"`, `DEFAULT_STEP_NAME = "step"`,
`DEFAULT_JOB_INSTANCE_ID = 12L`, `DEFAULT_JOB_EXECUTION_ID = 123L`,
`DEFAULT_STEP_EXECUTION_ID = 1234L`) and offers overloads when identity matters —
`createJobInstance(String jobName, Long instanceId)`,
`createJobExecution(String jobName, Long instanceId, Long executionId, JobParameters params)`,
`createJobExecutionWithStepExecutions(Long executionId, Collection<String> stepNames)`,
`createStepExecution(JobParameters params, ExecutionContext context)`. That last one is how
you pre-seed an `ExecutionContext`, which is what a component reading step state expects:

```java
StepExecution execution = MetaDataInstanceFactory.createStepExecution();
execution.getExecutionContext().putString("input.file", "products.txt");
execution.setReadCount(0);
```

This opens up any component whose API demands execution state. A
`JobExecutionDecider` drives the job flow off the write count, so testing it matters —
and now it costs three lines:

```java
class NextDeciderTest {

  private final NextDecider decider = new NextDecider();
  private JobExecution jobExecution;
  private StepExecution stepExecution;

  @BeforeEach
  void setUp() {
    jobExecution = MetaDataInstanceFactory.createJobExecution();
    stepExecution = MetaDataInstanceFactory.createStepExecution();
  }

  @Test
  void itemsWrittenMeansNext() {
    stepExecution.setWriteCount(5);
    FlowExecutionStatus status = decider.decide(jobExecution, stepExecution);
    assertEquals("NEXT", status.getName());
  }

  @Test
  void nothingWrittenMeansCompleted() {
    stepExecution.setWriteCount(0);
    assertEquals(FlowExecutionStatus.COMPLETED, decider.decide(jobExecution, stepExecution));
  }
}
```

The same trick tests a `StepExecutionListener`: hand `afterStep(stepExecution)` a factory
`StepExecution` with the counts you want and assert on the returned `ExitStatus`.

### Testing a `Tasklet` without a step

`Tasklet.execute` demands two framework objects — a `StepContribution` and a
`ChunkContext` — and both are constructible from a `StepExecution`, so no job is needed:

```java
class CleanTaskletTest {

  @Test
  void reportsFinishedAfterOnePass() throws Exception {
    StepExecution stepExecution = MetaDataInstanceFactory.createStepExecution();
    StepContribution contribution = new StepContribution(stepExecution);
    ChunkContext chunkContext = new ChunkContext(new StepContext(stepExecution));

    RepeatStatus status = new CleanTasklet().execute(contribution, chunkContext);

    assertEquals(RepeatStatus.FINISHED, status);
  }
}
```

`StepContribution` is also the assertion target for a tasklet that reports work:
`contribution.incrementWriteCount(n)` inside the tasklet becomes
`assertEquals(n, contribution.getWriteCount())` in the test. And because `execute` is
called repeatedly until it returns `FINISHED`, a tasklet that returns `CONTINUABLE` should
be tested by calling `execute` in a loop and asserting it terminates — a bug class that
only a unit test will catch cheaply.

### Book vs. today: JUnit 4 → Jupiter, and the Spring Batch 6 package reorg

The mechanics of unit testing survived 14 years almost untouched; the *spellings* did not.

**JUnit.** The book is JUnit 4 (`org.junit`). Spring Batch 6.0 dropped JUnit 4 support
outright, and current JUnit is 6.x (`org.junit.jupiter.api`, Java 17 baseline). The
before/after:

```java
// Book (JUnit 4)                            // Today (JUnit Jupiter)
import org.junit.Test;                       import org.junit.jupiter.api.Test;
import org.junit.Before;                     import org.junit.jupiter.api.BeforeEach;
import static org.junit.Assert.*;            import static org.junit.jupiter.api.Assertions.*;

@Before  public void setUp() {}              @BeforeEach void setUp() {}
@After   public void tearDown() {}           @AfterEach  void tearDown() {}
@BeforeClass / @AfterClass                   @BeforeAll  / @AfterAll
@Ignore                                      @Disabled
@RunWith(MockitoJUnitRunner.class)           @ExtendWith(MockitoExtension.class)

@Test(expected = ValidationException.class)  assertThrows(ValidationException.class,
public void bad() { validator.validate(p); }     () -> validator.validate(p));
```

Test classes and methods no longer need to be `public` in Jupiter, and the book's
"prefix every method with `test`" convention is a JUnit 3 holdover — name the method after
the behaviour instead. `assertThrows` is strictly better than `expected`: it scopes the
expectation to one statement (`expected` passed if *any* line threw) and returns the
exception so you can assert on its message.

**Mockito.** Essentially unchanged, which is remarkable. `mock()`, `when(...).thenReturn(...)`,
`verify()`, `times()`, `never()`, `verifyNoMoreInteractions()`, `spy()`, `eq()`, `any()`, and
`RETURNS_DEEP_STUBS` are all still the core API in Mockito 5.x. Three deltas: Mockito 5
requires Java 11+ and switched the default mock maker to the inline one (so `final` classes
and methods mock without extra setup); `verifyZeroInteractions` was removed in Mockito 4 in
favour of `verifyNoInteractions`; and the recommended runner is now the Jupiter extension
from `mockito-junit-jupiter`, which brings **strict stubs** — an unused `when(...)` fails
the test with `UnnecessaryStubbingException`. That last one bites when migrating book-era
code that stubs generously in `setUp`: move the stub into the test that needs it, or opt
out per class with `@MockitoSettings(strictness = Strictness.LENIENT)`.

**Spring Batch packages.** `MetaDataInstanceFactory` stayed put in
`org.springframework.batch.test`, but almost everything it produces moved in the 6.0 reorg,
so a book-era test file needs an import sweep:

| Type | Book (≤ 5.x) | Spring Batch 6.0 |
|---|---|---|
| `JobExecution`, `JobInstance` | `org.springframework.batch.core` | `org.springframework.batch.core.job` |
| `StepExecution`, `StepContribution` | `org.springframework.batch.core` | `org.springframework.batch.core.step` |
| `JobParameters`, `JobParametersBuilder`, `JobParametersValidator` | `org.springframework.batch.core` | `org.springframework.batch.core.job.parameters` |
| `ItemProcessListener`, `StepExecutionListener`, `ItemListenerSupport` | `org.springframework.batch.core` | `org.springframework.batch.core.listener` |
| `ExecutionContext` | `org.springframework.batch.item` | `org.springframework.batch.infrastructure.item` |
| `Chunk`, `ItemWriter`, `ItemProcessor` | `org.springframework.batch.item` | `org.springframework.batch.infrastructure.item` |
| `FieldSet`, `DefaultFieldSet` | `org.springframework.batch.item.file.transform` | `org.springframework.batch.infrastructure.item.file.transform` |
| `FieldSetMapper` | `org.springframework.batch.item.file.mapping` | `org.springframework.batch.infrastructure.item.file.mapping` |
| `Validator`, `ValidationException` | `org.springframework.batch.item.validator` | `org.springframework.batch.infrastructure.item.validator` |
| `RepeatStatus` | `org.springframework.batch.repeat` | `org.springframework.batch.infrastructure.repeat` |

`ExitStatus` and `BatchStatus` remain in `org.springframework.batch.core`;
`ChunkContext`/`StepContext` remain in `org.springframework.batch.core.scope.context`;
`Tasklet` remains in `org.springframework.batch.core.step.tasklet`;
`JobExecutionDecider`/`FlowExecutionStatus` remain in
`org.springframework.batch.core.job.flow`. Two signature changes also touch these tests
directly: `ItemWriter.write` now takes `Chunk<? extends T>` instead of
`List<? extends T>`, so the book's `Arrays.asList(item)` becomes `Chunk.of(item)`; and
`JobParametersInvalidException` was renamed `InvalidJobParametersException`. The book's
`SimpleJdbcTemplate` is long gone — use `JdbcTemplate` or
`NamedParameterJdbcTemplate` — and `ItemListenerSupport` still exists but is unnecessary,
since the listener interfaces have `default` methods, so implement `ItemProcessListener`
directly and override only what you need. Confirmed against the Spring Batch 6.0.4 API
Javadoc for `MetaDataInstanceFactory`, `Chunk`, `ExecutionContext`, `StepContribution`,
`Tasklet`, `JobParametersValidator`, `FieldSetMapper`, and `Validator`; the Spring Batch
reference "Unit Testing" chapter; the Spring Batch 6.0 Migration Guide; the JUnit 6 user
guide; and the Mockito 5 release notes.

## Trade-offs

- **Interaction verification vs. state assertion.** Asserting on the returned object
  (`assertEquals("id", p.getId())`) survives refactoring; asserting on calls
  (`verify(fieldSet).readString(FIELD_ID)` plus `verifyNoMoreInteractions`) catches subtler
  bugs but re-breaks every time the implementation changes shape. Use interaction
  verification where the *interaction is the behaviour* — a listener that must write a
  reject line, a writer that must not INSERT — and state assertions everywhere else.
- **Mocks make tests fast and make them lie.** A stubbed `jdbcTemplate.update(...)`
  returning `1` proves the writer's branch logic; it proves nothing about whether the SQL
  is valid, the column names exist, or the transaction commits. Unit tests of a persistence
  component always need an integration test behind them
  (*spring-batch-integration-and-functional-testing*).
- **Deep stubs and spies buy convenience with coupling.** `RETURNS_DEEP_STUBS` lets you
  stub `getResource(path).exists()` in one line, and a spy lets you assert
  `getParameters()` was called exactly twice — both encode the implementation's call chain
  into the test. Mockito's own docs call deep stubs a Law-of-Demeter violation; treat them
  as a legacy-code tool, not a default.
- **Strict stubs are a net win that will break your migration.** With
  `MockitoExtension`, a `when(...)` no test path exercises fails the build — genuinely
  useful signal, but book-era code that stubs everything in `setUp` will light up red on
  day one. Prefer narrowing the stubs to `@MockitoSettings(strictness = LENIENT)`.
- **`MetaDataInstanceFactory` gives you an object, not a running job.** Its
  `StepExecution` has no repository behind it, so nothing persists, nothing restarts, and
  step-scoped beans are not resolved. Testing step-scoped components or restart semantics
  needs `StepScopeTestUtils` / `@SpringBatchTest` and a context — the integration layer.
- **Coverage is not correctness.** White-box unit testing optimises for branches touched,
  which is why the book writes three tests for one `if`. A job can have every component at
  100% coverage and still fail end to end because the steps are wired in the wrong order —
  a defect only a functional test sees.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 14, "Testing batch applications", sections 14.1-14.2, "The what and why of testing" / "Unit testing", p. 408-425 — doc
- [Spring Batch Reference — Unit Testing (`MetaDataInstanceFactory`, mocking domain objects, JUnit 4 unsupported as of 6.0)](https://docs.spring.io/spring-batch/reference/testing.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.test.MetaDataInstanceFactory`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/MetaDataInstanceFactory.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.infrastructure.item.Chunk`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/Chunk.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.core.step.tasklet.Tasklet`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/step/tasklet/Tasklet.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.core.job.parameters.JobParametersValidator`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/job/parameters/JobParametersValidator.html) — doc
- [Spring Batch 6.0 Migration Guide — core package relocations and JUnit 4 removal](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [JUnit 6 User Guide — Jupiter annotations, assertions, `assertThrows`](https://docs.junit.org/current/user-guide/) — doc
- [Mockito framework site — current `mockito-core` and core API](https://site.mockito.org/) — doc
- [Mockito 5 release notes — Java 11 baseline, inline mock maker, minimal API change](https://github.com/mockito/mockito/wiki/Draft-Mockito-5-release-notes) — doc
