---
version: 1.0
updatedAt: 2026-08-06
title: "Keycloak como Authorization Server para um Resource Server Spring"
---
## Objective

O capítulo 13 construiu um authorization server *em código*; os capítulos 14
e 15 construíram um resource server que confia nos JWTs que ele mesmo
emite. Este capítulo muda exatamente uma variável: o issuer agora é o
**Keycloak**, um identity provider real, baixável, pronto para produção, em
vez de uma classe Spring que você escreveu. Nada sobre o trabalho do
resource server muda — ele continua recebendo `Authorization: Bearer
<jwt>`, continua validando a assinatura contra um endpoint de JWK set,
continua transformando claims em objetos `GrantedAuthority`. O que muda é
*onde a configuração vive*: usuários, clients, scopes, roles e até o
formato das claims do token saem do Java e vão para um console de
administração. Este conceito é a ponta prática do arco de OAuth 2 — a
resposta para "então eu escrevo mesmo um authorization server?" geralmente
é "não, você roda um", e é isso que isso parece na prática.

## Use Cases

- Levantar um provedor OAuth 2 / OIDC local para desenvolvimento sem
  escrever uma linha de código de authorization server — realm, client,
  usuários e roles configurados numa UI.
- Apontar um resource server Spring Boot existente para um identity
  provider corporativo (Keycloak, Okta, Auth0, Entra ID) — a `issuer-uri` é
  a única coisa que meaningfully difere entre eles.
- Mapear o *próprio* modelo de role de um identity provider (realm roles e
  client roles do Keycloak) para o modelo `GrantedAuthority` do Spring, para
  que `hasAuthority(...)` e `@PreAuthorize` continuem funcionando sem
  mudanças.
- Reforçar "um usuário só toca nos próprios dados" em três camadas
  diferentes — endpoint, método de service, query de repository — em cima
  de um token que a aplicação não emitiu.
- Migrar uma aplicação para fora do `keycloak-spring-boot-starter`, que o
  Keycloak removeu.

## Deep Dive

### O cenário: um backend de fitness, três regras, duas roles

O exemplo do livro é um backend de histórico de treinos com três casos de
uso, cada um carregando sua própria restrição de autorização (seções 18.1,
p. 434-436):

| Endpoint | Regra | Reforçada em |
| --- | --- | --- |
| `POST /workout/` | um usuário pode adicionar um registro só **para si mesmo** | camada de service (`@PreAuthorize`) |
| `GET /workout/` | um usuário recebe de volta **só os próprios** registros | camada de repository (SpEL na query) |
| `DELETE /workout/{id}` | só um **admin** pode deletar | camada de endpoint (`hasAuthority`) |

Duas roles: `fitnessuser` (adicionar/ver os próprios treinos) e
`fitnessadmin` (deletar de qualquer um). O ponto de espalhar as três regras
por três camadas é deliberado — o livro nota que escolheu configurar a
regra de delete no nível do endpoint "to cover more ways for configuring
authorization", não porque esse seja o único lugar correto.

Os atores são os quatro padrão do OAuth 2, com o Keycloak no lugar de
authorization server:

```mermaid
flowchart LR
    User(["User<br/>(Bill, Rachel, Mary)"])
    Client["Client app<br/>(registered in Keycloak<br/>as 'fitnessapp')"]
    KC["Keycloak realm<br/>· users + credentials<br/>· realm/client roles<br/>· protocol mappers<br/>· /protocol/openid-connect/token<br/>· /protocol/openid-connect/certs (JWKS)"]
    RS["Spring Boot resource server<br/>:9090<br/>· validates signature via JWKS<br/>· maps claims to authorities<br/>· enforces the three rules"]

    User -->|"credentials"| Client
    Client -->|"token request"| KC
    KC -->|"signed JWT access token"| Client
    Client -->|"Authorization: Bearer JWT"| RS
    RS -.->|"fetches public keys once,<br/>then validates offline"| KC
```

A linha pontilhada importa: o resource server nunca chama o Keycloak por
request. Ele busca o key set, o cacheia, e valida assinaturas localmente —
a abordagem criptográfica de
`spring-security-jwt-signing-symmetric-and-asymmetric`, com um par de
chaves assimétricas que o Keycloak gerou para o realm.

### Configurando o Keycloak: cinco coisas, tudo no console de administração

