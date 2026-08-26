---
version: 1.0
updatedAt: 2026-08-06
title: "Autenticação por Token na Mão: O Estudo de Caso Pré-OAuth2"
---
## Objective

Construir, na mão, um sistema completo de autenticação baseada em token dividido
em duas aplicações — um *authentication server* que possui as credenciais dos
usuários e emite senhas de uso único, e um *business logic server* que expõe os
endpoints que um client realmente quer e confia em tokens a cada request sem
manter nenhuma sessão do lado do servidor. O ponto não são as classes
específicas: é entender o que um fluxo de bearer token precisa *fazer* — enviar
credenciais exatamente uma vez, devolver uma credencial autodescritiva, e depois
re-derivar uma identidade autenticada a partir dessa credencial em todo request
subsequente — expresso inteiramente nos próprios contratos do Spring Security
(`Authentication`, `AuthenticationProvider`, `OncePerRequestFilter`,
`SecurityContextHolder`). Esta é uma pedagogia deliberadamente pré-OAuth2: tudo
que é feito na mão aqui é o que OAuth 2 / OIDC padronizam, e o que os conceitos
de authorization server e resource server substituem com suporte do framework.

## Use Cases

- Proteger uma API consumida por um app mobile ou um frontend JavaScript, onde
  uma sessão do lado do servidor (e portanto login por formulário) se encaixa
  mal, mas enviar credenciais a cada request (HTTP Basic) é ainda pior.
- Implementar autenticação multifator: username/senha prova *o que o usuário
  sabe*, uma senha de uso único por SMS prova *qual dispositivo o usuário
  possui*, e só a combinação gera um token.
- Separar "quem autentica usuários" de "quem serve dados de negócio" para que os
  dois possam escalar, ser implantados e ser mantidos de forma independente — a
  mesma separação de responsabilidades que depois vira a divisão entre
  authorization server e resource server do OAuth 2.
- Entender o que um JWT realmente é estruturalmente (header, payload, assinatura)
  antes de recorrer a uma biblioteca que esconde isso, para que "o token é
  inválido" vire uma afirmação depurável em vez de um mistério.
- Escrever um filtro de bearer token customizado para um formato de token que o
  framework não conhece — um token legado interno, uma API key, um header
  assinado.

## Deep Dive

### Por que um token, afinal: o que ele compra sobre enviar credenciais toda vez

Um token é um cartão de acesso. Você se identifica uma vez na recepção
(autenticação) e recebe um cartão (token) que abre algumas portas, mas não
necessariamente todas. No nível de implementação um token pode ser *qualquer
coisa que o servidor consiga reconhecer depois* — até mesmo um UUID simples
armazenado num banco de dados ou em memória, associado ao usuário para quem foi
emitido.

O livro lista cinco vantagens concretas sobre o estilo HTTP Basic usado em
capítulos anteriores, onde credenciais viajam junto em todo request:

- **Credenciais são enviadas uma vez.** Quanto mais vezes uma senha atravessa a
  rede, mais chances alguém a intercepta. Com tokens, credenciais aparecem só na
  chamada de login inicial.
- **Tokens podem ter uma vida curta.** Um token roubado expira; uma senha
  roubada não.
- **Tokens podem ser invalidados sem invalidar credenciais.** Repudiar um token
  vazado não força um reset de senha.
- **Tokens podem carregar detalhes** — authorities, roles — o que substitui uma
  sessão *do lado do servidor* por uma *do lado do client*, e é isso que torna a
  escalabilidade horizontal simples.
- **Tokens permitem delegar autenticação para outro componente**, seja um
  serviço seu separado ou GitHub/Twitter.

### O que um JWT é, estruturalmente

Um JSON Web Token são três partes codificadas em Base64 unidas por pontos:

```
eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6ImRhbmllbGxlIn0.wg6LFProg7s_KvFxvnYGiZF-Mj4rr-0nJA1tVGZNn8U
```

Decodificadas, as duas primeiras partes são JSON comum. O header carrega
metadados sobre o token — aqui, o algoritmo usado para produzir a assinatura; o
payload (corpo) carrega os claims que a aplicação vai precisar depois para
autorização:

