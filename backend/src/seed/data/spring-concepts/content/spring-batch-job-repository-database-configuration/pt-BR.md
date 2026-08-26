---
version: 1.0
updatedAt: 2026-08-03
title: Job Repository no Spring Batch: Escolhendo e Configurando a Camada de Persistência
---
## Objective

O job repository é o que transforma os objetos de domínio do Spring Batch —
`Job`, `JobInstance`, `JobExecution`, `StepExecution` — de estado em memória
para dados nos quais uma infraestrutura de batch consegue confiar entre
restarts e entre nós. O Spring Batch fornece exatamente uma implementação de
`JobRepository`, a `SimpleJobRepository`, mas a apoia em dois tipos
intercambiáveis de DAO: em memória (sem persistência) e baseado em JDBC
(persistente). O elemento XML `<batch:job-repository>` do livro e seus
atributos — `data-source`, `transaction-manager`,
`isolation-level-for-create`, `table-prefix`, `max-varchar-length`,
`lob-handler` — configuram o DAO persistente. Hoje os mesmos atributos são
definidos via `@EnableJdbcJobRepository`, e o padrão em memória mudou de
implementação por completo.

## Use Cases

- Rodar um job batch de curta duração e não reiniciável (um teste de
  integração, um script pontual) onde persistir metadados de execução num
  banco de dados é puro overhead — o repositório em memória já é suficiente.
- Rodar uma importação de produção que precisa sobreviver a uma queda do
  processo: o repositório JDBC persiste linhas de
  `JobInstance`/`JobExecution`/`StepExecution` para que uma execução falha
  possa ser identificada e reiniciada a partir do último step concluído.
- Executar o mesmo job a partir de vários nós (um scheduler em cluster,
  várias instâncias da aplicação atrás de um load balancer) e precisar da
  garantia de que dois nós nunca criem acidentalmente duas `JobInstance`
  para o que deveria ser uma única execução lógica — é exatamente disso que
  `isolation-level-for-create` protege.
- Rodar as tabelas do Spring Batch junto de outras tabelas num schema
  compartilhado sem colisão de nomes, dando às tabelas de batch um prefixo
  distinto.

## Deep Dive

### `JobRepository`, `SimpleJobRepository` e seus dois tipos de DAO

O Spring Batch fornece a interface `JobRepository` para a infraestrutura de
batch interagir (o capítulo 2, seção 2.2.1, a apresenta) e exatamente uma
implementação, `SimpleJobRepository`, construída sobre um conjunto de Data
Access Objects. O Spring Batch fornece dois tipos de DAO nesse nível:

- **Em memória**, sem persistência — bom para testes, mas os metadados de
  batch se perdem entre execuções do job, então não deve ser usado em
  produção.
- **Persistente**, apoiado em JDBC — o DAO a usar para processamento batch
  robusto com verificações na inicialização e suporte a restart, ao custo de
  precisar de um data source e um transaction manager na configuração.

### O XML do livro: job repository em memória

```xml
<bean id="jobRepository"
      class="org.springframework.batch.core.repository.support.MapJobRepositoryFactoryBean">
  <property name="transactionManager-ref" ref="transactionManager"/>
</bean>

<bean id="transactionManager"
      class="org.springframework.batch.support.transaction.ResourcelessTransactionManager"/>

<batch:job id="importInvoicesJob" job-repository="jobRepository">
  (...)
</batch:job>
```

`MapJobRepositoryFactoryBean` constrói o repositório em memória; como não há
um datastore real por trás dele, é combinado com
`ResourcelessTransactionManager`, uma implementação NOOP (`NO OPeration`) de
`PlatformTransactionManager`. O job então referencia o bean do repositório
através do seu atributo `job-repository`.

### O XML do livro: job repository persistente e seus atributos

```xml
<bean id="dataSource" class="org.apache.commons.dbcp.BasicDataSource" destroy-method="close">
  <property name="driverClassName" value="${batch.jdbc.driver}"/>
  <property name="url" value="${batch.jdbc.url}"/>
  <property name="username" value="${batch.jdbc.user}"/>
  <property name="password" value="${batch.jdbc.password}"/>
</bean>

<bean id="transactionManager" lazy-init="true"
      class="org.springframework.jdbc.datasource.DataSourceTransactionManager">
  <property name="dataSource" ref="dataSource"/>
</bean>

<batch:job-repository id="jobRepository"
                data-source="dataSource"
                transaction-manager="transactionManager"
                isolation-level-for-create="SERIALIZABLE"
                table-prefix="BATCH_"/>

<batch:job id="importInvoicesJob" job-repository="jobRepository">
  (...)
</batch:job>
```

