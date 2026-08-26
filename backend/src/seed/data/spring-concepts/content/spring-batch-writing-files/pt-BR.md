---
version: 1.0
updatedAt: 2026-08-06
title: Escrevendo Arquivos no Spring Batch
summary: Como o contrato ItemWriter orientado a chunk do Spring Batch, junto com FlatFileItemWriter, StaxEventItemWriter e MultiResourceItemWriter, transforma objetos de domínio em saída delimitada, de largura fixa, XML e em conjuntos de arquivos rotativos, além dos builders modernos equivalentes e da realocação de pacote do 6.0.
---
## Objective

Escrever é a fase final do processamento orientado a chunk, e o Spring Batch modela isso com um único contrato que espelha o do reader: `ItemWriter<T>`. Enquanto o `read()` do reader retorna um item por vez, o `write(...)` do writer recebe o *chunk inteiro* como uma lista, em uma única chamada, uma vez por transação. Essa forma de "uma chamada por chunk" é todo o ponto — ela permite que um writer agrupe seu I/O (um batch JDBC, um flush de buffer, um commit) em vez de pagar um round-trip por item. Este conceito cobre a escrita em arquivos: arquivos flat delimitados e de largura fixa, XML e conjuntos de arquivos rotativos.

Para arquivos flat, o `FlatFileItemWriter` é o inverso exato do pipeline tokenize-then-map do reader: um `FieldExtractor` transforma cada item em um array de valores de campo, e um `LineAggregator` junta esse array em uma linha. Trocar aggregators e extractors cobre saída delimitada vs. largura fixa, campos computados e formatação por tipo, enquanto callbacks opcionais de header/footer e buffering transacional completam o arquivo. O `StaxEventItemWriter` faz o mesmo trabalho para XML através de um marshaller do Spring OXM, e o `MultiResourceItemWriter` faz o rollover da saída entre um conjunto de arquivos. O writer é a ponta de destino de um step em chunk (`spring-batch-chunk-processing`), e seu recurso de saída é tipicamente vinculado tardiamente a um parâmetro de job (`spring-batch-step-scope-and-spel-late-binding`).

## Use Cases

- Exportar um catálogo de produtos processado para um CSV delimitado por vírgula cujas colunas e ordem você controla por nome.
- Produzir um extrato de largura fixa para um mainframe downstream, cada campo preenchido com padrões de `java.util.Formatter`.
- Emitir uma linha de header mais um footer que reporta a contagem de escritas e o tempo decorrido da execução.
- Fazer o marshalling de objetos de domínio em um único documento XML em stream, sob uma tag raiz escolhida.
- Dividir uma exportação muito grande em arquivos limitados a N itens (`products.xml.1`, `.2`, …) para consumidores downstream.

## Deep Dive

### O contrato `ItemWriter`: um chunk inteiro por `write`

A fase de escrita depende de uma interface pequena. O livro de 2012 a mostra recebendo uma `List`:

```java
public interface ItemWriter<T> {
    void write(List<? extends T> items) throws Exception;
}
```

`write` é chamado **uma vez por chunk**, não uma vez por item — a imagem espelhada do `read()` por item do reader (`spring-batch-reading-flat-files`). O Spring Batch lê e (opcionalmente) processa itens um de cada vez, acumula-os, e então entrega a lista finalizada ao writer exatamente uma vez, logo antes de fazer commit da transação do chunk. A maioria dos writers "escreve um conjunto de itens de uma só vez", e é exatamente por isso que o parâmetro é uma lista: um writer JDBC pode emitir um único `PreparedStatement` em batch, e um writer de arquivo pode fazer flush do seu buffer uma única vez. Cabe a cada writer fazer o flush quando aplicável (um `FlatFileItemWriter` faz flush do stream subjacente; o `HibernateItemWriter` faz flush da sessão), depois do que o Spring Batch faz o commit. O tamanho do chunk — e, portanto, quantos itens chegam em cada `write` — é o commit interval (`spring-batch-chunk-processing`):

```xml
<tasklet>
  <chunk reader="itemReader" writer="itemWriter" commit-interval="100"/>
</tasklet>
```

(O tipo do parâmetro foi renomeado de `List` para `Chunk<? extends T>` no Spring Batch moderno — veja *Livro vs. hoje*.)

