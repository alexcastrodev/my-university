---
version: 1.0
updatedAt: 2026-08-06
title: Compartilhando Dados Entre Steps e Externalizando Flows no Spring Batch
---
## Objective

Todo step de um job do Spring Batch é uma unidade de trabalho isolada — sua própria
transação, seu próprio escopo, seu próprio `ExecutionContext`. Esse isolamento é o que
torna um step independentemente reiniciável, mas também significa que um step não
consegue passar um valor para o próximo através de um campo compartilhado: uma
variável comum em memória nunca é gravada nos metadados do batch, então ela some
quando um job reinicia e retoma em um step posterior. Quando um step de cálculo
precisa alimentar um step receptor (o `verify` step do livro extrai um `importId`
que um `track` step posterior persiste), você precisa de um mecanismo que ou
sobrevive a um restart ou que você aceita conscientemente que não vai sobreviver.
O Capítulo 10 oferece dois — o `ExecutionContext` persistido e as **holder beans**
do Spring — separados exatamente por isso: segurança de restart.

O capítulo então muda de dados para configuração: **externalizar um flow** para que
vários jobs reutilizem uma mesma sequência de steps, e **parar um job
declarativamente** de dentro do flow (`end`/`fail`/`stop`). Ler um valor promovido
declarativamente é `@StepScope` + late binding com SpEL
(`spring-batch-step-scope-and-spel-late-binding`); dirigir uma transição a partir de
um exit status é `spring-batch-controlling-flow-and-exit-status`; parar uma execução
*em andamento* cooperativamente é `spring-batch-stopping-jobs-gracefully`. Este
artigo cobre mover dados entre steps e reutilizar/parar o flow ao redor disso.

## Use Cases

- Um step `verify` calcula um ID de importação (ou digest, contagem de linhas) que
  um step posterior precisa, e você precisa passá-lo adiante sem um canal paralelo
  no banco de dados — e ele precisa sobreviver a um restart.
- Escolher compartilhamento seguro para restart (execution context) em vez de um
  valor descartável (holder bean) quando o dado não pode ser recalculado a baixo custo.
- Reutilizar um flow genérico de *download → descompressão → verificação* em vários
  jobs (importar produtos, importar faturas) em vez de duplicar definições de step.
- Encerrar um job de forma limpa após um step a partir de um exit status customizado
  — "sem arquivo hoje" completa, qualquer coisa inesperada falha — em vez de forçar
  todo caminho a passar pelo último step.
- Parar em um step de checkpoint para intervenção do operador, depois reiniciar para
  retomar em um step nomeado.

## Deep Dive

### Por que uma variável compartilhada não funciona: o `ExecutionContext` do step vs. do job

O Spring Batch mantém dois contextos, ambos `ExecutionContext` (um armazenamento
persistido, tipo mapa): um contexto de **step**, privado a um único step, e um
contexto de **job**, visível para todo step. Ambos são gravados nos metadados do
batch, o que é o que os torna seguros para restart. O timing importa: o contexto do
step é gravado a cada **commit de chunk**, o contexto do job **só no fim do step** —
então um writer no meio do step deve usar o contexto do step para ficar seguro caso o
step falhe mais tarde. Um tasklet que grava uma vez e retorna pode alcançar o
contexto do job através do chunk context (um caminho real, mas não óbvio):

```java
ExecutionContext jobContext = chunkContext.getStepContext()
        .getStepExecution().getJobExecution().getExecutionContext();
jobContext.putString("importId", metadata.getImportId());  // read back: getString("importId")
```

Isso funciona, mas acopla fortemente os dois steps ao runtime e à chave
`"importId"`. O contexto do job é global, então prefixe as chaves
(`com.acme.importId`) para evitar colisões.

### Promovendo uma chave com `ExecutionContextPromotionListener`

A técnica mais frouxa e preferida separa a responsabilidade: o step que grava coloca
os dados no seu **próprio** contexto de step, e um listener promove chaves
selecionadas para o contexto do job ao fim do step — tornando a exposição uma
escolha de configuração, não um acoplamento fixo no código. O tasklet que grava
mira o contexto do step:

```java
ExecutionContext stepContext = chunkContext.getStepContext()
        .getStepExecution().getExecutionContext();
stepContext.putString("importId", metadata.getImportId());
```

