---
version: 1.0
updatedAt: 2026-08-06
title: "Testando Authorization, CSRF e CORS com spring-security-test"
---
## Objective

O conceito irmão `spring-security-testing-mock-users-and-authentication`
cobre como *colocar um principal no `SecurityContext` do teste* —
`@WithMockUser`, `@WithUserDetails`, `@WithSecurityContext`, e testar o
próprio fluxo de login. Este começa onde aquele termina: dado um mock user,
como você de fato *assere* que suas regras de autorização, proteção CSRF e
política CORS se comportam da forma que você configurou? Três respostas, e
elas são agradavelmente diferentes em formato:

- **Method security** (`@PreAuthorize`/`@PostAuthorize`/`@PreFilter`/`@PostFilter`)
  — abandone o `MockMvc` inteiramente, injete o bean protegido do contexto,
  chame o método, e assere sobre o tipo da exception.
- **CSRF** — mantenha o `MockMvc`, e use o request post-processor `csrf()`
  para anexar um token válido. O teste que mais importa é o *sem* ele.
- **CORS** — mantenha o `MockMvc`, monte à mão o preflight do browser
  (`OPTIONS` + `Origin` + `Access-Control-Request-Method`), e assere sobre
  os headers de resposta `Access-Control-*`.

Os mecanismos sendo testados vivem nos conceitos irmãos
(`spring-security-csrf-protection`, `spring-security-cors-configuration`, e
os conceitos de method security). Este conceito é sobre escrever o teste.

## Use Cases

- Uma aplicação não-web — um job batch, um consumidor de mensageria, uma
  biblioteca — que não tem endpoint algum, então `MockMvc` não está
  disponível e method security é a única superfície de segurança a testar.
- Provar que um método de service `@PreAuthorize("hasAuthority('write')")`
  rejeita um caller autenticado-mas-com-authority-errada, não só que
  aceita o certo.
- Capturar a regressão clássica onde alguém adiciona
  `.csrf(csrf -> csrf.disable())` para fazer um teste que falha passar — um
  teste que assere `403` para um `POST` sem token falha ruidosamente
  quando isso acontece.
- Verificar uma política CORS sem levantar um browser: reproduzindo o
  preflight à mão e asserindo os valores exatos de
  `Access-Control-Allow-Origin`/`Access-Control-Allow-Methods`.
- Fazer teste de regressão de um estreitamento de CORS
  (`allowedOrigins("*")` → uma lista específica) para que uma reversão
  acidental seja capturada no CI em vez de por uma integração de parceiro
  quebrando.
- Auditar uma suíte de testes existente em busca do modo de falha em que a
  filter chain de segurança não está conectada ao `MockMvc` de forma
  alguma, então toda asserção "isso está protegido?" é vacuamente verde.

## Deep Dive

### Testando method security: sem `MockMvc`, injete o bean

O setup do livro (seção 20.4, p. 505-507) é um `NameService` cujo
`getName()` é protegido com `@PreAuthorize`:

```java
@Service
public class NameService {

  @PreAuthorize("hasAuthority('write')")
  public String getName() {
    return "Fantastico";
  }
}
```

Três cenários cobrem a regra inteira — sem usuário, authority errada,
authority certa:

```java
@SpringBootTest
class NameServiceTests {

  @Autowired
  private NameService nameService;

  @Test
  void testNameServiceWithNoUser() {
    assertThrows(AuthenticationException.class,
        () -> nameService.getName());
  }

  @Test
  @WithMockUser(authorities = "read")
  void testNameServiceWithUserButWrongAuthority() {
    assertThrows(AccessDeniedException.class,
        () -> nameService.getName());
  }

  @Test
  @WithMockUser(authorities = "write")
  void testNameServiceWithUserAndCorrectAuthority() {
    var result = nameService.getName();

    assertEquals("Fantastico", result);
  }
}
```

Duas coisas aqui são críticas e as duas são fáceis de passar batido.

