---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Unit tests (see *spring-batch-unit-testing-with-junit-and-mockito*) prove that one
class behaves — a `Validator`, a `RowMapper`, a `Tasklet` — with everything around it
mocked and no Spring container in sight. That deliberately leaves the most
batch-specific things untested: whether the *wiring* is right, whether a
`CompositeItemProcessor`'s delegates are in the correct order, whether
`#{jobParameters['inputResource']}` actually resolves, whether the step commits, and
whether launching the job end to end leaves the right rows in the database. Those
questions only have answers inside a real `ApplicationContext` hitting a real (if
in-memory) datasource.

This concept covers the two Spring-context-backed layers Chapter 14 adds on top of unit
tests: **integration testing** — the Spring TestContext Framework plus
`StepScopeTestExecutionListener`, which fakes a running step so `@StepScope` beans and
late-bound SpEL can be exercised outside a job — and **functional testing** — launching
one real step or a whole real job from a test and asserting on the resulting
`JobExecution`, `BatchStatus`, step counts, and table contents. It is the last topic of
the last chapter of the book, and fittingly the one that exercises everything the
earlier chapters built.

## Use Cases

- Verifying that a `CompositeItemProcessor` assembled in configuration really chains its
  delegates in the intended order — a bug invisible to unit tests of each delegate.
- Testing a `@StepScope` reader whose `resource` comes from
  `#{jobParameters['inputResource']}`, without launching a job just to make the
  expression resolve.
- Reading a real fixture file through a configured `FlatFileItemReader` and asserting the
  first item's fields plus the exact item count.
- Running a single step (`productsStep`) against an in-memory H2 database and asserting
  `COMPLETED`, `filterCount == 2`, `writeCount == 6`, and `SELECT COUNT(*) FROM PRODUCT`.
- Running the whole job end to end as a regression gate in CI before every release.
- Seeding the repository (or clearing it) between tests so restart/rerun scenarios start
  from a known state.

## Deep Dive

### Why integration tests need a real context (and a real-ish datasource)

The book frames integration testing as *white-box* — aware of internals — but executed
in "realistic production conditions": real Spring contexts, real Spring Batch job
definitions, a real database. That last point matters more than it looks. Spring Batch
components are transactional by construction: a chunk-oriented step opens a transaction,
reads/processes/writes, commits, and records counts in the job repository. Mock a
`DataSource` and none of that happens; you are testing your code but not the framework's
contract with it.

The pragmatic compromise is an embedded database — the book uses **H2 in memory**
(`jdbc:h2:mem:products;DB_CLOSE_DELAY=-1`), fast enough to start per test suite and real
enough to run DDL, transactions, and SQL aggregate functions. In Java configuration the
`EmbeddedDatabaseBuilder` replaces the book's `SingleConnectionDataSource` +
`<jdbc:initialize-database>` pair, and it can load both the Spring Batch metadata schema
and your application tables:

```java
@Bean
public DataSource dataSource() {
    return new EmbeddedDatabaseBuilder()
            .setType(EmbeddedDatabaseType.H2)
            .addScript("classpath:org/springframework/batch/core/schema-h2.sql")
            .addScript("classpath:sql/create-tables.sql")
            .build();
}
```

(The batch metadata DDL script still ships at
`org/springframework/batch/core/schema-h2.sql` inside `spring-batch-core`; schema and
repository configuration itself is
*spring-batch-job-repository-database-configuration*.) Per-test data setup is cleaner as
`@Sql` than as hand-written `jdbcTemplate.update(...)` calls in `@BeforeEach`:

```java
@Test
@Sql(scripts = "/sql/insert-two-products.sql")
void statisticStepComputesAverage() { /* ... */ }
```

If the production target is Oracle or Postgres and the SQL is dialect-sensitive,
Testcontainers is the modern step up from H2 — same test code, a real engine in Docker.

### The Spring TestContext Framework: `@SpringJUnitConfig` and context caching

The Spring TestContext Framework is what turns a JUnit class into a Spring-aware one:
it builds the `ApplicationContext`, injects beans into test fields, and runs a chain of
`TestExecutionListener`s around each test. The book's JUnit 4 form was
`@RunWith(SpringJUnit4ClassRunner.class)` + `@ContextConfiguration`; today the composed
annotation `@SpringJUnitConfig` is both at once:

```java
@SpringJUnitConfig(BatchTestConfiguration.class)   // = @ExtendWith(SpringExtension.class) + @ContextConfiguration
class CompositeItemProcessorIntegrationTests {

    @Autowired
    private ItemProcessor<Product, Product> processor;   // the *real* configured chain

    @Test
    void rejectsNegativePrice() throws Exception {
        Product p = new Product();
        p.setPrice(new BigDecimal("-800.0"));
        assertNull(processor.process(p));   // filtered, not thrown: filter = true
    }
}
```

