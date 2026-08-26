---
version: 1.0
updatedAt: 2026-08-06
title: "Assinatura de JWT: Chaves Simétricas vs. Assimétricas"
---
## Objective

O Capítulo 14 lista três formas de um resource server validar um token; este
capítulo constrói a terceira — **validação local de um JWT assinado
criptograficamente** — e mostra que o design inteiro gira em torno de uma
única pergunta: *quem detém a chave que produz uma assinatura válida?* Com
uma chave **simétrica** (HMAC, `HS256`) a resposta é "tanto o authorization
server quanto todo resource server", o que é simples e rápido mas torna
cada resource server capaz de *cunhar* tokens, não só verificá-los. Com um
**par de chaves assimétrico** (`RS256`) o authorization server assina com
uma chave privada e resource servers verificam com uma chave pública que é
inútil para forjar qualquer coisa — então uma chave pública pode ser
distribuída, publicada, e rotacionada livremente. Esse último passo,
"publicar a chave pública num endpoint," é o que o livro improvisa na
seção 15.2.4 e o que o ecossistema desde então padronizou como o
**endpoint JWK Set**. O capítulo se encerra com claims customizadas:
colocar seus próprios campos no corpo do token e lê-los de volta no
resource server.

## Use Cases

- Escolher chaves de assinatura para um sistema interno onde um time possui
  tanto o authorization server quanto os resource servers (simétrica é
  defensável) versus um sistema onde eles pertencem a organizações
  diferentes (simétrica não é).
- Tornar concreta a opção de "validação local de JWT" de
  `spring-security-oauth2-resource-server-approaches` — este conceito *é*
  essa opção, expandida numa implementação.
- Rotacionar chaves de assinatura sem reimplantar cada resource server,
  movendo ambas as chaves para o authorization server e deixando resource
  servers buscarem a pública.
- Carregar dados relevantes para autorização que as claims padrão não
  cobrem — a contagem de reviews de um usuário, contagem de conexões,
  tenant, ou fuso horário de origem — dentro do token, onde a assinatura o
  protege de adulteração.
- Migrar uma codebase da era `@EnableAuthorizationServer` com
  `JwtTokenStore`/`JwtAccessTokenConverter` para `JwtEncoder`/`JwtDecoder`
  mais um JWK set.

## Deep Dive

### Um JWT assinado é três partes em Base64, e assinar não é criptografar

Um JWT tem um header, um corpo (as claims), e uma assinatura, cada um
codificado em Base64URL e unidos com pontos:

```
eyJhbGciOiJIUzI1NiJ9.eyJ1c2VybmFtZSI6ImRhbmllbGxlIn0.wg6LFProg7s_KvFxvnYGiZF-Mj4rr-0nJA1tVGZNn8U
   ^ header                ^ body                        ^ signature
```

O header nomeia o algoritmo, e é a primeira coisa a olhar ao debugar —
`eyJhbGciOiJIUzI1NiIs…` decodifica para `{"alg":"HS256",…}` (simétrico) e
`eyJhbGciOiJSUzI1NiIs…` decodifica para `{"alg":"RS256",…}` (assimétrico).
As próprias respostas de exemplo do livro diferem exatamente nesse prefixo
entre a seção 15.1 e a seção 15.2.

A assinatura é calculada sobre o header e o corpo com uma chave. Para ser
válida ela precisa tanto ser gerada com a chave correta **quanto** combinar
com o conteúdo que foi assinado — então um atacante que intercepta um token
e edita `"authorities": ["read"]` para `["admin"]` invalida a assinatura e
o resource server rejeita a chamada.

Criticamente, um token assinado **não** é um segredo. Qualquer um consegue
decodificar o corpo em Base64 e ler todas as claims sem nenhuma chave.
Assinar dá integridade e autenticidade, não confidencialidade. Um token
assinado é um **JWS**; se você também precisa esconder o conteúdo precisa
de um **JWE** (criptografado), que este capítulo não usa. Nunca coloque uma
senha, um número de cartão, ou qualquer outra coisa que você não imprimiria
num cartão postal no corpo de um JWT.

### Assinatura simétrica: um segredo compartilhado, e quem o tem consegue assinar

O primeiro exemplo do livro configura um `JwtTokenStore` no authorization
server e dá ao seu `JwtAccessTokenConverter` uma chave de assinatura lida de
propriedades:

```java
@Configuration
@EnableAuthorizationServer
public class AuthServerConfig
    extends AuthorizationServerConfigurerAdapter {

    @Value("${jwt.key}")
    private String jwtKey;

    @Autowired
    private AuthenticationManager authenticationManager;

    @Override
    public void configure(
        AuthorizationServerEndpointsConfigurer endpoints) {
        endpoints
            .authenticationManager(authenticationManager)
            .tokenStore(tokenStore())
            .accessTokenConverter(jwtAccessTokenConverter());
    }

    @Bean
    public TokenStore tokenStore() {
        return new JwtTokenStore(jwtAccessTokenConverter());
    }

    @Bean
    public JwtAccessTokenConverter jwtAccessTokenConverter() {
        var converter = new JwtAccessTokenConverter();
        converter.setSigningKey(jwtKey);       // symmetric
        return converter;
    }
}
```

```properties
jwt.key=MjWP5L7CiD
```

A configuração do resource server é *a mesma configuração de novo* — mesmo
`JwtTokenStore`, mesmo `JwtAccessTokenConverter`, mesmo valor de chave:

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig
    extends ResourceServerConfigurerAdapter {

    @Value("${jwt.key}")
    private String jwtKey;

    @Override
    public void configure(ResourceServerSecurityConfigurer resources) {
        resources.tokenStore(tokenStore());
    }

    @Bean
    public TokenStore tokenStore() {
        return new JwtTokenStore(jwtAccessTokenConverter());
    }

    @Bean
    public JwtAccessTokenConverter jwtAccessTokenConverter() {
        var converter = new JwtAccessTokenConverter();
        converter.setSigningKey(jwtKey);
        return converter;
    }
}
```

Essa simetria é o ponto todo *e* o problema todo: a API não distingue "a
chave com que assino" de "a chave com que verifico," porque com HMAC elas
são uma chave só. Não existe configuração que você possa escrever que deixe
o resource server verificar sem conseguir assinar.

Duas notas práticas que o livro anexa. Primeiro, a chave é uma string de
bytes aleatória, não uma passphrase — `"abcde"` funciona para uma demo, mas
uma chave real deveria ser gerada aleatoriamente e ser longa (o livro
sugere preferir mais de 258 bytes; para `HS256`, a RFC 7518 estabelece o
piso rígido em 256 bits / 32 bytes). Segundo, `jwt.key=MjWP5L7CiD` sentado
em `application.properties` é um atalho de demo — uma chave de assinatura
pertence a um cofre de segredos. A anedota do consultor do livro vale a
pena repetir literalmente em espírito: se você algum dia se pegar mandando
a chave por e-mail para outro time, essa chave não deveria ser simétrica.

Obter um token e usá-lo é igual a qualquer outra configuração OAuth 2:

```bash
curl -v -XPOST -u client:secret "http://localhost:8080/oauth/token?grant_type=password&username=john&password=12345&scope=read"
```

```json
{
    "access_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXV…",
    "token_type":"bearer",
    "refresh_token":"eyJhbGciOiJIUzI1NiIsInR5cCI6Ikp…",
    "expires_in":43199,
    "scope":"read",
    "jti":"7774532f-b74b-4e6b-ab16-208c46a19560"
}
```

```bash
curl -H "Authorization:Bearer eyJhbGciOiJIUzI1NiIs…" http://localhost:9090/hello
```

O livro também mostra a forma não-Spring-Security-OAuth num box lateral, e
esta é a que sobrevive — um bean `JwtDecoder` conectado através de
`oauth2ResourceServer()`:

```java
@Bean
public JwtDecoder jwtDecoder() {
    byte[] key = jwtKey.getBytes();
    SecretKey originalKey = new SecretKeySpec(key, 0, key.length, "AES");
    return NimbusJwtDecoder.withSecretKey(originalKey).build();
}
```

```java
http.authorizeRequests()
        .anyRequest().authenticated()
    .and()
    .oauth2ResourceServer(
        c -> c.jwt(j -> j.decoder(jwtDecoder())));
