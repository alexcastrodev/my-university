---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Reading is the first phase of chunk-oriented processing, and Spring Batch models it with a single contract: `ItemReader<T>`, whose `read()` returns the next item or `null` at end of input. File readers additionally implement `ItemStream` so the current read position is saved to the execution context — that is what makes a failed job restartable rather than restart-from-scratch. This concept covers how the built-in `FlatFileItemReader` turns raw lines into domain objects.

For flat files, `FlatFileItemReader` never parses lines itself. It delegates to a `LineMapper`; the stock `DefaultLineMapper` is a two-stage pipeline — a `LineTokenizer` splits a line into a `FieldSet`, then a `FieldSetMapper` builds the domain object from that `FieldSet`. Everything else (delimited vs. fixed-width fields, multiline records, heterogeneous records, JSON) is a matter of swapping tokenizers, mappers, and policies into that pipeline. The reader is the source end of a chunk step (see `spring-batch-chunk-processing`), and its input resource is typically late-bound to a job parameter (see `spring-batch-step-scope-and-spel-late-binding`).

## Use Cases

- Importing a delimited (CSV-style) product catalog whose columns map by name onto a domain bean.
- Ingesting a fixed-width mainframe extract where each field is a column range rather than delimiter-separated.
- Skipping a header row, forcing a non-default file encoding, and reading from a resource whose path is only known at launch time.
- Parsing records that span several physical lines into one logical item.
- Loading a file that mixes record types (for example phones and books) with different layouts in the same file.
- Binding a stream of JSON documents directly to typed objects.

## Deep Dive

### The `ItemReader` contract: one `read()` per item

The read phase hangs off one small interface:

```java
public interface ItemReader<T> {
    T read() throws Exception, UnexpectedInputException,
                     ParseException, NonTransientResourceException;
}
```

`read()` returns the next item, or `null` to signal that input is exhausted — at which point the surrounding chunk stops accumulating and commits what it has. Built-in file readers also implement `ItemStream` (`open`/`update`/`close`), so they persist their position to the execution context and can resume after a failure. Conceptually the reader is just the source that feeds items into a chunk step (`spring-batch-chunk-processing`); the rest of this concept is about turning one line of a flat file into one `T`.

### `FlatFileItemReader`: line → `FieldSet` → domain object

`FlatFileItemReader` reads raw lines from a `resource` and hands each to a `LineMapper`. `DefaultLineMapper` splits the work in two: a `LineTokenizer` produces a `FieldSet` (named, typed tokens — the flat-file analogue of a JDBC `ResultSet` row), and a `FieldSetMapper` maps that `FieldSet` to your object.

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.file.FlatFileItemReader">
  <property name="resource" value="classpath:products.txt"/>
  <property name="linesToSkip" value="1"/>
  <property name="encoding" value="UTF-8"/>
  <property name="lineMapper" ref="productLineMapper"/>
</bean>

<bean id="productLineMapper"
      class="org.springframework.batch.item.file.mapping.DefaultLineMapper">
  <property name="lineTokenizer" ref="productLineTokenizer"/>
  <property name="fieldSetMapper" ref="productFieldSetMapper"/>
</bean>

<bean id="productLineTokenizer"
      class="org.springframework.batch.item.file.transform.DelimitedLineTokenizer">
  <property name="delimiter" value=","/>
  <property name="names" value="id,name,description,price"/>
