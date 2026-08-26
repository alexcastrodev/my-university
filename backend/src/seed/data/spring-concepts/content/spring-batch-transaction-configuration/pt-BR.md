---
version: 1.0
updatedAt: 2026-08-06
title: Gerenciamento e Configuração de Transações no Spring Batch
---
## Objective

O Spring Batch gerencia transações no nível do **step**: ele nunca envolve um job
inteiro de múltiplos steps numa única transação. Diferente de uma aplicação web —
onde você demarca transações manualmente ou com `@Transactional` declarativo e
deixa o ciclo request/response conduzi-las — **o Spring Batch conduz tanto o fluxo
quanto as transações**: seu código não decide quando uma transação começa, faz
commit ou rollback; o framework decide. Para um step orientado a chunk, o limite é
o chunk — `commit-interval` itens são lidos, processados, escritos e commitados
como uma única unidade, e qualquer falha faz rollback do chunk inteiro. Para um
`TaskletStep`, cada chamada de `Tasklet.execute()` é sua própria transação.

Este concept cobre o modelo de ponta a ponta: um primer de transações (ACID,
`PlatformTransactionManager`, isolamento, propagação), onde o limite fica em
chunks, tasklets e listeners, as armadilhas do `@Transactional` declarativo e de
readers transacionais, e como escolher o transaction manager certo.

## Use Cases

- Rodar um job batch **concorrentemente com uma aplicação online** e subir o nível
  de isolamento para que nenhum dos dois leia os dados parcialmente escritos do
  outro — ou baixá-lo quando o batch é o único writer, trocando isolamento por
  velocidade.
- Colocar um **timeout** na transação de um chunk para que um lock de linha travado
  falhe o step em vez de travá-lo indefinidamente.
- Escolher o `PlatformTransactionManager` certo por step: JDBC, JPA, ou um sem
  recurso quando nada transacional é tocado.
- Drenar uma **fila JMS** onde um rollback de chunk precisa "de-ler" (recolocar na
  fila) mensagens, então o reader é marcado como transacional e o processor é
  tornado idempotente.
- Definir `PROPAGATION_NEVER` num tasklet que só descompacta um ZIP ou assina um
  arquivo, para que nenhuma transação seja iniciada em torno de trabalho
  não-transacional.

## Deep Dive

### Um primer de transações: ACID e o `PlatformTransactionManager`

Uma transação torna uma interação com um data store **ACID** — Atômica (todas as
operações têm sucesso ou nenhuma tem), Consistente (deixa o store válido), Isolada
(transações concorrentes não veem os dados parciais uma da outra) e Durável (um
commit sobrevive a uma falha). Toda a abstração de transações do Spring depende de
uma única interface de estratégia, e o Spring Batch usa exatamente essa — nada
específico de batch:

```java
public interface PlatformTransactionManager extends TransactionManager {
    TransactionStatus getTransaction(TransactionDefinition definition) throws TransactionException;
    void commit(TransactionStatus status) throws TransactionException;
    void rollback(TransactionStatus status) throws TransactionException;
}
```

Uma `TransactionDefinition` carrega a **propagação** (REQUIRED, REQUIRES_NEW,
NEVER, …), o nível de **isolamento** e o **timeout**. Isolamento é o dial mais
ajustado em jobs batch, trocando correção sob concorrência por throughput — de
`READ_UNCOMMITTED` (leituras sujas, não repetíveis e fantasmas todas possíveis) até
`SERIALIZABLE` (nenhuma, mas lento).

### Onde o limite fica: uma transação por chunk, uma por `Tasklet.execute()`

Um step orientado a chunk faz commit no limite do chunk — uma transação para todos
os `commit-interval` itens (eficiente), onde um erro afeta só o chunk atual
(robusto). A regra de rollback é específica: **uma exception do item processor ou
do writer dispara um rollback; uma exception do item reader não dispara** — a
leitura acontece efetivamente fora da transação de escrita do chunk,
independentemente da configuração de skip/retry. Veja `spring-batch-chunk-processing`,
onde o chunk *é* a transação, para o próprio loop de read → process → write →
commit.

Um `TaskletStep` é diferente: cada chamada `execute()` roda na sua própria
transação, e o Spring Batch continua chamando-a enquanto ela retornar
`RepeatStatus.CONTINUABLE`.

