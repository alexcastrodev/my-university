---
version: 1.0
updatedAt: 2026-07-27
---
## Objective

Understand Spring Batch's chunk-oriented processing model — an `ItemReader` feeds items into fixed-size, transactional chunks that an `ItemWriter` commits together — and the domain model that tracks a batch run (`Job`, `Step`, `JobInstance`, `JobExecution`, `StepExecution`, `JobRepository`), plus how a job is assembled today with `JobBuilder`/`StepBuilder` instead of the now-deprecated XML batch namespace.

## Use Cases

- Importing a large flat file into a database in fixed-size transactional chunks, instead of one giant transaction for the whole file or a commit per row.
- Running a non-read-write unit of work — decompressing an archive, cleaning up a directory — as a step that doesn't fit the reader/processor/writer shape, via a `Tasklet`.
- Telling apart "did today's import already run" from "how many times did we attempt it": `JobInstance` identity comes from the job's name plus its identifying `JobParameters`, while every attempt (including retries after a failure) gets its own `JobExecution`.
- Deciding the commit interval (chunk size) for a step based on the trade-off between transaction overhead and rollback cost, rather than guessing.

## Deep Dive

### `FlatFileItemReader` delegates line parsing to a `LineTokenizer` and a `FieldSetMapper`

Reading a flat file is itself a chain of delegation: `FlatFileItemReader` reads raw lines, a `DefaultLineMapper` splits each line with a `LineTokenizer` (a stock `DelimitedLineTokenizer` for CSV-like input), then maps the resulting `FieldSet` to a domain object with a `FieldSetMapper` you write yourself:

```java
public interface FieldSetMapper<T> {
  T mapFieldSet(FieldSet fieldSet) throws BindException;
}

public class ProductFieldSetMapper implements FieldSetMapper<Product> {

  public Product mapFieldSet(FieldSet fieldSet) throws BindException {
    Product product = new Product();
    product.setId(fieldSet.readString("PRODUCT_ID"));
    product.setName(fieldSet.readString("NAME"));
    product.setDescription(fieldSet.readString("DESCRIPTION"));
    product.setPrice(fieldSet.readBigDecimal("PRICE"));
    return product;
  }
}
```

`FieldSet` plays the same role here that JDBC's `ResultSet` plays for a database row: it exposes typed accessors (`readString`, `readBigDecimal`, …) over the tokenized fields, so the mapper only deals with domain conversion, never with string splitting.

### A hand-written `ItemWriter` decides between insert and update

Nothing about `ItemWriter` forces a single SQL statement — the implementation decides row by row whether an item is new:

```java
public class ProductJdbcItemWriter implements ItemWriter<Product> {

  private JdbcTemplate jdbcTemplate;

  public void write(List<? extends Product> items) throws Exception {
    for (Product item : items) {
      int updated = jdbcTemplate.update(UPDATE_PRODUCT,
          item.getName(), item.getDescription(), item.getPrice(), item.getId());
      if (updated == 0) {
        jdbcTemplate.update(INSERT_PRODUCT,
            item.getId(), item.getName(), item.getDescription(), item.getPrice());
      }
    }
  }
}
```

Spring Batch calls `write()` once per chunk with the whole batch of items — the writer never sees a single row in isolation, which is what makes chunk-level transactions possible in the first place.

### Chunk-oriented steps batch reads, processing, and writes into one transaction

A chunk-oriented step reads items one at a time but commits them as a batch: the `commit-interval` (today, `.chunk(size, transactionManager)` on `StepBuilder`) controls how many items accumulate before `ItemWriter.write()` is called and the transaction commits:

```xml
<step id="readWriteProducts">
  <tasklet>
    <chunk reader="reader" writer="writer" commit-interval="100" />
  </tasklet>
</step>
```

A chunk size of 100 means: read up to 100 products, then write all 100 in a single transaction. If item 57 fails, the whole chunk rolls back — not just that item — which is the mechanism trading throughput for transactional simplicity.

### A `Tasklet` handles work that isn't shaped like a read-write loop

Not every step processes a stream of items. Decompressing an uploaded archive before the read-write step even starts is a single unit of work, modeled with the `Tasklet` interface instead of a reader/writer pair:

```java
public class DecompressTasklet implements Tasklet {

  public RepeatStatus execute(StepContribution contribution, ChunkContext chunkContext) throws Exception {
    ZipInputStream zis = new ZipInputStream(new BufferedInputStream(inputResource.getInputStream()));
    // ... decompress each entry to targetDirectory ...
    zis.close();
    return RepeatStatus.FINISHED;
  }
}
```

