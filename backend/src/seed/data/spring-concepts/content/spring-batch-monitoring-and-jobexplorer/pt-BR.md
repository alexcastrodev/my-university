---
version: 1.0
updatedAt: 2026-08-06
title: Monitorando Jobs do Spring Batch: JobExplorer, JobOperator e o Schema de Metadados
---
## Objective

Uma ferramenta de monitoramento faz duas coisas: ela *detecta* que uma execução de
job deu errado e *notifica* alguém (e-mail, SMS, um dashboard). Isso importa mais
para jobs batch do que para a maioria dos softwares porque eles rodam headless —
nenhuma interface de usuário está observando-os falhar. O Spring Batch torna isso
tratável ao registrar *tudo* que acontece durante uma execução no job repository: o
`JobRepository` persiste linhas de `JobInstance`, `JobExecution` e `StepExecution`
em `BATCH_JOB_INSTANCE`, `BATCH_JOB_EXECUTION` e `BATCH_STEP_EXECUTION` (esta
última carregando contagens de leitura/escrita/filtro/skip/commit/rollback), além
de contexto serializado nas tabelas `BATCH_*_EXECUTION_CONTEXT`.

Então monitorar no Spring Batch é, em grande parte, *ler esse histórico de volta*.
Este artigo cobre as quatro formas do livro de fazer isso: consultar dados de
execução com o `JobExplorer` (somente leitura) e o `JobOperator` (tipos simples),
tratar o próprio schema de metadados como uma superfície consultável, disparar
alertas nos limites de execução com um `JobExecutionListener`, e expor beans do
batch via JMX para um console ao vivo. Configuração de schema e repository vivem em
*spring-batch-job-repository-database-configuration*.

## Use Cases

- Detectar execuções que falharam depois do fato, percorrendo nomes de job →
  instâncias → execuções por aquelas cujo exit status é `FAILED` — a verificação
  "a importação de ontem à noite quebrou?".
- Ler contagens por step (leitura/escrita/skip/commit/rollback) e durações para
  pegar skips anormais ou uma execução suspeitosamente lenta, mesmo quando o job
  "teve sucesso".
- Disparar um e-mail ou mensagem no instante em que um job falha, de dentro do
  processo em execução.
- Dar aos operadores um console remoto ao vivo (JConsole/JMX) para consultar
  resumos e iniciar/parar jobs, usando o `JobOperator` de tipos simples.
- Alimentar timers de duração de job/step no Prometheus e visualizar tendências no
  Grafana (a substituição moderna do monitoramento feito à mão).

## Deep Dive

### Lendo o histórico de execução: `JobExplorer` e `JobOperator`

A interface `JobRepository` existe para a infraestrutura do batch *escrever* dados
de execução durante uma execução; seus métodos não são pensados para navegação. Para
exploração somente leitura, o Spring Batch fornece o `JobExplorer`:

```java
public interface JobExplorer {
  List<String> getJobNames();
  List<JobInstance> getJobInstances(String jobName, int start, int count);
  List<JobExecution> getJobExecutions(JobInstance jobInstance);
  Set<JobExecution> findRunningJobExecutions(String jobName);
  StepExecution getStepExecution(Long jobExecutionId, Long stepExecutionId);
  // ... (getJobExecution, getJobInstance, ... also available)
}
```

O livro o configura com `JobExplorerFactoryBean` (ele só precisa de um `dataSource`
e um `lobHandler`). O caso de uso canônico de monitoramento — detectar execuções
falhas — percorre nomes de job → instâncias → execuções e verifica cada exit status
(`getJobInstances` é paginado, então itere as páginas em produção):

```java
List<JobExecution> failed = new ArrayList<>();
for (String name : jobExplorer.getJobNames()) {
  for (JobInstance instance : jobExplorer.getJobInstances(name, 0, 100)) {
    for (JobExecution execution : jobExplorer.getJobExecutions(instance)) {
      if (execution.getExitStatus().equals(ExitStatus.FAILED)) {
        failed.add(execution);   // then read failure exceptions / step counts
      }
    }
  }
}
```

`JobExplorer` retorna objetos de domínio completos. `JobOperator` cobre terreno
semelhante, mas fala em `String`/`Long` — tipos deliberadamente simples que viajam
bem por JMX — e adiciona métodos de controle:

```java
public interface JobOperator {
  List<Long> getExecutions(long instanceId);
  Map<Long, String> getStepExecutionSummaries(long executionId);
  String getSummary(long executionId);
  Long restart(long executionId);
  boolean stop(long executionId);
  // ... (getJobNames, getJobInstances, getRunningExecutions, start, ... also available)
}
```