O Keycloak é baixado, descompactado e iniciado; no primeiro acesso você
cria uma conta de admin, depois faz login no Administration Console (seção
18.2, p. 436-440). A configuração são cinco passos conceituais — as telas
específicas foram redesenhadas várias vezes desde o livro, então o que
importa é *o que* cada passo cria:

1. **Um realm.** Um realm é um tenant isolado: seus próprios usuários,
   roles, clients, e suas próprias signing keys. Tudo abaixo vive dentro de
   um.
2. **Um registro de client** (`fitnessapp`). Todo sistema OAuth 2 precisa
   de pelo menos um client que o authorization server reconheça; o client é
   o que faz requests de autenticação em nome dos usuários. O registro
   mínimo do livro é só um client ID único.
3. **Um client scope** (`fitnessapp`), definido para o protocolo
   `openid-connect` e atribuído ao client como scope default. O scope
   identifica o propósito do client — e, crucialmente, é o gancho que o
   livro usa no passo 5 para customizar tokens.
4. **Usuários** (`bill`, `rachel`, `mary`) com senhas não-temporárias. Duas
   armadilhas práticas que o livro aponta: um usuário com *required
   actions* pendentes não consegue se autenticar de forma alguma, e uma
   senha marcada como **Temporary** adiciona implicitamente a required
   action "update password" — então tokens não podem ser emitidos para
   esse usuário até que um humano faça login e a mude.
5. **Roles** (`fitnessuser`, `fitnessadmin`) criadas no realm e atribuídas
   a usuários via Role Mappings — Mary recebe `fitnessadmin`, Bill e Rachel
   recebem `fitnessuser`.

O Keycloak publica seus endpoints OAuth 2 / OIDC através de um documento de
discovery padrão. O livro os lê do link OpenID Endpoint Configuration na
página de configurações do realm:

```json
{
  "issuer": "http://localhost:8080/auth/realms/master",
  "authorization_endpoint": ".../protocol/openid-connect/auth",
  "token_endpoint": ".../protocol/openid-connect/token",
  "jwks_uri": ".../protocol/openid-connect/certs",
  "grant_types_supported": [
    "authorization_code", "implicit", "refresh_token",
    "password", "client_credentials"
  ]
}
```

Vale a pena parar nessa lista `grant_types_supported`: habilitar um grant
type é uma decisão de client registration aqui exatamente como era em
`spring-security-oauth2-authorization-server` — a mesma ideia, expressa
como um checkbox em vez de `authorizedGrantTypes("password")`.

### Obtendo um token, e o encontrando meio vazio

Com os usuários configurados, um token vem de um POST simples
form-encoded para o token endpoint. O livro usa o password grant para
manter o exemplo curto (p. 446):

```bash
curl -XPOST "http://localhost:8080/auth/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "username=rachel" \
  --data-urlencode "password=12345" \
  --data-urlencode "scope=fitnessapp" \
  --data-urlencode "client_id=fitnessapp"
```

```json
{
  "access_token": "eyJhbGciOiJIUzI…",
  "expires_in": 6000,
  "refresh_token": "eyJhbGciOiJIUz…",
  "token_type": "bearer",
  "scope": "fitnessapp"
}
```

Decodifique o access token e a parte interessante é o que está *faltando* —
nenhuma role, nenhum username:

```json
{
  "exp": 1585392296,
  "iss": "http://localhost:8080/auth/realms/master",
  "sub": "c42b534f-7f08-4505-8958-59ea65fb3b47",
  "typ": "Bearer",
  "azp": "fitnessapp",
  "scope": "fitnessapp"
}
```

O `sub` é um UUID opaco, não `rachel`. As roles atribuídas no passo 5 não
estão ali de forma alguma. Um resource server que recebe esse token sabe
que *alguém* se autenticou, e nada mais útil para as três regras.

### Protocol mappers: dobrando o token para atender às expectativas do resource server

A resposta do Keycloak são os **protocol mappers**, anexados ao client
scope (seção 18.2.4, p. 448-452). Cada mapper copia um pedaço de
informação para o token sob um nome de claim que você escolhe. O livro
adiciona três:

- um mapper de **roles** escrevendo na claim `authorities`,
- um mapper de **username** escrevendo na claim `user_name`,
- um mapper de **audience** escrevendo `aud: fitnessapp`.

O token então carrega o que o resource server precisa:

