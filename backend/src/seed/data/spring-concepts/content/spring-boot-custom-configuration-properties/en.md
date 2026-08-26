---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

Spring Boot's own beans (`DataSource`, the embedded server, the logging system)
aren't the only things that can read from the environment abstraction — any bean's
properties can, once it's annotated with `@ConfigurationProperties`. That turns a
hardcoded value (a page size, a limit, a feature flag) into something changeable
without a rebuild, and — once the property is pulled out of the class that uses it
and into a dedicated holder bean — something reusable and independently
validatable too.

## Use Cases

- Replacing a hardcoded constant (page size, a retry count, a timeout) with a
  value that can be changed per environment via `application.yml`, an environment
  variable, or a command-line argument, with no rebuild required.
- Collecting several related configuration values that multiple beans need
  (page size, a display limit, a feature toggle) into one dedicated holder class
  instead of duplicating `@ConfigurationProperties` across every bean that needs
  one of them.
- Applying validation (a minimum/maximum, a required value) to a configuration
  value in exactly one place, instead of repeating validation annotations on
  every bean that happens to use that property.
- Getting IDE autocompletion and hover documentation for a custom property, the
  same experience Spring's own built-in properties already provide.

## Deep Dive

### Turning a hardcoded value into a configuration property

Given a controller with a hardcoded page size for a paginated order list:

```java
@GetMapping
public String ordersForUser(
    @AuthenticationPrincipal User user, Model model) {

    Pageable pageable = PageRequest.of(0, 20);
    model.addAttribute("orders",
        orderRepo.findByUserOrderByPlacedAtDesc(user, pageable));

    return "orderList";
}
```

`@ConfigurationProperties` on the controller itself turns the hardcoded `20`
into a configurable field, bound from any property under the given `prefix`:

```java
@Controller
@RequestMapping("/orders")
@SessionAttributes("order")
@ConfigurationProperties(prefix = "taco.orders")
public class OrderController {

    private int pageSize = 20;

    public void setPageSize(int pageSize) {
        this.pageSize = pageSize;
    }

    @GetMapping
    public String ordersForUser(
        @AuthenticationPrincipal User user, Model model) {

        Pageable pageable = PageRequest.of(0, pageSize);
        model.addAttribute("orders",
            orderRepo.findByUserOrderByPlacedAtDesc(user, pageable));

        return "orderList";
    }
}
```

The `prefix` means the property is set as `taco.orders.pageSize` — in YAML,
as an environment variable, or as a command-line argument, exactly like any
Spring Boot built-in property:

```yaml
taco:
  orders:
    pageSize: 10
```

```bash
$ export TACO_ORDERS_PAGESIZE=10
```

### Extracting a dedicated configuration properties holder

Putting `@ConfigurationProperties` directly on `OrderController` works, but
mixes configuration concerns into a class whose job is handling HTTP requests.
A holder bean — a class whose entire purpose is carrying configuration data —
keeps that separation and makes the properties reusable by any other bean that
needs them:

```java
@Component
@ConfigurationProperties(prefix = "taco.orders")
@Data
public class OrderProps {

    private int pageSize = 20;
}
```

`@Component` lets Spring's component scanning discover and register it as a
bean; `@Data` (Lombok) generates the getter/setter pair `@ConfigurationProperties`
binds through. `OrderController` then depends on `OrderProps` instead of owning
the property itself:

```java
@Controller
@RequestMapping("/orders")
@SessionAttributes("order")
public class OrderController {

    private OrderRepository orderRepo;
    private OrderProps props;

    public OrderController(OrderRepository orderRepo, OrderProps props) {
        this.orderRepo = orderRepo;
        this.props = props;
    }

    @GetMapping
    public String ordersForUser(
        @AuthenticationPrincipal User user, Model model) {

        Pageable pageable = PageRequest.of(0, props.getPageSize());
        model.addAttribute("orders",
            orderRepo.findByUserOrderByPlacedAtDesc(user, pageable));

        return "orderList";
    }
}
```

### Validating a configuration property in one place

Because the property now lives in exactly one class, adding validation means
touching only `OrderProps` — not every bean that happens to use `pageSize`:

```java
@Component
@ConfigurationProperties(prefix = "taco.orders")
@Data
@Validated
public class OrderProps {

    @Min(value = 5, message = "must be between 5 and 25")
    @Max(value = 25, message = "must be between 5 and 25")
    private int pageSize = 20;
}
```

