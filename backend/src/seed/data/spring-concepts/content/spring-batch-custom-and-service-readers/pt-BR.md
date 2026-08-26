---
version: 1.0
updatedAt: 2026-08-06
title: "ItemReaders Customizados e de Serviço no Spring Batch"
---
## Objective

Arquivos e bancos de dados cobrem a maior parte do input de batch, mas às vezes os
dados vivem atrás de um serviço Spring existente, chegam numa destination JMS, ou
estão numa fonte para a qual o Spring Batch não distribui nenhum reader. Os três casos
ainda se reduzem ao mesmo contrato de um método: `ItemReader<T>.read()` retorna o
próximo item, ou `null` no fim do input, alimentando um item por vez num chunk step
(veja `spring-batch-chunk-processing`). Este conceito cobre três formas de originar
esse input — reaproveitando um método de bean, drenando uma fila, e escrevendo um
reader na mão.

`ItemReaderAdapter` transforma qualquer método de bean existente num reader;
`JmsItemReader` puxa uma mensagem por `read()`; e um `ItemReader` customizado
implementa o contrato diretamente, adicionando `ItemStream` quando precisa ser
restartable. Diferente do `FlatFileItemReader` (`spring-batch-reading-flat-files`) ou
dos readers cursor e paging de JDBC/JPA (`spring-batch-database-item-readers`), o
adapter e os readers JMS não persistem automaticamente sua posição, então retomar de
onde parou é algo que você abre mão ou implementa você mesmo em cima do execution
context.

## Use Cases

- Reaproveitar um `ProductService` existente (um POJO, um DAO, ou um proxy EJB3
  remoto) que já retorna objetos de domínio, em vez de duplicar sua lógica de acesso a
  dados dentro de um reader.
- Drenar uma fila ou tópico JMS durante uma janela de batch agendada para conter o
  ritmo de um processamento custoso, em vez de reagir a cada mensagem no instante em
  que ela chega.
- Ler de uma fonte sem reader embutido — listando arquivos de um diretório, percorrendo
  uma estrutura em memória, ou paginando uma API web remota.
- Tornar um reader escrito à mão restartable para que um job que falhou retome no
  próximo item não lido em vez de reler tudo desde o início.

## Deep Dive

### Reaproveitando um serviço Spring como reader: `ItemReaderAdapter`

`ItemReaderAdapter` delega cada `read()` a um método configurado num bean alvo. O
contrato é restrito: o método delegate precisa não receber **parâmetro nenhum** e
retornar **um item** do tipo do reader (ou `null` no fim). Como serviços normalmente
devolvem uma `List` inteira, você envolve o serviço num adapter fino que distribui
elementos um de cada vez:

```java
public class ProductServiceAdapter implements InitializingBean {
    private ProductService productService;
    private List<Product> products;

    public void afterPropertiesSet() {
        this.products = productService.getProducts();   // load once at startup
    }

    public Product nextProduct() {                      // no args, one item or null
        return products.isEmpty() ? null : products.remove(0);
    }

    public void setProductService(ProductService productService) {
        this.productService = productService;
    }
}
```

`targetObject` mais `targetMethod` são toda a configuração — a cada `read()` o adapter
invoca `nextProduct()` e retorna o resultado:

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.adapter.ItemReaderAdapter">
  <property name="targetObject" ref="productServiceAdapter"/>
  <property name="targetMethod" value="nextProduct"/>
</bean>

<bean id="productServiceAdapter"
      class="com.manning.sbia.reading.service.ProductServiceAdapter">
  <property name="productService" ref="productService"/>
</bean>
```

A mesma configuração de reader funciona para um EJB3 remoto se você trocar o delegate
por um proxy `<jee:remote-slsb>` — o Spring Remoting (Hessian/Burlap) faz o serviço
remoto parecer local. A pegadinha: o delegate está inteiramente fora do Spring Batch,
então nada é escrito no execution context e esse reader **não é restartable**.

### Lendo de uma fila: `JmsItemReader`

O Spring Batch monta seu suporte a JMS em cima do `JmsTemplate` do Spring. Cada
`read()` recebe um payload de mensagem da destination default do template:

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.jms.JmsItemReader">
  <property name="itemType" value="com.manning.sbia.reading.Product"/>
  <property name="jmsTemplate" ref="jmsTemplate"/>
</bean>

<bean id="jmsTemplate" class="org.springframework.jms.core.JmsTemplate">
  <property name="connectionFactory" ref="jmsFactory"/>
  <property name="defaultDestination" ref="productDestination"/>
  <property name="receiveTimeout" value="500"/>
  <property name="sessionTransacted" value="true"/>
</bean>
```