Two TestContext features are load-bearing for batch tests specifically:

- **Context caching.** The framework caches the `ApplicationContext` by configuration
  key and reuses it across test classes. For a batch context — datasource, job
  repository, readers, writers, the whole job graph — this is the difference between a
  suite that runs in seconds and one that rebuilds everything per class.
- **`@DirtiesContext`.** The escape hatch: it marks the cached context as polluted so
  it is closed and rebuilt. The book puts `@DirtiesContext` on nearly every test method,
  because batch components are stateful (an open `ItemStream`, a reader mid-file, an
  in-memory database with leftover rows). That is correct but expensive — see Trade-offs.

The processor test above is the smallest useful integration test: each `Validator` was
already unit-tested, so what's under test here is purely the *assembly*. The book makes
the point sharply — if `PositivePriceValidator` had been ordered before
`PriceMandatoryValidator`, these tests would fail with a `NullPointerException`, because
the positive-price check assumes a non-null price. No unit test can catch that; only the
real context can.

### `StepScopeTestExecutionListener`: a fake step around your test method

`@StepScope` beans and `#{jobParameters[...]}` / `#{stepExecutionContext[...]}`
expressions resolve against a live `StepContext` — the mechanics are in
*spring-batch-step-scope-and-spel-late-binding*. Outside a running step there is no such
context, so autowiring a step-scoped reader into a test normally fails or yields a proxy
that blows up on first use.

`StepScopeTestExecutionListener` (in `org.springframework.batch.test`, part of the
`spring-batch-test` module) solves this by registering a `StepExecution` with the
`StepSynchronizationManager` for the duration of each test method, then closing it
afterwards. By default it creates a `StepExecution` with fixed properties. If the test
class declares a **method returning `StepExecution`** — conventionally named
`getStepExecution` — the listener invokes it and uses the result, which is how you inject
the job parameters and execution-context entries the bean's SpEL expects:

```java
@SpringBatchTest                                 // registers the listener for you (see below)
@SpringJUnitConfig(BatchTestConfiguration.class)
class ProductReaderIntegrationTests {

    private static final String PRODUCTS = "classpath:input/products.txt";

    @Autowired
    private ItemReader<Product> reader;          // @StepScope FlatFileItemReader

    public StepExecution getStepExecution() {    // picked up reflectively by the listener
        JobParameters jobParameters = new JobParametersBuilder()
                .addString("inputResource", PRODUCTS)
                .toJobParameters();
        return MetaDataInstanceFactory.createStepExecution(jobParameters);
    }

    @BeforeEach
    void open()  { ((ItemStream) reader).open(new ExecutionContext()); }

    @AfterEach
    void close() { ((ItemStream) reader).close(); }

    @Test
    void readsEightProducts() throws Exception {
        Product first = reader.read();
        assertNotNull(first);
        assertEquals("211", first.getId());
        for (int i = 1; i < 8; i++) {
            assertNotNull(reader.read());
        }
        assertNull(reader.read());               // 9th read: end of file
    }
}
```

`MetaDataInstanceFactory` is the other half of the trick: a factory of throwaway batch
domain objects (`createJobInstance`, `createJobExecution`, `createStepExecution`, with
overloads taking `JobParameters` and/or an `ExecutionContext`) so you never hand-build a
`StepExecution`. Note the manual `open`/`close` of the `ItemStream` — the listener fakes
the *scope*, not the step lifecycle, so nothing opens the stream for you.

### `StepScopeTestUtils.doInStepScope`: the programmatic alternative

The listener is declarative and covers the whole test method. When you'd rather scope a
specific block — or need several different `StepExecution`s in one test —
`StepScopeTestUtils.doInStepScope(StepExecution, Callable<T>)` runs a callback inside a
step scope and returns its value:

```java
@Test
void countsAllItems() throws Exception {
    int count = StepScopeTestUtils.doInStepScope(getStepExecution(), () -> {
        int n = 0;
        try {
            ((ItemStream) reader).open(new ExecutionContext());
            while (reader.read() != null) {
                n++;
            }
            return n;
        }
        finally {
            ((ItemStream) reader).close();
        }
    });
    assertEquals(8, count);
}
```

The book's verdict still holds: the listener is simpler, `doInStepScope` is more
flexible and pays off for a complex reader. There is a `JobScopeTestUtils.doInJobScope`
and a `JobScopeTestExecutionListener` doing the same for `@JobScope` beans and
`#{jobExecutionContext[...]}`.

