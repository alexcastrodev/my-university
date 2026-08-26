---
version: 1.0
updatedAt: 2026-08-06
title: Testes de Integração e Funcionais de Jobs Spring Batch
---
## Objective

Testes unitários (veja *spring-batch-unit-testing-with-junit-and-mockito*) provam que uma classe se comporta bem — um `Validator`, um `RowMapper`, um `Tasklet` — com tudo ao redor mockado e nenhum container Spring à vista. Isso deliberadamente deixa de fora as coisas mais específicas do batch: se a *ligação* está certa, se os delegates de um `CompositeItemProcessor` estão na ordem correta, se `#{jobParameters['inputResource']}` realmente resolve, se o step comita, e se lançar o job de ponta a ponta deixa as linhas certas no banco. Essas perguntas só têm resposta dentro de um `ApplicationContext` de verdade, batendo num datasource real (mesmo que em memória).

Este concept cobre as duas camadas apoiadas em contexto Spring que o Capítulo 14 adiciona sobre os testes unitários: **teste de integração** — o Spring TestContext Framework mais o `StepScopeTestExecutionListener`, que finge um step em execução para que beans `@StepScope` e SpEL de late binding possam ser exercitados fora de um job — e **teste funcional** — lançar um step real ou um job real inteiro a partir de um teste e verificar o `JobExecution`, `BatchStatus`, contagens do step, e conteúdo das tabelas resultantes. É o último tópico do último capítulo do livro, e de forma apropriada é o que exercita tudo que os capítulos anteriores construíram.

## Use Cases

- Verificar que um `CompositeItemProcessor` montado na configuração realmente encadeia seus delegates na ordem pretendida — um bug invisível para os testes unitários de cada delegate.
- Testar um reader `@StepScope` cujo `resource` vem de `#{jobParameters['inputResource']}`, sem lançar um job só para fazer a expressão resolver.
- Ler um arquivo de fixture real através de um `FlatFileItemReader` configurado e verificar os campos do primeiro item mais a contagem exata de itens.
- Rodar um único step (`productsStep`) contra um banco H2 em memória e verificar `COMPLETED`, `filterCount == 2`, `writeCount == 6`, e `SELECT COUNT(*) FROM PRODUCT`.
- Rodar o job inteiro de ponta a ponta como um gate de regressão em CI antes de cada release.
- Popular o repositório (ou limpá-lo) entre testes para que cenários de restart/rerun comecem de um estado conhecido.

## Deep Dive

### Por que testes de integração precisam de um contexto real (e um datasource meio real)

O livro enquadra teste de integração como *white-box* — ciente dos internos — mas executado em "condições realistas de produção": contextos Spring reais, definições de job Spring Batch reais, um banco de dados real. Esse último ponto importa mais do que parece. Componentes do Spring Batch são transacionais por construção: um step chunk-oriented abre uma transação, lê/processa/escreve, comita, e registra contagens no job repository. Mocke um `DataSource` e nada disso acontece; você está testando o seu código, mas não o contrato do framework com ele.

O compromisso pragmático é um banco de dados embarcado — o livro usa **H2 em memória** (`jdbc:h2:mem:products;DB_CLOSE_DELAY=-1`), rápido o bastante para subir por suíte de teste e real o bastante para rodar DDL, transações, e funções de agregação SQL. Em configuração Java, o `EmbeddedDatabaseBuilder` substitui o par `SingleConnectionDataSource` + `<jdbc:initialize-database>` do livro, e pode carregar tanto o schema de metadados do Spring Batch quanto suas tabelas de aplicação:

```java
@Bean
public DataSource dataSource() {
    return new EmbeddedDatabaseBuilder()
            .setType(EmbeddedDatabaseType.H2)
            .addScript("classpath:org/springframework/batch/core/schema-h2.sql")
            .addScript("classpath:sql/create-tables.sql")
            .build();
}
```

(O script DDL de metadados do batch ainda é distribuído em `org/springframework/batch/core/schema-h2.sql` dentro de `spring-batch-core`; a configuração de schema e repositório em si é assunto de *spring-batch-job-repository-database-configuration*.) A preparação de dados por teste fica mais limpa como `@Sql` do que como chamadas `jdbcTemplate.update(...)` escritas à mão em `@BeforeEach`:

