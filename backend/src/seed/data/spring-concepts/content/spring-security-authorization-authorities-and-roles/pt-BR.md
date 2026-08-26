---
version: 1.0
updatedAt: 2026-08-04
title: Autorização no Spring Security: Authorities e Roles
---
## Objective

Autenticação responde "quem é este?" — autorização responde uma pergunta
completamente diferente: "esse caller específico, já identificado, tem
permissão para fazer essa coisa específica?" O Spring Security mantém as duas
preocupações claramente separadas: uma vez que o filtro de autenticação
popula o security context, um segundo filtro, independente, decide se o
request prossegue, com base em regras expressas contra as authorities ou
roles concedidas ao caller, em vez de contra sua identidade diretamente.

## Use Cases

- Restringir uma aplicação inteira (ou, uma vez que o request-matching seja
  adicionado num capítulo posterior, endpoints específicos) apenas a usuários
  que possuam uma permissão específica — "só usuários que podem fazer `WRITE`
  podem chamar isso."
- Agrupar várias permissões relacionadas sob um rótulo mais grosseiro — uma
  role `ADMIN` que implica leitura, escrita, atualização e exclusão — em vez de
  checar cada permissão subjacente individualmente em todo lugar que importa.
- Construir uma regra de autorização que genuinamente não se encaixa em "o
  usuário tem a authority X" — uma restrição por horário do dia, uma regra que
  combina múltiplas condições — onde os métodos nomeados no estilo
  `hasAuthority()`/`hasRole()` ficam sem expressividade.
- Bloquear deliberadamente uma categoria inteira de request de vez (um caminho
  interno apenas, um gateway que deveria servir só uma rota específica) com uma
  regra que sempre nega, em vez de uma que permite condicionalmente.

## Deep Dive

### O contrato `GrantedAuthority`: uma permissão, uma string

```java
public interface GrantedAuthority extends Serializable {
  String getAuthority();
}
```

`UserDetails.getAuthorities()` retorna uma coleção destas — as permissões
concedidas a um usuário, descobertas durante a autenticação e disponíveis para
o filtro de autorização depois. Uma authority é só um nome (`"READ"`,
`"write"`, `"delete"`) que uma regra de autorização depois verifica; a
convenção de nomenclatura (tudo maiúsculo vs. minúsculo) é uma escolha do
próprio projeto, não algo que o Spring Security force.

### Restringindo por authority: `hasAuthority()` e `hasAnyAuthority()`

```java
@Configuration
public class ProjectConfig extends WebSecurityConfigurerAdapter {

    @Bean
    public UserDetailsService userDetailsService() {
        var manager = new InMemoryUserDetailsManager();

        var user1 = User.withUsername("john")
                        .password("12345")
                        .authorities("READ")
                        .build();

        var user2 = User.withUsername("jane")
                        .password("12345")
                        .authorities("WRITE")
                        .build();

        manager.createUser(user1);
        manager.createUser(user2);
        return manager;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return NoOpPasswordEncoder.getInstance();
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.httpBasic();

        http.authorizeRequests()
             .anyRequest()
             .hasAuthority("WRITE");
    }
}
```

Só Jane (que possui `WRITE`) recebe um `200 OK` de um endpoint protegido;
John (que só possui `READ`) recebe `403 Forbidden` — o request é autenticado
com sucesso nos dois casos, mas só um dos dois é autorizado.
`hasAnyAuthority(String...)` relaxa isso para "pelo menos uma das authorities
dadas": `hasAnyAuthority("WRITE", "READ")` deixa tanto John quanto Jane
passarem, já que cada um possui uma das duas authorities nomeadas.

### Roles: authorities com um prefixo `ROLE_` e intenção mais grosseira

Roles usam exatamente o mesmo contrato `GrantedAuthority` por baixo — o único
marcador distintivo é um prefixo `ROLE_` no nome. Onde authorities são
pensadas para ser de granularidade fina (`READ`, `WRITE`, `DELETE`), uma role
agrupa várias delas sob um rótulo mais grosseiro (`ADMIN` implicando as
quatro):

```java
var user1 = User.withUsername("john")
                .password("12345")
                .authorities("ROLE_ADMIN")   // GrantedAuthority, ROLE_ prefix
                .build();
```

```java
http.authorizeRequests()
     .anyRequest().hasRole("ADMIN");   // no ROLE_ prefix when checking
```

A assimetria é deliberada e fácil de inverter: `authorities("ROLE_ADMIN")`
declara a role com o prefixo, mas `hasRole("ADMIN")` a verifica *sem* o
prefixo — `hasRole()` adiciona `ROLE_` internamente antes de comparar. O
builder `User` também oferece um método dedicado `roles()` que adiciona o
prefixo automaticamente na entrada:

```java
var user1 = User.withUsername("john")
                .password("12345")
                .roles("ADMIN")   // ROLE_ prefix added automatically
                .build();
```

Passar um valor já prefixado para `roles()` (`roles("ROLE_ADMIN")`) lança uma
exception na inicialização — os dois métodos, `authorities()` e `roles()`,
esperam o prefixo de formas exatamente opostas, e trocá-los é uma falha de
inicialização, não uma configuração incorreta silenciosa. `hasAnyRole(String...)`
espelha `hasAnyAuthority()` para o caso de múltiplas roles.

### A válvula de escape: `access()` com uma expressão SpEL crua

Para qualquer coisa que os métodos nomeados não consigam expressar, `access()`
recebe uma string em Spring Expression Language (SpEL) avaliada em tempo de
request:

```java
String expression = "hasAuthority('read') and !hasAuthority('delete')";

http.authorizeRequests()
     .anyRequest()
     .access(expression);
```