### Functional testing: launching a real step

Functional testing flips to *black box*: feed inputs, launch, assert outputs, ignore
internals. The `spring-batch-test` module's launcher utility injects the single `Job`
bean from the test context (having exactly one job per test context is the recommended
setup) and can start either the whole job or one named step, wrapped in a synthetic
single-step job. `@SpringBatchTest` is the one annotation that wires all of it up — it
is meta-annotated with `@ExtendWith(SpringExtension.class)`, registers a
`JobOperatorTestUtils` bean and a `JobRepositoryTestUtils` bean, and adds
`StepScopeTestExecutionListener` + `JobScopeTestExecutionListener` as test execution
listeners (merged with the defaults, so dependency injection still works):

```java
@SpringBatchTest
@SpringJUnitConfig(ImportProductsJobConfiguration.class)
class ProductStepFunctionalTests {

    @Autowired private JobOperatorTestUtils    jobOperatorTestUtils;
    @Autowired private JobRepositoryTestUtils  jobRepositoryTestUtils;
    @Autowired private DataSource              dataSource;

    @BeforeEach
    void clean() { this.jobRepositoryTestUtils.removeJobExecutions(); }

    @Test
    void productsStepWritesSixAndFiltersTwo() {
        JobParameters params = new JobParametersBuilder()
                .addString("inputResource", "classpath:input/products.txt")
                .toJobParameters();

        JobExecution execution = this.jobOperatorTestUtils.startStep("productsStep", params,
                new ExecutionContext());

        assertEquals(BatchStatus.COMPLETED, execution.getStatus());
        StepExecution stepExecution = execution.getStepExecutions().iterator().next();
        assertEquals(2, stepExecution.getFilterCount());
        assertEquals(6, stepExecution.getWriteCount());
        assertEquals(6, new JdbcTemplate(dataSource)
                .queryForObject("SELECT COUNT(*) FROM PRODUCT", Integer.class));
    }
}
```

This is where the framework's own bookkeeping becomes the assertion surface:
`getFilterCount()`, `getWriteCount()`, `getReadCount()`, `getSkipCount()`,
`getCommitCount()` on `StepExecution` are exactly the counters persisted to
`BATCH_STEP_EXECUTION` (*spring-batch-monitoring-and-jobexplorer*). Asserting on them
tests behaviour you cannot see from the output alone: that two rows were *filtered*
rather than skipped, that the writer really ran six times.

`JobRepositoryTestUtils` is the state manager around it —
`createJobExecutions(int)`/`createJobExecutions(String, String[], int)` to seed history,
`removeJobExecutions()` to wipe it. Clearing between tests matters because Spring Batch
refuses to rerun a completed `JobInstance` with identical identifying parameters; the
alternative is `getUniqueJobParameters()`, which adds a random `batch.random` parameter
so every launch is a fresh instance.

### Functional testing: the whole job

Testing the entire job is the same code with one call changed — and, per the book, "The
Big One": every reader, processor, writer, listener, decision, and transition runs for
real against the test datasource.

```java
@SpringBatchTest
@SpringJUnitConfig(ImportProductsJobConfiguration.class)
class WholeJobFunctionalTests {

    @Autowired private JobOperatorTestUtils jobOperatorTestUtils;
    @Autowired private DataSource           dataSource;

    @Test
    void importsProductsAndWritesStatistics(@TempDir Path tmp) throws Exception {
        Path report = tmp.resolve("statistic.txt");
        JobParameters params = new JobParametersBuilder()
                .addString("inputResource",  "classpath:input/products.txt")
                .addString("reportResource", "file:" + report)
                .toJobParameters();

        JobExecution execution = this.jobOperatorTestUtils.startJob(params);

        assertEquals(BatchStatus.COMPLETED, execution.getStatus());
        assertEquals(6, new JdbcTemplate(dataSource)
                .queryForObject("SELECT COUNT(*) FROM PRODUCT", Integer.class));
        assertLinesMatch(Files.readAllLines(Path.of("src/test/resources/expected/statistic.txt")),
                         Files.readAllLines(report));
    }
}
```

Two details worth copying. First, output goes to a JUnit 5 `@TempDir` rather than
`./target/`, so parallel or repeated runs don't collide. Second, file comparison is a
plain `assertLinesMatch` — the book used the module's `AssertFile` helper, which no
longer exists (see below). If the job under test is asynchronous or launched with a
`TaskExecutor` (*spring-batch-job-launcher-api-and-async-launching*), remember these
utilities give you a `JobExecution` that may still be running; a functional test
normally wants the synchronous default so assertions run after completion.

