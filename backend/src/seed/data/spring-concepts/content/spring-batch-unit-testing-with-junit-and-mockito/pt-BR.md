---
version: 1.0
updatedAt: 2026-08-06
title: Testes Unitários de Componentes Batch com JUnit e Mockito
---
## Objective

Testar é o processo de estabelecer que o código faz o que deveria fazer, e isso
importa mais para batch do que para a maioria dos softwares: um job batch roda
headless, numa agenda, processando dados sem ninguém observando. Uma aplicação web
que quebra recebe uma ligação em minutos; uma importação noturna que silenciosamente
grava preços errados por uma semana é notada por um contador. Não há UI para notar
uma falha silenciosa, então o único sistema de alerta antecipado é uma suíte de
testes.

O livro enquadra os testes em dois eixos. **Testes black-box** exercitam
funcionalidades de fora, com base em requisitos, sem conhecimento da
implementação. **Testes white-box** trabalham com conhecimento interno do design e
dos algoritmos, e se importam com cobertura de código. Testes unitários e de
integração são white box; testes funcionais, de sistema, de aceitação e de
performance são black box.

Este concept cobre apenas a camada **unitária**: um único componente, testado com
JUnit e Mockito puros, **sem nenhum contexto Spring em lugar nenhum** — sem
`@SpringJUnitConfig`, sem `@SpringBatchTest`, sem `JobRepository`, sem banco de
dados. Um teste unitário deveria endereçar um único ponto de funcionalidade e ser
rápido, legível por humanos, totalmente automático, e isolado de recursos externos
(banco de dados, sistema de arquivos, web service, message broker). A boa notícia é
que artefatos do Spring Batch são testáveis unitariamente por construção:
`ItemReader`, `ItemProcessor`, `ItemWriter`, `Tasklet`, `Validator`,
`JobParametersValidator`, `JobExecutionDecider` e listeners são POJOs
implementando interfaces estreitas, um benefício direto do modelo de programação
POJO. Quando um componente genuinamente precisa de um objeto de domínio do Spring
Batch que não é fácil de construir — um `StepExecution`, um `JobExecution` — o
`spring-batch-test` fornece o `MetaDataInstanceFactory`. Conectar um contexto real,
atingir um banco de dados em memória e lançar jobs inteiros pertence a
*spring-batch-integration-and-functional-testing*.

## Use Cases

- Testar um `Validator` ou `ItemProcessor` como um objeto puro: `new`, alimentá-lo
  com um item, fazer assert do valor retornado ou da `ValidationException`
  lançada — nenhum framework envolvido.
- Testar um `FieldSetMapper` sem tocar num arquivo, seja construindo à mão um
  `DefaultFieldSet` ou mockando `FieldSet` e verificando exatamente quais leituras
  tipadas aconteceram.
- Testar um `ItemWriter` cujo branch de insert-ou-update depende de um valor
  retornado por `JdbcTemplate`, fazendo stub desse valor retornado em vez de
  provisionar um banco de dados.
- Testar um listener que escreve itens rejeitados num arquivo, com o
  `FlatFileItemWriter` mockado para que o teste nunca toque o sistema de
  arquivos.
- Testar um `JobExecutionDecider` ou um `Tasklet` que exige um `StepExecution`,
  `JobExecution`, ou `ChunkContext` — construídos como fixtures com
  `MetaDataInstanceFactory` em vez de lançando um job.
- Conduzir trabalho de cobertura de código: testes unitários são white box, então
  você os escreve por branch (preço positivo / preço zero / preço negativo) em
  vez de por funcionalidade.

## Deep Dive

### A taxonomia de testes, e onde a camada unitária termina

| Type | What it tests | Strategy |
|---|---|---|
| Unit | A single component in isolation, with internals known | White box |
| Integration | Several modules together (context, database) | White box |
| Functional | Input accepted, expected output produced | Black box |
| System | The application as a whole | Black box |
| Acceptance | Customer-specified requirements | Black box |
| Performance | Throughput/latency requirements | Black box |

A linha divisória prática para este concept: um teste unitário não pode tocar um
banco de dados, um arquivo, um socket, ou um `ApplicationContext` do Spring. No
momento em que toca, ele é um teste de integração ou funcional e pertence a
*spring-batch-integration-and-functional-testing*. Tudo abaixo permanece do lado
de cá dessa linha, o que explica por que todo exemplo roda em milissegundos.

