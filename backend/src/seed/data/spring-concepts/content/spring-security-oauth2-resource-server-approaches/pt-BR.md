---
version: 1.0
updatedAt: 2026-08-06
title: "OAuth 2 Resource Server: Checagem Remota, Blackboarding e Validação Local"
---
## Objective

Entender o último componente do quebra-cabeça OAuth 2: o **resource
server**, a aplicação que guarda os dados do usuário e precisa decidir se
honra um access token que ela *não emitiu e não consegue inspecionar
sozinha*. Essa única restrição — "alguém me entregou uma string opaca, ela é
real, e a quem pertence?" — gera exatamente três respostas, e o livro
percorre duas delas: perguntar ao authorization server a cada request
(**checagem remota de token**), ou compartilhar um datastore com o
authorization server (**blackboarding**). A terceira, validar uma assinatura
criptográfica localmente sem nenhum round-trip, é trabalho do capítulo 15
(veja `spring-security-jwt-signing-symmetric-and-asymmetric`). Hoje a
primeira abordagem é padronizada como **OAuth 2.0 Token Introspection (RFC
7662)** e configurada com `.opaqueToken(...)`; a terceira é `.jwt(...)`; e
blackboarding sobrevive só como um `OpaqueTokenIntrospector` custom, nunca
como o `TokenStore` do livro.

## Use Cases

- Proteger uma API REST com `Authorization: Bearer ...` quando os tokens vêm
  de um authorization server que você mesmo roda
  (`spring-security-oauth2-authorization-server`) ou de um IdP terceiro
  (Keycloak, Auth0, Okta, Entra ID).
- Escolher uma estratégia de validação sob uma restrição real: "precisamos
  conseguir revogar um token em segundos" empurra para introspection; "a API
  precisa sobreviver ao IdP estando fora do ar" empurra para validação de
  assinatura.
- Migrar um serviço `@EnableResourceServer` /
  `ResourceServerConfigurerAdapter` existente para fora do projeto Spring
  Security OAuth, que está em fim de vida.
- Decidir se a tabela de tokens compartilhada que sua equipe herdou (o
  padrão de blackboarding) deveria ser mantida, substituída por
  introspection, ou substituída por JWTs.
- Ler a identidade e os scopes do token dentro de um controller —
  `JwtAuthenticationToken` / `BearerTokenAuthentication`, authorities com
  prefixo `SCOPE_` — em vez de re-parsear headers.

## Deep Dive

### O único problema difícil do resource server

O resource server gerencia e protege os recursos do usuário. Ele nunca vê as
credenciais do usuário, nunca executa um grant flow, e (com tokens opacos)
não consegue ler nada de dentro do próprio token — o authorization server do
livro emite um UUID puro como
`4f2b7a6d-ced2-43dc-86d7-cbe844d3e16b`. Então todo design aqui gira em torno
de como o resource server adquire os dois fatos de que precisa: **esse token
é válido**, e **quais authorities ele carrega**.

```mermaid
flowchart TB
    Client["Client<br/>Authorization: Bearer f124abc…"]
    RS["Resource server<br/>/hello"]
    AS["Authorization server"]
    DB[("Shared database<br/>oauth_access_token")]
    JWK["JWK set / public key<br/>(fetched once, cached)"]

    Client -->|"1. request + token"| RS

    RS -->|"A. remote check: 1 call per request<br/>POST /oauth/check_token (RFC 7662 /oauth2/introspect)"| AS
    AS -.->|"active, sub, scope, exp"| RS

    RS -->|"B. blackboarding: read the token row"| DB
    AS -.->|"writes the token on issue"| DB

    RS -->|"C. local validation: verify signature offline"| JWK
    AS -.->|"publishes keys once"| JWK
```

O caminho A custa um salto de rede por request e acopla disponibilidade. O
caminho B remove a chamada direta mas adiciona um componente compartilhado
do qual os dois servidores dependem. O caminho C não custa nada por request
mas abre mão da revogação instantânea. Não existe opção grátis.

### O resource server do livro: uma annotation, nenhuma validação

