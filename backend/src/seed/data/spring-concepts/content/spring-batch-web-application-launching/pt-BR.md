---
version: 1.0
updatedAt: 2026-08-06
title: Lançando Jobs do Spring Batch a partir de uma Aplicação Web
---
## Objective

O Spring Batch é "apenas beans Spring", então um job repository, um launcher, e
suas definições de `Job` podem viver dentro de qualquer contexto Spring de vida
longa — inclusive aquele que uma aplicação web já mantém rodando. Embutir o
ambiente batch numa aplicação web o torna *residente*: a infraestrutura é
inicializada uma vez quando o container sobe e permanece quente, então lançar um
job não significa mais criar uma JVM nova e pagar o custo total de bootstrap do
contexto a cada execução (o preço da abordagem `cron` + `CommandLineJobRunner` em
`spring-batch-command-line-launching`).

Uma vez que o ambiente batch está residente, você também pode disparar jobs *sob
demanda* via HTTP. Isso importa quando quem decide "rodar agora" é um sistema
externo — o scheduler de outro time, uma ferramenta de monitoramento, um admin
UI — que não consegue alcançar a JVM do batch diretamente mas pode fazer uma
requisição HTTP. A pegadinha é que um lançamento disparado pela web precisa ser
assíncrono, ou o job monopoliza a thread da requisição pela sua duração inteira.

## Use Cases

- Um sistema externo que não consegue falar diretamente com seu processo batch
  (um scheduler legado, o `cron` do time de ops num host *diferente*, um webhook
  de outro serviço) precisa disparar um job — exponha um endpoint HTTP que ele
  possa acessar.
- Um job roda com frequência suficiente para que re-inicializar o contexto Spring
  inteiro a cada execução (inicializando connection pools, uma `SessionFactory`
  de ORM, etc.) dominaria seu tempo de execução — mantenha o contexto residente
  num container web em vez disso.
- Você já opera uma aplicação web e quer colocar jobs batch no mesmo lugar (e um
  scheduler in-process — veja
  `spring-batch-job-schedulers-cron-and-spring-scheduler`) no mesmo contexto,
  reaproveitando suas data sources, DAOs e serviços de negócio.
- Um operador, console de admin, ou webhook de outro serviço precisa de um
  gatilho "rode este job agora" sob demanda, com parâmetros derivados da
  requisição.

## Deep Dive

### Embutindo o Spring Batch no contexto raiz de uma aplicação web

O Spring Framework distribui um servlet listener, `ContextLoaderListener`, que
liga o ciclo de vida de um contexto de aplicação Spring ao da aplicação web. Esse
contexto é o *contexto de aplicação raiz* da aplicação web. Você registra o
listener no `web.xml`:

```xml
<web-app xmlns="http://java.sun.com/xml/ns/javaee" version="2.5">
  <display-name>Spring Batch in a web application</display-name>
  <listener>
    <listener-class>
      org.springframework.web.context.ContextLoaderListener
    </listener-class>
  </listener>
</web-app>
```

Por padrão o listener constrói o contexto a partir de
`/WEB-INF/applicationContext.xml`. Esse arquivo guarda a infraestrutura batch, os
jobs, um scheduler opcional, e serviços da aplicação — e uma boa prática é
dividi-lo para que os jobs possam ser reaproveitados (por exemplo, em testes de
integração) em vez de viverem num único arquivo monolítico:

```xml
<beans xmlns="http://www.springframework.org/schema/beans">
  <import resource="batch-infrastructure.xml"/>  <!-- jobRepository, jobLauncher -->
  <import resource="batch-jobs.xml"/>            <!-- the Job definitions -->
  <import resource="scheduling.xml"/>            <!-- optional in-process scheduler -->
</beans>
```

Faça deploy do WAR e o ambiente batch está vivo e quente. Se `scheduling.xml`
conectar um scheduler Spring, pronto — os jobs disparam num timer sem nenhum
scheduler externo. O cenário restante é quando o gatilho vem de *fora*: uma
requisição HTTP.

### Lançando um job sob demanda via HTTP (um controller Spring MVC)

