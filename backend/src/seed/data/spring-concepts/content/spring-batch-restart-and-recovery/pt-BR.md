---
version: 1.0
updatedAt: 2026-08-06
title: "Spring Batch Restart e Recovery: Retomando Jobs que Falharam de Onde Pararam"
---
## Objective

Skip e retry fazem um job *sobreviver* a erros; restart é o recurso que você usa quando
a sobrevivência falha e o job trava de qualquer jeito — o terceiro pilar dos "jobs à
prova de balas" do capítulo 8 (os outros dois vivem em
`spring-batch-skip-policy-and-listeners` e
`spring-batch-retry-policy-and-retrytemplate`). O cenário temido do livro: um job roda a
noite toda e morre dois minutos antes do fim. Restart deixa você responder "eu reinicio
e leva dois minutos" em vez de "espera mais um dia". Relançar uma `JobExecution` que
terminou **FAILED** (ou **STOPPED**, conforme
`spring-batch-stopping-jobs-gracefully`) com os *mesmos parâmetros identificadores de
job* não começa do zero — cria uma **nova `JobExecution` da mesma `JobInstance` ainda
não concluída**, que **retoma** de onde a última parou.

Esse truque de retomada é puro metadado: o Spring Batch persiste o estado do step no
`ExecutionContext` através do `JobRepository`, então restart exige um `JobRepository`
**persistente (com JDBC)** (`spring-batch-job-repository-database-configuration`), e a
identidade `JobInstance` = job + `JobParameters` identificadores que faz um relançamento
*retomar* em vez de *re-executar* é detalhada em
`spring-batch-job-instance-execution-flow`. Esta entrada aprofunda no *comportamento* do
restart: habilitar/proibir, se deve re-executar steps já completos, limitar tentativas,
e a parte mais suculenta — retomar no meio de um chunk.

## Use Cases

- Uma importação longa trava perto do fim — retome do último chunk commitado em vez de
  reprocessar horas de trabalho já escrito.
- Um step de setup já completo (descompactar um ZIP) precisa rodar *de novo* no restart
  porque o operador forneceu um arquivo corrigido — `allow-start-if-complete`.
- Um step que continua falhando deveria parar de ser tentado — `start-limit` leva a
  instância a um beco sem saída para que um operador investigue em vez de o job entrar
  num loop infinito.
- Corrija uma linha ruim de input, depois reinicie direto no step que falhou — o Spring
  Batch pula os steps que já completaram por padrão.
- Evite efeitos colaterais duplicados (inserts duplicados, chamadas de web service
  reenviadas) nunca reprocessando itens que uma execução anterior já escreveu.

## Deep Dive

### O que o restart retoma — uma nova JobExecution da mesma JobInstance

Restart só faz sentido para uma execução que terminou em `FAILED` ou `STOPPED`. Você
relança com exatamente os mesmos parâmetros identificadores, o que resolve a mesma
`JobInstance` não concluída; o Spring Batch cria uma `JobExecution` nova e, lendo o
metadado que armazenou da última vez, reinicia **exatamente de onde a execução anterior
parou** — pulando steps já completados por padrão, com um número efetivamente ilimitado
de restarts permitidos. Hoje o `JobOperator` (que estende `JobLauncher`) é tanto
launcher quanto operator:

```java
JobExecution failed = jobRepository.getLastJobExecution(jobName, jobParameters);
JobExecution resumed = jobOperator.restart(failed);   // new execution, same instance
```

Nada disso funciona contra um repository em memória — sem linhas persistidas de
`JobExecution`/`StepExecution`, "restart" silenciosamente vira "começar do zero".

### Habilitando, proibindo e re-executando steps já completos

Jobs são **restartáveis por padrão**. O livro alterna isso com o atributo `restartable`
em `<job>` e o atributo `allow-start-if-complete` em `<tasklet>` (o básico está em
`spring-batch-job-configuration-attributes`); hoje esses são chamadas de builder. Proíba
restart para um job que não pode reiniciar com semântica correta — um erro de digitação
na linha de comando ou um scheduler disparando errado pode, do contrário, reprocessar
dados e corromper um banco de dados:

```java
new JobBuilder("importProductsJob", jobRepository)
    .preventRestart()          // restartable=false → JobRestartException on relaunch
    .start(decompress).next(readWrite).next(clean)
    .build();
```