</bean>
```

`linesToSkip="1"` drops the header row (a `skippedLinesCallback` can capture those skipped lines if you need them); `encoding` overrides the reader's default charset; and the hardcoded `resource` above is usually late-bound to a job parameter instead (`spring-batch-step-scope-and-spel-late-binding`). A custom `FieldSetMapper` reads typed fields out of the `FieldSet` by name:

```java
public class ProductFieldSetMapper implements FieldSetMapper<Product> {
    public Product mapFieldSet(FieldSet fs) throws BindException {
        Product p = new Product();
        p.setId(fs.readString("id"));
        p.setName(fs.readString("name"));
        p.setDescription(fs.readString("description"));
        p.setPrice(fs.readBigDecimal("price"));
        return p;
    }
}
```

`FieldSet` exposes typed readers (`readString`, `readBigDecimal`, `readDate`, `readInt`, …), so the mapper only does domain conversion, never string splitting. When bean property names match the tokenizer's field names exactly, you can skip the custom class and use the stock `BeanWrapperFieldSetMapper` (pointed at a prototype-scoped bean), which sets each property reflectively from the matching field.

### Delimited vs. fixed-length tokenizers

Two tokenizers cover most flat files, and both yield the same `FieldSet`, so the downstream `FieldSetMapper` is identical either way — only the tokenizer changes. `DelimitedLineTokenizer` (above) splits on a delimiter (comma by default). When fields carry no separator but fixed column widths, `FixedLengthTokenizer` maps column ranges to names:

```xml
<bean id="productLineTokenizer"
      class="org.springframework.batch.item.file.transform.FixedLengthTokenizer">
  <property name="columns" value="1-9,10-35,36-50,51-56"/>
  <property name="names" value="id,name,description,price"/>
</bean>
```

Column ranges are **1-based** (Spring's `RangeArrayPropertyEditor` parses the string), a common off-by-one gotcha for anyone used to zero-based indexing.

### Multiline records: a custom `RecordSeparatorPolicy`

By default one physical line is one record. When a logical record spans several lines, a `RecordSeparatorPolicy` tells the reader where a record ends; `isEndOfRecord()` inspects the accumulated text and returns `false` until the record is complete:

```java
public class TwoLineProductRecordSeparatorPolicy implements RecordSeparatorPolicy {
    // a complete product has 4 comma-separated fields => 3 commas
    public boolean isEndOfRecord(String line) {
        return countCommas(line) == 3;
    }
    public String preProcess(String line) { return line; }
    public String postProcess(String record) { return record; }
}
```

Wire it through the reader's `recordSeparatorPolicy` property; the tokenizer then sees the concatenated multi-line record as a single line and parses it normally.

### Heterogeneous records: `PatternMatchingCompositeLineMapper`

When one file mixes record types with different layouts — say mobile phones (lines prefixed `PRM`) and books (`PRB`) — a single tokenizer will not do. `PatternMatchingCompositeLineMapper` routes each line by a prefix pattern to its own tokenizer and field-set mapper:

```xml
<bean id="productLineMapper"
      class="org.springframework.batch.item.file.mapping.PatternMatchingCompositeLineMapper">
  <property name="tokenizers">
    <map>
      <entry key="PRM*" value-ref="mobileTokenizer"/>
      <entry key="PRB*" value-ref="bookTokenizer"/>
    </map>
  </property>
  <property name="fieldSetMappers">
    <map>
      <entry key="PRM*" value-ref="mobileFieldSetMapper"/>
      <entry key="PRB*" value-ref="bookFieldSetMapper"/>
    </map>
  </property>
</bean>
```

The `*` wildcard keys pick the tokenizer/mapper pair per line — the usual way to build a polymorphic model (a base `Product` with `MobilePhoneProduct`/`BookProduct` subclasses) out of one heterogeneous file.

### Reading JSON (the book's approach)

The 2012 book reads JSON with a `JsonLineMapper`, which parses each JSON object into a `java.util.Map<String,Object>` — not a typed object:

```xml
<bean id="productsLineMapper"
      class="org.springframework.batch.item.file.mapping.JsonLineMapper"/>
