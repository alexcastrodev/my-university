---
version: 1.0
updatedAt: 2026-09-30
title: "Spring Modulith: Eventos e o Event Publication Registry"
summary: "Como o @ApplicationModuleListener (assíncrono, depois do commit, em transação própria) e o Event Publication Registry tornam duráveis os eventos entre módulos: as publicações são gravadas na transação de negócio, acompanhadas pelos estados PUBLISHED, COMPLETED e FAILED, reenviadas, e opcionalmente externalizadas para um broker."
---
## Objective

Quando os módulos param de se chamar diretamente, os eventos viram o tecido que os conecta: `publishing` anuncia `ContentPublished`, `notification` reage. O jeito óbvio de reagir, um listener comum do Spring, traz o acoplamento de volta em outra forma. Síncrono, e uma queda do servidor de e-mail faz a publicação falhar. `AFTER_COMMIT` e assíncrono, e uma queda do processo entre o commit e o listener perde a notificação em silêncio: o conteúdo está no banco, ninguém foi avisado, ninguém percebeu.

O Spring Modulith resolve as duas metades. O `@ApplicationModuleListener` empacota os padrões certos para integrar módulos (assíncrono, depois do commit, em transação própria), e o **Event Publication Registry** grava um registro de cada publicação para cada listener transacional *na mesma transação dos dados de negócio*, e depois a marca como concluída quando o listener termina com sucesso. Entregas que falharam ou nem começaram ficam no registry e podem ser reenviadas. É o padrão transactional outbox (veja `outbox-pattern` em System Design) implementado dentro da aplicação, sem broker e sem código extra no listener. A externalização de eventos então encaminha eventos selecionados para Kafka, AMQP ou JMS a partir do mesmo registry. Este concept cobre o Spring Modulith 2.x no Spring Boot 4.

## Use Cases

- **Integrar módulos de aplicação sem acoplamento temporal.** A publicação faz commit mesmo com o lado de notificação fora do ar ou lento.
- **Efeitos colaterais at-least-once.** E-mails, webhooks, indexação de busca ou chamadas a sistemas externos que precisam acontecer em algum momento depois de uma transação de negócio bem-sucedida.
- **Sobreviver a reinícios.** Publicações gravadas mas não concluídas antes de uma queda ou de um deploy são retomadas (`republish-outstanding-events-on-restart`, ou um job explícito de reenvio).
- **Visibilidade operacional de reações que falharam.** A tabela `EVENT_PUBLICATION` mostra, por listener, o que está publicado, em processamento, concluído ou com falha, que é onde um endpoint de operação ou um dashboard pode olhar.
- **Publicar eventos de domínio para outros serviços.** `@Externalized` envia eventos selecionados para um broker depois do commit, reaproveitando o registry como outbox.

## Deep Dive

### @ApplicationModuleListener

```java
@Component
class NotificationListener {

    private final MailGateway mail;

    NotificationListener(MailGateway mail) {
        this.mail = mail;
    }

    @ApplicationModuleListener
    void on(ContentPublished event) {
        mail.send("New content: " + event.title());
    }
}
```

É uma anotação composta:

```java
@Async
@Transactional(propagation = Propagation.REQUIRES_NEW)
@TransactionalEventListener   // AFTER_COMMIT
```

Cada parte corrige um problema de um listener ingênuo (veja `spring-application-events`):

- **AFTER_COMMIT:** o listener só reage a conteúdo que existe de verdade, nunca a uma publicação que sofreu rollback.
- **`@Async`:** quem publica não espera; um listener lento não adiciona latência nem bloqueia a thread da requisição.
- **`REQUIRES_NEW`:** o listener ganha uma transação própria. As escritas dele fazem commit ou rollback sozinhas, e a falha dele não alcança a transação de quem publicou, que já fez commit.

O lado de quem publica não muda: um método `@Transactional` chamando `ApplicationEventPublisher.publishEvent(...)`. O Spring Modulith traz uma configuração padrão de executor assíncrono; `spring.modulith.default-async-termination=true` (o padrão) faz a aplicação esperar os listeners em execução no shutdown.

