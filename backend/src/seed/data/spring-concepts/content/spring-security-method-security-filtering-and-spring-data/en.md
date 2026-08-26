---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

`@PreAuthorize` and `@PostAuthorize` answer a yes/no question about a whole
call: this caller may invoke this method, or they get an
`AccessDeniedException`. Filtering answers a narrower question about the
*data* flowing through the call: of the elements in this collection, which
ones is the current principal allowed to touch? `@PreFilter` trims the
collection a caller passes *in* before the method body ever sees it;
`@PostFilter` trims the collection the method hands *back* before the caller
sees it. Neither ever denies the call — the method still runs, it just runs
on (or returns) a smaller collection. The result is that a service method
carries its own data-scoping rule as an aspect, instead of every caller
having to remember to apply it.

## Use Cases

- A `sellProducts(List<Product>)` service method that must only ever act on
  products owned by the authenticated user, no matter which controller,
  scheduler, or other service calls it — the ownership rule lives on the
  method, not in each caller.
- A `findProducts()` method whose returned list must be narrowed to the
  caller's own rows before it reaches the frontend, without the method body
  itself knowing anything about who is logged in.
- Any "multi-tenant by row" shape: the same query is correct for every user,
  but each user is entitled to a different subset of the result.
- Pushing that same ownership predicate down into a Spring Data `@Query`, so
  the database returns only the rows the principal may see — the version of
  the rule that actually survives large tables and pagination.

## Deep Dive

### `@PreFilter`: trimming a collection argument

`@PreFilter` takes a SpEL expression evaluated once per element of a
collection parameter. `filterObject` refers to the element under evaluation;
`authentication` refers to the `Authentication` in the security context.
Elements for which the expression is `false` are removed before the method
body runs.

```java
@Service
public class ProductService {

    @PreFilter("filterObject.owner == authentication.name")
    public List<Product> sellProducts(List<Product> products) {
        // `products` here contains only items owned by the caller
        return products;
    }
}
```

With three products — `beer`/`nikolai`, `candy`/`nikolai`,
`chocolate`/`julien` — passed in, `curl -u nikolai:12345 .../sell` returns
only the two Nikolai items, and `curl -u julien:12345 .../sell` returns only
`chocolate`. The method body did nothing to make that happen.

`filterObject` is typed as the element type, not the collection: with a
`List<Product>`, `filterObject` *is* a `Product`, so `filterObject.owner`
resolves against the entity. For a `Map` parameter the element is a map
entry, so the expression reaches through `value`:

```java
@PreFilter("filterObject.value.owner == authentication.name")
public Collection<Account> updateAccounts(Map<String, Account> accounts) { ... }
```

If a method has more than one collection parameter, SpEL cannot guess which
one to filter; the `filterTarget` attribute names it:

```java
@PreFilter(value = "filterObject.owner == authentication.name",
           filterTarget = "products")
public void reconcile(List<Product> products, List<Audit> auditTrail) { ... }
```

### The mutable-collection trap

The filtering aspect does not build a new collection — it *mutates the one
you gave it*, removing the elements that failed the expression. The instance
the method body receives is the same instance the caller constructed. That
makes an immutable collection a runtime failure, not a no-op:

```java
@GetMapping("/sell")
public List<Product> sellProduct() {
    List<Product> products = List.of(          // immutable!
            new Product("beer", "nikolai"),
            new Product("candy", "nikolai"),
            new Product("chocolate", "julien"));

    return productService.sellProducts(products);
}
```

```
java.lang.UnsupportedOperationException: null
  at java.base/java.util.ImmutableCollections.uoe(ImmutableCollections.java:73)
```

The endpoint answers `500 Internal Server Error`. Swapping `List.of(...)` for
`new ArrayList<>(...)` fixes it. This is not a legacy quirk that has since
been smoothed over: `DefaultMethodSecurityExpressionHandler.filter()` still
mutates the target collection in current versions, and the same failure is a
standing complaint from Kotlin users whose default `listOf`/`mapOf` types are
immutable. Callers of a `@PreFilter`-annotated method have to know to hand it
a mutable collection — a small but real leak of the aspect into the calling
code.

### `@PostFilter`: trimming the return value

`@PostFilter` is the mirror image — the method runs unimpeded, and the aspect
filters the collection it returned:

```java
@Service
public class ProductService {

    @PostFilter("filterObject.owner == authentication.name")
    public List<Product> findProducts() {
        List<Product> products = new ArrayList<>();
        products.add(new Product("beer", "nikolai"));
        products.add(new Product("candy", "nikolai"));
        products.add(new Product("chocolate", "julien"));
        return products;
    }
}
```