```json
{
  "iss": "http://localhost:8080/auth/realms/master",
  "aud": "fitnessapp",
  "sub": "c42b534f-7f08-4505-8958-59ea65fb3b47",
  "azp": "fitnessapp",
  "scope": "fitnessapp",
  "user_name": "rachel",
  "authorities": ["fitnessuser"]
}
```

Por que *esses* nomes de claim? Porque o token converter do Spring
Security OAuth lê exatamente `authorities` e `user_name`. O livro está
remodelando o identity provider para bater com as expectativas de uma
client library. Essa direção de adaptação é a decisão mais desatualizada de
todo o capítulo — veja a seção livro-vs-hoje abaixo, onde a abordagem
moderna adapta a *client library* às claims nativas do Keycloak em vez do
contrário.

A claim `aud` (audience) é de natureza diferente: ela nomeia o destinatário
pretendido do token. O resource server é configurado com o mesmo valor e
rejeita tokens emitidos para qualquer outro alvo, que é o que impede que um
token cunhado para um serviço diferente seja reproduzido contra este.

### O resource server, edição do livro

As dependências são `spring-boot-starter-security`,
`spring-boot-starter-web`, `spring-cloud-starter-oauth2`,
`spring-boot-starter-data-jpa`, `spring-security-data` e um driver JDBC. A
configuração são duas propriedades mais o datasource (p. 457-458):

```properties
server.port=9090
claim.aud=fitnessapp
jwkSetUri=http://localhost:8080/auth/realms/master/protocol/openid-connect/certs
```

```java
@Configuration
@EnableResourceServer
@EnableGlobalMethodSecurity(prePostEnabled = true)
public class ResourceServerConfig
    extends ResourceServerConfigurerAdapter {

    @Value("${claim.aud}") private String claimAud;
    @Value("${jwkSetUri}") private String urlJwk;

    @Override
    public void configure(ResourceServerSecurityConfigurer resources) {
        resources.tokenStore(tokenStore());
        resources.resourceId(claimAud);          // expected aud claim
    }

    @Bean
    public TokenStore tokenStore() {
        return new JwkTokenStore(urlJwk);        // multi-key, keyed by kid
    }

    @Override
    public void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
            .mvcMatchers(HttpMethod.DELETE, "/**").hasAuthority("fitnessadmin")
            .anyRequest().authenticated();
    }

    @Bean
    public SecurityEvaluationContextExtension securityEvaluationContextExtension() {
        return new SecurityEvaluationContextExtension();
    }
}
```

`JwkTokenStore` é a peça específica para um *key set* em vez de uma chave
única. O endpoint JWKS retorna várias chaves, cada uma com um `kid`:

```json
{ "keys": [ { "kid": "LHOsOEQJbnNbUn8PmZXA9TUoP56hYOtc3VOk0kUvj5U",
              "kty": "RSA", "alg": "RS256", "use": "sig" } ] }
```

e todo token que o Keycloak assina nomeia a chave que usou no seu header:

```json
{ "alg": "RS256", "typ": "JWT",
  "kid": "LHOsOEQJbnNbUn8PmZXA9TUoP56hYOtc3VOk0kUvj5U" }
```

Então o resource server lê `kid` do header, escolhe a chave pública
correspondente do set, e verifica. Essa indireção é o que torna a
**rotação de chaves** possível sem redesplegar resource servers — a coisa
que uma configuração artesanal de chave única não consegue fazer, e um
argumento concreto a favor de um identity provider de verdade em vez do
servidor do capítulo 13.

### As três regras, em três camadas

O repository empurra o filtro de ownership para dentro da própria query em
vez de pós-filtrar resultados — o bean `SecurityEvaluationContextExtension`
acima é o que torna `authentication.name` resolvível dentro do SpEL ali:

```java
public interface WorkoutRepository extends JpaRepository<Workout, Integer> {

    @Query("SELECT w FROM Workout w WHERE w.user = ?#{authentication.name}")
    List<Workout> findAllByUser();
}
```

O service reforça "só para si mesmo" no caminho de escrita:

```java
@Service
public class WorkoutService {

    @Autowired
    private WorkoutRepository workoutRepository;

    @PreAuthorize("#workout.user == authentication.name")
    public void saveWorkout(Workout workout) {
        workoutRepository.save(workout);
    }

    public List<Workout> findWorkouts() {
        return workoutRepository.findAllByUser();   // filtered in the query
    }

    public void deleteWorkout(Integer id) {         // guarded at the endpoint
        workoutRepository.deleteById(id);
    }
}
```

