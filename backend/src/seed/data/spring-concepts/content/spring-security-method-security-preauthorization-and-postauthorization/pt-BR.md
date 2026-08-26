---
version: 1.0
updatedAt: 2026-08-06
title: "Method Security: Preauthorization e Postauthorization"
---
## Objective

Autorização em nível de endpoint responde "esse request HTTP pode
prosseguir?" — mas um método de bean Spring pode ser alcançado a partir de
muitos lugares que não são um request HTTP: um job agendado, um listener de
mensagem, outro service, uma chamada de repository. Method security move a
decisão de autorização para a *própria chamada do método*. O Spring Security
registra um interceptor AOP em torno de métodos anotados e avalia uma regra
SpEL antes da chamada (**preauthorization** — o método nunca executa) ou
depois dela (**postauthorization** — o método executa, mas o caller pode não
receber o resultado). O modelo de authority/role não muda; só o lugar onde a
regra é anexada se move, de um DSL de filter chain para uma annotation
sentada ao lado do código que ela protege.

## Use Cases

- Reforçar uma permissão num método de service ou repository que é chamado
  de mais de um ponto de entrada, para que a regra não possa viver num
  mapeamento de controller único — a checagem viaja com o método, não com a
  URL.
- Expressar uma regra que depende de um **argumento do método** em vez do
  request: `findSecretNames(name)` só pode ser chamado quando `name` é igual
  ao próprio username do usuário autenticado.
- Expressar uma regra que só pode ser decidida **depois** que os dados são
  carregados — "retorne esse registro de employee só se o registro carregado
  carregar a role `reader`" — onde o fato decisivo não é conhecido até o
  método retornar.