```

(O nome do algoritmo `"AES"` naquele `SecretKeySpec` é uma peculiaridade do
snippet do livro — o material da chave é o que importa, mas a documentação
atual nomeia o algoritmo MAC explicitamente em vez disso; veja a seção
livro-vs-hoje.)

### Assinatura assimétrica: um assinante, muitos verificadores

Um par de chaves assimétrico divide a chave única em duas. A **chave
privada** assina; só quem a detém consegue produzir uma assinatura válida.
A **chave pública** verifica; não consegue assinar nada. Uma chave pública
roubada não vale nada para um atacante — que é exatamente a propriedade que
permite distribuí-la.

```mermaid
flowchart TB
    subgraph SYM["Symmetric — HS256"]
        direction TB
        AS1["Authorization server<br/>secret: MjWP5L7CiD<br/>signs"]
        RS1a["Resource server A<br/>secret: MjWP5L7CiD<br/>verifies ... and can sign"]
        RS1b["Resource server B<br/>secret: MjWP5L7CiD<br/>verifies ... and can sign"]
        H1["Hacker who reads any<br/>one config file can<br/>forge any token"]
        AS1 -->|"copy of the same secret"| RS1a
        AS1 -->|"copy of the same secret"| RS1b
        RS1a -.->|"leak"| H1
    end

    subgraph ASYM["Asymmetric — RS256"]
        direction TB
        AS2["Authorization server<br/>PRIVATE key: signs<br/>PUBLIC key: published"]
        RS2a["Resource server A<br/>public key: verifies only"]
        RS2b["Resource server B<br/>public key: verifies only"]
        H2["Hacker who steals the<br/>public key can forge<br/>nothing"]
        AS2 -->|"public key<br/>over an open endpoint"| RS2a
        AS2 -->|"public key<br/>over an open endpoint"| RS2b
        RS2a -.->|"leak"| H2
    end
```

Leia o diagrama como uma contagem de *partes confiáveis*. Assinatura
simétrica significa que todo resource server é tão privilegiado quanto o
authorization server; o número de lugares onde um segredo que compromete o
sistema mora cresce linearmente com o número de serviços. Assinatura
assimétrica significa que exatamente um componente é privilegiado, e o
resto segura algo que é seguro publicar. É por isso que a validação local
de JWT escala: adicionar um resource server custa uma chave pública e zero
chamadas de rede por request, e o authorization server nunca precisa
confiar no novo serviço com nada.

**Gerando o par.** O livro usa `keytool` (vem com o JDK) e OpenSSL:

```bash
keytool -genkeypair -alias ssia -keyalg RSA -keypass ssia123 \
        -keystore ssia.jks -storepass ssia123

keytool -list -rfc --keystore ssia.jks | openssl x509 -inform pem -pubkey
```

O segundo comando imprime a chave pública em armadura PEM:

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAijLqDcBHwtnsBw+WFSzG
…
-----END PUBLIC KEY-----
```

Este é um trabalho diferente do `spring-security-crypto-module`: os
`KeyGenerators`/`Encryptors` daquele módulo produzem material simétrico
para criptografar seus próprios dados, enquanto aqui você precisa de um
*par* de chaves RSA num keystore para assinar tokens, que é um artefato de
nível de plataforma gerado fora da aplicação.

**Authorization server com a chave privada.** Só o bean converter muda; o
wiring do `JwtTokenStore` é idêntico ao caso simétrico:

```java
@Value("${password}")  private String password;
@Value("${privateKey}") private String privateKey;   // ssia.jks
@Value("${alias}")      private String alias;        // ssia

@Bean
public JwtAccessTokenConverter jwtAccessTokenConverter() {
    var converter = new JwtAccessTokenConverter();

    KeyStoreKeyFactory keyStoreKeyFactory =
        new KeyStoreKeyFactory(
            new ClassPathResource(privateKey),
            password.toCharArray());

    converter.setKeyPair(keyStoreKeyFactory.getKeyPair(alias));
    return converter;
}
```

**Resource server com a chave pública.** Note `setVerifierKey` em vez de
`setSigningKey` — a API finalmente tem dois nomes de método distintos
porque agora há duas capacidades distintas:

```java
@Value("${publicKey}")
private String publicKey;   // -----BEGIN PUBLIC KEY----- … -----END PUBLIC KEY-----

@Bean
public JwtAccessTokenConverter jwtAccessTokenConverter() {
    var converter = new JwtAccessTokenConverter();
    converter.setVerifierKey(publicKey);
    return converter;
}
```

E de novo a forma de migração, que é o mesmo wiring `oauth2ResourceServer()`
com um decoder diferente:

```java
@Bean
public JwtDecoder jwtDecoder() {
    try {
        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
        var key = Base64.getDecoder().decode(publicKey);

        var x509 = new X509EncodedKeySpec(key);
        var rsaKey = (RSAPublicKey) keyFactory.generatePublic(x509);
        return NimbusJwtDecoder.withPublicKey(rsaKey).build();
    } catch (Exception e) {
        throw new RuntimeException("Wrong public key");
    }
}
```

O token agora chega com `"alg":"RS256"`, e nada mais no request muda.

### Publicando a chave pública para que as chaves possam de fato ser rotacionadas

