---
version: 1.0
updatedAt: 2026-08-06
title: Lendo XML e Múltiplos Resources no Spring Batch
---
## Objective

A entrada de um batch nem sempre é um único arquivo flat. Duas outras formas são comuns: um documento XML grande, e um *diretório* inteiro de arquivos chegando via FTP ou SCP. O Spring Batch lê os dois sem carregar tudo em memória. `StaxEventItemReader` faz streaming de um documento XML um fragmento por vez — casando um nome de elemento raiz e entregando cada fragmento a um `Unmarshaller` do Spring OXM que o transforma num objeto de domínio. `MultiResourceItemReader` envolve um *único* `ItemReader` delegate (um `FlatFileItemReader`, um `StaxEventItemReader`) e o alimenta com um array ordenado de `Resource`s, para que um step processe um conjunto de arquivos inteiro como um único stream de itens contínuo.

Os dois preservam o modelo chunk-oriented, item por vez, que mantém o Spring Batch estável em memória (veja `spring-batch-chunk-processing`), e os dois são `ItemStream`s, então persistem sua posição e conseguem retomar no meio de um arquivo depois de um restart.

## Use Cases

- Importar uma exportação XML de vários gigabytes (catálogo de produtos, feed de negociação) onde carregar o documento inteiro com DOM esgotaria o heap.
- Ligar cada fragmento XML diretamente a um objeto de domínio através do Spring OXM, reutilizando o mesmo marshaller para leitura e escrita.
- Processar cada arquivo depositado num diretório de entrada (`file:data/input/*.xml`) num único step, sem saber os nomes exatos dos arquivos de antemão.
- Aplicar uma única definição de reader — arquivo flat ou XML — uniformemente sobre um conjunto de arquivos formatados de forma idêntica, e depois reiniciar exatamente onde uma execução que falhou parou.

## Deep Dive

### `StaxEventItemReader`: streaming de fragmentos XML através de um `Unmarshaller`

A entrada é um único documento cuja raiz contém muitos fragmentos idênticos. O reader casa `fragmentRootElementName` (`product` aqui) e materializa exatamente um fragmento por `read()`:

```xml
<products>
  <product>
    <id>PR....210</id>
    <name>BlackBerry 8100 Pearl</name>
    <price>124.60</price>
  </product>
  <!-- ...thousands more... -->
</products>
```

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.xml.StaxEventItemReader">
  <property name="fragmentRootElementName" value="product" />
  <property name="resource" value="classpath:input/products.xml" />
  <property name="unmarshaller" ref="productMarshaller" />
</bean>

<bean id="productMarshaller"
      class="org.springframework.oxm.xstream.XStreamMarshaller">
  <property name="aliases">
    <util:map id="aliases">
      <entry key="product" value="com.manning.sbia.reading.Product" />
      <entry key="price"   value="java.math.BigDecimal" />
    </util:map>
  </property>
</bean>
```

`StaxEventItemReader` implementa `ItemReader` em cima de StAX e, por delegar a conversão a um `Unmarshaller` do Spring OXM, permanece independente de qualquer parser específico. Suas duas propriedades-chave são `fragmentRootElementName` (o elemento que marca um objeto) e `unmarshaller` (XML → objeto). O livro liga o `Unmarshaller` com Spring OXM — sua listagem usa `CastorMarshaller`, mas a ligação mais rápida é um `XStreamMarshaller` cujo mapa de aliases nomeia cada raiz de fragmento e tipo de campo, exatamente como a referência atual ainda mostra.

StAX importa *porque* é um parser **pull**: o reader pede o próximo evento, então consegue retornar um único `<product>` e manter o uso de heap constante independente do tamanho do arquivo. DOM primeiro construiria a árvore do documento inteiro em memória — tudo bem para um arquivo de configuração, fatal para uma exportação grande. (SAX também faz streaming, mas seu modelo de callback *push* não se encaixa de forma limpa no contrato pull-um-item de `ItemReader.read()`.)

### `MultiResourceItemReader`: um step, um conjunto inteiro de arquivos

Quando os arquivos chegam num diretório sob um padrão conhecido, envolva um único reader delegate e deixe o `MultiResourceItemReader` iterar os resources casados em ordem:

```xml
<bean id="multiResourceReader"
      class="org.springframework.batch.item.file.MultiResourceItemReader">
  <property name="resources" value="file:data/input/products-*.xml" />
  <property name="delegate" ref="productItemReader" />
