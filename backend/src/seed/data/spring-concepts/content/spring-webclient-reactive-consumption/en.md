---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

`WebClient` is Spring's non-blocking HTTP client: instead of returning a
deserialized object and parking the calling thread until the response arrives,
every call returns a `Mono` or a `Flux` that publishes the response when the
network gets around to it. That difference is the whole point. Inside a reactive
pipeline — a WebFlux handler, a Reactor chain assembling several downstream
responses — a synchronous call would pin an event-loop thread for the duration of
a remote round trip and collapse the concurrency model the pipeline exists to
provide. `WebClient` keeps the chain reactive end to end: the request is
described with a fluent builder (`get().uri(...).retrieve()`), the response is
another publisher, and the two compose with the same operators as any other
`Flux`. For the synchronous side of the same story — `RestTemplate`, `RestClient`,
and hypermedia traversal with `Traverson` — see
[Consuming REST Services: RestTemplate & Traverson](spring-resttemplate-and-traverson).
This concept is the client half of Spring's reactive web story; the server half
— reactive controllers returning `Mono`/`Flux` — is covered in
[Spring WebFlux: Reactive Controllers](spring-webflux-reactive-controllers).

## Use Cases

- Calling a downstream API from inside a WebFlux controller without blocking:
  the handler returns the `Mono` the client produced, and no thread waits on the
  socket.
- Fan-out — assembling one response from several independent downstream calls —
  where `Flux.merge`, `zip`, or `flatMap` overlap the round trips instead of
  serializing them.
- Streaming a large or open-ended collection (`bodyToFlux`) where the consumer's
  demand should govern how fast the producer sends, rather than buffering the
  whole payload into a `List` first.
- Forwarding a reactive payload straight through: a `Mono<Order>` arriving in a
  handler can be handed to `body(orderMono, Order.class)` without ever being
  materialized.
- Server-Sent Events and other long-lived response streams, which have no
  meaningful synchronous equivalent — the response never "completes" in the way
  a blocking client expects.
- Integration tests against a live reactive server, where `WebTestClient` is the
  same API with assertions bolted on.

## Deep Dive

### GETting: `retrieve()` then `bodyToMono` / `bodyToFlux`

The pattern is always the same five steps — get a client, pick a method, set the
URI, submit, consume:

```java
Mono<Ingredient> ingredient = WebClient.create()
    .get()
    .uri("http://localhost:8080/ingredients/{id}", ingredientId)
    .retrieve()
    .bodyToMono(Ingredient.class);

ingredient.subscribe(i -> { /* ... */ });
```

`retrieve()` submits the request and hands back a `ResponseSpec`; `bodyToMono()`
decodes the body into a `Mono<Ingredient>`. A collection differs in exactly one
call:

```java
Flux<Ingredient> ingredients = WebClient.create()
    .get()
    .uri("http://localhost:8080/ingredients")
    .retrieve()
    .bodyToFlux(Ingredient.class);

ingredients.subscribe(i -> { /* ... */ });
```

The crucial detail is that **nothing has been sent yet**. Both snippets have
built a publisher, not performed I/O. The request goes out on subscription —
which is what makes it safe to keep composing operators onto the result first:

```java
Flux<String> names = WebClient.create()
    .get()
    .uri("http://localhost:8080/ingredients")
    .retrieve()
    .bodyToFlux(Ingredient.class)
    .filter(i -> i.getType() == Type.PROTEIN)
    .map(Ingredient::getName);   // still no HTTP call has happened
```

### A `WebClient` bean with a base URI

Repeating a host in every call is the same mistake as hardcoding it anywhere
else. Configure it once:

```java
@Bean
public WebClient webClient() {
    return WebClient.create("http://localhost:8080");
}
```

Injected callers then supply only the path:

```java
@Autowired
WebClient webClient;

public Mono<Ingredient> getIngredientById(String ingredientId) {
    return webClient
        .get()
        .uri("/ingredients/{id}", ingredientId)
        .retrieve()
        .bodyToMono(Ingredient.class);
}
```

Note the method returns the `Mono` rather than subscribing to it. In a reactive
application the subscriber should be the framework at the very edge — a WebFlux
handler returning the publisher — not an intermediate service. Subscribing
inside a service method throws away the composability that made the call
reactive.

For a builder-configured instance (timeouts, default headers, filters), Spring
Boot auto-configures a `WebClient.Builder` bean:

```java
@Bean
public WebClient webClient(WebClient.Builder builder) {
    return builder
        .baseUrl("http://localhost:8080")
        .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
        .build();
}
```

### Timeouts are an operator, not a client setting

Because the response is a `Mono`/`Flux`, the ordinary Reactor operator applies —
there is no client-specific timeout API to learn:

```java
Flux<Ingredient> ingredients = webClient
    .get()
    .uri("/ingredients")
    .retrieve()
    .bodyToFlux(Ingredient.class);

ingredients
    .timeout(Duration.ofSeconds(1))
    .subscribe(
        i -> { /* handle ingredient */ },
        e -> { /* handle timeout / error */ });
```

This generalizes: `retry`, `retryWhen`, `onErrorResume`, and
`defaultIfEmpty` all work on a `WebClient` response for the same reason.

### Sending data: `body()` for publishers, `bodyValue()` for objects

If what you have is already reactive, hand the publisher straight to `body()`
along with its element type — the payload is never materialized:

```java
Mono<Ingredient> ingredientMono = /* ... */;

Mono<Ingredient> result = webClient
    .post()
    .uri("/ingredients")
    .body(ingredientMono, Ingredient.class)
    .retrieve()
    .bodyToMono(Ingredient.class);
```

If you hold a plain domain object, `bodyValue()` is the shortcut:

```java
Ingredient ingredient = /* ... */;

Mono<Ingredient> result = webClient
    .post()
    .uri("/ingredients")
    .bodyValue(ingredient)
    .retrieve()
    .bodyToMono(Ingredient.class);
```

A PUT is the same call chain with a different verb. PUT and DELETE usually
return no payload, which in a reactive API means `Mono<Void>` — and since
nothing is sent until subscription, a `Mono<Void>` that is never subscribed is a
request that never happens:

```java
Mono<Void> updated = webClient
    .put()
    .uri("/ingredients/{id}", ingredient.getId())
    .bodyValue(ingredient)
    .retrieve()
    .bodyToMono(Void.class);

Mono<Void> deleted = webClient
    .delete()
    .uri("/ingredients/{id}", ingredientId)
    .retrieve()
    .bodyToMono(Void.class);
```

### Error handling: `onStatus()` and the error consumer

By default a 4xx or 5xx does not silently produce an empty result — `retrieve()`
turns it into a `WebClientResponseException` that terminates the publisher with
an error signal. That signal is only visible if something is listening for it,
so `subscribe()` should take an error consumer as its second argument:

```java
ingredientMono.subscribe(
    ingredient -> { /* handle the data */ },
    error -> { /* deal with the failure */ });
```

`WebClientResponseException` is generic by design — it says an HTTP call failed,
not what it meant to your domain. `onStatus()` translates a status range into an
exception the caller actually understands. It takes a predicate over the status
and a function that maps the `ClientResponse` to a `Mono<Throwable>`:

```java
Mono<Ingredient> ingredientMono = webClient
    .get()
    .uri("/ingredients/{id}", ingredientId)
    .retrieve()
    .onStatus(HttpStatusCode::is4xxClientError,
              response -> Mono.just(new UnknownIngredientException()))
    .bodyToMono(Ingredient.class);
```

The predicate can be arbitrarily precise, and `onStatus()` can be chained as
many times as there are cases to distinguish:

```java
.retrieve()
.onStatus(status -> status == HttpStatus.NOT_FOUND,
          response -> Mono.just(new UnknownIngredientException()))
.onStatus(HttpStatusCode::is5xxServerError,
          response -> response.bodyToMono(String.class)
                              .map(IngredientServiceDownException::new))
.bodyToMono(Ingredient.class);
```

Note the second handler consumes the response body to build its exception —
`onStatus()` gives access to the whole `ClientResponse`, not just the code.
Downstream, an error signal is handled with Reactor's own operators rather than
try/catch:

```java
webClient.get().uri("/ingredients/{id}", id)
    .retrieve()
    .onStatus(HttpStatusCode::is4xxClientError,
              r -> Mono.just(new UnknownIngredientException()))
    .bodyToMono(Ingredient.class)
    .onErrorResume(UnknownIngredientException.class, e -> Mono.empty())
    .retryWhen(Retry.backoff(3, Duration.ofMillis(200)));
```

### When `retrieve()` isn't enough: `exchangeToMono()` / `exchangeToFlux()`

`ResponseSpec` deliberately hides the raw response. When a decision depends on
headers, cookies, or a status-specific decoding strategy, the exchange API hands
the whole `ClientResponse` to a function you supply:

```java
Mono<Ingredient> ingredientMono = webClient
    .get()
    .uri("/ingredients/{id}", ingredientId)
    .exchangeToMono(response -> {
        if (response.headers().header("X_UNAVAILABLE").contains("true")) {
            return Mono.empty();
        }
        if (response.statusCode().equals(HttpStatus.OK)) {
            return response.bodyToMono(Ingredient.class);
        }
        return response.createError();
    });
```