```json
{ "alg": "HS256" }
```

```json
{ "username": "danielle" }
```

A terceira parte é uma assinatura digital sobre as duas primeiras, e ela é
*opcional* — mas sem ela você não sabe que ninguém alterou o token em trânsito.
Um JWT assinado é chamado corretamente de **JWS** (JSON Web Token Signed); um
cujo conteúdo é criptografado é um **JWE**. Essa nomenclatura não é trivial: ela
explica por que o método de parsing no código do livro se chama
`parseClaimsJws()` e não `parseClaims()`.

Mantenha o payload pequeno. Não há um limite rígido, mas um token mais longo
deixa toda requisição que o carrega mais lenta, e assinar um token mais longo
custa mais CPU.

### A arquitetura: três componentes, três passos de autenticação

Três atores: o **client** (um app mobile ou SPA, representado pelo cURL), o
**authentication server** (possui as tabelas `user` e `otp`, gera OTPs) e o
**business logic server** (expõe o endpoint que vale a pena proteger, e é a
aplicação de fato configurada com Spring Security). O client nunca fala
diretamente com o authentication server — o business logic server faz o proxy
para ele.

```mermaid
sequenceDiagram
    participant C as Client (cURL)
    participant B as Business logic server<br/>(:9090, Spring Security)
    participant A as Auth server<br/>(:8080, users + OTPs)

    Note over C,A: Step 1 — prove what you know
    C->>B: POST /login<br/>headers: username, password
    B->>A: POST /user/auth {username, password}
    A->>A: match bcrypt hash, generate 4-digit OTP,<br/>store it in the otp table
    A-->>C: OTP via SMS (out of band)

    Note over C,A: Step 2 — prove what you hold
    C->>B: POST /login<br/>headers: username, code
    B->>A: POST /otp/check {username, code}
    A-->>B: 200 OK (valid) / 403 Forbidden
    B->>B: sign a JWT with the username claim
    B-->>C: Authorization: eyJhbGciOi...

    Note over C,A: Step 3 — every subsequent request
    C->>B: GET /test<br/>Authorization: <jwt>
    B->>B: verify signature locally,<br/>build Authentication, set SecurityContext
    B-->>C: 200 OK "Test"
```

Note o que o passo 3 *não* contém: nenhuma chamada ao authentication server, e
nenhuma consulta a sessão. O próprio token carrega a identidade, e a assinatura
prova que não foi adulterado. Esse é todo o payoff do design.

O livro é franco ao dizer que a arquitetura é simplificada para fins didáticos:
estritamente falando, um client deveria compartilhar sua senha só com o
authentication server, nunca com o business logic server. E no mundo real você
recorreria a um provedor gerenciado em vez de escrever MFA na mão. O ponto de
escrever isso à mão é aprender filtros e providers customizados.

### O authentication server: emissão de OTP, e nada sobre Spring Security

O authentication server é deliberadamente enfadonho — três endpoints
(`/user/add`, `/user/auth`, `/otp/check`), duas entidades JPA, dois
repositories. O Spring Security aparece nele por exatamente um motivo: obter um
`BCryptPasswordEncoder` para o hash de senhas armazenadas. Sua configuração de
segurança está, de resto, totalmente aberta:

```java
@Configuration
public class ProjectConfig extends WebSecurityConfigurerAdapter {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.csrf().disable();
        http.authorizeRequests().anyRequest().permitAll();
    }
}
```

O primeiro passo de autenticação é uma comparação de senha seguida de renovação
de OTP — código de serviço simples, sem maquinário de framework, e lança
`BadCredentialsException` tanto para um usuário ausente quanto para uma senha
errada (a mesma mensagem nos dois ramos, para que o endpoint não vaze quais
usernames existem):

```java
public void auth(User user) {
    Optional<User> o = userRepository.findUserByUsername(user.getUsername());

    if (o.isPresent()) {
        User u = o.get();
        if (passwordEncoder.matches(user.getPassword(), u.getPassword())) {
            renewOtp(u);
        } else {
            throw new BadCredentialsException("Bad credentials.");
        }
    } else {
        throw new BadCredentialsException("Bad credentials.");
    }
}
```