Chaves deveriam ser rotacionadas — uma chave que nunca muda é uma chave que
eventualmente vaza e depois permanece útil para sempre. Mas com a chave
pública colada no `application.properties` de cada resource server,
rotacionar significa uma mudança de config coordenada e um redeploy em
todo serviço, o que na prática significa que ninguém rotaciona.

A correção é manter **as duas** chaves no authorization server e deixá-lo
servir a pública. O Spring Security OAuth já tem um endpoint desses
(`/oauth/token_key`); ele só é negado a todo mundo por padrão, então você o
abre:

```java
@Override
public void configure(
    ClientDetailsServiceConfigurer clients) throws Exception {

    clients.inMemory()
           .withClient("client")
           .secret("secret")
           .authorizedGrantTypes("password", "refresh_token")
           .scopes("read")
             .and()
           .withClient("resourceserver")          // the resource server is itself a client
           .secret("resourceserversecret");
}

@Override
public void configure(
    AuthorizationServerSecurityConfigurer security) {
    security.tokenKeyAccess("isAuthenticated()");
}
```

```bash
curl -u resourceserver:resourceserversecret http://localhost:8080/oauth/token_key
```

```json
{
    "alg":"SHA256withRSA",
    "value":"-----BEGIN PUBLIC KEY----- nMIIBIjANBgkq... -----END PUBLIC KEY-----"
}
```

O resource server então não guarda nenhuma chave — só uma URI e
credenciais:

```properties
server.port=9090
security.oauth2.resource.jwt.key-uri=http://localhost:8080/oauth/token_key
security.oauth2.client.client-id=resourceserver
security.oauth2.client.client-secret=resourceserversecret
```

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig
    extends ResourceServerConfigurerAdapter {
}
```

Uma classe de configuração vazia é o resultado: gerenciamento de chaves
agora acontece num único lugar. Note que isso continua sendo validação
local — a chave pública é buscada e cacheada, não consultada por request; a
chamada de rede acontece na inicialização e no refresh de chave, não no
caminho quente.

### Claims customizadas: escrevendo-as no authorization server

Por padrão o corpo do token carrega o que o Spring Security precisa para
autorização básica:

```json
{
    "exp": 1582581543,
    "user_name": "john",
    "authorities": ["read"],
    "jti": "8e208653-79cf-45dd-a702-f6b694b417e7",
    "client_id": "client",
    "scope": ["read"]
}
```

Quando a autorização depende de outra coisa — a contagem de reviews de um
revisor, o número de conexões sociais de um usuário, o fuso horário de
onde o client se conectou — você adiciona uma claim. Na API do livro isso
significa um `TokenEnhancer`:

```java
public class CustomTokenEnhancer implements TokenEnhancer {

    @Override
    public OAuth2AccessToken enhance(
        OAuth2AccessToken oAuth2AccessToken,
        OAuth2Authentication oAuth2Authentication) {

        var token = new DefaultOAuth2AccessToken(oAuth2AccessToken);

        Map<String, Object> info =
            Map.of("generatedInZone",
                   ZoneId.systemDefault().toString());

        token.setAdditionalInformation(info);
        return token;
    }
}
```

Registrá-lo tem uma armadilha não-óbvia. `JwtAccessTokenConverter` é *ele
próprio* um `TokenEnhancer`, então definir o seu como *o* enhancer
substituiria silenciosamente a coisa que assina o token. Você precisa
encadeá-los:

```java
@Override
public void configure(
    AuthorizationServerEndpointsConfigurer endpoints) {

    TokenEnhancerChain tokenEnhancerChain = new TokenEnhancerChain();

    var tokenEnhancers =
        List.of(new CustomTokenEnhancer(),
                jwtAccessTokenConverter());

    tokenEnhancerChain.setTokenEnhancers(tokenEnhancers);

    endpoints
        .authenticationManager(authenticationManager)
        .tokenStore(tokenStore())
        .tokenEnhancer(tokenEnhancerChain);
}
```

A claim agora aparece tanto no corpo do token quanto, como conveniência, na
resposta JSON do endpoint de token:

```json
{
    "access_token":"eyJhbGciOiJSUzI…",
    "token_type":"bearer",
    "refresh_token":"eyJhbGciOiJSUzI1…",
    "expires_in":43199,
    "scope":"read",
    "generatedInZone":"Europe/Bucharest",
    "jti":"0c39ace4-4991-40a2-80ad-e9fdeb14f9ec"
}
```

Pegue o valor do **token**, nunca do envelope de resposta ao redor. Só o
token é assinado; o JSON ao redor não carrega nenhuma garantia de
integridade. Essa distinção é toda a razão pela qual o capítulo se
preocupa com assinaturas.

### Claims customizadas: lendo-as no resource server

O objeto que transforma um token numa `Authentication` é o access token
converter, então é ele que você estende — sobrescrevendo
`extractAuthentication` para guardar o mapa de claims cru nos details da
authentication:

```java
public class AdditionalClaimsAccessTokenConverter
    extends JwtAccessTokenConverter {

    @Override
    public OAuth2Authentication extractAuthentication(Map<String, ?> map) {
        var authentication = super.extractAuthentication(map);
        authentication.setDetails(map);
        return authentication;
    }
}
```

```java
@Bean
public JwtAccessTokenConverter jwtAccessTokenConverter() {
    var converter = new AdditionalClaimsAccessTokenConverter();
    converter.setVerifierKey(publicKey);
    return converter;
}
```

```java
@RestController
public class HelloController {