O gatilho externo é apenas uma chamada HTTP — até o `cron` de outra máquina pode
fazer isso com `wget`:

```bash
wget "http://localhost:8080/sbia/joblauncher?job=importProductsJob&date=20101218"
```

No lado do servidor, um controller Spring MVC lê o nome do `job` mais parâmetros
arbitrários da requisição, os transforma em `JobParameters`, e lança:

```java
@Controller
public class JobLauncherController {

  private final JobLauncher jobLauncher;
  private final JobRegistry jobRegistry;

  public JobLauncherController(JobLauncher jobLauncher, JobRegistry jobRegistry) {
    this.jobLauncher = jobLauncher;
    this.jobRegistry = jobRegistry;
  }

  @RequestMapping(value = "joblauncher", method = RequestMethod.GET)
  @ResponseStatus(HttpStatus.ACCEPTED)                        // returns 202, empty body
  public void launch(@RequestParam String job, HttpServletRequest request)
      throws Exception {
    JobParameters params = extractParameters(request);        // every non-"job" param
    jobLauncher.run(jobRegistry.getJob(job), params);         // look up Job by name, run
  }
}
```

`jobRegistry.getJob(job)` resolve o bean `Job` a partir do nome na URL, então o
controller pode lançar *qualquer* job registrado sem uma referência em tempo de
compilação. Esse registry é um bean que você declara junto com a
infraestrutura:

```xml
<bean id="jobRegistry"
      class="org.springframework.batch.core.configuration.support.MapJobRegistry"/>
<bean class="org.springframework.batch.core.configuration.support.JobRegistryBeanPostProcessor">
  <property name="jobRegistry" ref="jobRegistry"/>
</bean>
```

O `DispatcherServlet` do Spring MVC (declarado no `web.xml`) cria um contexto
*filho* cujo controller enxerga o `jobLauncher` e o `jobRegistry` do contexto
raiz. O `202 ACCEPTED` é deliberado ("lançamento aceito", não "job terminado"), e
o lançamento **precisa ser assíncrono** — um `run()` síncrono prende a thread do
container pelo job inteiro. O `TaskExecutor` que faz o `run()` retornar
imediatamente está coberto em
`spring-batch-job-launcher-api-and-async-launching`; aqui isso é um requisito
obrigatório, não uma otimização.

### Livro vs. hoje: o Spring Boot auto-configura o contexto residente que você conectava à mão

Cada peça móvel acima — um contexto residente, seu ciclo de vida, o servlet, até
o bean do launcher — é o que o Spring Boot agora fornece de graça. Uma aplicação
Boot *é* um processo de vida longa com um `ApplicationContext` já rodando e um
container servlet embutido, então não há `web.xml`, nenhum
`ContextLoaderListener`, nenhuma declaração de `DispatcherServlet`, e nenhuma
divisão de contexto pai/filho para raciocinar sobre. `BatchAutoConfiguration`
conecta o `JobRepository` e a infraestrutura batch, e por padrão roda seu `Job`
na inicialização via `JobLauncherApplicationRunner`. Você opta por sair da
execução na inicialização — a escolha usual quando você quer lançar sob demanda
em vez disso — com uma única propriedade:

```properties
# don't run jobs at startup; we'll trigger them ourselves over HTTP
spring.batch.job.enabled=false
# spring.batch.job.name=importProductsJob   # pick one when several Jobs exist
```

O gatilho HTTP vira um `@RestController` comum que injeta a API de lançamento e
o bean `Job` diretamente (ambos são beans auto-configurados) — sem lookup de
`JobRegistry`, sem XML:

```java
@RestController
class ProductsJobController {

  private final JobOperator jobOperator;      // modern launch API (see below)
  private final Job importProductsJob;

  ProductsJobController(JobOperator jobOperator, Job importProductsJob) {
    this.jobOperator = jobOperator;
    this.importProductsJob = importProductsJob;
  }

  @PostMapping("/jobs/import-products")
  @ResponseStatus(HttpStatus.ACCEPTED)
  JobExecution launch() throws Exception {
    JobParameters params = new JobParametersBuilder()
        .addLocalDateTime("requestedAt", LocalDateTime.now())
        .toJobParameters();
    return jobOperator.start(importProductsJob, params);   // 6.0: start(Job, JobParameters)
  }
}
```