O próprio OTP vem de `SecureRandom.getInstanceStrong()` — não `Math.random()`,
não `new Random()` — porque é uma credencial:

```java
public static String generateCode() {
    try {
        SecureRandom random = SecureRandom.getInstanceStrong();
        int c = random.nextInt(9000) + 1000;   // 1000..9999
        return String.valueOf(c);
    } catch (NoSuchAlgorithmException e) {
        throw new RuntimeException("Problem when generating the random code.");
    }
}
```

`/otp/check` responde com um *status code*, não um corpo — `200 OK` quando o
código armazenado bate, `403 Forbidden` caso contrário. Essa escolha é o que
torna o proxy do outro lado trivial.

### O proxy: como o servidor de negócio pergunta ao authentication server

Antes de qualquer `AuthenticationProvider` poder ser escrito, o business logic
server precisa de uma forma de alcançar a outra aplicação. Isso é um bean
`RestTemplate` mais um componente fino, com a URL base injetada a partir das
propriedades:

```java
@Component
public class AuthenticationServerProxy {

    @Autowired
    private RestTemplate rest;

    @Value("${auth.server.base.url}")
    private String baseUrl;

    public void sendAuth(String username, String password) {
        String url = baseUrl + "/user/auth";

        var body = new User();
        body.setUsername(username);
        body.setPassword(password);

        var request = new HttpEntity<>(body);
        rest.postForEntity(url, request, Void.class);
    }

    public boolean sendOTP(String username, String code) {
        String url = baseUrl + "/otp/check";

        var body = new User();
        body.setUsername(username);
        body.setCode(code);

        var request = new HttpEntity<>(body);
        var response = rest.postForEntity(url, request, Void.class);

        return response.getStatusCode().equals(HttpStatus.OK);
    }
}
```

```properties
server.port=9090
auth.server.base.url=http://localhost:8080
jwt.signing.key=ymLTU8rq83...
```

### Dois tipos de `Authentication`, dois providers — e por que o construtor de dois argumentos importa

O business logic server precisa de dois tipos distintos de request de
autenticação, então ganha duas implementações de `Authentication`. As duas
simplesmente estendem `UsernamePasswordAuthenticationToken` (o OTP é tratado
como uma senha), o que significa que nenhuma delas precisa reimplementar o
contrato `Authentication`:

```java
public class UsernamePasswordAuthentication
    extends UsernamePasswordAuthenticationToken {

    public UsernamePasswordAuthentication(
            Object principal, Object credentials) {
        super(principal, credentials);
    }

    public UsernamePasswordAuthentication(
            Object principal, Object credentials,
            Collection<? extends GrantedAuthority> authorities) {
        super(principal, credentials, authorities);
    }
}
```

`OtpAuthentication` tem exatamente o mesmo formato. Declarar *ambos* os
construtores é o detalhe que sustenta tudo: o construtor de **dois argumentos**
deixa a instância *não autenticada* (o `AuthenticationManager` vai procurar um
provider), enquanto o de **três argumentos** — authorities incluídas — a marca
como *autenticada*, significando que o processo terminou.

Cada tipo de `Authentication` ganha um provider, e `supports()` é o que
direciona entre eles. O provider de username/senha não termina a autenticação —
ele só dispara o OTP, então retorna um token não autenticado:

```java
@Component
public class UsernamePasswordAuthenticationProvider
    implements AuthenticationProvider {

    @Autowired
    private AuthenticationServerProxy proxy;

    @Override
    public Authentication authenticate(Authentication authentication)
            throws AuthenticationException {

        String username = authentication.getName();
        String password = String.valueOf(authentication.getCredentials());

        proxy.sendAuth(username, password);

        return new UsernamePasswordAuthenticationToken(username, password);
    }

    @Override
    public boolean supports(Class<?> aClass) {
        return UsernamePasswordAuthentication.class.isAssignableFrom(aClass);
    }
}
```

