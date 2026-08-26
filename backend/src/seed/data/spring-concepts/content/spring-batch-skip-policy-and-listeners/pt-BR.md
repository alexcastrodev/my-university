---
version: 1.0
updatedAt: 2026-08-06
title: "Spring Batch Pulando em Vez de Falhar: SkipPolicy e SkipListener"
---
## Objective

Nem todo erro deveria abortar um job. Quando o job de importação de produtos lê dezenas de milhares de linhas de um arquivo flat, algumas poucas linhas mal formatadas não deveriam custar todo insert e update da execução. Skipping diz ao Spring Batch quais exceptions tolerar — o item é excluído, contado como um *skip*, e o processamento continua — uma decisão de negócio tomada na configuração, não no código.

Um skip é fault tolerance *orientada a exception* — diferente de um *filter* (um `ItemProcessor` retornando `null`; veja `spring-batch-filtering-and-validating-items`) — e se comporta de forma diferente para read, process, e write. Esta entrada aprofunda no pilar de skip dos "jobs à prova de balas" do capítulo 8; retry e restart são irmãos separados (`spring-batch-retry-policy-and-retrytemplate`, `spring-batch-restart-and-recovery`). Os atributos declarativos `skip-limit` / `skippable-exception-classes` vivem em `spring-batch-fault-tolerant-step-configuration`; aqui vamos mais fundo na *semântica* de skip por fase, no objeto `SkipPolicy`, e no `SkipListener`.

## Use Cases

- Carregar um arquivo flat onde um punhado de linhas malformadas (`FlatFileParseException`) não deveria falhar o job inteiro — pular as linhas ruins para que as boas ainda sejam importadas.
- Distinguir ruído tolerável de entrada corrompida: pular até um limite, depois falhar além dele para que um operador valide o arquivo e reinicie.
- Registrar cada registro pulado numa tabela ou arquivo dead-letter (via um `SkipListener`) para que possa ser corrigido e reimportado depois.
- Assumir controle programático total — "pule esta exception não importa a contagem" — com um `SkipPolicy` customizado quando um limite declarativo não é expressivo o bastante.
- Saber quando *não* pular: um arquivo ausente ou uma falha de I/O (`NonTransientResourceException`) é fatal e deveria abortar o step.

## Deep Dive

### Skip vs. fail vs. filter — três resultados diferentes

Um step chunk-oriented tem três formas não intercambiáveis de um item falhar em chegar ao writer:

- **Fail** — o default: qualquer exception do reader/processor/writer aborta o step.
- **Skip** — uma exception que você *declarou skippable* é lançada; o item é excluído, a contagem de skip incrementa, e o processamento continua até que o skip limit seja excedido. Orientado a exception.
- **Filter** — o `ItemProcessor` retorna `null`; o item é deliberadamente descartado como decisão de negócio, contado como um *filter* (não um skip), sem exception e sem rollback (veja `spring-batch-filtering-and-validating-items`).

Regra prática: **pule** (skip) uma falha técnica/malformada que você *não consegue* processar, **filtre** um item válido que você *escolhe* excluir, e deixe um erro **fatal** (arquivo ausente, I/O) abortar. Habilitar skip é só nomear exceptions e um `skip-limit`; a sutileza específica de skip é a hierarquia de exceptions:

```xml
<skippable-exception-classes>
  <include class="org.springframework.batch.item.ItemReaderException"/>
  <exclude class="org.springframework.batch.item.NonTransientResourceException"/>
</skippable-exception-classes>
```

`include` pula uma exception *e todas as suas subclasses*; `exclude` recorta uma subhierarquia de volta (pule um erro de parsing como `FlatFileParseException`, mantenha fatal uma `NonTransientResourceException` de I/O). O conjunto completo de atributos e seus equivalentes em builder vivem em `spring-batch-fault-tolerant-step-configuration`.

### Read-skip, process-skip, write-skip — o chunk conduz cada um de forma diferente

*Onde* a exception é lançada decide quanto trabalho o Spring Batch precisa refazer:

- **Read-skip** — o reader lança. O Spring Batch simplesmente chama `read()` de novo para o próximo item. **Sem rollback**; o chunk em progresso fica intocado. O mais barato.
- **Process-skip** — o processor lança. O Spring Batch **faz rollback da transação do chunk**, relê os itens em cache, e os resubmete ao processor *exceto* o que falhou.
- **Write-skip** — o writer lança. O writer recebeu o chunk inteiro como uma `List`, então o framework **não consegue saber qual item falhou**: ele faz rollback, e então reproduz o chunk **um item por vez, cada um em sua própria transação**, para isolar o culpado — os itens bons comitam individualmente, o ruim é pulado. Ele *não* relê; um cache com escopo no chunk guarda os itens.

A consequência é um penhasco de throughput: um único write-skip degrada aquele chunk para um `commit-interval` efetivo de 1, então uma alta taxa de write-skip colapsa o throughput — melhor capturar o problema mais cedo (validar/filtrar, ou um skip de read/process). Quais exceptions fazem rollback ou não é ajustado com `no-rollback-exception-classes` (veja `spring-batch-fault-tolerant-step-configuration`).

### Um SkipPolicy customizado para controle além de um limite

Quando você usa `skippable-exception-classes`, o Spring Batch instala um `LimitCheckingItemSkipPolicy` default (pula por tipo de exception *e* contagem corrente de skips). Quando isso não basta — por exemplo, pular uma dada exception independente da contagem — implemente `SkipPolicy` você mesmo:

```java
import org.springframework.batch.core.step.skip.SkipLimitExceededException;
import org.springframework.batch.core.step.skip.SkipPolicy;

public class ExceptionSkipPolicy implements SkipPolicy {
    private final Class<? extends Exception> exceptionClassToSkip;

    public ExceptionSkipPolicy(Class<? extends Exception> exceptionClassToSkip) {
        this.exceptionClassToSkip = exceptionClassToSkip;
    }

    @Override
    public boolean shouldSkip(Throwable t, int skipCount) throws SkipLimitExceededException {
        return exceptionClassToSkip.isAssignableFrom(t.getClass());
    }
}
```

`shouldSkip` retorna `true` para pular, `false` para falhar; este ignora `skipCount`, pulando seu alvo sem limite. Ligue-o via `skip-policy` (XML) ou `.skipPolicy(...)` (Java); uma vez definido, `skip-limit` e `skippable-exception-classes` *não têm efeito nenhum* — a policy é dona da decisão. As policies prontas em `org.springframework.batch.core.step.skip` são `LimitCheckingItemSkipPolicy` (default), `ExceptionClassifierSkipPolicy`, `AlwaysSkipItemSkipPolicy`, e `NeverSkipItemSkipPolicy`.

### SkipListener — registrando e mandando itens pulados para dead-letter

Pular sem registrar perde dados silenciosamente. `SkipListener` dá um callback por fase, casando com as três semânticas acima:

```java
public interface SkipListener<T, S> extends StepListener {
    void onSkipInRead(Throwable t);
    void onSkipInProcess(T item, Throwable t);
    void onSkipInWrite(S item, Throwable t);
}
```

O livro registra cada linha pulada via a forma com annotation (sem precisar de interface — sobrescreva só a fase que você usa):

```java
public class DatabaseSkipListener {
    private final JdbcTemplate jdbcTemplate;
    public DatabaseSkipListener(DataSource ds) { this.jdbcTemplate = new JdbcTemplate(ds); }

    @OnSkipInRead
    public void log(Throwable t) {
        if (t instanceof FlatFileParseException ffpe) {
            jdbcTemplate.update("insert into skipped_product (line, line_number) values (?, ?)",
                ffpe.getInput(), ffpe.getLineNumber());
        }
    }
}
```

O registro usa o elemento genérico `<listener>`, que detecta automaticamente o tipo do listener (veja `spring-batch-execution-listeners`). Uma sutileza de timing: o Spring Batch **adia as chamadas do skip listener até imediatamente antes do commit do chunk**, não no momento em que a exception é lançada — então, se uma fase posterior no mesmo chunk fizer rollback, você não terá registrado um skip que acabou desfeito.

