---
version: 1.0
updatedAt: 2026-08-06
title: Escalando o Spring Batch Localmente: Steps Multithreaded e Flows Paralelos
---
## Objective

Escalar um job batch significa cumprir uma janela de tempo de execução rodando
trabalho em paralelo — idealmente por configuração, sem reescrever a lógica de
negócio do step. O Capítulo 13 enquadra escalabilidade como uma decisão tomada
majoritariamente no nível do *step* e apresenta **quatro estratégias**: um **step
multithreaded** e **steps paralelos** (ambos *locais*, single-JVM), além de
**remote chunking** e um **step de partitioning** (que *escalam horizontalmente*
entre máquinas, cobertos em `spring-batch-remote-chunking` e
`spring-batch-partitioning`). Este artigo é a metade single-machine desse modelo.

As duas estratégias locais se apoiam na abstração de pool de threads `TaskExecutor`
do Spring e paralelizam o step orientado a chunk de `spring-batch-chunk-processing`.
A pegadinha que atravessa o capítulo — e a razão pela qual o livro admite que
multithreading sozinho está "longe de ser bom o suficiente" — é que os readers e
writers stateful que tornam um step **reiniciável**
(`spring-batch-restart-and-recovery`) geralmente **não são thread-safe**, então
paralelismo ingênuo compra throughput ao custo de correção. Saber onde cada
estratégia coloca suas threads é o que permite escalar sem corromper o estado.

## Use Cases

- Um step pesado em processamento (transformação ou enriquecimento caro por item)
  que subutiliza uma máquina multicore — entregar o processamento de chunks a um
  pool de threads para que vários chunks sejam trabalhados concorrentemente em vez
  de um de cada vez.
- Duas importações independentes (por exemplo, livros e celulares de arquivos
  separados) sem dependência de ordem — executá-las como flows paralelos em um job
  em vez de dois steps sequenciais.
- Uma carga I/O-bound que precisa continuar reiniciável — parear um reader
  sincronizado com o padrão de indicador de processamento para que threads não
  corrompam a posição de restart.
- Modernizar um step I/O-bound para virtual threads do Java 21 trocando por um
  `TaskExecutor` de virtual threads.

## Deep Dive

### O modelo de escalabilidade: quatro estratégias, duas delas locais

O Spring Batch roda tudo sequencialmente por padrão; *escalabilidade* é como você
opta por steps específicos rodarem em paralelo. A Tabela 13.1 lista quatro
estratégias:

- **Step multithreaded** *(local)* — um step processa vários chunks
  concorrentemente em um pool de threads.
- **Steps paralelos** *(local)* — vários steps/flows *independentes* rodam ao
  mesmo tempo via um `split`.
- **Remote chunking** *(remoto)* — um manager lê e envia chunks para nós
  escravos (`spring-batch-remote-chunking`).
- **Step de partitioning** *(local ou remoto)* — os dados são divididos em
  partições, cada uma tratada por sua própria instância de step
  (`spring-batch-partitioning`).

O primeiro par é escalabilidade *vertical* (scale up: usar mais núcleos em uma
máquina); o último par é *horizontal* (scale out). Ambas as estratégias locais
descansam sobre o `TaskExecutor` do Spring, que você declara uma vez e conecta. As
implementações do livro são `ThreadPoolTaskExecutor` (um pool dimensionado — usado
como `taskExecutor()` nos trechos abaixo), `SimpleAsyncTaskExecutor` (uma thread
nova por tarefa, com um limite de concorrência opcional), e `WorkManagerTaskExecutor`
(CommonJ).

### Step multithreaded: entregando cada chunk ao pool

A escalabilidade local mais simples é adicionar um `TaskExecutor` a um step; o
Spring Batch então processa chunks (`spring-batch-chunk-processing`) em threads do
pool, então *N* chunks estão em voo ao mesmo tempo em vez de um. O livro renomeia
`readWriteProductsStep` para `readWriteProductsMultiThreadedStep`; hoje é uma
chamada de builder, não o atributo `<batch:tasklet task-executor="…">`:

```java
@Bean
public Step readWriteProductsMultiThreadedStep(JobRepository jobRepository,
        PlatformTransactionManager tx, ItemReader<Product> reader, ItemWriter<Product> writer) {
    return new StepBuilder("readWriteProductsMultiThreadedStep", jobRepository)
        .<Product, Product>chunk(10).transactionManager(tx)
        .reader(reader).writer(writer)
        .taskExecutor(taskExecutor())   // enables multithreading for this step
        .build();
}
```

Rode uma importação de 100 produtos com log de trace e você verá threads
intercaladas — `thread #5` lendo o produto #51 enquanto `thread #3` lê o #54 —
então **itens não são processados em ordem**; trate a ordem como aleatória. O
livro limita a concorrência com um atributo `throttle-limit` (nota um padrão de 6)
para que o step realmente preencha o pool, e avisa que o tamanho do core pool deve
ser pelo menos o throttle limit.

### A ressalva de thread-safety vs. restart (vá com calma aqui)

