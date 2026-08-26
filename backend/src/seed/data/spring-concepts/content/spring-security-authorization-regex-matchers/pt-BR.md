---
version: 1.0
updatedAt: 2026-08-05
title: Autorização no Spring Security — Regex Matchers como Último Recurso
summary: Como regexMatchers() casa o path completo de uma requisição contra uma expressão regular quando os matchers MVC e Ant não conseguem expressar a regra — como uma condição que abrange duas variáveis de path ao mesmo tempo — e por que o conselho do próprio livro de preferir matchers legíveis ainda vale hoje, via o RegexRequestMatcher, explícito e ainda atual.
---
## Objective

Os dois conceitos irmãos sobre métodos matcher cobrem `mvcMatchers()`/`requestMatchers()`
(8.1-8.2) e `antMatchers()` (8.3) — ambos casam paths usando a sintaxe de
wildcard estilo Ant (`*`, `**`, e uma restrição limitada `{var:regex}` em
uma única variável de path). A seção 8.4 cobre a válvula de escape para
quando nem isso é expressivo o suficiente: `regexMatchers()`, que casa o
path *inteiro* da requisição contra uma expressão regular completa em vez
de um padrão wildcard. O enquadramento do próprio livro é direto — regexes
são a opção mais poderosa e a última que você deveria usar, porque o que
ganham em expressividade perdem em legibilidade.

## Use Cases

- Uma regra que depende de *múltiplas* variáveis de path ao mesmo tempo (o
  exemplo do livro: `/video/{country}/{language}`, onde o conjunto
  permitido é "EUA, Canadá ou Reino Unido, OU inglês" — uma condição que
  abrange dois segmentos de path juntos, não apenas um).
- Casar paths pelo formato do conteúdo, não pela estrutura de segmentos —
  "qualquer path contendo algo parecido com um número de telefone ou
  endereço de e-mail" — onde não há forma limpa de expressar a regra como
  uma sequência de segmentos literais e wildcards.
- Rejeitar paths contendo símbolos ou caracteres específicos ao longo de
  todo o path, não apenas dentro do valor de uma variável de path.
- Como último recurso deliberado, depois de confirmar que um matcher MVC ou
  Ant (incluindo a própria restrição `{var:regex}` de uma única variável de
  path) realmente não consegue expressar a regra — o livro trata essa
  ordem como o padrão correto, não uma questão de estilo.

## Deep Dive

### As duas sobrecargas de `regexMatchers()`

```java
regexMatchers(HttpMethod method, String regex) // regex + um método HTTP específico
regexMatchers(String regex)                     // regex, qualquer método HTTP
```

Mesmo formato de `mvcMatchers()`/`antMatchers()`: fixe um método HTTP quando
verbos diferentes nos mesmos paths precisam de regras diferentes, ou omita
quando a regra se aplica independentemente do método.

### Uma única variável de path: a regex ainda cabe dentro de um matcher MVC

Antes de recorrer a um matcher de regex isolado, vale notar que o livro já
mostrou (8.3) que o formato de uma *única* variável de path pode ser
restringido sem sair da sintaxe MVC/Ant — a regex vive dentro do segmento
`{var:regex}`:

```java
http.authorizeRequests()
    .mvcMatchers("/email/{email:.*(.+@.+\\.com)}")
       .permitAll()
    .anyRequest()
       .denyAll();
```

```
curl http://localhost:8080/email/jane@example.com   → "Allowed for email jane@example.com"
curl http://localhost:8080/email/jane@example.net   → 401 Unauthorized
```

Isso só funciona porque a condição diz respeito a uma variável de path
isolada. No momento em que uma regra precisa raciocinar sobre *mais de uma*
variável de path junto, esse truque se esgota.

### O endpoint que precisa de um matcher de regex de verdade

```java
@RestController
public class VideoController {

    @GetMapping("/video/{country}/{language}")
    public String video(@PathVariable String country,
                         @PathVariable String language) {
        return "Video allowed for " + country + " " + language;
    }
}
```

O requisito: qualquer usuário autenticado pode assistir se a requisição vem
dos EUA, Canadá ou Reino Unido, *ou* se o idioma é inglês — uma condição que
abrange `{country}` e `{language}` juntos. Nem um matcher MVC nem um Ant
(nem uma restrição `{var:regex}` isolada) conseguem expressar "este
segmento OU aquele segmento" entre duas variáveis de path diferentes; uma
regex casada contra o path inteiro consegue:

```java
@Configuration
public class ProjectConfig extends WebSecurityConfigurerAdapter {

    @Bean
    public UserDetailsService userDetailsService() {
        var uds = new InMemoryUserDetailsManager();
        uds.createUser(User.withUsername("john")
                .password("12345").authorities("read").build());
        uds.createUser(User.withUsername("jane")
                .password("12345").authorities("read", "premium").build());
        return uds;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return NoOpPasswordEncoder.getInstance();
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.httpBasic();

        http.authorizeRequests()
            .regexMatchers(".*/(us|uk|ca)+/(en|fr).*")
                .authenticated()
            .anyRequest()
                .hasAuthority("premium");
    }
}
```