Os atributos do elemento `job-repository` (tabela 3.8 do livro):

| Atributo | Obrigatório? | Padrão | Significado |
|---|---|---|---|
| `data-source` | sim | `dataSource` | Id do bean do data source usado para acessar o banco |
| `transaction-manager` | sim | `transactionManager` | Id do bean do transaction manager do Spring para as transações do job repository |
| `isolation-level-for-create` | sim | `SERIALIZABLE` | Nível de isolamento usado ao criar execuções de job |
| `max-varchar-length` | não | não indicado pelo livro | Comprimento máximo para colunas `VARCHAR` (ex.: mensagens de saída) |
| `table-prefix` | não | `BATCH_` | Prefixo usado para identificar as tabelas do job repository |
| `lob-handler` | não | — | Handler para colunas LOB; só necessário para Oracle ou quando o Spring Batch não consegue detectar o tipo de banco |

### Por que `isolation-level-for-create` tem `SERIALIZABLE` como padrão

O livro enquadra esse atributo como a resposta do job repository a uma
questão de concorrência: o que acontece se o mesmo job do Spring Batch for
executado a partir de nós físicos diferentes ao mesmo tempo? Há um risco real
de criar a mesma `JobInstance` duas vezes, o que é ruim para os metadados —
o Spring Batch não teria como decidir de forma sensata qual das duas
instâncias reiniciar. O job repository age como uma salvaguarda centralizada
ao criar entidades como instâncias de job, confiando nas capacidades
transacionais do banco de dados subjacente para sincronizar criadores
concorrentes. `SERIALIZABLE` (ou o igualmente suficiente `REPEATABLE_READ`) é
agressivo o bastante para prevenir essa corrida, o que é precisamente o que
permite ao Spring Batch ser distribuído entre vários nós sem iniciar a mesma
instância duas vezes por uma coincidência de timing.

### Hoje: `@EnableJdbcJobRepository`

A configuração em Java do job repository passou pelo `JobRepositoryFactoryBean`
durante a maior parte da vida 4.x/5.x do Spring Batch, e mudou de novo no
Spring Batch 6.0. `@EnableBatchProcessing` agora configura só os atributos
comuns a qualquer store; atributos específicos de store migraram para
anotações dedicadas — `@EnableJdbcJobRepository` para JDBC,
`@EnableMongoJobRepository` para MongoDB:

```java
@Configuration
@EnableBatchProcessing
@EnableJdbcJobRepository(
    dataSourceRef = "batchDataSource",
    transactionManagerRef = "batchTransactionManager",
    tablePrefix = "BATCH_",
    maxVarCharLength = 1000,
    isolationLevelForCreate = "SERIALIZABLE")
public class BatchConfig {
    // job and step beans
}
```

Cada atributo do livro tem um mapeamento direto: `data-source`→
`dataSourceRef`, `transaction-manager`→`transactionManagerRef`,
`table-prefix`→`tablePrefix`, `max-varchar-length`→`maxVarCharLength`,
`isolation-level-for-create`→`isolationLevelForCreate`. Dois atributos são
novos desde o livro: `databaseType` (para forçar um dialeto SQL específico
quando a auto-detecção a partir do `DataSource` não consegue determinar) e
`incrementerFactoryRef` (sobrescreve a estratégia de incrementer de chave
primária para plataformas cujos padrões não se encaixam — este é o mais
próximo que existe hoje de um botão de "adaptação de schema/plataforma",
distinto do *versionamento* de schema, que o Spring Batch não expõe de forma
alguma como atributo de configuração).

Duas coisas por trás dos panos mudaram mais do que os nomes dos atributos:

- `JobRepositoryFactoryBean` — a classe que a maioria das configurações Java
  4.x/5.x constrói diretamente — está depreciada desde a 6.0 em favor de
  `JdbcJobRepositoryFactoryBean`, com remoção agendada para a 6.2+.