Dois detalhes do estado atual conduzem esse snippet. Primeiro, a própria API de
lançamento mudou: `JobLauncher` está deprecated desde o Spring Batch 6.0 em
favor de `JobOperator` (que agora *estende* `JobLauncher`; a implementação é
`TaskExecutorJobOperator`), então o `jobLauncher.run(job, params)` do livro vira
`jobOperator.start(job, params)` — o `start(String, Properties)` baseado em
string está ele mesmo deprecated para remoção. Segundo, o requisito de
assincronia do livro não foi embora: você ainda dá ao operator um
`TaskExecutor` para que a thread da requisição retorne imediatamente,
exatamente como detalhado em
`spring-batch-job-launcher-api-and-async-launching`. (Adicione
`@EnableBatchProcessing` / `DefaultBatchConfiguration` apenas para fazer a
auto-configuração do Boot recuar e conectar a infraestrutura manualmente.)
Confirmado pela referência atual do Spring Boot ("Spring Batch" / rodando um
Job na inicialização) e pela API `JobOperator` do Spring Batch 6.0.

## Trade-offs

- **Contexto residente vs. uma JVM nova por execução** — Embutir mantém o
  ambiente batch quente, então um lançamento pula o custo total de bootstrap do
  contexto que `cron` + `CommandLineJobRunner` paga a cada vez. O outro lado da
  moeda é o acoplamento: a disponibilidade do job agora está atrelada ao uptime
  da aplicação web, os jobs compartilham seu heap e thread pool, e uma queda do
  container leva os jobs junto.
- **Um gatilho HTTP desacopla o chamador, mas você herda a superfície de
  segurança dele** — Qualquer um que consiga alcançar a URL pode iniciar um
  job. O `wget` puro do livro não tem autenticação nem rate limiting; um
  endpoint de lançamento acessível pela rede precisa dos dois, mais uma
  proteção contra lançamentos duplicados.
- **Use POST, não GET, para um endpoint de lançamento** — O livro mapeia o
  launcher para `GET`, mas lançar um job é uma ação que muda estado e não é
  idempotente; pela semântica HTTP isso pertence a `POST` (`@PostMapping`), o
  que também mantém os parâmetros do job fora de logs de proxy/acesso e fora da
  URL.
- **Assincronia é obrigatória aqui, não um ajuste fino** — Um lançamento
  síncrono disparado pela web prende uma thread de servlet pela duração
  inteira do job; um punhado de jobs longos e concorrentes pode esgotar o pool
  do container e travar requisições *não relacionadas*. Este é um modo de
  falha por exaustão de recursos, não um erro de batch — veja
  `spring-batch-job-launcher-api-and-async-launching` para a correção com
  `TaskExecutor`.
- **Lookup por nome vs. injetar o `Job`** — O `JobRegistry.getJob(name)` do
  livro permite que um controller lance qualquer job registrado por string, ao
  custo de uma falha em runtime se o nome estiver errado. Injetar o bean `Job`
  (o idioma do Boot) é seguro em tempo de compilação, mas prende o controller
  a um job específico.
- **Dois contextos (raiz + servlet) são uma armadilha clássica de wiring** — No
  setup XML, um bean definido no lugar errado do par pai/filho fica invisível
  ou é silenciosamente duplicado. O `ApplicationContext` único do Spring Boot
  remove a divisão por completo.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 4, "Running batch jobs", section 4.4, "Launching from a web application", p. 103-109 — doc
- [Spring Boot Reference — Spring Batch (auto-configuration & running a Job on startup)](https://docs.spring.io/spring-boot/reference/io/spring-batch.html) — doc
- [Spring Batch 6.0 API — JobOperator (start(Job, JobParameters); JobLauncher deprecated)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/core/launch/JobOperator.html) — doc