### Livro vs. hoje: SkipPolicy/SkipListener persistem, mas pacotes e o builder mudaram

- `.faultTolerant()` no step builder ainda liga skip/retry (configuração Java; o namespace XML `batch:` está deprecated desde a 6.0).
- **`SkipPolicy`** ainda é uma `@FunctionalInterface` em `org.springframework.batch.core.step.skip`, mas `shouldSkip` ampliou sua contagem de `int` (livro) para `long`: `shouldSkip(Throwable t, long skipCount)`. As implementações acima continuam vindo prontas, acompanhadas de `LimitCheckingExceptionHierarchySkipPolicy`.
- **`SkipListener`** mantém os mesmos três métodos, mas moveu de `org.springframework.batch.core` para `org.springframework.batch.core.listener` e agora declara métodos *default* no-op — então `SkipListenerSupport` foi removido na 6.0 (implemente a interface diretamente, sobrescrevendo só o que você precisa). As annotations `@OnSkipInRead`/`@OnSkipInProcess`/`@OnSkipInWrite` permanecem inalteradas em `org.springframework.batch.core.annotation`.
- As exceptions puladas também mudaram de lugar: `FlatFileParseException` agora é `org.springframework.batch.infrastructure.item.file.FlatFileParseException` (infraestrutura de item realocada sob `org.springframework.batch.infrastructure.*`).
- Os atributos declarativos e a reformulação do builder de policy objects na 6.0 (`ChunkOrientedStepBuilder`) vivem em `spring-batch-fault-tolerant-step-configuration` — não repetidos aqui.

Confirmado pelo Javadoc de `SkipPolicy`/`SkipListener` do Spring Batch 6.0.4, pela referência "Configuring Skip Logic", e pelo Guia de Migração do Spring Batch 6.0.

## Trade-offs

- **Skip vs. filter não é uma questão de estilo.** Pule uma falha *malformada ou técnica* que você não consegue processar; filtre (`ItemProcessor` retornando `null`) um item *válido mas excluído*. Trocar os dois registra exclusões rotineiras como erros, ou esconde falhas reais como filters silenciosos.
- **Write-skips são caros.** O framework não consegue saber qual item numa escrita em lote falhou, então um item ruim força um rollback e um replay item por item do chunk — efetivamente `commit-interval` = 1 ali. Mantenha exceptions de *write* skippable raras.
- **O skip limit é impreciso.** Alto demais mascara uma entrada corrompida importando lixo; baixo demais aborta em ruído comum. Um `SkipPolicy` customizado codifica regras mais ricas, mas então o framework para de aplicar `skip-limit` — você é dono do limite.
- **O timing do listener corta dos dois lados.** Callbacks disparam imediatamente antes do commit do chunk, então um listener que escreve no *mesmo* armazenamento transacional do chunk sofre rollback junto com ele; mande para dead-letter num recurso separado para sobreviver a uma falha posterior.
- **Skipping descarta dados silenciosamente a menos que você escute.** Sem um `SkipListener` (ou um log), um item pulado simplesmente desaparece — sempre combine uma skip policy com um listener, para que "o job não travou" não vire "e ninguém sabe o que foi perdido."

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 8, "Implementing bulletproof jobs", sections 8.1-8.2, "What is a bulletproof job?" / "Skipping instead of failing", p. 223-234 — doc
- [Spring Batch API — SkipPolicy (org.springframework.batch.core.step.skip)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/step/skip/SkipPolicy.html) — doc
- [Spring Batch API — SkipListener (org.springframework.batch.core.listener)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/listener/SkipListener.html) — doc
- [Spring Batch Reference — Configuring Skip Logic](https://docs.spring.io/spring-batch/reference/step/chunk-oriented-processing/configuring-skip.html) — doc
- [Spring Batch 6.0 Migration Guide (package relocations)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