The distinction from `@PostAuthorize` matters and is easy to blur.
`@PostAuthorize` inspects `returnObject` and, if the rule fails, throws —
the caller gets nothing at all. `@PostFilter` never throws on a rule
mismatch; the caller always gets a collection, possibly an empty one, with
the disallowed elements silently removed. "Deny the call" versus "narrow the
data" are genuinely different tools, and picking the wrong one produces
either a spurious `403` or a silently truncated result.

Both annotations only work on collections and arrays (plus `Map` and `Stream`
in current versions). Putting `@PostFilter` on a method returning a single
`Product` is a configuration mistake, not a filter that happens to match
everything.

### Filtering in a Spring Data repository — and why `@PostFilter` is the wrong answer there

The annotations work on repository interface methods exactly as they do on
service methods:

```java
public interface ProductRepository extends JpaRepository<Product, Integer> {

    @PostFilter("filterObject.owner == authentication.name")
    List<Product> findProductByNameContains(String text);
}
```

This behaves correctly — searching `c` as Nikolai returns only `candy`, even
though `chocolate` also matches the text — and it is still a poor design. The
database returns *every* matching row for *every* owner, the whole result set
is materialized in the JVM heap, and only then are the unauthorized rows
dropped. On a `findAll()` over a large table that is a direct route to an
`OutOfMemoryError`; short of that it is simply slower than fetching only what
was needed. And it breaks pagination outright: a `Page` of 20 rows filtered
down to 3 is not a page of 3 — the page metadata is a lie and the pagination
arithmetic no longer works.

The fix is to put the principal into the query, so the filtering happens in
the database. Two steps. First, expose a `SecurityEvaluationContextExtension`
bean, which makes Spring Security's expressions resolvable inside Spring Data
query SpEL:

```java
@Configuration
@EnableMethodSecurity
public class ProjectConfig {

    @Bean
    public SecurityEvaluationContextExtension securityEvaluationContextExtension() {
        return new SecurityEvaluationContextExtension();
    }
}
```

Then write the ownership condition into the `WHERE` clause using the
`?#{ ... }` SpEL parameter syntax:

```java
public interface ProductRepository extends JpaRepository<Product, Integer> {

    @Query("SELECT p FROM Product p " +
           "WHERE p.name LIKE %:text% AND p.owner = ?#{authentication.name}")
    List<Product> findProductByNameContains(String text);
}
```

The externally observable behavior is identical to the `@PostFilter` version;
the difference is that the database now returns three rows instead of three
hundred. `authentication` and `principal` are both available in the
expression, so `?#{principal?.id}` (the form the official docs use) works
equally well when the principal is a custom `UserDetails` carrying an id.

### Book vs. today: the annotations are unchanged, only the enabling annotation moved

The book enables filtering with
`@EnableGlobalMethodSecurity(prePostEnabled = true)`. That annotation is
deprecated; the current replacement is `@EnableMethodSecurity`, which enables
`@PreAuthorize`, `@PostAuthorize`, `@PreFilter`, and `@PostFilter` by default
(`prePostEnabled` defaults to `true`, so it need not be spelled out). The
companion concept
`spring-security-method-security-preauthorization-and-postauthorization`
covers that migration and its behavioral differences in depth — the point
worth confirming here is narrower: **`@PreFilter` and `@PostFilter`
themselves are unchanged.** Same package
(`org.springframework.security.access.prepost`), same `filterObject`
variable, same `filterTarget` attribute, same semantics, not deprecated.
Every filtering snippet in chapter 17 still compiles and behaves identically
once the enabling annotation is swapped:

```java
@Configuration
@EnableMethodSecurity      // was @EnableGlobalMethodSecurity(prePostEnabled = true)
public class ProjectConfig { }
```

Current versions have *widened* what the annotations accept — the reference
now documents `Map` and `Stream` targets and varargs alongside plain
collections and arrays, where the book only discusses collections and arrays.
That is added capability, not a correction.

### Book vs. today: the 17.3 repository technique is still the officially recommended one

This is the part most worth checking, because "put SpEL in a `@Query`" reads
like a 2020 workaround that a modern framework would have replaced with
something typed. It has not been. The current Spring Security reference has a
dedicated *Spring Data Integration* page describing exactly the book's two
steps — declare a `SecurityEvaluationContextExtension` bean, then reference
security expressions inside `@Query` — with the same rationale the book gives,
stated almost as directly:

> "This integration allows you to refer to the current user within your
> queries... necessary to support paged results since filtering results
> afterwards would not scale."

The matching caveat appears on the method-security page itself, attached to
both filter annotations: "In-memory filtering can obviously be expensive, and
so be considerate of whether it is better to filter the data in the data
layer instead" — with the phrase *filter the data in the data layer* linking
straight to that Spring Data integration page. So the book's chapter-17
narrative arc (show `@PostFilter` on a repository, then explain why you
should not ship it and move the predicate into the query) is the officially
documented recommendation today, not dated advice.

One genuine addition to make: the docs list
`org.springframework.security:spring-security-data` as a required dependency
for this integration. The book's `pom.xml` snippet shows only
`spring-boot-starter-security`, `spring-boot-starter-web`,
`spring-boot-starter-data-jpa`, and a JDBC driver. If
`SecurityEvaluationContextExtension` will not resolve, that missing artifact
is the first thing to check.

For genuinely complex, composable predicates, Spring Data's own
`Specification` / QueryDSL APIs are the idiomatic way to build the `WHERE`
clause — but note what that changes and what it does not: it changes *how you
express* the predicate, and you still have to source the principal yourself
(typically from `SecurityContextHolder`). Spring Security does not document a
`Specification`-based security integration as a replacement for the
`@Query` + `SecurityEvaluationContextExtension` route. Treat `Specification`
as the option for when the query itself is dynamic, not as the modern
successor to chapter 17.3.

## Trade-offs

- **Filtering decouples the data-scoping rule from the business logic, at
  the cost of making it invisible at the call site.** The upside is real: the
  ownership rule holds no matter who calls `sellProducts`, and the method
  body stays free of `SecurityContextHolder` lookups. The downside is that a
  caller reading `productService.sellProducts(products)` has no local signal
  that the list they passed is about to shrink underneath them.
- **`@PreFilter` mutating the caller's collection is a leaky abstraction.**
  ```java
  productService.sellProducts(List.of(a, b, c));   // UnsupportedOperationException
  ```
  An aspect that silently requires its argument to be mutable has smuggled a
  contract into the calling code that no signature expresses. Where the
  method is called from many places, defensively copying into an `ArrayList`
  at the boundary is cheaper than debugging the 500 later.
- **`@PostFilter` fails quietly where `@PostAuthorize` fails loudly, and that
  cuts both ways.** Silently dropping unauthorized elements is exactly right
  for a list view, and exactly wrong when the caller asked for something
  specific and needs to know it was refused. A filtered-to-empty result is
  indistinguishable from a genuinely empty one.
- **`@PostFilter` on a repository method is the one usage the book actively
  argues against, and the official docs agree.** It works, it is easy to
  write, and it moves the entire result set through the heap before discarding
  most of it. The general principle stated in the book generalizes past
  Spring: *retrieve only the data you need, wherever the data comes from —
  database, web service, or stream* — rather than fetching broadly and
  filtering in the application.
- **Pushing the predicate into `@Query` buys performance and correct
  pagination, and gives up the decoupling that motivated filtering in the
  first place.** The security rule is now embedded in a JPQL string: it is
  not compile-checked, it is invisible to anyone reading the method
  signature, and it has to be repeated in every query that needs it. That is
  usually the right trade for a repository, but it is a trade, not a strict
  improvement — the aspect-based version genuinely was more maintainable, it
  just did not scale.
- **SpEL inside a `@Query` fails at runtime, not startup.** A typo in
  `?#{authentication.name}` — or a missing
  `SecurityEvaluationContextExtension` bean, or the missing
  `spring-security-data` artifact — surfaces the first time the query runs.
  Since a broken security predicate can fail *open* (returning rows the
  caller should not see) as easily as closed, these query methods want an
  integration test that actually asserts the row-level scoping under two
  different principals, not just that the endpoint returns `200`.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 17, "Global method security: Pre- and postfiltering", sections 17.1-17.3, p. 414-432 — doc
- [Spring Security Reference — Method Security (@PreFilter / @PostFilter)](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html) — doc
- [Spring Security Reference — Spring Data Integration](https://docs.spring.io/spring-security/reference/servlet/integrations/data.html) — doc
- [Spring Security API — PreFilter (value, filterTarget)](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/access/prepost/PreFilter.html) — doc
- [Spring Security API — SecurityEvaluationContextExtension](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/data/repository/query/SecurityEvaluationContextExtension.html) — doc
