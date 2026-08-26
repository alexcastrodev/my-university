---
version: 1.0
updatedAt: 2026-08-05
title: Lançando Jobs do Spring Batch a Partir da Linha de Comando
---
## Objective

`JobLauncher`/`JobOperator` dá a você uma API para rodar um bean `Job` a
partir de Java, mas um processo batch noturno disparado por `cron` não tem um
Spring context em execução por perto para chamar essa API — ele precisa
disparar uma JVM totalmente nova, inicializar o Spring, rodar o job, e sair
com um código de status que o scheduler consiga ler. `CommandLineJobRunner` é
a classe nativa do Spring Batch para exatamente isso: um método `main` que
transforma argumentos de `java -classpath ...` numa busca de Spring context,
um nome de job, job parameters tipados, e — na saída — um código de saída do
sistema que o scheduler que disparou tudo pode usar. Este conceito cobre
especificamente esse ponto de entrada de linha de comando; a API de launcher
que ele chama por baixo (`JobLauncher`/`JobOperator.run(Job, JobParameters)`,
execução síncrona vs. assíncrona) é coberta em
`spring-batch-job-launcher-api-and-async-launching`.

## Use Cases

- Um job de `cron` (ou qualquer scheduler externo) que precisa invocar um job
  do Spring Batch como um processo de SO independente, sem nenhum container
  web ou aplicação de longa vida já em execução.
- Um processo batch onde o *próximo* job a rodar depende de como o *anterior*
  saiu — encadear job A → job B ou job A → job C com base num código de saída
  em nível de shell em vez de uma condição in-process.
- Passar job parameters (caminho do arquivo de entrada, data de execução,
  limites) a partir do shell script ou entrada de scheduler que invoca,
  preservando o tipo Java do parâmetro (string, date, long, double) em vez de
  colapsá-lo para string.

## Deep Dive

### Empacotamento: o que precisa estar no classpath

Antes que `CommandLineJobRunner` possa rodar qualquer coisa, a JVM precisa
encontrá-lo, à configuração do job, e a toda dependência no classpath. A
receita do livro: empacotar a aplicação (configuração do job, readers/writers
customizados, DAOs) como um JAR com `mvn package`, reunir todas as
dependências num diretório `lib/` com `mvn dependency:copy-dependencies`, e
então apontar o `-classpath` para ambos:

```bash
java -classpath "./lib/*" \
  org.springframework.batch.core.launch.support.CommandLineJobRunner \
  import-products-job.xml importProductsJob
```

O primeiro argumento é o arquivo de configuração Spring (um arquivo XML no
classpath por padrão — um prefixo de recurso `file:` sobrescreve isso para
ler do sistema de arquivos em vez disso); o segundo é o nome do bean do job.

### Configurações do `CommandLineJobRunner`

| Configuração | Descrição |
|---|---|
| Arquivo de configuração Spring | Configura a infraestrutura do Spring Batch, o job, e seus componentes (data source, readers, writers) |
| Job | O nome do job a executar (um nome de bean Spring) |
| Job parameters | Os parâmetros passados para o job launcher |
| Mapeamento de exit code | Estratégia que mapeia o status de saída do job para um status de saída do sistema |

### Passando job parameters, com tipos

Anexar pares `nome=valor` depois do nome do job passa job parameters — sem
tipo, o default é `String`:

```bash
java -classpath "./lib/*" \
  org.springframework.batch.core.launch.support.CommandLineJobRunner \
  import-products-job.xml importProductsJob \
  inputFile=file:./products.txt date=2010/12/08
```

`nome(tipo)=valor` escolhe um tipo Java real em vez de `String` — relevante
porque job parameters também determinam a identidade de `JobInstance`
(coberto junto com a API de launcher), então um parâmetro `date` tipado como
`Date` em vez de `String` se comporta corretamente onde quer que essa
checagem de identidade compare valores por tipo:

```bash
java -classpath "./lib/*" \
  org.springframework.batch.core.launch.support.CommandLineJobRunner \
  import-products-job.xml importProductsJob \
  inputFile=file:./products.txt date(date)=2010/12/08
```