`getSummary` e `getStepExecutionSummaries` compactam o mesmo detalhe de
status/exit-code em `String`s, que é exatamente o que um console JMX consegue
renderizar. (O modelo de identidade por trás de instâncias vs. execuções está em
*spring-batch-job-instance-execution-flow*.)

### O schema de metadados como superfície de monitoramento

Como é apenas um schema relacional, a ferramenta de monitoramento mais básica é um
cliente SQL. `BATCH_STEP_EXECUTION` carrega os números que você de outra forma
teria que calcular: `READ_COUNT`, `WRITE_COUNT`, `FILTER_COUNT`,
`READ_SKIP_COUNT`, `WRITE_SKIP_COUNT`, `PROCESS_SKIP_COUNT`, `COMMIT_COUNT`,
`ROLLBACK_COUNT`, `STATUS`, `EXIT_CODE`, `START_TIME`, `END_TIME`:

```sql
SELECT je.JOB_INSTANCE_ID, se.STEP_NAME, se.STATUS,
       se.READ_COUNT, se.WRITE_COUNT, se.WRITE_SKIP_COUNT,
       (se.END_TIME - se.START_TIME) AS duration
FROM   BATCH_STEP_EXECUTION se
JOIN   BATCH_JOB_EXECUTION je ON je.JOB_EXECUTION_ID = se.JOB_EXECUTION_ID
WHERE  se.STATUS = 'FAILED' OR se.WRITE_SKIP_COUNT > 0;
```

As APIs `JobExplorer`/`JobOperator` são uma fina camada orientada a objetos sobre
exatamente esses dados — veja
*spring-batch-job-repository-database-configuration* para o schema completo e a
configuração de prefixo de tabela.

### Monitoramento com listeners (push, não poll)

Um `JobExecutionListener` transforma "um job terminou" em um evento acionável sem
que ninguém precise consultar o banco. O livro mantém o listener genérico
delegando a uma interface `BatchMonitoringNotifier` e só disparando em falha:

```java
public class MonitoringExecutionListener {
  private BatchMonitoringNotifier monitoringNotifier;   // injected

  @AfterJob
  public void executeAfterJob(JobExecution jobExecution) {
    if (jobExecution.getStatus() == BatchStatus.FAILED) {
      monitoringNotifier.notify(jobExecution);   // e-mail, Spring event, ...
    }
  }
}
```

Notifiers concretos se encaixam por trás da interface: um `EmailMonitoringNotifier`
construído sobre o `MailSender`/`SimpleMailMessage` do Spring, ou um
`ApplicationEventMonitoringNotifier` que publica pelo `ApplicationEventPublisher`
do container. O listener vê a `JobExecution` *ao vivo*, incluindo
`getFailureExceptions()` — exceções que o Spring Batch **não** persiste, então só
são acessíveis a partir do processo em execução. O registro e o ciclo de vida
completo do listener (hooks de job/step/chunk/item, anotações) pertencem a
*spring-batch-execution-listeners*; aqui o listener é apenas um hook de
monitoramento.

### Monitoramento com JMX

JMX expõe recursos como MBeans que um console externo pode ler e dirigir
remotamente. O livro exporta o `JobOperator` (tipos simples) em vez do
`JobExplorer` (objetos complexos, estranhos via JMX) com o `MBeanExporter` do
Spring:

```xml
<bean class="org.springframework.jmx.export.MBeanExporter">
  <property name="beans">
    <map>
      <entry key="spring:service=batch,bean=jobOperator" value-ref="jobOperator"/>
    </map>
  </property>
  <!-- InterfaceBasedMBeanInfoAssembler exports only JobOperator's methods over JMX -->
  <property name="assembler" ref="jobOperatorAssembler"/>
</bean>
```

Adicione um `ConnectorServerFactoryBean` + `RmiRegistryFactoryBean` para RMI
remoto, e o JConsole mostra o operator sob o nó `spring/batch`; chamar
`getJobInstances`, `getExecutions`, `getSummary` e `getStepExecutionSummaries`
recupera dados de execução ao vivo.

### Livro vs. hoje: o Spring Batch Admin morreu; o monitoramento migrou para o Micrometer

Três coisas mudaram materialmente desde 2012. Primeiro, **o Spring Batch Admin — o
console web que o livro cobre na seção 12.4 — foi descontinuado** (fim de vida em
31 de dezembro de 2017). Não recomende usá-lo. Seu papel como dashboard de jobs
passou para o **Spring Cloud Data Flow**, onde cada job batch é uma task Spring
Boot que o SCDF dispara, monitora e visualiza.