**Não há `@AutoConfigureMockMvc` nem campo `MockMvc`.** Method security é
reforçada por um interceptor AOP em torno do bean, não por um filter de
servlet, então não há nada HTTP para simular. Você injeta o bean real e
chama o método real — o proxy faz o resto. É exatamente por isso que essa
abordagem funciona para aplicações sem camada web.

**Os dois modos de falha são tipos de exception distintos, e a distinção é
a asserção.** Nenhum principal autenticado de forma alguma levanta uma
`AuthenticationException` (concretamente,
`AuthenticationCredentialsNotFoundException`). Um principal autenticado sem
a authority levanta uma `AccessDeniedException`. Colapsar as duas num
único `assertThrows(RuntimeException.class, ...)` ainda passaria sem te
dizer nada sobre *qual* regra disparou — e um bug de configuração que
acidentalmente torna um endpoint acessível anonimamente apareceria como a
errada dessas duas, silenciosamente.

O mesmo formato cobre o resto da família. `@PostAuthorize` falha *depois*
que o corpo do método já rodou, então a asserção é idêntica mas os efeitos
colaterais do método já aconteceram:

```java
@Test
@WithMockUser(username = "bill")
void findDocumentForOtherOwnerThenAccessDenied() {
  // @PostAuthorize("returnObject.owner == authentication.name")
  assertThrows(AccessDeniedException.class,
      () -> documentService.findDocument("abc123"));
}
```

`@PreFilter`/`@PostFilter` não lançam nada quando a regra morde — eles
*encolhem uma coleção*. Então a asserção é sobre conteúdo, não exceptions:

```java
@Test
@WithMockUser(username = "bill")
void findDocumentsReturnsOnlyOwnDocuments() {
  List<Document> result = documentService.findDocuments();

  assertThat(result).extracting(Document::getOwner).containsOnly("bill");
}
```

Essa diferença importa ao escrever o teste: uma regra de filtering que
silenciosamente não é aplicada produz uma lista *maior*, nunca uma
exception, então um teste que só checa "nenhuma exception lançada" não
prova nada sobre `@PostFilter`.

### Testando CSRF: `.with(csrf())`, e o teste sem ele