### JUnit puro: um `Validator` não precisa de nenhum framework

O estudo de caso do livro filtra produtos através de um `CompositeItemProcessor`
composto por dois `ValidatingItemProcessor`s, cada um delegando a um `Validator`
customizado. `Validator` tem um único método que ou retorna ou lança:

```java
package org.springframework.batch.infrastructure.item.validator;

public interface Validator<T> {
    void validate(T value) throws ValidationException;
}
```

Então o teste é uma chamada de construtor, uma fixture, e uma asserção. No
Jupiter, um caso ruim é expresso com `assertThrows`, que retorna a exception para
que você também possa fazer assert sobre ela:

```java
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.batch.infrastructure.item.validator.ValidationException;

import static org.junit.jupiter.api.Assertions.assertThrows;

class PositivePriceValidatorTest {

  private PositivePriceValidator validator;
  private Product product;

  @BeforeEach
  void setUp() {                       // runs before every @Test — a fresh fixture each time
    validator = new PositivePriceValidator();
    product = new Product();
  }

  @Test
  void positivePriceIsValid() {
    product.setPrice(new BigDecimal("100.0"));
    validator.validate(product);       // no exception == pass
  }

  @Test
  void zeroPriceIsRejected() {
    product.setPrice(new BigDecimal("0.0"));
    assertThrows(ValidationException.class, () -> validator.validate(product));
  }

  @Test
  void negativePriceIsRejected() {
    product.setPrice(new BigDecimal("-800.0"));
    assertThrows(ValidationException.class, () -> validator.validate(product));
  }
}
```

Três métodos de teste para um único `if` é a mentalidade white-box: você
enumera branches, não funcionalidades. `@BeforeEach` / `@AfterEach` rodam por
método de teste (ciclo de vida da fixture); `@BeforeAll` / `@AfterAll` rodam uma
vez por classe, para setup caro que você deliberadamente compartilha.

### Mockito: substitua um colaborador, depois o interrogue

Componentes reais têm dependências, e um teste unitário quer verificar o
comportamento *deste* objeto, não o dos seus colaboradores. Um mock é um fake,
gerado em runtime, cujos retornos você define e cujas chamadas você pode
inspecionar depois — sem classes de stub escritas à mão.

O `ProductFieldSetMapper` do livro transforma uma linha tokenizada num `Product`:

```java
public class ProductFieldSetMapper implements FieldSetMapper<Product> {

  public static final String FIELD_ID = "ID";
  public static final String FIELD_NAME = "NAME";
  public static final String FIELD_DESCRIPTION = "DESCRIPTION";
  public static final String FIELD_PRICE = "PRICE";

  @Override
  public Product mapFieldSet(FieldSet fieldSet) throws BindException {
    Product product = new Product();
    product.setId(fieldSet.readString(FIELD_ID));
    product.setName(fieldSet.readString(FIELD_NAME));
    product.setDescription(fieldSet.readString(FIELD_DESCRIPTION));
    product.setPrice(fieldSet.readBigDecimal(FIELD_PRICE));
    return product;
  }
}
```

Dois testes complementares. O baseado em estado constrói um `DefaultFieldSet`
real e faz assert sobre o objeto produzido; o baseado em interação mocka
`FieldSet` e faz assert sobre *como* o mapper o leu:

```java
import org.junit.jupiter.api.Test;
import org.springframework.batch.infrastructure.item.file.transform.DefaultFieldSet;
import org.springframework.batch.infrastructure.item.file.transform.FieldSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.*;

class ProductFieldSetMapperTest {

  private final ProductFieldSetMapper mapper = new ProductFieldSetMapper();

  @Test
  void mapsEveryColumnOntoTheProduct() throws Exception {
    FieldSet fieldSet = new DefaultFieldSet(
        new String[] { "id", "name", "desc", "100.25" },
        new String[] { FIELD_ID, FIELD_NAME, FIELD_DESCRIPTION, FIELD_PRICE });

    Product p = mapper.mapFieldSet(fieldSet);

    assertEquals("id", p.getId());
    assertEquals("name", p.getName());
    assertEquals("desc", p.getDescription());
    assertEquals(new BigDecimal("100.25"), p.getPrice());
  }

  @Test
  void readsEachFieldExactlyOnceAndNothingElse() throws Exception {
    FieldSet fieldSet = mock(FieldSet.class);

    mapper.mapFieldSet(fieldSet);

    verify(fieldSet, times(1)).readString(FIELD_ID);
    verify(fieldSet, times(1)).readString(FIELD_NAME);
    verify(fieldSet, times(1)).readString(FIELD_DESCRIPTION);
    verify(fieldSet, times(1)).readBigDecimal(FIELD_PRICE);
    verifyNoMoreInteractions(fieldSet);   // any extra read fails the test
  }
}
```