Multithreading em um step está "longe de ser bom o suficiente" porque todo objeto
que o step compartilha entre threads — reader, processor, writer — precisa ser
thread-safe, e *a maioria dos readers e writers embutidos do Spring Batch não são*.
O livro os chama de **stateful**. Os piores infratores são os `ItemReader`s,
porque eles guardam o estado que torna um job **reiniciável**:
`JdbcCursorItemReader`, por exemplo, percorre um `ResultSet` JDBC e registra sua
posição no `ExecutionContext` do step a cada commit de chunk. Esse contador de
posição assume **leituras sequenciais, single-threaded**. Deixe várias threads
lerem ao mesmo tempo e o contador não descreve mais o que foi processado — o
restart (`spring-batch-restart-and-recovery`) então retoma de uma posição
corrompida, reprocessando ou pulando linhas.

O livro dá três mitigações, em ordem crescente de segurança:

1. **Abrir mão da reiniciabilidade** — configurar `saveState=false` no reader para
   que o Spring Batch pare de rastrear uma posição agora sem sentido.
2. **Serializar as leituras** — envolver o reader para que só `read()` seja
   sincronizado; ler é barato e escrever é caro, então uma thread lê um chunk
   enquanto outras estão ocupadas escrevendo. O `SynchronizingItemReader` do livro
   (hoje: o embutido `SynchronizedItemStreamReader`) delega os callbacks de estado
   ao seu alvo:

```java
public class SynchronizingItemReader<T> implements ItemReader<T>, ItemStream {
    private ItemReader<T> delegate;

    public synchronized T read() throws Exception {     // reads can't overlap
        return delegate.read();
    }
    public void open(ExecutionContext c)   { if (delegate instanceof ItemStream s) s.open(c); }
    public void update(ExecutionContext c) { if (delegate instanceof ItemStream s) s.update(c); }
    public void close()                    { if (delegate instanceof ItemStream s) s.close(); }
}
```

3. **O padrão de indicador de processamento** — a única opção que mantém
   reiniciabilidade *e* paralelismo. Adicione uma coluna booleana `processed` à
   tabela de entrada; o reader (sincronizado) seleciona apenas
   `where processed = false` com `saveState=false`, e o writer marca cada item
   assim que o grava:

```java
public class ProductItemWriter implements ItemWriter<Product> {
    private JdbcTemplate jdbcTemplate;

    public void write(Chunk<? extends Product> items) {
        for (Product p : items) {
            jdbcTemplate.update("update product set processed = true where id = ?", p.getId());
            // ...persist the product content...
        }
    }
}
```

O estado agora vive no banco de dados, não em um contador frágil de thread: um
restart simplesmente pega as linhas ainda marcadas como não processadas. (Para
entrada de arquivo o truque do livro é primeiro carregar o arquivo em uma tabela,
depois paralelizar a partir da tabela.)

### Steps paralelos: rodando flows independentes ao mesmo tempo com `split`

A segunda estratégia local paraleliza *steps inteiros* em vez de chunks, e evita o
problema de thread-safety inteiramente porque cada step possui seu próprio reader e
writer. É uma construção de **flow**
(`spring-batch-controlling-flow-and-exit-status`): um `split` roda seus flows
contidos concorrentemente e se junta quando todos terminam. O livro importa livros
e celulares *em paralelo*:

```java
@Bean
public Job importProductsJob(JobRepository jobRepository,
        Step readWriteBookProduct, Step readWriteMobileProduct) {

    Flow bookFlow   = new FlowBuilder<Flow>("bookFlow").start(readWriteBookProduct).build();
    Flow mobileFlow = new FlowBuilder<Flow>("mobileFlow").start(readWriteMobileProduct).build();

    return new JobBuilder("importProductsJob", jobRepository)
        .start(bookFlow)
        .split(taskExecutor()).add(mobileFlow)   // bookFlow and mobileFlow run concurrently
        .end()
        .build();
}
```

`FlowBuilder.split(taskExecutor).add(flowA, flowB)` é o mesmo mecanismo do
`<batch:split>` do XML. O livro envolve isso entre um step `decompress` e um step
`moveProcessedFiles`; como um split é ele mesmo um step, ele pode declarar um
`next` para que a junção retorne para um step downstream. Duas regras se aplicam:
os flows devem ser **genuinamente independentes** (sem ordenação compartilhada, sem
um flow alimentando o outro), e sem um executor explícito um split cai de volta
para um executor *síncrono* e roda sequencialmente — então o `TaskExecutor` é o que
realmente compra o paralelismo.

### Livro vs. hoje: o step multithreaded agora paraleliza só o processor

A mudança mais importante desde 2012 é *o que roda em qual thread* dentro de um
step multithreaded. No livro — e inalterado até o Spring Batch 5.2 — o step
"executa lendo, processando e escrevendo cada chunk de itens em uma thread de
execução separada", que é exatamente por que o reader precisava ser sincronizado.
O step orientado a chunk redesenhado ("novo") do Spring Batch 6.0 mudou isso: a
referência agora afirma que **a leitura e a escrita são feitas serialmente pela
thread principal, então o `ItemReader` e o `ItemWriter` não precisam ser
thread-safe ou sincronizados**, e **só o `ItemProcessor` é invocado a partir de
múltiplas threads** (então o processor precisa ser thread-safe).

