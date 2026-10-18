---
version: 1.0
updatedAt: 2026-08-06
title: "Testando Spring Security: Mock Users e Autenticação"
summary: Como o spring-security-test estabelece um principal para o teste: @WithMockUser fabrica um UserDetails sem busca nenhuma (roles ganham o prefixo ROLE_ automaticamente, authorities não; vale no nível da classe e pode ser sobrescrito por método com @WithAnonymousUser), @WithUserDetails carrega um usuário real por um bean UserDetailsService para que o principal seja a sua própria implementação, e uma anotação customizada ligada a uma WithSecurityContextFactory via @WithSecurityContext serve quando o tipo concreto de Authentication importa. As três pulam a autenticação por completo, e por isso o caminho AuthenticationProvider/PasswordEncoder/handlers de sucesso e falha precisa ser exercitado à parte pelo MockMvc com httpBasic() ou o request builder formLogin() mais os matchers authenticated()/unauthenticated(). O idioma JUnit 4 do livro agora é @ExtendWith(SpringExtension.class)/@SpringJUnitConfig (implícito no @SpringBootTest), e springSecurity() é aplicado automaticamente no Spring Boot, mas continua explícito com .apply(springSecurity()) fora dele.
---
## Objective

Todo teste de integração do Spring Security precisa responder a uma
pergunta antes de poder assertar qualquer coisa: *quem está chamando?* O
módulo `spring-security-test` dá três formas escalonadas de responder isso
sem passar por um login real — `@WithMockUser` fabrica um principal do
nada, `@WithUserDetails` carrega um de verdade através do seu
`UserDetailsService` real, e uma annotation custom apoiada em
`@WithSecurityContext` + `WithSecurityContextFactory` constrói o
`SecurityContext` você mesmo quando os dois primeiros não servem. Os três
deliberadamente **pulam a autenticação**, que é por que a quarta técnica
aqui — conduzir o `MockMvc` através de um login de verdade com
`httpBasic()` ou `formLogin()` — existe como uma coisa separada que você
testa separadamente.

Este conceito é sobre *estabelecer um principal para o teste*. O conceito
irmão `spring-security-testing-authorization-csrf-and-cors` cobre o que
você então assere com esse principal em vigor (method security, tokens
CSRF, headers CORS).

## Use Cases

- Assertar que `/hello` retorna `401` sem usuário e `200` com um, sem
  levantar um user store de verdade — o menor teste de autorização
  possível.
- Testar um controller cuja resposta depende do username autenticado,
  fixando o nome do mock user (`@WithMockUser(username = "mary")`).
- Verificar que as roles e authorities no seu banco de dados de fato
  produzem o resultado de autorização esperado, carregando o usuário
  através do `UserDetailsService` real com `@WithUserDetails` em vez de um
  fabricado.
- Testar código que faz downcast de
  `SecurityContextHolder.getContext().getAuthentication()` para um tipo
  `Authentication` custom (um token apoiado em JWT, um token
  tenant-aware) — o caso em que só um `WithSecurityContextFactory` consegue
  produzir o objeto certo.
- Provar que um `AuthenticationProvider` custom de fato aceita as
  credenciais que deveria e rejeita as que não deveria — o que nenhuma das
  annotations `@With*` consegue fazer, porque elas contornam o provider
  inteiramente.
- Assertar que um `AuthenticationSuccessHandler` redireciona usuários
  diferentes para páginas diferentes após o login por formulário.

## Deep Dive

### Setup: uma dependência de teste, e quem aplica `springSecurity()`

Todo o capítulo se apoia em dois artefatos no classpath de teste:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-test</artifactId>
    <scope>test</scope>
</dependency>
```

Para que o `MockMvc` sequer veja o Spring Security, duas coisas precisam
estar conectadas: o `FilterChainProxy` do Spring Security como um servlet
`Filter`, e seu `TestSecurityContextHolderPostProcessor`, que é o que
permite que as annotations `@With*` afetem o request. No Spring puro (sem
Boot) você aplica os dois explicitamente com
`SecurityMockMvcConfigurers.springSecurity()`:

```java
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;

@ExtendWith(SpringExtension.class)
@ContextConfiguration(classes = SecurityConfig.class)
@WebAppConfiguration
class SecurityMockMvcTests {