### Book vs. today: `SpringJUnit4ClassRunner` → `@SpringBatchTest`, `JobLauncherTestUtils` → `JobOperatorTestUtils`

The concepts are intact; three pieces of API changed.

**1. JUnit 4 → JUnit 5.** The book's runner-based boilerplate:

```java
// 2012 — JUnit 4
@RunWith(SpringJUnit4ClassRunner.class)
@ContextConfiguration
@TestExecutionListeners({ DependencyInjectionTestExecutionListener.class,
                          StepScopeTestExecutionListener.class })
public class CompositeItemProcessorTest { /* ... */ }
```

collapses to one annotation plus a config reference:

```java
// today — JUnit 5 (Jupiter)
@SpringBatchTest
@SpringJUnitConfig(BatchTestConfiguration.class)
class CompositeItemProcessorIntegrationTests { /* ... */ }
```

`@SpringBatchTest` exists since Spring Batch **4.1** and does four things at once
(`SpringExtension`, `JobOperatorTestUtils`, `JobRepositoryTestUtils`, the two scope
listeners). `@RunWith` → `@ExtendWith(SpringExtension.class)` is the raw equivalent if
you need it à la carte; `@SpringJUnitConfig` bundles that with `@ContextConfiguration`.
JUnit 4 support with `@SpringBatchTest` is **deprecated as of Spring Batch 6.0** and
slated for removal, so the migration is no longer optional. Also `@Before`/`@After` →
`@BeforeEach`/`@AfterEach`, and JUnit 5 reversed the assertion-message parameter order
(message last, not first) — a silent trap when porting old batch tests.

**2. `JobLauncherTestUtils` is deprecated; use `JobOperatorTestUtils`.** The book's
central functional-testing class still exists in `org.springframework.batch.test`, but
carries `@Deprecated(since = "6.0", forRemoval = true)` — "in favor of
`JobOperatorTestUtils`. Scheduled for removal in 6.2 or later" — mirroring the
`JobLauncher` → `JobOperator` shift in the production API. `JobOperatorTestUtils`
(`@since 6.0`) extends it and renames the verbs:

| Book (`JobLauncherTestUtils`) | Today (`JobOperatorTestUtils`) |
|---|---|
| `launchJob()` / `launchJob(JobParameters)` | `startJob()` / `startJob(JobParameters)` |
| `launchStep(String)` | `startStep(String)` |
| `launchStep(String, JobParameters)` | `startStep(String, JobParameters, ExecutionContext)` |
| — | `startStep(Step)` / `startStep(Step, JobParameters, ExecutionContext)` |
| — | `getUniqueJobParameters()` / `getUniqueJobParametersBuilder()` |

**3. `AssertFile` is gone.** The book's `assertFileEquals(File, File)` /
`assertLineCount(int, Resource)` helpers were deprecated in Spring Batch **5.0** and
removed — the module's stated goal is Spring Batch-specific utilities, not general file
assertions. Use JUnit 5's `Assertions.assertLinesMatch(...)` or AssertJ's
`assertThat(actual).hasSameTextualContentAs(expected)` instead.

Everything else the chapter relies on is unchanged in name and package:
`StepScopeTestExecutionListener`, `JobScopeTestExecutionListener`,
`StepScopeTestUtils.doInStepScope`, `JobScopeTestUtils.doInJobScope`,
`MetaDataInstanceFactory`, `JobRepositoryTestUtils`, and `ExecutionContextTestUtils` all
still live in `org.springframework.batch.test` in the `spring-batch-test` artifact
(Spring Boot pulls it in via `spring-boot-starter-batch` + `spring-batch-test` on the
test classpath). One package move does bite the imports: Spring Batch 6.0 relocated the
`spring-batch-infrastructure` APIs, so `ExecutionContext` is now
`org.springframework.batch.infrastructure.item.ExecutionContext` — visible in
`startStep(...)`'s signature and in every `new ExecutionContext()` above. `StepRunner`,
the lower-level step-launching helper, is deprecated for removal.

Confirmed against the Spring Batch 6.0 reference ("Unit Testing"), the 6.0 Javadoc for
`SpringBatchTest`/`JobOperatorTestUtils`/`JobLauncherTestUtils`, the `spring-batch-test`
sources on `main`, the Spring Batch 6.0 Migration Guide, and issue #4181 (AssertFile
deprecation).

## Trade-offs

