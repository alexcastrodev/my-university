---
version: 1.0
updatedAt: 2026-09-30
title: "Spring Modulith: Testes e Documentação"
summary: "Como o @ApplicationModuleTest sobe um módulo por vez, como Scenario e AssertablePublishedEvents testam a colaboração entre módulos por eventos, e como o Documenter gera diagramas C4 e module canvases a partir do mesmo modelo."
---
## Objective

Um `@SpringBootTest` sobe a aplicação inteira: todos os módulos, todos os beans, todos os datasources, para um teste que é sobre um módulo só. É lento, e esconde as dependências entre módulos, porque o que um módulo precisa de outro simplesmente está lá. O Spring Modulith transforma o modelo de módulos que ele constrói para a verificação (veja `spring-modulith-application-modules-and-verification`) em mais duas ferramentas. O **`@ApplicationModuleTest`** sobe só um módulo (opcionalmente com suas dependências), então um teste falha de forma clara quando o módulo pede um bean de que não deveria precisar, e **`Scenario`** / **`AssertablePublishedEvents`** testam a colaboração entre módulos por eventos, incluindo `@ApplicationModuleListener`s assíncronos. O **`Documenter`** escreve o mesmo modelo como diagramas PlantUML e um "canvas" por módulo, de modo que a documentação de arquitetura é gerada pelo build em vez de mantida à mão. Este concept cobre o Spring Modulith 2.x no Spring Boot 4, além do suporte de observabilidade em tempo de execução (`spring-modulith-starter-insight`).

## Use Cases

- **Testes de integração rápidos por módulo.** Testar o módulo `publishing` com seus beans reais e acesso a banco, sem subir `notification`, `billing` e o resto.
- **Deixar visíveis nos testes as dependências entre módulos.** Um módulo que precisa de três mocks para subir está dizendo algo sobre o seu acoplamento.
- **Testar fluxos por eventos sem `Thread.sleep`.** Publicar um evento, esperar o evento ou a mudança de estado resultante, verificar, com timeout.
- **Documentação de arquitetura que não fica desatualizada.** Diagramas de componentes C4 e module canvases regenerados a cada build, versionados na documentação ou publicados pelo CI.
- **Visão por módulo em execução.** Um endpoint do actuator descrevendo a estrutura de módulos e traces com um span por invocação de módulo.

## Deep Dive

### Configuração

```xml
<dependency>
  <groupId>org.springframework.modulith</groupId>
  <artifactId>spring-modulith-starter-test</artifactId>
  <scope>test</scope>
</dependency>
```

O starter de teste traz o `spring-modulith-test` (testes de módulo, `Scenario`, eventos publicados) e o `spring-modulith-docs` (`Documenter`). As versões vêm do `spring-modulith-bom`.

### @ApplicationModuleTest

```java
package com.kurz.moduletests.publishing;   // o pacote do módulo

@ApplicationModuleTest
class PublishingModuleTests {

    @Autowired PublishingService publishing;
    @Autowired ApplicationContext context;

    @Test
    void bootstrapsOnlyThisModule() {
        assertThat(context.getBeanNamesForType(PublishingService.class)).hasSize(1);
        assertThat(context.containsBean("digestService")).isFalse();   // bean de notification
    }
}
```

A classe de teste **precisa estar no pacote do módulo** (ou num subpacote dele): o Spring Modulith deduz o módulo testado a partir do pacote do teste e restringe o component scanning e os pacotes de auto-configuração a ele. Todo o resto do teste é um teste Spring Boot normal: `@Autowired`, `@MockitoBean`, `@Sql`, Testcontainers.

O bootstrap mode controla quanto da aplicação sobe:

| `BootstrapMode` | Sobe |
|---|---|
| `STANDALONE` (padrão) | só o módulo testado (mais os shared modules declarados em `@Modulithic`) |
| `DIRECT_DEPENDENCIES` | o módulo e os módulos de que ele depende diretamente |
| `ALL_DEPENDENCIES` | o módulo e toda a sua árvore de dependências |

```java
@ApplicationModuleTest(mode = ApplicationModuleTest.BootstrapMode.DIRECT_DEPENDENCIES)
```

`extraIncludes` adiciona outros módulos específicos pelo nome quando um modo é grosseiro demais.

### Beans faltando são um sinal de design

No modo `STANDALONE`, um módulo que injeta um bean de outro módulo não sobe:

```
Error creating bean with name 'digestService': Unsatisfied dependency expressed through
constructor parameter 0: No qualifying bean of type
'com.kurz.moduletests.publishing.ContentCatalog' available
```

`notification.DigestService` usa `publishing.ContentCatalog`. Duas respostas honestas:

```java
@ApplicationModuleTest
class NotificationModuleTests {

    @MockitoBean ContentCatalog catalog;   // 1. manter o teste neste módulo, stubar a API
    @Autowired DigestService digest;

    @Test
    void digestUsesCatalog() {
        when(catalog.recentTitles(3)).thenReturn(List.of("C", "B", "A"));
        assertThat(digest.weeklyDigest()).isEqualTo("This week: C, B, A");
    }
}
```

ou `mode = DIRECT_DEPENDENCIES` (2. subir `publishing` também, com as necessidades de banco dele). Cada mock é uma dependência que você enxerga; um módulo cujos testes precisam de muitos está mais acoplado do que a estrutura de pacotes sugere. Módulos que só reagem a eventos não precisam de mock nenhum.

### Verificando eventos publicados

```java
@Test
void publishesEvent(AssertablePublishedEvents events) {
    publishing.publish("Modular monoliths");

    assertThat(events)
        .contains(ContentPublished.class)
        .matching(ContentPublished::title, "Modular monoliths");
}
```

`PublishedEvents` (e a variante com AssertJ, `AssertablePublishedEvents`) é injetado como parâmetro do método de teste e registra cada application event publicado durante o teste. `ofType(...)` / `matching(...)` filtram. Desde a 2.1 ele vê eventos publicados de qualquer thread por padrão (`spring.modulith.test.thread-bound-published-events=true` restaura o comportamento antigo, preso à thread).

### Scenario: estímulo, espera, verificação

Testar um `@ApplicationModuleListener` à mão significa publicar dentro de uma transação que faz commit de verdade e depois ficar consultando até o listener assíncrono terminar. O `Scenario` embrulha as duas coisas:

```java
@Test
void notifiesSubscribers(Scenario scenario) {
    scenario.publish(new ContentPublished(42, "Modular monoliths"))
        .andWaitForEventOfType(NotificationSent.class)
        .matching(sent -> sent.title().equals("Modular monoliths"))
        .toArriveAndVerify(sent -> assertThat(sent.recipients()).isEqualTo(2));
}
```

- **Estímulo:** `scenario.publish(event)` publica um evento, `scenario.stimulate(() -> service.doSomething())` invoca um bean. Os dois rodam numa transação, então listeners `AFTER_COMMIT` disparam.
- **Esperar por:** `andWaitForEventOfType(Type.class)` (com `matching`, `matchingMapped`) ou `andWaitForStateChange(() -> repository.findById(id))` para efeitos colaterais que não são eventos.
- **Verificar:** `toArrive()`, `toArriveAndVerify(event -> ...)`, `andVerify(result -> ...)`.

A espera usa Awaitility; `.customize(conditions -> conditions.atMost(Duration.ofSeconds(2)))` muda o timeout de um cenário, um `ScenarioCustomizer` o de uma classe de teste inteira. Para o módulo testado, o estímulo muitas vezes é um evento de *outro* módulo: o teste não precisa que esse módulo exista, só o tipo do evento.

### Outros apoios para testes

- **`@ModuleSlicing`** combinado com os slices do Boot (`@DataJpaTest`, `@DataJdbcTest`, `@WebMvcTest`) limita o slice a um módulo (fatiamento horizontal e vertical; melhorado na 2.1).
- **`spring-modulith-junit`** pode pular classes de teste de módulos não afetados pelas mudanças da branch atual (`spring.modulith.test.reference-commit`), útil para acelerar o CI em monolitos grandes. Ele recua quando arquivos de build ou recursos do classpath mudam.

### Documenter: diagramas e canvases a partir do código

```java
class DocumentationTests {

    @Test
    void writeDocumentation() {
        var modules = ApplicationModules.of(Application.class);
        new Documenter(modules).writeDocumentation();
    }
}
```

`writeDocumentation()` é o atalho para os quatro métodos abaixo, e grava em `target/spring-modulith-docs` (`build/...` no Gradle):

| Método | Saída |
|---|---|
| `writeModulesAsPlantUml()` | `components.puml`: diagrama de componentes C4 de todos os módulos e suas dependências |
| `writeIndividualModulesAsPlantUml()` | `module-<name>.puml`: um módulo com seus vizinhos diretos |
| `writeModuleCanvases()` | `module-<name>.adoc`: o Application Module Canvas |
| `writeAggregatingDocument()` | `all-docs.adoc`: inclui tudo acima |

`DiagramOptions.defaults().withStyle(DiagramStyle.UML)` troca a notação C4 pela de componentes UML. O canvas é uma tabela por módulo, gerada a partir do bytecode:

```
Base package          com.kurz.moduletests.notification
Spring components     Services: c.k.m.n.DigestService
Bean references       c.k.m.p.ContentCatalog (in Publishing)
Events listened to    c.k.m.p.ContentPublished (async)
```