    @Autowired
    private WebApplicationContext context;

    private MockMvc mvc;

    @BeforeEach
    void setup() {
        this.mvc = MockMvcBuilders
                .webAppContextSetup(this.context)
                .apply(springSecurity())
                .build();
    }
}
```

Numa aplicação Spring Boot você quase nunca escreve isso.
`@AutoConfigureMockMvc` (ou a slice `@WebMvcTest`) aplica `springSecurity()`
para você quando `spring-security-test` está no classpath, então a classe
de teste no sabor Boot é só:

```java
@SpringBootTest
@AutoConfigureMockMvc
class MainTests {

    @Autowired
    private MockMvc mvc;
}
```

As duas formas terminam no mesmo lugar; a do Boot é o que toda listagem do
livro usa.

### `@WithMockUser`: um principal fabricado, sem lookup

`@WithMockUser` popula o `SecurityContext` com uma instância `UserDetails`
que o framework inventa. Nenhum `UserDetailsService` é consultado, nenhum
`AuthenticationProvider` executa, nenhum `PasswordEncoder` é tocado. É de
longe a opção mais rápida e a que você vai usar na esmagadora maioria dos
testes de autorização.

Comece pelo caso negativo, que não precisa de nenhuma annotation:

```java
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
class MainTests {

    @Autowired
    private MockMvc mvc;

    @Test
    void helloUnauthenticated() throws Exception {
        mvc.perform(get("/hello"))
           .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser
    void helloAuthenticated() throws Exception {
        mvc.perform(get("/hello"))
           .andExpect(content().string("Hello!"))
           .andExpect(status().isOk());
    }
}
```

`@WithMockUser` puro te dá o username `user`, a senha `password`, e a role
única `ROLE_USER`. Quando a asserção depende desses detalhes, sete-os:

```java
@Test
@WithMockUser(username = "mary")
void helloAuthenticatedAsMary() throws Exception {
    mvc.perform(get("/hello"))
       .andExpect(content().string("Hello, mary!"))
       .andExpect(status().isOk());
}

// roles are prefixed with ROLE_ automatically; authorities are not
@Test
@WithMockUser(username = "admin", roles = { "USER", "ADMIN" })
void adminEndpoint() throws Exception { /* ... */ }

@Test
@WithMockUser(username = "admin", authorities = { "read", "write" })
void writeEndpoint() throws Exception { /* ... */ }
```

Essa divisão `roles` / `authorities` espelha a convenção da estrutura
inteira coberta em
`spring-security-authorization-authorities-and-roles`: `roles = "ADMIN"`
produz a authority `ROLE_ADMIN`, enquanto `authorities = "ADMIN"` produz
exatamente `ADMIN`.

A annotation também funciona em nível de classe (todo método de teste na
classe roda como esse usuário, incluindo classes `@Nested`), e um único
método pode optar por sair com `@WithAnonymousUser`:

```java
@SpringBootTest
@AutoConfigureMockMvc
@WithMockUser(username = "admin", roles = { "USER", "ADMIN" })
class AdminAreaTests {

    @Test
    void adminCanReachDashboard() throws Exception { /* runs as admin */ }

    @Test
    @WithAnonymousUser
    void anonymousCannot() throws Exception { /* overrides the class-level user */ }
}
```

Você também pode dobrar uma configuração frequentemente repetida numa
meta-annotation própria — sem precisar de factory, só empilhar
`@WithMockUser` sobre ela:

```java
@Retention(RetentionPolicy.RUNTIME)
@WithMockUser(value = "rob", roles = { "USER", "ADMIN" })
public @interface WithMockAdmin { }
```

### `@WithUserDetails`: um usuário real através do seu `UserDetailsService` real

`@WithMockUser` nunca toca no seu user store, que é exatamente o que você
quer até que a coisa que você está testando *seja* seu user store.
`@WithUserDetails` recebe o username que você der e chama
`loadUserByUsername()` num bean `UserDetailsService` do contexto, depois
coloca o `UserDetails` resultante no `SecurityContext`:

```java
@SpringBootTest
@AutoConfigureMockMvc
class MainTests {

    @Autowired
    private MockMvc mvc;