`verifyNoMoreInteractions` é a parte afiada aqui: adicione uma
`readString("SKU")` perdida ao mapper e o segundo teste falha, mesmo que o
primeiro ainda passe. Esse é o retorno white-box — e o custo de manutenção, já
que um novo campo legítimo também o quebra.

### Fazendo stub de valores retornados para conduzir um branch

O `ProductItemWriter` do livro decide entre insert e update olhando para a
contagem de linhas que um `UPDATE` retornou. Esse branch é intestável sem
controlar esse número — e controlá-lo com um banco de dados real significa
provisionar um. Fazer stub controla isso de graça:

```java
@ExtendWith(MockitoExtension.class)
class ProductItemWriterTest {

  @Mock private JdbcTemplate jdbcTemplate;   // the boundary we refuse to cross
  private ProductItemWriter writer;
  private Chunk<Product> items;

  @BeforeEach
  void setUp() {
    writer = new ProductItemWriter();
    writer.setJdbcTemplate(jdbcTemplate);
    Product p = new Product();
    p.setId("211");
    p.setName("BlackBerry");
    items = Chunk.of(p);
  }

  @Test
  void existingProductIsUpdatedOnly() throws Exception {
    when(jdbcTemplate.update(eq(UPDATE_SQL), any(SqlParameterSource.class)))
        .thenReturn(1);                      // pretend the row existed

    writer.write(items);

    verify(jdbcTemplate, times(1)).update(eq(UPDATE_SQL), any(SqlParameterSource.class));
    verify(jdbcTemplate, never()).update(eq(INSERT_SQL), any(SqlParameterSource.class));
    verifyNoMoreInteractions(jdbcTemplate);
  }

  @Test
  void missingProductFallsBackToInsert() throws Exception {
    when(jdbcTemplate.update(eq(UPDATE_SQL), any(SqlParameterSource.class)))
        .thenReturn(0);                      // pretend nothing was updated

    writer.write(items);

    verify(jdbcTemplate, times(1)).update(eq(UPDATE_SQL), any(SqlParameterSource.class));
    verify(jdbcTemplate, times(1)).update(eq(INSERT_SQL), any(SqlParameterSource.class));
    verifyNoMoreInteractions(jdbcTemplate);
  }
}
```

Duas regras que vale a pena internalizar. Primeiro, argument matchers são
tudo-ou-nada: uma vez que um argumento usa um matcher, todos os argumentos
precisam usar, o que explica por que a string SQL literal é envolvida em
`eq(...)` ao lado de `any(SqlParameterSource.class)`. Segundo, `never()` é
`times(0)` escrito para se ler como uma frase — fazer assert da *ausência* de um
INSERT é todo o objetivo do primeiro teste. Note também que o writer recebe um
`Chunk`, não um item único (veja *spring-batch-chunk-processing*): `Chunk` é uma
classe de valor simples, então construa-o com `Chunk.of(...)` em vez de
mocká-lo.

### Spies: um objeto real que você ainda pode interrogar

Um mock substitui um objeto por completo. Um **spy** envolve uma instância real,
delegando chamadas a ela enquanto as registra — útil quando o comportamento real
do objeto é o que você quer, mas você também se importa com como ele foi usado.
O livro testa um `JobParametersValidator` dessa forma, espionando `JobParameters`
reais para fixar exatamente como o validator os inspeciona, e mockando o
`ResourceLoader` para que o teste nunca toque o sistema de arquivos:

```java
@Test
void acceptsCompleteJobParameters() {
  ResourceLoader resourceLoader = mock(ResourceLoader.class, Mockito.RETURNS_DEEP_STUBS);
  when(resourceLoader.getResource(PRODUCTS_PATH).exists()).thenReturn(true);

  ImportValidator validator = new ImportValidator();
  validator.setResourceLoader(resourceLoader);

  JobParameters params = new JobParametersBuilder()
      .addString(PARAM_INPUT_RESOURCE, PRODUCTS_PATH)
      .addString(PARAM_REPORT_RESOURCE, STATISTIC_PATH)
      .toJobParameters();
  JobParameters spy = Mockito.spy(params);      // real behaviour, recorded calls

  validator.validate(spy);

  verify(spy, times(2)).getParameters();
  verify(spy, times(1)).getString(PARAM_INPUT_RESOURCE);
  verifyNoMoreInteractions(spy);
}

@Test
void rejectsEmptyJobParameters() {
  // ... same validator, no parameters at all
  assertThrows(InvalidJobParametersException.class,
      () -> validator.validate(new JobParametersBuilder().toJobParameters()));
}
```

`RETURNS_DEEP_STUBS` faz `resourceLoader.getResource(...)` retornar ele mesmo um
mock, então o `.exists()` encadeado pode ser stubado numa única linha. É
conveniente e é um code smell documentado — um mock que retorna um mock codifica
a cadeia de chamadas da implementação no teste, então qualquer refatoração dessa
cadeia o quebra. Spies têm o mesmo caráter: o livro usa um para fazer assert de
que `getParameters()` é chamado exatamente duas vezes, o que é acoplamento à
implementação em vez de ao contrato. Recorra a spies principalmente em código
legado que você não pode reestruturar.

### Mockando o colaborador de um listener

Um listener é apenas uma implementação de interface, então a mesma técnica se
aplica. O listener de item do livro escreve produtos filtrados num arquivo de
rejeição; o teste mocka o writer para que nenhum arquivo seja criado, e então faz
assert de que o writer foi ou não foi chamado:

```java
public class ProductItemListener implements ItemProcessListener<Product, Product> {

  private ItemWriter<Product> excludeWriter;

  @Override
  public void afterProcess(Product item, Product result) {
    if (result == null) {                    // null == filtered out by the processor
      try {
        excludeWriter.write(Chunk.of(item));
      } catch (Exception e) {
        // ...
      }
    }
  }

  public void setExcludeWriter(ItemWriter<Product> excludeWriter) {
    this.excludeWriter = excludeWriter;
  }
}
```

```java
@ExtendWith(MockitoExtension.class)
class ProductItemListenerTest {

  @Mock private ItemWriter<Product> writer;
  private ProductItemListener listener;
  private Product product;

  @BeforeEach
  void setUp() {
    listener = new ProductItemListener();
    listener.setExcludeWriter(writer);
    product = new Product();
    product.setId("211");
  }

  @Test
  void filteredItemGoesToTheRejectWriter() throws Exception {
    listener.afterProcess(product, null);                  // processor returned null
    verify(writer, times(1)).write(Chunk.of(product));
  }

  @Test
  void keptItemIsNotWrittenToTheRejectWriter() throws Exception {
    listener.afterProcess(product, product);               // processor kept the item
    verify(writer, never()).write(any());
  }
}
```

A convenção `result == null` é o contrato de filtragem do `ItemProcessor` (veja
*spring-batch-item-processing-and-transformation*); um writer mockado é o que
permite fazer assert sobre isso sem um step, um chunk, ou um job.

### `MetaDataInstanceFactory`: fixtures para os próprios objetos de domínio do Spring Batch

Alguns objetos do Spring Batch são desajeitados de construir à mão porque se
aninham: um `StepExecution` precisa de um `JobExecution`, que precisa de um
`JobInstance` e `JobParameters`. Escrita por extenso, a fixture domina o teste:

```java
StepExecution stepExecution = new StepExecution("NoProcessingStep",
    new JobExecution(new JobInstance(1L, "NoProcessingJob"), new JobParameters()));
```

O `spring-batch-test` traz o `MetaDataInstanceFactory` (pacote
`org.springframework.batch.test`) precisamente para isso. É uma fábrica estática
pura — **sem contexto Spring, sem `JobRepository`, sem banco de dados** — o que
explica por que ele pertence a esta camada de teste unitário em vez da de
integração:

```java
StepExecution stepExecution = MetaDataInstanceFactory.createStepExecution();
JobExecution jobExecution  = MetaDataInstanceFactory.createJobExecution();
```