`@Validated` triggers Bean Validation on the bound properties at startup — an
out-of-range value fails fast, before the application finishes starting,
instead of surfacing later as unexpected pagination behavior.

### Documenting custom properties with IDE metadata

A custom property like `taco.orders.pageSize` has no built-in description the
way Spring's own properties do, which shows up as an "Unknown Property"
warning in an IDE that understands Spring configuration metadata. A JSON file
at `src/main/resources/META-INF/additional-spring-configuration-metadata.json`
fills that gap:

```json
{
  "properties": [
    {
      "name": "taco.orders.page-size",
      "type": "java.lang.String",
      "description": "Sets the maximum number of orders to display in a list."
    }
  ]
}
```

The metadata uses the kebab-case form `taco.orders.page-size` — Spring Boot's
relaxed property binding treats it as equivalent to `taco.orders.pageSize`.
With the metadata in place, the property gets IDE hover documentation and
autocompletion just like a framework-provided one; the metadata is purely
tooling sugar and has no effect on whether the property actually binds.

## Trade-offs

- **`@ConfigurationProperties` directly on a controller (or any bean that
  already does something else) works, but mixes two responsibilities into one
  class.** Extracting a dedicated holder costs one more class but means the
  controller no longer needs to know it's also a configuration target, and the
  same holder becomes reusable by any other bean that needs the same values.
- **Centralizing a property in a holder bean makes validation, renaming, or
  removal a one-place change instead of a search-and-replace across every
  consumer.** The book's own example — adding `@Min`/`@Max` — would otherwise
  need repeating on every bean that read `pageSize` directly.
- **Configuration metadata is pure documentation, not enforcement** — skipping
  the `additional-spring-configuration-metadata.json` file doesn't break
  anything; it only means the IDE can't show a description or offer
  autocompletion for that specific property, and shows an "unknown property"
  warning that's cosmetic, not a real error.
- **Book vs. today: `@Component`-based discovery is no longer the recommended
  registration path for `@ConfigurationProperties` classes.** The book relies
  on `@Component` plus classpath component scanning to find `OrderProps`.
  Today's official Spring Boot reference recommends `@ConfigurationPropertiesScan`
  (typically on the `@SpringBootApplication` class) or explicit
  `@EnableConfigurationProperties(OrderProps.class)` instead — and is explicit
  that `@Component` should only be used when the properties bean *also* needs
  other beans injected via its constructor, since `@Component`-discovered
  configuration-properties beans use plain JavaBean-style property binding,
  not the newer constructor binding described next. Confirmed via the current
  Spring Boot reference:
  ```java
  @SpringBootApplication
  @ConfigurationPropertiesScan
  public class TacoCloudApplication { }
  ```
- **Book vs. today: records are now a first-class, immutable alternative to a
  mutable Lombok `@Data` holder class.** Since Spring Boot 2.6 (with Java 16+),
  a record can be annotated `@ConfigurationProperties` directly, bound via
  constructor binding instead of setters — and unless the record has more than
  one constructor, `@ConstructorBinding` isn't even needed. This wasn't
  possible when the book published (records themselves didn't exist as a
  finalized Java feature until Java 16, 2021), but it directly addresses the
  book's own `OrderProps` design, which needs Lombok specifically to avoid
  hand-writing getters/setters for what is conceptually an immutable value:
  ```java
  @ConfigurationProperties(prefix = "taco.orders")
  public record OrderProps(int pageSize) { }
  ```
  Constructor-bound classes (including records) must be registered via
  `@ConfigurationPropertiesScan` or `@EnableConfigurationProperties` — they
  cannot be `@Component`-discovered, confirmed via the current reference.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 5, "Working with configuration properties", section 5.2, p. 122-129 — doc
- [Spring Boot Reference — Externalized Configuration (Type-safe Configuration Properties)](https://docs.spring.io/spring-boot/reference/features/external-config.html) — doc
- [Spring Boot Reference — Configuration Metadata (Generating Your Own Metadata via the Annotation Processor)](https://docs.spring.io/spring-boot/specification/configuration-metadata/annotation-processor.html) — doc
- [Spring Boot API — ConfigurationPropertiesScan](https://docs.spring.io/spring-boot/api/java/org/springframework/boot/context/properties/ConfigurationPropertiesScan.html) — doc