    @Test
    @WithUserDetails("john")
    void helloAuthenticated() throws Exception {
        mvc.perform(get("/hello"))
           .andExpect(status().isOk());
    }
}
```

A precondição é rígida: um bean `UserDetailsService` **precisa** existir no
contexto de teste, e precisa conhecer o username. Se vários estiverem
registrados, nomeie o que você quer:

```java
@Test
@WithUserDetails(value = "customUsername", userDetailsServiceBeanName = "myUserDetailsService")
void loadsFromASpecificService() throws Exception {
    Object principal = SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    assertThat(principal).isInstanceOf(CustomUserDetails.class);
}
```

Essa última asserção é o ganho real: como o usuário veio do seu próprio
service, o principal é sua própria implementação de `UserDetails` (veja
`spring-security-user-management`), com authorities e flags de status de
conta incluídos, exatamente como a produção o construiria.
`@WithMockUser` nunca consegue te dar isso.

Um detalhe de timing que o livro não cobre mas que morde na prática: por
default a annotation roda em `TestExecutionEvent.BEFORE_TEST_METHOD`, ou
seja, *antes* do `@BeforeEach` do JUnit. Se sua fixture insere o usuário no
`@BeforeEach`, o lookup falha. Empurre o setup para depois:

```java
@Test
@WithUserDetails(value = "john", setupBefore = TestExecutionEvent.TEST_EXECUTION)
void userCreatedInBeforeEach() throws Exception { /* ... */ }
```

`@WithMockUser`, `@WithAnonymousUser` e `@WithSecurityContext` aceitam o
mesmo atributo `setupBefore`.

### `@WithSecurityContext` + `WithSecurityContextFactory`: construa o contexto você mesmo

Às vezes o código sob teste se importa com o *tipo* do objeto
`Authentication` — ele faz downcast, ou lê um campo custom do principal.
Nenhuma das duas annotations anteriores permite escolher esse tipo. A
saída de emergência é construir o `SecurityContext` você mesmo, em três
passos.

**Passo 1 — declare sua própria annotation.** `RetentionPolicy.RUNTIME` é
obrigatório; o Spring lê isso reflexivamente em runtime.

```java
@Retention(RetentionPolicy.RUNTIME)
public @interface WithCustomUser {
    String username();
}
```

**Passo 2 — implemente a factory.** `WithSecurityContextFactory<A>` é
parametrizada pela sua annotation, e seu único método recebe a instância da
annotation, então todo atributo que você declarou está disponível:

```java
public class CustomSecurityContextFactory
        implements WithSecurityContextFactory<WithCustomUser> {

    @Override
    public SecurityContext createSecurityContext(WithCustomUser withCustomUser) {
        SecurityContext context = SecurityContextHolder.createEmptyContext();

        Authentication authentication = UsernamePasswordAuthenticationToken
                .authenticated(withCustomUser.username(), null, List.of());

        context.setAuthentication(authentication);
        return context;
    }
}
```

**Passo 3 — ligue os dois** com `@WithSecurityContext(factory = ...)`:

```java
@Retention(RetentionPolicy.RUNTIME)
@WithSecurityContext(factory = CustomSecurityContextFactory.class)
public @interface WithCustomUser {
    String username();
}
```

A annotation agora é usável como as embutidas:

```java
@Test
@WithCustomUser(username = "mary")
void helloAuthenticated() throws Exception {
    mvc.perform(get("/hello"))
       .andExpect(status().isOk());
}
```

A factory é um candidato a bean Spring comum, então pode receber
dependências via constructor injection — que é precisamente como o
framework implementa o próprio `@WithUserDetails`: sua factory tem um
`UserDetailsService` injetado e chama `loadUserByUsername()` em
`createSecurityContext()`. Ler essa classe é o melhor exemplo trabalhado
disponível do padrão.

Há uma lição escondida na versão do livro para esse teste que vale a pena
puxar. Spilcă a roda contra um projeto cujo `AuthenticationProvider`
custom aceita *só* o usuário "john" — e o teste passa com
`username = "mary"`. Isso não é um bug: como as outras duas annotations,
essa pula a autenticação inteiramente. Seja lá o que seu
`AuthenticationProvider` acredite sobre usuários válidos simplesmente não
é consultado.

### Testando a autenticação em si com `MockMvc`

Como as três annotations contornam a autenticação, nenhuma delas cobre um
`AuthenticationProvider` custom, um `PasswordEncoder`, um
`AuthenticationSuccessHandler`, ou um `AuthenticationFailureHandler`. Para
exercitar esses, o teste precisa agir como um client real e passar pela
filter chain inteira. Para HTTP Basic
(`spring-security-http-basic-and-form-login`), esse é o request
post-processor `httpBasic()`:

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.httpBasic;

@SpringBootTest
@AutoConfigureMockMvc
class AuthenticationTests {

    @Autowired
    private MockMvc mvc;

    @Test
    void authenticatingWithValidUser() throws Exception {
        mvc.perform(get("/hello").with(httpBasic("john", "12345")))
           .andExpect(status().isOk());
    }

    @Test
    void authenticatingWithInvalidUser() throws Exception {
        mvc.perform(get("/hello").with(httpBasic("mary", "12345")))
           .andExpect(status().isUnauthorized());
    }
}
```

Para login por formulário, `formLogin()` é um *builder* de request em vez
de um post-processor — ele substitui `get(...)` na chamada `perform()` e
produz um `POST /login` com username `user`, senha `password`, e um token
CSRF válido já anexado. Combine com os result matchers `authenticated()` /
`unauthenticated()`, que asseram sobre o `SecurityContext` resultante em
vez de sobre a resposta:

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestBuilders.formLogin;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.authenticated;
import static org.springframework.security.test.web.servlet.response.SecurityMockMvcResultMatchers.unauthenticated;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.redirectedUrl;

@Test
void loggingInWithWrongUser() throws Exception {
    mvc.perform(formLogin().user("joey").password("12345"))
       .andExpect(header().exists("failed"))     // set by a custom AuthenticationFailureHandler
       .andExpect(unauthenticated());
}

@Test
void loggingInWithWrongAuthority() throws Exception {
    mvc.perform(formLogin().user("mary").password("12345"))
       .andExpect(redirectedUrl("/error"))
       .andExpect(status().isFound())
       .andExpect(authenticated());
}

@Test
void loggingInWithCorrectAuthority() throws Exception {
    mvc.perform(formLogin().user("bill").password("12345"))
       .andExpect(redirectedUrl("/home"))
       .andExpect(status().isFound())
       .andExpect(authenticated());
}
```

Os últimos dois são o formato interessante: os dois usuários se
autenticam com sucesso (`authenticated()` passa para ambos), mas o
`AuthenticationSuccessHandler` os manda para lugares diferentes com base
nas suas authorities, e a asserção é o `302` mais o destino do redirect.
Tudo é customizável — `formLogin("/auth")` muda a URL de processamento,
`formLogin().user("u", "admin")` muda o *nome do parâmetro* junto com o
valor:

```java
mvc.perform(formLogin("/auth").user("u", "admin").password("p", "pass"));
```

O conselho estrutural do livro aqui vale a pena internalizar: teste
autenticação com um punhado de testes, uma vez, e depois teste autorização
por endpoint com mock users. Um app geralmente tem uma forma de se
autenticar mas dezenas de endpoints com regras diferentes, então re-rodar
autenticação para cada teste de endpoint não compra nada além de tempo de
relógio.

### Annotations vs. `RequestPostProcessor`: *quando* o contexto é construído

`@WithMockUser` tem um gêmeo post-processor,
`SecurityMockMvcRequestPostProcessors.user()`:

```java
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;

@Test
void helloAuthenticatedWithUser() throws Exception {
    mvc.perform(get("/hello").with(user("mary")))
       .andExpect(status().isOk());
}

// richer variants
mvc.perform(get("/admin").with(user("admin").password("pass").roles("USER", "ADMIN")));
mvc.perform(get("/").with(user(someUserDetails)));
mvc.perform(get("/").with(authentication(someAuthentication)));
mvc.perform(get("/").with(securityContext(someSecurityContext)));
```

Eles não são intercambiáveis em termos de ordem. Uma annotation é
processada por um `TestExecutionListener` *antes* do corpo do método de
teste rodar, então o request é construído dentro de um ambiente de
segurança já configurado. Um `RequestPostProcessor` funciona ao contrário:
o método de teste constrói o request primeiro, e o post-processor o muta
depois. Isso importa quando algo no próprio método de teste lê
`SecurityContextHolder` enquanto constrói o request — com a annotation ele
está populado, com `.with(user(...))` ainda não. A vantagem do
post-processor é escopo: é por request, então um único método de teste
pode fazer chamadas como vários usuários diferentes, o que uma annotation
não consegue expressar. `.defaultRequest(get("/").with(user("user").roles("ADMIN")))`
no builder aplica um a todo request na classe.

### Livro vs. hoje: JUnit 5, factories de `authenticated()`, e `MockMvcTester`

Esse é um dos cantos mais estáveis do Spring Security. Verificado contra a
documentação de referência atual (7.1.x), `@WithMockUser`,
`@WithAnonymousUser`, `@WithUserDetails`, `@WithSecurityContext`,
`WithSecurityContextFactory`, `SecurityMockMvcConfigurers.springSecurity()`,
`SecurityMockMvcRequestPostProcessors`,
`SecurityMockMvcRequestBuilders.formLogin()` e
`SecurityMockMvcResultMatchers.authenticated()` todos existem sob os mesmos
nomes, nos mesmos pacotes, com a mesma semântica que o livro descreve.
Nada nas seções 20.1-20.3 ou 20.5 foi deprecated ou renomeado. Quatro
coisas se moveram ao redor disso:

1. **JUnit 5 agora é a única suposição.** O livro já escreve JUnit 5 e diz
   para excluir `junit-vintage-engine`, mas o idioma de teste Spring ao
   redor se estabilizou: a documentação atual usa
   `@ExtendWith(SpringExtension.class)` com `@ContextConfiguration` (ou a
   composta `@SpringJUnitConfig` / `@SpringJUnitWebConfig`) onde material
   mais antigo usava `@RunWith(SpringRunner.class)`. Sob Spring Boot,
   `@SpringBootTest` e `@WebMvcTest` já são meta-anotadas com
   `@ExtendWith(SpringExtension.class)`, então você não escreve nenhum dos
   dois.

2. **`new UsernamePasswordAuthenticationToken(...)` deu lugar a factories
   estáticas.** O Spring Security 5.7 adicionou
   `UsernamePasswordAuthenticationToken.authenticated(principal, credentials,
   authorities)` e `.unauthenticated(principal, credentials)`. O
   construtor de três argumentos ainda existe mas seu javadoc agora o
   reserva para implementações de `AuthenticationManager` /
   `AuthenticationProvider` produzindo um token confiável; tudo mais —
   incluindo factories de teste — deveria usar os métodos estáticos, que
   tornam a distinção autenticado/não-autenticado explícita em vez de
   escondê-la em qual overload de construtor você escolheu. A listagem 20.9
   do livro usa o construtor; o exemplo equivalente da documentação atual
   usa `authenticated(...)`, que é o que o snippet acima reflete.

3. **O Boot aplica `springSecurity()` para você.** O livro nunca mostra
   `SecurityMockMvcConfigurers.springSecurity()` porque
   `@AutoConfigureMockMvc` cuida disso — isso ainda é verdade, e o how-to
   atual "Testing With Spring Security" do Spring Boot mostra um teste
   `@WebMvcTest` + `@WithMockUser` sem nenhum configurer manual. A forma
   explícita `.apply(springSecurity())` continua sendo o setup documentado
   para `MockMvcBuilders.webAppContextSetup(...)` sem Boot.

4. **`MockMvcTester` é o novo front end.** O Spring Framework 6.2 / Spring
   Boot 3.4 adicionou uma alternativa baseada em AssertJ ao `MockMvc`,
   auto-configurada pelas mesmas annotations `@AutoConfigureMockMvc` /
   `@WebMvcTest`. As annotations de segurança são inteiramente ortogonais
   a isso — `@WithMockUser` funciona exatamente igual, só o estilo de
   asserção muda:
   ```java
   @WebMvcTest(UserController.class)
   class MySecurityTests {