O provider de OTP é o que realmente decide — faz o proxy da checagem, e ou
retorna uma `Authentication` ou lança uma exception:

```java
@Component
public class OtpAuthenticationProvider implements AuthenticationProvider {

    @Autowired
    private AuthenticationServerProxy proxy;

    @Override
    public Authentication authenticate(Authentication authentication)
            throws AuthenticationException {

        String username = authentication.getName();
        String code = String.valueOf(authentication.getCredentials());

        boolean result = proxy.sendOTP(username, code);

        if (result) {
            return new OtpAuthentication(username, code);
        } else {
            throw new BadCredentialsException("Bad credentials.");
        }
    }

    @Override
    public boolean supports(Class<?> aClass) {
        return OtpAuthentication.class.isAssignableFrom(aClass);
    }
}
```

A separação `authenticate()`/`supports()`, as regras de `null`-versus-throw, e
como o `ProviderManager` tenta providers em sequência são o assunto de
`spring-security-authentication-provider-contract` — vale a pena ler primeiro se
algo do que foi dito acima parecer arbitrário. Note também o que está *ausente*
aqui: nenhum `UserDetailsService`, nenhum `PasswordEncoder`. O business logic
server não gerencia usuários de jeito nenhum, então os blocos padrão de
`spring-security-user-management` vivem inteiramente na outra aplicação.

### O filtro `/login`: despachando os dois passos e emitindo o JWT

O livro considera dois designs — três tipos de `Authentication` mais três
providers atrás de um filtro, ou dois de cada mais um *segundo* filtro dedicado
à validação de token — e escolhe o segundo, porque exercita múltiplos filtros
customizados e `OncePerRequestFilter.shouldNotFilter()`.

`InitialAuthenticationFilter` roda só em `/login`, e decide em que passo está
pela presença ou não de um header `code`:

```java
@Component
public class InitialAuthenticationFilter extends OncePerRequestFilter {

    @Autowired
    private AuthenticationManager manager;

    @Value("${jwt.signing.key}")
    private String signingKey;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain)
                throws ServletException, IOException {

        String username = request.getHeader("username");
        String password = request.getHeader("password");
        String code = request.getHeader("code");

        if (code == null) {
            Authentication a =
                new UsernamePasswordAuthentication(username, password);
            manager.authenticate(a);
        } else {
            Authentication a = new OtpAuthentication(username, code);
            a = manager.authenticate(a);

            SecretKey key = Keys.hmacShaKeyFor(
                signingKey.getBytes(StandardCharsets.UTF_8));

            String jwt = Jwts.builder()
                .setClaims(Map.of("username", username))
                .signWith(key)
                .compact();

            response.setHeader("Authorization", jwt);
        }
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getServletPath().equals("/login");
    }
}
```

Duas coisas para notar. Primeiro, nenhum dos dois ramos chama
`filterChain.doFilter(...)` — `/login` é terminal, tratado inteiramente pelo
filtro, sem controller por trás. Segundo, o JWT só é construído na linha
*depois* que `manager.authenticate(a)` retorna; como `OtpAuthenticationProvider`
lança exception num código inválido, um OTP inválido nunca consegue alcançar o
código que emite o token.

A chave de assinatura é simétrica e conhecida só pelo business logic server — a
mesma chave assina e depois verifica. O livro sinaliza, como exercício, que um
sistema real usaria uma chave *por usuário*, porque assim invalidar todos os
tokens de um usuário é uma única rotação de chave.

### O filtro de bearer token: validando sem perguntar a ninguém

