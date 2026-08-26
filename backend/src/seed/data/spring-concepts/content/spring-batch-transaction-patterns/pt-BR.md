---
version: 1.0
updatedAt: 2026-08-06
title: Padrões de Gerenciamento de Transações no Spring Batch
---
## Objective

A maioria dos steps toca um único recurso transacional — um banco de dados — e a
transação de chunk de `spring-batch-chunk-processing`, conduzida pelo
`DataSourceTransactionManager` coberto em `spring-batch-transaction-configuration`,
é suficiente. O caso difícil é um step que toca **dois** recursos transacionais que
precisam fazer commit juntos ou nada. O exemplo clássico é ler um pedido de uma
fila JMS e escrevê-lo num banco de dados na mesma unidade de trabalho: se o commit
do banco tiver sucesso mas a mensagem for perdida, ou a mensagem for consumida mas
a escrita falhar, os dois sistemas ficam dessincronizados. Uma transação que
abrange múltiplos recursos é uma transação *global* (ou *distribuída*), e impor as
propriedades ACID através de cada participante é genuinamente difícil.

*Spring Batch in Action* apresenta quatro padrões, do mais pesado-porém-correto ao
mais barato-porém-aproximado: (1) **transações XA globais** coordenadas por um
transaction manager JTA; (2) o padrão de **recurso compartilhado**, que colapsa dois
recursos num só para que uma transação local simples baste; (3) o padrão de
**1PC best-effort**, que ordena os commits do JMS e do banco de dados para reduzir
a janela de falha; e (4) **tratamento de duplicatas** — dedup manual ou
idempotência — para limpar depois do risco residual do best-effort. O
`JmsItemReader` que alimenta esses steps está coberto em
`spring-batch-custom-and-service-readers`; aqui o foco é puramente a cola
transacional.

## Use Cases

- Ler pedidos de uma fila JMS e atualizar uma tabela de inventário num único step
  atômico, para que uma queda nunca perca um pedido nem o aplique duas vezes.
- Estender uma transação sobre dois bancos de dados — por exemplo, mantendo os
  metadados de execução do Spring Batch num schema e os dados de negócio em
  outro — enquanto permanece em transações locais.
- O formato de transferência de dinheiro: debitar uma conta num banco de dados e
  creditar outra, onde a consistência (o "C" do ACID) abrange os dois.
- Obter atomicidade entre uma fila e um banco de dados *sem* pagar por um
  coordenador XA quando throughput importa mais que um exactly-once perfeito.
- Sincronizar o flush de um arquivo com o commit do banco de dados (a flag
  `transactional` do `FlatFileItemWriter`) — a mesma ideia de best-effort aplicada
  a um arquivo, já que não há XA sobre um sistema de arquivos.

## Deep Dive

### Transações globais (XA): um `JtaTransactionManager` coordena o 2PC

Quando dois recursos reais precisam ser atômicos, a resposta de manual é XA — um
commit em duas fases (2PC) conduzido por um transaction manager JTA. O Spring
esconde isso por trás da abstração `PlatformTransactionManager`; a implementação
apoiada em JTA é o `JtaTransactionManager`. Crucialmente, o Spring **não** fornece
um manager JTA — `JtaTransactionManager` é apenas uma ponte para um real (o de um
servidor Java EE, ou um provedor standalone como o Atomikos, ou em 2012 o
Bitronix/JOTM). Cada recurso precisa expor um driver compatível com XA —
implementações de `javax.sql.XAConnection` / `XADataSource`, ou um `ConnectionFactory`
XA para JMS — para que o coordenador possa arregimentá-lo na transação
distribuída.

```xml
<!-- Bridge to a standalone JTA/XA coordinator (Atomikos, Narayana, ...) -->
<bean id="transactionManager"
      class="org.springframework.transaction.jta.JtaTransactionManager"/>

<job id="importOrdersJob" xmlns="http://www.springframework.org/schema/batch">
  <step id="importOrdersStep">
    <tasklet transaction-manager="transactionManager">
      <chunk reader="jmsReader" writer="databaseWriter"
             commit-interval="100" reader-transactional-queue="true"/>
    </tasklet>
  </step>
</job>
```