### `FlatFileItemWriter`: o inverso exato do reader

`FlatFileItemWriter` implementa `ItemWriter` e `ItemStream`, e escreve um arquivo em três passos: um header opcional (no `open` do stream), uma linha agregada por item, e um footer opcional (no `close` do stream). Transformar um item em uma linha é o inverso de ler: o reader usava um `LineTokenizer` para dividir uma linha em um `FieldSet` e um `FieldSetMapper` para construir o objeto; o writer usa um `FieldExtractor` para desmontar o objeto em um `Object[]`, e um `LineAggregator` para juntar esse array em uma `String`.

```java
public interface LineAggregator<T> { String aggregate(T item); }
public interface FieldExtractor<T>  { Object[] extract(T item); }
```

Um writer delimitado mínimo conecta um `DelimitedLineAggregator` (o delimitador padrão é a vírgula) em torno de um `BeanWrapperFieldExtractor`, que nomeia as propriedades a serem exibidas e chama seus getters reflexivamente — assim você decide exatamente quais campos, e em qual ordem, aparecem na linha:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.file.FlatFileItemWriter">
  <property name="resource" value="file:target/outputs/products.txt"/>
  <property name="shouldDeleteIfExists" value="true"/>
  <property name="lineAggregator">
    <bean class="org.springframework.batch.item.file.transform.DelimitedLineAggregator">
      <property name="delimiter" value=","/>
      <property name="fieldExtractor">
        <bean class="org.springframework.batch.item.file.transform.BeanWrapperFieldExtractor">
          <property name="names" value="id,price,name"/>
        </bean>
      </property>
    </bean>
  </property>
</bean>
```

`lineAggregator` é a única propriedade obrigatória; `PassThroughLineAggregator` (um `toString()` puro) é o fallback quando você não tem controle a nível de campo a exercer. Para saída de largura fixa, você troca por um `FormatterLineAggregator`, cujo `format` é um padrão de `java.util.Formatter` — `%-9s%6.2f%-30s` significa um id de 9 caracteres alinhado à esquerda, um preço de 6 caracteres com 2 decimais, depois um nome de 30 caracteres alinhado à esquerda. Quando a saída precisa de colunas derivadas, implemente `FieldExtractor` diretamente:

```java
public class ProductFieldExtractor implements FieldExtractor<Product> {
    public Object[] extract(Product item) {
        return new Object[] { "BEGIN", item.getId(), item.getPrice(),
                item.getPrice().multiply(new BigDecimal("0.15")), // computed tax
                item.getName(), "END" };
    }
}
```

Para um arquivo que mistura tipos (telefones e livros), um `LineAggregator` customizado pode delegar para um mapa de aggregators por `Class` — o equivalente do lado de escrita ao `PatternMatchingCompositeLineMapper` do reader.

### Headers, footers e saída transacional

Um header é escrito antes de qualquer item, um footer depois do último, através dos callbacks de método único `FlatFileHeaderCallback` (`writeHeader(Writer)`) e `FlatFileFooterCallback` (`writeFooter(Writer)`). Um footer geralmente reporta estatísticas da execução, então precisa da `StepExecution` — o callback também implementa `StepExecutionListener` para capturá-la:

```java
public class ProductFooterCallback implements FlatFileFooterCallback, StepExecutionListener {
    private StepExecution stepExecution;
    public void writeFooter(Writer writer) throws IOException {
        writer.write("# Write count: " + stepExecution.getWriteCount());
    }
    public void beforeStep(StepExecution stepExecution) { this.stepExecution = stepExecution; }
}
```

(O livro estende `StepExecutionListenerSupport`, uma classe base de conveniência que o Spring Batch 6.0 remove agora que as interfaces de listener carregam métodos default — implemente a interface diretamente.) Registre o callback como um listener de step *e* configure-o como o `footerCallback` do writer.

Duas propriedades governam o ciclo de vida do arquivo: `shouldDeleteIfExists` (padrão `true`, então cada execução começa do zero) e `appendAllowed` (padrão `false`; defina como `true` para anexar a um arquivo existente em vez disso). A terceira, `transactional` (padrão `true`), é o que torna a saída de arquivo segura dentro de um chunk: o writer armazena em buffer as linhas agregadas do chunk e só as escreve no SO quando a transação faz commit, descartando o buffer em caso de rollback, de modo que um chunk que falhou nunca deixa linhas parcialmente escritas ou duplicadas. O Javadoc de `ItemWriter` afirma a mesma regra — `write` "é responsável por garantir que quaisquer buffers internos sejam esvaziados [e] por descartar a saída em um rollback subsequente."

### Escrevendo XML com `StaxEventItemWriter`

`StaxEventItemWriter` é a simetria do lado de escrita do `StaxEventItemReader` (`spring-batch-reading-xml-and-multiple-resources`). Ele faz streaming com StAX (então o heap se mantém estável independentemente do tamanho da saída) e delega cada conversão objeto → XML para um `Marshaller` do Spring OXM, envolvendo cada fragmento dentro de `rootTagName`:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.xml.StaxEventItemWriter">
  <property name="resource" value="file:target/outputs/products.xml"/>
  <property name="marshaller" ref="productMarshaller"/>
  <property name="rootTagName" value="products"/>
  <property name="overwriteOutput" value="true"/>
</bean>

<bean id="productMarshaller" class="org.springframework.oxm.xstream.XStreamMarshaller">
  <property name="aliases">
    <map><entry key="product" value="com.manning.sbia.ch06.Product"/></map>
  </property>
</bean>
```

