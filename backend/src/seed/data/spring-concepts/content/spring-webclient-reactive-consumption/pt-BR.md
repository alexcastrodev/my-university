---
version: 1.0
updatedAt: 2026-08-06
title: WebClient: Consumindo APIs REST de Forma Reativa
---
## Objective

`WebClient` é o cliente HTTP não bloqueante do Spring: em vez de retornar um
objeto desserializado e parar a thread chamadora até a resposta chegar, cada
chamada retorna um `Mono` ou um `Flux` que publica a resposta quando a rede
finalmente responde. Essa diferença é o ponto central de tudo. Dentro de um
pipeline reativo — um handler WebFlux, uma cadeia Reactor montando várias
respostas downstream — uma chamada síncrona prenderia uma thread de
event-loop pela duração de uma ida e volta remota e destruiria o modelo de
concorrência que o próprio pipeline existe para oferecer. `WebClient` mantém
a cadeia reativa de ponta a ponta: a requisição é descrita com um builder
fluente (`get().uri(...).retrieve()`), a resposta é outro publisher, e os
dois se compõem com os mesmos operadores de qualquer outro `Flux`. Para o
lado síncrono da mesma história — `RestTemplate`, `RestClient`, e travessia
de hipermídia com `Traverson` — veja
[Consuming REST Services: RestTemplate & Traverson](spring-resttemplate-and-traverson).
Este conceito é a metade cliente da história reativa web do Spring; a metade
servidor — controllers reativos retornando `Mono`/`Flux` — está coberta em
[Spring WebFlux: Reactive Controllers](spring-webflux-reactive-controllers).

## Use Cases

- Chamar uma API downstream de dentro de um controller WebFlux sem bloquear:
  o handler retorna o `Mono` que o cliente produziu, e nenhuma thread espera
  pelo socket.
- Fan-out — montar uma resposta a partir de várias chamadas downstream
  independentes — onde `Flux.merge`, `zip` ou `flatMap` sobrepõem as idas e
  voltas em vez de serializá-las.
- Fazer streaming de uma coleção grande ou aberta (`bodyToFlux`) onde a
  demanda do consumidor deveria governar a velocidade com que o produtor
  envia, em vez de bufferizar o payload inteiro em uma `List` primeiro.
- Encaminhar um payload reativo diretamente: um `Mono<Order>` que chega em um
  handler pode ser passado para `body(orderMono, Order.class)` sem nunca ser
  materializado.
- Server-Sent Events e outros streams de resposta de longa duração, que não
  têm equivalente síncrono significativo — a resposta nunca "completa" da
  forma que um cliente bloqueante espera.
- Testes de integração contra um servidor reativo real, onde `WebTestClient`
  é a mesma API com asserções acopladas.

## Deep Dive

### Fazendo GET: `retrieve()` seguido de `bodyToMono` / `bodyToFlux`

O padrão é sempre o mesmo em cinco passos — pegar um cliente, escolher um
método, definir a URI, enviar, consumir:

```java
Mono<Ingredient> ingredient = WebClient.create()
    .get()
    .uri("http://localhost:8080/ingredients/{id}", ingredientId)
    .retrieve()
    .bodyToMono(Ingredient.class);

ingredient.subscribe(i -> { /* ... */ });
```

`retrieve()` envia a requisição e devolve um `ResponseSpec`; `bodyToMono()`
decodifica o body em um `Mono<Ingredient>`. Uma coleção difere em exatamente
uma chamada:

```java
Flux<Ingredient> ingredients = WebClient.create()
    .get()
    .uri("http://localhost:8080/ingredients")
    .retrieve()
    .bodyToFlux(Ingredient.class);

ingredients.subscribe(i -> { /* ... */ });
```

O detalhe crucial é que **nada foi enviado ainda**. Os dois trechos
construíram um publisher, não realizaram I/O. A requisição sai na assinatura
(subscription) — o que torna seguro continuar compondo operadores sobre o
resultado antes disso:

```java
Flux<String> names = WebClient.create()
    .get()
    .uri("http://localhost:8080/ingredients")
    .retrieve()
    .bodyToFlux(Ingredient.class)
    .filter(i -> i.getType() == Type.PROTEIN)
    .map(Ingredient::getName);   // still no HTTP call has happened
```

### Um bean `WebClient` com uma URI base

Repetir um host em toda chamada é o mesmo erro de fixar (hardcode) esse host
em qualquer outro lugar. Configure uma vez:

```java
@Bean
public WebClient webClient() {
    return WebClient.create("http://localhost:8080");
}
```

Chamadores injetados então fornecem apenas o caminho:

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

Repare que o método retorna o `Mono` em vez de se inscrever nele. Em uma
aplicação reativa o subscriber deveria ser o framework bem na borda — um
handler WebFlux retornando o publisher — não um serviço intermediário.
Assinar dentro de um método de serviço joga fora a composabilidade que
tornava a chamada reativa.

Para uma instância configurada via builder (timeouts, headers padrão,
filtros), o Spring Boot autoconfigura um bean `WebClient.Builder`:

```java
@Bean
public WebClient webClient(WebClient.Builder builder) {
    return builder
        .baseUrl("http://localhost:8080")
        .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
        .build();
}
```

### Timeouts são um operador, não uma configuração do cliente

Como a resposta é um `Mono`/`Flux`, o operador comum do Reactor se aplica —
não existe uma API de timeout específica do cliente para aprender:

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

Isso generaliza: `retry`, `retryWhen`, `onErrorResume` e `defaultIfEmpty`
funcionam todos em uma resposta de `WebClient` pelo mesmo motivo.

### Enviando dados: `body()` para publishers, `bodyValue()` para objetos

Se o que você tem já é reativo, passe o publisher diretamente para `body()`
junto com seu tipo de elemento — o payload nunca é materializado:

```java
Mono<Ingredient> ingredientMono = /* ... */;

Mono<Ingredient> result = webClient
    .post()
    .uri("/ingredients")
    .body(ingredientMono, Ingredient.class)
    .retrieve()
    .bodyToMono(Ingredient.class);
```

Se você tem um objeto de domínio simples em mãos, `bodyValue()` é o atalho:

```java
Ingredient ingredient = /* ... */;

Mono<Ingredient> result = webClient
    .post()
    .uri("/ingredients")
    .bodyValue(ingredient)
    .retrieve()
    .bodyToMono(Ingredient.class);
```

Um PUT é a mesma cadeia de chamadas com um verbo diferente. PUT e DELETE
geralmente não retornam payload, o que em uma API reativa significa
`Mono<Void>` — e como nada é enviado até a assinatura, um `Mono<Void>` nunca
assinado é uma requisição que nunca acontece:

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

### Tratamento de erros: `onStatus()` e o consumer de erro

Por padrão, um 4xx ou 5xx não produz silenciosamente um resultado vazio —
`retrieve()` transforma isso em um `WebClientResponseException` que encerra
o publisher com um sinal de erro. Esse sinal só é visível se algo estiver
ouvindo por ele, então `subscribe()` deveria receber um consumer de erro como
segundo argumento:

```java
ingredientMono.subscribe(
    ingredient -> { /* handle the data */ },
    error -> { /* deal with the failure */ });
```

`WebClientResponseException` é genérica por design — ela diz que uma chamada
HTTP falhou, não o que isso significou para o seu domínio. `onStatus()`
traduz uma faixa de status em uma exceção que o chamador de fato entende.
Ela recebe um predicado sobre o status e uma função que mapeia o
`ClientResponse` para um `Mono<Throwable>`:

```java
Mono<Ingredient> ingredientMono = webClient
    .get()
    .uri("/ingredients/{id}", ingredientId)
    .retrieve()
    .onStatus(HttpStatusCode::is4xxClientError,
              response -> Mono.just(new UnknownIngredientException()))
    .bodyToMono(Ingredient.class);
```

O predicado pode ser arbitrariamente preciso, e `onStatus()` pode ser
encadeado quantas vezes forem os casos a distinguir:

```java
.retrieve()
.onStatus(status -> status == HttpStatus.NOT_FOUND,
          response -> Mono.just(new UnknownIngredientException()))
.onStatus(HttpStatusCode::is5xxServerError,
          response -> response.bodyToMono(String.class)
                              .map(IngredientServiceDownException::new))
.bodyToMono(Ingredient.class);
```

Repare que o segundo handler consome o body da resposta para construir sua
exceção — `onStatus()` dá acesso ao `ClientResponse` inteiro, não só ao
código. Downstream, um sinal de erro é tratado com os próprios operadores do
Reactor em vez de try/catch:

```java
webClient.get().uri("/ingredients/{id}", id)
    .retrieve()
    .onStatus(HttpStatusCode::is4xxClientError,
              r -> Mono.just(new UnknownIngredientException()))
    .bodyToMono(Ingredient.class)
    .onErrorResume(UnknownIngredientException.class, e -> Mono.empty())
    .retryWhen(Retry.backoff(3, Duration.ofMillis(200)));
```

### Quando `retrieve()` não é suficiente: `exchangeToMono()` / `exchangeToFlux()`

`ResponseSpec` deliberadamente esconde a resposta bruta. Quando uma decisão
depende de headers, cookies, ou uma estratégia de decodificação específica
do status, a API de exchange entrega o `ClientResponse` inteiro para uma
função fornecida por você:

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

Tudo acontece dentro da função: inspecionar os headers, ramificar pelo
status, decodificar (ou não). `createError()` produz o
`WebClientResponseException` padrão para os caminhos que você não quer
tratar como caso especial.

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

### Segurança reativa: `SecurityWebFilterChain`, não `SecurityFilterChain`

O modelo web clássico do Spring Security é construído sobre filtros de
servlet, e uma aplicação WebFlux rodando no Netty não tem servlet container
para filtrar. Desde o Spring Security 5.0, o framework oferece um modelo
reativo paralelo construído sobre o próprio `WebFilter` do Spring — mesmo
starter (`spring-boot-starter-security`), tipos diferentes. A configuração
de servlet declara um `SecurityFilterChain` a partir de `HttpSecurity`; a
reativa declara um `SecurityWebFilterChain` a partir de `ServerHttpSecurity`:

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

O mapeamento a partir do vocabulário de servlet é quase um para um:
`@EnableWebSecurity` → `@EnableWebFluxSecurity`, `HttpSecurity` →
`ServerHttpSecurity`, `authorizeRequests`/`authorizeHttpRequests` →
`authorizeExchange`, `antMatchers`/`requestMatchers` → `pathMatchers`, e
`anyRequest` → `anyExchange`. Como a chain é um `@Bean` em vez de um método
de framework sobrescrito, ela precisa terminar em `build()`.

> **Book vs. today.** The book's listing chains
> `.authorizeExchange().pathMatchers(...)...and().build()`. The non-lambda DSL
> and `.and()` are gone in Spring Security 7 — every configurer now takes a
> `Customizer` lambda, as above. The book also extends
> `WebSecurityConfigurerAdapter` on the servlet side for contrast; that class was
> deprecated in Spring Security 5.7 and removed in 6.0, so the *servlet* side is
> now a `SecurityFilterChain` bean too. The reactive/servlet split the section
> describes is still exactly right — only both sides have converged on the same
> bean-plus-lambda shape.

### O `UserDetailsService` reativo

A autenticação recebe o mesmo tratamento.
`UserDetailsService.loadUserByUsername()` retorna um `UserDetails` e, em uma
implementação apoiada em banco de dados, bloqueia durante a consulta. Sua
contraparte reativa retorna um publisher:

```java
@Bean
public ReactiveUserDetailsService userDetailsService(UserRepository userRepo) {
    return username -> userRepo.findByUsername(username)
        .map(User::toUserDetails);
}
```

`ReactiveUserDetailsService` declara um único método,
`Mono<UserDetails> findByUsername(String)`, então é uma interface funcional
e uma lambda basta. O repositório aqui é um repositório Spring Data
*reativo* retornando `Mono<User>`, que é o ponto central: um repositório
JDBC bloqueante embrulhado em um `Mono` bloquearia o event loop a cada
login e desfaria todo o arranjo.

## Trade-offs

- **Não bloquear só compensa se a cadeia inteira permanecer não
  bloqueante.** Uma única chamada bloqueante em qualquer ponto de um
  pipeline reativo prende uma thread de event-loop, e um servidor Netty tem
  aproximadamente uma dessas por núcleo — um punhado de requisições
  concorrentes pode travar a aplicação inteira. Um repositório JDBC
  bloqueante atrás de uma chamada `WebClient` é a versão clássica desse
  erro:
  ```java
  // defeats the point: blocks an event-loop thread on the JDBC driver
  webClient.get().uri("/ingredients").retrieve().bodyToFlux(Ingredient.class)
           .map(i -> jdbcRepo.enrich(i));   // synchronous, blocking

  // keep it reactive end to end
  webClient.get().uri("/ingredients").retrieve().bodyToFlux(Ingredient.class)
           .flatMap(i -> reactiveRepo.enrich(i));   // returns Mono<Ingredient>
  ```