Aponte o `transaction-manager` do tasklet para a bridge JTA, e tanto o
`ConnectionFactory` XA quanto o `DataSource` XA se arregimentam automaticamente —
a aplicação não escreve nenhum código específico de XA. O preço é real: um
coordenador para operar, drivers XA em cada recurso, logs de transação precisos, e
overhead mensurável, porque XA é inerentemente mais lento que uma transação local.
Recorra a ele só quando você realmente precisa de atomicidade à prova de balas e
pode arcar com o peso operacional.

O primeiro conselho do livro, porém, é evitar essa situação por completo.
Transações locais — um recurso, a aplicação demarcando begin/commit/rollback
diretamente — são o caso comum, e são rápidas, simples e confiáveis. Antes de
adicionar um coordenador JTA, questione se você realmente precisa de um segundo
banco de dados ou de uma fila JMS. Os três padrões abaixo existem justamente para
manter você em transações locais onde a topologia permitir.

### O padrão de recurso compartilhado: colapsar dois recursos num só

A forma mais barata de fazer uma transação global desaparecer é arranjar para que
os dois "recursos" sejam o *mesmo* recurso físico. Se ambos os recursos lógicos
vivem numa única instância de banco de dados, uma única transação **local** cobre
tudo — sem coordenador, sem XA, sem 2PC. O exemplo do livro usa dois schemas
Oracle numa única instância: o schema A alcança as tabelas do schema B através de
synonyms, sobre a mesma conexão.

```xml
<!-- One physical database instance behind one DataSource; schema A refers to
     schema B's tables via synonyms, so a single local transaction spans both. -->
<bean id="transactionManager"
      class="org.springframework.jdbc.datasource.DataSourceTransactionManager">
  <property name="dataSource" ref="dataSource"/>
</bean>
```

Uma aplicação comum é metadado de batch: times frequentemente querem manter as
tabelas `BATCH_*` do Spring Batch separadas dos dados de negócio, mas as contagens
de skips e retries precisam fazer commit atomicamente junto com a escrita de
negócio. Hospede as duas numa única instância e você mantém tudo separado *e*
sincronizado no `DataSourceTransactionManager` local simples de
`spring-batch-transaction-configuration`. As limitações são específicas do motor
(synonyms, prefixos explícitos de schema), e só funciona quando os recursos podem
genuinamente compartilhar uma instância — mas quando cabe, supera o XA em
throughput com muito menos configuração.

### 1PC best-effort: sincronizando o commit do JMS em torno do commit do BD

Quando os dois recursos realmente são uma fila JMS e um banco de dados, o Spring
oferece um caminho intermediário. Diga ao `JmsTemplate` para usar uma **transação
JMS local** (`sessionTransacted=true`) e o Spring transparentemente a
*sincroniza* com a transação de banco de dados do chunk, fazendo commit da sessão
JMS imediatamente **após** o commit do banco de dados. O livro chama isso de
padrão *best-effort*.

```xml
<bean id="jmsTemplate" class="org.springframework.jms.core.JmsTemplate">
  <property name="connectionFactory" ref="connectionFactory"/>
  <property name="defaultDestination" ref="orderQueue"/>
  <property name="receiveTimeout" value="100"/>
  <property name="sessionTransacted" value="true"/>  <!-- local JMS transaction -->
</bean>

<bean id="jmsReader" class="org.springframework.batch.item.jms.JmsItemReader">
  <property name="jmsTemplate" ref="jmsTemplate"/>
  <property name="itemType" value="javax.jms.Message"/>  <!-- pass the raw Message -->
</bean>
```