Duas consequências decorrem disso. Primeiro, toda a dança de sincronizar o reader
/ padrão de indicador de processamento do livro não é mais necessária para um step
multithreaded comum: o reader lê sequencialmente de novo, então seu
`ExecutionContext` fica coerente e o restart é seguro por padrão.
`SynchronizedItemStreamReader` continua existindo — realocado para
`org.springframework.batch.infrastructure.item.support` — para casos em que você
*realmente* compartilha um reader entre threads (por exemplo, sob partitioning).
Segundo, o paralelismo se moveu de I/O para **processamento**: um step
multithreaded agora acelera trabalho pesado em processamento, enquanto leitura/
escrita I/O-bound escalam em vez disso via partitioning, remote chunking, ou local
chunking.

O resto é inalterado em *mecânica*: `.taskExecutor(...)` ainda ativa um step
multithreaded e `FlowBuilder.split(taskExecutor).add(...)` ainda roda flows
paralelos — mas a configuração é Java, já que o namespace XML `batch:` está
deprecated na 6.0. O botão autônomo `throttle-limit` está deprecated para remoção;
a concorrência agora é limitada pelo `TaskExecutor` que você fornece (o tamanho do
pool de um `ThreadPoolTaskExecutor`, ou o limite de concorrência de um
`SimpleAsyncTaskExecutor`). E um executor moderno que o livro não podia ter: as
**virtual threads do Java 21** via
`SimpleAsyncTaskExecutor.setVirtualThreads(true)` (apoiado em
`Thread.ofVirtual()`), ideal para processors I/O-bound — virtual threads são
criadas por tarefa, então você as combina com um `SimpleAsyncTaskExecutor` (nunca
um pool) e as limita com um limite de concorrência. Confirmado pela referência de
"Scaling and Parallel Processing" do Spring Batch 6.0, pelas referências arquivadas
4.3/5.1/5.2 (a antiga redação "separate thread of execution"), pelo Migration
Guide do Spring Batch 6.0 (deprecação de XML, novo modelo de chunk, deprecação do
throttle-limit), e pelo Javadoc do `SimpleAsyncTaskExecutor`.

## Trade-offs

- **Throughput vs. reiniciabilidade** — a tensão central. No modelo do livro um
  step multithreaded podia corromper a posição de restart, e cada correção
  (`saveState=false`, um reader sincronizado, ou o indicador de processamento)
  custa reiniciabilidade ou schema e código extras. Sob a 6.0 isso está em grande
  parte resolvido para readers/writers, mas um `ItemProcessor` stateful agora é o
  que você precisa tornar thread-safe.
- **Um step multithreaded não é um ganho de velocidade garantido** — o livro nota
  nenhum ganho em um único núcleo e (no seu modelo de 2012) benefício só para I/O;
  o modelo 6.0 paraleliza só o processor, então um step I/O-bound se beneficia
  pouco — recorra a partitioning ou remote chunking em vez disso.
- **A ordenação se torna indefinida** — chunks contêm itens não consecutivos e
  terminam em qualquer ordem, então qualquer lógica dependente de ordem
  (sequenciamento, totais acumulados) quebra sob um step multithreaded.
- **Steps paralelos exigem independência verdadeira** — um `split` só ajuda quando
  seus flows não compartilham dados ou ordenação; uma dependência oculta (um flow
  lendo a saída do outro) gera condições de corrida, e esquecer o `TaskExecutor`
  silenciosamente os executa sequencialmente.
- **A concorrência é limitada pelo seu elo mais fraco.** Threads brigando por um
  pool de conexões de `DataSource`, throttle, ou limite de concorrência pequenos
  demais anulam os ganhos; dimensione o executor, o pool de conexões, e (pré-6.0) o
  throttle limit juntos.
- **Virtual threads não são um pool** — poolizá-las derrota o propósito; use um
  `SimpleAsyncTaskExecutor` com um limite de concorrência, e lembre-se de que elas
  ajudam trabalho I/O-bound, não CPU-bound.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 13, "Scaling and parallel processing", sections 13.1-13.4, "The scaling model" / "Multithreaded steps" / "Parallelizing processing (single machine)", p. 374-386 — doc
- [Spring Batch Reference — Scaling and Parallel Processing (Multi-threaded Step, Parallel Steps)](https://docs.spring.io/spring-batch/reference/scalability.html) — doc
- [Spring Batch 6.0 Migration Guide (XML namespace deprecation, new chunk-oriented model)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [Spring Batch API — SynchronizedItemStreamReader (org.springframework.batch.infrastructure.item.support)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/support/SynchronizedItemStreamReader.html) — doc
- [Spring Framework API — SimpleAsyncTaskExecutor (setVirtualThreads, concurrencyLimit)](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/task/SimpleAsyncTaskExecutor.html) — doc
