---
version: 1.0
updatedAt: 2026-08-06
title: Parando Jobs Spring Batch de Forma Graciosa
---
## Objective

Parar um job Spring Batch em execução não é uma morte súbita. Você não consegue interromper de forma confiável código Java em execução a partir de fora, então o Spring Batch torna a parada *cooperativa*: uma **mensagem de parada** vira o status da execução para `STOPPING`, e o job para de forma limpa na próxima **fronteira de chunk**, em vez de no meio do trabalho. Duas audiências disparam isso. Um **operador** para um job de fora — um alerta dispara, e ele chama `JobOperator.stop(...)` a partir de um console JMX ou endpoint administrativo. Um **desenvolvedor** para um job de dentro — uma regra de negócio é violada (não importe mais de 1.000 produtos por dia, não rode depois das 8 da manhã), então o código do step chama `StepExecution.setTerminateOnly()`.

Como a parada acontece numa fronteira de chunk, a transação em andamento comita ou faz rollback como uma unidade só — você nunca rasga um chunk ao meio. A execução termina em `STOPPED`, e diferente de uma execução abandonada ou que travou, uma execução `STOPPED` é **reiniciável**: relançá-la retoma de onde parou (veja `spring-batch-restart-and-recovery`). Esta entrada cobre os dois caminhos; a ligação do bean launcher/operator está em `spring-batch-job-launcher-api-and-async-launching`.

## Use Cases

- Um operador recebe um alerta ("o arquivo de importação contém dados ruins") duas horas dentro de um job longo e para aquela execução específica a partir de um console JMX para parar de gastar recursos do servidor.
- Um desenvolvedor aplica um limite de negócio de dentro do job — parar depois do item 1.000 importado, ou parar um job de indexação de catálogo antes do pico de tráfego às 8 da manhã — sem acoplar o reader/processor/writer a essa decisão.
- Agendar uma *parada*, não só um início: um job roda durante a noite, mas uma tarefa agendada envia um sinal de parada às 6 da manhã para que nunca sobreponha o horário comercial.
- Parar de forma limpa para que a execução continue reiniciável — retomando uma importação pela metade em vez de rodá-la de novo do zero ou corromper um chunk parcial.

## Deep Dive

### Parando de fora: o operador e `JobOperator.stop(...)`

O operador não conhece os internos do Spring Batch — só que um job está rodando e precisa parar. `JobOperator` expõe exatamente isso: procure os IDs de execução em andamento de um nome de job, e então sinalize uma parada em um deles. O trecho de 2012 do livro:

```java
Set<Long> runningExecs = jobOperator.getRunningExecutions("importJob");
Long executionId = runningExecs.iterator().next();
boolean stopMessageSent = jobOperator.stop(executionId);
```

O retorno `boolean` é o detalhe crucial: ele reporta se a *mensagem* de parada foi enviada, **não** se o job já parou — a única forma de saber isso é fazer polling do status da execução. Daí "mensagem de parada", coberta a seguir.

### A mensagem de parada: por que um job para na próxima fronteira de chunk

Você chama `stop(...)`, mas não há garantia de que a execução para nessa chamada, porque o Java não consegue interromper código arbitrário em execução sob demanda. O Spring Batch só para o job quando ele *retoma o controle do fluxo*. Para um step chunk-oriented isso acontece a cada chunk: o Spring Batch conduz o loop read-process-write, então ele retoma o controle a cada fronteira e para prontamente. Essa fronteira também é a rede de segurança transacional: a transação do chunk comita (ou faz rollback) como uma unidade antes que a parada tenha efeito, então o armazenamento nunca fica num estado rasgado, de meio chunk (veja `spring-batch-chunk-processing` para a mecânica do commit-interval).

A exceção é um **`Tasklet` customizado** com um corpo longo: o Spring Batch não consegue retomar o controle até que `execute(...)` retorne, então um tasklet longo deveria checar `Thread.currentThread().isInterrupted()` e retornar `RepeatStatus.FINISHED` (ou lançar exception) ele mesmo, para terminar de forma limpa.

### Parando de dentro: `setTerminateOnly()` a partir de um tasklet ou listener

Um desenvolvedor tem duas formas de parar de dentro. Lançar uma exception funciona, mas é frágil — um chunk step configurado para *pular* aquele tipo de exception a engole. A forma preferida define a flag de parada: `StepExecution.setTerminateOnly()`, equivalente a enviar uma mensagem de parada. Como você chega até a `StepExecution` depende do tipo de step.

Um **tasklet** tem acesso direto através do chunk context:

```java
public class ProcessItemsTasklet implements Tasklet {
    @Override
    public RepeatStatus execute(StepContribution contribution,
                                ChunkContext chunkContext) throws Exception {
        if (shouldStop()) {
            chunkContext.getStepContext()
                        .getStepExecution().setTerminateOnly();
        }
        processItem();
        return moreItemsToProcess() ? RepeatStatus.CONTINUABLE
                                    : RepeatStatus.FINISHED;
    }
}
```

Um **step chunk-oriented** deliberadamente esconde a `StepExecution` do `ItemReader`/`ItemProcessor`/`ItemWriter` — esses componentes deveriam focar no próprio trabalho, não em parar. Em vez disso, um listener captura a `StepExecution` via `@BeforeStep` e checa a condição de parada num evento de ciclo de vida como `@AfterRead`:

```java
public class StopListener {
    private StepExecution stepExecution;

    @BeforeStep
    public void beforeStep(StepExecution stepExecution) {
        this.stepExecution = stepExecution;
    }

    @AfterRead
    public void afterRead() {
        if (stopConditionsMet()) {
            stepExecution.setTerminateOnly();
        }
    }
}
```