### O Event Publication Registry

Adicione um starter para a tecnologia de persistência que você já usa:

| Armazenamento | Starter |
|---|---|
| JDBC | `spring-modulith-starter-jdbc` |
| JPA | `spring-modulith-starter-jpa` |
| MongoDB | `spring-modulith-starter-mongodb` |
| Neo4j | `spring-modulith-starter-neo4j` |

Com ele no classpath, publicar um evento que tem listeners transacionais insere uma linha por listener em `EVENT_PUBLICATION`, **dentro da transação de quem publica**. A linha guarda o id do listener, o tipo do evento, o evento serializado (JSON, via Jackson), a data de publicação e, desde a 2.0, um status. Nenhum código da aplicação muda.

```sql
CREATE TABLE IF NOT EXISTS event_publication (
  id                     UUID NOT NULL,
  listener_id            TEXT NOT NULL,
  event_type             TEXT NOT NULL,
  serialized_event       TEXT NOT NULL,
  publication_date       TIMESTAMP WITH TIME ZONE NOT NULL,
  completion_date        TIMESTAMP WITH TIME ZONE,
  status                 TEXT,
  completion_attempts    INT,
  last_resubmission_date TIMESTAMP WITH TIME ZONE,
  PRIMARY KEY (id)
);
```

(Formato PostgreSQL; o starter traz DDL para H2, HSQLDB, MySQL, MariaDB, PostgreSQL, Oracle e SQL Server.)

Como a escrita no registry compartilha a transação de negócio, os casos interessantes se alinham exatamente:

| Situação | tabela `content` | `EVENT_PUBLICATION` |
|---|---|---|
| Listener teve sucesso | linha confirmada | `COMPLETED`, data de conclusão preenchida |
| Listener lançou exceção | linha confirmada | `FAILED` |
| Quem publicou sofreu rollback | nenhuma linha | nenhuma linha |
| Processo caiu depois do commit, antes de o listener terminar | linha confirmada | ainda `PUBLISHED` / `PROCESSING` |

A última linha é a que eventos simples do Spring não conseguem tratar: o fato de que uma reação está pendente sobrevive à queda.

O registry acompanha publicações para **qualquer** listener transacional, não só `@ApplicationModuleListener`; um `@TransactionalEventListener` comum também é registrado (a exceção dele é logada pelo Spring e a publicação fica `FAILED`). O que o `@ApplicationModuleListener` acrescenta é a execução assíncrona e a transação própria do listener.

### Ciclo de vida da publicação (2.0+)

O Spring Modulith 2.0 introduziu um status explícito (`EventPublication.Status`):

```
PUBLISHED -> PROCESSING -> COMPLETED
                 |
                 v
               FAILED -> RESUBMITTED -> PROCESSING -> ...
```

`EventPublication` também expõe `getCompletionAttempts()` e `getLastResubmissionDate()`. Um **staleness monitor** pode marcar como `FAILED` publicações presas em `PUBLISHED`, `PROCESSING` ou `RESUBMITTED` depois de um tempo configurável (`spring.modulith.events.staleness.published`, `.processing`, `.resubmitted`, verificado a cada `spring.modulith.events.staleness.check-interval`, um minuto por padrão). Sem ele, um listener que morreu no meio do caminho ficaria `PROCESSING` para sempre.

### Reenviando

Três APIs, todas beans que você pode injetar:

```java
@Service
public class NotificationRecovery {

    private final FailedEventPublications failed;

    NotificationRecovery(FailedEventPublications failed) {
        this.failed = failed;
    }

    @Scheduled(fixedDelay = 60_000)
    public void retryFailed() {
        failed.resubmit(ResubmissionOptions.defaults()
            .withMinAge(Duration.ofMinutes(1))
            .withBatchSize(100));
    }
}
```