    @GetMapping("/hello")
    public String hello(OAuth2Authentication authentication) {
        OAuth2AuthenticationDetails details =
            (OAuth2AuthenticationDetails) authentication.getDetails();

        return "Hello! " + details.getDecodedDetails();
    }
}
```

```
Hello! {user_name=john, scope=[read], generatedInZone=Europe/Bucharest,
        exp=1582595692, authorities=[read], jti=982b02be-…, client_id=client}
```

`getDecodedDetails()` retorna o `Map` de claims; em código real você extrai
uma chave dele em vez de imprimir tudo.

### Livro vs. hoje: a mecânica é atemporal, as classes não são

A criptografia deste capítulo não mudou nada. As classes que a implementam
foram quase inteiramente substituídas.

**Os nomes de algoritmo estão inalterados.** `HS256` (HMAC com SHA-256) e
`RS256` (RSASSA-PKCS1-v1_5 com SHA-256) continuam sendo os nomes JWA
registrados, ainda escritos exatamente assim no header `alg`, e o Spring
Security os modela como `MacAlgorithm.HS256`/`HS384`/`HS512` e
`SignatureAlgorithm.RS256`/`RS384`/`RS512`/`ES256`/`ES384`/`ES512`/`PS256`/`PS384`/`PS512`.
O que *mudou* é o conselho default para sistemas novos: `RS256` continua
sendo a escolha segura para interoperabilidade e é o que a maioria dos
identity providers ainda emite, mas `ES256` (ECDSA em P-256) ganhou
terreno de verdade — mesma divisão signer/verifier, chaves e assinaturas
dramaticamente menores, verificação mais rápida — e `EdDSA`/Ed25519 é a
preferência de criptografia moderna onde toda sua stack suporta. O Spring
Security suporta os três no lado da decodificação (`.jwsAlgorithm(...)`, e
você pode listar vários), e desde a 7.0
`NimbusJwtEncoder.withKeyPair(...)` tem um overload EC junto do RSA. Trate
o `RS256`-em-tudo do livro como "o default seguro," não "a única opção."

**A biblioteca mudou por baixo.** O `JwtAccessTokenConverter` do livro é
apoiado pelo `spring-security-jwt` (`JwtHelper`, `MacSigner`, `RsaSigner`,
`RsaVerifier`), uma biblioteca pequena que vivia dentro do repositório
`spring-security-oauth`. Esse repositório está arquivado e o projeto
chegou ao fim de vida em 1º de junho de 2022 — veja
`spring-security-oauth2-authorization-server` para o cronograma completo,
que se aplica literalmente aqui. O Spring Security atual usa **Nimbus
JOSE+JWT** em vez disso, envolto em suas próprias abstrações
`JwtDecoder`/`JwtEncoder`. Os boxes laterais do livro já apontam para o
destino (`NimbusJwtDecoder`), que é por que esses boxes são as partes do
capítulo que você ainda consegue copiar.

O mapeamento:

| Livro (Spring Security OAuth, EOL) | Hoje (Spring Security / Spring Authorization Server) |
| --- | --- |
| `JwtTokenStore` + `JwtAccessTokenConverter` | `JwtEncoder` (lado de emissão), `JwtDecoder` (lado de validação) |
| `converter.setSigningKey(key)` | `NimbusJwtEncoder.withSecretKey(secretKey)` / `NimbusJwtDecoder.withSecretKey(secretKey)` |
| `converter.setKeyPair(pair)` | `NimbusJwtEncoder.withKeyPair(pub, priv)`, ou um bean `JWKSource<SecurityContext>` |
| `converter.setVerifierKey(pem)` | `NimbusJwtDecoder.withPublicKey(rsaPublicKey)` |
| `/oauth/token_key` + `security.oauth2.resource.jwt.key-uri` | `/oauth2/jwks` + `spring.security.oauth2.resourceserver.jwt.jwk-set-uri` |
| (nada) | `spring.security.oauth2.resourceserver.jwt.issuer-uri` — descobre o JWK set automaticamente |
| `TokenEnhancer` + `TokenEnhancerChain` | bean `OAuth2TokenCustomizer<JwtEncodingContext>` |
| `JwtAccessTokenConverter.extractAuthentication` customizado | injetar `Jwt` / `JwtAuthenticationToken` e chamar `getClaim(...)` |
| `ResourceServerConfigurerAdapter`, `@EnableResourceServer` | bean `SecurityFilterChain` com `oauth2ResourceServer(...)` |

**Simétrico, hoje.** A decodificação nomeia o algoritmo MAC explicitamente
em vez de depender de uma string de algoritmo em `SecretKeySpec`:

```java
@Bean
JwtDecoder jwtDecoder() {
    SecretKey key = new SecretKeySpec(
        jwtKey.getBytes(StandardCharsets.UTF_8), "HmacSHA256");
    return NimbusJwtDecoder.withSecretKey(key)
                           .macAlgorithm(MacAlgorithm.HS256)
                           .build();
}
```

Emitindo um token `HS256` você mesmo — a parte para a qual o livro não
tinha uma API de primeira classe, porque `JwtEncoder` não existia no Spring
Security até a 5.6:

```java
@Bean
JwtEncoder jwtEncoder(SecretKey key) {
    return new NimbusJwtEncoder(new ImmutableSecret<>(key));
}