Isso mantém a parada como uma *preocupação transversal*: só o listener dedicado sabe sobre ela. O livro registra esse listener em XML; hoje é uma chamada de `StepBuilder`:

```java
@Bean
public Step importProductsStep(JobRepository jobRepository,
                               PlatformTransactionManager tx,
                               ItemReader<Product> reader,
                               ItemWriter<Product> writer,
                               StopListener stopListener) {
    return new StepBuilder("importProductsStep", jobRepository)
            .<Product, Product>chunk(100, tx)
            .reader(reader)
            .writer(writer)
            .listener(stopListener)
            .build();
}
```

### Reiniciando um job `STOPPED`

Uma parada graciosa é só metade do valor — a execução pode ser retomada. Uma execução `STOPPED` deixa sua `JobInstance` aberta, então reiniciar inicia uma *nova* `JobExecution` da *mesma* instância, retomando a partir do último chunk comitado (contraste com `abandon(...)`, que marca uma execução como `ABANDONED` e não reiniciável):

```java
JobExecution stopped = jobRepository.getJobExecution(executionId);
JobExecution resumed = jobOperator.restart(stopped);
```

A identidade `JobInstance`/`JobExecution` que torna isso um resume, e não um rerun, está detalhada em `spring-batch-job-instance-execution-flow`; a mecânica de recovery está em `spring-batch-restart-and-recovery`.

### Livro vs. hoje: `JobOperator` agora é A API, e as chamadas de parada do livro estão deprecated

A *mecânica* está inalterada — `stop` ainda só envia uma mensagem, e `setTerminateOnly()` ainda define a flag que o Spring Batch checa quando retoma o controle — mas a superfície mudou no Spring Batch 6.0:

- **`JobOperator` agora é a API de operador e estende `JobLauncher`.** Nenhum bean launcher separado é necessário; `JobOperator` *é* o launcher mais as operações (`stop`, `restart`, `startNextInstance`, `abandon`, `recover`). O bean XML `SimpleJobOperator` de quatro dependências do livro se foi.
- **As duas linhas exatas do livro estão ambas deprecated para remoção na 6.2+.** `getRunningExecutions(String)` (retornando `Set<Long>`) e `stop(long)` são cada uma `@Deprecated(since = "6.0", forRemoval = true)`. O substituto consulta o repositório por objetos `JobExecution` e passa um deles para `stop`:
  ```java
  Set<JobExecution> running = jobRepository.findRunningJobExecutions("importJob");
  JobExecution execution = running.iterator().next();
  boolean stopSignalSent = jobOperator.stop(execution); // stop(JobExecution)
  ```
- **`setTerminateOnly()` é idêntico, mas `StepExecution` mudou de lugar** de `org.springframework.batch.core` para `org.springframework.batch.core.step` (a reorganização da 6.0 também moveu `JobExecution`/`JobInstance` para `...core.job`). O Spring Batch 6 adiciona uma interface `StoppableStep` cujo `stop(StepExecution)` default chama `setTerminateOnly()` e define `STOPPED`.
- **A configuração é Java, não o namespace XML `batch:`** que o livro usa para a ligação do job, step, e listener — o namespace está deprecated na 6.0 em favor de `JobBuilder`/`StepBuilder` (veja `spring-batch-chunk-processing`).

Confirmado pelo código-fonte do Spring Batch 6.0.4 (`JobOperator`, `StepExecution.setTerminateOnly`, `JobRepository.findRunningJobExecutions`, `StoppableStep`), pela referência do Spring Batch sobre execução de jobs, e pelo guia de migração do Spring Batch 6.0.

## Trade-offs

- **Uma parada é um pedido, não uma garantia.** `stop(...)` retorna `true` quando a *mensagem* é enviada, não quando o job para — o código precisa fazer polling do status da execução, e um tasklet customizado longo que ignora `Thread.currentThread().isInterrupted()` pode ficar "parando" por muito tempo. Chunk steps evitam isso porque o framework conduz o loop.
- **`setTerminateOnly()` vence lançar uma exception.** Uma exception é a forma óbvia de sair, mas um chunk step configurado para pular aquele tipo de exception a engole silenciosamente e continua. A flag de parada é determinística: o Spring Batch a honra no momento em que retoma o controle, independente da configuração de skip.
- **Fronteira de chunk significa limpo, mas não instantâneo.** Um `commit-interval` grande mantém o chunk em andamento rodando por mais tempo antes que a parada possa ter efeito; chunks menores param mais cedo, mas pagam mais overhead de transação — o mesmo trade-off entre throughput e latência coberto em `spring-batch-chunk-processing`.
- **Livro vs. hoje: o código de parada do livro compila, mas mira métodos programados para remoção.** `getRunningExecutions(String)` e `stop(long)` rodam na 6.0.x, mas são `forRemoval` na 6.2+; código novo deveria usar `JobRepository.findRunningJobExecutions` mais `stop(JobExecution)` para evitar dívida de migração.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 4, "Running batch jobs", section 4.5, "Stopping jobs gracefully", p. 109-116 — doc
- [Spring Batch Reference — Running a Job (`JobOperator`)](https://docs.spring.io/spring-batch/reference/job/running.html) — doc
- [Spring Batch Reference — Controlling Step Flow (`BatchStatus`: `STOPPING`/`STOPPED`)](https://docs.spring.io/spring-batch/reference/step/controlling-flow.html) — doc
- [Spring Batch API — `JobOperator` (`stop(JobExecution)`; `stop(long)` deprecated for removal)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/launch/JobOperator.html) — doc
- [Spring Batch API — `StepExecution.setTerminateOnly()`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/step/StepExecution.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