```java
@Test
@Sql(scripts = "/sql/insert-two-products.sql")
void statisticStepComputesAverage() { /* ... */ }
```

Se o alvo de produção é Oracle ou Postgres e o SQL é sensível a dialeto, Testcontainers é a evolução moderna do H2 — o mesmo código de teste, com um engine de verdade rodando em Docker.

### O Spring TestContext Framework: `@SpringJUnitConfig` e cache de contexto

O Spring TestContext Framework é o que transforma uma classe JUnit numa classe ciente do Spring: ele constrói o `ApplicationContext`, injeta beans nos campos de teste, e roda uma cadeia de `TestExecutionListener`s ao redor de cada teste. A forma JUnit 4 do livro era `@RunWith(SpringJUnit4ClassRunner.class)` + `@ContextConfiguration`; hoje a annotation composta `@SpringJUnitConfig` é as duas coisas ao mesmo tempo:

```java
@SpringJUnitConfig(BatchTestConfiguration.class)   // = @ExtendWith(SpringExtension.class) + @ContextConfiguration
class CompositeItemProcessorIntegrationTests {

    @Autowired
    private ItemProcessor<Product, Product> processor;   // the *real* configured chain

    @Test
    void rejectsNegativePrice() throws Exception {
        Product p = new Product();
        p.setPrice(new BigDecimal("-800.0"));
        assertNull(processor.process(p));   // filtered, not thrown: filter = true
    }
}
```

Dois recursos do TestContext são estruturais especificamente para testes de batch:

- **Cache de contexto.** O framework armazena em cache o `ApplicationContext` por chave de configuração e o reutiliza entre classes de teste. Para um contexto de batch — datasource, job repository, readers, writers, o grafo do job inteiro — isso é a diferença entre uma suíte que roda em segundos e uma que reconstrói tudo por classe.
- **`@DirtiesContext`.** A válvula de escape: marca o contexto em cache como poluído, para que seja fechado e reconstruído. O livro coloca `@DirtiesContext` em quase todo método de teste, porque componentes de batch têm estado (um `ItemStream` aberto, um reader no meio de um arquivo, um banco em memória com linhas remanescentes). Isso está correto, mas é caro — veja Trade-offs.

O teste do processor acima é o menor teste de integração útil: cada `Validator` já foi testado unitariamente, então o que está sob teste aqui é puramente a *montagem*. O livro faz o ponto de forma contundente — se `PositivePriceValidator` tivesse sido ordenado antes de `PriceMandatoryValidator`, esses testes falhariam com uma `NullPointerException`, porque a checagem de preço positivo assume um preço não nulo. Nenhum teste unitário consegue capturar isso; só o contexto real consegue.

### `StepScopeTestExecutionListener`: um step falso ao redor do seu método de teste

Beans `@StepScope` e expressões `#{jobParameters[...]}` / `#{stepExecutionContext[...]}` resolvem contra um `StepContext` vivo — a mecânica está em *spring-batch-step-scope-and-spel-late-binding*. Fora de um step em execução não existe esse contexto, então dar autowire num reader step-scoped num teste normalmente falha ou produz um proxy que explode no primeiro uso.

O `StepScopeTestExecutionListener` (em `org.springframework.batch.test`, parte do módulo `spring-batch-test`) resolve isso registrando uma `StepExecution` no `StepSynchronizationManager` durante a execução de cada método de teste, e a fechando depois. Por padrão ele cria uma `StepExecution` com propriedades fixas. Se a classe de teste declarar um **método que retorna `StepExecution`** — convencionalmente chamado `getStepExecution` — o listener o invoca e usa o resultado, que é como você injeta os job parameters e entradas de execution context que o SpEL do bean espera:

```java
@SpringBatchTest                                 // registers the listener for you (see below)
@SpringJUnitConfig(BatchTestConfiguration.class)
class ProductReaderIntegrationTests {

    private static final String PRODUCTS = "classpath:input/products.txt";

    @Autowired
    private ItemReader<Product> reader;          // @StepScope FlatFileItemReader

    public StepExecution getStepExecution() {    // picked up reflectively by the listener
        JobParameters jobParameters = new JobParametersBuilder()
                .addString("inputResource", PRODUCTS)
                .toJobParameters();
        return MetaDataInstanceFactory.createStepExecution(jobParameters);
    }

    @BeforeEach
    void open()  { ((ItemStream) reader).open(new ExecutionContext()); }

    @AfterEach
    void close() { ((ItemStream) reader).close(); }

    @Test
    void readsEightProducts() throws Exception {
        Product first = reader.read();
        assertNotNull(first);
        assertEquals("211", first.getId());
        for (int i = 1; i < 8; i++) {
            assertNotNull(reader.read());
        }
        assertNull(reader.read());               // 9th read: end of file
    }
}
```