Ele preenche defaults documentados (`DEFAULT_JOB_NAME = "job"`,
`DEFAULT_STEP_NAME = "step"`, `DEFAULT_JOB_INSTANCE_ID = 12L`,
`DEFAULT_JOB_EXECUTION_ID = 123L`, `DEFAULT_STEP_EXECUTION_ID = 1234L`) e oferece
overloads quando a identidade importa — `createJobInstance(String jobName, Long instanceId)`,
`createJobExecution(String jobName, Long instanceId, Long executionId, JobParameters params)`,
`createJobExecutionWithStepExecutions(Long executionId, Collection<String> stepNames)`,
`createStepExecution(JobParameters params, ExecutionContext context)`. Esse
último é como você pré-preenche um `ExecutionContext`, que é o que um componente
lendo o estado do step espera:

```java
StepExecution execution = MetaDataInstanceFactory.createStepExecution();
execution.getExecutionContext().putString("input.file", "products.txt");
execution.setReadCount(0);
```

Isso abre qualquer componente cuja API exija estado de execução. Um
`JobExecutionDecider` conduz o fluxo do job com base na contagem de escritas,
então testá-lo importa — e agora custa três linhas:

```java
class NextDeciderTest {

  private final NextDecider decider = new NextDecider();
  private JobExecution jobExecution;
  private StepExecution stepExecution;

  @BeforeEach
  void setUp() {
    jobExecution = MetaDataInstanceFactory.createJobExecution();
    stepExecution = MetaDataInstanceFactory.createStepExecution();
  }

  @Test
  void itemsWrittenMeansNext() {
    stepExecution.setWriteCount(5);
    FlowExecutionStatus status = decider.decide(jobExecution, stepExecution);
    assertEquals("NEXT", status.getName());
  }

  @Test
  void nothingWrittenMeansCompleted() {
    stepExecution.setWriteCount(0);
    assertEquals(FlowExecutionStatus.COMPLETED, decider.decide(jobExecution, stepExecution));
  }
}
```

O mesmo truque testa um `StepExecutionListener`: entregue a `afterStep(stepExecution)`
um `StepExecution` de fábrica com as contagens que você quer e faça assert sobre
o `ExitStatus` retornado.

### Testando um `Tasklet` sem um step

`Tasklet.execute` exige dois objetos do framework — um `StepContribution` e um
`ChunkContext` — e ambos são construtíveis a partir de um `StepExecution`, então
nenhum job é necessário:

```java
class CleanTaskletTest {

  @Test
  void reportsFinishedAfterOnePass() throws Exception {
    StepExecution stepExecution = MetaDataInstanceFactory.createStepExecution();
    StepContribution contribution = new StepContribution(stepExecution);
    ChunkContext chunkContext = new ChunkContext(new StepContext(stepExecution));

    RepeatStatus status = new CleanTasklet().execute(contribution, chunkContext);

    assertEquals(RepeatStatus.FINISHED, status);
  }
}
```

`StepContribution` também é o alvo da asserção para um tasklet que reporta
trabalho: `contribution.incrementWriteCount(n)` dentro do tasklet vira
`assertEquals(n, contribution.getWriteCount())` no teste. E como `execute` é
chamado repetidamente até retornar `FINISHED`, um tasklet que retorna
`CONTINUABLE` deveria ser testado chamando `execute` num loop e fazendo assert de
que ele termina — uma classe de bug que só um teste unitário captura
baratamente.

### Livro vs. hoje: JUnit 4 → Jupiter, e a reorganização de pacotes do Spring Batch 6

A mecânica dos testes unitários sobreviveu 14 anos quase intocada; as
*grafias* não. 

**JUnit.** O livro é JUnit 4 (`org.junit`). O Spring Batch 6.0 abandonou o
suporte ao JUnit 4 por completo, e o JUnit atual é o 6.x (`org.junit.jupiter.api`,
baseline Java 17). O antes/depois:

```java
// Book (JUnit 4)                            // Today (JUnit Jupiter)
import org.junit.Test;                       import org.junit.jupiter.api.Test;
import org.junit.Before;                     import org.junit.jupiter.api.BeforeEach;
import static org.junit.Assert.*;            import static org.junit.jupiter.api.Assertions.*;

@Before  public void setUp() {}              @BeforeEach void setUp() {}
@After   public void tearDown() {}           @AfterEach  void tearDown() {}
@BeforeClass / @AfterClass                   @BeforeAll  / @AfterAll
@Ignore                                      @Disabled
@RunWith(MockitoJUnitRunner.class)           @ExtendWith(MockitoExtension.class)

@Test(expected = ValidationException.class)  assertThrows(ValidationException.class,
public void bad() { validator.validate(p); }     () -> validator.validate(p));
```

