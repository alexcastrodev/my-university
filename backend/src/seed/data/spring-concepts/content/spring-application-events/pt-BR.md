---
version: 1.0
updatedAt: 2026-09-30
title: "Spring Application Events: @EventListener e @TransactionalEventListener"
summary: "Como o ApplicationEventPublisher desacopla quem publica de quem escuta, e por que a escolha entre @EventListener e @TransactionalEventListener (e sua fase) decide se um listener pode vetar a operação, se enxerga trabalho que sofreu rollback, ou se é ignorado em silêncio quando não há transação."
---
## Objective

Um serviço que salva um post e depois chama o serviço de notificação, o indexador de busca e o registrador de analytics conhece os três. Cada nova reação a "um post foi publicado" exige editar o código de publicação, e uma reação lenta ou quebrada deixa a publicação lenta ou quebrada. Os application events do Spring invertem essa dependência: quem publica anuncia um fato (`ContentPublished`) pelo `ApplicationEventPublisher`, e qualquer bean interessado declara um método listener. O publicador compila sem saber quem escuta.

A parte fácil de errar não é a publicação, é a relação entre o listener e a transação de quem publicou. Um `@EventListener` comum roda na hora, na mesma thread, dentro de uma transação que ainda não fez commit. Um `@TransactionalEventListener` espera a transação chegar a uma fase (depois do commit, por padrão) e é ignorado em silêncio quando não existe transação. Escolher entre os dois decide se o listener pode vetar a operação, se ele pode enxergar dados que depois sofrem rollback, e se a falha dele pode desfazer o trabalho de quem publicou. Este concept cobre essas regras no Spring Framework 7 / Spring Boot 4; elas também são a base sobre a qual o `@ApplicationModuleListener` do Spring Modulith é construído (veja `spring-modulith-events-and-publication-registry`).

## Use Cases

- **Efeitos colaterais que não podem bloquear a operação principal.** Enviar e-mail, atualizar índice de busca ou registrar uma métrica depois que um pedido é criado. Quem publica não deveria se importar se existem zero ou cinco reações.
- **Manter um pacote de feature independente de outro.** Numa base organizada por feature, `publishing` publicar um evento que `notification` escuta remove a dependência de compilação `publishing -> notification`. É exatamente assim que o Spring Modulith quebra ciclos entre módulos.
- **Reagir só a trabalho que aconteceu de verdade.** Indexação, invalidação de cache ou mensagens de saída que nunca podem ser enviadas por uma transação que sofreu rollback.
- **Compensação e alerta em caso de falha.** Listeners `AFTER_ROLLBACK` que registram ou alertam sobre operações que não foram concluídas.
- **Ganchos de validação de outro componente.** Um listener síncrono que lança exceção para rejeitar a operação, sem que quem publica conheça a regra.

## Deep Dive

### Publicando um evento

Desde o Spring 4.2 qualquer objeto pode ser um evento; não é preciso estender `ApplicationEvent`. Um record é o formato natural: imutável, só com os dados de que o listener precisa.

```java
public record ContentPublished(long id, String title) {}

@Service
public class ContentService {

    private final JdbcClient jdbc;
    private final ApplicationEventPublisher events;

    public ContentService(JdbcClient jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    @Transactional
    public long publish(String title) {
        var keys = new GeneratedKeyHolder();
        jdbc.sql("INSERT INTO content (title) VALUES (:title)")
            .param("title", title)
            .update(keys, "id");
        long id = keys.getKey().longValue();
        events.publishEvent(new ContentPublished(id, title));
        return id;
    }
}
```

`publishEvent` é síncrono: percorre os listeners registrados para `ContentPublished` (e seus supertipos) e chama cada um antes de retornar. Não há fila nem pool de threads, a menos que você adicione. Todo `ApplicationContext` é um `ApplicationEventPublisher`, então injetar a interface mantém a dependência estreita.

### @EventListener: mesma thread, mesma transação

```java
@Component
class TitleValidator {

    @EventListener
    void on(ContentPublished event) {
        if (event.title().toLowerCase().contains("spam")) {
            throw new IllegalArgumentException("Rejected title: " + event.title());
        }
    }
}
```

Um `@EventListener` comum roda dentro de `publishEvent`. Isso tem três consequências:

1. Ele compartilha a transação de quem publicou, então consegue ler a linha que acabou de ser inserida e ainda não teve commit.
2. Uma exceção sai de `publishEvent` e chega a `publish()`, e o `@Transactional` faz rollback do INSERT. O listener pode **vetar** a operação.
3. Quem publica espera por ele. Um listener lento é um `publish()` lento.