Combine isso com `reader-transactional-queue="true"` no `<chunk>` para que o
Spring Batch desabilite seu cache de leitura antecipada e deixe mensagens que
sofreram rollback voltarem para a fila para serem relidas (veja
`spring-batch-custom-and-service-readers`). Como o commit do JMS é ordenado
*depois* do commit do banco de dados, você nunca perde uma mensagem. Mas resta
uma janela pequena: se o banco de dados fizer commit e o commit do JMS falhar em
seguida (digamos, uma instabilidade de rede), o broker reentrega a mensagem e o
job a processa de novo — uma **duplicata**. O best-effort troca a atomicidade
inabalável do XA por uma transação local barata mais uma duplicata rara.

A mesma sincronização não é específica de JMS. O Spring Batch aplica o
pensamento best-effort também à saída em arquivo: a flag `transactional` do
`FlatFileItemWriter` mantém as escritas num buffer e só as descarrega após o
commit do chunk, já que não há XA entre um banco de dados e um sistema de
arquivos. Qualquer recurso com semântica parecida com transação pode se juntar a
um commit de banco de dados dessa forma.

### Tratando as duplicatas: dedup manual ou idempotência

O risco residual do best-effort são duplicatas, e há exatamente duas formas de
neutralizá-las.

**Detecção manual** — rastrear mensagens processadas numa tabela, na mesma
transação que a escrita, e depois filtrar reentregas. O writer registra o id de
cada pedido conforme aplica a mudança:

```java
public class InventoryOrderWriter implements ItemWriter<Order> {
    private final JdbcTemplate jdbcTemplate;

    public InventoryOrderWriter(DataSource dataSource) {
        this.jdbcTemplate = new JdbcTemplate(dataSource);
    }

    public void write(List<? extends Order> orders) {
        for (Order order : orders) {
            updateInventory(order);   // the business change
            track(order);             // dedup bookkeeping — SAME transaction
        }
    }

    private void track(Order order) {
        jdbcTemplate.update(
            "insert into inventory_order (order_id, processing_date) values (?, ?)",
            order.getOrderId(), new Date());
    }
    // updateInventory(...) subtracts the ordered quantities
}
```

Um `ItemProcessor` então filtra o que já foi processado, retornando `null`. A
flag `getJMSRedelivered()` do JMS é um atalho barato, então só reentregas
incorrem na verificação de banco de dados:

```java
public class DuplicateOrderItemProcessor implements ItemProcessor<Message, Order> {
    private final JdbcTemplate jdbcTemplate;

    public Order process(Message message) throws Exception {
        Order order = extractOrder(message);
        if (message.getJMSRedelivered() && alreadyProcessed(order)) {
            return null;              // drop the duplicate
        }
        return order;
    }

    private boolean alreadyProcessed(Order order) {
        return jdbcTemplate.queryForInt(
            "select count(1) from inventory_order where order_id = ?",
            order.getOrderId()) > 0;
    }
}
```

**Idempotência** — a opção melhor quando se aplica: projetar a escrita de forma
que reprocessar a mesma mensagem não mude nada. Marcar um pedido como enviado é
naturalmente idempotente, então nenhuma tabela de rastreamento e nenhum
processor de filtragem são necessários:

```java
public class ShippedOrderWriter implements ItemWriter<Order> {
    private final JdbcTemplate jdbcTemplate;

    public void write(List<? extends Order> orders) {
        for (Order order : orders) {
            jdbcTemplate.update(
                "update orders set shipped = true where order_id = ?",
                order.getOrderId());   // running it twice yields the same state
        }
    }
}
```

Duas notas práticas sobre a abordagem manual. O insert de rastreamento **precisa**
rodar dentro da mesma transação de banco de dados que a escrita de negócio, ou uma
queda entre os dois reabre exatamente o buraco que você estava fechando. E quando
não há uma chave de negócio natural como `orderId`, use como fallback o id da
mensagem JMS como chave de deduplicação.

A lição que o livro reforça: não existe exactly-once de graça. Você escolhe
entrega at-least-once mais idempotência (ou dedup), e deixa isso absorver as
duplicatas que o best-effort admite.