A regex casa qualquer path contendo `us`, `uk` ou `ca` seguido depois por
`en` ou `fr` — deliberadamente mais frouxa do que o requisito em português
claro (ela também casaria, por exemplo, `/video/us/fr`), mas suficiente
para o exemplo trabalhado no livro. Requisições que casam só precisam estar
autenticadas; todo o resto cai na regra `anyRequest()` e precisa da
authority `"premium"`:

```
curl -u john:12345 http://localhost:8080/video/us/en   → "Video allowed for us en"
curl -u john:12345 http://localhost:8080/video/fr/fr    → 403 Forbidden  (john lacks "premium")
curl -u jane:12345 http://localhost:8080/video/fr/fr    → "Video allowed for fr fr"  (jane has "premium")
```

John (só `"read"`) consegue acessar o path US/inglês porque ele só exige
autenticação, mas é negado no path FR/francês, já que este cai no
fallback `hasAuthority("premium")`. Jane (`"read"` + `"premium"`) consegue
acessar os dois.

## Trade-offs

- **Regexes conseguem expressar qualquer condição de path que a sintaxe
  MVC/Ant não consegue — a um custo real de legibilidade.** O próprio
  exemplo final do livro é uma regex completa de validação de e-mail,
  oferecida especificamente para deixar claro que "fácil de ler" não é uma
  propriedade que regexes têm de forma confiável, mesmo para um formato bem
  conhecido:
  ```
  (?:[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*|"...)@(?:...)
  ```
  Compare isso com a restrição MVC de variável única acima
  (`{email:.*(.+@.+\\.com)}`) — ainda uma regex, mas restrita a uma
  variável e lida no contexto do path a que pertence, o que explica por que
  o livro trata essa forma como aceitável e uma chamada isolada a
  `regexMatchers()` como o recurso de última instância.
- **Um matcher de regex é opaco em relação à própria estrutura de variáveis
  de path do endpoint.** `.regexMatchers(".*/(us|uk|ca)+/(en|fr).*")` não
  tem ideia de que `{country}` e `{language}` existem como segmentos
  nomeados — ele apenas casa a string bruta do path. Um matcher MVC ou Ant,
  em contraste, espelha o próprio mapeamento do controller, então um
  leitor consegue comparar `/video/{country}/{language}` diretamente com
  `mvcMatchers("/video/**")`; não há comparação direta equivalente para uma
  regex escrita contra a URL inteira.
- **Regexes frouxas podem aceitar mais do que o pretendido.** O próprio
  exemplo do livro casa `us`, `uk` ou `ca` *e* `en` ou `fr` em qualquer
  combinação, incluindo `/video/us/fr` — um casamento mais amplo do que a
  regra em português claro ("EUA/Canadá/Reino Unido, ou inglês")
  tecnicamente pedia. Fazer uma regex casar *exatamente* o conjunto
  pretendido, e nada mais, é mais difícil do que escrever a regra wildcard
  equivalente teria sido, se wildcards conseguissem expressar a condição.
- **Livro vs. hoje: o método de chain sumiu, mas o mecanismo que ele expunha
  continua aí e ainda é atual.** `regexMatchers()` foi depreciado junto com
  `mvcMatchers()`/`antMatchers()` no Spring Security 5.8 e removido na 6.0
  em favor de um único método `requestMatchers()`. Diferente do matching
  Ant/MVC, cujo substituto (`PathPatternRequestMatcher`) agora é o default
  automático para todo padrão de string simples (veja o conceito irmão
  sobre matchers Ant), o matching por regex não é algo que
  `requestMatchers(String)` faz implicitamente — ele continua sendo um
  matcher explícito e separado que você passa: `RegexRequestMatcher`, via
  sua factory estática `regexMatcher(...)`, confirmado como atual e não
  depreciado na referência do Spring Security 7.1:
  ```java
  http.authorizeHttpRequests(authorize -> authorize
      .requestMatchers(RegexRequestMatcher.regexMatcher(".*/(us|uk|ca)+/(en|fr).*"))
          .authenticated()
      .anyRequest()
          .hasAuthority("premium")
  );
  ```
  O próprio conselho do livro — preferir a sintaxe MVC/Ant, recorrer à
  regex só quando nada mais expressa a regra — permanece inalterado; só o
  ponto de chamada mudou, de um método de chain dedicado `regexMatchers()`
  para uma instância explícita de `RequestMatcher` passada para o ponto de
  entrada unificado `requestMatchers()`.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 8, "Configuring authorization: Applying restrictions", section 8.4, "Selecting requests for authorization using regex matchers", p. 190-194 — doc
- [Spring Security Reference — Authorize HttpServletRequests (Matching Using Regular Expressions)](https://docs.spring.io/spring-security/reference/servlet/authorization/authorize-http-requests.html#match-by-regex) — doc
- [Spring Security API — RegexRequestMatcher](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/web/util/matcher/RegexRequestMatcher.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
- [Spring Security Reference — Web Migrations for 7.0 (AntPathRequestMatcher/MvcRequestMatcher removed, PathPatternRequestMatcher)](https://docs.spring.io/spring-security/reference/6.5/migration-7/web.html) — doc