Isso deixa John (que só possui `read`) passar enquanto bloqueia Jane (que
possui `read`, `write` *e* `delete`) — uma regra que "tem uma permissão mas não
outra" não tem equivalente direto só com `hasAuthority()`/`hasAnyAuthority()`.
SpEL também não se limita a checagens de authority — uma condição genuinamente
arbitrária, como uma restrição por horário do dia, é igualmente expressável:

```java
T(java.time.LocalTime).now().isAfter(T(java.time.LocalTime).of(12, 0))
```

### Bloqueando tudo: `denyAll()`

A imagem espelhada de `permitAll()` — todo request para uma regra
correspondente é rejeitado de vez, autenticado ou não:

```java
http.authorizeRequests()
     .anyRequest().denyAll();
```

Concretamente útil para o inverso de uma allow-list: um serviço de gateway que
deveria servir só um caminho específico pode usar `denyAll()` para tudo o
resto, em vez de tentar enumerar cada caminho que *não* deveria servir.

## Trade-offs

- **`hasAuthority()`/`hasRole()` se leem claramente e permanecem
  depuráveis; `access()` troca essa legibilidade por poder expressivo cru.** A
  própria recomendação do livro é explícita: recorra primeiro aos métodos
  nomeados, e só desça para o SpEL de `access()` quando uma regra genuinamente
  não puder ser expressa com eles — não como hábito padrão, já que uma string
  SpEL é opaca para verificação em tempo de compilação e mais difícil de ler
  de relance do que uma chamada de método nomeado.
- **A assimetria do prefixo `ROLE_` é um erro real e fácil, não um detalhe de
  documentação.** `authorities("ROLE_ADMIN")` (com prefixo) combinado com
  `hasRole("ADMIN")` (sem prefixo) está correto; trocar qualquer lado quebra
  silenciosamente para `authorities()`/`hasAuthority()`, ou ruidosamente (uma
  exception) para `roles()` se o prefixo for incluído onde não deveria:
  ```java
  // roles() rejects an already-prefixed value — throws at startup
  User.withUsername("john").roles("ROLE_ADMIN").build();
  ```
- **Roles são authorities disfarçadas, não um mecanismo separado.** Tratá-las
  como conceitos não relacionados (em vez de "uma authority cujo nome por
  acaso começa com `ROLE_`") faz a regra do prefixo parecer arbitrária, em vez
  de se explicar sozinha — o mesmo contrato `GrantedAuthority` sustenta as
  duas.
- **`denyAll()` é uma ferramenta rara por um motivo.** A maioria das
  necessidades de autorização é "permitir sob estas condições", o que
  `hasAuthority()`/`hasRole()`/`permitAll()` já cobrem; recorrer a `denyAll()`
  só faz sentido para o formato inverso — bloquear ativamente uma categoria
  inteira de request — que é incomum o bastante para o livro sinalizar como
  um caso minoritário, não uma ferramenta de primeira escolha.
- **Livro vs. hoje: `authorizeRequests()` e o `access()` baseado em string
  sumiram, substituídos por `authorizeHttpRequests()` e um
  `AuthorizationManager` tipado.** O estilo do livro
  `http.authorizeRequests().anyRequest().hasAuthority(...)` é construído sobre
  `WebSecurityConfigurerAdapter`/`FilterSecurityInterceptor`, ambos removidos
  desde o Spring Security 6.0 em favor de um bean `SecurityFilterChain` e
  `AuthorizationFilter` (a mesma migração já documentada para outros conceitos
  do Spring Security neste workflow). Os métodos nomeados em si —
  `hasAuthority()`, `hasAnyAuthority()`, `hasRole()`, `hasAnyRole()`,
  `permitAll()`, `denyAll()` — persistem com os mesmos nomes e comportamento,
  agora dentro de `authorizeHttpRequests()`:
  ```java
  @Bean
  SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
      http.authorizeHttpRequests(authorize -> authorize
          .anyRequest().hasRole("ADMIN")
      );
      return http.build();
  }
  ```
  O `access("hasAuthority('read') and !hasAuthority('delete')")` com string
  crua do livro não tem equivalente direto, porém — `access()` hoje recebe um
  `AuthorizationManager`, não uma `String`. O caminho de migração oficialmente
  documentado para exatamente esse caso é `WebExpressionAuthorizationManager`,
  que envolve uma string SpEL legada por trás da nova interface tipada:
  ```java
  .anyRequest().access(
      new WebExpressionAuthorizationManager("hasAuthority('read') and !hasAuthority('delete')")
  )
  ```
  Confirmado pela referência atual do Spring Security e pelo guia de migração
  5.8 — isso é uma quebra de API real para quem copia os exemplos de
  `access()` do livro ao pé da letra, não um rename cosmético.
- **Livro vs. hoje (capacidade nova, não uma correção): `hasAllAuthorities()`
  e `hasAllRoles()` são métodos novos que não existiam na versão do livro.**
  Eles expressam "o usuário precisa de *todas* estas", o equivalente em AND de
  `hasAnyAuthority()`/`hasAnyRole()`'s OR — um caso que o livro só conseguia
  alcançar via a válvula de escape SpEL de `access()`
  (`hasAuthority('read') and hasAuthority('write')`), agora disponível como um
  método nomeado e type-safe:
  ```java
  .requestMatchers("/db/**").hasAllAuthorities("db", "ROLE_ADMIN")
  ```

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 7, "Configuring authorization: Restricting access", section 7.1, p. 153-171 — doc
- [Spring Security Reference — Authorize HttpServletRequests](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html) — doc
- [Spring Security API — WebExpressionAuthorizationManager](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/web/access/expression/WebExpressionAuthorizationManager.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