`itemType` diz ao reader a classe do payload (defina como `Message` para receber a
mensagem JMS crua). Por que ler uma fila a partir de um batch, se JMS é orientado a
eventos? Para **conter o ritmo**: você adia o processamento custoso para uma janela
escolhida (à noite, a cada dez minutos) e dosifica a carga de hardware em vez de
processar cada chegada imediatamente.

A ressalva transacional importa aqui. O consumo JMS é transacional, então um chunk que
sofre rollback pode fazer com que a mesma mensagem seja **reentregue** — o próprio
contrato de `ItemReader.read()` avisa que "num contexto transacional, o caller pode
receber o mesmo item duas vezes ... se a primeira chamada estava numa transação que
sofreu rollback." Um step alimentado por JMS precisa, portanto, tolerar duplicatas com
escritas idempotentes ou chaves de deduplicação, o que se conecta diretamente com o
tratamento de retry e skip (`spring-batch-fault-tolerant-step-configuration`).

### Escrevendo um `ItemReader` customizado (e tornando-o restartable)

Quando nenhum reader embutido serve, implemente `ItemReader<T>` diretamente. O contrato
inteiro é um método: retornar itens um a um, e `null` para sinalizar fim de input. O
Spring Batch chama `read()` até que ele retorne `null`:

```java
public class ListDirectoryItemReader implements ItemReader<File> {
    private final List<File> files;

    public ListDirectoryItemReader(File directory) {
        if (directory == null || !directory.isDirectory()) {
            throw new IllegalArgumentException("The specified file must be a directory.");
        }
        this.files = new ArrayList<>(Arrays.asList(directory.listFiles()));
    }

    public File read() {
        return files.isEmpty() ? null : files.remove(0);
    }
}
```

Isso funciona, mas é stateful e esquece sua posição: num restart ele começa do zero.
Para retomar de onde parou, também implemente `ItemStream` — ou o combinado
`ItemStreamReader` — que adiciona três hooks de ciclo de vida ao redor de `read()` que
salvam e restauram a posição no `ExecutionContext` do step:

```java
public class ListDirectoryItemReader implements ItemStreamReader<File> {
    private static final String INDEX_KEY = "current.index";
    private List<File> files;
    private int currentIndex = 0;

    public File read() {
        return currentIndex < files.size() ? files.get(currentIndex++) : null;
    }

    public void open(ExecutionContext ctx) throws ItemStreamException {
        currentIndex = ctx.containsKey(INDEX_KEY) ? (int) ctx.getLong(INDEX_KEY) : 0;
    }

    public void update(ExecutionContext ctx) throws ItemStreamException {
        ctx.putLong(INDEX_KEY, currentIndex);          // persisted at each chunk commit
    }

    public void close() throws ItemStreamException { }
}
```

O Spring Batch chama `open` uma vez quando o step começa (restaurando `current.index`
se uma execução anterior o armazenou), `update` a cada commit de chunk (então a última
posição é salva dentro da mesma transação), e `close` no final. Como a posição viaja no
`ExecutionContext` persistido — o mesmo mecanismo que os readers embutidos de arquivo e
banco de dados usam (`spring-batch-reading-flat-files`,
`spring-batch-database-item-readers`) e que listeners de step/job também conseguem ler
(`spring-batch-execution-listeners`) — um restart retoma no próximo item não lido. O
adapter e os readers JMS acima pulam essa contabilidade, então eles não são
restartable de fábrica.

### Livro vs. hoje: contratos inalterados, classes realocadas na 6.0

Duas coisas valem a pena destacar desde 2012 (o livro visa o Spring Batch 2.x com
configuração XML).