Everything happens inside the function: inspect the headers, branch on the
status, decode (or don't). `createError()` produces the standard
`WebClientResponseException` for the paths you don't want to special-case.

```mermaid
sequenceDiagram
    participant H as WebFlux handler
    participant W as WebClient
    participant API as Ingredient API

    H->>W: get().uri(...).retrieve().bodyToMono(...)
    W-->>H: Mono<Ingredient> (nothing sent yet)
    H->>H: compose: filter / map / timeout
    H-->>H: return Mono to framework
    Note over H,W: framework subscribes — only now is I/O started
    W->>API: GET /ingredients/{id}
    Note over H,W: thread is released; no one waits
    API-->>W: 200 + body (later)
    W-->>H: onNext(Ingredient) → onComplete
```

> **Book vs. today.** The book's `exchange()` is deprecated — and the reason is
> a real footgun, not a rename. `WebClient.RequestHeadersSpec.exchange()` handed
> you a `Mono<ClientResponse>` and then walked away: the response body was your
> responsibility, and any path through your code that failed to consume or
> release it leaked memory *and* the underlying connection. Spring Framework 5.3
> deprecated it for exactly that, with the javadoc reading "since 5.3 due to the
> possibility to leak memory and/or connections; please, use
> `exchangeToMono(Function)`, `exchangeToFlux(Function)`". The replacements keep
> the same access to the full `ClientResponse` but invert the ownership: after
> the returned `Mono`/`Flux` completes, WebClient checks the body and releases it
> if it wasn't consumed. The corollary is that the response *cannot* be decoded
> further downstream — all decoding must happen inside the function you pass in,
> which is why the book's two-step
> `.exchange().flatMap(cr -> ...).flatMap(cr -> cr.bodyToMono(...))` collapses
> into a single `exchangeToMono` lambda above. Two smaller corrections in the
> same chapter: `syncBody()` was replaced by `bodyValue()` in Spring 5.2 and is
> gone from current versions, and `HttpStatus::is4xxClientError` in an
> `onStatus()` predicate is now `HttpStatusCode::is4xxClientError` — Spring
> Framework 6.0 introduced the `HttpStatusCode` interface so that non-standard
> status codes could be represented, and `HttpStatus` became one implementation
> of it. Everything else in the chapter — `retrieve()`, `bodyToMono`,
> `bodyToFlux`, `onStatus`, base-URI clients, `timeout()` — is current and
> unchanged.

### Reactive security: `SecurityWebFilterChain`, not `SecurityFilterChain`

Spring Security's classic web model is built on servlet filters, and a WebFlux
application running on Netty has no servlet container to filter in. Since
Spring Security 5.0 the framework provides a parallel reactive model built on
Spring's own `WebFilter` — same starter
(`spring-boot-starter-security`), different types. The servlet configuration
declares a `SecurityFilterChain` from `HttpSecurity`; the reactive one declares
a `SecurityWebFilterChain` from `ServerHttpSecurity`:

```java
@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {

    @Bean
    public SecurityWebFilterChain securityWebFilterChain(ServerHttpSecurity http) {
        http
            .authorizeExchange(exchanges -> exchanges
                .pathMatchers("/design", "/orders").hasAuthority("USER")
                .anyExchange().permitAll())
            .httpBasic(Customizer.withDefaults());
        return http.build();
    }
}
```

The mapping from the servlet vocabulary is almost one-to-one:
`@EnableWebSecurity` → `@EnableWebFluxSecurity`, `HttpSecurity` →
`ServerHttpSecurity`, `authorizeRequests`/`authorizeHttpRequests` →
`authorizeExchange`, `antMatchers`/`requestMatchers` → `pathMatchers`, and
`anyRequest` → `anyExchange`. Because the chain is a `@Bean` rather than an
overridden framework method, it must end in `build()`.

> **Book vs. today.** The book's listing chains
> `.authorizeExchange().pathMatchers(...)...and().build()`. The non-lambda DSL
> and `.and()` are gone in Spring Security 7 — every configurer now takes a
> `Customizer` lambda, as above. The book also extends
> `WebSecurityConfigurerAdapter` on the servlet side for contrast; that class was
> deprecated in Spring Security 5.7 and removed in 6.0, so the *servlet* side is
> now a `SecurityFilterChain` bean too. The reactive/servlet split the section
> describes is still exactly right — only both sides have converged on the same
> bean-plus-lambda shape.

### The reactive `UserDetailsService`

Authentication has the same treatment. `UserDetailsService.loadUserByUsername()`
returns a `UserDetails` and, in a database-backed implementation, blocks while
querying. Its reactive counterpart returns a publisher:

```java
@Bean
public ReactiveUserDetailsService userDetailsService(UserRepository userRepo) {
    return username -> userRepo.findByUsername(username)
        .map(User::toUserDetails);
}
```

`ReactiveUserDetailsService` declares one method,
`Mono<UserDetails> findByUsername(String)`, so it is a functional interface and
a lambda suffices. The repository here is a *reactive* Spring Data repository
returning `Mono<User>`, which is the point: a blocking JDBC repository wrapped
in a `Mono` would block the event loop on every login and undo the entire
arrangement.

## Trade-offs

- **Non-blocking only pays off if the whole chain stays non-blocking.** One
  blocking call anywhere in a reactive pipeline pins an event-loop thread, and
  a Netty server has roughly one of those per core — a handful of concurrent
  requests can stall the entire application. A blocking JDBC repository behind
  a `WebClient` call is the classic version of this mistake:
  ```java
  // defeats the point: blocks an event-loop thread on the JDBC driver
  webClient.get().uri("/ingredients").retrieve().bodyToFlux(Ingredient.class)
           .map(i -> jdbcRepo.enrich(i));   // synchronous, blocking

  // keep it reactive end to end
  webClient.get().uri("/ingredients").retrieve().bodyToFlux(Ingredient.class)
           .flatMap(i -> reactiveRepo.enrich(i));   // returns Mono<Ingredient>
  ```
- **`.block()` is available, and using it casually converts a reactive client
  into a slower blocking one.** It is legitimate at a genuine boundary — a
  `main()` method, a `@Scheduled` job, a test — and a bug anywhere inside a
  request-handling pipeline, where it costs the async machinery's overhead and
  buys none of its benefit. On a Netty event-loop thread Reactor will not even
  allow it:
  ```java
  // throws IllegalStateException: block()/blockFirst()/blockLast() are
  // blocking, which is not supported in thread reactor-http-nio-2
  Ingredient i = webClient.get().uri("/ingredients/{id}", id)
                          .retrieve().bodyToMono(Ingredient.class).block();
  ```
- **Nothing happens until subscription, which is powerful and easy to get wrong
  silently.** A `Mono<Void>` from a PUT or DELETE that is built but never
  subscribed is a request that was never sent — and there is no error, no
  warning, and no log line to notice. The failure mode is a write that simply
  didn't happen, which is worse than an exception:
  ```java
  // builds a publisher and discards it — no HTTP request is ever made
  webClient.delete().uri("/ingredients/{id}", id)
           .retrieve().bodyToMono(Void.class);

  // returned to the framework (or composed into the chain) — actually sent
  return webClient.delete().uri("/ingredients/{id}", id)
                  .retrieve().bodyToMono(Void.class);
  ```
- **Errors travel as signals, not exceptions, so ordinary try/catch does not
  apply.** A 404 does not throw at the call site; it terminates the publisher
  with an error that surfaces at the subscriber, potentially far away in the
  code. Handling belongs in the chain (`onStatus`, `onErrorResume`,
  `retryWhen`), and a `subscribe()` without an error consumer discards failures
  into Reactor's default handler where they are easy to miss.
- **Stack traces are close to useless without help.** Because the frames that
  assembled the chain are long gone by the time the request executes, a
  `WebClientResponseException` points at Reactor internals rather than at the
  line that built the call. Debugging reactive client code means enabling
  `Hooks.onOperatorDebug()` or the Reactor debug agent, or reading
  `checkpoint()` labels you remembered to add — a real, recurring tax that a
  synchronous client simply does not levy.
- **`exchangeToMono()` is more powerful than `retrieve()` and correspondingly
  less forgiving.** Access to the raw `ClientResponse` comes with a rule:
  decode inside the function or the body is released and gone. `retrieve()`
  handles that lifecycle for you and should stay the default; the exchange API
  is for the cases — header-dependent branching, status-dependent decoding —
  where it genuinely cannot.
- **Reactive Spring Security is a second model to learn, not a setting to
  flip.** `ServerHttpSecurity`, `SecurityWebFilterChain`,
  `ReactiveUserDetailsService`, and `ReactiveSecurityContextHolder` mirror their
  servlet counterparts closely enough to feel familiar and differ enough to
  break habits — most sharply around the security context, which lives in the
  Reactor subscriber context rather than a `ThreadLocal`, so a
  `SecurityContextHolder.getContext()` call that worked for years returns
  nothing. The ecosystem is also thinner: fewer worked examples, fewer
  third-party integrations, and more questions whose only answers are written
  for the servlet stack.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 11,
  "Developing reactive APIs", sections 11.4-11.5, p. 285-295 — doc
- [Spring Framework Reference — WebClient](https://docs.spring.io/spring-framework/reference/web/webflux-webclient.html) — doc
- [Spring Framework Reference — WebClient Exchange (exchangeToMono / exchangeToFlux)](https://docs.spring.io/spring-framework/reference/web/webflux-webclient/client-exchange.html) — doc
- [Spring Framework API — WebClient](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/reactive/function/client/WebClient.html) — doc
- [Spring Security Reference — WebFlux Security configuration (SecurityWebFilterChain)](https://docs.spring.io/spring-security/reference/reactive/configuration/webflux.html) — doc