Ambos dependem de `authentication.name` ser `rachel` — o que só é verdade
porque um protocol mapper colocou o username no token sob uma claim que o
token converter lê. Errando o mapper, `authentication.name` vira o UUID de
`sub`, toda checagem de ownership falha silenciosamente fechada, e os
endpoints parecem quebrados em vez de inseguros. Vale a pena saber em qual
modo de falha você está.

O controller é MVC puro, sem nenhuma annotation de segurança:

```java
@RestController
@RequestMapping("/workout")
public class WorkoutController {

    @Autowired
    private WorkoutService workoutService;

    @PostMapping("/")
    public void add(@RequestBody Workout workout) { workoutService.saveWorkout(workout); }

    @GetMapping("/")
    public List<Workout> findAll() { return workoutService.findWorkouts(); }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Integer id) { workoutService.deleteWorkout(id); }
}
```

### Testando: três curls, três resultados

A seção 18.4 (p. 462-466) prova cada regra contra o par de servidores
rodando (Keycloak na 8080, resource server na 9090). Com um token emitido
para Bill, postar um treino para Bill tem sucesso:

```bash
curl -v -XPOST 'localhost:9090/workout/' \
  -H 'Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCIgOi...' \
  -H 'Content-Type: application/json' \
  --data-raw '{"user":"bill","start":"2020-06-10T15:05:05","end":"2020-06-10T16:05:05","difficulty":2}'
# 200 OK
```

O mesmo token, o mesmo endpoint, `"user":"rachel"` — `@PreAuthorize`
rejeita:

```json
{ "error": "access_denied", "error_description": "Access is denied" }
```

`GET /workout/` com o token do Bill retorna só as linhas de Bill e com o
token de Rachel só as de Rachel — nenhum parâmetro de request está
envolvido, o filtro vem do token. E `DELETE /workout/2` retorna 403 com o
token de Rachel (`fitnessuser`) mas 200 com o de Mary (`fitnessadmin`), que
é o `hasAuthority("fitnessadmin")` em nível de endpoint fazendo seu
trabalho.

### Expressões SpEL específicas de OAuth 2

SpEL comum alcança authorities, roles e username, mas não conceitos de
OAuth 2 como scope ou client roles. O Spring Security OAuth expunha isso
através de um expression handler dedicado:

```java
@Override
public void configure(ResourceServerSecurityConfigurer resources) {
    resources.tokenStore(tokenStore());
    resources.resourceId(claimAud);
    resources.expressionHandler(handler());
}

@Bean
public SecurityExpressionHandler<FilterInvocation> handler() {
    return new OAuth2WebSecurityExpressionHandler();
}
```

o que desbloqueia `#oauth2.hasScope(...)` e `#oauth2.clientHasRole(...)`
dentro de expressões de autorização:

```java
@PreAuthorize("#workout.user == authentication.name and #oauth2.hasScope('fitnessapp')")
public void saveWorkout(Workout workout) {
    workoutRepository.save(workout);
}
```

Note a distinção sendo traçada: `authentication.name` é sobre o *usuário*,
`hasScope` é sobre o que o *client* foi autorizado a fazer, e
`clientHasRole` só faz sentido com o client credentials grant, onde não há
usuário algum.

### Livro vs. hoje: o Keycloak se mudou, e também toda classe Spring deste capítulo

O próprio Keycloak é a parte saudável dessa história — ele está bem vivo
(**26.7.1** na página oficial de downloads no momento em que isso foi
escrito, ainda open source, ainda a resposta default para um identity
provider self-hosted). Mas essencialmente toda *linha* do capítulo precisa
mudar.

**Do lado do Keycloak.**

- **Runtime substituído: de WildFly para Quarkus.** O Keycloak 17 (fev
  2022) tornou a distribuição Quarkus o default e a distribuição legada
  WildFly foi removida em junho de 2022. O `bin/standalone.sh` do livro não
  existe mais — você roda `bin/kc.sh start-dev`. A configuração saiu do XML
  do WildFly para um único `keycloak.conf` mais opções de CLI e variáveis
  de ambiente, providers customizados saíram de
  `standalone/deployments` para `providers/`, `add-user-keycloak.sh` foi
  substituído pelas variáveis de bootstrap
  `KC_BOOTSTRAP_ADMIN_USERNAME`/`KC_BOOTSTRAP_ADMIN_PASSWORD`, e agora
  existe um passo de build/augmentation.