```xml
<dependency>
   <groupId>org.springframework.boot</groupId>
   <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
</dependency>
<dependency>
   <groupId>org.springframework.cloud</groupId>
   <artifactId>spring-cloud-starter-oauth2</artifactId>
</dependency>
```

```java
@RestController
public class HelloController {

    @GetMapping("/hello")
    public String hello() {
        return "Hello!";
    }
}
```

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig {
}
```

Isso é um resource server rodando — e inútil. Ele rejeita todo request,
inclusive requests carregando tokens perfeitamente válidos, porque nenhuma
estratégia de validação foi configurada. O livro é explícito que
`@EnableResourceServer` (Spring Security OAuth) já estava marcado como
deprecated quando foi escrito, e aponta para o OAuth 2.0 Migration Guide.

### Abordagem 1 — checando o token remotamente

O mecanismo tem dois passos: o authorization server expõe um endpoint que,
dado um token, retorna se ele está ativo mais os detalhes por trás dele; o
resource server chama esse endpoint a cada request com um token
desconhecido.

O authorization server do Spring Security OAuth já implementa
`/oauth/check_token`, mas nega todo acesso a ele por default. Você o abre
sobrescrevendo mais um método `configure`:

```java
@Configuration
@EnableAuthorizationServer
public class AuthServerConfig
    extends AuthorizationServerConfigurerAdapter {

    public void configure(
        AuthorizationServerSecurityConfigurer security) {
        security.checkTokenAccess("isAuthenticated()");
    }
}
```

`permitAll()` também funciona e é exatamente tão má ideia quanto parece.
Com `isAuthenticated()`, o resource server se torna *um client do
authorization server* e precisa do seu próprio registro — sem grant types,
sem scopes, só credenciais para HTTP Basic na chamada de introspection:

```java
clients.inMemory()
       .withClient("client")
       .secret("secret")
       .authorizedGrantTypes("password", "refresh_token")
       .scopes("read")
       .and()
       .withClient("resourceserver")
       .secret("resourceserversecret");
```

Chamar isso manualmente mostra exatamente o que o resource server recebe de
volta:

```bash
curl -XPOST -u resourceserver:resourceserversecret \
  "http://localhost:8080/oauth/check_token?token=4f2b7a6d-ced2-43dc-86d7-cbe844d3e16b"
```

```json
{
    "active":true,
    "exp":1581307166,
    "user_name":"john",
    "authorities":["read"],
    "client_id":"client",
    "scope":["read"]
}
```

Quatro fatos: ainda ativo e quando expira, para quem foi emitido, os
privilégios, e qual client o obteve. No lado do resource server toda a
configuração é feita em propriedades:

```properties
server.port=9090
security.oauth2.resource.token-info-uri=http://localhost:8080/oauth/check_token
security.oauth2.client.client-id=resourceserver
security.oauth2.client.client-secret=resourceserversecret
```

```bash
curl -H "Authorization: bearer 4f2b7a6d-ced2-43dc-86d7-cbe844d3e16b" \
  "http://localhost:9090/hello"
```

O prefixo `bearer` é case-insensitive. Sem token você recebe `401` com
`{"error":"unauthorized"}`.

A vantagem é que isso funciona com *qualquer* formato de token — o resource
server nunca parseia nada. As desvantagens que o livro enfatiza: carga no
authorization server, e o fato de que a rede não é 100% confiável. Se o
link entre os dois servidores cair, um client segurando um token
perfeitamente válido é recusado.

### Abordagem 2 — blackboarding com um `JdbcTokenStore`

Os dois servidores escrevem em e leem do mesmo "quadro-negro": o
authorization server armazena cada token emitido, o resource server o
busca. Nenhuma chamada direta entre eles.

O contrato dos dois lados é `TokenStore`. No authorization server ele fica
onde `SecurityContext` ficaria numa aplicação baseada em sessão — a
autenticação termina, o token store produz um token. No resource server o
filter de autenticação usa o mesmo contrato ao contrário: busca o token,
recupera os detalhes do usuário, os coloca no contexto de segurança para
autorização. O default é `InMemoryTokenStore`, que é por que todo exemplo
anterior perdia todos os tokens ao reiniciar.

`JdbcTokenStore` é o `JdbcUserDetailsManager` dos tokens. Ele espera duas
tabelas com nomes default fixos (sobrescrevíveis substituindo o SQL):

```sql
CREATE TABLE IF NOT EXISTS `oauth_access_token` (
    `token_id` varchar(255) NOT NULL,
    `token` blob,
    `authentication_id` varchar(255) DEFAULT NULL,
    `user_name` varchar(255) DEFAULT NULL,
    `client_id` varchar(255) DEFAULT NULL,
    `authentication` blob,
    `refresh_token` varchar(255) DEFAULT NULL,
     PRIMARY KEY (`token_id`));

