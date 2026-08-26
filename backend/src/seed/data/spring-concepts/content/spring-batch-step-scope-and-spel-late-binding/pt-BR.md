---
version: 1.0
updatedAt: 2026-08-03
title: Step Scope e Late Binding com SpEL no Spring Batch
---
## Objective

A maioria dos beans do Spring é construída uma única vez, na inicialização
da aplicação, a partir de valores conhecidos em tempo de configuração. Um
job batch quebra essa suposição de propósito: o nome do arquivo de entrada,
um intervalo de datas, ou qualquer outro parâmetro de execução só é
conhecido quando o job de fato começa — às vezes só quando um *step*
específico dentro dele começa. O bean scope `StepScope` do Spring Batch
adia a instanciação de um bean até o step correspondente começar, e,
combinado com a Spring Expression Language (SpEL), esse instante adiado
também é o momento em que as propriedades de um bean podem ser preenchidas
a partir do contexto de execução daquele step — sem nome de arquivo
codificado na configuração, sem encanamento customizado para repassar
parâmetros de execução até um reader ou writer.

## Use Cases

- Configurar um step de leitura de arquivo (`FlatFileItemReader`, um
  `Tasklet` customizado) cujo caminho do arquivo de entrada é fornecido como
  um parâmetro de job na hora da execução, em vez de embutido na
  configuração do Spring.
- Compartilhar um valor calculado por um step anterior (escrito no contexto
  de execução do step ou do job) com o reader, writer ou tasklet de um step
  posterior, sem introduzir um canal separado para repassá-lo.
- Rodar a mesma definição de step para datas, regiões ou execuções de batch
  diferentes, parametrizando na hora da execução em vez de duplicar a
  configuração para cada variante.

## Deep Dive

### `StepScope`: um bean scope customizado atrelado ao ciclo de vida do step

O Spring suporta bean scopes customizados e conectáveis desde a versão 2 —
os scopes embutidos `singleton`/`prototype`/`request`/`session` ganham
companhia de qualquer implementação registrada via `CustomScopeConfigurer`.
O Spring Batch fornece um desses scopes, o `StepScope`, cujo propósito
inteiro é ligar o ciclo de vida de um bean a um step específico: um bean
step-scoped só é instanciado quando o step correspondente de fato começa,
não quando o container Spring ao redor sobe.

```java
@Bean
@StepScope
public FlatFileItemReader<Foo> flatFileItemReader(
        @Value("#{jobParameters['input.file.name']}") String name) {
    return new FlatFileItemReaderBuilder<Foo>()
            .name("flatFileItemReader")
            .resource(new FileSystemResource(name))
            .build();
}
```

`StepScope` não é registrado por padrão — a documentação de referência
atual do Spring Batch é explícita ao dizer que ele deve ser adicionado por
uma (e somente uma) de três vias: `@EnableBatchProcessing`, uma definição
explícita de bean `StepScope`, ou o namespace XML legado `batch`. O
equivalente da era XML do livro registra o mesmo scope como um bean:

```xml
<bean class="org.springframework.batch.core.scope.StepScope"/>
```

e marca um bean como step-scoped com um atributo `scope` simples:

```xml
<bean id="decompressTasklet"
      class="com.manning.sbia.ch01.batch.DecompressTasklet"
      scope="step">
  <property name="inputResource"
            value="#{jobParameters['inputResource']}" />
  <property name="targetDirectory"
            value="#{jobParameters['targetDirectory']}" />
  <property name="targetFile"
            value="#{jobParameters['targetFile']}" />
</bean>
```

As duas formas fazem a mesma coisa: nada em `decompressTasklet`/
`flatFileItemReader` pode ser resolvido até o step ao qual pertence de fato
começar, porque seus valores de propriedade são expressões SpEL, não
literais.

### Late binding com SpEL: três contextos que um bean step-scoped pode ler

A Spring Expression Language (SpEL), introduzida no Spring 3, é uma
linguagem de expressão geral utilizável em qualquer lugar do portfólio
Spring — não algo que o Spring Batch inventou, apenas algo em que ele se
apoia bastante aqui. As propriedades de um bean step-scoped podem
referenciar qualquer um dos três contextos via placeholders `#{...}`:

| Contexto | Descrição |
|---|---|
| `jobParameters` | Parâmetros fornecidos quando o job foi executado |
| `jobExecutionContext` | O contexto de execução compartilhado do job atual |
| `stepExecutionContext` | O próprio contexto de execução do step atual |

`jobParameters` é um map, indexado por chave: `#{jobParameters['inputResource']}`
resolve o parâmetro `inputResource` exatamente como foi passado na
execução. Os outros dois funcionam da mesma forma contra quaisquer pares
chave/valor que um step anterior (ou o próprio job) tenha escolhido
registrar — o que é como um step repassa um valor calculado para outro
posterior sem um canal customizado.

### Por que isso importa: parametrizar sem codificar valores fixos

O ganho concreto, segundo o próprio estudo de caso do livro: um step de
importação de produtos precisa saber qual arquivo ler, mas esse arquivo
muda a cada execução. Sem step scope e SpEL, o nome do arquivo seria
codificado por ambiente (quebrando assim que o arquivo mudasse) ou repassado
manualmente. Com step scope, os parâmetros do job launcher fluem direto
para a configuração do reader no momento em que o step começa — a
configuração expressa "ler de qualquer arquivo que quem chama especificar",
não "ler de `/data/import.csv`".

## Trade-offs

- **Step scope só adia a instanciação para o início do step — não faz um
  bean se reinstanciar por item ou por chunk.** Ele resolve "eu não sei esse
  valor até o step começar", não "eu preciso de uma instância nova por
  unidade de trabalho"; confundir os dois leva a recorrer a step scope
  quando um mecanismo diferente (como um reset de proxy escopado entre
  steps, ou gerenciamento de estado explícito) é o que de fato é
  necessário.
- **Uma expressão SpEL referenciando um parâmetro de job que nunca foi
  fornecido na execução falha no início do step, não em tempo de
  configuração.** Todo o benefício do late binding — adiar a resolução para
  runtime — também é seu custo: um typo numa chave de parâmetro de job
  (`#{jobParameters['inputResourc']}`) compila sem problema e só aparece
  quando o step de fato tenta rodar.
- **`StepScope` deve ser registrado exatamente uma vez, por exatamente um
  de três mecanismos.** A documentação de referência atual é explícita ao
  dizer que misturar vias (ex.: um bean `StepScope` explícito *e*
  `@EnableBatchProcessing`) não é o uso pretendido — escolha um e seja
  consistente, em vez de assumir que registrá-lo duas vezes é só
  redundante.
- **Book vs. today: o estilo principal de configuração migrou de XML
  `scope="step"` para `@StepScope`+`@Bean` em configuração Java**, seguindo
  a mesma mudança documentada em outros pontos deste workflow
  (`<batch:job-repository>` → `@EnableJdbcJobRepository`, vocabulário XML de
  job → `JobBuilder`/`StepBuilder`). A forma XML do livro (`scope="step"`
  num `<bean>`, `<property value="#{jobParameters['x']}"/>`) ainda funciona
  conceitualmente — as expressões SpEL e os três contextos disponíveis
  (`jobParameters`/`jobExecutionContext`/`stepExecutionContext`) estão
  inalterados — mas o próprio namespace XML de batch está depreciado desde
  o Spring Batch 6.0, com remoção planejada para a 7.0, a mesma migração já
  observada para o vocabulário job/step/chunk nos outros conceitos de
  Spring Batch deste workflow.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", sections 3.4.1-3.4.2, p. 75-78 — doc
- [Spring Batch Reference — Late Binding of Job and Step Attributes](https://docs.spring.io/spring-batch/reference/step/late-binding.html) — doc
- [Spring Batch API — StepScope](https://docs.spring.io/spring-batch/docs/current/api/org/springframework/batch/core/scope/StepScope.html) — doc
- [Spring Batch 6.0 Migration Guide — XML namespace deprecation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