- **`/auth` sumiu de toda URL.** Essa é a mudança com mais chance de
  quebrar um exemplo do livro copiado e colado: a distribuição Quarkus
  remove `/auth` do context path. O issuer é
  `http://localhost:8080/realms/master`, não
  `.../auth/realms/master`. (`--http-relative-path /auth` restaura o
  formato antigo para migrações.)
- **Não use o realm `master`.** O livro emite tokens a partir de `master`
  por conveniência; o próprio admin guide do Keycloak é explícito — "Use
  the *master* realm only to create and manage the realms in your
  system." Aplicações pertencem a um realm dedicado.
- **O password grant está a caminho da extinção.** O Keycloak ainda
  suporta Direct Access Grants, mas o OAuth 2.0 Security Best Current
  Practice diz que ele NÃO DEVE ser usado e o OAuth 2.1 o remove;
  consequentemente o Keycloak 26.2 mudou o console de admin para
  **desabilitar Direct Access Grant por default ao criar um novo client**.
  Os comandos curl `grant_type=password` do livro ainda funcionam se você
  marcar a caixa, mas agora são um atalho de teste, não um design.

**Do lado do Spring.** Duas remoções independentes se acumulam aqui.

- **Os adapters Spring do Keycloak foram removidos.** O Keycloak
  deprecou seus adapters Java em fevereiro de 2022 e confirmou o
  encerramento em março de 2023; a linha
  `keycloak-spring-boot-starter` / `keycloak-spring-security-adapter`
  acabou, com a própria orientação do Keycloak apontando para o suporte
  nativo a OAuth 2 / OIDC do Spring Security em vez disso. **O livro
  esquivou dessa bala** — Spilcă deliberadamente nunca usou o adapter,
  tratando o Keycloak como um provedor OIDC comum atrás de endpoints
  padrão. Essa escolha envelheceu muito melhor do que a alternativa, e é
  por isso que a *arquitetura* do capítulo ainda está correta mesmo que o
  código não esteja.
- **Tudo que o resource server de fato usava está EOL de qualquer jeito.**
  `spring-cloud-starter-oauth2`, `@EnableResourceServer`,
  `ResourceServerConfigurerAdapter`, `TokenStore`, `JwkTokenStore` e
  `OAuth2WebSecurityExpressionHandler` vêm todos do Spring Security OAuth,
  que atingiu fim de vida em 1º de junho de 2022. `@EnableGlobalMethodSecurity`
  virou `@EnableMethodSecurity`. `SecurityEvaluationContextExtension` é a
  única classe na listagem que sobrevive intocada — ainda está documentada
  na referência atual do Spring Security, ainda vem de
  `spring-security-data`, ainda é declarada como bean da mesma forma.

**Toda a configuração de resource server colapsa numa única
propriedade.** Como o Keycloak expõe discovery OIDC padrão, nenhuma
biblioteca específica do Keycloak é necessária — isso é exatamente a
configuração `issuer-uri` de
`spring-security-oauth2-resource-server-approaches`, apontada para um
produto:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
</dependency>
```

```yaml
server:
  port: 9090
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: http://localhost:8080/realms/fitness
          audiences: fitnessapp
