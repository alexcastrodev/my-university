---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

Batch input is not always a single flat file. Two other shapes are common: one
large XML document, and a whole *directory* of files that arrive over FTP or
SCP. Spring Batch reads both without loading everything into memory.
`StaxEventItemReader` streams an XML document one fragment at a time — matching
a root element name and handing each fragment to a Spring OXM `Unmarshaller`
that turns it into a domain object. `MultiResourceItemReader` wraps a *single*
delegate `ItemReader` (a `FlatFileItemReader`, a `StaxEventItemReader`) and
feeds it an ordered array of `Resource`s, so one step processes an entire file
set as one continuous item stream.

Both preserve the chunk-oriented, item-at-a-time model that makes Spring Batch
memory-stable (see `spring-batch-chunk-processing`), and both are `ItemStream`s,
so they persist their position and can resume mid-file after a restart.

## Use Cases

- Importing a multi-gigabyte XML export (product catalog, trade feed) where
  loading the whole document with DOM would exhaust the heap.
- Binding each XML fragment straight to a domain object through Spring OXM,
  reusing the same marshaller for reading and writing.
- Processing every file dropped into an input directory (`file:data/input/*.xml`)
  in one step, without knowing the exact filenames in advance.
- Applying one reader definition — flat file or XML — uniformly across a set of
  identically formatted files, then restarting exactly where a failed run
  stopped.

## Deep Dive

### `StaxEventItemReader`: streaming XML fragments through an `Unmarshaller`

The input is one document whose root holds many identical fragments. The reader
matches `fragmentRootElementName` (`product` here) and materializes exactly one
fragment per `read()`:

```xml
<products>
  <product>
    <id>PR....210</id>
    <name>BlackBerry 8100 Pearl</name>
    <price>124.60</price>
  </product>
  <!-- ...thousands more... -->
</products>
```

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.xml.StaxEventItemReader">
  <property name="fragmentRootElementName" value="product" />
  <property name="resource" value="classpath:input/products.xml" />
  <property name="unmarshaller" ref="productMarshaller" />
</bean>

<bean id="productMarshaller"
      class="org.springframework.oxm.xstream.XStreamMarshaller">
  <property name="aliases">
    <util:map id="aliases">
      <entry key="product" value="com.manning.sbia.reading.Product" />
      <entry key="price"   value="java.math.BigDecimal" />
    </util:map>
  </property>
</bean>
```

`StaxEventItemReader` implements `ItemReader` on top of StAX and, because it
delegates conversion to a Spring OXM `Unmarshaller`, stays independent of any
particular parser. Its two key properties are `fragmentRootElementName` (the
element that marks one object) and `unmarshaller` (XML → object). The book wires
the `Unmarshaller` with Spring OXM — its listing uses `CastorMarshaller`, but
the quickest binding is an `XStreamMarshaller` whose alias map names each
fragment root and field type, exactly as the current reference still shows.

StAX matters *because* it is a **pull** parser: the reader asks for the next
event, so it can return one `<product>` and keep heap usage flat regardless of
file size. DOM would first build the entire document tree in memory — fine for a
config file, fatal for a large export. (SAX streams too, but its *push*
callback model does not map cleanly onto `ItemReader.read()`'s pull-one-item
contract.)

### `MultiResourceItemReader`: one step, a whole set of files

When files arrive in a directory under a known pattern, wrap a single delegate
reader and let `MultiResourceItemReader` iterate the matched resources in order:

```xml
<bean id="multiResourceReader"
      class="org.springframework.batch.item.file.MultiResourceItemReader">
  <property name="resources" value="file:data/input/products-*.xml" />
  <property name="delegate" ref="productItemReader" />