Ele também lista aggregate roots, eventos publicados (com os métodos que os publicam), propriedades de configuração (com `spring-boot-configuration-processor`) e estereótipos do jMolecules quando presentes. Os arquivos `.adoc` são feitos para serem incluídos num site Asciidoctor; os `.puml` renderizam em qualquer ferramenta PlantUML.

### Visão em tempo de execução

```xml
<dependency>
  <groupId>org.springframework.modulith</groupId>
  <artifactId>spring-modulith-starter-insight</artifactId>
  <scope>runtime</scope>
</dependency>
```

O starter de insight adiciona os módulos de actuator e observabilidade:

- **`/actuator/modulith`** (endpoint de id `modulith`, exponha via `management.endpoints.web.exposure.include`) devolve a estrutura de módulos em JSON: módulos, pacotes base, dependências e seus tipos.
- **Observabilidade:** chamadas à API de um módulo são embrulhadas em observations do Micrometer, então um trace distribuído (veja `distributed-tracing-and-observability` em System Design) mostra um span por módulo atravessado, e métricas por módulo passam a ser possíveis.

### Moments

O `spring-modulith-moments` (incluído no starter core) publica eventos de passagem do tempo: `HourHasPassed`, `DayHasPassed`, `WeekHasPassed`, `MonthHasPassed`, `QuarterHasPassed`, `YearHasPassed`. Um módulo de cobrança escuta `MonthHasPassed` em vez de ter a própria expressão cron. Granularidade, fuso e locale são configuráveis (`spring.modulith.moments.*`), e `spring.modulith.moments.enable-time-machine=true` expõe um bean `TimeMachine` que avança o tempo nos testes.

## Trade-offs

- **Testes de módulo só são mais rápidos se os módulos forem independentes de verdade.** Um módulo cujos beans injetam serviços de três outros módulos precisa de três mocks em `STANDALONE`, ou sobe meia aplicação em `DIRECT_DEPENDENCIES`. A ferramenta de teste não conserta o acoplamento; ela o expõe. É um feedback útil, mas o ganho de velocidade depende do design.
- **Mockar a API de outro módulo pode se afastar da realidade.** Um `@MockitoBean ContentCatalog` devolve o que você stubar. Se `publishing` mudar a semântica de `recentTitles`, o teste de `notification` continua passando. Mantenha pelo menos um teste mais amplo (um `@SpringBootTest` ou `DIRECT_DEPENDENCIES`) para os fluxos entre módulos mais importantes:
  ```java
  @ApplicationModuleTest(mode = BootstrapMode.DIRECT_DEPENDENCIES) // publishing real, menos mocks
  ```
- **A localização do teste faz parte do contrato.** `@ApplicationModuleTest` deduz o módulo pelo pacote do teste. Uma classe de teste colocada no pacote raiz, ou movida num refactoring, passa a testar outro módulo (ou nenhum) em silêncio. A convenção é simples, mas precisa ser seguida.
- **Testes assíncronos precisam de timeout, e timeouts ficam instáveis sob carga.** O `Scenario` elimina o `Thread.sleep`, não a espera. Num agente de CI lento o timeout padrão pode ser curto demais, e um listener realmente quebrado só falha depois do timeout inteiro. Ajuste timeouts por cenário em vez de deixá-los longos globalmente.
- **A documentação gerada é tão boa quanto os nomes no código.** O canvas lista o que o bytecode mostra: estereótipos, referências a beans, tipos de evento. Ele não explica *por que* uma dependência existe, e um módulo cheio de beans genéricos `Helper` produz um canvas inútil. Combine com alguns architecture decision records escritos à mão.
- **Observabilidade por módulo tem custo.** Embrulhar as chamadas à API dos módulos em observations adiciona spans e overhead a cada chamada. Faça amostragem de traces em produção e habilite onde a informação compensa.

## Documentation Links

- [Spring Modulith Reference: Integration Testing Application Modules](https://docs.spring.io/spring-modulith/reference/testing.html): `@ApplicationModuleTest`, bootstrap modes, `PublishedEvents`, `Scenario`, execução de testes guiada por mudanças.
- [Spring Modulith Reference: Documenting Application Modules](https://docs.spring.io/spring-modulith/reference/documentation.html): `Documenter`, diagramas C4 e UML, o Application Module Canvas.
- [Spring Modulith Reference: Production-ready Features](https://docs.spring.io/spring-modulith/reference/production-ready.html): o endpoint do actuator e observabilidade.
- [Spring Modulith Reference: Moments](https://docs.spring.io/spring-modulith/reference/moments.html): eventos de passagem do tempo e o `TimeMachine`.
- [Spring Modulith 2.1 GA release notes](https://spring.io/blog/2026/06/11/spring-modulith-2-1-ga-2-0-7-and-1-4-12-released/): testes de módulo combinados com slices do Boot, eventos vistos de todas as threads.
