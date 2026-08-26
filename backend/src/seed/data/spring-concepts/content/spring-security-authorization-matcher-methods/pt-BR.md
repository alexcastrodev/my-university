---
version: 1.0
updatedAt: 2026-08-04
title: Spring Security: Selecionando Requests com Matcher Methods
summary: Como os matcher methods do Spring Security (anyRequest(), mvcMatchers()/requestMatchers()) selecionam a quais requests uma regra de autorização se aplica, por que a ordem das regras precisa ir do específico para o geral, como combinar um caminho com um método HTTP, e por que o próprio argumento de segurança do livro para preferir matchers MVC a matchers Ant agora está embutido por padrão em requestMatchers().
---
## Objective

O Capítulo 7 aplicava uma regra de autorização a todo request de uma vez, via
`anyRequest()`. Aplicações reais quase nunca querem isso — alguns endpoints
precisam de uma role, outros precisam de uma diferente, e vários não precisam
de restrição nenhuma. Matcher methods são a forma como uma configuração de
autorização diz *a quais* requests uma dada regra se aplica: por caminho
exato, por um padrão de caminho, por método HTTP, ou por alguma combinação
dos três.

## Use Cases

- Exigir uma role específica só para um subconjunto de endpoints (um caminho
  de admin) enquanto deixa o resto da aplicação sob regras diferentes e mais
  soltas.
- Aplicar regras diferentes ao mesmo caminho dependendo do método HTTP — um
  `GET` em `/a` aberto para qualquer um, um `POST` no mesmo caminho exigindo
  autenticação.
- Bloquear um grupo inteiro de endpoints relacionados que compartilham um
  prefixo comum (`/a/b/**`) numa única regra, em vez de enumerar cada caminho
  individualmente.
- Restringir um endpoint dirigido por path-variable apenas aos formatos de
  valor que fazem sentido (só dígitos, por exemplo), rejeitando qualquer outra
  coisa antes que chegue ao controller.

## Deep Dive

### `anyRequest()`: a regra que casa com tudo

Todo exemplo até este capítulo usou `anyRequest()` sem necessariamente
nomeá-lo — ele significa exatamente o que diz, casando com todo request
independentemente de caminho ou método HTTP. Continua útil como o catch-all
deliberado no *final* de uma cadeia de regras mais específicas:

```java
http.authorizeRequests()
     .mvcMatchers("/hello").hasRole("ADMIN")
     .mvcMatchers("/ciao").hasRole("MANAGER")
     .anyRequest().permitAll();
```

Qualquer endpoint não explicitamente casado por uma regra anterior mais
específica — como um `/hola` recém-adicionado — cai no que `anyRequest()`
diz, aqui `permitAll()`. O livro destaca isso como boa prática precisamente
porque torna a intenção para "todo o resto" explícita e revisável, em vez de
um acidente do que ainda não foi protegido.

### Ordem das regras: específico antes de geral, sempre

Regras de autorização são avaliadas na ordem em que são declaradas, e o
Spring Security impõe uma restrição rígida sobre essa ordem: um matcher mais
específico nunca pode vir depois de um mais geral, porque `anyRequest()` já
teria reivindicado todo request no momento em que uma regra posterior e mais
restrita fosse alcançada:

```java
// correct: specific rules first, catch-all last
http.authorizeRequests()
     .mvcMatchers("/hello").hasRole("ADMIN")
     .mvcMatchers("/ciao").hasRole("MANAGER")
     .anyRequest().authenticated();
```

Reordenar isso para que `anyRequest()` viesse primeiro não seria só
redundante — é uma configuração que o Spring Security rejeita ativamente, já
que os matchers posteriores e mais específicos nunca poderiam realmente se
aplicar uma vez que `anyRequest()` já casou.

### Não autenticado vs. autenticação falhada: dois códigos de resposta diferentes

`permitAll()` num caminho significa que o Spring Security pula a autorização
inteiramente — mas a autenticação (verificar quem quer que tenha fornecido
credenciais) ainda roda primeiro, independentemente. Chamar um endpoint
`permitAll()` sem nenhuma credencial funciona; chamar o mesmo endpoint com
credenciais *erradas* falha durante a autenticação e nunca alcança o estágio
de autorização:

```
curl http://localhost:8080/hola                    → 200 OK, "Hola!"
curl -u bill:wrongpass http://localhost:8080/hola   → 401 Unauthorized
```

A distinção importa operacionalmente: um `401` aqui significa "as credenciais
que você forneceu foram rejeitadas", não "você não tem permissão para ver
isso" — `permitAll()` nunca chega a rodar para um request que falha na
autenticação primeiro.

### Matchers MVC: mvcMatchers(), com ou sem um método HTTP

`mvcMatchers()` seleciona requests usando a mesma sintaxe de correspondência
de caminho que o próprio Spring MVC usa para
`@GetMapping`/`@PostMapping`/etc. Existem duas sobrecargas — uma só com
caminho, outra que também fixa um método HTTP específico:

```java
http.authorizeRequests()
     .mvcMatchers(HttpMethod.GET, "/a")
        .authenticated()
     .mvcMatchers(HttpMethod.POST, "/a")
        .permitAll()
     .anyRequest()
        .denyAll();
```

Aqui, `GET /a` exige autenticação, `POST /a` fica aberto a qualquer um, e todo
outro request para qualquer outro caminho é negado de vez. Sem o argumento
`HttpMethod`, `mvcMatchers("/a")` aplica a mesma regra independentemente de
qual método HTTP é usado.

### Expressões de caminho: `**`, `*` e regex em path-variable

Uma única expressão de prefixo cobre uma família inteira de caminhos sem
enumerar cada um:

```java
http.authorizeRequests()
     .mvcMatchers("/a/b/**")
        .authenticated()
     .anyRequest()
        .permitAll();
```

`/a/b/**` casa com `/a/b`, `/a/b/c`, e qualquer caminho mais profundo sob esse
prefixo — novos caminhos adicionados depois sob `/a/b` herdam automaticamente
a mesma regra sem que um desenvolvedor precise lembrar de atualizar a
configuração de segurança. `*` casa com exatamente um segmento de caminho
(`/a/*` casa com `/a/b` mas não com `/a/b/c`); `**` casa com qualquer número
de segmentos, incluindo zero. Uma path variable pode carregar sua própria
restrição regex, avaliada como parte do casamento:

```java
http.authorizeRequests()
     .mvcMatchers("/product/{code:^[0-9]*$}")
        .permitAll()
     .anyRequest()
        .denyAll();
```

Só um valor de `code` consistindo inteiramente de dígitos satisfaz o padrão —
`/product/12345` é permitido, `/product/1234a` é negado antes mesmo do
request chegar a `ProductController`.

## Trade-offs

- **Catch-alls explícitos com `anyRequest()` são uma escolha deliberada e
  revisável — depender de um default implícito não é.** O livro apresenta
  escrever `.anyRequest().permitAll()` (ou `.authenticated()`, ou
  `.denyAll()`) por extenso como boa prática precisamente porque força uma
  decisão consciente sobre o que acontece a qualquer endpoint não casado por
  outra regra, em vez de deixar por conta do que o default do Spring Security
  acabar sendo.
- **A ordem das regras não é só uma preferência de estilo — o Spring
  Security impõe específico-antes-de-geral como uma regra rígida.** Uma
  cadeia de matchers que coloca `anyRequest()` antes de um matcher mais
  restrito não faz a coisa errada silenciosamente; o framework a rejeita,
  porque uma regra depois de `anyRequest()` nunca poderia ser alcançada.
- **`permitAll()` só controla autorização, não autenticação.** Fornecer
  credenciais inválidas a um endpoint `permitAll()` ainda falha com `401`
  durante a autenticação, antes mesmo da autorização ser consultada — um
  detalhe fácil de interpretar como `permitAll()` "não funcionando" quando na
  verdade está funcionando exatamente como projetado.
- **Livro vs. hoje: o próprio motivo de segurança do livro para preferir
  matchers MVC a matchers Ant agora está embutido na API unificada por
  padrão, não algo que um desenvolvedor precise lembrar de escolher.** O
  livro (esta seção e a próxima) alerta que `antMatchers("/hello")` não
  protege automaticamente também `/hello/` da forma como
  `mvcMatchers("/hello")` faz — porque o Spring MVC trata uma barra final
  como a mesma ação de controller, mas a correspondência de caminho pura do
  Ant não sabe disso — e recomenda matchers MVC especificamente para evitar
  essa lacuna. Desde o Spring Security 5.8,
  `mvcMatchers()`/`antMatchers()`/`regexMatchers()` estão todos deprecados
  (removidos na 6.0) em favor de um único método `requestMatchers()`, que
  seleciona automaticamente `MvcRequestMatcher` quando o Spring MVC está
  presente no classpath, ou `AntPathRequestMatcher` caso contrário —
  confirmado pela referência atual do Spring Security e pelo guia de
  migração 5.8. A própria preocupação de segurança do livro agora é o
  default automático, em vez de uma escolha que um desenvolvedor precisa
  lembrar de fazer corretamente:
  ```java
  http.authorizeHttpRequests(authorize -> authorize
      .requestMatchers("/hello").hasRole("ADMIN")
      .requestMatchers("/ciao").hasRole("MANAGER")
      .anyRequest().permitAll()
  );
  ```
  A sintaxe de correspondência de caminho em si (`**`, `*`, `{param:regex}`)
  e a migração de DSL de `authorizeRequests()` para `authorizeHttpRequests()`
  permanecem inalteradas em relação ao que já está documentado no conceito
  irmão "Autorização no Spring Security: Authorities e Roles".

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 8, "Configuring authorization: Applying restrictions", sections 8.1-8.2, p. 172-184 — doc
- [Spring Security Reference — Authorize HttpServletRequests (requestMatchers)](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
- [Spring Security API — RequestMatcher](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/web/util/matcher/RequestMatcher.html) — doc