O `MetaDataInstanceFactory` é a outra metade do truque: uma fábrica de objetos de domínio batch descartáveis (`createJobInstance`, `createJobExecution`, `createStepExecution`, com sobrecargas aceitando `JobParameters` e/ou um `ExecutionContext`), para que você nunca precise construir uma `StepExecution` à mão. Note o `open`/`close` manual do `ItemStream` — o listener finge o *scope*, não o ciclo de vida do step, então nada abre o stream para você.

### `StepScopeTestUtils.doInStepScope`: a alternativa programática

O listener é declarativo e cobre o método de teste inteiro. Quando você prefere dar scope a um bloco específico — ou precisa de várias `StepExecution`s diferentes num único teste — `StepScopeTestUtils.doInStepScope(StepExecution, Callable<T>)` roda um callback dentro de um step scope e retorna seu valor:

```java
@Test
void countsAllItems() throws Exception {
    int count = StepScopeTestUtils.doInStepScope(getStepExecution(), () -> {
        int n = 0;
        try {
            ((ItemStream) reader).open(new ExecutionContext());
            while (reader.read() != null) {
                n++;
            }
            return n;
        }
        finally {
            ((ItemStream) reader).close();
        }
    });
    assertEquals(8, count);
}
```

O veredito do livro ainda vale: o listener é mais simples, `doInStepScope` é mais flexível e compensa para um reader complexo. Existe um `JobScopeTestUtils.doInJobScope` e um `JobScopeTestExecutionListener` fazendo o mesmo para beans `@JobScope` e `#{jobExecutionContext[...]}`.

### Teste funcional: lançando um step real

O teste funcional inverte para *black box*: alimente entradas, lance, verifique saídas, ignore internos. O utilitário de lançamento do módulo `spring-batch-test` injeta o único bean `Job` do contexto de teste (ter exatamente um job por contexto de teste é a configuração recomendada) e pode iniciar tanto o job inteiro quanto um step nomeado, embrulhado num job sintético de um único step. `@SpringBatchTest` é a annotation única que liga tudo isso — ela é meta-anotada com `@ExtendWith(SpringExtension.class)`, registra um bean `JobOperatorTestUtils` e um bean `JobRepositoryTestUtils`, e adiciona `StepScopeTestExecutionListener` + `JobScopeTestExecutionListener` como test execution listeners (mesclados com os defaults, então a injeção de dependência continua funcionando):

```java
@SpringBatchTest
@SpringJUnitConfig(ImportProductsJobConfiguration.class)
class ProductStepFunctionalTests {

    @Autowired private JobOperatorTestUtils    jobOperatorTestUtils;
    @Autowired private JobRepositoryTestUtils  jobRepositoryTestUtils;
    @Autowired private DataSource              dataSource;

    @BeforeEach
    void clean() { this.jobRepositoryTestUtils.removeJobExecutions(); }

    @Test
    void productsStepWritesSixAndFiltersTwo() {
        JobParameters params = new JobParametersBuilder()
                .addString("inputResource", "classpath:input/products.txt")
                .toJobParameters();

        JobExecution execution = this.jobOperatorTestUtils.startStep("productsStep", params,
                new ExecutionContext());

        assertEquals(BatchStatus.COMPLETED, execution.getStatus());
        StepExecution stepExecution = execution.getStepExecutions().iterator().next();
        assertEquals(2, stepExecution.getFilterCount());
        assertEquals(6, stepExecution.getWriteCount());
        assertEquals(6, new JdbcTemplate(dataSource)
                .queryForObject("SELECT COUNT(*) FROM PRODUCT", Integer.class));
    }
}
```

