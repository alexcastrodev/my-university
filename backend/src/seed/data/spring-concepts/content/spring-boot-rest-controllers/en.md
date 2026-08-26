---
version: 1.0
updatedAt: 2026-08-04
---
## Objective

A REST API is, mechanically, just a set of Spring MVC controller methods whose
return values get written straight into the HTTP response body instead of
being handed to a view for rendering. `@RestController` and a matching family
of HTTP-method-specific mapping annotations
(`@GetMapping`/`@PostMapping`/`@PutMapping`/`@PatchMapping`/`@DeleteMapping`)
turn the familiar Spring MVC controller model — already used for HTML-rendering
controllers — into a JSON API, with the same request-handling mechanics minus
the view layer.

## Use Cases

- Exposing an existing domain model (backed by a Spring Data repository) as a
  JSON API for a separate frontend — a single-page app, a mobile client, or
  any consumer that isn't a server-rendered HTML page.
- Returning a specific, meaningful HTTP status code (`201 Created`,
  `404 Not Found`, `204 No Content`) instead of always answering `200 OK`
  regardless of what actually happened.
- Distinguishing a full resource replacement (PUT) from a partial update
  (PATCH) at the API level, so clients don't have to resend every field just
  to change one.
- Allowing a separately-hosted frontend (a different host/port during
  development, or a different origin in production) to actually call the API
  despite the browser's same-origin policy.

## Deep Dive

### `@RestController`: skip the view, write the response body directly

```java
@RestController
@RequestMapping(path="/design", produces="application/json")
@CrossOrigin(origins="*")
public class DesignTacoController {

    private TacoRepository tacoRepo;

    public DesignTacoController(TacoRepository tacoRepo) {
        this.tacoRepo = tacoRepo;
    }

    @GetMapping("/recent")
    public Iterable<Taco> recentTacos() {
        PageRequest page = PageRequest.of(
                0, 12, Sort.by("createdAt").descending());
        return tacoRepo.findAll(page).getContent();
    }
}
```

`@RestController` does two things at once: it's a stereotype annotation (like
`@Controller`/`@Service`) that makes the class discoverable by component
scanning, and it tells Spring that every handler method's return value should
be written directly into the response body rather than passed to a view for
rendering — the REST-specific behavior `@ResponseBody` would otherwise need to
be added to every single method. The class-level `@RequestMapping`'s
`produces="application/json"` restricts every handler in this controller to
requests whose `Accept` header actually asks for JSON — which also means a
*different* controller can handle the same path for non-JSON requests (e.g.
an HTML-rendering controller from elsewhere in the app) without conflicting.
`@CrossOrigin` opts the controller into CORS, letting a frontend hosted on a
different origin (a different port during development, a different domain in
production) actually call it — without it, the browser's same-origin policy
blocks the request before it ever reaches the server.

### Reading a single resource, and returning a real 404

```java
@GetMapping("/{id}")
public Taco tacoById(@PathVariable("id") Long id) {
    Optional<Taco> optTaco = tacoRepo.findById(id);
    if (optTaco.isPresent()) {
        return optTaco.get();
    }
    return null;
}
```

`@PathVariable` binds the `{id}` placeholder in the path to the method
parameter. Returning `null` when the ID doesn't match anything technically
works, but the client receives an empty body with a `200 OK` — a response
that looks successful but carries nothing usable. Wrapping the result in a
`ResponseEntity` fixes that:

```java
@GetMapping("/{id}")
public ResponseEntity<Taco> tacoById(@PathVariable("id") Long id) {
    Optional<Taco> optTaco = tacoRepo.findById(id);
    if (optTaco.isPresent()) {
        return new ResponseEntity<>(optTaco.get(), HttpStatus.OK);
    }
    return new ResponseEntity<>(null, HttpStatus.NOT_FOUND);
}
```

`ResponseEntity<T>` carries the status code alongside the body, so a missing
resource is now reported as `404 Not Found` instead of a misleadingly
successful empty response.

### Writing data: @PostMapping and @RequestBody

```java
@PostMapping(consumes="application/json")
@ResponseStatus(HttpStatus.CREATED)
public Taco postTaco(@RequestBody Taco taco) {
    return tacoRepo.save(taco);
}
```

`consumes` is the input-side counterpart to `produces` — this method only
handles requests whose `Content-Type` is `application/json`. `@RequestBody`
tells Spring MVC to deserialize the JSON request body into a `Taco` object;
without it, Spring MVC would instead try to bind query/form parameters to the
object, which isn't what a JSON API wants. `@ResponseStatus(HttpStatus.CREATED)`
overrides the default `200 OK` with the more descriptive `201 Created`,
telling the client that a new resource now exists as a result of the request.

### PUT vs. PATCH: replace vs. merge, and why the annotation alone doesn't decide

`@PutMapping` and `@PatchMapping` both look like "update" mappings, but the
two HTTP methods carry genuinely different semantics that the annotation
itself does nothing to enforce — the handler method's own logic has to
actually honor the distinction:

```java
// PUT: semantically a wholesale replacement — omitted fields become null
@PutMapping("/{orderId}")
public Order putOrder(@RequestBody Order order) {
    return repo.save(order);
}
```

```java
// PATCH: a partial update — only non-null incoming fields are applied
@PatchMapping(path="/{orderId}", consumes="application/json")
public Order patchOrder(@PathVariable("orderId") Long orderId,
                        @RequestBody Order patch) {

    Order order = repo.findById(orderId).get();
    if (patch.getDeliveryName() != null) {
        order.setDeliveryName(patch.getDeliveryName());
    }
    if (patch.getDeliveryStreet() != null) {
        order.setDeliveryStreet(patch.getDeliveryStreet());
    }
    // ...one null-check per field...
    return repo.save(order);
}
```

`putOrder()` saves whatever the client sent, in full — any field the client
omits gets overwritten with `null`, which is exactly what PUT's "put this
data at this URL" semantics call for. `patchOrder()` does the opposite: it
loads the existing order and only overwrites fields the incoming `patch`
object actually set, leaving everything else untouched. Spring MVC's mapping
annotations only declare *which HTTP method* a handler responds to — they
say nothing about *how* the update should behave, so PATCH's partial-update
semantics have to be hand-written into the method body every time.

### Deleting a resource

```java
@DeleteMapping("/{orderId}")
@ResponseStatus(code=HttpStatus.NO_CONTENT)
public void deleteOrder(@PathVariable("orderId") Long orderId) {
    try {
        repo.deleteById(orderId);
    } catch (EmptyResultDataAccessException e) {}
}
```

`@DeleteMapping` handles `DELETE` requests the same way the other annotations
handle their respective methods. `@ResponseStatus(NO_CONTENT)` sets the
response to `204 No Content` — appropriate here because there's no resource
left to describe in the body once it's deleted. Catching (and ignoring)
`EmptyResultDataAccessException` treats "delete something that's already
gone" the same as "delete something that existed" — the end state (the
resource doesn't exist) is identical either way, so the method doesn't
distinguish the two cases.

## Trade-offs

- **`@RestController` saves an `@ResponseBody` on every method, but only
  because it commits the *entire* class to writing response bodies
  directly.** A controller that needs to mix JSON endpoints with a
  view-rendering endpoint has to either split into two classes or fall back
  to `@Controller` plus `@ResponseBody` on the JSON-returning methods
  individually — `@RestController` is an all-or-nothing choice per class.
- **Returning `null` from a handler method is easy to write and easy to get
  wrong.** It compiles, it runs, and the response looks superficially fine —
  `200 OK` with an empty body — right up until a client tries to use that
  body and finds nothing there. Wrapping the result in `ResponseEntity` costs
  a bit more code but makes the "not found" case an honest part of the
  method's return type instead of a silent edge case.
- **PUT and PATCH's semantic difference is a convention the developer has to
  implement, not something the framework enforces.** Nothing stops a
  `@PatchMapping` handler from doing a full replacement instead of a merge,
  or a `@PutMapping` handler from doing a partial update — the annotations
  only route the request; getting the actual update behavior right is on the
  method body. The book's own callout is worth keeping in mind: there's no
  single standard for what a PATCH payload should look like (a partial
  domain object, as shown here, vs. a dedicated patch-instruction format) —
  it's a per-API design decision, not something HTTP or Spring MVC dictates.
- **Book vs. today: Spring Framework 6 (Spring Boot 3+) added `ProblemDetail`,
  a built-in RFC 7807 "Problem Details for HTTP APIs" representation** —
  giving an error response a structured, self-describing JSON body instead of
  the book's empty-bodied `new ResponseEntity<>(null, HttpStatus.NOT_FOUND)`:
  ```java
  @GetMapping("/{id}")
  public ResponseEntity<?> tacoById(@PathVariable("id") Long id) {
      return tacoRepo.findById(id)
          .<ResponseEntity<?>>map(ResponseEntity::ok)
          .orElseGet(() -> {
              ProblemDetail pd = ProblemDetail.forStatusAndDetail(
                  HttpStatus.NOT_FOUND, "No taco with id " + id);
              return ResponseEntity.status(HttpStatus.NOT_FOUND).body(pd);
          });
  }
  ```
  Confirmed via the current Spring Framework reference: an exception that
  implements `ErrorResponse` (or the ready-made `ErrorResponseException`) is
  automatically rendered as `application/problem+json` by Spring MVC, which
  the official docs now present as the preferred approach over manually
  constructing an empty `ResponseEntity` for error cases — the book's pattern
  still works and returns the correct status code, it just returns a bare
  status with no explanatory body, a capability that didn't exist in Spring
  5/Spring Boot 2's version of the framework.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 6, "Creating REST services", section 6.1, p. 138-149 — doc
- [Spring Framework Reference — Annotated Controllers (Mapping Requests)](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-requestmapping.html) — doc
- [Spring Framework Reference — Error Responses (ProblemDetail, RFC 7807)](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-ann-rest-exceptions.html) — doc
- [Spring Framework API — ProblemDetail](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/http/ProblemDetail.html) — doc