Também significa que um listener comum enxerga eventos de trabalho que depois sofre rollback. Suponha que `publishAll(List.of("Intro", "Part 2", "Intro"))` rode numa única transação contra uma coluna de título `UNIQUE`. Dois eventos são publicados antes de o terceiro INSERT falhar. Um indexador escrito como `@EventListener` já indexou "Intro" e "Part 2": entradas fantasmas para linhas que não existem.

`@EventListener` tem o atributo `condition` (uma expressão SpEL sobre `#event` ou `#root.event`) e pode retornar um valor ou uma coleção, que o Spring publica como novos eventos. A ordem entre listeners do mesmo evento é indefinida, a não ser que você use `@Order`.

### @TransactionalEventListener: esperar o resultado

```java
@Component
class SearchIndexer {

    @TransactionalEventListener   // phase = TransactionPhase.AFTER_COMMIT
    void on(ContentPublished event) {
        index.add(event.title());
    }
}

@Component
class RollbackAlerter {

    @TransactionalEventListener(phase = TransactionPhase.AFTER_ROLLBACK)
    void on(ContentPublished event) {
        alerts.add(event.title());
    }
}
```

Quando o evento é publicado dentro de uma transação ativa, o Spring ainda não chama esses métodos. Ele registra uma sincronização de transação e chama o listener quando a transação chega à fase escolhida:

| Fase | Roda quando | Uso típico |
|---|---|---|
| `BEFORE_COMMIT` | logo antes do commit, ainda dentro da transação | verificações ou escritas de última hora que precisam fazer parte do commit |
| `AFTER_COMMIT` (padrão) | depois de um commit bem-sucedido | notificações, indexação, mensagens de saída |
| `AFTER_ROLLBACK` | depois de um rollback | alertas, compensação |
| `AFTER_COMPLETION` | depois de commit ou rollback | limpeza que não depende do resultado |

Com o mesmo lote que falha, o indexador `AFTER_COMMIT` não vê nada, e o alertador `AFTER_ROLLBACK` vê exatamente "Intro" e "Part 2", os eventos publicados antes da falha.

Dois detalhes importam na prática:

- **Uma exceção num listener `AFTER_COMMIT` não chega a quem publicou.** A transação já fez commit; o Spring loga `TransactionSynchronization.afterCompletion threw exception` e segue. Dali não dá para vetar, e é fácil não perceber a falha. É essa lacuna que o Event Publication Registry do Spring Modulith fecha.
- **Escritas dentro de um listener `AFTER_COMMIT` não estão numa transação que você controla.** A transação original terminou. Se o listener precisa gravar no banco, dê a ele uma transação própria: `@Transactional(propagation = Propagation.REQUIRES_NEW)` no método listener.

### Sem transação, sem chamada

```java
@Service
class DraftService {
    public void saveDraft(String title) {          // sem @Transactional
        events.publishEvent(new DraftSaved(title));
    }
}

@Component
class DraftNotifier {
    @TransactionalEventListener(fallbackExecution = true)
    void on(DraftSaved event) { ... }
}
```

Se um evento é publicado sem transação ativa, um `@TransactionalEventListener` é **ignorado em silêncio**: nenhum erro, nenhuma linha de log no nível padrão. `fallbackExecution = true` manda o Spring executá-lo imediatamente nesse caso. Isso morde quando um método perde o `@Transactional` num refactoring, ou quando o método que publica é chamado via `this` (auto-invocação passa por fora do proxy transacional), e um listener que funcionava simplesmente para de disparar.

### Listeners assíncronos

```java
@EnableAsync
@SpringBootApplication
class Application {}

@Component
class AnalyticsRecorder {

    @Async
    @TransactionalEventListener
    void on(ContentPublished event) { ... }
}
```

`@Async` move o listener para um task executor (o Spring Boot configura um automaticamente; com virtual threads habilitadas via `spring.threads.virtual.enabled=true`, ele as usa). Quem publica não espera mais e um listener lento não adiciona latência. O preço: o listener não tem transação própria a menos que você declare uma, suas exceções vão para um `AsyncUncaughtExceptionHandler` em vez de alguém que possa reagir, e os testes precisam esperar o resultado (Awaitility, ou o `Scenario` do Spring Modulith). `@Async` junto de um `@EventListener` comum costuma ser um erro: o listener pode começar antes do commit de quem publicou e não encontrar a linha que deveria processar.

O `@ApplicationModuleListener` do Spring Modulith é exatamente a combinação que a maioria dos listeners de integração quer, numa anotação só: `@Async` + `@Transactional(propagation = REQUIRES_NEW)` + `@TransactionalEventListener` (AFTER_COMMIT).