A seção 20.6 (p. 510) é curta porque a API é um único método.
`spring-security-test` traz
`SecurityMockMvcRequestPostProcessors.csrf()`, um `RequestPostProcessor`
que popula um `CsrfToken` válido no request:

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CsrfTests {

  @Autowired
  private MockMvc mvc;

  @Test
  void helloPostWithoutCsrfTokenIsForbidden() throws Exception {
    mvc.perform(post("/hello"))
        .andExpect(status().isForbidden());
  }

  @Test
  void helloPostWithCsrfTokenIsOk() throws Exception {
    mvc.perform(post("/hello").with(csrf()))
        .andExpect(status().isOk());
  }
}
```

O segundo teste é o que as pessoas escrevem; o primeiro é o que tem valor.
`.with(csrf())` faz o CSRF parar de ser um problema para todo *outro*
teste que você escrever, o que significa que a proteção CSRF poderia estar
completamente desligada e sua suíte nunca perceberia — a menos que um
teste assere que um request de mutação sem token é rejeitado. Trate o
caso `isForbidden()` como o guarda de regressão de fato e o caso
`isOk()` como andaime.

Duas variantes existem além da chamada simples, ambas confirmadas na
referência atual:

```java
mvc.perform(post("/hello").with(csrf().asHeader()));        // token as X-CSRF-TOKEN header, not _csrf parameter
mvc.perform(post("/hello").with(csrf().useInvalidToken())); // valid shape, wrong value → still 403
```

`asHeader()` é a escolha certa quando o client de produção é JavaScript
lendo o token de um cookie, porque é assim que o token realmente chega —
testar a forma de parâmetro ali testa um caminho que nenhum client real
usa. `useInvalidToken()` distingue "o filter rejeita um token *errado*" de
"o filter rejeita um *faltando*"; o teste sem token puro sozinho não te
diz se o valor do token está sequer sendo comparado.

Note o que `csrf()` deliberadamente *não* faz: não vai buscar um token da
forma que um browser faria, primeiro fazendo `GET` numa página. Ele
escreve um token válido direto no request e no repository, pulando o
mecanismo de entrega inteiramente. Então esses testes validam o
reforço do `CsrfFilter`, não se o seu formulário Thymeleaf de fato
renderiza o input escondido ou se o seu cookie repository de fato alcança
o frontend. Essa ponta da história precisa de um `GET` que assere que o
token renderizado está presente, ou de um teste de browser de verdade.

### Testando CORS: reproduzindo o preflight à mão

A seção 20.7 (p. 511-512) faz uma observação que generaliza bem: CORS não
é nada além de headers de resposta, então testá-lo é nada além de asserir
headers de resposta. `MockMvc` não tem browser nenhum dentro dele, então
você mesmo executa o preflight — um request `OPTIONS` carregando `Origin`
e `Access-Control-Request-Method`, exatamente o que o browser envia:

```java
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class CorsTests {

  @Autowired
  private MockMvc mvc;

  @Test
  void preflightForTestEndpointReturnsCorsHeaders() throws Exception {
    mvc.perform(options("/test")
            .header("Access-Control-Request-Method", "POST")
            .header("Origin", "http://www.example.com"))
        .andExpect(status().isOk())
        .andExpect(header().exists("Access-Control-Allow-Origin"))
        .andExpect(header().string("Access-Control-Allow-Origin", "*"))
        .andExpect(header().exists("Access-Control-Allow-Methods"))
        .andExpect(header().string("Access-Control-Allow-Methods", "POST"));
  }
}
```

Os dois nomes de header são exigidos para que o request seja tratado como
um preflight — `Origin` sozinho o torna um `OPTIONS` simples e nenhum
processamento CORS acontece, o que produz uma falha confusa de "o header
simplesmente não está lá" que parece uma configuração CORS quebrada em vez
de um teste quebrado.

A asserção `status().isOk()` merece seu lugar por uma razão específica
discutida em `spring-security-cors-configuration`: requests de preflight
não carregam **nenhuma credencial**. Se o tratamento CORS não estiver
conectado à cadeia de segurança (`http.cors(...)` faltando, ou só
`@CrossOrigin` no controller), o Spring Security rejeita o preflight com
`401` antes que qualquer lógica CORS execute. Então um teste de preflight
que falha no status em vez de nos headers está te contando sobre
*ordenação*, não sobre seus valores de `CorsConfiguration`.

O caso negativo também vale a pena escrever — uma origin não permitida
deveria ser recusada, e o `CorsFilter` do Spring responde com `403`:

```java
@Test
void preflightFromDisallowedOriginIsRejected() throws Exception {
  mvc.perform(options("/test")
          .header("Access-Control-Request-Method", "POST")
          .header("Origin", "http://evil.example.org"))
      .andExpect(status().isForbidden());
}
```

Sem ele, uma configuração que acidentalmente permite toda origin passa no
teste positivo perfeitamente.

### O setup que torna tudo isso real: a filter chain precisa estar lá

Todo teste acima assume que `MockMvc` está rodando requests através do
`FilterChainProxy` do Spring Security. Se não estiver, os testes de CSRF e
CORS não asseram nada — um `POST` sem token retorna `200` porque nenhum
`CsrfFilter` chegou a rodar, e a resposta "errada" é indistinguível de um
teste passando só no caso do CSRF, que é precisamente o caso em que um
verde falso é perigoso.

Com Spring Boot, `@AutoConfigureMockMvc` conecta os filters para você. Sem
Boot, aplique o configurer explicitamente:

```java
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;

