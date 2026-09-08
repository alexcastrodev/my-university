---
version: 1.0
updatedAt: 2026-08-06
title: "Arquitetura do JUnit 5"
summary: "Como Platform, Jupiter e Vintage se encaixam para rodar testes novos e legados lado a lado, mais uma referência rápida de migração de JUnit 4 para 5, do JUnit in Action, Third Edition, Cap. 3.1/3.3 (e uma nota curta do Cap. 4)."
---
## Objective

O JUnit 5 é dividido em três camadas para que engines de teste diferentes possam compartilhar um único launcher: a `JUnit Platform` descobre e executa testes através de uma API `TestEngine`, o `JUnit Jupiter` é o novo modelo de programação (anotações, asserções, extensões) mais a engine que o executa, e o `JUnit Vintage` é uma segunda engine que roda testes antigos de JUnit 3/4 sem modificação na mesma Platform, o que é o que torna a migração do JUnit 4 incremental em vez de uma reescrita tudo-ou-nada.

## Use Cases

- Rodar testes JUnit 5 (Jupiter) e testes legados de JUnit 4 (Vintage) no mesmo build Maven/Gradle, reportados em um único conjunto de resultados unificado.
- Migrar uma suíte de testes de JUnit 4 para JUnit 5 módulo por módulo, mantendo os módulos não tocados no Vintage enquanto os convertidos migram para o Jupiter.
- Entender, quando uma IDE ou plugin Maven roda "testes JUnit", qual engine de fato executou uma determinada classe de teste.
- Registrar uma integração de terceiros (Mockito, Spring) via `@ExtendWith` em vez de um `@RunWith` de valor único no estilo JUnit 4.

## Deep Dive

### A arquitetura de três camadas

```
JUnit Platform  (descoberta + API de launcher, usada por IDEs e ferramentas de build)
   ├── JUnit Jupiter Engine  → roda métodos @Test escritos com a API do JUnit 5
   └── JUnit Vintage Engine  → roda métodos @Test antigos de JUnit 3/4 sem alteração
```

- A **JUnit Platform** define a interface de provedor de serviço `TestEngine` e a API `Launcher`. Ela não sabe o que é uma anotação `@Test`, apenas pergunta a cada engine registrada "quais dessas classes você consegue rodar, e o que aconteceu quando você rodou?".
- O **JUnit Jupiter** é o que a maioria das pessoas entende por "JUnit 5": as anotações `org.junit.jupiter.api` (`@Test`, `@BeforeEach`, ...), as classes `Assertions`/`Assumptions`, e o modelo de extensão. A engine Jupiter implementa `TestEngine` para executar tudo isso sobre a Platform.
- O **JUnit Vintage** implementa `TestEngine` para o modelo antigo `org.junit.Test`, de modo que um projeto pode adicionar as duas engines como dependência e obter uma única execução de testes cobrindo os antigos e os novos juntos.

```xml
<dependency>
    <groupId>org.junit.jupiter</groupId>
    <artifactId>junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.junit.vintage</groupId>
    <artifactId>junit-vintage-engine</artifactId>
    <scope>test</scope>
</dependency>
```

### Migrando do JUnit 4: uma nota rápida

> O livro dedica um capítulo inteiro (Cap. 4) a migrar suítes de teste JUnit 4 para JUnit 5, com mapeamento anotação por anotação (`@Before`/`@After` para `@BeforeEach`/`@AfterEach`, `@Category` para `@Tag`, `@RunWith` para `@ExtendWith`), e substituindo campos `@Rule`/`@ClassRule` (`TemporaryFolder`, `ExpectedException`) pelo modelo `Extension`. Poucos projetos novos começam em JUnit 4 hoje, então este conceito mantém esse mapeamento como uma tabela de referência rápida em vez de um conceito próprio:

| JUnit 4 | JUnit 5 (Jupiter) |
|---|---|
| `org.junit.Test` (precisa ser `public`) | `org.junit.jupiter.api.Test` (package-private já basta) |
| `@Before` / `@After` | `@BeforeEach` / `@AfterEach` |
| `@BeforeClass` / `@AfterClass` | `@BeforeAll` / `@AfterAll` |
| `@Ignore` | `@Disabled` |
| `@Category(SlowTests.class)` (interface marcadora) | `@Tag("slow")` (string simples) |
| `@RunWith(SomeRunner.class)` (valor único) | `@ExtendWith(SomeExtension.class)` (repetível) |
| `@Rule public ExpectedException thrown` | `assertThrows(...)` ou uma `Extension` customizada |

Um `@RunWith(MockitoJUnitRunner.class)` do JUnit 4 vira `@ExtendWith(MockitoExtension.class)`, mesmo propósito (criar campos `@Mock` antes do teste rodar), mecanismo de registro diferente, e agora empilhável com outras extensões na mesma classe.

## Trade-offs

- **O Vintage mantém testes antigos rodando, mas não os moderniza**: rodar testes JUnit 4 sem alteração pela engine Vintage evita uma reescrita, mas o time ainda carrega dois idiomas (`@Rule`/runners de JUnit 4 ao lado de extensões de JUnit 5) até cada teste ser migrado.
- **`@RunWith` é de valor único, `@ExtendWith` é repetível**: o JUnit 4 permitia apenas um runner por classe, forçando composições desajeitadas de runner; o JUnit 5 permite que uma classe combine múltiplas extensões independentes:

```java
@ExtendWith(MockitoExtension.class)
@ExtendWith(SpringExtension.class) // both apply, no conflict
class MultiExtensionTest { /* ... */ }
```

- **Classes/métodos de teste package-private funcionam no Jupiter, não no Vintage**: uma classe escrita para a engine nova pode dispensar `public`, mas essa mesma classe, se rodada pela engine Vintage (como se fosse JUnit 4 legado), ainda precisa de `public` para ser descoberta.

## Documentation Links

- [JUnit 5 User Guide: Arquitetura](https://docs.junit.org/current/user-guide/#overview-what-is-junit-5) (doc)
- [JUnit 5 User Guide: Migrando do JUnit 4](https://docs.junit.org/current/user-guide/#migrating-from-junit4) (doc)
- [JUnit in Action, 3rd Ed., Cap. 3, "JUnit architecture," pp. 47-62 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
- [JUnit in Action, 3rd Ed., Cap. 4, "Migrating from JUnit 4 to JUnit 5," pp. 63-86 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