- O padrão em memória não é mais `MapJobRepositoryFactoryBean`. Quando
  `@EnableBatchProcessing` é usado sem nenhum repositório JDBC configurado, o
  Spring Batch usa por padrão `ResourcelessJobRepository`: não é thread-safe,
  não é utilizável para steps concorrentes ou particionados, e não
  compartilha execution context entre steps — um encaixe exatamente para o
  caso "job pontual e não reiniciável" que o livro já recomenda o DAO em
  memória, só que com uma classe diferente por trás.

Também vale saber ao ler código atual: `JobExplorer` (uma visão somente
leitura sobre os mesmos metadados) está depreciado desde a 6.0, com remoção
agendada para a 6.2+, porque `JobRepository` agora estende diretamente
`JobExplorer` — um bean agora cobre as duas responsabilidades onde a API da
era do livro precisava de duas.

## Trade-offs

- **O repositório em memória é uma ferramenta de teste/execução pontual, não
  um atalho de produção.** Livro e documentação atual concordam: sem
  persistência entre execuções não há suporte a restart, e o atual
  `ResourcelessJobRepository` acrescenta "não thread-safe" e "sem suporte a
  step particionado" a isso — escolha-o deliberadamente para um job que
  genuinamente roda uma vez e não precisa sobreviver a uma queda, não como
  forma de pular a configuração de um data source.
- **`SERIALIZABLE` como padrão de `isolation-level-for-create` troca um
  pouco de contenção por correção.** Ele só protege o momento em que uma
  linha de execução de job é criada, não o job inteiro — mas um nível de
  isolamento agressivo ali é um seguro barato contra uma corrida multi-nó
  criando `JobInstance` duplicadas. Reduzi-lo (`READ_COMMITTED` costuma
  bastar, `READ_UNCOMMITTED` se execuções concorrentes do mesmo job forem
  improváveis) é uma opção real e documentada, não apenas teoricamente
  disponível — troca esse seguro por menos contenção de lock nas tabelas de
  metadados sob alta concorrência de disparo de job.
- **`table-prefix` só renomeia o prefixo, não o layout de tabelas ou
  colunas.** É suficiente para evitar colisão de nome com outras tabelas num
  schema compartilhado (ex.: `SYSTEM.TEST_JOB_EXECUTION` em vez de
  `BATCH_JOB_EXECUTION`), mas não pode ser usado para remodelar o schema em
  si — os nomes de tabela e coluna que o Spring Batch espera são fixos, tanto
  na forma XML quanto em `@EnableJdbcJobRepository`.
  ```java
  @EnableJdbcJobRepository(tablePrefix = "SYSTEM.TEST_")
  // BATCH_JOB_EXECUTION -> SYSTEM.TEST_JOB_EXECUTION, column names unchanged
  ```
- **`max-varchar-length` troca espaço de armazenamento/índice por quanto de
  um parâmetro de job ou mensagem de saída sobrevive ao truncamento.** Um
  padrão pequeno demais para um job com valores de parâmetro longos ou
  descrições de saída verbosas trunca esses dados silenciosamente nas
  tabelas de metadados; grande demais desperdiça espaço num schema com
  muitas execuções de job. Book vs. today: o livro declara o propósito do
  atributo mas não seu padrão; a documentação de referência atual dá um
  número concreto, `2500`, batendo com as colunas `VARCHAR` longas dos
  scripts de schema de exemplo.
- **Book vs. today: `lob-handler` desapareceu, não só foi renomeado.** O
  livro o trata como um atributo opcional necessário para Oracle ou um tipo
  de banco não detectado. `setLobHandler()` no
  `JobRepositoryFactoryBean`/`JdbcJobRepositoryFactoryBean` moderno está
  depreciado desde o Spring Batch 5.2 sem substituto oferecido, e está
  agendado para remoção — o tratamento de LOB hoje é resolvido
  automaticamente a partir do tipo de banco detectado em vez de ser uma
  válvula de escape manual.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 3, "Batch configuration", section 3.3, "Configuring the job repository", p. 72-75 — doc
- [Spring Batch Reference — Configuring a JobRepository (@EnableJdbcJobRepository, JdbcJobRepositoryFactoryBean)](https://docs.spring.io/spring-batch/reference/job/configuring-repository.html) — doc
- [Spring Batch Reference — What's New in Spring Batch 6 (JobRepository now extends JobExplorer)](https://docs.spring.io/spring-batch/reference/whatsnew.html) — doc
- [Spring Batch API — Deprecated List (lobHandler / setLobHandler removal)](https://docs.spring.io/spring-batch/docs/current/api/deprecated-list.html) — doc