`Tasklet` has a single method, `execute`, called repeatedly until it returns `RepeatStatus.FINISHED` — for a one-shot task like this, that's the first call. It's the escape hatch for step logic that chunk processing doesn't fit.

### The domain model: Job, Step, JobInstance, JobExecution, StepExecution

A `Job` is the logical definition of a batch process (its steps and their order); it holds no execution state itself. Running it produces:

- **`JobInstance`** — a logical run, identified by the job's name plus its identifying `JobParameters`. Importing today's file and tomorrow's file are two different `JobInstance`s of the same `Job`.
- **`JobExecution`** — one technical attempt at a `JobInstance`. If today's run fails and is restarted, it's the same `JobInstance` but a new `JobExecution` — status, start/end time, and exit status all belong here.
- **`StepExecution`** — one attempt at a single step within a `JobExecution`, tracking read/write/commit/rollback/skip counts for that step specifically.

The `JobRepository` persists all of this (so a restart knows exactly where a job stopped), and the `JobLauncher` is what starts a `Job` with a given set of `JobParameters` in the first place.

### Book vs. today: XML batch namespace → `JobBuilder`/`StepBuilder`

The book (2012, Spring Batch 2.1) assembles jobs and their infrastructure (`JobRepository`, `JobLauncher`, `DataSource`) entirely in XML, split across a job configuration file and a separate infrastructure file:

```xml
<job id="importProducts" xmlns="http://www.springframework.org/schema/batch">
  <step id="decompress" next="readWriteProducts">
    <tasklet ref="decompressTasklet" />
  </step>
  <step id="readWriteProducts">
    <tasklet>
      <chunk reader="reader" writer="writer" commit-interval="100" />
    </tasklet>
  </step>
</job>
```

The `batch:` XML namespace is deprecated as of Spring Batch 6.0, with removal planned for 7.0. Today the same job is Java configuration built with `JobBuilder`/`StepBuilder`, with a `JobRepository` injected rather than declared as a bean by hand:

```java
@Bean
public Job importProductsJob(JobRepository jobRepository, Step decompress, Step readWriteProducts) {
  return new JobBuilder("importProducts", jobRepository)
      .start(decompress)
      .next(readWriteProducts)
      .build();
}

@Bean
public Step readWriteProducts(JobRepository jobRepository, PlatformTransactionManager txManager,
    ItemReader<Product> reader, ItemWriter<Product> writer) {
  return new StepBuilder("readWriteProducts", jobRepository)
      .<Product, Product>chunk(100, txManager)
      .reader(reader)
      .writer(writer)
      .build();
}
```

The book's practice of splitting *infrastructure* configuration (`JobRepository`, `DataSource`) from *job* configuration still holds conceptually — it's just that `@EnableBatchProcessing` now auto-configures the `JobRepository` for you instead of the book's hand-declared `MapJobRepositoryFactoryBean` bean.

## Trade-offs

- **Chunk size is a direct trade-off between transaction overhead and rollback cost** — a chunk too small creates excessive transactions and slows the job down; a chunk too large holds a transactional resource (like a database) open longer and makes a rollback more expensive. The book's own rule of thumb is a commit interval between 10 and 200, tuned per job rather than assumed.
- **Chunk processing buys per-chunk transactional safety, a `Tasklet` doesn't** — a chunk step rolls back the whole chunk on a mid-chunk failure and can skip/retry individual items; a `Tasklet` step is one atomic unit with none of that granularity, which is the right trade for work (like decompression) that has no meaningful notion of a "partial item."
- **`JobInstance` identity depends entirely on which parameters you mark as identifying** — two runs of the same `Job` with the same identifying `JobParameters` are the *same* `JobInstance`, so a job meant to run once per day needs a distinguishing parameter (a date, a timestamp) or a second same-day run will be treated as a restart of the first rather than a new logical run.

## Documentation Links

- [Spring Batch in Action (Manning, 2012) — Chapter 1: "Introducing Spring Batch", p. 16-27](https://www.manning.com/books/spring-batch-in-action) — doc
- [Spring Batch Reference — Domain Language (Job, Step, JobInstance, JobExecution, StepExecution, JobRepository)](https://docs.spring.io/spring-batch/reference/domain.html) — doc
- [Spring Batch 6.0 Migration Guide — XML namespace deprecation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