`JwtAuthenticationFilter` é o inverso, e roda em tudo *exceto* `/login`. Ele lê o
token do header `Authorization`, verifica a assinatura, reconstrói uma
`Authentication`, e a coloca no `SecurityContext`:

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    @Value("${jwt.signing.key}")
    private String signingKey;

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain)
                throws ServletException, IOException {

        String jwt = request.getHeader("Authorization");

        SecretKey key = Keys.hmacShaKeyFor(
            signingKey.getBytes(StandardCharsets.UTF_8));

        Claims claims = Jwts.parserBuilder()
            .setSigningKey(key)
            .build()
            .parseClaimsJws(jwt)
            .getBody();

        String username = String.valueOf(claims.get("username"));

        GrantedAuthority a = new SimpleGrantedAuthority("user");
        var auth = new UsernamePasswordAuthentication(username, null, List.of(a));

        SecurityContextHolder.getContext().setAuthentication(auth);

        filterChain.doFilter(request, response);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return request.getServletPath().equals("/login");
    }
}
```

`parseClaimsJws()` faz parsing e *verifica* ao mesmo tempo: um token adulterado
lança exception em vez de devolver claims errados. O construtor de três
argumentos de `UsernamePasswordAuthentication` é usado aqui de propósito — essa
instância está finalizada, autenticada, e carrega authorities, então nenhum
provider é consultado. Compare isso com HTTP Basic e login por formulário
(`spring-security-http-basic-and-form-login`): mesmo destino, o
`SecurityContext`, mecanismo completamente diferente para chegar lá — nenhum
`AuthenticationManager`, nenhuma comparação de credencial, nenhuma sessão.

### Cabeando os dois filtros na configuração

Cinco coisas precisam se alinhar: os dois filtros na chain, CSRF desligado, os
dois providers registrados com o `AuthenticationManager`, todo request
autenticado, e o `AuthenticationManager` publicado como bean para que o filtro
possa injetá-lo.

```java
@Configuration
public class SecurityConfig extends WebSecurityConfigurerAdapter {

    @Autowired private InitialAuthenticationFilter initialAuthenticationFilter;
    @Autowired private JwtAuthenticationFilter jwtAuthenticationFilter;
    @Autowired private OtpAuthenticationProvider otpAuthenticationProvider;
    @Autowired private UsernamePasswordAuthenticationProvider
        usernamePasswordAuthenticationProvider;

    @Override
    protected void configure(AuthenticationManagerBuilder auth) {
        auth.authenticationProvider(otpAuthenticationProvider)
            .authenticationProvider(usernamePasswordAuthenticationProvider);
    }

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http.csrf().disable();

        http.addFilterAt(
                initialAuthenticationFilter, BasicAuthenticationFilter.class)
            .addFilterAfter(
                jwtAuthenticationFilter, BasicAuthenticationFilter.class);

        http.authorizeRequests().anyRequest().authenticated();
    }

    @Override
    @Bean
    protected AuthenticationManager authenticationManager() throws Exception {
        return super.authenticationManager();
    }
}
```

A proteção CSRF é desligada deliberadamente, não por preguiça: as defesas CSRF
existem para impedir que um browser anexe silenciosamente credenciais
*ambientes* (um cookie de sessão) a um request cross-origin. Um token que o
client precisa ler e anexar explicitamente a um header não é ambiente — o JWT
aqui desempenha o papel que o token CSRF desempenharia de outra forma.

### Testando o sistema inteiro

Com as duas aplicações rodando (auth server na 8080, business server na 9090),
três chamadas cURL reproduzem os três passos:

```bash
# 0. seed a user on the authentication server
curl -XPOST -H "content-type: application/json" \
  -d '{"username":"danielle","password":"12345"}' \
  http://localhost:8080/user/add

# 1. username + password -> OTP lands in the otp table (stand-in for SMS)
curl -H "username:danielle" -H "password:12345" \
  http://localhost:9090/login

# 2. username + OTP -> JWT comes back in the Authorization *response* header
curl -v -H "username:danielle" -H "code:6271" \
  http://localhost:9090/login
# < HTTP/1.1 200
# < Authorization: eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6ImRhbmllbGxlIn0.wg6LFP...

# 3. the token opens the protected endpoint
curl -H "Authorization:eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6ImRhbmllbGxlIn0.wg6LFP..." \
  http://localhost:9090/test