`ExecutionContextPromotionListener` é um step listener (veja
`spring-batch-execution-listeners`), configurado com os nomes das chaves (e
opcionalmente os exit statuses em que promover — `COMPLETED` por padrão):

```xml
<bean id="promotionListener"
      class="org.springframework.batch.core.listener.ExecutionContextPromotionListener">
  <property name="keys" value="importId" />
</bean>
<step id="verifyStep" next="readWriteStep">
  <tasklet ref="verifyTasklet">
    <listeners><listener ref="promotionListener" /></listeners>
  </tasklet>
</step>
```

O step receptor lê a partir do contexto do job — o mais limpo é `@StepScope` +
late binding `#{jobExecutionContext['importId']}`, cuja mecânica vive em
`spring-batch-step-scope-and-spel-late-binding`. Como a cadeia depende do contexto
persistido, ela é **segura para restart**: o valor promovido recarrega ao retomar.

### Holder beans: mais simples, mas não seguras para restart

A alternativa orientada a Spring pula o execution context: um bean compartilhado
mantém o valor, injetado em ambos os steps. É simples e type-safe (sem chaves de
string):

```java
public class ImportMetadataHolder {
    private ImportMetadata importMetadata;
    public ImportMetadata get() { return importMetadata; }
    public void set(ImportMetadata m) { this.importMetadata = m; }
}
```

A pegadinha: uma holder é um bean comum, então **seu estado nunca é persistido e se
perde no restart**, e em um container compartilhado ela pode vazar estado entre
instâncias de job (limpe-a quando o job terminar). Use uma holder apenas quando
segurança de restart não importa.

### Externalizando um flow para reuso: beans `Flow` e `FlowStep`

Compartilhar *configuração* espelha compartilhar *dados*. Uma sequência genérica de
*download → descompressão → verificação* é útil para vários jobs, então defina-a uma
vez e referencie-a. O `<flow>` XML do livro:

```xml
<flow id="prepareInputFileFlow">
  <step id="downloadStep"   next="decompressStep"><tasklet ref="downloadTasklet"/></step>
  <step id="decompressStep" next="verifyStep"><tasklet ref="decompressTasklet"/></step>
  <step id="verifyStep"><tasklet ref="verifyTasklet"/></step>
</flow>
<job id="importProductsJob">
  <flow parent="prepareInputFileFlow" id="importProducts.prepare" next="readWriteStep"/>
  <step id="readWriteStep" next="trackImportStep"><tasklet>(...)</tasklet></step>
</job>
```

Referenciar um flow insere seus steps inline. Uma opção relacionada envolve a
unidade como um `FlowStep` (executa um flow) ou um `JobStep` (dispara uma execução
de job inteira e separada, com um `JobParametersExtractor` selecionando os
parâmetros do sub-job). Ramificação de flow por exit status é
`spring-batch-controlling-flow-and-exit-status`.

### Parada dirigida por flow: `end`, `fail` e `stopAndRestart`

Por padrão um job termina no seu último step, falha em uma exceção, ou para em uma
interrupção. Mas o resultado de um step nem sempre é o resultado do job — "sem
arquivo hoje" pode significar *completo*, não *falha*. Três elementos de transição
definem o `BatchStatus` final do job depois de um step, casados com o exit status do
step via `on`:

```xml
<step id="downloadStep">
  <tasklet ref="downloadTasklet">
    <listeners><listener ref="fileExistsStepListener" /></listeners>
  </tasklet>
  <end  on="NO FILE" />
  <next on="FILE EXISTS" to="decompressStep" />
  <fail on="*" />
</step>
```

- `end` → `COMPLETED`, instância **não** reiniciável.
- `fail` → `FAILED`, instância reiniciável.
- `stop` → `STOPPED`, exige um step de `restart` para retomar.

Essa parada declarativa dirigida por flow é distinta da parada cooperativa em
*runtime* (`JobOperator.stop` / `setTerminateOnly`) em
`spring-batch-stopping-jobs-gracefully`; a semântica de restart se conecta a
`spring-batch-job-instance-execution-flow`.

### Livro vs. hoje: `ExecutionContext` de item mudou de lugar; flows e paradas são Java builders

Os conceitos permanecem inalterados; a superfície mudou com a configuração Java e a
reorganização de pacotes do Spring Batch 6.0:

- **`ExecutionContextPromotionListener` não mudou de lugar** — continua
  `org.springframework.batch.core.listener.ExecutionContextPromotionListener`,
  configurado com `setKeys(new String[]{"importId"})` e registrado via
  `StepBuilder.listener(...)`.