CREATE TABLE IF NOT EXISTS `oauth_refresh_token` (
    `token_id` varchar(255) NOT NULL,
    `token` blob,
    `authentication` blob,
    PRIMARY KEY (`token_id`));
```

Authorization server — injeta o `DataSource`, entrega o store ao
configurer de endpoints:

```java
@Override
public void configure(
    AuthorizationServerEndpointsConfigurer endpoints) {
    endpoints
        .authenticationManager(authenticationManager)
        .tokenStore(tokenStore());
}

@Bean
public TokenStore tokenStore() {
    return new JdbcTokenStore(dataSource);
}
```

Resource server — o mesmo bean, entregue a um configurer diferente:

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig
    extends ResourceServerConfigurerAdapter {

    @Autowired
    private DataSource dataSource;

    @Override
    public void configure(
        ResourceServerSecurityConfigurer resources) {
        resources.tokenStore(tokenStore());
    }

    @Bean
    public TokenStore tokenStore() {
        return new JdbcTokenStore(dataSource);
    }
}
```

Emita um token e ele aparece como uma linha em `oauth_access_token` (e, se
o client tiver `refresh_token`, em `oauth_refresh_token`). Como o banco de
dados os persiste, o resource server continua validando tokens **mesmo
enquanto o authorization server está fora do ar ou reiniciando** — a única
capacidade que nenhuma das outras duas abordagens dá a você.

Existe também um caso degenerado que vale nomear: authorization server e
resource server são duas *responsabilidades*, não necessariamente duas
*aplicações*. Coloque as duas num único app e elas compartilham os mesmos
beans — o mesmo token store, sem chamada de rede, sem banco de dados
compartilhado.

### A comparação do livro, mais a opção que ele adia

| Abordagem | Vantagens | Desvantagens |
| --- | --- | --- |
| Chamar diretamente o authorization server | Fácil de implementar; funciona com qualquer implementação de token | Dependência direta entre os dois servidores; estresse desnecessário no authorization server |
| Banco de dados compartilhado (blackboarding) | Sem comunicação direta entre servidores; funciona com qualquer implementação de token; autorização continua funcionando após um restart ou outage do authorization server | Mais difícil de implementar; mais um componente no sistema; o banco de dados compartilhado pode virar um gargalo |

O resumo do capítulo 14 é mais direto do que a tabela: sobre checagem
remota, "I generally avoid using this approach." E o capítulo 15 abre
nomeando as três opções juntas — chamadas diretas (14.2), banco de dados
compartilhado (14.3), e assinaturas criptográficas — notando que
assinaturas permitem que o resource server valide "without needing to call
the authorization server directly and without needing a shared database",
e que é isso que sistemas implementando OAuth 2 comumente usam.

### Livro vs. hoje: `.opaqueToken()` é o 14.2, e `.jwt()` venceu

O DSL que o livro mostra numa caixa lateral como a alternativa ainda
imatura agora é *a* API, e ambos os ramos dela são opções de primeira
classe, documentadas e auto-configuradas pelo Boot no Spring Security
atual.

**O que sobreviveu, ao pé da letra em espírito.** A caixa lateral do livro
já contém `oauth2ResourceServer(c -> c.opaqueToken(o -> {
o.introspectionUri("…"); o.introspectionClientCredentials("client",
"secret"); }))`. Esse ainda é o formato da API. O que mudou é o container:
`WebSecurityConfigurerAdapter` foi deprecated no Spring Security 5.7 e
removido na 6.0, então agora é um bean `SecurityFilterChain` — e as
dependências manuais extras que o livro precisava listar (uma
`spring-security-oauth2-resource-server:5.2.1.RELEASE` fixada, mais
`com.nimbusds:oauth2-oidc-sdk`) sumiram:
`spring-boot-starter-oauth2-resource-server` é um starter Boot de verdade
que traz o que cada modo precisa.