       @Autowired
       private MockMvcTester mvc;

       @Test
       @WithMockUser(roles = "ADMIN")
       void requestProtectedUrlWithUser() {
           assertThat(this.mvc.get().uri("/")).doesNotHaveFailed();
       }
   }
   ```
   A cadeia `mvc.perform(...).andExpect(...)` do livro continua
   funcionando e continua documentada; `MockMvcTester` é uma adição, não
   uma substituição.

## Trade-offs

- **As três annotations `@With*` pulam a autenticação — isso é o recurso e
  a armadilha.** Elas escrevem diretamente no `SecurityContextHolder`,
  então nenhum `AuthenticationFilter`, `AuthenticationManager`,
  `AuthenticationProvider`, `UserDetailsService` (exceto para
  `@WithUserDetails`) ou `PasswordEncoder` chega a rodar. Um teste que
  "passa com um `AuthenticationProvider` custom no lugar" não cobriu esse
  provider de forma alguma. Spilcă sinaliza isso explicitamente como um
  erro que vê repetidamente.
  ```java
  @Test
  @WithCustomUser(username = "mary")   // passes even though the provider only accepts "john"
  void helloAuthenticated() throws Exception { /* ... */ }
  ```
- **`@WithMockUser` é rápido e autocontido; `@WithUserDetails` é fiel e
  acoplado.** O mock não custa nada e não precisa de nenhum bean, mas
  nunca consegue capturar um descompasso entre as authorities que sua
  fonte de dados produz e as que suas regras esperam. `@WithUserDetails`
  captura exatamente isso, ao preço de exigir um bean `UserDetailsService`
  mais dados semeados — e de falhar de vez quando o username está
  faltando em vez de cair para um fallback.
- **`@WithSecurityContext` compra controle de tipo ao custo de uma classe
  e uma annotation por formato de cenário.** Recorra a ele só quando o
  código sob teste genuinamente depende do tipo concreto de
  `Authentication` ou principal. Se tudo que você precisa é um username ou
  conjunto de roles diferente, isso é um atributo em `@WithMockUser`, ou
  uma meta-annotation empilhando ele — nenhuma factory necessária.
- **As annotations populam o `SecurityContextHolder` da *thread do
  teste*, então não fazem nada para testes reais over-the-wire.** Um
  teste `@SpringBootTest(webEnvironment = RANDOM_PORT)` conduzindo
  `TestRestTemplate` contra um servidor ao vivo é tratado por uma thread
  diferente no container servlet; `@WithMockUser` não tem efeito ali.
  Esses testes precisam autenticar o próprio request (header HTTP Basic,
  bearer token, form post real) — que é a técnica da seção 20.5, aplicada
  por necessidade em vez de escolha.
- **Annotation vs. `RequestPostProcessor` é uma decisão de ordenação, não
  de estilo.** A annotation configura segurança antes que o corpo do teste
  construa o request; `.with(user(...))` muta o request depois de
  construído. Use o post-processor quando um método de teste precisa
  chamar como mais de um usuário, ou quando você já está compondo
  preocupações em nível de request (`httpBasic()`, `csrf()`).
  ```java
  mvc.perform(get("/hello").with(user("mary")));   // per-request, applied after the builder
  ```
- **Teste autenticação uma vez, autorização muitas vezes.** Autenticação é
  um fluxo; autorização é uma regra por endpoint. Reconduzir um login
  real para cada teste de endpoint multiplica o tempo de execução sem
  adicionar cobertura, então mantenha um punhado de testes
  `httpBasic()`/`formLogin()` para o fluxo e use mock users em todo o
  resto.

## Lab

Neste lab você recebe um `SecurityConfig` e uma factory de `SecurityContext` vazios, junto com uma suíte de testes já escrita que vale a pena ler com atenção. O seu trabalho é implementar o que os testes exercitam. A ideia central é sentir o que `@WithMockUser`, `@WithUserDetails` e uma factory customizada de `@WithSecurityContext` fazem e o que não fazem: todas fabricam um `SecurityContext` direto, pulando a autenticação real, o que as torna rápidas e também capazes de esconder um bug que um login de verdade pegaria.

**O cenário**

Uma API de inventário com dois usuários de status de conta deliberadamente diferentes: `john`, um admin habilitado, e `mary`, cuja conta está **desabilitada**.

- `InventoryController`: `GET /inventory/view` e `GET /inventory/admin`.
- `SecurityConfig`: o user store em memória, o encoder e as regras de autorização que você implementa.
- `WithCustomAdmin`: uma anotação de teste própria, que carrega um `username`.
- `CustomAdminSecurityContextFactory`: a factory por trás da anotação. Fica em `src/test`, não em `src/main`, e também é um TODO seu.
- `SecurityConfigTest`: usa `@ExtendWith(SpringExtension.class)` com `@ContextConfiguration`, e não o bootstrap manual dos outros labs, porque as anotações de teste de segurança só são aplicadas pelo `TestExecutionListener` do Spring.

O ponto central está em dois testes que fazem a mesma requisição como `mary` e recebem respostas diferentes: com `@WithUserDetails("mary")` ela chega ao endpoint (200), com HTTP Basic real ela leva 401.

**O que você vai fazer, passo a passo**

1. **Fornecer encoder e usuários (TODO-00 e TODO-01).** Retorne um `BCryptPasswordEncoder` e um `InMemoryUserDetailsManager` com `john`/`john123` (`ROLE_ADMIN`) e `mary`/`mary123` (`ROLE_USER`, com `.disabled(true)`).
2. **Escrever as regras de autorização (TODO-02).** Em `authorizeHttpRequests(...)`, exija `hasRole("ADMIN")` em `/inventory/admin` e `authenticated()` em `anyRequest()`.
3. **Habilitar Basic e devolver a chain (TODO-03 e TODO-04).** Use `httpBasic(Customizer.withDefaults())`, desligue o CSRF e retorne `http.build()`.
4. **Montar o contexto à mão (TODO-05).** Em `createSecurityContext(...)`, crie um contexto vazio com `SecurityContextHolder.createEmptyContext()`, construa um `UsernamePasswordAuthenticationToken.authenticated(withCustomAdmin.username(), null, List.of(new SimpleGrantedAuthority("ROLE_ADMIN")))`, coloque-o no contexto e devolva. Repare que isso nunca chama o `UserDetailsService`, então até um usuário inexistente como `carol` vira admin.

**Como saber que terminou**

`mvn test` fica todo verde. O mais importante é entender por que cada teste passa ou falha: você consegue explicar por que um teste verde com `@WithUserDetails` não prova que uma conta desabilitada ou bloqueada não consegue logar, e que "está autorizado?" e "conseguiria se autenticar?" são perguntas diferentes.

**Desafios opcionais**

- **TODO-06:** adicione um terceiro usuário, `legacyuser`/`legacyuser123` (`ROLE_USER`), com `.credentialsExpired(true)`. A autenticação real o rejeita por um motivo diferente do de `mary`, mas as anotações de mock continuam pulando a checagem.

**Pré-requisitos:** noções básicas de Spring Framework, `UserDetailsService`/`GrantedAuthority` (lab de authorities e roles) e `MockMvc`.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `mvn test`. Antes dos TODOs o contexto não sobe (os métodos lançam `UnsupportedOperationException`), então os testes ficam vermelhos e a lista deles é o seu checklist.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 20, "Spring Security testing", sections 20.1 "Using mock users for tests" (p. 493-500), 20.2 "Testing with users from a UserDetailsService" (p. 500-501), 20.3 "Using custom Authentication objects for testing" (p. 501-505), and 20.5 "Testing authentication" (p. 507-510) — doc
- [Spring Security Reference — Testing Method Security (@WithMockUser, @WithUserDetails, @WithSecurityContext, WithSecurityContextFactory)](https://docs.spring.io/spring-security/reference/servlet/test/method.html) — doc
- [Spring Security Reference — Setting Up MockMvc and Spring Security (springSecurity())](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/setup.html) — doc
- [Spring Security Reference — Testing Authentication (SecurityMockMvcRequestPostProcessors)](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/authentication.html) — doc
- [Spring Security Reference — Testing Form Based Authentication (formLogin())](https://docs.spring.io/spring-security/reference/servlet/test/mockmvc/form-login.html) — doc
- [Spring Boot How-to — Testing With Spring Security (@WithMockUser with MockMvcTester)](https://docs.spring.io/spring-boot/how-to/testing.html) — doc
- [Spring Boot Reference — Testing Spring Boot Applications (auto-configured MVC tests and security)](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html) — doc
- [Spring Security API — UsernamePasswordAuthenticationToken.authenticated() / .unauthenticated()](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/authentication/UsernamePasswordAuthenticationToken.html) — doc