### Livro vs. hoje: XA persiste, mas o 2PC distribuído caiu em desuso

A infraestrutura ainda existe. `PlatformTransactionManager` e
`JtaTransactionManager` continuam no Spring, e `JtaTransactionManager` ainda é só
uma ponte para um coordenador real. A maior mudança mecânica é o namespace: o
Jakarta EE renomeou `javax.transaction` → `jakarta.transaction` (e `javax.jms` →
`jakarta.jms`), a baseline para o Spring Framework 6 / Spring Boot 3; só o
`javax.sql.XAConnection` do JDK manteve o nome. Os provedores standalone ativos
hoje são **Atomikos** e **Narayana** — o JOTM e o Bitronix do livro estão
efetivamente sem manutenção. JTA de app server também é menos comum hoje: o
Spring Boot 3 removeu seus starters JTA embutidos do Atomikos/Bitronix, então sua
auto-configuração de JTA busca um transaction manager obtido via JNDI (um app
server), e o uso standalone significa conectar um provedor manualmente.

O que realmente mudou foi o gosto. Sistemas distribuídos modernos evitam
massivamente 2PC entre recursos e recorrem, em vez disso, a idempotência, ao
padrão *transactional outbox* (escrever a linha de negócio e uma linha de outbox
numa única transação local, depois retransmitir a mensagem posteriormente — veja
o concept `outbox-pattern`), ou a transações nativas de broker como as
semânticas transacionais / exactly-once do Kafka. Leia essa lista de novo: ela é
essencialmente o próprio conselho do livro — prefira transações locais, use 1PC
best-effort, e apoie-se em dedup ou idempotência — o que explica por que a
orientação do capítulo 9 envelheceu notavelmente bem. Confirmado pela referência
do Spring Framework "Application server-specific integration"
(`JtaTransactionManager`) e pela referência do Spring Boot "Distributed
Transactions (JTA)".

## Trade-offs

- **XA global — correto mas pesado** — o 2PC garante ACID verdadeiro entre todos
  os recursos, mas você precisa operar um coordenador JTA, fornecer drivers XA em
  todo lugar, e aceitar overhead de log de transação e commits mais lentos.
  Reserve-o para quando nada mais barato resolver.
- **Recurso compartilhado — barato mas restrito** — uma única transação local e o
  melhor throughput, mas só quando os dois recursos podem viver numa única
  instância de banco de dados; depende de recursos específicos do motor
  (synonyms Oracle, prefixos de schema) e acopla os schemas entre si.
- **1PC best-effort — meio-termo pragmático** — uma transação JMS local
  sincronizada em torno do commit do BD custa quase nada e nunca perde uma
  mensagem, mas a lacuna de ordenação admite duplicatas raras. Exige
  `sessionTransacted=true` e `reader-transactional-queue="true"`.
- **Dedup vs. idempotência** — uma tabela de rastreamento mais um processor de
  filtragem funciona para qualquer escrita, mas adiciona uma tabela, código
  extra e uma query, e o insert de rastreamento precisa compartilhar a
  transação da escrita; idempotência não precisa de nada disso, mas só existe
  quando a operação é naturalmente repetível.
- **Exactly-once é uma miragem** — entre um broker e um banco de dados você
  obtém at-least-once (mais idempotência/dedup) ou at-most-once; trate com
  desconfiança qualquer design que alegue exactly-once perfeito entre recursos
  independentes sem um coordenador.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 9, "Transaction management", section 9.4, "Transaction management patterns", p. 259-274 — doc
- [Spring Framework Reference — Application server-specific integration (JTA `JtaTransactionManager`)](https://docs.spring.io/spring-framework/reference/data-access/transaction/application-server-integration.html) — doc
- [Spring Boot Reference — Distributed Transactions with JTA](https://docs.spring.io/spring-boot/reference/io/jta.html) — doc