O resultado é uma raiz `<products>` contendo um elemento `<product>` por item. Headers e footers aqui implementam `StaxWriterCallback` e constroem eventos com uma `XMLEventFactory` (por exemplo, um atributo `generated` ou um elemento `<writeCount>`), alcançando a `StepExecution` da mesma forma via listener que o footer do arquivo flat. Assim como o writer de arquivo flat, ele respeita o buffering `transactional`. O livro conecta um `XStreamMarshaller` porque ele não precisa de anotações, mas o histórico de CVEs de desserialização do XStream torna o JAXB o padrão mais seguro hoje — o mesmo trade-off coberto no lado de leitura.

### Escrevendo conjuntos de arquivos com `MultiResourceItemWriter`

Quando um único arquivo de saída enorme é indesejável, o `MultiResourceItemWriter` faz rollover para um novo arquivo a cada N itens. Ele mesmo não escreve nada: injeta um `Resource` novo em um `delegate` (qualquer `ResourceAwareItemWriterItemStream` — um `StaxEventItemWriter` aqui, ou um `FlatFileItemWriter`) cada vez que `itemCountLimitPerResource` é atingido.

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.file.MultiResourceItemWriter" scope="step">
  <property name="resource" value="file:target/outputs/products-multi.xml"/>
  <property name="itemCountLimitPerResource" value="10000"/>
  <property name="delegate" ref="delegateWriter"/>
</bean>
```

Com 40.100 itens e um limite de 10.000, você obtém cinco arquivos — quatro de 10.000 e um de 100. Por padrão, os nomes de arquivo recebem um índice numérico como sufixo (`products-multi.xml.1`, `.2`, …); forneça seu próprio esquema com um `ResourceSuffixCreator`:

```java
public interface ResourceSuffixCreator { String getSuffix(int index); }
```

Uma sutileza: o rollover acontece em um **limite de chunk**, não no meio de um chunk — um novo recurso é criado após o commit interval *assim que* a contagem é atingida, então o commit interval interage com onde os arquivos são divididos. Este é a contraparte de saída do `MultiResourceItemReader` (`spring-batch-reading-xml-and-multiple-resources`), e funciona tanto para arquivos flat quanto para XML.

### Livro vs. hoje: builders substituem o XML (e a mudança de pacote do 6.0)

Desde o **Spring Batch 4** (`FlatFileItemWriterBuilder` e `StaxEventItemWriterBuilder` são ambos `@since 4.0`), builders fluentes substituem a configuração via `<bean>`: `.delimited()`/`.formatted()` constroem o aggregator + `BeanWrapperFieldExtractor` para você, e `.names(...)` define os campos.

```java
@Bean
public FlatFileItemWriter<Product> productItemWriter(WritableResource out) {
    return new FlatFileItemWriterBuilder<Product>()
            .name("productItemWriter")
            .resource(out)
            .shouldDeleteIfExists(true)
            .delimited().delimiter(",")
            .names("id", "price", "name")
            .build();                      // .formatted().format("%-9s%6.2f%-30s") for fixed-width
}