@BeforeEach
void setup() {
  mvc = MockMvcBuilders
      .webAppContextSetup(context)
      .apply(springSecurity())
      .build();
}
```

`springSecurity()` adiciona o `FilterChainProxy` mais o
`TestSecurityContextHolderPostProcessor` que torna `@WithMockUser`
visível para o request. Duas formas de acidentalmente perder isso:

- `MockMvcBuilders.standaloneSetup(controller)` — constrói um ambiente MVC
  mínimo sem filter chain alguma. Ótimo para testar o mapeamento e
  serialização de um controller, inútil para testar segurança.
- `@AutoConfigureMockMvc(addFilters = false)` — um workaround comum para
  "meus testes de controller todos falham com 401" que silenciosamente
  converte toda asserção de segurança da classe num no-op.

Method security é diferente e não depende de nada disso, já que é AOP em
vez de filters — mas tem sua própria versão da mesma armadilha.
`@EnableMethodSecurity` vive numa classe `@Configuration`, e slice tests
como `@WebMvcTest` não carregam classes `@Configuration` arbitrárias. Numa
slice, importe-a explicitamente, ou use `@SpringBootTest` como o livro
faz:

```java
@WebMvcTest(NameController.class)
@Import(MethodSecurityConfig.class)   // otherwise @PreAuthorize is simply not enforced
class NameControllerTests { }
```

### Livro vs. hoje: o código de teste não mudou; só o que o habilita se mudou

**Method security: a annotation de habilitação mudou, os testes não.** Os
projetos do capítulo 16 do livro habilitam method security com
`@EnableGlobalMethodSecurity(prePostEnabled = true)`. Essa annotation está
deprecated e foi superada por `@EnableMethodSecurity`, que reconstruiu o
mecanismo sobre a API `AuthorizationManager` e Spring AOP nativo em vez da
antiga pilha de metadata-source/config-attribute/voter, e habilita
`@PreAuthorize`, `@PostAuthorize`, `@PreFilter`, e `@PostFilter` por
default (nenhum `prePostEnabled = true` necessário). Veja os conceitos
irmãos `spring-security-method-security-preauthorization-and-postauthorization`
e `spring-security-method-security-filtering-and-spring-data` para essa
migração em detalhe.

A pergunta relevante para *este* conceito é se a reescrita mudou como você
testa, e a resposta é não. Os próprios exemplos de method security da
referência atual são estruturalmente idênticos à listagem 20.12 — injete o
bean, anote com `@WithMockUser`, assere `AccessDeniedException`:

```java
@Autowired
BankService bankService;

@WithMockUser(roles = "ADMIN")
@Test
void readAccountWithAdminRoleThenInvokes() {
  Account account = this.bankService.readAccount("12345678");
  // ... assertions
}

@WithMockUser(roles = "WRONG")
@Test
void readAccountWithWrongRoleThenAccessDenied() {
  assertThatExceptionOfType(AccessDeniedException.class)
      .isThrownBy(() -> this.bankService.readAccount("12345678"));
}
```

Um detalhe que vale a pena saber para que uma asserção existente não
surpreenda você: desde o Spring Security 6.3 os interceptors lançam
`AuthorizationDeniedException`, que **estende** `AccessDeniedException`
(pacote `org.springframework.security.authorization`). Asserções escritas
contra `AccessDeniedException` — as do livro, e as da referência —
continuam passando sem mudanças; só um teste usando igualdade estrita de
tipo em vez de `assertThrows`/`isThrownBy` (que aceitam subtypes)
precisaria de atualização. Ainda não existe uma API de "testar uma
expressão `@PreAuthorize` isoladamente": a annotation é reforçada por um
proxy, então o teste precisa de um contexto que crie o proxy.

**CSRF: `csrf()` está intocado.**
`SecurityMockMvcRequestPostProcessors.csrf()` é atual, não-deprecated, e
documentado com a mesma chamada
`mvc.perform(post("/").with(csrf()))` que o livro mostra, junto com
`csrf().asHeader()` e `csrf().useInvalidToken()`. O que mudou está por
baixo do teste, não nele: desde o Spring Security 6.0 o
`CsrfTokenRequestHandler` default é `XorCsrfTokenRequestAttributeHandler`,
que mascara o token por request para proteção BREACH, e o carregamento do
token é adiado. `csrf()` lida com os dois — ele produz um request que o
handler atual aceita — que é exatamente por que a listagem do livro ainda
compila e passa ao pé da letra numa versão moderna.

**CORS: preflight à mão ainda é a abordagem padrão.** Não existe um
post-processor `cors()` nem um helper de teste CORS dedicado em
`spring-security-test`; a seção de testes da referência cobre request
post-processors e result matchers, e CORS não está entre eles, porque CORS
é asserção de header de resposta simples que não precisa de ferramentas
específicas de segurança. A listagem 20.17 se transfere sem mudanças.

Duas ressalvas sobre os *valores esperados* dessa listagem, porém, que
são sobre a configuração que ela testa em vez da API de teste. Primeiro,
`header().string("Access-Control-Allow-Origin", "*")` só vale para uma
política genuinamente wildcard. Configurações modernas frequentemente
usam `allowedOriginPatterns` (obrigatório quando `allowCredentials(true)`
está setado, já que `*` e credenciais são ilegais juntos), e essas
**ecoam a origin que deu match** em vez de emitir `*` — então a asserção
vira:

```java
.andExpect(header().string("Access-Control-Allow-Origin", "http://www.example.com"))
```

Errar isso produz um teste falhando numa configuração *mais segura*, que
é uma boa forma de se convencer a afrouxar a política. Segundo,
`Access-Control-Allow-Methods` reflete o que quer que a
`CorsConfiguration` liste, então a asserção de string exata é frágil se
essa lista for estendida depois; `header().string(name,
containsString("POST"))` é a forma mais durável quando o ponto é "POST é
permitido" em vez de "exatamente esses métodos são permitidos".

**O wrapper em torno de tudo isso tem uma opção mais nova.** O Spring
Framework 6.2 adicionou `MockMvcTester`, um front end no sabor AssertJ para
a mesma maquinaria subjacente (`MockMvcTester.from(context)`, ou
`MockMvcTester.create(mockMvc)` para envolver uma instância existente).
Seu request builder estende `AbstractMockHttpServletRequestBuilder`,
então `with(RequestPostProcessor)` é herdado e os post-processors do
`spring-security-test` funcionam sem mudanças:

```java
assertThat(mvcTester.post().uri("/hello").with(csrf()))
    .hasStatus(HttpStatus.OK);