</bean>
```

Ele tem só duas propriedades: `resources` (um `Resource[]`, normalmente um padrão wildcard resolvido pelo Spring) e `delegate`. Ele trata um resource de cada vez, sequencialmente, injetando cada `Resource` no delegate e fazendo streaming de seus itens antes de passar para o próximo — então o processamento de chunk a jusante vê um único stream de itens ininterrupto sobre o conjunto inteiro. O delegate pode ser o `StaxEventItemReader` acima ou um `FlatFileItemReader` (`spring-batch-reading-flat-files`); ele precisa implementar `ResourceAwareItemReaderItemStream`, para que o reader consiga entregar-lhe um `Resource` e salvar/restaurar sua posição.

Por ser um `ItemStream`, o `MultiResourceItemReader` escreve seu progresso — em qual resource do array está, mais o offset do delegate dentro desse resource — no `ExecutionContext` do step a cada commit, então um restart reabre o arquivo correto no item correto. A ordenação dos resources precisa ser estável entre execuções, o que ele garante com um `Comparator`; a documentação avisa que adicionar novos arquivos ao diretório no meio de um job pode corromper um restart, então um job deveria ser dono do seu diretório de entrada até terminar.

### Livro vs. hoje: builders substituem o XML, e JAXB supera o XStream

Desde o Spring Batch 4 a ligação `<bean>` é substituída por builders fluentes, e a propriedade única `fragmentRootElementName` vira `addFragmentRootElements(...)` (que aceita vários nomes de elemento):

```java
@Bean
public StaxEventItemReader<Product> productItemReader(Jaxb2Marshaller productMarshaller) {
  return new StaxEventItemReaderBuilder<Product>()
      .name("productItemReader")
      .resource(new ClassPathResource("input/products.xml"))
      .addFragmentRootElements("product")
      .unmarshaller(productMarshaller)
      .build();
}

@Bean
public Jaxb2Marshaller productMarshaller() {
  Jaxb2Marshaller marshaller = new Jaxb2Marshaller();
  marshaller.setClassesToBeBound(Product.class);   // Product is @XmlRootElement(name = "product")
  return marshaller;
}

@Bean
public MultiResourceItemReader<Product> multiResourceReader(
    @Value("file:data/input/products-*.xml") Resource[] resources,
    StaxEventItemReader<Product> productItemReader) {
  return new MultiResourceItemReaderBuilder<Product>()
      .delegate(productItemReader)
      .resources(resources)
      .build();
}
```

Duas mudanças em relação ao texto de 2012. Primeiro, o unmarshaller: o livro (e o exemplo XML da referência atual) usa `XStreamMarshaller` com um mapa de aliases, mas o XStream tem um longo histórico de CVEs de execução remota de código por deserialização insegura, então código novo faz o binding com o `Jaxb2Marshaller` (JAXB), type-safe — ou um mapper XML do Jackson — em vez disso. Segundo, empacotamento: o Spring Batch 6.0 moveu essas classes de infraestrutura de `org.springframework.batch.item.*` para `org.springframework.batch.infrastructure.item.*`, e o namespace XML `batch:` está deprecated, então os builders acima são o idioma atual, não uma conveniência opcional. Confirmado pela referência atual do Spring Batch — *XML Item Readers and Writers* e *Multi-File Input* — e pela referência do Spring Framework *Marshalling XML by Using Object-XML Mappers (OXM)*.

## Trade-offs

- **Streaming StAX vs. DOM em memória** — `StaxEventItemReader` materializa um fragmento por `read()`, então o uso de heap é independente do tamanho do documento; a unidade é o que `fragmentRootElementName` nomear. DOM carregaria a árvore inteira primeiro, o que não escala para entradas do tamanho de um batch.

  ```java
  .addFragmentRootElements("product")   // one Product per read(), not the whole file
  ```

- **Conveniência do XStream vs. segurança do JAXB** — `XStreamMarshaller` não precisa de nenhuma annotation (só o mapa de aliases), mas é não tipado e carrega o histórico de CVEs de deserialização do XStream; `Jaxb2Marshaller` exige classes vinculadas/anotadas, mas é verificado por tipo e o default recomendado hoje.

  ```java
  marshaller.setClassesToBeBound(Product.class);   // explicit, validated binding
  ```

- **Um step, conjunto de arquivos inteiro — mas single-threaded e sensível à ordem no restart** — `MultiResourceItemReader` lê resources um após o outro numa única thread, e a corretude do restart depende de ordenação estável e de não mutar o diretório de entrada durante a execução. Para paralelismo, particione os arquivos entre threads (uma estratégia de escala) em vez de esperar que o reader faça fan-out sozinho.

- **O delegate precisa ser um `ResourceAwareItemReaderItemStream`** — você não pode entregar ao `MultiResourceItemReader` um `ItemReader` arbitrário; o delegate precisa aceitar um `Resource` injetado e expor estado de `ItemStream` para que a posição possa ser salva e restaurada através da fronteira entre resources. Ligação late-bound e step-scoped combina naturalmente com isso (veja `spring-batch-step-scope-and-spel-late-binding`).

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 5, "Reading data", sections 5.3-5.4, "Reading XML files" / "Reading file sets", p. 135-139 — doc
- [Spring Batch Reference — XML Item Readers and Writers (`StaxEventItemReader`)](https://docs.spring.io/spring-batch/reference/readers-and-writers/xml-reading-writing.html) — doc
- [Spring Batch Reference — Multi-File Input (`MultiResourceItemReader`)](https://docs.spring.io/spring-batch/reference/readers-and-writers/multi-file-input.html) — doc
