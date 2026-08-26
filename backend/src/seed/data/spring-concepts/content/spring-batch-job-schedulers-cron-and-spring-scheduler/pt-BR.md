---
version: 1.0
updatedAt: 2026-08-05
title: Disparando Jobs do Spring Batch — cron vs. o Spring Scheduler
summary: Como as entradas de crontab do cron disparam o CommandLineJobRunner como um processo novo do sistema operacional a cada agendamento, como o suporte @Scheduled/TaskScheduler do Spring oferece uma alternativa in-process com opções fixedRate/fixedDelay/cron desde o Spring 3.0, e por que o Kubernetes CronJob substituiu em grande parte o crontab bruto como modelo de deploy para o mesmo padrão de disparar um processo batch.
---
## Objective

O `CommandLineJobRunner` (coberto em `spring-batch-command-line-launching`)
sabe como transformar argumentos de `java -classpath ...` em um job do
Spring Batch rodando — mas alguma coisa ainda precisa *invocar* esse
comando de forma recorrente. Este conceito trata desse gatilho, não do
runner em si: `cron`, o clássico agendador de jobs do UNIX que cria um
processo novo a partir de uma expressão baseada em tempo, e o suporte
`@Scheduled`/`TaskScheduler` do próprio Spring, que agenda uma chamada de
método dentro de um contexto Spring já em execução. Os dois resolvem o
mesmo problema de "disparar isso periodicamente" em camadas diferentes —
agendamento de processo do SO vs. agendamento de tarefa in-process — e a
escolha entre eles depende principalmente de se um contexto de aplicação
Spring já está de pé e de quão custoso é inicializá-lo.

## Use Cases

- Um job noturno de reindexação ou importação de arquivo com uma janela de
  tempo larga (por exemplo, "algum momento entre 2h e 4h da manhã") onde
  criar uma JVM nova uma vez por dia é barato em relação ao tempo de
  execução do próprio job — um bom encaixe para `cron` +
  `CommandLineJobRunner`.
- Um job que precisa rodar com muita frequência (por exemplo, escanear um
  diretório a cada minuto) onde inicializar o contexto Spring —
  inicializando um `SessionFactory` do Hibernate, connection pools, etc. —
  já é, em si, intensivo em CPU e dominaria ou ultrapassaria o próprio
  tempo de execução do job se repetido a cada rodada; o scheduler do Spring
  evita esse custo mantendo o contexto residente.
- Uma aplicação que já roda como um processo de vida longa (uma aplicação
  web ou qualquer outro container gerenciado) e quer adicionar disparos
  batch agendados sem depender de acesso a cron no nível do SO — relevante
  para alvos de deploy restritos ou somente-container.
- Escolher entre um intervalo fixo simples ("a cada minuto") e uma regra de
  calendário complexa ("último dia útil do mês às 23h") — o scheduler do
  Spring suporta os dois sem forçar todo caso a passar por uma expressão
  cron.

## Deep Dive

### Disparando com cron: a entrada de crontab

Uma linha de crontab tem três partes — expressão cron, usuário e comando:

```
0 4 * * ?     acogoluegnes    java -classpath "/usr/local/bin/sb/lib/*" \
  org.springframework.batch.core.launch.support.CommandLineJobRunner \
  import-products-job.xml importProductsJob \
  inputFile=file:/home/sb/import/products.txt date=2010/12/08
```

`0 4 * * ?` significa "todo dia às 4h da manhã"; o comando é a mesma
invocação de `CommandLineJobRunner` de `spring-batch-command-line-launching`
— o único trabalho do cron é decidir *quando* rodá-lo. Cada disparo cria
uma JVM totalmente nova: inicializa o contexto Spring, roda o job, encerra.
Isso é tranquilo para um job pouco frequente; vira o gargalo para um job
disparado a cada minuto se a inicialização do contexto for cara, já que o
próximo tick do cron pode disparar antes mesmo da JVM anterior terminar de
subir.

### Disparando in-process: `@Scheduled`

O scheduler do Spring precisa de um contexto de aplicação Spring em
execução — normalmente você o embute em uma aplicação web ou outro
ambiente gerenciado, em vez de disparar de forma standalone. A própria
lógica de disparo é um método simples que chama o job launcher:

```java
public class SpringSchedulingAnnotatedLauncher {

    private Job job;
    private JobLauncher jobLauncher;

    @Scheduled(fixedRate = 1000)
    public void launch() throws Exception {
        JobParameters jobParams = createJobParameters();
        jobLauncher.run(job, jobParams);
    }

    private JobParameters createJobParameters() {
        // typically a timestamp or sequence, to give each run a distinct
        // JobInstance identity
    }
}
```

Ativando o suporte a `@Scheduled` e (opcionalmente) um thread pool:

```xml
<task:scheduler id="scheduler" pool-size="10" />
<task:annotation-driven scheduler="scheduler" />
```