- **O `ExecutionContext` de item mudou de lugar**:
  `org.springframework.batch.item.ExecutionContext` (o import do livro, listagem
  10.7) agora é `org.springframework.batch.infrastructure.item.ExecutionContext`;
  sua API (`putString`/`getString`, os dois contextos) é idêntica.
- **`@StepScope` + late binding `#{jobExecutionContext['importId']}` não mudou.**
- **Flows externalizados são Java builders** — `<flow>` vira um `Flow` de
  `FlowBuilder`:
  ```java
  @Bean
  public Flow prepareInputFileFlow(Step download, Step decompress, Step verify) {
      return new FlowBuilder<SimpleFlow>("prepareInputFileFlow")
              .start(download).next(decompress).next(verify).build();
  }
  // JobBuilder(...).start(prepareInputFileFlow).next(readWriteStep).end().build();
  ```
- **Paradas de flow são chamadas de builder**: `<end>`/`<fail>`/`<stop>` viram
  `.on("NO FILE").end()`, `.on("*").fail()`,
  `.on("COMPLETED").stopAndRestart(step2)`.
- **O namespace XML `batch:` está deprecated desde a 6.0** (remoção prevista para a
  7.0), então o XML acima é legado; código novo usa os builders.

Confirmado pela API do Spring Batch 6.0.x (`ExecutionContextPromotionListener` em
`...core.listener`, `ExecutionContext` agora em `...infrastructure.item`), pela
referência do Spring Batch ("Passing Data to Future Steps", "Controlling Step
Flow") e pelo guia de migração do Spring Batch 6.0.

## Trade-offs

- **Execution context vs. holder — quem decide é a persistência.** O execution
  context é persistido, então um valor promovido recarrega no restart; uma holder é
  um bean comum cujo estado se perde no restart e pode vazar entre instâncias em um
  container compartilhado. Use uma holder só quando segurança de restart for
  irrelevante.
- **Promoção desacopla; escritas diretas no contexto do job acoplam.** Escrever
  direto no contexto do job amarra os dois steps ao runtime e a uma chave
  compartilhada; o listener confina os dados ao step que grava e transforma a
  exposição em uma escolha de configuração de uma linha.
- **O contexto do job é global, então as chaves colidem.** Qualquer artefato pode
  sobrescrevê-lo — prefixe as chaves (reverse-DNS `com.acme.importId`).
- **Compartilhar dados acopla steps — trate como fallback.** O aviso do livro:
  prefira steps independentes (por exemplo, derive entradas a partir de parâmetros
  do job); compartilhe apenas quando um step realmente não conseguir calcular suas
  próprias entradas.
- **`FlowStep` vs `JobStep`, e `end` vs `fail` vs `stopAndRestart`.** Um `FlowStep`
  embute um flow na mesma execução; um `JobStep` dispara uma execução filha separada
  com seus próprios metadados. `end` completa e bloqueia restart; `fail` continua
  reiniciável; `stopAndRestart` precisa nomear o step de retomada — errar isso
  transforma uma pausa recuperável em um `COMPLETED` sem saída.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 10, "Controlling execution", sections 10.3-10.5, "Sharing data between steps" / "Externalizing flow definitions" / "Stopping a job execution", p. 287-304 — doc
- [Spring Batch Reference — Passing Data to Future Steps (`ExecutionContext`, `ExecutionContextPromotionListener`)](https://docs.spring.io/spring-batch/reference/common-patterns.html) — doc
- [Spring Batch Reference — Late Binding of Job and Step Attributes (`@StepScope`, `#{jobExecutionContext[...]}`)](https://docs.spring.io/spring-batch/reference/step/late-binding.html) — doc
- [Spring Batch Reference — Controlling Step Flow (externalizing flows, `FlowStep`/`JobStep`, `end`/`fail`/`stop`)](https://docs.spring.io/spring-batch/reference/step/controlling-flow.html) — doc
- [Spring Batch API — `ExecutionContextPromotionListener` (`org.springframework.batch.core.listener`)](https://docs.spring.io/spring-batch/docs/current/api/org/springframework/batch/core/listener/ExecutionContextPromotionListener.html) — doc
- [Spring Batch 6.0 Migration Guide (XML namespace deprecation; `ExecutionContext` → `org.springframework.batch.infrastructure.item`)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