```

`issuer-uri` sozinha substitui a propriedade `jwkSetUri` do livro *e* o
bean `JwkTokenStore`: o Spring Security busca
`{issuer}/.well-known/openid-configuration`, lê `jwks_uri` de lá, e valida
a claim `iss` contra o issuer configurado. A propriedade `audiences`
substitui `resources.resourceId(claimAud)`. A rotação continua funcionando
da mesma forma, via `kid`.

**Mapeie as claims do Keycloak, não remodele o Keycloak.** O Keycloak
nativamente coloca realm roles em `realm_access.roles` e client roles em
`resource_access.<clientId>.roles`, e o username em
`preferred_username`. Em vez de adicionar mappers que os duplicam para
`authorities` e `user_name` em benefício de uma biblioteca morta, adapte do
lado do Spring — esse é o problema de mapeamento de `GrantedAuthority` de
`spring-security-authorization-authorities-and-roles`, resolvido com um
`JwtAuthenticationConverter`:

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class ResourceServerConfig {

    @Bean
    SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http.authorizeHttpRequests(auth -> auth
                .requestMatchers(HttpMethod.DELETE, "/**").hasAuthority("fitnessadmin")
                .anyRequest().authenticated())
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt.jwtAuthenticationConverter(keycloakConverter())));
        return http.build();
    }

    private JwtAuthenticationConverter keycloakConverter() {
        JwtAuthenticationConverter converter = new JwtAuthenticationConverter();

        // authentication.name must be the username, not the "sub" UUID —
        // the @PreAuthorize and @Query rules above depend on it
        converter.setPrincipalClaimName("preferred_username");

        converter.setJwtGrantedAuthoritiesConverter(jwt -> {
            Map<String, Object> realmAccess = jwt.getClaim("realm_access");
            if (realmAccess == null || realmAccess.get("roles") == null) {
                return List.of();
            }
            @SuppressWarnings("unchecked")
            Collection<String> roles = (Collection<String>) realmAccess.get("roles");
            return roles.stream()
                        .map(SimpleGrantedAuthority::new)   // no prefix: "fitnessadmin"
                        .collect(Collectors.toList());
        });

        return converter;
    }

    @Bean
    SecurityEvaluationContextExtension securityEvaluationContextExtension() {
        return new SecurityEvaluationContextExtension();
    }
}
```

`setPrincipalClaimName` tem default `JwtClaimNames.SUB`, que é por que
precisa ser setado explicitamente para as regras de ownership do livro
continuarem funcionando. Se você preferir escrever
`hasRole("fitnessadmin")` em vez de `hasAuthority(...)`, mapeie para
`ROLE_fitnessadmin` em vez disso — ou use o `JwtGrantedAuthoritiesConverter`
padrão com `setAuthoritiesClaimName(...)` e `setAuthorityPrefix(...)`
quando a claim é uma lista plana em vez do objeto aninhado do Keycloak. A
claim `aud` ainda precisa de um audience mapper do Keycloak (o Keycloak não
coloca seu resource server em `aud` por default), então esse único mapper
da seção 18.2.4 sobrevive; os mappers de roles e username não.

**E `#oauth2.hasScope(...)` tem um sucessor.** O Spring Security atual traz
um bean de factory de authorization-manager que expõe a mesma ideia para
method security sem um expression handler custom:

```java
@Bean
OAuth2AuthorizationManagerFactory<?> oauth2() {
    return new DefaultOAuth2AuthorizationManagerFactory<>();
}

@PreAuthorize("#workout.user == authentication.name and @oauth2.hasScope('fitnessapp')")
public void saveWorkout(Workout workout) {
    workoutRepository.save(workout);
}
```

Note `@oauth2` (uma referência a bean) em vez do `#oauth2` do livro (uma
propriedade do root object) — mesma capacidade, canalização diferente.

## Trade-offs

- **Rodar um identity provider vs. escrever um.** O Keycloak dá a você
  federação de usuários (LDAP, Active Directory), brokering para
  identity providers sociais/corporativos, MFA, consent, UI de admin,
  rotação de chaves e customização de token no primeiro dia — nada disso
  o servidor do capítulo 13 tinha. O custo é um serviço para desplegar,
  atualizar, fazer backup, e cujas versões principais ocasionalmente
  reescrevem sua história de deployment, como a mudança de WildFly para
  Quarkus fez. O próprio resumo do livro chega aqui: você não precisa
  necessariamente de um authorization server customizado, mas deveria
  estar pronto para stakeholders que não aceitarão um de terceiros.
- **Configuração num console é mais rápida de mudar e mais difícil de
  revisar.** Realms, clients, mappers e atribuições de role não estão no
  seu histórico do Git. Um protocol mapper deletado manualmente em
  produção remove uma claim silenciosamente, e a falha aparece como regras
  de autorização silenciosamente negando (ou, pior, permitindo) — que é
  por que setups realistas exportam a configuração do realm como JSON, ou
  a conduzem com a REST API de admin ou Terraform, em vez de clicar.