@Bean
public StaxEventItemWriter<Product> productXmlWriter(WritableResource out, Marshaller marshaller) {
    return new StaxEventItemWriterBuilder<Product>()
            .name("productXmlWriter")
            .resource(out).marshaller(marshaller)
            .rootTagName("products").overwriteOutput(true)
            .build();
}
```

Dois fatos de versão para citar com precisão. Primeiro, o próprio contrato: o Spring Batch **5.0** substituiu o parâmetro `List` por um `Chunk`, e o **6.0** realocou as classes de infraestrutura para fora de `org.springframework.batch.item.*` (esses caminhos pré-6.0 agora retornam 404):

```java
package org.springframework.batch.infrastructure.item;   // was org.springframework.batch.item

public interface ItemWriter<T> {
    void write(Chunk<? extends T> chunk) throws Exception;
}
```

Então, hoje, `FlatFileItemWriter` e `MultiResourceItemWriter` vivem em `org.springframework.batch.infrastructure.item.file`, `StaxEventItemWriter` em `org.springframework.batch.infrastructure.item.xml`, e os builders nos sub-pacotes `...builder` correspondentes. Segundo, o namespace XML `batch:` usado ao longo do livro está deprecated desde o 6.0 (remoção planejada para o 7.0), então Java config mais builders é o estilo recomendado, e não apenas uma conveniência opcional. Confirmado via o Javadoc da API do Spring Batch 6.0.x (`ItemWriter`, `FlatFileItemWriter`, `StaxEventItemWriter`, `MultiResourceItemWriter`, `FlatFileItemWriterBuilder`, `StaxEventItemWriterBuilder`) e a referência do Spring Batch (Flat Files; XML Item Readers and Writers).

## Trade-offs

- **Saída delimitada vs. largura fixa** — `DelimitedLineAggregator` é compacto e tolerante a comprimentos de campo variáveis, mas quebra se os dados contiverem um delimitador não escapado; `FormatterLineAggregator` é autodescritivo posicionalmente e seguro quanto a delimitadores, mas maior, e frágil se a largura de uma coluna mudar. Combine o aggregator com o consumidor, não com o gosto pessoal.
- **`BeanWrapperFieldExtractor` vs. um `FieldExtractor` customizado** — o extractor bean-wrapper é zero código quando você só quer nomear propriedades existentes, mas só consegue emitir valores que já existem como getters. Um extractor escrito à mão é mais código, mas permite reordenar, adicionar marcadores ou computar campos que o objeto não armazena:
  ```java
  return new Object[] { item.getId(), item.getPrice().multiply(TAX_RATE) }; // derived column
  ```
- **Escrita transacional ligada vs. desligada** — `transactional=true` faz buffer de cada chunk e o descarta em caso de rollback, então um chunk que falhou nunca deixa linhas incompletas ou duplicadas; o custo é manter as linhas do chunk em memória até o commit. Desligar isso faz streaming direto, trocando essa segurança por um pouco menos de buffering.
- **Um arquivo vs. um conjunto de arquivos** — um único writer é a coisa mais simples que funciona; `MultiResourceItemWriter` limita o tamanho do arquivo para ferramentas downstream, mas só divide em limites de chunk e adiciona nomes de arquivo com sufixo de índice que os consumidores precisam fazer glob e ordenar.
- **Marshaller XStream vs. JAXB** — `XStreamMarshaller` não precisa de anotações (só um mapa de aliases) e é o mais rápido de configurar, mas não é tipado e carrega o histórico de CVEs de desserialização do XStream; `Jaxb2Marshaller` exige classes vinculadas mas é verificado por tipo e é o padrão recomendado — a mesma simetria de leitura/escrita observada em `spring-batch-reading-xml-and-multiple-resources`.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 6, "Writing data", sections 6.1-6.2, "Data-writing concepts" / "Writing files", p. 158-179 — doc
- [Spring Batch Reference — Flat Files (`FlatFileItemWriter`)](https://docs.spring.io/spring-batch/reference/readers-and-writers/flat-files.html) — doc
- [Spring Batch Reference — XML Item Readers and Writers (`StaxEventItemWriter`)](https://docs.spring.io/spring-batch/reference/readers-and-writers/xml-reading-writing.html) — doc