```

Opcional, não uma migração que você deve a ninguém — o estilo
`mvc.perform(...).andExpect(...)` do livro continua totalmente
suportado. Seu apelo prático é que uma exception não resolvida aparece no
objeto result em vez de ser lançada para fora de `perform`, o que faz
"assere que o request falhou dessa forma específica" ler melhor.

## Trade-offs

- **Testes de method security precisam de um contexto de aplicação real, o
  que os torna lentos.** `@SpringBootTest` levanta a coisa toda para
  conseguir um proxy AOP. Não há substituto mais leve — a expressão
  `@PreAuthorize` só é avaliada pelo interceptor, então mockar ou
  instanciar diretamente contorna a segurança inteiramente e produz um
  teste que sempre passa.
  ```java
  var service = new NameService();   // no proxy → @PreAuthorize never evaluated
  assertEquals("Fantastico", service.getName());  // green, and proves nothing
  ```
- **`.with(csrf())` espalhado por todo lugar silenciosamente aposenta sua
  proteção CSRF como uma propriedade testada.** É a escolha certa para
  95% dos testes que são sobre outra coisa, e significa que a *única*
  coisa entre você e um `csrf.disable()` não-testado é o único teste que
  assere `403` para um `POST` sem token. Escreva-o uma vez,
  deliberadamente, e não o apague quando ficar inconveniente.
- **`@AutoConfigureMockMvc(addFilters = false)` conserta testes que falham
  removendo o que eles estavam testando.** Perfeitamente legítimo numa
  classe que só exercita mapeamento de request e serialização JSON;
  catastrófico numa classe chamada `SecurityTests`, onde toda asserção se
  torna vazia enquanto continua verde.
- **Asserções de header CORS com string exata são precisas e frágeis em
  direções opostas.** `header().string("Access-Control-Allow-Methods",
  "POST")` captura um alargamento de política imediatamente — que é o
  ponto — mas também falha no momento em que alguém legitimamente
  adiciona `PUT`. Escolha por header: strings exatas para
  `Access-Control-Allow-Origin` (alargamento ali é o risco real) e
  `containsString` para a lista de métodos quando a intenção do teste é
  "POST é permitido".
- **Testes de preflight validam headers, não reforço.** CORS é reforçado
  pelo *browser*; um teste de preflight passando diz que seu servidor
  anuncia a política certa, não que algo foi impedido. Como o conceito de
  CORS nota, uma chamada cross-origin que o browser se recusa a mostrar
  para o JavaScript pode já ter executado do lado do servidor — então
  testes de CORS nunca são um substituto para testes de autorização no
  mesmo endpoint.
- **`csrf()` pula a entrega do token, então não consegue capturar um
  mecanismo de entrega quebrado.** O post-processor injeta um token válido
  diretamente. Um formulário Thymeleaf sem seu input escondido, ou um
  `CookieCsrfTokenRepository` cujo cookie nunca chega ao frontend, passa
  em cada um desses testes e falha em produção. Cubra a entrega
  separadamente asserindo que o token aparece na resposta do `GET`.
  ```java
  mvc.perform(get("/main"))
      .andExpect(content().string(containsString("_csrf")));
  ```
- **Testar method security via `MockMvc` em vez de por injeção direta
  confunde dois conjuntos de regras.** Chamar um endpoint que por acaso
  invoca um método `@PreAuthorize` significa que uma falha pode vir tanto
  das regras `authorizeHttpRequests` do endpoint quanto da annotation do
  método, e um `403` não diz qual. Injeção direta isola a regra do método
  — que é por que o livro abandona `MockMvc` para essa seção em vez de só
  omiti-lo.
- **O caso `assertThrows(AuthenticationException.class, ...)` do livro só
  vale quando genuinamente não há principal.** Sob um setup de
  autenticação anônima, uma chamada não-autenticada pode chegar com um
  `AnonymousAuthenticationToken` em vez de nada, transformando a
  `AuthenticationException` esperada numa `AccessDeniedException`. Vale a
  pena saber antes de assumir que o teste está quebrado —
  `@WithAnonymousUser` torna explícito qual caso você está testando.

## Documentation Links

- [Spring Security in Action (Manning, 2020) — Chapter 20, "Spring Security testing", section 20.4 "Testing method security" (p. 505-507), section 20.6 "Testing CSRF configurations" (p. 510), section 20.7 "Testing CORS configurations" (p. 511-512)](https://www.manning.com/books/spring-security-in-action) — doc
- [Spring Security Reference — Testing Method Security (@WithMockUser, @WithUserDetails, @WithSecurityContext, setupBefore)](https://docs.spring.io/spring-security/reference/servlet/test/method.html) — doc
- [Spring Security Reference — Testing with CSRF Protection (csrf(), csrf().asHeader(), csrf().useInvalidToken())](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/csrf.html) — doc
- [Spring Security Reference — Setting Up MockMvc and Spring Security (SecurityMockMvcConfigurers.springSecurity())](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/setup.html) — doc
- [Spring Security Reference — Method Security (@EnableMethodSecurity supersedes @EnableGlobalMethodSecurity; AccessDeniedException on denial; test examples)](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html) — doc
- [Spring Security API — SecurityMockMvcRequestPostProcessors (csrf, httpBasic, user, authentication, jwt, oauth2Login)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/test/web/servlet/request/SecurityMockMvcRequestPostProcessors.html) — doc
- [Spring Security API — AuthorizationDeniedException (extends AccessDeniedException, since 6.3)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/authorization/AuthorizationDeniedException.html) — doc
- [Spring Security Reference — CORS (preflight requests carry no credentials; http.cors ordering)](https://docs.spring.io/spring-security/reference/servlet/integrations/cors.html) — doc
- [Spring Framework Reference — MockMvc AssertJ Integration (MockMvcTester, since 6.2)](https://docs.spring.io/spring-framework/reference/testing/mockmvc/assertj.html) — doc
- [Spring Framework API — MockMvcTester.MockMvcRequestBuilder (inherits with(RequestPostProcessor))](https://docs.spring.io/spring-framework/docs/7.0.x/javadoc-api/org/springframework/test/web/servlet/assertj/MockMvcTester.MockMvcRequestBuilder.html) — doc