# Test
```

O passo 1 verificavelmente escreveu um código de quatro dígitos na tabela
`otp`, e a senha armazenada é um hash bcrypt (`$2a$10$...`), diferente a cada
execução porque o bcrypt usa salt.

### Livro vs. hoje: a API jjwt que este capítulo usa foi reescrita

O livro fixa `io.jsonwebtoken:jjwt-api` / `jjwt-impl` / `jjwt-jackson` na versão
**0.11.1**. O release **0.12.0** do jjwt reformulou a API amplamente, e
essencialmente toda chamada nos dois filtros acima tem um substituto moderno
(confirmado contra o changelog e o README atuais do jjwt; o último release é o
**0.13.0**, documentado como a última linha compatível com Java 7 — 0.14.0 em
diante exige Java 8+):

| Livro (0.11.x) | Atual (0.12+) |
| --- | --- |
| `Jwts.builder().setClaims(map)` | `.claims().add(map).and()`, ou `.claim("username", username)` |
| `Jwts.parserBuilder()` | `Jwts.parser()` (agora retorna um `JwtParserBuilder`; `parserBuilder()` foi removido por redundância) |
| `.setSigningKey(key)` | `.verifyWith(key)` |
| `.parseClaimsJws(jwt)` | `.parseSignedClaims(jwt)` |
| `.getBody()` | `.getPayload()` |
| `setSubject`/`setExpiration`/`setIssuedAt` | `subject()`/`expiration()`/`issuedAt()` |

Então as mesmas duas operações, escritas contra a biblioteca atual:

```java
String jwt = Jwts.builder()
    .claim("username", username)
    .issuedAt(Date.from(now))
    .expiration(Date.from(now.plus(Duration.ofMinutes(15))))
    .signWith(key)
    .compact();

Claims claims = Jwts.parser()
    .verifyWith(key)
    .build()
    .parseSignedClaims(jwt)
    .getPayload();