Classes e métodos de teste não precisam mais ser `public` no Jupiter, e a
convenção do livro de prefixar todo método com `test` é um resquício do JUnit 3 —
nomeie o método com base no comportamento em vez disso. `assertThrows` é
estritamente melhor que `expected`: ele escopa a expectativa a uma única
declaração (`expected` passava se *qualquer* linha lançasse) e retorna a
exception para que você possa fazer assert sobre sua mensagem.

**Mockito.** Essencialmente inalterado, o que é notável. `mock()`,
`when(...).thenReturn(...)`, `verify()`, `times()`, `never()`,
`verifyNoMoreInteractions()`, `spy()`, `eq()`, `any()`, e `RETURNS_DEEP_STUBS`
continuam sendo a API central no Mockito 5.x. Três diferenças: o Mockito 5 exige
Java 11+ e trocou o mock maker default para o inline (então classes e métodos
`final` são mockados sem setup extra); `verifyZeroInteractions` foi removido no
Mockito 4 em favor de `verifyNoInteractions`; e o runner recomendado agora é a
extensão do Jupiter vinda de `mockito-junit-jupiter`, que traz **strict stubs** —
um `when(...)` não usado faz o teste falhar com `UnnecessaryStubbingException`.
Isso morde quando você migra código da era do livro que faz stub de tudo em
`setUp`: mova o stub para o teste que precisa dele, ou opte por sair por classe
com `@MockitoSettings(strictness = Strictness.LENIENT)`.

**Pacotes do Spring Batch.** `MetaDataInstanceFactory` permaneceu no lugar em
`org.springframework.batch.test`, mas quase tudo que ele produz mudou de lugar
na reorganização da 6.0, então um arquivo de teste da era do livro precisa de
uma varredura de imports:

| Type | Book (≤ 5.x) | Spring Batch 6.0 |
|---|---|---|
| `JobExecution`, `JobInstance` | `org.springframework.batch.core` | `org.springframework.batch.core.job` |
| `StepExecution`, `StepContribution` | `org.springframework.batch.core` | `org.springframework.batch.core.step` |
| `JobParameters`, `JobParametersBuilder`, `JobParametersValidator` | `org.springframework.batch.core` | `org.springframework.batch.core.job.parameters` |
| `ItemProcessListener`, `StepExecutionListener`, `ItemListenerSupport` | `org.springframework.batch.core` | `org.springframework.batch.core.listener` |
| `ExecutionContext` | `org.springframework.batch.item` | `org.springframework.batch.infrastructure.item` |
| `Chunk`, `ItemWriter`, `ItemProcessor` | `org.springframework.batch.item` | `org.springframework.batch.infrastructure.item` |
| `FieldSet`, `DefaultFieldSet` | `org.springframework.batch.item.file.transform` | `org.springframework.batch.infrastructure.item.file.transform` |
| `FieldSetMapper` | `org.springframework.batch.item.file.mapping` | `org.springframework.batch.infrastructure.item.file.mapping` |
| `Validator`, `ValidationException` | `org.springframework.batch.item.validator` | `org.springframework.batch.infrastructure.item.validator` |
| `RepeatStatus` | `org.springframework.batch.repeat` | `org.springframework.batch.infrastructure.repeat` |

`ExitStatus` e `BatchStatus` permanecem em `org.springframework.batch.core`;
`ChunkContext`/`StepContext` permanecem em
`org.springframework.batch.core.scope.context`; `Tasklet` permanece em
`org.springframework.batch.core.step.tasklet`;
`JobExecutionDecider`/`FlowExecutionStatus` permanecem em
`org.springframework.batch.core.job.flow`. Duas mudanças de assinatura também
afetam esses testes diretamente: `ItemWriter.write` agora recebe
`Chunk<? extends T>` em vez de `List<? extends T>`, então o `Arrays.asList(item)`
do livro vira `Chunk.of(item)`; e `JobParametersInvalidException` foi renomeado
para `InvalidJobParametersException`. O `SimpleJdbcTemplate` do livro já era —
use `JdbcTemplate` ou `NamedParameterJdbcTemplate` — e `ItemListenerSupport`
ainda existe mas é desnecessário, já que as interfaces de listener têm métodos
`default`, então implemente `ItemProcessListener` diretamente e sobrescreva só o
que precisar. Confirmado com o Javadoc da API do Spring Batch 6.0.4 para
`MetaDataInstanceFactory`, `Chunk`, `ExecutionContext`, `StepContribution`,
`Tasklet`, `JobParametersValidator`, `FieldSetMapper`, e `Validator`; o capítulo
"Unit Testing" da referência do Spring Batch; o Guia de Migração do Spring
Batch 6.0; o guia do usuário do JUnit 6; e as notas de release do Mockito 5.

