---
version: 1.0
updatedAt: 2026-09-30
title: "Spring Modulith: Módulos de Aplicação e Verificação"
summary: "Como o Spring Modulith transforma um monolito Spring Boot em um monolito modular: cada subpacote direto é um módulo de aplicação, subpacotes são internos, e ApplicationModules.verify() quebra o build em ciclos, acesso a tipos internos e dependências não declaradas."
---
## Objective

A maioria das aplicações Spring Boot começa como um monolito com boas intenções: pacotes por feature, `publishing` aqui, `notification` ali. Seis meses depois, `notification` injeta o repositório de `publishing` para rodar uma consulta, `publishing` chama `notification` diretamente, e cada mudança se espalha pelos pacotes. Os pacotes eram organização para humanos; nada os garantia. Na outra ponta do espectro, quebrar em microservices compra fronteiras rígidas ao preço de um sistema distribuído: falhas de rede, topologia de deploy, tracing distribuído, consistência eventual.

Um **monolito modular** fica no meio: um único deployável, com fronteiras internas tão reais quanto as de serviços, mas sem custo em tempo de execução. O Spring Modulith (criado por Oliver Drotbohm, linha atual 2.x para Spring Boot 4) é um kit estrutural para isso, não um framework de runtime. Ele deriva **módulos de aplicação** da sua estrutura de pacotes, verifica num teste que os módulos não formam ciclos nem acessam internals uns dos outros, testa um módulo por vez e documenta o resultado. Este concept cobre o modelo de módulos e a verificação; eventos entre módulos e o Event Publication Registry estão em `spring-modulith-events-and-publication-registry`, testes de módulo e documentação em `spring-modulith-testing-and-documentation`.

## Use Cases

- **Impedir que um monolito em crescimento vire uma big ball of mud.** Um teste de verificação no CI quebra o build no momento em que um módulo importa um tipo interno de outro ou cria um ciclo.
- **Migrar gradualmente uma base organizada por feature.** Comece só com o teste de verificação (ele detecta ciclos sem nenhuma configuração), depois mova os internals para subpacotes, um módulo por vez. Módulos legados podem ser marcados como `OPEN` até serem limpos.
- **Preparar, sem forçar, a extração de um microservice.** Um módulo que só fala com os outros por eventos e por uma API estreita é o candidato que você pode extrair depois sem reescrever quem o chama.
- **Trabalho em paralelo sem conflitos de merge.** Duas pessoas, dois módulos, contratos claros entre eles.
- **Tornar a arquitetura revisável.** `@ApplicationModule(allowedDependencies = ...)` no `package-info.java` transforma "notification pode usar publishing" numa linha de código que aparece no code review quando alguém a muda.

## Deep Dive

### Acoplamento e coesão, desenhados como pacotes

O objetivo é o de sempre: **alta coesão** (tudo dentro de um módulo pertence junto e serve a um propósito) e **baixo acoplamento** (módulos sabem pouco uns dos outros e conversam por um contrato estreito). Coesão é o que pertence *dentro* de uma fronteira; acoplamento é o que a *atravessa*. Numa big ball of mud a coesão é baixa e o acoplamento é alto, então toda mudança é arriscada. Com fronteiras bem desenhadas, uma correção fica num lugar só, você raciocina sobre um módulo por vez, e um módulo pode ser testado com poucas dependências.

### Configuração

O Spring Modulith não é gerenciado pelo BOM do Spring Boot; importe o BOM dele (2.1.x mira o Boot 4.1, 2.0.x mira o Boot 4.0):

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.modulith</groupId>
      <artifactId>spring-modulith-bom</artifactId>
      <version>2.1.1</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>org.springframework.modulith</groupId>
    <artifactId>spring-modulith-starter-core</artifactId>
  </dependency>
  <dependency>
    <groupId>org.springframework.modulith</groupId>
    <artifactId>spring-modulith-starter-test</artifactId>
    <scope>test</scope>
  </dependency>
