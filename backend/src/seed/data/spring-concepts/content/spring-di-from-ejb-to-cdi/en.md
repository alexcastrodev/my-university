---
version: 1.0
updatedAt: 2026-08-05
---
## Objective

`@Autowired` and `@Inject` do the same thing — that's not a coincidence, it's the end of a lineage. Dependency injection in enterprise Java didn't start as a Spring feature: it grew out of EJB's container-managed components in the late 1990s, matured into a formal, framework-independent specification (Jakarta CDI — Contexts and Dependency Injection), and today Spring, Quarkus, and every serious Jakarta EE server implement (or interoperate with) the same underlying concepts: beans, bean types, qualifiers, and scopes. Understanding CDI as the shared vocabulary — not a Spring-specific idea — explains why `@Inject`/`@Autowired`, `@Named`/`@Component`, and `@Qualifier` exist side by side and mean almost the same thing.

## Use Cases

- Reading unfamiliar Jakarta EE / Quarkus code that uses `@Inject`/`@ApplicationScoped`/`@Singleton` and recognizing it as the same mental model as Spring's `@Autowired`/`@Component`/singleton beans, just spelled differently.
- Disambiguating multiple implementations of the same interface with a qualifier (`@Qualifier`/custom annotation in CDI, `@Qualifier`/`@Primary` in Spring) instead of falling back to string-based bean names.
- Deciding whether a component's dependencies should be resolved eagerly at startup (fail-fast, higher memory/startup cost) or lazily on first use (faster startup, defers failures) — a real architectural choice, not just a framework default to accept blindly.
- Writing portable DI code (`jakarta.inject.@Inject`/`@Named`/`@Singleton`) when a codebase might need to run on more than one container, instead of committing to framework-proprietary annotations everywhere.

## Deep Dive

### Where DI came from: EJB and the deployment descriptor

Before annotations, Java EE dependency management was declared entirely in XML. An EJB's type, transaction behavior, and security role lived in `ejb-jar.xml`, separate from the Java source:

```xml
<ejb-jar>
  <enterprise-beans>
    <session>
      <ejb-name>OrderService</ejb-name>
      <ejb-class>com.company.ejb.OrderServiceBean</ejb-class>
      <session-type>Stateless</session-type>
      <transaction-type>Container</transaction-type>
    </session>
  </enterprise-beans>
</ejb-jar>
```

The EJB container handled instantiation, lifecycle, transactions, and security for the developer — an early, working implementation of Inversion of Control — but every small change meant editing XML, recompiling, and redeploying. Java EE 5 (2006) replaced this with annotations directly on the class:

```java
@Stateless
public class OrderServiceBean {
    @PersistenceContext
    private EntityManager em;

    public void processOrder(Order order) {
        em.persist(order);
    }
}
```

Same behavior, no external file — the container reads `@Stateless` and `@PersistenceContext` directly off the class at deploy time.

### CDI: dependency injection as a specification, not a framework feature

Jakarta CDI formalizes what "the container resolves your dependencies" means, independent of who implements it. Its core vocabulary:

- **Bean** — any class the container manages (instantiates, tracks the lifecycle of, injects where needed).
- **Bean Type** — every type a bean can be injected as (its interfaces, superclasses, and itself).
- **Qualifier** — an annotation that disambiguates between multiple beans of the same type.
- **Scope** — how long a bean instance lives (`@ApplicationScoped`, `@RequestScoped`, `@Dependent`, ...).

```java
public interface PaymentProcessor {
    void process(Payment payment);
}

@ApplicationScoped
public class PaypalProcessor implements PaymentProcessor { /* ... */ }

@Inject
PaymentProcessor processor;  // container resolves this to a PaypalProcessor instance
```

The consuming code never names the concrete class — it declares the abstraction it needs, and the container supplies an instance. When more than one implementation exists, a `@Qualifier`-annotated annotation disambiguates:

```java
@Qualifier
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.TYPE, ElementType.METHOD})
public @interface Paypal {}

@Paypal @ApplicationScoped
public class PaypalProcessor implements PaymentProcessor { /* ... */ }

@Inject @Paypal
PaymentProcessor processor;   // now unambiguous
```