| Tipo | Tipo Java | Exemplo |
|---|---|---|
| String | `java.lang.String` | `inputFile(string)=products.txt` |
| Date | `java.util.Date` | `date(date)=2010/12/08` |
| Long | `Long` | `timeout(long)=1000` |
| Double | `Double` | `delta(double)=20.1` |

### Mapeando o status de saída de um job para um código de saída do sistema

Um job lançado termina com um `ExitStatus` (uma string, ex.: `COMPLETED` ou
`FAILED`) — não confundir com `BatchStatus` (um enum). Algo precisa
transformar essa string no inteiro que um shell ou scheduler entende, e esse
algo é um `ExitCodeMapper`:

```java
public interface ExitCodeMapper {
    int intValue(String exitCode);
}
```

A implementação padrão do `CommandLineJobRunner`, `SimpleJvmExitCodeMapper`:

| Código de saída do sistema | Status de saída do job |
|---|---|
| 0 | `COMPLETED` |
| 1 | `FAILED` |
| 2 | Erro em nível de runner (por exemplo, o job nomeado não foi encontrado no context) |

Para conduzir uma decisão de sequenciamento mais específica — digamos,
distinguir "completou de forma limpa" de "completou mas pulou alguns itens" —
escreva um `ExitCodeMapper` customizado e o declare como bean no Spring
context do job; o runner o pega automaticamente, sem wiring extra:

```java
package com.manning.sbia.ch04;

public class SkippedAwareExitCodeMapper implements ExitCodeMapper {
    @Override
    public int intValue(String exitCode) {
        if (ExitStatus.COMPLETED.getExitCode().equals(exitCode)) {
            return 0;
        } else if (ExitStatus.FAILED.getExitCode().equals(exitCode)) {
            return 1;
        } else if ("COMPLETED WITH SKIPS".equals(exitCode)) {
            return 3;
        } else {
            return 2;
        }
    }
}
```

```xml
<bean class="com.manning.sbia.ch04.SkippedAwareExitCodeMapper" />

<job id="importProductsJob"
     xmlns="http://www.springframework.org/schema/batch">
  <!-- ... -->
</job>
```

Um scheduler pode então ramificar com base no código de saída do shell
diretamente: `0` → inicia o job B, `3` → inicia o job C em vez disso, `1`/`2`
→ não faz nada e alerta. Essa é uma forma concreta de o `cron` (ou qualquer
scheduler) conduzir *sequências* de jobs sem a orquestração de
step/flow própria do Spring Batch.

### Livro vs. hoje: `CommandLineJobRunner` está deprecado, substituído por `CommandLineJobOperator`

`CommandLineJobRunner` está deprecado desde o Spring Batch 6.0, com remoção
planejada para 6.2 ou depois. Os motivos declarados pelo time do Spring
Batch: a inicialização estática o tornava inflexível, seu tratamento de
opções/parâmetros não era padrão, era difícil de estender, e — pior na
prática — o Spring Boot tinha sua própria implementação duplicada que se
comportava de forma diferente (por exemplo, comportamento divergente do
incrementer de job-parameter), o que era confuso entre os dois projetos.

Seu substituto, `CommandLineJobOperator`, muda mais que só o nome da classe:

- **O primeiro argumento agora é uma classe Java `@Configuration`, não um
  arquivo XML.** `import-products-job.xml` vira algo como
  `io.spring.ImportProductsJobConfiguration` — consistente com a
  configuração de job baseada em Java substituindo o namespace XML em todo o
  Spring Batch 6 (veja `spring-batch-chunk-processing` para essa mudança
  mais ampla de XML para `JobBuilder`/`StepBuilder`).
- **Ele opera jobs, não só os lança.** Além de `start`, ele suporta
  `startNextInstance`, `stop`, `restart`, `abandon`, e `recover` — espelhando
  o fato de que `JobOperator` (que ele envolve) é um superconjunto de
  `JobLauncher`.