</dependencies>
```

O start.spring.io oferece isso como a dependência "Spring Modulith" e adiciona o BOM para você.

### Um módulo é um pacote

A regra é simples de propósito: **cada subpacote direto do pacote da classe `@SpringBootApplication` é um módulo de aplicação.**

```
com.kurz.contentmod                      <- pacote principal
├── ContentModApplication.java
├── publishing                           <- módulo "publishing"
│   ├── Content.java                     <- API (public, pacote base)
│   ├── ContentCatalog.java              <- API
│   ├── ContentPublished.java            <- API (um evento)
│   ├── PublishingService.java           <- API
│   └── internal
│       └── ContentRepository.java       <- interno, mesmo sendo public
└── notification                         <- módulo "notification"
    ├── NotificationService.java
    ├── DigestService.java
    └── SubscriberRepository.java        <- package-private
```

Os tipos públicos no **pacote base** de um módulo são a API dele. Tipos em qualquer **subpacote** são internos ao módulo, seja qual for a visibilidade Java. O nome do subpacote é convenção: `internal`, `persistence`, `web`, todos se comportam igual. Outros módulos podem usar a API; tocar num tipo interno é uma violação.

Isso é mais forte do que o Java consegue expressar sozinho. Package-private é a primeira cerca, e é garantida pelo compilador: quando `SubscriberRepository` perde o `public`, nada fora de `notification` consegue sequer importá-lo, e o Spring continua achando o bean pelo component scanning. Mas package-private deixa de funcionar assim que um módulo tem mais de um pacote: `PublishingService` em `publishing` precisa de `ContentRepository` em `publishing.internal`, então o repositório tem de ser público, e aí todos os outros pacotes da aplicação também conseguem importá-lo. A regra "subpacote = interno" do Spring Modulith é o que fecha essa brecha.

Uma nota de terminologia: estes são módulos *lógicos* dentro de um único classpath, não módulos JPMS (`module-info.java`, veja `java-platform-module-system` em Java Concepts). O JPMS garante as fronteiras em compilação e execução, mas precisa de um módulo separado (normalmente um artefato de build separado) por fronteira; o Spring Modulith mantém um único artefato e garante com um teste.

### Verificando a estrutura

```java
class ModularityTest {

    static final ApplicationModules modules = ApplicationModules.of(ContentModApplication.class);

    @Test
    void verifiesModularStructure() {
        modules.verify();
    }
}
```

`ApplicationModules.of(...)` analisa o bytecode com ArchUnit; ele não sobe o Spring, então o teste roda em bem menos de um segundo. `verify()` lança uma exceção `Violations` listando cada problema. Ele verifica:

- **Ciclos** entre módulos.
- **Acesso a tipos internos** de outro módulo.
- **Dependências permitidas**, quando um módulo as declara.
- Acesso a **named interfaces**, quando um módulo expõe named interfaces.

Rodando contra o ponto de partida "organizado por feature", em que `PublishingService` chama `NotificationService` e `NotificationService.notifySubscribers(Content)` recebe um tipo de `publishing`, a primeira execução já reporta o ciclo antes de você desenhar qualquer fronteira:

```
- Cycle detected: Slice notification ->
                Slice publishing ->
```

seguido de cada campo, parâmetro de construtor e chamada de método que cria cada aresta. Depois de mover `ContentRepository` para `publishing.internal` enquanto `notification.DigestService` ainda o injeta, o import continua **compilando** (a classe é pública), e a verificação acrescenta:

```
- Module 'notification' depends on non-exposed type
  com.kurz.contentmod.publishing.internal.ContentRepository within module 'publishing'!
```

Esse é o motivo de rodar como teste: o compilador aceita o código, a arquitetura não. O suporte a Spring Modulith do IntelliJ IDEA mostra a mesma informação no editor (ícones de módulo na project view e uma inspeção no import problemático).

`ApplicationModules` também é um modelo que você pode consultar:

```java
var publishing = modules.getModuleByName("publishing").orElseThrow();