Segundo, as tabelas de metadados e as APIs de leitura permanecem, mas no **Spring
Batch 6.0 o `JobRepository` agora estende `JobExplorer`** — os dois foram
consolidados, o `JobExplorer` autônomo (movido para
`org.springframework.batch.core.repository.explore`) está deprecated para remoção,
e um único bean agora escreve e lê o histórico (veja
*spring-batch-job-repository-database-configuration*).

Terceiro, o JMX feito à mão foi superado por **métricas Micrometer embutidas,
disponíveis desde o Spring Batch 4.2**. O framework registra timers sob o prefixo
`spring.batch` automaticamente — sem necessidade de wiring de MBean:

| Metric | Type | Tags |
|---|---|---|
| `spring.batch.job` | `TIMER` | `name`, `status` |
| `spring.batch.job.active` | `LONG_TASK_TIMER` | `name` |
| `spring.batch.step` | `TIMER` | `name`, `job.name`, `status` |
| `spring.batch.step.active` | `LONG_TASK_TIMER` | `name` |
| `spring.batch.item.read` / `spring.batch.item.process` / `spring.batch.chunk.write` | `TIMER` | `job.name`, `step.name`, `status` |

```java
// Register a Prometheus-backed registry; timers are recorded for you.
@Bean
public MeterRegistry meterRegistry() {
  return new PrometheusMeterRegistry(PrometheusConfig.DEFAULT);
}
// exposed as e.g. spring.batch.job{name="importProductsJob",status="FAILED"}
```

Com o Spring Boot, adicionar `micrometer-registry-prometheus` e o Actuator expõe
`/actuator/prometheus`, que o Prometheus faz scrape e o Grafana visualiza; o
Spring Batch 6.0 também registra isso através de um `ObservationRegistry`.
Confirmado pela referência do Spring Batch 6.0 (Monitoring and metrics / What's
New), pelo Migration Guide do Spring Batch 6.0, e pelo aviso de EOL do Spring
Batch Admin.

## Trade-offs

- **Exceções de falha não são persistidas — só descrições de exit sobrevivem.**
  `JobExecution.getFailureExceptions()` retorna `Throwable`s reais, mas só dentro
  do processo que rodou o job; o Spring Batch nunca os armazena. Depois do fato
  você tem a *descrição* do exit status (a coluna `EXIT_MESSAGE`), então o
  monitoramento post-mortem lê texto, não stack traces ao vivo.
- **`JobExplorer` vs. `JobOperator` é riqueza vs. amigabilidade remota.**
  `JobExplorer` devolve objetos de domínio completos — ideal em processo, ruim via
  JMX; `JobOperator` retorna resumos `String`/`Long` — ideal para um JConsole. O
  livro recomenda explicitamente expor o `JobOperator`, não o `JobExplorer`, via
  JMX.
- **SQL direto é o mais poderoso e o mais acoplado.** Consultar tabelas `BATCH_*`
  responde a qualquer coisa, mas acopla firmemente seu monitoramento ao schema e ao
  prefixo de tabela — uma mudança de prefixo ou uma migração quebra isso
  silenciosamente.
  ```sql
  -- breaks the moment table-prefix is customized away from BATCH_
  SELECT COUNT(*) FROM BATCH_JOB_EXECUTION WHERE STATUS = 'FAILED';
  ```
- **Listeners dão push, mas não histórico.** Um listener de monitoramento só vê a
  `JobExecution` atual; ele não sabe nada sobre execuções anteriores. O alerta é
  imediato, mas qualquer "essa é a terceira falha da semana?" ainda precisa do
  `JobExplorer`.
- **Livro vs. hoje: não construa as ferramentas de alto nível do livro do zero.** O
  Spring Batch Admin e o JMX feito à mão eram *a* resposta em 2012; hoje eles foram
  superados por métricas Micrometer embutidas, Prometheus/Grafana e Spring Cloud
  Data Flow. Construir seu próprio MBean exporter hoje em grande parte duplica
  métricas que você ganha de graça do framework.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 12, "Monitoring jobs", sections 12.1-12.3 & 12.5, "Accessing batch execution data" … "Monitoring with JMX", p. 348-372 — doc
- [Spring Batch Reference — Monitoring and metrics (Micrometer timers, since 4.2)](https://docs.spring.io/spring-batch/reference/spring-batch-observability/micrometer.html) — doc
- [Spring Batch Reference — What's New in Spring Batch 6 (JobRepository now extends JobExplorer)](https://docs.spring.io/spring-batch/reference/whatsnew.html) — doc
- [Spring Batch 6.0 Migration Guide — JobExplorer consolidated into JobRepository](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [Spring Cloud Data Flow (modern dashboard replacing Spring Batch Admin)](https://dataflow.spring.io/) — doc
