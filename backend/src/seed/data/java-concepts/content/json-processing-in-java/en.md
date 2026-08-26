---
version: 1.0
updatedAt: 2026-08-19
---
## Objective

JSON is the default wire format for almost everything a Java service talks to, yet the JDK itself still cannot read or write it: there is no JSON type anywhere in `java.base`, and no `java.util.json` package. (OpenJDK's JEP 540, *Simple JSON API*, is proposed to target JDK 28 as an **incubating** `jdk.incubator.json` module — and even that deliberately excludes object mapping.) So every Java program that touches JSON picks a library, and the real decision is not "which library" but **which of three processing models**: *data binding* (JSON straight into your own records/classes), the *tree model* (a generic in-memory node graph you navigate by name), or a *streaming parser* (a forward-only cursor over tokens, holding nothing). Jackson is the de facto standard because it is the only mainstream option that gives you all three behind one façade — and because the frameworks already ship it.

## Use Cases

- Turning an HTTP response body into a `record` or DTO, and a DTO back into a request body — the everyday REST client/server case.
- Reading three fields out of a large config, manifest, or webhook payload whose full schema you don't want to model — tree model plus a JSON Pointer.
- Consuming a multi-gigabyte JSON export line by line, or a paginated array, without holding it all in heap — the streaming parser.
- Surviving schema evolution: the provider adds a field, renames one, or starts sending `null`, and your deserialization must not break.
- Building a Spring Boot REST API, where Jackson is already on the classpath and your job is to *configure* it (`JsonMapper` bean, property naming, date format) rather than call it directly.
- Emitting structured JSON logs or audit events from an existing object graph.
- Handling money and identifiers correctly, where JSON's single "number" type will silently cost you precision.

## Deep Dive

Every example below reads or writes this document:

```json
{
  "name": "robinparse",
  "version": "1.2.3",
  "description": "Another Parser for JSON",
  "contributors": ["Robin Smythe", "Jon Jenz", "Jan Ardann"]
}
```

Jackson comes in three artifacts — `jackson-core` (streaming), `jackson-annotations`, `jackson-databind` (binding plus tree model, which pulls in the other two). Depend on `jackson-databind` and you get everything:

```xml
<!-- Jackson 2.x — the version on most classpaths today -->
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>2.22.1</version>
</dependency>

<!-- Jackson 3.x — new groupId, new packages -->
<dependency>
  <groupId>tools.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>3.2.0</version>
</dependency>
```

Snippets here use `JsonMapper.builder().build()`, which compiles unchanged on both Jackson 2.10+ and Jackson 3; only the import line differs (`com.fasterxml.jackson.databind.json.JsonMapper` vs `tools.jackson.databind.json.JsonMapper`).

### Data binding: JSON to a record and back

Data binding is the shortest path: describe the shape as a Java type, hand Jackson the type, get an object. Records work directly — Jackson reads the component names off the class file, so no annotations and no setters are needed:

```java
record SoftwareInfo(String name, String version,
                    String description, List<String> contributors) {}

var mapper = JsonMapper.builder().build();

SoftwareInfo info = mapper.readValue(json, SoftwareInfo.class);
System.out.println(info.contributors().get(1));   // Jon Jenz

String back = mapper.writeValueAsString(info);
```

`readValue` is overloaded for `String`, `byte[]`, `File`, `InputStream`, `Reader` and `URL`; `writeValue(OutputStream, Object)` and `writeValueAsString(Object)` go the other way. A generic collection cannot be described by a `Class` literal, because erasure throws the element type away — that needs `TypeReference`:

```java
// WRONG: compiles, then blows up at the first use
List<SoftwareInfo> broken = mapper.readValue(arrayJson, List.class);
SoftwareInfo first = broken.get(0);
// ClassCastException: LinkedHashMap cannot be cast to SoftwareInfo

// RIGHT: TypeReference keeps the element type
List<SoftwareInfo> good =
    mapper.readValue(arrayJson, new TypeReference<List<SoftwareInfo>>() {});
```

`Map<String, Object>` is the untyped escape hatch and works the same way — useful when you genuinely don't know the keys.

### Controlling the mapping with annotations

The default mapping (Java property name to JSON property name) covers most cases; `jackson-annotations` covers the rest. These are the five that carry real weight in practice:

```java
@JsonIgnoreProperties(ignoreUnknown = true)     // tolerate fields you don't model
public class Account {

    @JsonProperty("account_id")                 // JSON name differs from Java name
    private String id;

    @JsonAlias({"mail", "emailAddress"})        // accept legacy names on read only
    private String email;

    @JsonIgnore                                 // never read, never written
    private String passwordHash;

    @JsonInclude(JsonInclude.Include.NON_NULL)  // omit when null instead of "x": null
    private String nickname;

    // getters / setters
}
```

Without `@JsonIgnoreProperties` (or the equivalent global setting), an unmodelled field is a hard failure — Jackson is strict by default:

```java
record Point(int x, int y) {}

mapper.readValue("{\"x\":1,\"y\":2,\"z\":3}", Point.class);
// UnrecognizedPropertyException: Unrecognized field "z" (class Point),
// not marked as ignorable
```

Turn it off globally when you consume third-party APIs you don't control:

```java
var lenient = JsonMapper.builder()
        .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
        .build();
```

`@JsonProperty` on a record component works too, and `@JsonCreator` on a constructor or static factory takes over object construction when the defaults can't (multiple constructors, validation, a single-argument "delegating" form).

### The tree model: JsonNode

When you have no class to bind to — or don't want one — read the document into a `JsonNode` tree and walk it. Every node is a `JsonNode`; objects and arrays are just nodes with children:

```java
JsonNode root = mapper.readTree(json);

String name = root.get("name").asText();          // asString() in Jackson 3.x
for (JsonNode contributor : root.get("contributors")) {   // JsonNode is Iterable
    System.out.println(contributor.asText());
}
```

The trap is `get` versus `path`. `get` returns `null` for an absent field, so chaining walks straight into a `NullPointerException`; `path` returns a `MissingNode` that keeps the chain alive and answers `isMissingNode()`:

```java
root.get("license").asText();               // NullPointerException — no such field
root.path("license").asText("unknown");     // "unknown" — MissingNode, default applied
root.path("license").isMissingNode();       // true
```

Building a tree for output is the mirror image, via `ObjectNode`/`ArrayNode`:

```java
ObjectNode out = mapper.createObjectNode();
out.put("name", "robinparse").put("version", "1.2.3");
out.putArray("contributors").add("Robin Smythe").add("Jon Jenz");

System.out.println(out.toString());
// {"name":"robinparse","version":"1.2.3","contributors":["Robin Smythe","Jon Jenz"]}
```

`mapper.convertValue(node, SoftwareInfo.class)` and `mapper.valueToTree(info)` convert between the two models without a round trip through text — handy when you must inspect a document before deciding which type to bind it to.

### JSON Pointer: one value out of a nested document

RFC 6901 defines JSON Pointer, a tiny path syntax (`/` separated names, array indices as numbers) for addressing one element inside a JSON document. It is not XPath and not JSONPath — no wildcards, no predicates, no expressions — which is exactly why it needs no extra dependency: Jackson implements it on `JsonNode.at()`.

```java
JsonNode root = mapper.readTree("""
    {"firstName":"Robin","age":63,
     "roles":["Mork","Mrs. Doubtfire","Patch Adams"]}
    """);

root.at("/firstName").asText();        // Robin
root.at("/age").asInt();               // 63
root.at("/roles/1").asText();          // Mrs. Doubtfire
root.at("/roles").size();              // 3
```

A pointer that doesn't match returns `MissingNode` rather than throwing, so a miss is a value you test, not an exception you catch. Use `requiredAt` when a miss *is* a bug:

```java
root.at("/publisher/city").isMissingNode();   // true — no exception
root.requiredAt("/publisher/city");           // IllegalArgumentException: no node at that pointer
```

Two characters are escaped, because `/` and `~` are structural: `~1` means a literal `/` inside a name, `~0` a literal `~`. So the field `"ft/pt"` is addressed as `/ft~1pt`.

Where a pointer is not enough — "every author of every book over $10" — that is JSONPath territory, a separate library (Jayway `json-path`), not something Jackson ships.

### The streaming parser: documents too big to hold

Both models above materialize the whole document. When the document is a 5 GB export, the only option is a forward-only token cursor: `JsonParser` from `jackson-core`. You pull one token at a time and keep whatever you care about:

```java
var factory = JsonFactory.builder().build();

try (JsonParser p = factory.createParser(new File("huge.json"))) {
    while (p.nextToken() != null) {
        if (p.currentToken() == JsonToken.FIELD_NAME     // PROPERTY_NAME in Jackson 3
                && "name".equals(p.currentName())) {
            p.nextToken();                               // advance onto the value
            System.out.println(p.getText());             // getString() in Jackson 3
        }
    }
}
```

Memory use is a few kilobytes regardless of document size, and it is the fastest option — but there is no going back, no random access, and nesting depth is yours to track. The generating counterpart is `JsonGenerator`:

```java
try (JsonGenerator g = factory.createGenerator(System.out)) {
    g.writeStartObject();
    g.writeStringProperty("name", "robinparse");   // writeStringField in Jackson 2
    g.writeEndObject();
}
```

In practice streaming is worth it for one of two reasons: the document doesn't fit in memory, or you are in a hot path where binding overhead shows up in a profile. Otherwise bind.

### Jackson 2 versus Jackson 3

Jackson 3.0 shipped in October 2025 (3.2.0 in June 2026) and is a hard break — one you will meet the moment a project moves to Spring Boot 4, which uses Jackson 3 by default. Jackson 2.x is not dead: 2.21 is an LTS line maintained into 2028, and both majors are designed to sit on the same classpath, because the package names differ.

| | Jackson 2.x | Jackson 3.x |
|---|---|---|
| groupId | `com.fasterxml.jackson.core` | `tools.jackson.core` |
| packages | `com.fasterxml.jackson.*` | `tools.jackson.*` (annotations stay `com.fasterxml.jackson.annotation`) |
| entry point | `new ObjectMapper()` | `JsonMapper.builder().build()` — immutable, no public constructor |
| exceptions | checked `JsonProcessingException` | unchecked `JacksonException` / `DatabindException` |
| baseline | Java 8 | Java 17 |

The immutability and unchecked-exception changes are what you feel in code:

```java
// Jackson 2.x — mutable mapper, checked exception
ObjectMapper mapper = new ObjectMapper();
mapper.enable(SerializationFeature.INDENT_OUTPUT);
try {
    mapper.readValue(json, Point.class);
} catch (JsonProcessingException e) { /* must be handled */ }

// Jackson 3.x — configure at build time, nothing to catch
var mapper = JsonMapper.builder()
        .enable(SerializationFeature.INDENT_OUTPUT)
        .build();
mapper.readValue(json, Point.class);   // JacksonException is a RuntimeException
```

Some defaults flipped too: in 3.x `FAIL_ON_TRAILING_TOKENS` and `SORT_PROPERTIES_ALPHABETICALLY` are on, `WRITE_DATES_AS_TIMESTAMPS` is off. Alphabetical property order in particular will change your output bytes, which matters if anything downstream compares JSON as text.

### java.time and other JDK types

The single most common Jackson surprise on 2.x: `java.time` is not supported out of the box. Serializing a record with a `LocalDate` fails outright unless a module is registered.

```java
record Release(String version, LocalDate date) {}

var mapper = JsonMapper.builder().build();
mapper.writeValueAsString(new Release("1.2.3", LocalDate.of(2026, 8, 19)));
// InvalidDefinitionException: Java 8 date/time type `java.time.LocalDate`
// not supported by default: add Module
// "com.fasterxml.jackson.datatype:jackson-datatype-jsr310" to enable handling
```

Add the dependency, register the module, and disable timestamp output so you get ISO-8601 strings instead of numeric arrays:

```java
var mapper = JsonMapper.builder()
        .addModule(new JavaTimeModule())
        .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS)
        .build();
// {"version":"1.2.3","date":"2026-08-19"}
```

In Jackson 3 this whole step is gone: the three "Java 8 modules" (`jsr310`, `jdk8`, `parameter-names`) are built into `jackson-databind`, and `WRITE_DATES_AS_TIMESTAMPS` defaults to off.

### The alternatives, and why Jackson wins anyway

**Gson** (Google) is the closest competitor and the nicest small API — two methods and no annotations for the common case:

```java
Gson gson = new Gson();
SoftwareInfo info = gson.fromJson(json, SoftwareInfo.class);
String out = gson.toJson(info);
```

Gson is fine code and still widely deployed, especially on Android. But its own maintainers describe it as being in **maintenance mode** — bugs get fixed, large new features generally do not — which is the decisive point when choosing for a new service in 2026.

**org.json** (JSON-Java) is the lowest-level of the three. There is no binding at all: you work in JSON's own abstractions and pull values out by name, which means the compiler cannot help you.

```java
JSONObject obj = new JSONObject(new JSONTokener(inputStream));
String name = obj.getString("name");
JSONArray contribs = obj.getJSONArray("contributors");
for (Object contributor : contribs) {   // JSONArray implements Iterable<Object>
    System.out.println(contributor);
}
```

It survives on ubiquity (it is bundled in Android) rather than on merit — a missing key throws `JSONException` rather than yielding a testable absent value, there is no data binding, and there is no streaming mode. Older tutorials still show an index loop here because `JSONArray` predates its own `Iterable` implementation; it has had one for years.

**JSON-B / JSON-P** (`jakarta.json.bind`, `jakarta.json`) are the standards-track option, part of Jakarta EE rather than Java SE. The binding API is genuinely clean, and being a spec, implementations are swappable (Eclipse Yasson, Parsson):

```java
Jsonb jsonb = JsonbBuilder.create();
SoftwareInfo info = jsonb.fromJson(json, SoftwareInfo.class);
String out = jsonb.toJson(info);
```

The catch is that you only get it for free inside a Jakarta EE / MicroProfile container; outside one you are adding a spec API plus an implementation to do what a single Jackson dependency already does.

Jackson dominates for reasons that are structural, not aesthetic: it is the default JSON provider in Spring Boot (Jackson 3 in Boot 4, Jackson 2 in Boot 3) and in the major JAX-RS implementations (Jersey, RESTEasy, CXF); it covers all three processing models plus non-JSON formats (XML, YAML, CBOR, Smile, Avro, Protobuf) behind the same `ObjectMapper` API; and it is actively developed on two parallel release lines. On most projects the choice is already made by the framework — you inherit Jackson whether you picked it or not, so knowing its knobs pays off more than picking a favourite.

### Coming to the JDK: JEP 540

JEP 540, *Simple JSON API (Incubator)*, is proposed to target **JDK 28** and would put JSON in the platform for the first time, in the incubating `jdk.incubator.json` module. The shape is a sealed `JsonValue` hierarchy plus a `Json` façade:

```java
// jdk.incubator.json — JDK 28, incubator module
int temperature = Json.parse(body)
        .get("properties")
        .get("periods")
        .get(0)
        .get("temperature")
        .asInt();
```

Note what this is and isn't. It is a tree model with factory methods (`JsonObject.of`, `JsonString.of`), navigation (`get(String)`, `get(int)`, `tryGet` returning `Optional<JsonValue>`) and conversions (`asInt`, `asMap`, `asList`). Data binding, streaming, and lenient parsing are **explicitly out of scope** — the stated goal is to complement Jackson and Gson for small jobs (read a config file, poke at a REST response), not to replace them. Until it ships and leaves incubation, and for anything involving your own domain types afterwards, a library is still the answer.

## Trade-offs

- **Data binding versus tree model** — binding gives you compile-time types and IDE completion at the cost of a class per document shape; the tree model needs no classes but defers every mistake to runtime, where a typo in a field name is a `NullPointerException` rather than a compile error:

```java
record Point(int x, int y) {}
mapper.readValue(json, Point.class).ex();   // compile error: no such method
mapper.readTree(json).get("ex").asInt();    // compiles; NPE at runtime
```

- **Strict by default** — an unmodelled JSON field is a hard failure, which catches real schema drift early but breaks the moment a provider adds a field. Loosening it is one line, and forgetting to loosen it is a classic production incident:

```java
mapper.readValue("{\"x\":1,\"y\":2,\"z\":3}", Point.class);
// UnrecognizedPropertyException: Unrecognized field "z"
```

- **JSON has one number type** — floating-point values bind to `double` by default, so decimal amounts are stored as the nearest binary approximation. If the value is money, opt into `BigDecimal`:

```java
String json = "{\"amount\":1.00000000000000000001}";

mapper.readTree(json).get("amount").getClass();   // DoubleNode
mapper.readTree(json).get("amount").asText();     // "1.0" — the extra digits are gone

var exact = JsonMapper.builder()
        .enable(DeserializationFeature.USE_BIG_DECIMAL_FOR_FLOATS)
        .build();
exact.readTree(json).get("amount").getClass();    // DecimalNode
exact.readTree(json).get("amount").asText();      // "1.00000000000000000001"
```

- **Binding runs on reflection** — Jackson reaches into your types at runtime, which is invisible on a classpath but not under the module system or a GraalVM native image: a strong module must open its model packages, or construction fails:

```java
module com.example.app {
    requires com.fasterxml.jackson.databind;
    opens com.example.app.model to com.fasterxml.jackson.databind;
}
```

- **Streaming trades ergonomics for scale** — `JsonParser` is a few kilobytes of memory for any document size and the fastest option available, but the code is a state machine: forward-only, no random access, nesting depth tracked by hand, and a refactor away from unreadable. Reach for it when the document doesn't fit in heap or a profiler points at binding, not by default.
- **Jackson 2 and 3 coexist, which is a feature and a hazard** — the renamed packages let both majors live on one classpath during a migration, but nothing stops half a codebase from importing each, and the types do not interoperate. Two `JsonNode` classes with the same simple name produce error messages that read like nonsense until you notice the package.
- **No standard means no portability of idioms** — JSON handling in Java is a library choice with no platform default, so knowledge does not transfer cleanly between codebases (Jackson annotations, Gson's `@SerializedName`, JSON-B's `@JsonbProperty` all solve the same problem differently). JEP 540 narrows this only for the simplest cases; it does not give the ecosystem a common binding API.

## Documentation Links

- [Jackson databind — FasterXML/jackson-databind](https://github.com/FasterXML/jackson-databind) — doc
- [Migrating to Jackson 3 — FasterXML](https://github.com/FasterXML/jackson/blob/main/jackson3/MIGRATING_TO_JACKSON_3.md) — doc
- [Jackson Releases (version and LTS status) — FasterXML wiki](https://github.com/FasterXML/jackson/wiki/Jackson-Releases) — doc
- [JEP 540: Simple JSON API (Incubator) — OpenJDK](https://openjdk.org/jeps/540) — doc
- [RFC 6901: JavaScript Object Notation (JSON) Pointer — IETF](https://datatracker.ietf.org/doc/html/rfc6901) — doc
- [RFC 8259: The JavaScript Object Notation (JSON) Data Interchange Format — IETF](https://datatracker.ietf.org/doc/html/rfc8259) — doc
- [Gson user guide — Google](https://github.com/google/gson/blob/main/UserGuide.md) — doc
- [JSON support in Spring Boot — Spring reference](https://docs.spring.io/spring-boot/reference/features/json.html) — doc
- [JSON-Java (org.json) — GitHub](https://github.com/stleary/JSON-java) — doc
- [Java SE 25 API — java.base has no JSON package](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/module-summary.html) — doc