```java
public interface Tasklet {
    RepeatStatus execute(StepContribution contribution, ChunkContext chunkContext) throws Exception;
}
```

Como toda `execute()` é transacional, um tasklet que não toca nenhum recurso
transacional (descompactar um ZIP, digamos) deveria definir a propagação como
`PROPAGATION_NEVER` em vez de pagar por uma transação inútil.

Listeners são o caso sutil — **não há regra geral; consulte o Javadoc**.
`ChunkListener.beforeChunk()` roda *dentro* da transação do chunk,
`afterChunk()` roda *fora* dela; os callbacks de erro de read/process/write rodam
dentro de uma transação que o Batch está *prestes a reverter*, então um listener
que grava em um banco de dados precisa abrir sua própria transação
`REQUIRES_NEW` ou perder o log (veja `spring-batch-execution-listeners`).

### Sobrescrevendo os defaults: atributos de transação

Os defaults funcionam bem na maior parte do tempo; sobrescreva-os por step quando
o caso de uso exigir. No livro isso é o elemento `transaction-attributes` dentro
do tasklet:

```xml
<step id="importProductsStep">
  <tasklet>
    <chunk reader="reader" writer="writer" commit-interval="100" />
    <transaction-attributes isolation="READ_UNCOMMITTED" propagation="REQUIRED" timeout="30" />
  </tasklet>
</step>
```

`READ_UNCOMMITTED` aqui diz "eu sou o único processo nesses dados." Este é um dial
*diferente* do `isolation-level-for-create` do `JobRepository`, que protege a
criação de linhas de `JobExecution` e tem como default `SERIALIZABLE` (veja
`spring-batch-job-repository-database-configuration`) — não confunda os dois.

### Armadilhas: `@Transactional` declarativo e readers transacionais

Gerenciamento declarativo de transações é um grande amigo online e um inimigo em
potencial num job batch. Como o Spring Batch já possui a transação, código
`@Transactional` com a propagação default `REQUIRED` simplesmente *entra* (joins)
na transação do Batch — geralmente inofensivo. Mas um método
`@Transactional(propagation = REQUIRES_NEW)` roda na **própria** transação,
independente do chunk, então ele faz commit mesmo que o chunk depois faça
rollback — quebrando silenciosamente a atomicidade do chunk.

Duas diretrizes: **desabilite transações declarativas** (sem `tx:annotation-driven`)
numa aplicação batch, e preste atenção à propagação se elas precisarem
permanecer. Uma segunda armadilha é a **auto-invocação**: um método
`@Transactional` chamado *de dentro do mesmo bean* contorna o proxy do Spring, então
a annotation não faz nada.

A armadilha do **reader transacional** é mais grave. Para suportar retry, o Spring
Batch armazena em buffer os itens lidos de um chunk e os reenvia do seu cache num
erro de escrita passível de retry, em vez de ler novamente. Isso funciona bem para
um banco de dados, mas está errado para uma fila JMS: ler *desenfileira* a mensagem
e um rollback *reenfileira* — então repetir a partir do cache deixa a mensagem na
fila **e** a processa — de novo. Desabilite o cache declarando o reader como
transacional:

```xml
<chunk reader="reader" writer="writer" commit-interval="100"
       reader-transactional-queue="true" />
```

Na configuração Java, o equivalente é `.readerIsTransactionalQueue()` no builder
fault-tolerant. Com o cache desligado, o processor pode **rodar novamente** após um
rollback (`processor-transactional` tem default `true`), então ele precisa ser
**idempotente**. JMS é o caso canônico — veja
`spring-batch-custom-and-service-readers` para o reader JMS transacional, e
`spring-batch-transaction-patterns` para os padrões multi-recurso (global/XA) que se
apoiam nele.

### Escolhendo o transaction manager

O manager precisa combinar com o recurso; conecte-o em `.chunk(size, txManager)`
ou `.tasklet(tasklet, txManager)`:

- **`DataSourceTransactionManager`** (`org.springframework.jdbc.datasource`) —
  JDBC puro, o caso comum para um `JdbcBatchItemWriter`.
- **`JpaTransactionManager`** (`org.springframework.orm.jpa`) — quando o writer
  passa por um `EntityManager` do JPA.
- **`ResourcelessTransactionManager`** — um no-op para um step **sem** recurso
  transacional real (um step só de arquivo plano, ou um `JobRepository` em
  memória); ele finge begin/commit/rollback para que o caminho de transação do
  framework ainda funcione.