O job de importar produtos do livro tem dois steps de trabalho: `decompressStep`
descompacta o arquivo, `readWriteProductsStep` o carrega. Por padrão um restart
**pula** o `decompressStep` porque ele já completou e vai direto para o step de
leitura-escrita que falhou. Mas se o conserto é um *novo* arquivo, o step de
descompactação precisa rodar de novo — defina `allowStartIfComplete(true)` nesse step
para que ele re-execute a cada restart:

```java
@Bean
public Step decompress(JobRepository jobRepository, PlatformTransactionManager tx,
                       Tasklet decompressTasklet) {
    return new StepBuilder("decompressStep", jobRepository)
        .tasklet(decompressTasklet, tx)
        .allowStartIfComplete(true)     // always re-run, even after a prior COMPLETED
        .build();
}
```

### Limitando o número de restarts — startLimit(n)

Reiniciar repetidamente a mesma instância geralmente significa que algo está realmente
errado. `start-limit` (definido por **step**, default `Integer.MAX_VALUE`) limita
quantas vezes um step pode ser iniciado para uma `JobInstance`. O passo a passo do
livro: o step de leitura-escrita falha nas execuções um, dois e três; na quarta, o
Spring Batch vê que o limite foi atingido e nem tenta o step — o job falha e a instância
*nunca* pode completar, então você precisa criar uma nova instância.

```java
@Bean
public Step readWrite(JobRepository jobRepository, PlatformTransactionManager tx,
                      ItemReader<Product> reader, ItemWriter<Product> writer) {
    return new StepBuilder("readWriteProductsStep", jobRepository)
        .<Product, Product>chunk(100, tx)
        .reader(reader).writer(writer)
        .startLimit(3)                  // 4th start throws StartLimitExceededException
        .build();
}
```

### Reiniciando no meio de um step chunk-oriented — o contrato ItemStream

Limitar restarts na fronteira do step é grosseiro; o prêmio de verdade é retomar um step
chunk-oriented **exatamente no item onde falhou**, para que uma execução que já
processou um milhão de linhas não as reprocesse. O `ItemReader` dirige o chunk, então o
reader é o responsável pelo restart: ele incrementa um contador a cada `read()` e
armazena esse contador no **`ExecutionContext` do step** cada vez que um chunk faz
commit. No restart ele lê o contador de volta e avança rápido além dos itens já
processados. O Spring Batch persiste o `ExecutionContext` do step entre execuções — mas
o reader precisa implementar a lógica de salvar/restaurar, que é exatamente para o que a
interface `ItemStream` (`open` / `update` / `close`) existe. O Listing 8.14 do livro:

```java
public class FilesInDirectoryItemReader implements ItemReader<File>, ItemStream {

    private File[] files;
    private int currentCount;
    private final String key = "file.in.directory.count";

    @Override
    public void open(ExecutionContext ec) throws ItemStreamException {
        currentCount = ec.getInt(key, 0);   // 0 on first run; last saved count on restart
    }

    @Override
    public File read() {
        int index = ++currentCount - 1;
        return index == files.length ? null : files[index];
    }

    @Override
    public void update(ExecutionContext ec) throws ItemStreamException {
        ec.putInt(key, currentCount);       // called just before each chunk commit
    }

    @Override
    public void close() throws ItemStreamException { }
}
```

O Spring Batch chama `open` no início do step, `update` antes de salvar o contexto (um
pouco antes de cada chunk fazer commit), e `close` para liberar recursos, e ele
**auto-registra** qualquer reader que implemente `ItemStream`. A interface é um tipo de
step listener (veja `spring-batch-execution-listeners`) e funciona para processors e
writers também. A maioria dos readers embutidos (por exemplo
`MultiResourceItemReader`) já são restartáveis, então cheque o Javadoc antes de
escrever o seu. **Ressalva:** o contador assume um input *estável* — itens adicionados,
removidos, ou reordenados o deslocam e corrompem a posição de retomada.

### Livro vs. hoje: restart(JobExecution), uma nova operação recover() e o ItemStream realocado

A mecânica está inalterada — retomada guiada por metadado, default de
pular-steps-completos, `start-limit` por step — mas a API e os pacotes da 6.0 mudaram:

- **A configuração é Java, não o namespace XML `batch:`** (deprecated desde a 6.0).
  `restartable` ainda tem default `true`; você opta por sair com
  `JobBuilder.preventRestart()` (não há método fluente `restartable(boolean)` —
  `restartable` é uma propriedade). `allowStartIfComplete(true)` e `startLimit(n)` são
  chamadas de `StepBuilder`.
- **`JobOperator` (estende `JobLauncher`) é A API.** O método atual é
  `JobExecution restart(JobExecution jobExecution)`; o mais antigo
  `Long restart(long executionId)` é `@Deprecated(since = "6.0", forRemoval = true)`.
- **Novo na 6.0: `JobOperator.recover(JobExecution)`** — a metade "recovery". Uma
  travada pode deixar uma execução presa em `STARTED` (nem `FAILED` nem `STOPPED`), o
  que não é restartável; `recover(...)` marca como `FAILED` e define
  `recovered=true` no execution context dela para que se torne elegível a restart.
- **Um `JobRepository` JDBC persistente ainda é exigido**; o default em memória agora é
  `ResourcelessJobRepository`, que não mantém metadado entre execuções e não consegue
  reiniciar (veja `spring-batch-job-repository-database-configuration`).
- **Pacotes realocados:** `javax`→`jakarta`, e a infraestrutura de item mudou de
  `org.springframework.batch.item.*` para
  `org.springframework.batch.infrastructure.item.*` — `ItemStream`, `ItemReader`,
  `ExecutionContext`, e `ItemStreamException` agora vivem ali (o livro usa o pacote
  antigo).

Confirmado pelo código-fonte do `JobOperator` da 6.0 (`restart(JobExecution)`,
`restart(long)` deprecated, `recover`), pelo `JobBuilderHelper.preventRestart`, pelas
páginas de referência "Configuring a Step for Restart" e "Configuring a Job", e pelo
Spring Batch 6.0 Migration Guide.

## Trade-offs

- **Restart só ajuda uma execução `FAILED`/`STOPPED`.** Uma `JobInstance` que completou
  com sucesso não roda de novo (lança exception), e um processo que travou enquanto
  `STARTED` fica preso até que `recover()` a marque como `FAILED` — restart é
  recuperação, não um botão de re-executar.
- **Re-executar steps já completos é uma decisão de negócio, não um default.**
  `allowStartIfComplete(true)` refaz trabalho que já teve sucesso (ótimo para um step de
  setup idempotente, perigoso para um com efeitos colaterais); o default pula esse
  trabalho, o que está errado quando aquele step *precisa* rodar com input novo toda
  vez.
- **`start-limit` é um instrumento grosseiro.** Baixo demais desiste de um step que só
  teve azar transitório; alto demais desperdiça horas falhando repetidamente — e
  atingi-lo leva a instância a um beco sem saída permanente, forçando uma
  `JobInstance` inteiramente nova.
- **Retomada no meio do chunk só é tão boa quanto a contabilidade do reader.** Um
  reader que não é `ItemStream` (ou nunca armazena seu contador) reprocessa desde o
  início no restart, e mesmo um contador correto assume um input *estável*.
- **Tudo depende de um `JobRepository` JDBC persistente.** Com o
  `ResourcelessJobRepository` em memória não há `ExecutionContext` salvo, então um
  "restart" silenciosamente começa do zero — escolha-o deliberadamente para qualquer
  job que precise sobreviver a uma travada.
- **Ser restartável por padrão corta dos dois lados.** Um relançamento acidental (erro
  de scheduler ou de CLI) pode reprocessar e corromper dados — chame
  `preventRestart()` em qualquer job que não possa reiniciar com semântica correta.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 8, "Implementing bulletproof jobs", section 8.4, "Restart on error", p. 242-250 — doc
- [Spring Batch Reference — Configuring a Step for Restart (allowStartIfComplete, startLimit)](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/restart.html) — doc
- [Spring Batch Reference — Configuring a Job (preventRestart, restartability)](https://docs.spring.io/spring-batch/reference/job/configuring-job.html) — doc
- [Spring Batch API — JobOperator (restart(JobExecution); restart(long) deprecated; recover)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/launch/JobOperator.html) — doc
- [Spring Batch API — ItemStream (org.springframework.batch.infrastructure.item)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/ItemStream.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