### Testando listeners

Listeners transacionais só disparam quando uma transação faz commit ou rollback de verdade. Uma classe de teste anotada com `@Transactional` embrulha cada teste numa transação que sofre rollback no fim, então listeners `AFTER_COMMIT` nunca rodam e listeners `AFTER_ROLLBACK` só rodam depois das asserções. Mantenha esses testes não transacionais e limpe o estado explicitamente:

```java
@SpringBootTest   // de propósito SEM @Transactional
class ApplicationEventsTest {

    @BeforeEach
    void reset() {
        contentService.deleteAll();
        searchIndexer.clear();
    }

    @Test
    void indexerIgnoresRolledBackBatch() {
        assertThatThrownBy(() -> contentService.publishAll(List.of("Intro", "Part 2", "Intro")))
            .isInstanceOf(DataIntegrityViolationException.class);

        assertThat(searchIndexer.indexed()).isEmpty();
    }
}
```

`@RecordApplicationEvents` / `ApplicationEvents` do `spring-test` capturam os eventos publicados durante um teste quando você só precisa verificar que um evento foi publicado.

## Trade-offs

- **Desacoplado na compilação, ainda acoplado em execução.** Quem publica não importa mais o listener, mas um listener síncrono continua rodando na thread e na transação dele, e a exceção dele continua fazendo rollback de quem publicou. Eventos escondem a dependência de quem lê o código sem removê-la. Escolha o tipo de listener de propósito:
  ```java
  @EventListener                 // parte da operação: pode vetar, adiciona latência
  @TransactionalEventListener    // consequência da operação: só roda depois do commit
  ```
- **Depois do commit, a falha não tem para onde ir.** Com a transação já confirmada, uma exceção num listener `AFTER_COMMIT` é logada e descartada; se o processo cair entre o commit e o listener, a reação também se perde. Para qualquer coisa que precisa acontecer em algum momento (e-mails, mensagens para outros sistemas), eventos simples do Spring são "no máximo uma vez". Entrega durável precisa de um outbox, que o Spring Modulith oferece como Event Publication Registry.
- **Fluxo de controle implícito é mais difícil de seguir.** "Find usages" em `publishEvent` não mostra os listeners; depurar significa procurar pelo tipo do evento. Com muitos eventos e listeners, um fluxo que era uma sequência legível de chamadas fica espalhado pela base. A documentação do Spring Modulith (`Documenter`) lista eventos publicados e consumidos por módulo, o que ajuda.
- **Ignorar em silêncio é um modo de falha real.** Um `@TransactionalEventListener` sem transação ativa não faz nada e não avisa. Testes que são eles mesmos `@Transactional`, um `@Transactional` esquecido ou auto-invocação produzem bugs do tipo "o listener nunca dispara". `fallbackExecution = true` é a saída explícita, não um padrão para aplicar em todo lugar.
- **Async traz vazão e remove garantias.** `@Async` isola latência, mas a ordem entre eventos deixa de ser garantida, as exceções saem da visão de quem chamou, e o listener precisa de transação própria:
  ```java
  @Async
  @Transactional(propagation = Propagation.REQUIRES_NEW)
  @TransactionalEventListener
  void on(ContentPublished event) { ... }   // o que o @ApplicationModuleListener expande
  ```
- **Só dentro do processo.** Application events nunca saem da JVM. Outro serviço, ou outra instância do mesmo serviço, não os vê. Atravessar a fronteira do processo exige um broker (`spring-kafka-messaging`, `spring-rabbitmq-messaging`) ou a externalização de eventos do Spring Modulith.

## Documentation Links

- [Spring Framework Reference: Standard and Custom Events](https://docs.spring.io/spring-framework/reference/core/beans/context-introduction.html#context-functionality-events): `ApplicationEventPublisher`, `@EventListener`, condições, ordem, listeners assíncronos.
- [Spring Framework Reference: Transaction-bound Events](https://docs.spring.io/spring-framework/reference/data-access/transaction/event.html): `@TransactionalEventListener`, fases, `fallbackExecution`.
- [Spring Framework Javadoc: TransactionPhase](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/transaction/event/TransactionPhase.html): as quatro fases.
- [Spring Framework Reference: Application Events in tests](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/application-events.html): `@RecordApplicationEvents` e `ApplicationEvents`.
- [Spring Modulith Reference: Working with Application Events](https://docs.spring.io/spring-modulith/reference/events.html): como o `@ApplicationModuleListener` e o Event Publication Registry se apoiam nessas regras.