### Livro vs. hoje: configuração XML de transação → `.transactionManager()` / `.transactionAttribute()`, e `jakarta.transaction`

O **modelo central permanece inalterado**: o Spring Batch ainda gerencia
transações no nível do step através de um `PlatformTransactionManager`, o chunk
ainda é o limite da transação, e exceptions do processor/writer ainda disparam
rollback (com `no-rollback-exception-classes` ainda sendo a válvula de escape —
veja `spring-batch-fault-tolerant-step-configuration`). O que mudou foi a
superfície de configuração: os `transaction-attributes` XML do livro viram
chamadas de builder, e o transaction manager agora é um argumento **explícito e
obrigatório**, não um default implícito:

```java
@Bean
public Step step1(JobRepository jobRepository, PlatformTransactionManager transactionManager) {
    DefaultTransactionAttribute attribute = new DefaultTransactionAttribute();
    attribute.setPropagationBehavior(Propagation.REQUIRED.value());
    attribute.setIsolationLevel(Isolation.DEFAULT.value());
    attribute.setTimeout(30);

    return new StepBuilder("step1", jobRepository)
                .<String, String>chunk(2).transactionManager(transactionManager)
                .reader(itemReader())
                .writer(itemWriter())
                .transactionAttribute(attribute)
                .build();
}
```

Mais três mudanças desde 2012: `javax.transaction` virou `jakarta.transaction`
quando o Spring 6 / Spring Batch 6 adotou a baseline do Jakarta EE 9+;
`ResourcelessTransactionManager` foi realocado na versão 6.0 de
`org.springframework.batch.support.transaction` para
`org.springframework.batch.infrastructure.support.transaction`; e o namespace XML
`batch:` (incluindo `transaction-attributes`) está deprecated desde a 6.0, com
remoção planejada para a 7.0, tornando o builder Java acima o caminho a seguir.
Confirmado pela referência do Spring Batch "Transaction Attributes", pelo Javadoc
da API do Spring Batch 6.0.x para `ResourcelessTransactionManager`, pelo Guia de
Migração do Spring Batch 6.0, e pela referência "Transaction Strategies" do
Spring Framework.

## Trade-offs

- **O nível de isolamento é um dial de correção-vs-throughput** — subir um chunk
  para `SERIALIZABLE` protege um batch rodando ao lado de uma aplicação online,
  mas derruba a performance; baixar para `READ_UNCOMMITTED` acelera um batch de
  único writer ao custo de leituras sujas.
- **O commit-interval também é o dial de custo-de-rollback** — porque o chunk *é*
  a transação, um intervalo maior significa menos commits, mas um rollback mais
  amplo e custoso, e um recurso preso por mais tempo; o lado de throughput está
  coberto em `spring-batch-chunk-processing`.
- **`ResourcelessTransactionManager` é um no-op, não um manager de verdade** —
  ideal para um step sem recurso transacional, perigoso se alguém depois
  adicionar uma escrita em banco de dados: nada de fato faz commit ou rollback,
  então uma falha no meio do chunk pode deixar dados parcialmente escritos.
- **`@Transactional` declarativo numa aplicação batch é uma armadilha** —
  `REQUIRES_NEW` ou uma auto-invocação sem proxy desacopla silenciosamente código
  da transação do chunk, então "parecia transacional" não é o mesmo que "fez
  rollback junto com o chunk."
- **Um reader transacional troca o cache de retry por correção** — desabilitar o
  buffering faz reler itens após um rollback em vez de repetir a partir do cache,
  então o processor precisa ser idempotente porque ele roda de novo no chunk
  repetido.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 9, "Transaction management", sections 9.1-9.3, "A transaction primer" … "Transaction configuration", p. 252-259 — doc
- [Spring Batch Reference — Transaction Attributes (`.transactionManager()` / `.transactionAttribute()`)](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/transaction-attributes.html) — doc
- [Spring Batch 6.0 API — ResourcelessTransactionManager (org.springframework.batch.infrastructure.support.transaction)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/support/transaction/ResourcelessTransactionManager.html) — doc
- [Spring Batch 6.0 Migration Guide (jakarta.transaction, package relocations, XML namespace deprecation)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [Spring Framework Reference — Transaction Strategies (PlatformTransactionManager)](https://docs.spring.io/spring-framework/reference/data-access/transaction/strategies.html) — doc
