---
version: 1.0
updatedAt: 2026-08-06
title: "Spring Batch Reprocessando em Erro: RetryPolicy, RetryTemplate e Retry via AOP"
---
## Objective

Skip (veja `spring-batch-skip-policy-and-listeners`) descarta um item — certo para uma
falha *determinística*, como uma linha malformada num flat file. Mas muitas falhas são
**transitórias**: um deadlock porque outro processo segurava um lock, um conflito de
optimistic locking, uma chamada de web service que deu timeout numa rede instável. O
item não é ruim — o *momento* é que foi. **Retry** tenta a operação que falhou de novo,
frequentemente tendo sucesso na segunda tentativa, em vez de descartar um registro bom
ou falhar o step inteiro.

Os atributos declarativos `retry-limit`/`retryable-exception-classes` e seus
equivalentes em builder de Java config vivem em
`spring-batch-fault-tolerant-step-configuration` e **não** são repetidos aqui. Esta
entrada vai mais fundo: objetos `RetryPolicy` para controle sobre *como* o retry decide,
back-off para espaçar as tentativas, hooks `RetryListener`, o `RetryTemplate` standalone
para reprocessar **código arbitrário fora de um step**, e retry transparente via AOP —
compondo com skip e restart (`spring-batch-restart-and-recovery`) para tornar um chunk
step (`spring-batch-chunk-processing`) à prova de balas.

## Use Cases

- Reprocessar a escrita de um item de um chunk que sofreu uma
  `DeadlockLoserDataAccessException` de um job concorrente em vez de falhar — o lock
  geralmente já se foi milissegundos depois.
- Dar agressividade diferente a tipos de exception: reprocessar erros de concorrência
  genéricos 3 vezes mas deadlocks 5, via um `ExceptionClassifierRetryPolicy`.
- Espaçar exponencialmente as tentativas para que um banco de dados ou web service já
  sobrecarregado não seja martelado com retries imediatos.
- Envolver uma chamada de web service dentro de um `Tasklet` customizado (não um chunk)
  com um `RetryTemplate` diretamente no código da aplicação.
- Reprocessar de forma transparente via AOP para que o código chamador não tenha
  *nenhuma* lógica de retry, e logar toda operação reprocessada com um `RetryListener`.

## Deep Dive

### Exceptions reprocessáveis e o limite de retry — onde o retry começa

Por padrão qualquer exception num step chunk-oriented falha o step; declarar uma
exception reprocessável e um `retry-limit` no `chunk` transforma isso em novas
tentativas limitadas. Dois comportamentos importam: o Spring Batch reprocessa **apenas
as fases de processamento e escrita** (não a leitura), e um retry dispara um
**rollback**, então um cache com escopo de chunk reproduz os itens sem reler. Como a
reprodução atravessa transações, os itens são rastreados por identidade — **sobrescreva
`equals()`/`hashCode()`** ou o Spring Batch não consegue saber qual item resubmeter.
Assim como no skip, `include` cobre uma exception *e suas subclasses* e `exclude`
recorta a hierarquia de volta (reprocessar toda `TransientDataAccessException` *exceto*
`PessimisticLockingFailureException`).

Retry **compõe com skip**: liste a mesma exception tanto em
`retryable-exception-classes` quanto em `skippable-exception-classes` (com
`retry-limit` e `skip-limit`), e o Spring Batch reprocessa até o limite de retry, depois
— se ainda falhar — pula em vez de falhar o step. Retry age primeiro; skip captura a
tentativa esgotada. Essa configuração declarativa combinada está em
`spring-batch-fault-tolerant-step-configuration`, e a metade de skip em
`spring-batch-skip-policy-and-listeners`.

### Controle total com um objeto RetryPolicy

`retry-limit` + `retryable-exception-classes` é só o `SimpleRetryPolicy` padrão. Quando
exceptions merecem tratamento *diferente*, conecte um bean `retry-policy` no chunk em
vez disso. O Spring Batch traz três (Tabela 8.3): `SimpleRetryPolicy` (reprocessa uma
hierarquia N vezes), `TimeoutRetryPolicy` (para quando uma operação demora demais), e
`ExceptionClassifierRetryPolicy` (delega para uma policy diferente por tipo de
exception). Isto reprocessa erros de concorrência genéricos 3 vezes mas deadlocks 5:

```xml
<!-- on the chunk: retry-policy="retryPolicy" -->
<bean id="retryPolicy"
      class="org.springframework.batch.retry.policy.ExceptionClassifierRetryPolicy">
  <property name="policyMap">
    <map>
      <entry key="org.springframework.dao.ConcurrencyFailureException">
        <bean class="org.springframework.batch.retry.policy.SimpleRetryPolicy">
          <property name="maxAttempts" value="3"/>
        </bean>
      </entry>
      <entry key="org.springframework.dao.DeadlockLoserDataAccessException">
        <bean class="org.springframework.batch.retry.policy.SimpleRetryPolicy">
          <property name="maxAttempts" value="5"/>
        </bean>
      </entry>
    </map>
  </property>
</bean>
```

Os exemplos do livro reprocessam *imediatamente*, mas a mesma infraestrutura espaça as
tentativas com um `BackOffPolicy`. Martelar um recurso já sofrendo piora as coisas; um
`ExponentialBackOffPolicy` espera cada vez mais depois de cada falha (0.5s, 1s, 2s, …),
dando ao deadlock ou ao serviço sobrecarregado tempo para se recuperar:

```java
RetryTemplate retryTemplate = new RetryTemplate();
retryTemplate.setRetryPolicy(retryPolicy);
ExponentialBackOffPolicy backOff = new ExponentialBackOffPolicy();
backOff.setInitialInterval(500);   // 0.5s, then *2 each time
backOff.setMultiplier(2);
retryTemplate.setBackOffPolicy(backOff);
```

### Escutando retries com RetryListener

Operações reprocessadas sempre degradam performance, então saber *o quê* está sendo
reprocessado ajuda a corrigir a causa raiz. `RetryListener` tem métodos de ciclo de vida
`open`/`close`/`onError`; estenda o adapter `RetryListenerSupport` e sobrescreva só
`onError`, depois registre com o elemento dedicado
`<retry-listeners><listener ref="..."/></retry-listeners>` (distinto do registro de
skip-listener em `spring-batch-skip-policy-and-listeners`):

```java
public class Slf4jRetryListener extends RetryListenerSupport {   // org.springframework.batch.retry.listener
    private static final Logger LOG = LoggerFactory.getLogger(Slf4jRetryListener.class);

    @Override
    public <T> void onError(RetryContext context, RetryCallback<T> callback, Throwable throwable) {
        LOG.error("retried operation", throwable);
    }
}
```

### Envolvendo código arbitrário com o RetryTemplate standalone

Retry não é só para steps de chunk. Quando um `Tasklet` customizado chama um web
service que pode falhar de forma transitória, a interface `RetryOperations` e sua
implementação `RetryTemplate` adicionam **retry programático a qualquer bloco de
código** — dentro de um tasklet, ou até numa aplicação web comum:

```java
RetryTemplate retryTemplate = new RetryTemplate();
SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy();
retryPolicy.setMaxAttempts(3);
retryTemplate.setRetryPolicy(retryPolicy);

List<Discount> discounts = retryTemplate.execute(
    new RetryCallback<List<Discount>>() {
        @Override
        public List<Discount> doWithRetry(RetryContext context) throws Exception {
            return discountService.getDiscounts();   // the risky call
        }
    });
```

`RetryOperations.execute(RetryCallback)` roda o callback e o reinvoca conforme a
policy numa exception reprocessável; o `RetryTemplate` pode igualmente ser injetado
como bean.

### Retry transparente com AOP: RetryOperationsInterceptor

Fixar o `RetryTemplate` no código acopla o tasklet à lógica de retry e complica os
testes. AOP remove isso: `RetryOperationsInterceptor` é um advice que faz proxy do
serviço alvo e trata o retry, então o tasklet só chama
`discountService.getDiscounts()` **sem nenhum código de retry**:

```xml
<bean id="retryAdvice"
      class="org.springframework.batch.retry.interceptor.RetryOperationsInterceptor">
  <!-- retryOperations = a RetryTemplate bean holding a SimpleRetryPolicy(maxAttempts=3) -->
  <property name="retryOperations" ref="retryTemplate"/>
</bean>

<aop:config>
  <aop:pointcut id="retriedOps"
                expression="execution(* com.manning.sbia.ch08.retry.DiscountService.*(..))"/>
  <aop:advisor pointcut-ref="retriedOps" advice-ref="retryAdvice"/>
</aop:config>
```

Qualquer chamada que combine com o pointcut é reprocessada de forma transparente. O
sucessor baseado em annotation desse interceptor é `@Retryable` num método (veja
*Livro vs. hoje*), que não precisa de nenhum `<aop:config>`.

### Livro vs. hoje: retry saiu do Spring Batch, depois virou um recurso core do Spring Framework

Esta é a grande mudança — a casa da API de retry se moveu **duas vezes**:

- **Livro de 2012 (Spring Batch 2.1):** toda classe acima vive *dentro* do Spring Batch
  sob `org.springframework.batch.retry.*` — `SimpleRetryPolicy`, `RetryTemplate`,
  `RetryCallback`, `RetryListenerSupport`, `RetryOperationsInterceptor` — configurada
  com o namespace XML `batch:`.
- **Spring Batch 2.2 (2013):** o motor de retry foi extraído para a biblioteca
  standalone **Spring Retry**, `org.springframework.retry.*`, que adicionou as
  annotations `@Retryable`/`@Recover` com `@EnableRetry` (a forma via annotation do
  interceptor acima). O step fault-tolerant do Spring Batch 3.x–5.x (`.faultTolerant()`)
  dependia dela.
- **Spring Framework 7 / Spring Batch 6.0 (2025):** o Spring Framework ganhou um
  recurso de retry **nativo** em `org.springframework.core.retry` (`RetryTemplate`,
  `Retryable`, `RetryPolicy`, `RetryListener`) mais `@Retryable` declarativo +
  `@EnableResilientMethods` em `org.springframework.resilience.annotation`. A
  referência do Spring Batch agora afirma que o step fault-tolerant "**não** usa o
  Spring Retry... e agora é baseado no recurso core de retry fornecido pelo Spring
  Framework 7.0." A API nativa renomeia `maxAttempts` para `maxRetries` e usa um
  builder —
  `RetryPolicy.builder().includes(...).maxRetries(4).delay(...).multiplier(2).jitter(...).build()`
  — acionado por `retryTemplate.invoke(() -> ...)`.

Duas mudanças transversais: imports foram de `javax.*` para `jakarta.*` (Spring Batch
5+/Jakarta EE 9+), e o namespace XML `batch:` está **deprecated desde a 6.0** (remoção
na 7.0) em favor de Java config — então hoje toda a história de retry é expressa em
`FaultTolerantStepBuilder`/`ChunkOrientedStepBuilder` (veja
`spring-batch-fault-tolerant-step-configuration`), não em XML, e o próprio
`FaultTolerantStepBuilder` mais o `BatchRetryTemplate` interno estão deprecated na 6.0.
Confirmado pela página de referência "Retry" da 6.0 do Spring Batch, pela referência
"Resilience Features" do Spring Framework 7, e pelo Spring Batch 6.0 Migration Guide.

## Trade-offs

- **Retry só para erros não determinísticos.** Um deadlock ou uma falha momentânea de
  rede pode ter sucesso no retry; uma violação de constraint ou um registro malformado
  nunca terá — reprocessar isso só queima tentativas antes de falhar de qualquer jeito.
  Use skip (ou filtro) para esses casos.
- **Retry é caro: ele faz rollback.** Uma exception reprocessável faz rollback e
  reproduz o chunk, então reprocessar itens demais com muita frequência degrada o
  throughput. Mantenha `retry-limit` pequeno e reserve retry para falhas genuinamente
  transitórias.
- **Retries imediatos podem piorar as coisas.** Bater de novo instantaneamente numa
  linha disputada ou num serviço sobrecarregado pode disparar a mesma falha outra vez;
  um `ExponentialBackOffPolicy` troca latência por uma taxa de sucesso bem maior.
- **Retry precisa de identidade estável do item.** Como a reprodução atravessa
  transações, os itens precisam implementar `equals()`/`hashCode()` (por exemplo, pelo
  id do banco) ou o Spring Batch não consegue resubmeter o item certo de forma
  confiável.
- **Retry via AOP/annotation esconde o retry.** Retry transparente mantém o código
  chamador limpo, mas retries silenciosos podem mascarar um problema sistêmico e
  inflar a latência; combine-os com um `RetryListener` ou logging para que os retries
  sejam observáveis.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 8, "Implementing bulletproof jobs", section 8.3, "Retrying on error", p. 234-242 — doc
- [Spring Batch Reference — Retry (6.0: now uses Spring Framework core retry)](https://docs.spring.io/spring-batch/reference/retry.html) — doc
- [Spring Framework Reference — Resilience Features (@Retryable, RetryTemplate, RetryPolicy)](https://docs.spring.io/spring-framework/reference/core/resilience.html) — doc
- [Spring Framework API — org.springframework.core.retry.RetryPolicy](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/retry/RetryPolicy.html) — doc
- [Spring Retry project (org.springframework.retry)](https://github.com/spring-projects/spring-retry) — doc
- [Spring Batch 6.0 Migration Guide (deprecated FaultTolerantStepBuilder / batch: namespace)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