```

Because you usually want `Product` instances rather than maps, the book then wraps that mapper in a delegating `LineMapper` that converts each `Map` by hand:

```java
public class JsonLineMapperWrapper implements LineMapper<Product> {
    private JsonLineMapper delegate;
    public Product mapLine(String line, int lineNumber) throws Exception {
        Map<String, Object> m = delegate.mapLine(line, lineNumber);
        Product p = new Product();
        p.setId((String) m.get("id"));
        p.setName((String) m.get("name"));
        p.setPrice(new BigDecimal(m.get("price").toString()));
        return p;
    }
}
```

That manual `Map`-to-object dance is exactly what modern Spring Batch deletes — see the next section.

### Book vs. today: XML + `JsonLineMapper` → builders + `JsonItemReader`

Two things changed since the book (Spring Batch 2.1, 2012).

First, since **Spring Batch 4** the fluent `FlatFileItemReaderBuilder` replaces the XML wiring: it constructs the `DefaultLineMapper`, tokenizer, and `FieldSetMapper` for you. `.delimited()`/`.fixedLength()` pick the tokenizer, `.names(...)` sets the field names, and `.targetType(Product.class)` installs a `BeanWrapperFieldSetMapper`:

```java
@Bean
@StepScope
public FlatFileItemReader<Product> productItemReader(
        @Value("#{jobParameters['input.file']}") Resource resource) {
    return new FlatFileItemReaderBuilder<Product>()
            .name("productItemReader")
            .resource(resource)
            .linesToSkip(1)
            .encoding("UTF-8")
            .delimited().delimiter(",")
            .names("id", "name", "description", "price")
            .targetType(Product.class)
            .build();
}
```

(For fixed-width, swap in `.fixedLength().columns(new Range(1, 9), new Range(10, 35), …).names(…)`.) The XML `batch:` namespace still works but is deprecated as of Spring Batch 6.0 (removal planned for 7.0), so Java config plus builders is the recommended style.

Second, since **Spring Batch 4.1** a first-class `JsonItemReader` binds JSON straight to typed objects, removing the `Map`-and-wrapper code above. It delegates parsing to a `JsonObjectReader` — `JacksonJsonObjectReader` (or `GsonJsonObjectReader`):

```java
@Bean
public JsonItemReader<Product> productJsonReader() {
    return new JsonItemReaderBuilder<Product>()
            .name("productJsonReader")
            .resource(new ClassPathResource("products.json"))
            .jsonObjectReader(new JacksonJsonObjectReader<>(Product.class))
            .build();
}
```

One package nuance to cite accurately: in Spring Batch 6.0 these infrastructure classes were relocated. `FlatFileItemReader` now lives in `org.springframework.batch.infrastructure.item.file` and the JSON types in `org.springframework.batch.infrastructure.item.json`, whereas 5.x and the book used `org.springframework.batch.item.file`/`...item.json`. Confirmed via the Spring Batch 6.0 reference (Flat Files, and JSON Item Reading and Writing) and the 6.0.x API Javadoc for `FlatFileItemReaderBuilder` and `JsonItemReader`.

## Trade-offs

- **Delimited vs. fixed-length format** — Delimited files are compact and tolerant of varying field lengths but break on an unescaped delimiter inside the data; fixed-width files are positionally self-describing and delimiter-safe but larger, and brittle if any column width ever shifts. Match the tokenizer to the source, not to taste.
- **`BeanWrapperFieldSetMapper` vs. a custom `FieldSetMapper`** — The bean-wrapper mapper is zero-code when field names line up with bean properties, but it binds by name via reflection with little room for validation; a custom mapper is more code yet gives explicit typed reads (`readBigDecimal`, `readDate`), defaulting, and validation. Convention vs. control.
- **Streaming, one item at a time** — `FlatFileItemReader` reads and maps lazily on each `read()`, so memory stays flat for huge files and the position is restartable. The cost is that the reader is inherently stateful and not thread-safe by default, so parallelizing a single file needs deliberate partitioning rather than simply sharing one reader.
- **Config-driven policies vs. a custom `LineMapper`** — A `RecordSeparatorPolicy` or `PatternMatchingCompositeLineMapper` keeps the reader declarative, but genuinely complex record grammars strain prefix-pattern matching; past a point a hand-written `LineMapper` (or a better-structured source format) is clearer than stretching wildcards.
- **`JsonItemReader` vs. the book's `JsonLineMapper`** — The modern typed reader removes the `Map`-to-object boilerplate and gives you a concrete target type, but it expects a stream of JSON objects and a binding library (Jackson/Gson) on the classpath; the book's `Map` approach is untyped but dependency-light.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 5, "Reading data", sections 5.1-5.2, "Data reading concepts" / "Reading flat files", p. 117-135 — doc
- [Spring Batch Reference — Flat Files](https://docs.spring.io/spring-batch/reference/readers-and-writers/flat-files.html) — doc
- [Spring Batch Reference — JSON Item Reading and Writing](https://docs.spring.io/spring-batch/reference/readers-and-writers/json-reading-writing.html) — doc