- **`.block()` está disponível, e usá-lo casualmente converte um cliente
  reativo em um bloqueante mais lento.** É legítimo em uma fronteira genuína
  — um método `main()`, um job `@Scheduled`, um teste — e um bug em qualquer
  ponto dentro de um pipeline de tratamento de requisições, onde custa o
  overhead da maquinaria assíncrona e não compra nenhum de seus benefícios.
  Em uma thread de event-loop do Netty, o Reactor nem sequer permite isso:
  ```java
  // throws IllegalStateException: block()/blockFirst()/blockLast() are
  // blocking, which is not supported in thread reactor-http-nio-2
  Ingredient i = webClient.get().uri("/ingredients/{id}", id)
                          .retrieve().bodyToMono(Ingredient.class).block();
  ```
- **Nada acontece até a assinatura, o que é poderoso e fácil de errar
  silenciosamente.** Um `Mono<Void>` de um PUT ou DELETE que é construído
  mas nunca assinado é uma requisição que nunca foi enviada — e não há
  erro, nem aviso, nem linha de log para notar. O modo de falha é uma
  escrita que simplesmente não aconteceu, o que é pior que uma exceção:
  ```java
  // builds a publisher and discards it — no HTTP request is ever made
  webClient.delete().uri("/ingredients/{id}", id)
           .retrieve().bodyToMono(Void.class);

  // returned to the framework (or composed into the chain) — actually sent
  return webClient.delete().uri("/ingredients/{id}", id)
                  .retrieve().bodyToMono(Void.class);
  ```
- **Erros viajam como sinais, não como exceções, então o try/catch comum
  não se aplica.** Um 404 não lança exceção no local da chamada; ele
  encerra o publisher com um erro que aparece no subscriber, possivelmente
  longe no código. O tratamento pertence à cadeia (`onStatus`,
  `onErrorResume`, `retryWhen`), e um `subscribe()` sem um consumer de erro
  descarta falhas no handler padrão do Reactor, onde é fácil não perceber.
- **Stack traces são quase inúteis sem ajuda.** Como os frames que
  montaram a cadeia já se foram há muito quando a requisição executa, um
  `WebClientResponseException` aponta para internos do Reactor em vez da
  linha que construiu a chamada. Debugar código de cliente reativo significa
  habilitar `Hooks.onOperatorDebug()` ou o agente de debug do Reactor, ou
  ler labels de `checkpoint()` que você lembrou de adicionar — um imposto
  real e recorrente que um cliente síncrono simplesmente não cobra.
- **`exchangeToMono()` é mais poderoso que `retrieve()` e
  correspondentemente menos tolerante.** O acesso ao `ClientResponse` bruto
  vem com uma regra: decodifique dentro da função ou o body é liberado e
  perdido. `retrieve()` cuida desse ciclo de vida para você e deveria
  continuar sendo o padrão; a API de exchange serve para os casos —
  ramificação dependente de header, decodificação dependente de status —
  em que ele genuinamente não consegue.
- **Spring Security reativo é um segundo modelo a aprender, não uma
  configuração a ativar.** `ServerHttpSecurity`, `SecurityWebFilterChain`,
  `ReactiveUserDetailsService` e `ReactiveSecurityContextHolder` espelham
  suas contrapartes de servlet o suficiente para parecerem familiares e
  divergem o suficiente para quebrar hábitos — mais bruscamente em torno do
  contexto de segurança, que vive no contexto do subscriber do Reactor em
  vez de um `ThreadLocal`, então uma chamada
  `SecurityContextHolder.getContext()` que funcionou por anos retorna
  vazio. O ecossistema também é mais fino: menos exemplos prontos, menos
  integrações de terceiros, e mais perguntas cujas únicas respostas foram
  escritas para a stack de servlet.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 11,
  "Developing reactive APIs", sections 11.4-11.5, p. 285-295 — doc
- [Spring Framework Reference — WebClient](https://docs.spring.io/spring-framework/reference/web/webflux-webclient.html) — doc
- [Spring Framework Reference — WebClient Exchange (exchangeToMono / exchangeToFlux)](https://docs.spring.io/spring-framework/reference/web/webflux-webclient/client-exchange.html) — doc
- [Spring Framework API — WebClient](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/reactive/function/client/WebClient.html) — doc
- [Spring Security Reference — WebFlux Security configuration (SecurityWebFilterChain)](https://docs.spring.io/spring-security/reference/reactive/configuration/webflux.html) — doc