Primeiro, as abstrações permanecem inalteradas: `ItemReaderAdapter`, o contrato de
`read()`-retorna-`null`, e `ItemStream`/`ItemStreamReader` (`open`/`update`/`close`)
continuam funcionando da mesma forma. O que mudou foi onde elas moram. O Spring Batch
6.0 moveu as classes de item da infraestrutura de `org.springframework.batch.item.*`
para `org.springframework.batch.infrastructure.item.*`, então hoje é
`org.springframework.batch.infrastructure.item.adapter.ItemReaderAdapter`,
`...infrastructure.item.jms.JmsItemReader`, e
`...infrastructure.item.ItemStreamReader` (os caminhos do Javadoc pré-6.0 agora dão
404). O estilo de configuração também mudou: o namespace XML `batch:` está deprecated
na 6.0, então você registra esses readers como `@Bean`s Java (configurando
`targetObject`/`targetMethod` via setters para o adapter). `JmsItemReader`
adicionalmente ganhou um construtor que injeta o template `JmsOperations` (desde a
6.0), refletindo o movimento da 6.0 em direção à injeção via construtor, embora seu
setter `jmsTemplate` permaneça.

Segundo, `JmsItemReader` ainda existe na 6.0, mas puxar mensagens através de um reader
de batch é nicho hoje em dia. A ingestão orientada a mensagens costuma ser tratada pela
stack de mensageria do Spring — um `@JmsListener` ou um binder do Spring Cloud
Stream — que deposita as mensagens numa store (uma tabela, um log, object storage), que
um batch simples de banco de dados ou arquivo então lê com um reader restartable. Isso
mantém o step restartable e idempotente em vez de brigar com a reentrega do JMS dentro
do chunk. Confirmado pelo Javadoc da API do Spring Batch 6.0.x para `ItemReaderAdapter`
e `JmsItemReader` (ambos agora sob `org.springframework.batch.infrastructure.item.*`) e
a referência do Spring Batch "Creating Custom ItemReaders and ItemWriters".

## Trade-offs

- **Reaproveitar com `ItemReaderAdapter` vs. sem restart** — Envolver um serviço
  existente é código quase zero e evita duplicar lógica de acesso a dados, mas o
  delegate vive fora do Spring Batch, então nada é escrito no execution context; uma
  falha no meio da execução reinicia a leitura do zero. Bom para cargas pequenas ou
  idempotentes, arriscado para cargas longas.
- **Carregar tudo de uma vez vs. streaming** — O adapter do livro carrega o resultado
  inteiro de `getProducts()` em memória em `afterPropertiesSet()` e distribui elementos;
  isso é simples mas anula o streaming e pode esgotar o heap em conjuntos grandes. Um
  delegate que genuinamente pagina ou faz streaming de um item por chamada escala muito
  melhor.
- **Reader JMS vs. orientado a mensagens + store** — Um `JmsItemReader` permite que um
  batch agendado controle o ritmo do processamento de mensagens, mas um chunk com
  rollback pode reentregar mensagens, forçando escritas idempotentes e tratamento de
  duplicatas. Depositar mensagens numa store via `@JmsListener`/Spring Cloud Stream e
  fazer batch em cima dessa store evita a reentrega e mantém o step cleanly
  restartable.
- **`ItemReader` customizado vs. `ItemStreamReader`** — Implementar só `read()` é o
  código mínimo e perfeitamente correto para fontes stateless; o guia de referência
  recomenda permanecer stateless quando possível. Adicione `ItemStream` só quando
  retomar-de-onde-parou importar, já que aí você assume a contabilidade e a correção de
  `open`/`update`/`close`.
- **Construir vs. reaproveitar um reader** — Antes de escrever um reader customizado,
  confira os embutidos (flat file, XML, JDBC/JPA, adapter); um reader customizado
  significa que você assume paginação, buffering, e semântica de restart que os readers
  já distribuídos já fornecem. Recorra ao customizado só quando nenhuma fonte embutida
  serve.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 5, "Reading data", sections 5.6-5.8, "Services as input" / "Reading from JMS" / "Implementing custom readers", p. 151-156 — doc
- [Spring Batch Reference — Creating Custom ItemReaders and ItemWriters](https://docs.spring.io/spring-batch/reference/readers-and-writers/custom.html) — doc
- [Spring Batch 6.0 API — ItemReaderAdapter (org.springframework.batch.infrastructure.item.adapter)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/adapter/ItemReaderAdapter.html) — doc
- [Spring Batch 6.0 API — JmsItemReader (org.springframework.batch.infrastructure.item.jms)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/jms/JmsItemReader.html) — doc
