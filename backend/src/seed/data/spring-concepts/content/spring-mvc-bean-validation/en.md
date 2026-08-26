---
version: 1.0
updatedAt: 2026-07-31
---
## Objective

Letting invalid data reach a controller's business logic means every handler method
ends up littered with `if`/`then` checks that are tedious to write and easy to get
wrong. The Bean Validation API (JSR-303, now part of Jakarta EE) lets you declare
validation rules directly on a domain class's fields with annotations, then have
Spring MVC enforce them automatically at form-binding time — so a handler method
only has to ask "were there errors?" instead of re-deriving what "valid" means.

## Use Cases

- Rejecting a submitted order whose name, street, city, state, or ZIP is blank,
  without hand-writing a blank check for every field.
- Validating a credit card number's format (`@CreditCardNumber`, a Luhn-algorithm
  check), an expiration date's `MM/YY` shape (`@Pattern`), and a CVV's digit count
  (`@Digits`) declaratively instead of with custom parsing code.
- Re-displaying the same form with per-field error messages when validation fails,
  instead of a generic "something went wrong" page.

## Deep Dive

### Declaring validation rules on the domain class

Annotations from `jakarta.validation.constraints` (the core Bean Validation API) and
`org.hibernate.validator.constraints` (Hibernate Validator's extensions) go directly
on the fields being validated:

```java
public class Taco {

    @NotNull
    @Size(min = 5, message = "Name must be at least 5 characters long")
    private String name;

    @Size(min = 1, message = "You must choose at least 1 ingredient")
    private List<String> ingredients;
}
```

```java
public class Order {

    @NotBlank(message = "Name is required")
    private String name;

    @NotBlank(message = "Street is required")
    private String street;

    @CreditCardNumber(message = "Not a valid credit card number")
    private String ccNumber;

    @Pattern(regexp = "^(0[1-9]|1[0-2])([\\/])([1-9][0-9])$",
             message = "Must be formatted MM/YY")
    private String ccExpiration;

    @Digits(integer = 3, fraction = 0, message = "Invalid CVV")
    private String ccCVV;
}
```

Every constraint annotation carries a `message` attribute for the text shown to the
user when that specific rule fails — `@CreditCardNumber` runs a Luhn check (catches
typos and malformed input, not whether the card is actually chargeable), while
`@Pattern` covers formats (like `MM/YY`) that don't have a purpose-built annotation.

### Enforcing validation at form binding: `@Valid` + `Errors`

Adding `@Valid` to a handler's bound argument tells Spring MVC to run validation
right after binding the submitted form data and before the method body executes;
the outcome lands in an `Errors` (or `BindingResult`, which extends it) parameter
that must immediately follow the validated argument:

```java
@PostMapping
public String processOrder(@Valid Order order, Errors errors) {
    if (errors.hasErrors()) {
        return "orderForm";
    }
    return "redirect:/";
}
```

If `errors.hasErrors()` is true, the method returns the form's view name again
instead of processing the (invalid) data — the same pattern applies to any other
`@Valid`-annotated command object, such as the `Taco` bound in a separate handler.

### Records and validation: declarative annotations vs. the compact constructor

A record can carry the same constraint annotations a class does:

```java
public record ReviewRequest(@NotNull @Min(1) @Max(5) Integer rating,
                             @NotBlank String comment) {}
```

Since Java 16, an annotation on a record component is copied onto every applicable
target — the private field, the accessor method, and the canonical constructor's
parameter — so this compiles and looks identical in spirit to the `Order`/`Taco`
examples above. But it behaves completely differently unless something actively
validates it:

```java
new ReviewRequest(-5, null);   // compiles, runs, throws nothing at all
```

`@NotNull`/`@Min`/`@Max` are inert metadata — nothing reads them unless a
`Validator` is invoked over the object. `@Valid` on a controller argument is
exactly that invocation, which is why this only "works" inside a Spring MVC
handler: outside one (a `new` call in a service, a test, a message consumer), the
annotations do nothing at all.

A record's own **compact constructor** is a different mechanism entirely — real,
imperative code that runs unconditionally on every construction path, with no
framework involved:

```java
public record ReviewRequest(Integer rating, String comment) {
    ReviewRequest {
        if (rating == null || rating < 1 || rating > 5) {
            throw new IllegalArgumentException("rating must be between 1 and 5");
        }
    }
}
```

This throws immediately on `new ReviewRequest(-5, null)`, with no `@Valid` and no
Spring context required — see `records-and-sealed-types` for why this runs on
every construction path, including deserialization. The two aren't competing
solutions to the same problem: a compact constructor is the right place for an
invariant that must hold *no matter how* the object was built, while `@Valid` +
constraint annotations exist specifically for the HTTP-boundary case, where
Spring MVC collects every violation at once and hands the view a `BindingResult`
with a message per field — something a single thrown exception from a
constructor can't produce, since it stops at the first failing check.

### Surfacing field-level errors on re-display

Once the controller redirects back to the form view on failure, the view layer
reads the same `Errors`/`BindingResult` object to render per-field messages next to
the offending inputs (Thymeleaf's `#fields.hasErrors('fieldName')` and `th:errors`
are one way to do this, but the binding/validation mechanics above are
template-library-agnostic).

## Trade-offs

- **Declarative validation trades flexibility for readability.** A `@Pattern` regex
  or a chain of built-in annotations covers most shapes, but a rule spanning
  multiple fields (e.g., "if payment type is credit card, then `ccNumber` is
  required") needs a custom class-level constraint or a `Validator` bean —
  Bean Validation isn't a full replacement for business-rule validation.
- **The `Errors`/`BindingResult` parameter must come immediately after the
  `@Valid` argument it corresponds to** — Spring MVC resolves it positionally, so
  reordering method parameters silently breaks error capture instead of failing
  loudly at startup.
- **Constraint annotations validate nothing by themselves.** They're declarative
  metadata a `Validator` has to actively read — `@Valid` is one trigger, but the
  same class (or record) can be constructed anywhere else in the codebase, fully
  invalid, with zero enforcement. A compact constructor's validation, by contrast,
  is unconditional at the type level. Reach for constraint annotations for
  request-boundary rules that need field-level error reporting; reach for a
  compact constructor for an invariant the type itself should never be able to
  violate.
- **Book vs. today:** this book (2019) says the Validation API and Hibernate's
  implementation ship transitively with Spring Boot's web starter — true at the
  time, but as of **Spring Boot 2.3** those dependencies were removed from
  `spring-boot-starter-web`. Today you must add `spring-boot-starter-validation`
  explicitly, and the annotations themselves live under `jakarta.validation.*`
  rather than `javax.validation.*` since the Jakarta EE namespace migration in
  Spring Boot 3.0.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 2, "Developing web applications", section 2.3, "Validating form input", p. 45-50 — doc
- [Spring Framework Reference — Java Bean Validation](https://docs.spring.io/spring-framework/reference/core/validation/beanvalidation.html) — doc
- [Spring Boot Reference — Validation (spring-boot-starter-validation)](https://docs.spring.io/spring-boot/reference/io/validation.html) — doc
- [Jakarta Bean Validation 3.0 Specification](https://jakarta.ee/specifications/bean-validation/3.0/) — doc
- [Hibernate Validator Documentation](https://hibernate.org/validator/documentation/) — doc