public String issue(String subject) {
    JwsHeader header = JwsHeader.with(MacAlgorithm.HS256).build();
    JwtClaimsSet claims = JwtClaimsSet.builder()
        .issuer("https://auth.example.com")
        .subject(subject)
        .issuedAt(Instant.now())
        .expiresAt(Instant.now().plus(30, ChronoUnit.MINUTES))
        .claim("scope", "read")
        .build();

    return jwtEncoder.encode(JwtEncoderParameters.from(header, claims))
                     .getTokenValue();
}
```

**Assimétrico, hoje.** A chave privada nunca vira um bean próprio; ela vai
para um `JWKSource`, que tanto assina tokens quanto sustenta o key set
publicado:

```java
@Bean
public JWKSource<SecurityContext> jwkSource(KeyPair keyPair) {
    RSAKey rsaKey = new RSAKey.Builder((RSAPublicKey) keyPair.getPublic())
        .privateKey((RSAPrivateKey) keyPair.getPrivate())
        .keyID(UUID.randomUUID().toString())
        .build();
    return new ImmutableJWKSet<>(new JWKSet(rsaKey));
}

@Bean
public JwtEncoder jwtEncoder(JWKSource<SecurityContext> jwkSource) {
    return new NimbusJwtEncoder(jwkSource);
}
```

Aquele `keyID` é a coisa que falta no design do livro, e é o que faz a
rotação funcionar: cada chave ganha um `kid`, o header de todo token
emitido nomeia seu `kid`, e um verificador que segura um *conjunto* de
chaves escolhe a certa. Durante uma rotação o JWK set contém brevemente
tanto a chave antiga quanto a nova, tokens em trânsito assinados com a
antiga continuam validando, e nenhum resource server é reimplantado. Com
uma única string PEM em `application.properties` não existe essa janela.

**A seção 15.2.4 é JWKS, formalizado.** O `/oauth/token_key` do livro
retornando `{"alg": …, "value": "-----BEGIN PUBLIC KEY-----…"}` é uma
versão sob medida, de chave única, em formato PEM, protegida por Basic
auth, do que a RFC 7517 padroniza como um **JWK Set**: um objeto JSON com
um array `keys` de JSON Web Keys, servido sob o media type
`application/jwk-set+json`. A localização do endpoint não está na própria
RFC 7517 — vem das specs de descoberta. A RFC 8414 (OAuth 2.0
Authorization Server Metadata) define o parâmetro de metadados `jwks_uri`
como "URL do documento JWK Set do authorization server" e o caminho
well-known `/.well-known/oauth-authorization-server`; o OpenID Connect
Discovery define o `/.well-known/openid-configuration` paralelo. O
comumente visto `/.well-known/jwks.json` é uma convenção que muitos
providers adotam para o documento que `jwks_uri` aponta, não um caminho
obrigatório.

Concretamente, o Spring Authorization Server serve `/oauth2/jwks` por
padrão (a partir de `AuthorizationServerSettings`, e só se um bean
`JWKSource<SecurityContext>` existir), e um resource server o consome com
uma propriedade:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          jwk-set-uri: https://idp.example.com/oauth2/jwks
```