- **Adaptar o identity provider à client library vs. o contrário.** O
  livro renomeia as claims do Keycloak para `authorities`/`user_name` para
  agradar o Spring Security OAuth. Isso funciona, mas torna o realm
  específico de uma biblioteca: outro consumidor do mesmo realm agora vê
  claims duplicadas e não-padrão. Mapear do lado do Spring com um
  `JwtAuthenticationConverter` mantém o realm padrão e empurra a
  peculiaridade para um bean numa única aplicação — melhor isolamento, ao
  custo de algumas linhas a mais por serviço.
  ```java
  converter.setPrincipalClaimName("preferred_username");
  ```
- **Realm roles vs. client roles é uma decisão de arquitetura, não de
  nomenclatura.** Realm roles (`realm_access.roles`) são globais ao tenant
  e caem em todo token; client roles (`resource_access.<clientId>.roles`)
  são escopadas a uma aplicação. Realm roles são mais simples e o que o
  livro usa; client roles evitam que o vocabulário de role de um serviço
  vaze para os tokens de todos os outros, o que importa assim que você tem
  mais que um punhado de serviços.
- **Tokens de vida longa são uma conveniência de teste que vira um buraco
  em produção.** O livro aumenta a duração do token para que os tokens não
  expirem no meio do experimento e diz isso explicitamente — tokens de
  produção deveriam viver minutos. Como um JWT é validado offline contra o
  JWK set, não há checagem de revocation por request — a duração *é* a
  janela de revocation.
- **Três camadas de reforço é pedagogicamente útil e operacionalmente
  discutível.** Regras de endpoint, service e repository num único app
  demonstram a amplitude, mas também significa que um auditor precisa ler
  três arquivos para saber quem pode deletar um treino. O próprio livro
  admite que a regra de delete "would be the same" na camada de service.
  Escolha uma camada por preocupação e seja consistente; espalhar é um
  recurso didático.
- **OIDC padrão vence um adapter de fornecedor, e a última década provou
  isso.** O capítulo trata o Keycloak como "uma coisa que expõe um token
  endpoint e um JWKS endpoint", então trocar por Okta, Auth0 ou Entra ID é
  uma mudança de `issuer-uri` e um ajuste de claim-mapping. Aplicações que
  recorreram ao `keycloak-spring-boot-starter` em vez disso ganharam uma
  integração mais apertada e depois uma remoção para migrar.

## Documentation Links

- [Spring Security in Action (Manning, 2020) — Chapter 18, "Hands-on: An OAuth 2 application", sections 18.1-18.4, p. 434-466](https://www.manning.com/books/spring-security-in-action) — doc
- [Keycloak — Downloads (current version)](https://www.keycloak.org/downloads) — doc
- [Keycloak — Migrating to the Quarkus distribution (/auth context path removed, kc.sh, providers directory)](https://www.keycloak.org/migration/migrating-to-quarkus) — doc
- [Keycloak Blog — Deprecation of Keycloak adapters (Feb 2022)](https://www.keycloak.org/2022/02/adapter-deprecation) — doc
- [Keycloak Blog — Update on deprecation of Keycloak adapters (Mar 2023)](https://www.keycloak.org/2023/03/adapter-deprecation-update) — doc
- [Keycloak — Securing applications: OpenID Connect endpoints and discovery document](https://www.keycloak.org/securing-apps/oidc-layers) — doc
- [Keycloak — Server Administration Guide (realms, the master realm, clients, roles, protocol mappers)](https://www.keycloak.org/docs/latest/server_admin/index.html) — doc
- [Keycloak Blog — Keycloak 26.2.0 released (Direct Access Grant disabled by default for new clients)](https://www.keycloak.org/2025/04/keycloak-2620-released) — doc
- [Keycloak Issue #30226 — Admin UI: disable Direct Access Grant by default when creating a new client](https://github.com/keycloak/keycloak/issues/30226) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server JWT (issuer-uri, audiences, JwtAuthenticationConverter, JwtGrantedAuthoritiesConverter)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) — doc
- [Spring Security API — JwtAuthenticationConverter (setPrincipalClaimName defaults to "sub")](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/oauth2/server/resource/authentication/JwtAuthenticationConverter.html) — doc
- [Spring Security Reference — Spring Data integration (SecurityEvaluationContextExtension)](https://docs.spring.io/spring-security/reference/servlet/integrations/data.html) — doc
- [Spring Blog — Spring Security OAuth reaches End-of-Life (1 Jun 2022)](https://spring.io/blog/2022/06/01/spring-security-oauth-reaches-end-of-life/) — doc