### Spring and Quarkus: two different relationships to the same spec

Spring predates CDI's standardization — it built its own IoC container and its own annotations (`@Autowired`, `@Component`, `@Service`, `@Repository`) before CDI existed. Rather than staying isolated, Spring later added support for the equivalent JSR-330 (`jakarta.inject`) annotations, so both styles work today and are functionally equivalent inside an `ApplicationContext`:

```java
// Spring's own annotation
@Autowired
private PaymentProcessor processor;

// The CDI/JSR-330 equivalent — resolves the same way
@Inject
private PaymentProcessor processor;
```

Quarkus took the opposite path: it was built from the start inside the Jakarta EE era and implements CDI directly via its own container implementation, Arc, optimized for fast startup and low memory rather than for the classic application-server profile. Quarkus code using `@Inject`/`@ApplicationScoped`/`@Singleton` is, by design, portable to any compliant CDI container (Payara, WildFly, TomEE) with little or no change — Spring's compatibility is closer, more pragmatic add-on support than native implementation.

### Eager vs. lazy bean instantiation

The two frameworks also default to opposite instantiation strategies for singleton-scoped beans, and it's a deliberate trade-off, not an accident:

- **Spring**: eager by default — the `ApplicationContext` instantiates every singleton bean at startup. Configuration errors (a missing implementation, an unsatisfiable dependency) surface immediately at boot instead of at request time, at the cost of longer startup and more memory used upfront regardless of whether every bean is ever used.
- **Quarkus (dev/lazy mode)**: defers instantiation until a bean is first actually needed. Startup is faster and memory usage lower, but a broken dependency graph might not be discovered until the code path that needs it actually runs.

## Trade-offs

- **`@Inject` (JSR-330) is a strict subset of `@Autowired`'s behavior** — `@Inject` has no `required` attribute; an unsatisfiable dependency always fails. To express "inject if present, otherwise skip," `@Autowired(required = false)` has a direct one-line answer, while the `@Inject` equivalent means wrapping the dependency in `Optional<T>` or annotating it `@Nullable`.
```java
@Autowired(required = false)
private PaymentProcessor optionalProcessor;   // no equivalent one-liner in plain @Inject
```
- **`@Named` isn't composable the way `@Component` is** — Spring lets you build custom stereotype annotations on top of `@Component` (e.g. a project-specific `@RestService` meta-annotated with `@Component`); `@Named` doesn't support that pattern, so teams standardizing purely on JSR-330 annotations lose that extensibility.
- **JSR-330's default scope is prototype, Spring's is singleton** — a bean annotated `@Named` with no explicit scope behaves differently under strict JSR-330 semantics (a new instance per injection) than the same class annotated `@Component` (one shared singleton) unless the scope is stated explicitly — a subtle source of bugs when mixing both annotation styles in one codebase.
- **Eager instantiation trades startup cost for earlier failure detection** — Spring's default catches a broken dependency graph at boot (arguably safer for production), while Quarkus's lazy default favors fast iteration in dev mode; neither is universally "correct," and the choice should match the deployment context (a long-lived server vs. a fast-scaling serverless function).
- **Book vs. today**: the source material for this concept cites "Jakarta CDI 4.0." The current released spec is **CDI 4.1**, shipping with **Jakarta EE 11**; **CDI 5.0** is already in development for the upcoming Jakarta EE 12. None of the concepts described here (Bean Types, Qualifiers, Scopes) changed between 4.0 and 4.1 — this is a version-number correction, not a behavioral one.

## Documentation Links

- [Jakarta Contexts and Dependency Injection (CDI) — specification page](https://jakarta.ee/specifications/cdi/) — doc
- [Spring Framework Reference — Using JSR 330 Standard Annotations](https://docs.spring.io/spring-framework/reference/core/beans/standard-annotations.html) — doc
- [Spring Framework Reference — Autowiring Collaborators (@Autowired)](https://docs.spring.io/spring-framework/reference/core/beans/annotation-config/autowired.html) — doc
- [Quarkus — Introduction to Contexts and Dependency Injection (Arc)](https://quarkus.io/guides/cdi) — doc