ou, melhor, aponta para o issuer e deixa a descoberta encontrar o key set:

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: https://idp.example.com
```

Os beans equivalentes são `NimbusJwtDecoder.withJwkSetUri(uri).build()` e
`NimbusJwtDecoder.withIssuerLocation(issuer).build()` (ou
`JwtDecoders.fromIssuerLocation(issuer)`). Diferente do endpoint do livro,
o JWK set é público — guarda só chaves públicas, então não precisa de
credenciais de client, o que remove o registro de client
`resourceserver`/`resourceserversecret` que o livro teve que inventar.
`public-key-location: classpath:my-key.pub` continua disponível para o
arranjo de chave-pública-estática do livro quando você genuinamente quer
isso.

**Claims customizadas, hoje.** Escrever é um único bean, e substitui toda a
dança do `TokenEnhancerChain` — incluindo a armadilha de "não desregistre
acidentalmente o assinante", que não existe mais porque customização e
assinatura são preocupações separadas:

```java
@Bean
public OAuth2TokenCustomizer<JwtEncodingContext> tokenCustomizer() {
    return (context) -> {
        if (OAuth2TokenType.ACCESS_TOKEN.equals(context.getTokenType())) {
            context.getClaims().claims((claims) -> {
                claims.put("generatedInZone", ZoneId.systemDefault().toString());
            });
        }
    };
}
```

(Só um bean desses pode ser definido, e a checagem `getTokenType()`
importa — sem ela você também estaria editando o ID token.)

Ler é uma linha só, sem nenhuma subclasse de converter:

```java
@GetMapping("/hello")
public String hello(@AuthenticationPrincipal Jwt jwt) {
    String zone = jwt.getClaimAsString("generatedInZone");
    return "Hello! " + zone;
}
```

`Jwt` também expõe `getSubject()`, `getAudience()`, `getClaims()`, e
acessores tipados (`getClaimAsString`, `getClaimAsStringList`,
`getClaimAsInstant`), então o tratamento de `Map` cru da listagem 15.12
está obsoleto. Se uma claim customizada deveria virar granted authorities,
isso é um `JwtAuthenticationConverter`
(`setJwtGrantedAuthoritiesConverter`) em vez de uma sobrescrita de
`extractAuthentication`.

**Também sumiu independentemente de OAuth.** `WebSecurityConfigurerAdapter`,
usado em toda classe de configuração deste capítulo, foi deprecated no
Spring Security 5.7 e removido na 6.0; o DSL `http.authorizeRequests()` deu
lugar a `authorizeHttpRequests()`; e `spring-cloud-starter-oauth2` não
carrega mais nada disso. A dependência de resource server que o livro já
lista — `spring-boot-starter-oauth2-resource-server` — é a que continua
correta.

## Trade-offs

- **Simétrico vs. assimétrico é uma decisão de confiança, não de
  performance.** HMAC é mais simples e rápido, e se um time possui tanto o
  authorization server quanto todos os resource servers e a chave é
  distribuída pelo mesmo mecanismo que distribui senhas de banco de dados,
  `HS256` é defensável. No momento em que um resource server é operado por
  alguém a quem você não deixaria emitir tokens — outro time, outra
  empresa, um integrador terceiro — simétrico está desqualificado
  independente de quão conveniente seja, porque "verificar" e "assinar" são
  a mesma capacidade. A regra de ouro do livro é a certa: se a chave
  precisa sair do seu sistema, ela não deveria ser simétrica.
- **Um JWT assinado troca revogação por independência.** Nenhuma chamada de
  rede por request, nenhum banco de dados compartilhado, resource servers
  que continuam funcionando enquanto o authorization server está fora do
  ar — mas também nenhuma forma de invalidar um token antes do `exp`.
  Tempos de vida curtos mais refresh tokens são a mitigação padrão; quando
  revogação imediata genuína é um requisito, introspecção (veja
  `spring-security-oauth2-resource-server-approaches`) é a resposta
  honesta, e o Spring Security permite introspectar tokens em formato JWT
  se você quiser o formato sem a validação offline.
- **Tudo no corpo do token é público.** Assinar protege só integridade.
  Claims são Base64, não texto cifrado — colocar qualquer coisa sensível
  numa claim customizada vaza para o client, o devtools do browser, e todo
  log que registra um header `Authorization`. Se você realmente precisa de
  confidencialidade precisa de JWE, que é um design diferente e mais
  pesado.
- **Claims customizadas transformam o token numa API que agora você precisa
  versionar.** São a ferramenta certa quando o resource server de outra
  forma precisaria de uma ida e volta ao authorization server para um valor
  que usa em todo request. São a ferramenta errada para dados que mudam
  mais rápido do que o token vive (uma claim é um snapshot tirado no
  momento da emissão e não pode ser atualizada), para payloads grandes
  (todo request os carrega, e headers têm limites de tamanho), e para
  qualquer coisa que um serviço downstream poderia simplesmente consultar.
  Adicionar uma claim é fácil; remover uma depois que três serviços
  começaram a lê-la não é.
- **Chaves públicas em tempo de config tornam a rotação teórica.** Uma
  chave pública colada nas properties de cada resource server é a coisa
  mais simples que funciona e a razão pela qual muitos sistemas nunca
  rotacionaram uma chave de assinatura. Publicar um JWK set custa um
  endpoint e compra rotação baseada em `kid` com janelas de validade
  sobrepostas — o upgrade de maior valor sobre o que a seção 15.2.3 do
  livro mostra.
- **`RS256` é o default seguro; `ES256`/`EdDSA` são o default melhor se
  você controla as duas pontas.** RSA vence em suporte universal de
  bibliotecas e é o que a maioria dos identity providers emite. EC dá o
  mesmo modelo de confiança com chaves e assinaturas muito menores e
  verificação mais rápida, o que importa em taxas altas de request e em
  clients com restrições. Escolher EC só compensa se todo verificador no
  sistema suportar — verifique antes de trocar, e note que um decoder pode
  aceitar vários algoritmos durante uma migração.
- **O raciocínio criptográfico do livro envelheceu perfeitamente; seu
  código envelheceu mal.** Toda afirmação conceitual do capítulo 15 — a
  assimetria de confiança, o argumento do roubo de chave, o caso para
  rotação, o caso para publicar a chave pública, a observação de que
  corpos de resposta não são assinados — continua exatamente certa, e os
  dois boxes laterais de migração são as únicas partes que compilam. Leia
  o capítulo pelo raciocínio e o mapeamento livro-vs-hoje acima pela API.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 15, "OAuth 2: Using JWT and cryptographic signatures", sections 15.1-15.3, p. 361-386 — doc
- [Spring Security Reference — OAuth 2.0 Resource Server JWT (NimbusJwtDecoder, jwk-set-uri, issuer-uri, jwsAlgorithm)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/jwt.html) — doc
- [Spring Security Reference — OAuth 2.0 Resource Server Opaque Token (introspection, revocation trade-off)](https://docs.spring.io/spring-security/reference/servlet/oauth2/resource-server/opaque-token.html) — doc
- [Spring Security API — NimbusJwtEncoder (withSecretKey, withKeyPair RSA/EC, encode)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/oauth2/jwt/NimbusJwtEncoder.html) — doc
- [Spring Security API — MacAlgorithm (HS256/HS384/HS512)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/oauth2/jose/jws/MacAlgorithm.html) — doc
- [Spring Authorization Server Reference — Configuration Model (default endpoints, jwkSetEndpoint "/oauth2/jwks")](https://docs.spring.io/spring-authorization-server/reference/configuration-model.html) — doc
- [Spring Authorization Server Reference — How-to: Customize the OpenID Connect 1.0 UserInfo response (shows the OAuth2TokenCustomizer bean for JwtEncodingContext)](https://docs.spring.io/spring-authorization-server/reference/guides/how-to-userinfo.html) — doc
- [Spring Authorization Server Reference — How-to: Add authorities as custom claims in JWT access tokens](https://docs.spring.io/spring-authorization-server/reference/guides/how-to-custom-claims-authorities.html) — doc
- [RFC 7515 — JSON Web Signature (JWS)](https://www.rfc-editor.org/rfc/rfc7515) — doc
- [RFC 7517 — JSON Web Key (JWK) and JWK Set](https://www.rfc-editor.org/rfc/rfc7517) — doc
- [RFC 7518 — JSON Web Algorithms (HS256, RS256, ES256 registrations and key-size requirements)](https://www.rfc-editor.org/rfc/rfc7518) — doc
- [RFC 7519 — JSON Web Token (JWT)](https://www.rfc-editor.org/rfc/rfc7519) — doc
- [RFC 8414 — OAuth 2.0 Authorization Server Metadata (jwks_uri, /.well-known/oauth-authorization-server)](https://www.rfc-editor.org/rfc/rfc8414) — doc
- [GitHub — spring-attic/spring-security-oauth (archived; contains spring-security-jwt, JwtHelper/MacSigner/RsaSigner)](https://github.com/spring-attic/spring-security-oauth) — doc