É aqui que a própria contabilidade do framework vira a superfície de asserção: `getFilterCount()`, `getWriteCount()`, `getReadCount()`, `getSkipCount()`, `getCommitCount()` em `StepExecution` são exatamente os contadores persistidos em `BATCH_STEP_EXECUTION` (*spring-batch-monitoring-and-jobexplorer*). Verificá-los testa comportamento que você não vê só pela saída: que duas linhas foram *filtradas*, e não puladas, que o writer realmente rodou seis vezes.

`JobRepositoryTestUtils` é o gerenciador de estado ao redor disso — `createJobExecutions(int)`/`createJobExecutions(String, String[], int)` para popular histórico, `removeJobExecutions()` para apagá-lo. Limpar entre testes importa porque o Spring Batch se recusa a rerodar uma `JobInstance` completa com parâmetros identificadores idênticos; a alternativa é `getUniqueJobParameters()`, que adiciona um parâmetro `batch.random` aleatório para que cada lançamento seja uma instância nova.

### Teste funcional: o job inteiro

Testar o job inteiro é o mesmo código com uma chamada alterada — e, segundo o livro, "The Big One": todo reader, processor, writer, listener, decision, e transição roda de verdade contra o datasource de teste.

```java
@SpringBatchTest
@SpringJUnitConfig(ImportProductsJobConfiguration.class)
class WholeJobFunctionalTests {

    @Autowired private JobOperatorTestUtils jobOperatorTestUtils;
    @Autowired private DataSource           dataSource;

    @Test
    void importsProductsAndWritesStatistics(@TempDir Path tmp) throws Exception {
        Path report = tmp.resolve("statistic.txt");
        JobParameters params = new JobParametersBuilder()
                .addString("inputResource",  "classpath:input/products.txt")
                .addString("reportResource", "file:" + report)
                .toJobParameters();

        JobExecution execution = this.jobOperatorTestUtils.startJob(params);

        assertEquals(BatchStatus.COMPLETED, execution.getStatus());
        assertEquals(6, new JdbcTemplate(dataSource)
                .queryForObject("SELECT COUNT(*) FROM PRODUCT", Integer.class));
        assertLinesMatch(Files.readAllLines(Path.of("src/test/resources/expected/statistic.txt")),
                         Files.readAllLines(report));
    }
}
```

Dois detalhes valem a pena copiar. Primeiro, a saída vai para um `@TempDir` do JUnit 5 em vez de `./target/`, para que runs paralelos ou repetidos não colidam. Segundo, a comparação de arquivo é um simples `assertLinesMatch` — o livro usava o helper `AssertFile` do módulo, que não existe mais (veja abaixo). Se o job sob teste é assíncrono ou lançado com um `TaskExecutor` (*spring-batch-job-launcher-api-and-async-launching*), lembre-se de que esses utilitários entregam um `JobExecution` que ainda pode estar rodando; um teste funcional normalmente quer o default síncrono, para que as asserções rodem depois da conclusão.

### Livro vs. hoje: `SpringJUnit4ClassRunner` → `@SpringBatchTest`, `JobLauncherTestUtils` → `JobOperatorTestUtils`

Os conceitos permanecem intactos; três peças da API mudaram.

**1. JUnit 4 → JUnit 5.** O boilerplate baseado em runner do livro:

```java
// 2012 — JUnit 4
@RunWith(SpringJUnit4ClassRunner.class)
@ContextConfiguration
@TestExecutionListeners({ DependencyInjectionTestExecutionListener.class,
                          StepScopeTestExecutionListener.class })
public class CompositeItemProcessorTest { /* ... */ }
```

encolhe para uma única annotation mais uma referência de configuração:

```java
// today — JUnit 5 (Jupiter)
@SpringBatchTest
@SpringJUnitConfig(BatchTestConfiguration.class)
class CompositeItemProcessorIntegrationTests { /* ... */ }
```

`@SpringBatchTest` existe desde o Spring Batch **4.1** e faz quatro coisas de uma vez (`SpringExtension`, `JobOperatorTestUtils`, `JobRepositoryTestUtils`, os dois scope listeners). `@RunWith` → `@ExtendWith(SpringExtension.class)` é o equivalente cru se você precisar dele à la carte; `@SpringJUnitConfig` empacota isso junto com `@ContextConfiguration`. O suporte a JUnit 4 com `@SpringBatchTest` está **deprecated desde o Spring Batch 6.0** e programado para remoção, então a migração não é mais opcional. Também `@Before`/`@After` → `@BeforeEach`/`@AfterEach`, e o JUnit 5 inverteu a ordem do parâmetro de mensagem de asserção (mensagem por último, não primeiro) — uma armadilha silenciosa ao migrar testes de batch antigos.