- Autorização em nível de objeto ("esse usuário aqui é dono daquele
  documento ali") complexa demais para uma expressão de uma linha, delegada
  a um `PermissionEvaluator` ou a um `AuthorizationManager` custom em sua
  própria classe.
- Proteger pontos de entrada não-web inteiramente — uma tarefa `@Scheduled`
  ou um message handler não têm `HttpServletRequest`, então uma regra
  `authorizeHttpRequests` nunca pode se aplicar a eles.

## Deep Dive

### Call authorization é um aspecto, não um filter

Autorização em nível de request executa dentro da filter chain do servlet.
Method security em vez disso habilita um **aspecto Spring AOP**: a
referência do caller ao bean é um proxy, e o interceptor fica entre caller e
target.

```
DocumentController ──▶ [ security interceptor ] ──▶ DocumentService
                            │
                            └── rule fails → AccessDeniedException, target never called
```

Duas coisas decorrem diretamente desse mecanismo. Primeiro, a regra se
aplica a *todo* caller do bean, web ou não. Segundo — a clássica ressalva de
AOP — uma self-invocation dentro da mesma classe contorna o proxy
inteiramente, então uma chamada interna `this.getDocument(code)` **não** é
interceptada.

O livro divide method security em duas famílias: **call authorization**
(este conceito — permitir ou rejeitar a chamada, ou rejeitar seu resultado)
e **filtering** (`@PreFilter`/`@PostFilter`, que deixam a chamada passar mas
podam coleções na entrada e na saída). Filtering é coberto separadamente em
`spring-security-method-security-filtering-and-spring-data`.

### Habilitando, e o que "habilitado" significa

Method security está desligado por default — o starter de segurança do
Spring Boot não a ativa. Uma annotation numa classe de configuração a liga:

```java
@Configuration
@EnableMethodSecurity
public class SecurityConfig {
}
```

Essa única annotation habilita `@PreAuthorize`, `@PostAuthorize`,
`@PreFilter` e `@PostFilter` (seu atributo `prePostEnabled` tem default
`true`). As duas alternativas legadas continuam opt-in: `securedEnabled =
true` para o próprio `@Secured` do Spring, `jsr250Enabled = true` para
`@RolesAllowed` / `@PermitAll` / `@DenyAll` do JSR-250. Ambas são
estritamente menos expressivas que as annotations de pre/post — elas
recebem nomes de role, não expressões — e raramente valem a pena escolher
para código novo.

### `@PreAuthorize`: authorities, roles e argumentos de método

A forma mais simples reutiliza exatamente o mesmo vocabulário de expressão
de autorização em nível de request — `hasAuthority`, `hasAnyAuthority`,
`hasRole`, `hasAnyRole`, `hasAllAuthorities`, `hasAllRoles`, `permitAll`,
`denyAll`, incluindo a assimetria do prefixo `ROLE_` documentada em
`spring-security-authorization-authorities-and-roles`:

```java
@Service
public class NameService {

    @PreAuthorize("hasAuthority('write')")
    public String getName() {
        return "Fantastico";
    }
}
```

Um usuário com `write` recebe o valor; um usuário só com `read` recebe um
`403` e `getName()` nunca é entrado.

O que method security acrescenta em relação ao DSL em nível de request é
acesso à **própria invocação**. Uma referência `#name` na expressão resolve
para o parâmetro do método com esse nome, e `authentication` resolve para a
`Authentication` atual:

```java
@Service
public class NameService {

    private final Map<String, List<String>> secretNames = Map.of(
        "natalie", List.of("Energico", "Perfecto"),
        "emma", List.of("Fantastico"));

    @PreAuthorize("#name == authentication.principal.username")
    public List<String> getSecretNames(String name) {
        return secretNames.get(name);
    }
}
```

Emma consegue ler `/secret/names/emma` mas recebe `403` em
`/secret/names/natalie` — uma regra que nenhuma checagem de authority
consegue expressar, porque compara um argumento contra o principal em vez
de testar uma permissão estática.

Um pré-requisito moderno para que `#name` resolva de fato: os nomes de
parâmetro precisam sobreviver à compilação. O Spring Framework 6.1 removeu
`LocalVariableTableParameterNameDiscoverer`, então o código precisa ser
compilado com `-parameters` ou o parâmetro precisa ser anotado
explicitamente com `@P` do Spring Security (ou `@Param` do Spring Data):

```java
@PreAuthorize("hasPermission(#c, 'write')")
public void updateContact(@P("c") Contact contact);
```

### `@PostAuthorize`: regras sobre `returnObject`

Às vezes o fato do qual a decisão depende não existe até o método ter
executado — você não consegue saber se um registro de employee carrega a
role `reader` antes de carregá-lo. `@PostAuthorize` executa o método, depois
avalia sua expressão contra a variável especial `returnObject`:

```java
@Service
public class BookService {

    @PostAuthorize("returnObject.roles.contains('reader')")
    public Employee getBookDetails(String name) {
        return records.get(name);
    }
}
```

Se a expressão for falsa, o interceptor descarta o resultado e lança uma
exception em vez de retorná-lo. A referência atual documenta o mesmo idioma
para o caso de ownership: `@PostAuthorize("returnObject.owner ==
authentication.name")`.

Ambas as annotations podem estar no mesmo método quando uma chamada precisa
de uma pré-checagem *e* de uma checagem de resultado.

O ponto crítico é que "o método já executou" é literalmente verdade.
Qualquer coisa que o método mutou continua mutada. O livro nota que nem
`@Transactional` te salva — a exception de postauthorization é lançada
*depois* que o transaction manager comita, então não há mais nada para dar
rollback. A referência atual declara a mesma regra como recomendação:
`@PostAuthorize` não é recomendado em classes que fazem escritas no banco de
dados; leia primeiro com `@PostAuthorize` na leitura, depois escreva só se
essa leitura foi autorizada.

### Além de SpEL de uma linha: `hasPermission()` e `PermissionEvaluator`

Strings SpEL longas são ilegíveis e intestáveis. Quando a regra precisa de
lógica de verdade — "um admin, *ou* o dono deste documento" —
`hasPermission()` repassa para um bean `PermissionEvaluator`:

```java
public interface PermissionEvaluator {

    boolean hasPermission(Authentication a, Object subject, Object permission);

    boolean hasPermission(Authentication a, Serializable id, String type, Object permission);
}
```

Dois formatos, correspondendo a dois momentos. A forma de **objeto** serve
`@PostAuthorize`, onde o subject é o resultado já carregado:

```java
@PostAuthorize("hasPermission(returnObject, 'ROLE_admin')")
public Document getDocument(String code) {
    return documentRepository.findDocument(code);
}
```

```java
@Component
public class DocumentsPermissionEvaluator implements PermissionEvaluator {

    @Override
    public boolean hasPermission(Authentication authentication,
                                 Object target, Object permission) {
        Document document = (Document) target;
        String requiredRole = (String) permission;

        boolean admin = authentication.getAuthorities().stream()
            .anyMatch(a -> a.getAuthority().equals(requiredRole));

        return admin || document.getOwner().equals(authentication.getName());
    }

    @Override
    public boolean hasPermission(Authentication authentication, Serializable targetId,
                                 String targetType, Object permission) {
        return false;
    }
}
```

A forma **id + type** serve `@PreAuthorize`, onde o objeto ainda não existe
e só seu identificador está em mãos — o evaluator o carrega por conta
própria:

```java
@PreAuthorize("hasPermission(#code, 'document', 'ROLE_admin')")
public Document getDocument(String code) {
    return documentRepository.findDocument(code);
}
```

Note o que *não* está na expressão: a `Authentication`. O Spring Security a
fornece a partir do `SecurityContext` quando chama o evaluator; a expressão
só passa o subject e o token de permission.

Registrar o evaluator é o único lugar onde a configuração moderna
genuinamente difere do livro, e é fácil de errar — veja abaixo.

### Livro vs. hoje: `@EnableGlobalMethodSecurity` → `@EnableMethodSecurity`

O livro habilita method security com:

```java
@Configuration
@EnableGlobalMethodSecurity(prePostEnabled = true)
public class ProjectConfig {
}
```

`@EnableGlobalMethodSecurity` está **deprecated**; a referência atual diz
que foi superada por `@EnableMethodSecurity` (introduzida na 5.6) e que
usuários são encorajados a migrar. As diferenças que a documentação de fato
aponta:

- **As annotations de pre/post ficam ligadas por default.**
  `@EnableMethodSecurity` sozinha equivale a
  `@EnableGlobalMethodSecurity(prePostEnabled = true)`, e também habilita
  `@PreFilter`/`@PostFilter`. Inversamente, se você só queria `@Secured`, o
  antigo `@EnableGlobalMethodSecurity(securedEnabled = true)` vira
  `@EnableMethodSecurity(securedEnabled = true, prePostEnabled = false)` — o
  antigo "desligado" implícito agora é um opt-out explícito.
- **`AuthorizationManager` substitui a pilha de voter/decision-manager.**
  Cada annotation agora tem seu próprio interceptor dedicado
  (`AuthorizationManagerBeforeMethodInterceptor#preAuthorize` com
  `PreAuthorizeAuthorizationManager`,
  `AuthorizationManagerAfterMethodInterceptor#postAuthorize` com
  `PostAuthorizeAuthorizationManager`) construído sobre Spring AOP nativo,
  em vez de metadata sources, config attributes, decision managers e
  voters. Também checa por annotations conflitantes e cumpre totalmente com
  JSR-250.
- **O lookup de `Authentication` é adiado.** O expression handler agora
  recebe um `Supplier<Authentication>`, então o lookup só acontece se a
  expressão precisar dele — aplicado automaticamente sob
  `@EnableMethodSecurity`.
- **Um `PermissionEvaluator` custom não é mais auto-detectado.** Essa é a
  armadilha para quem está portando a seção 16.4 ao pé da letra. O livro
  estende `GlobalMethodSecurityConfiguration` e sobrescreve
  `createExpressionHandler()`. O guia de migração é explícito que
  `@EnableMethodSecurity` *não capta* um `PermissionEvaluator`, para manter
  sua API simples — você precisa publicar um bean
  `MethodSecurityExpressionHandler` que o conecta, e ele precisa ser
  `static` para inicializar cedo o suficiente:
  ```java
  @Bean
  static MethodSecurityExpressionHandler methodSecurityExpressionHandler(
          DocumentsPermissionEvaluator evaluator) {
      var handler = new DefaultMethodSecurityExpressionHandler();
      handler.setPermissionEvaluator(evaluator);
      return handler;
  }
  ```
  Silenciosamente, um registro faltando deixa o
  `DenyAllPermissionEvaluator` default no lugar — todo `hasPermission()`
  retorna false.
- **O hook de subclassing mudou de lugar.** Código que estendia
  `DefaultMethodSecurityExpressionHandler` e sobrescrevia
  `createSecurityExpressionRoot(Authentication, MethodInvocation)` não
  funciona mais; o novo arranjo chama
  `createEvaluationContext(Supplier<Authentication>, MethodInvocation)`.

O que **não** mudou: o próprio SpEL. `hasAuthority`, `hasRole`,
`#parameterName`, `authentication`, `returnObject` e `hasPermission` todos
se leem exatamente como no livro, e `PermissionEvaluator` ainda é o hook
documentado para autorização em nível de objeto — não foi substituído. O que
foi *adicionado* é um ponto de extensão mais geral: você pode publicar seu
próprio `AuthorizationManager<MethodInvocation>` atrás de um pointcut custom
quando até um `PermissionEvaluator` é o formato errado, e
`@HandleAuthorizationDenied` com um `MethodAuthorizationDeniedHandler`
permite que uma negação retorne um valor mascarado ou `null` em vez de
lançar — útil quando o campo negado é parte de uma resposta JSON.

## Trade-offs

- **A regra vive ao lado do código que protege — isso é tanto o ponto forte
  quanto o custo.** Uma annotation no método de service é impossível de
  passar despercebida ao ler esse método, e cobre todo caller. Mas a
  política de autorização da aplicação agora está espalhada pelo código-fonte
  em vez de legível numa única classe de configuração, e a referência atual
  enquadra exatamente essa como a troca central: nível de request é
  grosseiro e centralizado num DSL, nível de método é fino e local, em
  annotations e SpEL.
- **Métodos sem annotation simplesmente não estão protegidos.** Method
  security não tem equivalente a `anyRequest()` — não existe um catch-all. A
  documentação é explícita que você ainda deveria declarar uma regra
  catch-all em `HttpSecurity` para que uma annotation esquecida não seja uma
  porta aberta. Method security complementa autorização em nível de
  request; não a substitui.
- **É AOP, então herda o ponto cego do AOP.** Uma chamada de dentro do
  mesmo bean não passa pelo proxy e não é checada. Isso surpreende as
  pessoas muito mais no nível de método do que no nível de filter, porque o
  código *parece* protegido.
- **`@PostAuthorize` protege o resultado, nunca os efeitos colaterais.** O
  método já executou e, com `@Transactional`, já comitou no momento em que
  a checagem falha — o livro sinaliza isso e a documentação atual transforma
  isso numa recomendação de não combinar `@PostAuthorize` com escritas no
  banco de dados. Prefira `@PreAuthorize` sempre que o fato decisivo estiver
  disponível antes da chamada; recorra a `@PostAuthorize` só quando
  genuinamente não estiver.
- **SpEL é poderoso e não checado.** `#name ==
  authentication.principal.username` compila para nada — um parâmetro
  renomeado, ou um build sem `-parameters`, quebra a regra em runtime em vez
  de em tempo de compilação. `@P("name")` fixa o nome explicitamente e vale
  o ruído em qualquer coisa crítica para segurança.
- **Empurre lógica não-trivial para fora da expressão, mas escolha o hook
  certo.** `PermissionEvaluator` é o caminho batido para "este usuário
  contra aquele objeto" e ainda é atual; um `AuthorizationManager` custom é
  a saída mais geral (e mais moderna). De qualquer forma, lógica numa classe
  é testável por unidade — uma string SpEL de três cláusulas não é.
- **`@Secured` e `@RolesAllowed` existem, e quase nunca são a escolha
  certa.** Eles aceitam só nomes de role: sem argumentos, sem
  `returnObject`, sem expressões. O próprio veredito do livro é que você
  dificilmente vai encontrá-los em código real; seu uso principal hoje é
  interoperabilidade com annotations JSR-250 existentes.

## Documentation Links

- Laurențiu Spilcă, "Spring Security in Action" (Manning, 2020) — Chapter 16, "Global method security: Pre- and postauthorizations", sections 16.1-16.4, p. 388-412 — doc
- [Spring Security Reference — Method Security](https://docs.spring.io/spring-security/reference/servlet/authorization/method-security.html) — doc
- [Spring Security API — EnableMethodSecurity](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/config/annotation/method/configuration/EnableMethodSecurity.html) — doc
- [Spring Security API — EnableGlobalMethodSecurity (deprecated)](https://docs.spring.io/spring-security/site/docs/current/api/org/springframework/security/config/annotation/method/configuration/EnableGlobalMethodSecurity.html) — doc
- [Spring Security 5.8 Migration Guide — Authorization Migrations](https://docs.spring.io/spring-security/reference/5.8/migration/servlet/authorization.html) — doc
- [Spring Security 6.5 Migration Guide — Compile With -parameters](https://docs.spring.io/spring-security/reference/6.5/migration/servlet/authorization.html) — doc