- **Integration tests catch wiring bugs unit tests structurally cannot — and only those.**
  The delegate-ordering bug in `CompositeItemProcessor` is the canonical example: each
  `Validator` passes its own unit test, and the composite still fails. Conversely, an
  integration test that fails tells you *something in the graph* is wrong, not which
  class — which is why you want both layers, not one.
- **`@DirtiesContext` buys isolation and spends startup time.** The context cache is the
  main reason Spring integration tests are tolerable; `@DirtiesContext` on every test
  method (as the book writes them) throws it away each time. Prefer resetting *state* —
  `jobRepositoryTestUtils.removeJobExecutions()`, `@Sql` scripts, `@Transactional`
  rollback, fresh `@TempDir` output — and reserve `@DirtiesContext` for tests that truly
  mutate the container.
- **`StepScopeTestExecutionListener` fakes the scope, not the step.** It gives your
  step-scoped beans a `StepContext` so SpEL resolves, but nothing opens the
  `ItemStream`, no transaction is started, no chunk is committed, and no counts are
  recorded. Forgetting the manual `open(new ExecutionContext())` produces a
  reader that reads `null` forever — a confusing failure with an easy fix.
- **Listener vs. `doInStepScope` is convenience vs. control.** The listener covers the
  whole method with one `StepExecution`; `doInStepScope` scopes a block and can run
  several different executions in one test. The book declines to declare a winner and so
  should you.
- **Functional tests are the highest-confidence and highest-cost tier.** Launching a
  whole job exercises the real graph against a real datasource — the only test that
  answers "does the job work?" — but it is slow, depends on fixture files and DB state,
  and localizes failures poorly. Keep few of them, keep them deterministic, and put the
  edge cases in unit and integration tests.
- **In-memory H2 is not your production database.** It makes tests fast and hermetic
  while diverging on dialect, locking, isolation, and type coercion. A step whose SQL
  uses vendor-specific syntax, or whose behaviour depends on real lock contention, can
  pass on H2 and fail on Oracle — the case for Testcontainers on the paths that matter.
- **Rerunning a completed `JobInstance` fails by design, and tests trip on it.** Identical
  identifying job parameters mean the same instance, so a second run throws instead of
  re-executing. Either wipe history (`removeJobExecutions()`) or make parameters unique
  (`getUniqueJobParameters()`) — but note they differ: wiping keeps assertions on a clean
  repository, uniqueness leaves accumulated history behind.
- **Book vs. today: the deprecated names still compile, which is the risk.**
  `JobLauncherTestUtils.launchJob(...)` and JUnit 4 `@SpringBatchTest` both work in 6.0
  and both are scheduled for removal. Test code is the least-watched part of a codebase,
  so it silently accumulates the migration debt — port to
  `JobOperatorTestUtils.startJob(...)` and Jupiter when you touch it, not when the
  removal lands.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 14, "Testing batch applications", sections 14.3-14.5, "Integration testing" / "Functional testing" / "Summary", p. 425-437 — doc
- [Spring Batch Reference — Unit Testing (`@SpringBatchTest`, `JobOperatorTestUtils`, `StepScopeTestExecutionListener`, `MetaDataInstanceFactory`)](https://docs.spring.io/spring-batch/reference/testing.html) — doc
- [Spring Batch API — `@SpringBatchTest` (`org.springframework.batch.test.context`, since 4.1)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/context/SpringBatchTest.html) — doc
- [Spring Batch API — `JobOperatorTestUtils` (since 6.0: `startJob`, `startStep`)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/JobOperatorTestUtils.html) — doc
- [Spring Batch API — `JobLauncherTestUtils` (deprecated since 6.0, removal in 6.2 or later)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/JobLauncherTestUtils.html) — doc
- [Spring Batch API — `StepScopeTestExecutionListener` (`getStepExecution` factory method)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/StepScopeTestExecutionListener.html) — doc
- [Spring Batch 6.0 Migration Guide — JUnit 4 deprecation, `spring-batch-infrastructure` package relocation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [Spring Batch issue #4181 — Deprecate `AssertFile` (use JUnit 5 `assertLinesMatch` / AssertJ)](https://github.com/spring-projects/spring-batch/issues/4181) — doc
- [Spring Framework Reference — Executing SQL scripts in tests (`@Sql`)](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/executing-sql.html) — doc
- [Spring Framework Reference — Embedded database support (`EmbeddedDatabaseBuilder`)](https://docs.spring.io/spring-framework/reference/data-access/jdbc/embedded-database-support.html) — doc
- [Spring Framework Reference — TestContext support classes (`@SpringJUnitConfig`, `SpringExtension`)](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/support-classes.html) — doc