- **`FailedEventPublications.resubmit(ResubmissionOptions)`** (2.0+): reenvia publicações no estado `FAILED`. `ResubmissionOptions` controla tamanho do lote, máximo em andamento, idade mínima e um filtro sobre a publicação.
- **`IncompleteEventPublications`**: `resubmitIncompletePublications(Predicate)`, `resubmitIncompletePublicationsOlderThan(Duration)`, ou com `ResubmissionOptions`. Cobre tudo que não foi concluído.
- **`spring.modulith.events.republish-outstanding-events-on-restart=true`**: uma varredura das publicações incompletas na inicialização. Prático com uma instância; com várias, cada uma republica ao subir, então um reenvio explícito e agendado (de preferência com lock) costuma ser mais seguro.

O reenvio chama o listener de novo com o evento desserializado. A entrega, portanto, é **at least once**: o listener precisa ser idempotente.

### Publicações concluídas

`spring.modulith.events.completion-mode` decide o que acontece no sucesso:

| Modo | Efeito |
|---|---|
| `update` (padrão) | preenche data de conclusão e status; as linhas ficam em `EVENT_PUBLICATION` |
| `delete` | remove a linha; a tabela guarda só trabalho pendente |
| `archive` | move a linha para uma tabela de arquivo (`EVENT_PUBLICATION_ARCHIVE`) |

Com `update`, a tabela cresce para sempre a menos que você a limpe. `CompletedEventPublications` oferece `findAll()`, `deletePublications(Predicate)` e `deletePublicationsOlderThan(Duration)`, normalmente chamados por um job agendado.

### Gerenciamento do schema

No Spring Modulith 2.1 o registry JDBC cria a tabela na inicialização quando ela não existe: a auto-configuração de `spring.modulith.events.jdbc.schema-initialization.enabled` casa quando a propriedade está ausente (verificado na 2.1.1, embora o metadata da propriedade liste o padrão como `false`; as versões 1.x exigiam habilitar). Em produção, defina como `false` e mantenha o DDL no Flyway ou Liquibase, copiando o script do seu banco do apêndice do Spring Modulith. `spring.modulith.events.jdbc.schema` coloca a tabela num schema específico; `use-legacy-structure=true` mantém o layout de tabela anterior à 2.0 para aplicações que ainda não migraram.

### Externalizando eventos para um broker

```java
@Externalized("content.published::#{#this.id()}")
public record ContentPublished(long id, String title) {}
```

Com `spring-modulith-events-kafka` (ou `-amqp`, `-jms`, `-messaging`) no classpath, eventos anotados com `@Externalized` (ou `@Externalized` do jMolecules) são enviados ao broker por um listener apoiado no registry depois do commit. O valor é `target::key`, e as duas partes podem ser SpEL com o evento como raiz: o Kafka usa como tópico e chave da mensagem, o AMQP como exchange e routing key. Como o envio passa pelo registry, uma queda do broker deixa uma publicação `FAILED` em vez de uma mensagem perdida. Roteamento programático (`EventExternalizationConfiguration`) evita anotar os tipos de evento. Desde a 2.1, `spring.modulith.events.externalization.mode=outbox` pode delegar o envio a uma implementação de outbox dedicada (`spring-modulith-starter-namastack` para bancos relacionais, ou `spring-modulith-starter-jobrunr`).

### Testando

Listeners transacionais e assíncronos precisam de testes que deixem a transação fazer commit e depois esperem:

```java
@SpringBootTest   // não @Transactional
class EventPublicationRegistryTest {

    @Test
    void failingListenerKeepsPublication() {
        mail.setDown(true);

        publishing.publish("Written during an outage");

        assertThat(contentRows()).isEqualTo(1);
        await().atMost(Duration.ofSeconds(5)).untilAsserted(() ->
            assertThat(statuses()).containsExactly("FAILED"));
    }
}
```

Dentro de um único módulo, `@ApplicationModuleTest` com `Scenario` cuida da transação e da espera para você (veja `spring-modulith-testing-and-documentation`).