## Trade-offs

- **Verificação de interação vs. asserção de estado.** Fazer assert sobre o
  objeto retornado (`assertEquals("id", p.getId())`) sobrevive a refatorações;
  fazer assert sobre chamadas (`verify(fieldSet).readString(FIELD_ID)` mais
  `verifyNoMoreInteractions`) captura bugs mais sutis, mas quebra de novo toda
  vez que a implementação muda de forma. Use verificação de interação onde a
  *interação é o comportamento* — um listener que precisa escrever uma linha de
  rejeição, um writer que não pode fazer INSERT — e asserções de estado em
  todo o resto.
- **Mocks tornam os testes rápidos e fazem eles mentirem.** Um
  `jdbcTemplate.update(...)` stubado retornando `1` prova a lógica de branch do
  writer; não prova nada sobre se o SQL é válido, se os nomes de coluna
  existem, ou se a transação faz commit. Testes unitários de um componente de
  persistência sempre precisam de um teste de integração por trás
  (*spring-batch-integration-and-functional-testing*).
- **Deep stubs e spies compram conveniência com acoplamento.**
  `RETURNS_DEEP_STUBS` permite fazer stub de `getResource(path).exists()` numa
  única linha, e um spy permite fazer assert de que `getParameters()` foi
  chamado exatamente duas vezes — os dois codificam a cadeia de chamadas da
  implementação no teste. A própria documentação do Mockito chama deep stubs
  de violação da Lei de Demeter; trate-os como uma ferramenta para código
  legado, não como um default.
- **Strict stubs são um ganho líquido que vai quebrar sua migração.** Com o
  `MockitoExtension`, um `when(...)` que nenhum caminho de teste exercita faz o
  build falhar — sinal genuinamente útil, mas código da era do livro que faz
  stub de tudo em `setUp` vai acender vermelho no primeiro dia. Prefira
  restringir os stubs a `@MockitoSettings(strictness = LENIENT)`.
- **`MetaDataInstanceFactory` te dá um objeto, não um job rodando.** Seu
  `StepExecution` não tem um repository por trás, então nada persiste, nada
  reinicia, e beans com escopo de step não são resolvidos. Testar componentes
  com escopo de step ou semântica de restart precisa de `StepScopeTestUtils` /
  `@SpringBatchTest` e um contexto — a camada de integração.
- **Cobertura não é correção.** Testes unitários white-box otimizam para
  branches tocados, o que explica por que o livro escreve três testes para um
  único `if`. Um job pode ter todo componente com 100% de cobertura e ainda
  falhar de ponta a ponta porque os steps estão conectados na ordem errada —
  um defeito que só um teste funcional enxerga.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 14, "Testing batch applications", sections 14.1-14.2, "The what and why of testing" / "Unit testing", p. 408-425 — doc
- [Spring Batch Reference — Unit Testing (`MetaDataInstanceFactory`, mocking domain objects, JUnit 4 unsupported as of 6.0)](https://docs.spring.io/spring-batch/reference/testing.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.test.MetaDataInstanceFactory`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/MetaDataInstanceFactory.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.infrastructure.item.Chunk`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/Chunk.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.core.step.tasklet.Tasklet`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/step/tasklet/Tasklet.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.core.job.parameters.JobParametersValidator`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/core/job/parameters/JobParametersValidator.html) — doc
- [Spring Batch 6.0 Migration Guide — core package relocations and JUnit 4 removal](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [JUnit 6 User Guide — Jupiter annotations, assertions, `assertThrows`](https://docs.junit.org/current/user-guide/) — doc
- [Mockito framework site — current `mockito-core` and core API](https://site.mockito.org/) — doc
- [Mockito 5 release notes — Java 11 baseline, inline mock maker, minimal API change](https://github.com/mockito/mockito/wiki/Draft-Mockito-5-release-notes) — doc
