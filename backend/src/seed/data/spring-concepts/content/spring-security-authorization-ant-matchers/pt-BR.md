---
version: 1.0
updatedAt: 2026-08-05
title: Autorização no Spring Security: Ant Matchers e a Pegadinha da Barra Final
summary: Como antMatchers() compartilha sua sintaxe de wildcard com mvcMatchers() mas casa apenas com a expressão de caminho literal, por que isso deixa um caminho como /hello/ desprotegido quando uma regra é escrita para /hello, e por que requestMatchers() e o próprio default de correspondência de barra final do Spring mudaram desde a recomendação do livro de preferir matchers MVC.
---
## Objective

O conceito irmão sobre matcher methods cobre `anyRequest()` e `mvcMatchers()`
(seções 8.1-8.2 do livro). Este cobre a terceira família que o livro percorre,
Ant matchers (`antMatchers()`) — mesma sintaxe de wildcard, mesmo formato de
três sobrecargas dos matchers MVC, mas um mecanismo de correspondência
genuinamente diferente por baixo. O livro dedica a seção inteira (8.3) a
construir em direção a uma pegadinha específica e concreta: um Ant matcher
escrito para `/hello` **não** protege automaticamente também `/hello/`,
enquanto um matcher MVC escrito para o mesmo caminho protege. Essa única
diferença de barra final é o motivo inteiro pelo qual o livro recomenda
matchers MVC em vez de Ant matchers sempre que ambos estão disponíveis.

## Use Cases

- Ler ou auditar uma configuração legada do Spring Security que ainda usa
  `antMatchers()` — entendendo o que ela cobre e o que não cobre antes de
  confiar nela.
- Restringir um grupo inteiro de caminhos sob um prefixo comum
  (`/orders/**`) com uma expressão Ant em vez de enumerar cada sub-caminho.
- Aplicar regras de autorização diferentes ao mesmo caminho dependendo do
  método HTTP, usando `antMatchers(HttpMethod, String...)`.
- Decidir se uma regra `antMatchers()` existente precisa de uma segunda regra
  correspondente para a variante com barra final do mesmo caminho, ou se
  migrá-la para `mvcMatchers()`/`requestMatchers()` fecha a lacuna de vez.

## Deep Dive

### As três sobrecargas de `antMatchers()`

```java
// path + HTTP method — different rules per verb, same paths
.antMatchers(HttpMethod.POST, "/orders/**").hasRole("ADMIN")

// path only — the rule applies regardless of HTTP method
.antMatchers("/orders/**").authenticated()

// HTTP method only, equivalent to antMatchers(method, "/**")
.antMatchers(HttpMethod.DELETE).hasRole("ADMIN")
```

O formato espelha `mvcMatchers()` exatamente — mesmas três sobrecargas, mesma
sintaxe de wildcard para os padrões de caminho. `antMatchers(HttpMethod method)`
sozinho restringe só por verbo, já que é um atalho para casar com todo
caminho com esse método.

### Sintaxe de wildcard Ant: idêntica aos matchers MVC

Ant matchers pegam emprestada a própria sintaxe de expressão de caminho do
Spring MVC, então `*` e `**` significam a mesma coisa que significam para
`mvcMatchers()`: `*` casa com exatamente um segmento de caminho, `**` casa
com qualquer número de segmentos incluindo zero. Uma path variable pode
carregar uma restrição regex da mesma forma:

```java
.antMatchers("/product/{code:^[0-9]*$}").permitAll()
```

A sintaxe ser idêntica à dos matchers MVC é exatamente o que torna a
diferença desta seção fácil de passar despercebida — um desenvolvedor
folheando o código vê expressões com aparência familiar e razoavelmente
assume que se comportam da mesma forma. Não se comportam.

### A pegadinha da barra final: `/hello` vs. `/hello/`

Dado este controller:

```java
@RestController
public class HelloController {

    @GetMapping("/hello")
    public String hello() {
        return "Hello!";
    }
}
```

O próprio Spring MVC trata `/hello` e `/hello/` como a mesma ação — um
request para qualquer um dos dois caminhos chega em `hello()`. Com um
**matcher MVC** protegendo `/hello`:

```java
http.authorizeRequests()
     .mvcMatchers("/hello")
       .authenticated();
```

as duas variantes são protegidas de forma idêntica:

```
curl http://localhost:8080/hello    → 401 Unauthorized
curl http://localhost:8080/hello/   → 401 Unauthorized
curl -u jane:12345 .../hello        → 200 "Hello!"
curl -u jane:12345 .../hello/       → 200 "Hello!"
```

Trocando só o matcher method, mantendo a mesma expressão de caminho e o mesmo
controller:

```java
http.authorizeRequests()
     .antMatchers("/hello").authenticated();
```

e o resultado muda para o request com barra final:

```
curl http://localhost:8080/hello    → 401 Unauthorized
curl http://localhost:8080/hello/   → 200 "Hello!"   (unauthenticated!)
```