## Trade-offs

- **At least once, nunca exactly once.** O registry garante que o listener será chamado até concluir; não garante que ele rode uma vez só. Um listener que enviou o e-mail e depois falhou ao fazer commit da própria transação vai enviar de novo no reenvio. Faça listeners idempotentes (chave de deduplicação, upsert, checar o estado antes):
  ```java
  @ApplicationModuleListener
  void on(ContentPublished event) {
      if (sentLog.alreadySent(event.id())) return;   // guarda de idempotência
      mail.send(...);
      sentLog.record(event.id());
  }
  ```
- **Consistência eventual dentro de uma aplicação.** Logo depois que `publish()` retorna, a notificação ainda não aconteceu. Código e testes que leem "o outro lado" logo depois da chamada vão ver estado desatualizado. É o mesmo modelo mental de microservices, agora dentro de um monolito, e precisa ser projetado para isso (mensagens de UI, modelos de leitura).
- **O registry adiciona escritas no caminho crítico.** Cada publicação para N listeners transacionais são N inserts a mais na transação de negócio, mais updates na conclusão. Para a maioria das aplicações é desprezível; para volumes muito altos de eventos, meça e considere o modo `delete` e uma limpeza rápida.
- **Linhas concluídas se acumulam.** No modo padrão `update`, nada é apagado. Planeje uma limpeza ou escolha `delete`/`archive` desde o primeiro dia:
  ```yaml
  spring.modulith.events.completion-mode: delete
  ```
- **Reenviar é trabalho seu.** O registry registra as falhas; ele não tenta de novo sozinho (fora a varredura opcional no restart). Sem um `resubmit` agendado, uma configuração de staleness e algum monitoramento, as linhas `FAILED` só ficam lá. Deploys com várias instâncias também precisam evitar que vários nós reenviem a mesma publicação ao mesmo tempo.
- **Eventos são serializados e precisam continuar legíveis.** As publicações são guardadas como JSON e desserializadas no reenvio, possivelmente depois de um deploy. Renomear ou mudar a forma de um record de evento quebra publicações pendentes. Trate tipos de evento como um contrato versionado, como faria com o schema de uma mensagem (veja `data-encoding-formats-and-schema-evolution` em System Design).
- **Listeners assíncronos perdem o contexto de quem chamou.** O listener roda em outra thread: sem request scope, sem `SecurityContext` a menos que propagado, sem ordem garantida entre eventos. Coloque no evento tudo de que o listener precisa.

## Documentation Links

- [Spring Modulith Reference: Working with Application Events](https://docs.spring.io/spring-modulith/reference/events.html): `@ApplicationModuleListener`, o Event Publication Registry, ciclo de vida, reenvio, modos de conclusão, externalização.
- [Spring Modulith Reference: Appendix](https://docs.spring.io/spring-modulith/reference/appendix.html): DDL do registry por banco e todas as propriedades `spring.modulith.events.*`.
- [Spring Modulith Javadoc: FailedEventPublications](https://docs.spring.io/spring-modulith/docs/current/api/org/springframework/modulith/events/FailedEventPublications.html): API de reenvio adicionada na 2.0.
- [Oliver Drotbohm: Spring Modulith 2.0 GA](https://spring.io/blog/2025/11/21/spring-modulith-2-0-ga-1-4-5-and-1-3-11-released/): release notes do ciclo de vida das publicações e do staleness monitor.
- [Spring Modulith 2.1 GA release notes](https://spring.io/blog/2026/06/11/spring-modulith-2-1-ga-2-0-7-and-1-4-12-released/): externalização via outbox (Namastack, JobRunr) e eventos vistos de todas as threads nos testes.
- [Dan Vega: Introduction to Spring Modulith, Modular Monoliths in Spring Boot (video)](https://www.youtube.com/watch?v=xHlDyKVyvig): quebrando um ciclo com eventos e tornando-os duráveis com o registry.