Declarar o bean scheduler é opcional — o Spring recorre a um scheduler de
thread única assim que qualquer método `@Scheduled` existe — mas
declará-lo explicitamente, com um tamanho de pool, importa a partir do
momento em que vários jobs agendados podem se sobrepor nos horários de
disparo e não deveriam bloquear em uma única thread compartilhada.
`fixedRate` aqui usa o horário de *início* da invocação anterior para medir
o intervalo; `fixedDelay`, em vez disso, mede a partir da *conclusão* da
invocação anterior, e `cron` aceita uma expressão cron completa quando o
agendamento é irregular demais para um intervalo fixo. Diferente do `cron`
do sistema, o próprio parser de cron do Spring suporta um campo de
segundos.

### Livro vs. hoje: `@Scheduled` ganhou suporte a reativo/virtual threads, e o Kubernetes CronJob substituiu em grande parte o crontab bruto

A mecânica do `@Scheduled` acima está inalterada desde o livro (Spring
3.0): `fixedRate`, `fixedDelay`, `cron`, e `@EnableScheduling` (o
equivalente em anotação de `<task:annotation-driven>`) continuam
funcionando exatamente como descrito. Duas coisas mudaram desde 2012:

- **O Spring Framework 6.1 adicionou suporte reativo e a virtual threads no
  `@Scheduled`.** Um método agendado agora pode retornar `Mono`/`Flux` (ou
  uma função suspend do Kotlin), e uma nova implementação
  `SimpleAsyncTaskScheduler` dispara cada execução agendada em sua própria
  virtual thread do JDK 21 — útil para um scheduler do Spring que distribui
  muitos disparos de job ligados a I/O sem dimensionar antecipadamente um
  pool fixo de platform threads. Nada disso muda o vocabulário de gatilhos
  (`fixedRate`/`fixedDelay`/`cron` são as mesmas três opções da tabela 4.5
  do livro); muda o que roda na thread que o scheduler entrega.
- **O modelo de deploy em torno do `cron` mudou mais do que o `cron` em
  si.** `cron` + `CommandLineJobRunner` ainda funciona sem alterações como
  mecânica — mas em um deploy containerizado/Kubernetes, o equivalente a
  "editar `/etc/crontab` numa máquina" é um recurso `CronJob` do
  Kubernetes, que roda a mesma invocação de
  `CommandLineJobRunner`/`CommandLineJobOperator` dentro de um container em
  uma expressão cron de `spec.schedule`, com o cluster (não o daemon
  `cron` de uma única máquina) responsável por disparar, retentar em caso
  de falha e aplicar a política de concorrência. O trade-off subjacente de
  "criar um processo novo a cada rodada agendada" do livro — sem contexto
  residente, custo total de inicialização toda vez — se mantém idêntico; o
  que mudou é *onde* o agendamento vive e quem é o dono de dispará-lo, não
  a mecânica que estava sendo comparada entre cron e o scheduler do Spring.

Confirmado pela documentação de referência atual do Spring Framework sobre
agendamento de tarefas e pela documentação do Kubernetes sobre o recurso
`CronJob`.

## Trade-offs

- **O cron cria uma JVM nova por execução — simples, mas paga o custo total
  de inicialização do contexto Spring a cada disparo.** Ótimo para um job
  noturno; para um job disparado a cada minuto, um contexto caro (por
  exemplo, um que inicializa um `SessionFactory` do Hibernate) pode levar
  mais tempo para subir do que o próprio job leva para rodar, e nesse caso
  um scheduler residente do Spring evita completamente o custo repetido.
- **O cron não tem nenhuma noção do contexto Spring em que está
  disparando.** Ele só roda um comando de shell; se a JVM da rodada
  anterior ainda está encerrando ou o classpath/configuração muda, o cron
  não tem como saber ou coordenar — o scheduler do Spring roda dentro do
  mesmo contexto de vida longa contra o qual agenda, então job e scheduler
  compartilham o mesmo ciclo de vida.
- **O deploy mais simples do scheduler do Spring atrela o disparo do job ao
  próprio uptime da aplicação.** Ele precisa de um contexto de aplicação
  Spring em execução para disparar — nenhum acesso a cron no nível do SO é
  necessário, o que é atraente para ambientes restritos ou
  somente-container, mas um disparo de job agendado só acontece enquanto
  aquela instância específica da aplicação está de pé; reiniciar ou fazer
  redeploy da aplicação e, sem uma verificação persistida de "isso já
  disparou hoje", uma janela perdida é simplesmente perdida, em vez de ser
  retomada por um daemon independente no nível do SO.
- **A configuração de agendamento em XML é desacoplada do método Java que
  ela dispara; o `@Scheduled` orientado a anotação não é.**
  `<task:scheduled ref="..." method="launch" fixed-rate="1000" />` vive
  inteiramente fora da classe Java, então renomear ou trocar o método alvo
  exige editar XML — mas o agendamento pode ser externalizado para um
  arquivo de propriedades por ambiente. `@Scheduled(fixedRate = 1000)`
  mantém o agendamento junto do código que ele governa, ao custo de ficar
  hardcoded e só utilizável em métodos que você controla.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 4, "Running batch jobs", section 4.3, "Job schedulers", p. 98-104 — doc
- [Spring Framework Reference — Task Execution and Scheduling](https://docs.spring.io/spring-framework/reference/integration/scheduling.html) — doc
- [Spring Batch Reference — Running a Job from the Command Line](https://docs.spring.io/spring-batch/reference/job/running.html) — doc
- [Kubernetes Documentation — CronJob](https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/) — doc