`antMatchers("/hello")` casa com a expressão Ant literal `/hello` contra o
caminho do request e nada mais — não tem conhecimento de que o Spring MVC
roteia `/hello/` para o mesmo método de controller. A regra simplesmente não
se aplica a `/hello/`, e já que nada mais nessa configuração mínima o
protege, esse caminho fica acessível sem nenhuma autenticação. O livro chama
isso de "uma falha de segurança grave" precisamente porque nada na
configuração *parece* errado — a expressão casa perfeitamente com seu próprio
caminho literal.

## Trade-offs

- **Ant matchers casam com a expressão literal, nada mais — eles não sabem
  como o Spring MVC de fato roteia requests.** A pegadinha acima é a
  consequência direta: `/hello` como expressão Ant nunca casa com a string
  `/hello/`, independentemente do que o dispatcher faria com esse request.
  ```
  curl http://localhost:8080/hello/   # antMatchers("/hello") → 200, unprotected
  ```
- **`antMatchers(HttpMethod)` sozinho é um wildcard completo no caminho.** É
  açúcar sintático para `antMatchers(method, "/**")`, então uma regra como
  `antMatchers(HttpMethod.DELETE).denyAll()` bloqueia todo request `DELETE`
  na aplicação inteira, não só os que casam com algum padrão mais restrito
  implícito.
  ```java
  .antMatchers(HttpMethod.DELETE).denyAll() // == antMatchers(DELETE, "/**").denyAll()
  ```
- **Ant matchers são legado mas ainda comuns — o livro sinaliza isso
  deliberadamente.** Spilcă observa que já "viu Ant matchers usados bastante
  em aplicações" e quis que os leitores conseguissem reconhecê-los e
  raciocinar sobre eles mesmo recomendando contra escrever novos. Não há
  snippet para demonstrar aqui; é uma declaração sobre o que você vai
  encontrar na prática, não um comportamento a ser reproduzido.
- **Livro vs. hoje: o próprio mecanismo que fechava essa lacuna se moveu,
  duas vezes.** Desde o Spring Security 5.8,
  `antMatchers()`/`mvcMatchers()`/`regexMatchers()` estão deprecados
  (removidos na 6.0) em favor de um único método `requestMatchers()` que —
  naquela geração da API — escolhia `MvcRequestMatcher` automaticamente
  quando o Spring MVC estava no classpath, reproduzindo o comportamento
  seguro quanto à barra final que o livro recomenda matchers MVC para obter,
  sem que um desenvolvedor precisasse escolher isso. Mas, a partir da
  referência atual do Spring Security (7.1.0), `MvcRequestMatcher` e
  `AntPathRequestMatcher` sumiram inteiramente — `requestMatchers()` agora se
  constrói exclusivamente sobre `PathPatternRequestMatcher`, confirmado pelo
  guia de migração web do Spring Security 7. Mais importante, o
  comportamento subjacente que ele herda também mudou: o Spring Framework
  6.0 inverteu o default de correspondência de barra final do `PathPattern`
  de `true` para `false` (rastreado em
  [spring-framework#28552](https://github.com/spring-projects/spring-framework/issues/28552)),
  especificamente porque a equivalência implícita de barra final foi julgada
  um risco de segurança, não só uma conveniência de roteamento. Na prática,
  um request para `/hello/` hoje não chega mais silenciosamente ao
  mapeamento de `/hello` de forma alguma — sob o default atual é um `404`
  antes mesmo da autorização entrar em questão, o que fecha a vulnerabilidade
  específica do livro por uma rota diferente: não fazendo a regra de
  segurança cobrir os dois caminhos, mas o Spring MVC deixando de tratá-los
  como o mesmo request desde o início. O conselho final do livro — "certifique-se
  de que suas expressões de fato casam com tudo para o qual você precisa
  aplicar regras de autorização" — é a parte que não envelheceu nada; só o
  mecanismo específico com o qual é preciso ter cuidado se moveu, da escolha
  entre Ant e MVC matcher para a correspondência de barra final estar
  desligada por padrão em toda a base.
  ```java
  http.authorizeHttpRequests(authorize -> authorize
      .requestMatchers("/hello").authenticated()
      .anyRequest().permitAll()
  );
  // today: PathPatternRequestMatcher, trailing-slash match off by default —
  // GET /hello/ no longer resolves to the same mapping as GET /hello
  ```

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 8, "Configuring authorization: Applying restrictions", section 8.3, "Selecting requests for authorization using Ant matchers", p. 185-189 — doc
- [Spring Security Reference — Authorize HttpServletRequests (requestMatchers)](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
- [Spring Security Reference — Web Migrations for 7.0 (AntPathRequestMatcher/MvcRequestMatcher removed, PathPatternRequestMatcher)](https://docs.spring.io/spring-security/reference/6.5/migration-7/web.html) — doc
- [Spring Framework Issue #28552 — Deprecate trailing slash match and change default value from true to false](https://github.com/spring-projects/spring-framework/issues/28552) — doc