</bean>
```

It has just two properties: `resources` (a `Resource[]`, usually a wildcard
pattern resolved by Spring) and `delegate`. It handles one resource at a time,
sequentially, injecting each `Resource` into the delegate and streaming its
items before moving to the next — so downstream chunk processing sees one
uninterrupted item stream across the whole set. The delegate can be the
`StaxEventItemReader` above or a `FlatFileItemReader`
(`spring-batch-reading-flat-files`); it must implement
`ResourceAwareItemReaderItemStream` so the reader can hand it a `Resource` and
save/restore its position.

Because it is an `ItemStream`, `MultiResourceItemReader` writes its progress —
which resource in the array it is on, plus the delegate's offset inside that
resource — into the step's `ExecutionContext` on each commit, so a restart
reopens the correct file at the correct item. Resource ordering must be stable
across runs, which it enforces with a `Comparator`; the docs warn that adding
new files to the directory mid-job can corrupt a restart, so a job should own
its input directory until it completes.

### Book vs. today: builders replace the XML, and JAXB supersedes XStream

Since Spring Batch 4 the `<bean>` wiring is replaced by fluent builders, and the
single `fragmentRootElementName` property becomes `addFragmentRootElements(...)`
(which can accept several element names):

```java
@Bean
public StaxEventItemReader<Product> productItemReader(Jaxb2Marshaller productMarshaller) {
  return new StaxEventItemReaderBuilder<Product>()
      .name("productItemReader")
      .resource(new ClassPathResource("input/products.xml"))
      .addFragmentRootElements("product")
      .unmarshaller(productMarshaller)
      .build();
}

@Bean
public Jaxb2Marshaller productMarshaller() {
  Jaxb2Marshaller marshaller = new Jaxb2Marshaller();
  marshaller.setClassesToBeBound(Product.class);   // Product is @XmlRootElement(name = "product")
  return marshaller;
}

@Bean
public MultiResourceItemReader<Product> multiResourceReader(
    @Value("file:data/input/products-*.xml") Resource[] resources,
    StaxEventItemReader<Product> productItemReader) {
  return new MultiResourceItemReaderBuilder<Product>()
      .delegate(productItemReader)
      .resources(resources)
      .build();
}
```

Two shifts from the 2012 text. First, the unmarshaller: the book (and the
current reference's XML sample) uses `XStreamMarshaller` with an alias map, but
XStream has a long history of remote-code-execution CVEs from unsafe
deserialization, so new code binds with the type-safe `Jaxb2Marshaller` (JAXB) —
or a Jackson XML mapper — instead. Second, packaging: Spring Batch 6.0 moved
these infrastructure classes from `org.springframework.batch.item.*` to
`org.springframework.batch.infrastructure.item.*`, and the `batch:` XML
namespace is deprecated, so the builders above are the current idiom rather than
an optional convenience. Confirmed via the current Spring Batch reference —
*XML Item Readers and Writers* and *Multi-File Input* — and the Spring Framework
*Marshalling XML by Using Object-XML Mappers (OXM)* reference.

## Trade-offs

- **StAX streaming vs. DOM in memory** — `StaxEventItemReader` materializes one
  fragment per `read()`, so heap usage is independent of document size; the unit
  is whatever `fragmentRootElementName` names. DOM would load the full tree
  first, which does not scale to batch-sized input.

  ```java
  .addFragmentRootElements("product")   // one Product per read(), not the whole file
  ```

- **XStream convenience vs. JAXB safety** — `XStreamMarshaller` needs no
  annotations (just the alias map), but is untyped and carries XStream's
  deserialization CVE history; `Jaxb2Marshaller` requires bound/annotated
  classes yet is type-checked and the recommended default today.

  ```java
  marshaller.setClassesToBeBound(Product.class);   // explicit, validated binding
  ```

- **One step, whole file set — but single-threaded and restart-order-sensitive**
  — `MultiResourceItemReader` reads resources one after another on a single
  thread, and restart correctness depends on stable ordering plus not mutating
  the input directory mid-run. For parallelism, partition the files across
  threads (a scaling strategy) rather than expecting the reader to fan out.

- **The delegate must be a `ResourceAwareItemReaderItemStream`** — you cannot
  hand `MultiResourceItemReader` an arbitrary `ItemReader`; the delegate has to
  accept an injected `Resource` and expose `ItemStream` state so position can be
  saved and restored across the resource boundary. Late-bound, step-scoped
  wiring pairs naturally with this (see
  `spring-batch-step-scope-and-spel-late-binding`).

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 5, "Reading data", sections 5.3-5.4, "Reading XML files" / "Reading file sets", p. 135-139 — doc
- [Spring Batch Reference — XML Item Readers and Writers (`StaxEventItemReader`)](https://docs.spring.io/spring-batch/reference/readers-and-writers/xml-reading-writing.html) — doc
- [Spring Batch Reference — Multi-File Input (`MultiResourceItemReader`)](https://docs.spring.io/spring-batch/reference/readers-and-writers/multi-file-input.html) — doc