**Checagem remota de token, hoje.** O `/oauth/check_token` do livro era o
próprio endpoint do Spring Security OAuth, embora sua resposta já tivesse o
formato RFC-7662 (note o campo `active`). Hoje isso é padronizado: **OAuth
2.0 Token Introspection, RFC 7662**. O Spring Authorization Server expõe
isso em `/oauth2/introspect` por default, configurável via
`OAuth2TokenIntrospectionEndpointConfigurer` e servido por
`OAuth2TokenIntrospectionEndpointFilter`. No resource server, a
funcionalidade inteira são três propriedades:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        opaquetoken:
          introspection-uri: https://idp.example.com/introspect
          client-id: client
          client-secret: secret
```

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .authorizeHttpRequests((authorize) -> authorize
            .anyRequest().authenticated()
        )
        .oauth2ResourceServer((oauth2) -> oauth2
            .opaqueToken(Customizer.withDefaults())
        );
    return http.build();
}
```

Por trás disso: `OpaqueTokenAuthenticationProvider` delega a um
`OpaqueTokenIntrospector` (default `SpringOpaqueTokenIntrospector` — seu
construtor `(introspectionUri, clientId, clientSecret)` está deprecated
desde a 6.5 em favor de
`SpringOpaqueTokenIntrospector.withIntrospectionUri(...)...build()`;
`RestClientOpaqueTokenIntrospector` é a variante a usar quando você precisa
de timeouts customizados ou de um `RestClient` pré-configurado). Sucesso
produz uma `BearerTokenAuthentication` cujo principal é um
`OAuth2AuthenticatedPrincipal` carregando a resposta de introspection como
atributos, `getName()` mapeado de `sub`, e cada scope exposto como uma
`GrantedAuthority` prefixada com `SCOPE_`. A chamada de rede por request do
livro não mudou — isso é inerente à abordagem, não um artefato legado.

**Validação local, hoje** — a opção do capítulo 15, só para completar a
comparação:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://idp.example.com/issuer
```

```java
.oauth2ResourceServer((oauth2) -> oauth2.jwt(Customizer.withDefaults()))
```

`NimbusJwtDecoder` descobre o JWK set a partir do endpoint de metadados do
issuer, guarda as chaves em cache, valida assinatura mais `exp`/`nbf`/`iss`
localmente, e produz um `JwtAuthenticationToken` com authorities `SCOPE_`.
Um detalhe que responde diretamente à reclamação de fragilidade de rede do
14.2: essa descoberta acontece **no primeiro request carregando um JWT, não
no startup**, então o startup do resource server não fica acoplado à
disponibilidade do authorization server.

**Blackboarding ainda é uma coisa? Veredito honesto: como arquitetura, não;
como ponto de extensão, sim — e isso não é a mesma coisa.**

- `TokenStore`, `JdbcTokenStore`, `InMemoryTokenStore`,
  `@EnableResourceServer` e `ResourceServerConfigurerAdapter` pertencem
  todos ao Spring Security OAuth, que atingiu fim de vida em 1º de junho de
  2022 e foi arquivado. `JdbcTokenStore` **nunca foi portado**; a
  solicitação de trazê-lo para o Spring Security (issue #9381, aberta por
  alguém querendo exatamente o cache de token stateless multi-instância do
  livro) foi fechada como duplicata, não implementada. O OAuth 2.0
  Migration Guide cobre `@EnableResourceServer` → `oauth2ResourceServer` e
  a mudança de SpEL de `#oauth2.hasScope('x')` para
  `hasAuthority("SCOPE_x")`, mas não oferece nenhum substituto para
  `TokenStore`.
- O Spring Authorization Server *tem* um token store persistente —
  `OAuth2AuthorizationService`, com `InMemoryOAuth2AuthorizationService`
  (apenas desenvolvimento e testes) e `JdbcOAuth2AuthorizationService`. Mas
  é documentado puramente como estado interno de authorization server usado
  para autenticação de client, processamento de grant, introspection e
  revocation. Nada na documentação de referência sugere apontar um resource
  server para ele, e fazer isso significaria uma segunda aplicação lendo o
  schema privado de outra aplicação — o que é o significado de "monólito
  distribuído".