**2. `JobLauncherTestUtils` está deprecated; use `JobOperatorTestUtils`.** A classe central de teste funcional do livro ainda existe em `org.springframework.batch.test`, mas carrega `@Deprecated(since = "6.0", forRemoval = true)` — "em favor de `JobOperatorTestUtils`. Removal previsto para 6.2 ou posterior" — espelhando a mudança `JobLauncher` → `JobOperator` na API de produção. `JobOperatorTestUtils` (`@since 6.0`) estende a classe antiga e renomeia os verbos:

| Livro (`JobLauncherTestUtils`) | Hoje (`JobOperatorTestUtils`) |
|---|---|
| `launchJob()` / `launchJob(JobParameters)` | `startJob()` / `startJob(JobParameters)` |
| `launchStep(String)` | `startStep(String)` |
| `launchStep(String, JobParameters)` | `startStep(String, JobParameters, ExecutionContext)` |
| — | `startStep(Step)` / `startStep(Step, JobParameters, ExecutionContext)` |
| — | `getUniqueJobParameters()` / `getUniqueJobParametersBuilder()` |

**3. `AssertFile` desapareceu.** Os helpers `assertFileEquals(File, File)` / `assertLineCount(int, Resource)` do livro foram deprecated no Spring Batch **5.0** e removidos — o objetivo declarado do módulo é utilitários específicos do Spring Batch, não asserções genéricas de arquivo. Use `Assertions.assertLinesMatch(...)` do JUnit 5 ou `assertThat(actual).hasSameTextualContentAs(expected)` do AssertJ.

Tudo mais de que o capítulo depende permanece inalterado em nome e pacote: `StepScopeTestExecutionListener`, `JobScopeTestExecutionListener`, `StepScopeTestUtils.doInStepScope`, `JobScopeTestUtils.doInJobScope`, `MetaDataInstanceFactory`, `JobRepositoryTestUtils`, e `ExecutionContextTestUtils` ainda vivem em `org.springframework.batch.test` no artefato `spring-batch-test` (o Spring Boot o traz via `spring-boot-starter-batch` + `spring-batch-test` no classpath de teste). Uma mudança de pacote acaba mordendo os imports: o Spring Batch 6.0 realocou as APIs de `spring-batch-infrastructure`, então `ExecutionContext` agora é `org.springframework.batch.infrastructure.item.ExecutionContext` — visível na assinatura de `startStep(...)` e em todo `new ExecutionContext()` acima. `StepRunner`, o helper de nível mais baixo para lançar steps, está deprecated para remoção.

Confirmado contra a referência do Spring Batch 6.0 ("Unit Testing"), o Javadoc 6.0 de `SpringBatchTest`/`JobOperatorTestUtils`/`JobLauncherTestUtils`, os fontes de `spring-batch-test` na `main`, o Guia de Migração do Spring Batch 6.0, e a issue #4181 (deprecation de AssertFile).

## Trade-offs