publishing.getDirectDependencies(modules).containsModuleNamed("notification"); // false quando o ciclo sumir
publishing.isExposed(publishing.getType("ContentRepository").orElseThrow());   // false: interno
modules.forEach(System.out::println);                                           // descrição legível
```

### Corrigindo as duas violações

**Acesso a internals:** dê ao outro módulo uma API. `DigestService` não precisa do repositório, precisa de "títulos recentes":

```java
// publishing/ContentCatalog.java (pacote base: API)
@Service
public class ContentCatalog {
    private final ContentRepository repository;       // interno, usado só aqui
    public List<String> recentTitles(int limit) { ... }
}
```

**Ciclos:** inverta uma das duas setas com um evento. `publishing` anuncia o que aconteceu e deixa de saber quem reage:

```java
public Content publish(String title) {
    var content = repository.save(title);
    events.publishEvent(new ContentPublished(content));   // antes: notifications.notifySubscribers(content)
    return content;
}

// notification/NotificationService.java
@EventListener   // ou @ApplicationModuleListener, veja o próximo concept
void on(ContentPublished event) { ... }
```

`notification` continua dependendo de `publishing` (escuta um tipo de `publishing`), e tudo bem: uma direção, sem ciclo. Um novo consumidor (analytics, busca, webhooks) é um novo listener, sem mudança em `publishing`.

### Declarando dependências permitidas

Por padrão, um módulo pode depender da API de qualquer outro módulo, desde que não se forme um ciclo. Para deixar o grafo pretendido explícito, anote o pacote do módulo:

```java
// notification/package-info.java
@org.springframework.modulith.ApplicationModule(
    displayName = "Notifications",
    allowedDependencies = "publishing"
)
package com.kurz.contentmod.notification;
```

Agora uma nova dependência de `notification` em, digamos, `billing` quebra o `verify()` até alguém editar essa linha. A sintaxe:

| Valor | Permite |
|---|---|
| `"publishing"` | a API (pacote base) de `publishing` |
| `"publishing :: events"` | só a named interface `events` de `publishing` |
| `"publishing :: *"` | todas as named interfaces de `publishing` |
| `{}` (vazio) | nenhuma dependência de outros módulos |

### Named interfaces

Às vezes um módulo quer expor mais que o pacote base, ou expor coisas diferentes para consumidores diferentes. Um subpacote vira uma **named interface** com `@NamedInterface`:

```java
// publishing/events/package-info.java
@org.springframework.modulith.NamedInterface("events")
package com.kurz.contentmod.publishing.events;
```

Outros módulos agora podem usar tipos de `publishing.events`, e um consumidor pode se restringir exatamente a essa porta com `allowedDependencies = "publishing :: events"`. O pacote base continua sendo a interface padrão (sem nome) do módulo. `@NamedInterface` também pode ser colocada em tipos individuais.

### Módulos abertos, módulos compartilhados, outras estratégias de detecção

- **`type = ApplicationModule.Type.OPEN`** desliga a verificação de tipos internos daquele módulo (seus subpacotes ficam acessíveis), mantendo-o no modelo e na detecção de ciclos. Serve para código legado em migração: declare o módulo primeiro, feche depois.
- **`@Modulithic(sharedModules = "shared")`** na classe da aplicação marca módulos que todo teste de módulo sobe junto (infraestrutura comum). Mantenha-os pequenos.
- **`spring.modulith.detection-strategy=explicitly-annotated`** troca "todo subpacote direto" por "só pacotes anotados com `@ApplicationModule`" (ou `@Module` do jMolecules), útil quando o layout de pacotes não pode seguir o padrão. Módulos aninhados (um pacote `@ApplicationModule` dentro de outro módulo) são suportados desde a 1.3.
- **`spring.modulith.runtime.verification-enabled=true`** roda a verificação também na inicialização da aplicação (desligado por padrão; o lugar usual é o teste).

### O que mais o Spring Modulith oferece

Além do modelo de módulos: `@ApplicationModuleListener` e o **Event Publication Registry** para eventos duráveis entre módulos, **externalização de eventos** para Kafka, AMQP ou JMS, `@ApplicationModuleTest` para **testes de integração por módulo**, `Documenter` para **diagramas PlantUML/C4 e module canvases**, **observabilidade** (traces por módulo e um endpoint do actuator), e **Moments**, uma API de eventos de passagem do tempo (`DayHasPassed`, `MonthHasPassed`, ...) para ciclos de cobrança e jobs de limpeza. Os concepts irmãos cobrem eventos e testes.

## Trade-offs

- **Fronteiras sem o imposto de sistemas distribuídos, e sem as garantias duras deles.** Uma fronteira de módulo é garantida por um teste, não por uma rede. Qualquer um ainda pode chamar um método público entre módulos em execução se a verificação for pulada, e todos os módulos compartilham uma JVM, um banco, um deploy. Um vazamento de memória num módulo derruba a aplicação inteira. Esse é o acordo: a maior parte do benefício de design de serviços, nenhum isolamento operacional.
- **A verificação só protege se rodar.** A checagem mora numa classe de teste. Se ela não está no CI, ou alguém a marca com `@Disabled` "só para este release", as fronteiras voltam a se degradar em silêncio:
  ```java
  @Test void verifiesModularStructure() { ApplicationModules.of(Application.class).verify(); }
  ```
  Uma linha, mas ela precisa estar no build que bloqueia o merge.
- **"Subpacote direto = módulo" é opinativo.** Funciona muito bem para código organizado por feature e mal para organização por camada (`controller`, `service`, `repository` viram três "módulos" que dependem uns dos outros). Adotar o Spring Modulith numa base em camadas significa reestruturar primeiro, ou usar a detecção `explicitly-annotated`.
- **Interno é público para o Java.** Mover um tipo para `internal` não impede outro módulo de importá-lo; só o teste de verificação impede. O auto-import da IDE vai sugerir `publishing.internal.ContentRepository` a quem estiver em `notification`. Package-private continua sendo a ferramenta mais forte onde basta (módulos de um pacote só).
- **Quebrar ciclos com eventos muda o modelo de falha.** Trocar uma chamada direta por um evento remove o ciclo, mas `publish()` deixa de saber se a notificação deu certo. Com um `@EventListener` síncrono nada muda em execução; com `@ApplicationModuleListener` passa a ser assíncrono e eventualmente consistente, e você precisa do Event Publication Registry para não perder reações. Nem toda chamada deve virar evento: uma consulta ("me dê os títulos recentes") pertence a uma API como `ContentCatalog`.
- **Banco compartilhado, módulos separados.** Os módulos continuam compartilhando um schema, a não ser que você discipline a posse das tabelas. O Spring Modulith não impede `notification` de escrever SQL contra as tabelas de `publishing` pelo próprio `JdbcClient`. Trate a posse das tabelas como a posse dos pacotes (cada tabela tem um módulo dono) se quiser que a extração continue possível.
- **Um monolito modular é um destino, não só uma etapa.** O caminho para microservices é real (extraia o módulo cuja API é só eventos e poucas chamadas), mas para a maioria das aplicações o monolito modular é o estado final certo: bem estruturado, um deploy, e nenhuma rede no meio de cada caso de uso.

## Lab

Neste lab você recebe um monolito Spring Boot organizado por feature que funciona, mas que tem fronteiras frouxas: um ciclo entre módulos e um módulo mexendo no repositório interno do outro. O seu trabalho é transformá-lo num monolito modular cujas fronteiras são conferidas por um teste. A ideia central é sentir que o Spring Modulith trata cada subpacote direto como um módulo, que o pacote base de um módulo é a sua API, e que `verify()` falha quando você viola isso.

**O cenário**

`com.kurz.contentmod` tem dois subpacotes diretos, então o Modulith enxerga dois módulos: `publishing` e `notification`.

- `publishing`: `PublishingService` (publica conteúdo), `ContentRepository` (guarda em memória), `Content`, `ContentPublished` (o evento) e `ContentCatalog` (a leitura que outros módulos podem usar).
- `notification`: `NotificationService` (guarda os envios), `SubscriberRepository` (package-private) e `DigestService`.
- `ModularityTest`: roda `ApplicationModules.of(ContentModApplication.class)` com `verify()` e checagens pontuais, sem subir o Spring.
- `ContentModApplicationTest`: sobe a aplicação e garante que o refactoring não mudou o comportamento.

Dois problemas estruturais: `PublishingService` chama `NotificationService`, que por sua vez recebe um `publishing.Content`, formando um **ciclo**; e `DigestService` injeta direto o `ContentRepository`, que é público e está no pacote base de `publishing`, ou seja, na API do módulo. Rode os testes primeiro e leia a mensagem de `Violations`.

**O que você vai fazer, passo a passo**

1. **Esconder o repositório (TODO-00).** Mova `ContentRepository` para `com.kurz.contentmod.publishing.internal`. Ele continua `public`, porque `PublishingService` ainda o usa. Repare que `DigestService` continua compilando: o erro só aparece ao rodar o `ModularityTest`.
2. **Dar uma API de leitura (TODO-01).** Implemente `ContentCatalog.recentTitles(int)` devolvendo os títulos mais recentes, do mais novo para o mais antigo, e faça o `DigestService` usá-lo no lugar do repositório.
3. **Quebrar o ciclo com um evento (TODO-02).** Em `PublishingService`, publique um `ContentPublished` com `ApplicationEventPublisher` em vez de chamar `NotificationService`, e transforme `NotificationService.notifySubscribers` num `@EventListener` de `ContentPublished`.
4. **Declarar as dependências permitidas (TODO-03).** Crie `notification/package-info.java` com `@ApplicationModule(allowedDependencies = "publishing")`, para que qualquer dependência nova de `notification` em outro módulo faça `verify()` falhar.

**Como saber que terminou**

`mvn test` fica todo verde, incluindo `verify()`. Você consegue explicar por que mover a classe para `internal` a tira da API do módulo, por que o evento desfaz o ciclo e o que o `@ApplicationModule` passa a proteger.

**Desafios opcionais**

- **TODO-04:** mova `ContentPublished` para `publishing.events`, marque o pacote com `@NamedInterface("events")` num `package-info.java` próprio e mude a declaração de notification para `allowedDependencies = {"publishing", "publishing :: events"}`. Depois remova `"publishing"` da lista e leia quais tipos o `verify()` passa a rejeitar.
- **TODO-05:** adicione um terceiro módulo, `analytics`, que conta eventos `ContentPublished`, e imprima `ApplicationModules.of(ContentModApplication.class)` para ver como o Modulith o descreve.

**Pré-requisitos:** pacotes Java e visibilidade `public` vs package-private, beans do Spring e `ApplicationEventPublisher` (lab de application events), JUnit 5 e AssertJ.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `mvn test`. Os testes marcados com o número de cada TODO no `@DisplayName` ficam vermelhos até você resolvê-los, e o `verify()` descreve cada violação na mensagem de erro.

## Documentation Links

- [Spring Modulith Reference: Fundamentals](https://docs.spring.io/spring-modulith/reference/fundamentals.html): módulos de aplicação, pacotes de API vs internos, named interfaces, `@ApplicationModule`, estratégias de detecção.
- [Spring Modulith Reference: Verifying Application Module Structure](https://docs.spring.io/spring-modulith/reference/verification.html): o que o `verify()` verifica e como customizar.
- [Spring Modulith Reference: Appendix](https://docs.spring.io/spring-modulith/reference/appendix.html): matriz de compatibilidade, propriedades de configuração, artefatos.
- [Spring Modulith examples on GitHub](https://github.com/spring-projects/spring-modulith/tree/main/spring-modulith-examples): aplicações de exemplo oficiais.
- [Dan Vega: Introduction to Spring Modulith, Modular Monoliths in Spring Boot (video)](https://www.youtube.com/watch?v=xHlDyKVyvig): passo a passo de um monolito organizado por feature até módulos verificados.
- [danvega/contentmod on GitHub](https://github.com/danvega/contentmod): o código do vídeo, uma branch por passo.