```

O `jjwt-impl`, com escopo de runtime, e um provedor de JSON (`jjwt-jackson` ou
`jjwt-gson`) continuam obrigatórios junto de `jjwt-api`. `Keys.hmacShaKeyFor(byte[])`
ainda existe e ainda lança `WeakKeyException` para qualquer coisa abaixo de 256
bits, conforme a RFC 7518 §3.2 — então a chave truncada do livro
`jwt.signing.key=ymLTU8rq83…` precisa, na prática, ter pelo menos 32 bytes de
entropia real, e a RFC 8725 §3.5 é explícita de que uma senha memorizável por
humanos nunca deve ser usada diretamente como chave HMAC. As dependências
`jakarta.xml.bind` / `jaxb-runtime` que o livro adiciona "se você usa Java 10 ou
superior" não são mais necessárias para o jjwt atual num JDK moderno.

### Livro vs. hoje: o andaime de Spring Security ao redor disso

Independente do jjwt, a configuração das duas aplicações está escrita num
estilo que não compila mais no Spring Security 6+:

- `WebSecurityConfigurerAdapter` foi deprecado na 5.7 e removido na 6.0 — um
  `@Bean` `SecurityFilterChain` recebendo `HttpSecurity` substitui os dois
  overrides de `configure()`.
- `authorizeRequests()` dá lugar a `authorizeHttpRequests()`, e a Lambda DSL
  vira obrigatória no Spring Security 7 (chamadas de configurer sem argumento e
  o encadeamento com `.and()` estão ambos saindo), conforme o guia de migração
  atual. `csrf().disable()` vira `csrf(AbstractHttpConfigurer::disable)`.
- Sobrescrever `authenticationManager()` é substituído por construir um
  `ProviderManager` diretamente a partir dos seus providers, ou injetar
  `AuthenticationConfiguration` e retornar `config.getAuthenticationManager()`.
- `javax.servlet.*` virou `jakarta.servlet.*`. `OncePerRequestFilter`,
  `doFilterInternal()`, e `shouldNotFilter()` continuam de resto inalterados —
  verificado contra o javadoc atual do Spring Framework — assim como
  `addFilterAt()` / `addFilterAfter()` com `BasicAuthenticationFilter.class`
  como âncora.
- `SecurityContextHolder.getContext().setAuthentication(auth)` — usado pelo
  `JwtAuthenticationFilter` — agora é explicitamente desencorajado na
  documentação de referência em favor de
  `SecurityContextHolder.createEmptyContext()`, definindo a autenticação nesse
  contexto novo, e então `SecurityContextHolder.setContext(...)`, para evitar
  race conditions contra outras threads compartilhando o contexto.

### Livro vs. hoje: este é o problema que o OAuth 2 padroniza

O enquadramento mais importante é arquitetural, não sintático. Nada no formato
de transporte aqui é padrão: as credenciais viajam em headers de request ad-hoc
`username` / `password` / `code`, o token emitido volta num header de
*response* `Authorization`, e o client o envia de volta como um token nu, sem
prefixo `Bearer `. Dois times construindo esse padrão de forma independente
produziriam dois sistemas incompatíveis.

OAuth 2 e OIDC são precisamente a padronização desse formato, e o Spring
Security traz o maquinário:

- O authentication server feito à mão vira um **authorization server** — hoje,
  o Spring Authorization Server, que fornece os endpoints de token, JWK set,
  introspecção, revogação e metadados, e emite tanto JWTs autocontidos quanto
  tokens de referência opacos.
- O `JwtAuthenticationFilter` feito à mão vira o suporte de **resource server**
  do Spring Security: `oauth2ResourceServer(oauth2 -> oauth2.jwt(...))` instala
  um `BearerTokenAuthenticationFilter` que lê `Authorization: Bearer <token>`,
  produz um `BearerTokenAuthenticationToken`, e o entrega ao
  `JwtAuthenticationProvider`, que decodifica via um `JwtDecoder`
  (`NimbusJwtDecoder.withSecretKey(...)` para uma chave simétrica,
  `withJwkSetUri(...)` / `withIssuerLocation(...)` para assimétrica), mapeia
  claims para authorities através de `JwtAuthenticationConverter`, e produz um
  `JwtAuthenticationToken`. A configuração se resume a
  `spring.security.oauth2.resourceserver.jwt.issuer-uri` (mais opcionalmente
  `jwk-set-uri`, `audiences`, `jws-algorithms`).
- A chamada de validação por request que o proxy deste capítulo faz é
  padronizada como introspecção de token (RFC 7662) para tokens opacos — e
  eliminada completamente para JWTs assinados, que o resource server verifica
  localmente contra chaves rotativas buscadas do JWK set.

Leia este capítulo, então, como a lição de mecanismo que torna os próximos
quatro capítulos legíveis: fundamentos do OAuth 2 e grant types, o client OAuth
2 e SSO, o authorization server, o resource server, e assinatura de JWT todos
descrevem a versão *padrão* do que acabou de ser construído à mão. Não coloque
essas classes em produção.

## Trade-offs

- **Um JWT assinado sem claim `exp` nunca expira.** O payload do livro é
  `{"username": "danielle"}` e nada mais, então um token vazado é válido para
  sempre — o que silenciosamente perde duas das cinco vantagens que o próprio
  capítulo lista para tokens (vida curta, invalidação). Qualquer implementação
  real precisa de pelo menos `exp`, e um parser que a aplique. A RFC 8725
  adicionalmente empurra para validar `alg` e `aud`; um token autoassinado, de
  audiência única, pula os dois.
- **Uma chave de assinatura simétrica para todos os usuários é a coisa mais
  simples e a menos revogável.** O livro diz isso abertamente e deixa chaves por
  usuário como exercício: com uma chave compartilhada, revogar os tokens de um
  usuário significa rotacionar a chave para todo mundo. Com uma chave simétrica,
  "poder verificar" e "poder emitir" também são a mesma capacidade, então a
  chave não pode ser compartilhada com nenhum outro serviço — um par de chaves
  assimétricas (privada para o emissor, pública para os verificadores) é o que
  torna a verificação multi-serviço possível, e é exatamente por isso que
  configurações OAuth 2 publicam um JWK set.
- **Ausência de estado é a feature e a restrição.** Como o passo 3 não consulta
  nem o authentication server nem um session store, o business logic server
  escala horizontalmente sem estado compartilhado — e pelo mesmo motivo não há
  onde registrar "este token está revogado". Recuperar revogação significa
  reintroduzir estado (uma denylist, tokens opacos mais introspecção) e abrir
  mão de parte do que o token comprou.
- **Um formato de transporte feito à mão é um beco sem saída de
  interoperabilidade.** Headers ad-hoc `username`/`code`, um token num header de
  *response* `Authorization`, e uma credencial bearer sem esquema `Bearer `
  significam que nenhum client, gateway ou proxy pronto entende esse sistema. O
  mecanismo é durável; o formato não é.
- **`shouldNotFilter()` é configuração por espaço negativo, e os dois filtros
  precisam concordar exatamente.** `InitialAuthenticationFilter` roda quando o
  path *é* `/login`, `JwtAuthenticationFilter` quando *não é* — um erro de
  digitação e ou `/login` exige um token que ainda não existe, ou um endpoint
  protegido roda sem filtro de autenticação nenhum. A condição também é
  igualdade exata de string em `getServletPath()`, então `/login/` ou um
  contexto mapeado de forma diferente escapa.
- **Os filtros pulam tudo o que um filtro de produção precisa.** O próprio livro
  sinaliza isso: nenhum tratamento de exception, nenhum logging, nenhuma
  auditoria de tentativas falhas, nenhuma checagem de nulo num header
  `Authorization` ausente (o que levanta uma exception lá do fundo do jjwt em
  vez de retornar um `401` limpo).
- **A simplificação de fazer proxy das senhas pelo business logic server é um
  antipadrão real, reconhecido como tal.** Credenciais deveriam ser conhecidas
  pelo menor número possível de componentes; aqui elas passam por um segundo
  serviço, e os dois servidores não se autenticam *um com o outro* de jeito
  nenhum (o livro deixa proteger esse salto com uma chave simétrica ou
  assimétrica como exercício). Os grants baseados em redirect do OAuth 2
  existem precisamente para que a senha do client nunca toque o resource
  server.
- **Pedagogicamente este capítulo é essencial e operacionalmente ele está
  obsoleto.** Construir o fluxo à mão é o que faz `BearerTokenAuthenticationFilter`,
  `JwtDecoder`, e um endpoint de JWK set parecerem soluções nomeadas em vez de
  mágica — mas sistemas de produção usam o suporte de resource server do Spring
  Security e o Spring Authorization Server (ou um IdP gerenciado), não essas
  classes.

## Documentation Links

- [Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 11, "Hands-on: A separation of responsibilities", sections 11.1-11.4.6, p. 245-283](https://www.manning.com/books/spring-security-in-action) — doc
- [jjwt — README / current API (Jwts.builder, Jwts.parser, parseSignedClaims)](https://github.com/jwtk/jjwt) — doc
- [jjwt — CHANGELOG (0.12.0 API rework, 0.13.0 release)](https://github.com/jwtk/jjwt/blob/main/CHANGELOG.md) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server JWT (BearerTokenAuthenticationFilter, JwtDecoder, NimbusJwtDecoder)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) — doc
- [Spring Security Reference — Authentication Architecture (ProviderManager, SecurityContextHolder.createEmptyContext)](https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html) — doc
- [Spring Security Reference — Configuration Migrations to Spring Security 7 (Lambda DSL, .and() removal)](https://docs.spring.io/spring-security/reference/6.5/migration-7/configuration.html) — doc
- [Spring Authorization Server Reference — Overview](https://docs.spring.io/spring-authorization-server/reference/overview.html) — doc
- [Spring Framework API — OncePerRequestFilter (doFilterInternal, shouldNotFilter)](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/filter/OncePerRequestFilter.html) — doc
- [RFC 8725 — JSON Web Token Best Current Practices](https://datatracker.ietf.org/doc/html/rfc8725) — doc
- [RFC 7518 — JSON Web Algorithms (§3.2, minimum HMAC key size)](https://datatracker.ietf.org/doc/html/rfc7518#section-3.2) — doc