- **A sintaxe de job parameter mudou de formato.** O `nome(tipo)=valor` do
  livro (ex.: `date(date)=2010/12/08`) vira
  `nome=valor,tipo,identifying` com tipos Java totalmente qualificados e uma
  flag identifying explícita:
  ```bash
  java org.springframework.batch.core.launch.support.CommandLineJobOperator \
    io.spring.EndOfDayJobConfiguration start endOfDay \
    schedule.date=2007-05-05,java.time.LocalDate,true \
    vendor.id=123,java.lang.Long,false
  ```
  `java.util.Date` sumiu do vocabulário de tipos em favor de tipos no estilo
  `java.time.LocalDate`, alinhado com a mudança do Spring Batch 6 para
  `java.time` em todo o seu tratamento de parâmetros e metadados.
- **O contrato de exit-code sobrevive quase inalterado.** `ExitCodeMapper`
  continua sendo a interface, `SimpleJvmExitCodeMapper` continua sendo o
  default, e 0/1/2 ainda significam completado/falhou/erro-de-runner — o
  modelo mental do livro de "string de exit status entra, código de saída do
  sistema sai" se transfere diretamente; só a classe que faz o mapeamento
  (`setExitCodeMapper(...)` em `CommandLineJobOperator`) e o vocabulário ao
  redor mudaram.

Confirmado pela documentação de API atual do Spring Batch
(`CommandLineJobOperator`, entrada de `CommandLineJobRunner` na
deprecated-list) e pela documentação de referência do Spring Batch 6 sobre
rodar jobs a partir da linha de comando.

## Trade-offs

- **Uma nova JVM por execução é simples mas paga um custo fixo de startup
  em toda execução.** Inicializar todo o Spring application context — beans,
  `JobRepository`, pool de data source — acontece do zero cada vez que o
  `cron` dispara o comando, o que é tranquilo para um job de hora em hora ou
  mais espaçado e desperdiçador para qualquer coisa aproximando de disparo
  por minuto (o próprio roteiro de capítulo do livro sinaliza "embutir o
  Spring Batch num container em execução" como a alternativa para esse
  caso).
- **Job parameters sem tipo viram `String` silenciosamente, o que pode
  quebrar a identidade de restart.** Esquecer `(date)` num parâmetro de data
  não falha ruidosamente — o job roda — mas duas execuções com a mesma data
  passada como formatos de string diferentes podem ser tratadas como
  `JobInstance`s diferentes, derrubando a garantia de restart idempotente que
  parâmetros identificadores tipados existem para fornecer.
  ```bash
  # These are two different JobInstances to Spring Batch, not the same run:
  date=2010/12/08          # String "2010/12/08"
  date(date)=2010/12/08    # java.util.Date, parsed
  ```
- **Depender de exit codes para sequenciar jobs acopla sua orquestração à
  camada de shell/scheduler.** Funciona bem para uma cadeia pequena e linear
  (o exit code do job A escolhe B ou C), mas conforme o número de ramos
  condicionais cresce, codificar essa lógica em scripts de scheduler ao redor
  de exit codes fica mais difícil de auditar do que expressar o mesmo
  sequenciamento como steps/flows do Spring Batch dentro de um único job.
- **Seguir o comando exato do livro ao pé da letra no Spring Batch atual
  mira silenciosamente numa classe deprecada, prestes a ser removida.**
  `CommandLineJobRunner` ainda roda na 6.0/6.1, mas um código construído
  sobre a invocação do livro hoje já acumula dívida de migração
  imediatamente — o argumento do arquivo de config, a sintaxe do parâmetro, e
  o nome da classe todos precisam mudar para migrar para
  `CommandLineJobOperator`.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 4, "Running batch jobs", section 4.2, "Launching from the command line", p. 92-97 — doc
- [Spring Batch Reference — Running a Job from the Command Line](https://docs.spring.io/spring-batch/reference/job/running.html) — doc
- [Spring Batch API — CommandLineJobOperator](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/launch/support/CommandLineJobOperator.html) — doc
- [Spring Batch API — Deprecated List (CommandLineJobRunner)](https://docs.spring.io/spring-batch/reference/api/deprecated-list.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