- **Testes de integração capturam bugs de ligação que testes unitários estruturalmente não conseguem — e só esses.** O bug de ordenação de delegates em `CompositeItemProcessor` é o exemplo canônico: cada `Validator` passa no seu próprio teste unitário, e o composite ainda assim falha. Por outro lado, um teste de integração que falha diz que *algo no grafo* está errado, não qual classe — por isso você quer as duas camadas, não só uma.
- **`@DirtiesContext` compra isolamento e gasta tempo de startup.** O cache de contexto é a principal razão pela qual testes de integração Spring são toleráveis; `@DirtiesContext` em todo método de teste (como o livro os escreve) o descarta a cada vez. Prefira resetar *estado* — `jobRepositoryTestUtils.removeJobExecutions()`, scripts `@Sql`, rollback `@Transactional`, saída fresca em `@TempDir` — e reserve `@DirtiesContext` para testes que realmente mutam o container.
- **`StepScopeTestExecutionListener` finge o scope, não o step.** Ele dá aos seus beans step-scoped um `StepContext` para que o SpEL resolva, mas nada abre o `ItemStream`, nenhuma transação é iniciada, nenhum chunk é comitado, e nenhuma contagem é registrada. Esquecer o `open(new ExecutionContext())` manual produz um reader que lê `null` para sempre — uma falha confusa com uma correção fácil.
- **Listener vs. `doInStepScope` é conveniência vs. controle.** O listener cobre o método inteiro com uma `StepExecution`; `doInStepScope` dá scope a um bloco e pode rodar várias execuções diferentes num teste. O livro se recusa a declarar um vencedor, e você também deveria.
- **Testes funcionais são o nível de maior confiança e maior custo.** Lançar um job inteiro exercita o grafo real contra um datasource real — o único teste que responde "o job funciona?" — mas é lento, depende de arquivos de fixture e estado de banco, e localiza falhas mal. Mantenha poucos deles, mantenha-os determinísticos, e coloque os casos de borda em testes unitários e de integração.
- **H2 em memória não é seu banco de produção.** Ele torna os testes rápidos e herméticos, mas diverge em dialeto, locking, isolamento, e coerção de tipo. Um step cujo SQL usa sintaxe específica de fornecedor, ou cujo comportamento depende de contenção de lock real, pode passar no H2 e falhar no Oracle — o argumento a favor do Testcontainers nos caminhos que importam.
- **Rerodar uma `JobInstance` completa falha por design, e os testes tropeçam nisso.** Job parameters identificadores idênticos significam a mesma instância, então uma segunda execução lança exception em vez de reexecutar. Ou você apaga o histórico (`removeJobExecutions()`) ou torna os parâmetros únicos (`getUniqueJobParameters()`) — mas note que eles diferem: apagar mantém as asserções contra um repositório limpo, unicidade deixa histórico acumulado para trás.
- **Livro vs. hoje: os nomes deprecated ainda compilam, e esse é o risco.** `JobLauncherTestUtils.launchJob(...)` e `@SpringBatchTest` com JUnit 4 funcionam ambos na 6.0 e ambos estão programados para remoção. Código de teste é a parte menos observada de uma base de código, então acumula silenciosamente a dívida de migração — migre para `JobOperatorTestUtils.startJob(...)` e para Jupiter quando você tocar no código, não quando a remoção chegar.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 14, "Testing batch applications", sections 14.3-14.5, "Integration testing" / "Functional testing" / "Summary", p. 425-437 — doc
- [Spring Batch Reference — Unit Testing (`@SpringBatchTest`, `JobOperatorTestUtils`, `StepScopeTestExecutionListener`, `MetaDataInstanceFactory`)](https://docs.spring.io/spring-batch/reference/testing.html) — doc
- [Spring Batch API — `@SpringBatchTest` (`org.springframework.batch.test.context`, since 4.1)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/context/SpringBatchTest.html) — doc
- [Spring Batch API — `JobOperatorTestUtils` (since 6.0: `startJob`, `startStep`)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/JobOperatorTestUtils.html) — doc
- [Spring Batch API — `JobLauncherTestUtils` (deprecated since 6.0, removal in 6.2 or later)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/JobLauncherTestUtils.html) — doc
- [Spring Batch API — `StepScopeTestExecutionListener` (`getStepExecution` factory method)](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/test/StepScopeTestExecutionListener.html) — doc
- [Spring Batch 6.0 Migration Guide — JUnit 4 deprecation, `spring-batch-infrastructure` package relocation](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
- [Spring Batch issue #4181 — Deprecate `AssertFile` (use JUnit 5 `assertLinesMatch` / AssertJ)](https://github.com/spring-projects/spring-batch/issues/4181) — doc
- [Spring Framework Reference — Executing SQL scripts in tests (`@Sql`)](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/executing-sql.html) — doc
- [Spring Framework Reference — Embedded database support (`EmbeddedDatabaseBuilder`)](https://docs.spring.io/spring-framework/reference/data-access/jdbc/embedded-database-support.html) — doc
- [Spring Framework Reference — TestContext support classes (`@SpringJUnitConfig`, `SpringExtension`)](https://docs.spring.io/spring-framework/reference/testing/testcontext-framework/support-classes.html) — doc
