---
version: 1.0
updatedAt: 2026-07-30
---
## Objective

Spring MVC splits a web request into three pieces: a domain class that models the
data, a `@Controller` that decides what happens for a given HTTP method and path,
and a view that renders the result. A `@GetMapping` handler builds a `Model` and
hands it to a view; a `@PostMapping` handler receives a plain Java object whose
fields Spring has already filled in from the submitted form, with no explicit binding
code required.

## Use Cases

- A form-backed page (like a signup or checkout page) where a `GET` renders the
  empty form and a `POST` on the same path processes the submission.
- Any controller that needs to funnel several related HTTP methods (`GET`, `POST`,
  `PUT`, `DELETE`) under one base path via a class-level `@RequestMapping`.
- Multi-step flows where one handler's `POST` redirects the browser to a different
  controller's `GET` (`redirect:/orders/current`), instead of returning a view directly.

## Deep Dive

### Domain classes with Lombok

A domain class only needs to declare its fields; Lombok generates the getters,
setters, `equals()`, `hashCode()`, and `toString()` at compile time.

```java
@Data
@RequiredArgsConstructor
public class Ingredient {
    private final String id;
    private final String name;
    private final Type type;

    public enum Type { WRAP, PROTEIN, VEGGIES, CHEESE, SAUCE }
}
```

`@Data` covers accessors and `equals`/`hashCode`/`toString`; `@RequiredArgsConstructor`
adds a constructor for the `final` fields. A mutable domain class used purely to carry
form data (no `final` fields) only needs `@Data`:

```java
@Data
public class Taco {
    private String name;
    private List<String> ingredients;
}
```

### Controller class and request-mapping annotations

A class-level `@RequestMapping` sets the base path; method-level `@GetMapping` /
`@PostMapping` narrow it to a specific HTTP method.

```java
@Controller
@RequestMapping("/design")
public class DesignTacoController {

    @GetMapping
    public String showDesignForm(Model model) {
        List<Ingredient> ingredients = /* ... */;
        for (Ingredient.Type type : Ingredient.Type.values()) {
            model.addAttribute(type.toString().toLowerCase(),
                filterByType(ingredients, type));
        }
        model.addAttribute("design", new Taco());
        return "design";
    }
}
```

`Model` is the handoff object: attributes added here are copied into request
attributes the view template reads. The method's return value ("design") is the
logical view name, not a path — Spring resolves it to an actual template.

### Binding form submissions to a command object

A `@PostMapping` handler can take a plain domain object as a parameter. Spring MVC
binds each submitted form field to the matching property on that object — no
`@ModelAttribute` annotation and no manual `request.getParameter(...)` calls:

```java
@PostMapping
public String processDesign(Taco design) {
    log.info("Processing design: " + design);
    return "redirect:/orders/current";
}
```

This works because `Taco` isn't a simple value type (`String`, `int`, ...) and no
other argument resolver claims it, so Spring treats it as an implicit
`@ModelAttribute` and runs its data-binding machinery against the request
parameters.

### Redirect views

Returning a view name prefixed with `redirect:` tells Spring to issue an HTTP
redirect instead of rendering a template — the browser makes a fresh `GET` request
to the target path:

```java
@PostMapping
public String processOrder(Order order) {
    log.info("Order submitted: " + order);
    return "redirect:/";
}
```

This is what connects `processDesign()` (which redirects to `/orders/current`) to a
separate `OrderController`'s `@GetMapping("/current")` handler — two controllers
composed through a redirect rather than one controller doing everything.

## Trade-offs

- **Lombok removes boilerplate but adds a build-time dependency.** Every developer
  and every IDE needs the Lombok annotation processor installed, or the project
  won't compile cleanly in their editor. For immutable, `final`-field classes like
  `Ingredient`, a Java `record` gets the same generated `equals`/`hashCode`/`toString`
  and constructor natively, with no annotation processor:
  ```java
  public record Ingredient(String id, String name, Type type) {
      public enum Type { WRAP, PROTEIN, VEGGIES, CHEESE, SAUCE }
  }
  ```
  This doesn't cover every case in the book — `Taco` and `Order` are mutable
  (Spring MVC data binding sets their fields via setters after construction), so
  they stay as `@Data` classes; only `final`-field, constructor-built domain types
  like `Ingredient` are drop-in record candidates.
- **Implicit command-object binding is concise but non-obvious at a glance.** A
  reader has to know Spring's argument-resolution rule (non-simple-type parameter,
  no other resolver claims it → implicit `@ModelAttribute`) to see that
  `processDesign(Taco design)` is binding request parameters at all — there's no
  annotation to grep for. Spring's own docs now recommend adding `@ModelAttribute`
  explicitly for GraalVM native-image builds, since implicit binding can't be
  inferred for AOT reflection hints.
- **Class-level `@RequestMapping` plus method-level `@GetMapping`/`@PostMapping`
  keeps route declarations DRY, but the full path for any one handler is split
  across two annotations** — reading `showDesignForm()` in isolation doesn't tell
  you it handles `GET /design` without also checking the class declaration.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 2,
  "Developing web applications", sections 2.1 "Displaying information" and 2.2
  "Processing form submission", p. 29-44 — doc
- [Spring Framework Reference — Mapping Requests (@GetMapping, @PostMapping)](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-requestmapping.html) — doc
- [Spring Framework Reference — @ModelAttribute Method Arguments (implicit binding, GraalVM note)](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-methods/modelattrib-method-args.html) — doc
- [Spring Data JPA Reference — Class-based Projections/DTOs (records as a Lombok alternative)](https://docs.spring.io/spring-data/jpa/reference/repositories/projections.html) — doc
- [Spring Boot 3.0 Migration Guide — javax → jakarta package rename](https://github.com/spring-projects/spring-boot/wiki/Spring-Boot-3.0-Migration-Guide) — doc