- O que *é* sancionado é a costura. O javadoc de `OpaqueTokenIntrospector`
  diz isso diretamente: "A typical implementation of this interface will
  make a request to an OAuth 2.0 Introspection Endpoint… **Another sensible
  implementation of this interface would be to query a backing store of
  tokens, for example a distributed cache.**" Então a ideia de
  blackboarding tem um gancho oficial — um bean de um método
  (`OAuth2AuthenticatedPrincipal introspect(String token)`) que lê Redis,
  um banco de dados, ou qualquer outra coisa em vez de chamar a rede.

A leitura realista: o *formato* sobrevive, a *motivação* majoritariamente
evaporou. O livro inventou blackboarding porque as ferramentas da época
davam a você um `TokenStore` nos dois lados e uma chamada `check_token`
proprietária e estranha, e porque tokens UUID opacos eram o default. Hoje o
token default é um JWT assinado, então o lookup por request que o
blackboarding existia para evitar geralmente nem está presente para
começar. O uso real mais comum de um `OpaqueTokenIntrospector` custom
respaldado por um store não é substituir introspection — é **cachear**
respostas de introspection para que uma API quente não martele o IdP, o
que endereça a reclamação real do 14.2 sem convidar o acoplamento de schema
compartilhado do 14.3. Blackboarding como "deixe os dois servidores serem
donos da mesma tabela de token" é um padrão que você deveria reconhecer em
código legado e migrar para longe, não um para começar.

**As três abordagens, comparadas no que de fato decide:**

| | Introspection remota (14.2 / `.opaqueToken()`) | Blackboarding (14.3, DB compartilhado) | Validação local de JWT (cap. 15 / `.jwt()`) |
| --- | --- | --- | --- |
| Custo por request | 1 round-trip de rede para o IdP | 1 query de banco de dados | nenhum (checagem de assinatura em processo) |
| Acoplamento | acoplamento em runtime à disponibilidade do IdP | os dois servidores acoplados a um schema | confiança só em build-time; chaves buscadas de forma preguiçosa e cacheadas |
| Sobrevive a outage do IdP | não — tokens válidos são recusados | sim, tokens vivem no DB | sim, até que o JWK set precise ser atualizado |
| Revocation | imediata — `active:false` na próxima chamada | imediata — deletar a linha | não até expirar (precisa de TTLs curtos, denylists, ou introspection ao lado) |
| Formato de token | qualquer um, incluindo UUIDs opacos | qualquer um | precisa ser um JWT assinado |
| Escala | escalando o IdP | escalando o DB compartilhado | escalando os resource servers livremente |
| Suporte moderno | primeira classe, RFC 7662, auto-configurado pelo Boot | sem API suportada; só um `OpaqueTokenIntrospector` custom | primeira classe, o default hoje |

## Trade-offs

- **A troca é custo por request contra latência de revogação, e todo o
  resto é detalhe.** Introspection pergunta à autoridade toda vez, então um
  token revogado morre instantaneamente e a API morre com o IdP. Um JWT
  assinado não pergunta a ninguém, então é rápido e à prova de outage e
  continua válido até `exp` não importa o que o IdP pense. Tempos de vida
  curtos de token são a troca usual; "JWT mais uma denylist" é a admissão
  usual de que você precisava da semântica de introspection afinal.
- **"Qualquer implementação de token" é uma vantagem real das duas
  abordagens do livro.** Ambas funcionam com UUIDs opacos; validação local
  exige que o authorization server emita tokens assinados e autocontidos.
  Se você não controla o IdP e ele entrega strings opacas, `.opaqueToken()`
  não é um fallback, é a única opção.
- **Blackboarding troca uma dependência de rede por uma dependência de
  dados, o que geralmente é uma troca pior.** O livro já nomeia o gargalo;
  o custo mais afiado é o acoplamento de schema — o resource server agora
  quebra quando o authorization server muda como armazena tokens. A própria
  ressalva do livro é a honesta: se seus serviços já compartilham um banco
  de dados, adicionar tokens a ele não muda nada arquiteturalmente.
- **Persistir tokens e blackboarding são separáveis, e o livro diz isso.**
  Usar um `JdbcTokenStore` só no authorization server, ainda validando via
  `check_token`, compra sobrevivência a restarts sem nenhum acoplamento de
  schema compartilhado. Essa decomposição ainda é o instinto certo hoje:
  "os tokens deveriam ser duráveis?" e "quem os lê?" são duas perguntas.
- **O endpoint de introspection precisa de proteção, e o resource server se
  torna um client.** `checkTokenAccess("isAuthenticated()")` mais seu
  próprio registro não é cerimônia — um endpoint de introspection aberto é
  um oráculo grátis para testar tokens roubados. Os equivalentes modernos
  mantêm a mesma postura: `introspection-uri` vem com `client-id` e
  `client-secret`.
- **Um cache compartilhado lido através de um `OpaqueTokenIntrospector`
  custom é o descendente legítimo do blackboarding, e é melhor usado como
  cache, não como fonte de verdade.** Cachear respostas de introspection
  por alguns segundos remove a maior parte da carga com a qual o livro se
  preocupa mantendo o IdP autoritativo; tornar o cache autoritativo
  reintroduz todo problema de acoplamento que o 14.3 tinha.
- **Mesma responsabilidade, uma aplicação, nenhum problema.** Se o
  authorization server e o resource server vivem na mesma aplicação eles
  compartilham beans — sem chamada, sem banco de dados compartilhado, sem
  tabela de comparação. Separá-los é uma decisão de deployment que *cria*
  o problema deste capítulo; tome essa decisão deliberadamente.
- **Tudo estrutural no código deste capítulo sumiu, mas nada conceitual.**
  `@EnableResourceServer`, `ResourceServerConfigurerAdapter`, `TokenStore`
  e `WebSecurityConfigurerAdapter` estão todos removidos ou EOL. As três
  estratégias de validação, seus custos, e a razão pela qual um resource
  server precisa escolher uma são exatamente como o livro as descreve.

## Documentation Links

- [Spring Security in Action (Manning, 2020) — Chapter 14, "OAuth 2: Implementing the resource server", sections 14.1-14.4, p. 341-359](https://www.manning.com/books/spring-security-in-action) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server (overview: JWT vs Opaque Tokens)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/index.html) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server: Opaque Token (RFC 7662 introspection)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/opaque-token.html) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server: JWT](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) — doc
- [Spring Security API — OpaqueTokenIntrospector ("query a backing store of tokens, for example a distributed cache")](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/oauth2/server/resource/introspection/OpaqueTokenIntrospector.html) — doc
- [Spring Security API — SpringOpaqueTokenIntrospector](https://docs.spring.io/spring-security/reference/api/java/org/springframework/security/oauth2/server/resource/introspection/SpringOpaqueTokenIntrospector.html) — doc
- [Spring Authorization Server Reference — Protocol Endpoints (OAuth2 Token Introspection Endpoint, default paths)](https://docs.spring.io/spring-authorization-server/reference/protocol-endpoints.html) — doc
- [Spring Authorization Server Reference — Core Model / Components (OAuth2AuthorizationService, JdbcOAuth2AuthorizationService)](https://docs.spring.io/spring-authorization-server/reference/core-model-components.html) — doc
- [GitHub Wiki — OAuth 2.0 Migration Guide (@EnableResourceServer to oauth2ResourceServer)](https://github.com/spring-projects/spring-security/wiki/OAuth-2.0-Migration-Guide) — doc
- [GitHub — spring-security issue #9381, "Introduce JdbcTokenStore" (closed as duplicate; never ported)](https://github.com/spring-projects/spring-security/issues/9381) — doc
- [Spring Boot Reference — Spring Security (spring-boot-starter-oauth2-resource-server auto-configuration)](https://docs.spring.io/spring-boot/reference/web/spring-security.html) — doc
- [RFC 7662 — OAuth 2.0 Token Introspection](https://datatracker.ietf.org/doc/html/rfc7662) — doc
