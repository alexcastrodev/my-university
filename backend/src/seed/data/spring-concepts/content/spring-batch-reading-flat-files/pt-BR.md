---
version: 1.0
updatedAt: 2026-08-06
title: Lendo Arquivos Flat no Spring Batch
---
## Objective

Leitura é a primeira fase do processamento chunk-oriented, e o Spring Batch a modela com um único contrato: `ItemReader<T>`, cujo `read()` retorna o próximo item ou `null` no fim da entrada. Readers de arquivo também implementam `ItemStream`, para que a posição atual de leitura seja salva no execution context — é isso que torna um job que falhou reiniciável em vez de forçar recomeçar do zero. Este concept cobre como o `FlatFileItemReader` embutido transforma linhas cruas em objetos de domínio.

Para arquivos flat, o `FlatFileItemReader` nunca faz o parsing das linhas sozinho. Ele delega para um `LineMapper`; o `DefaultLineMapper` padrão é um pipeline de dois estágios — um `LineTokenizer` divide uma linha num `FieldSet`, e então um `FieldSetMapper` constrói o objeto de domínio a partir desse `FieldSet`. Tudo o mais (campos delimitados vs. de largura fixa, registros multilinha, registros heterogêneos, JSON) é uma questão de trocar tokenizers, mappers, e policies dentro desse pipeline. O reader é a ponta de origem de um step chunk (veja `spring-batch-chunk-processing`), e seu resource de entrada é tipicamente late-bound a um job parameter (veja `spring-batch-step-scope-and-spel-late-binding`).

## Use Cases

- Importar um catálogo de produtos delimitado (estilo CSV) cujas colunas mapeiam por nome para um bean de domínio.
- Ingerir um extrato de mainframe de largura fixa, onde cada campo é uma faixa de colunas em vez de separado por delimitador.
- Pular uma linha de cabeçalho, forçar um encoding de arquivo não padrão, e ler de um resource cujo caminho só é conhecido no momento do lançamento.
- Fazer parsing de registros que se estendem por várias linhas físicas num único item lógico.
- Carregar um arquivo que mistura tipos de registro (por exemplo telefones e livros) com layouts diferentes no mesmo arquivo.
- Ligar um stream de documentos JSON diretamente a objetos tipados.

## Deep Dive

### O contrato `ItemReader`: um `read()` por item

A fase de leitura fica pendurada numa interface pequena:

```java
public interface ItemReader<T> {
    T read() throws Exception, UnexpectedInputException,
                     ParseException, NonTransientResourceException;
}
```

`read()` retorna o próximo item, ou `null` para sinalizar que a entrada se esgotou — momento em que o chunk ao redor para de acumular e comita o que tem. Readers de arquivo embutidos também implementam `ItemStream` (`open`/`update`/`close`), então eles persistem sua posição no execution context e conseguem retomar depois de uma falha. Conceitualmente, o reader é só a fonte que alimenta itens num step chunk (`spring-batch-chunk-processing`); o resto deste concept é sobre transformar uma linha de um arquivo flat num único `T`.

### `FlatFileItemReader`: linha → `FieldSet` → objeto de domínio

`FlatFileItemReader` lê linhas cruas de um `resource` e entrega cada uma a um `LineMapper`. `DefaultLineMapper` divide o trabalho em dois: um `LineTokenizer` produz um `FieldSet` (tokens nomeados e tipados — o análogo, em arquivo flat, de uma linha de `ResultSet` JDBC), e um `FieldSetMapper` mapeia esse `FieldSet` para seu objeto.

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.file.FlatFileItemReader">
  <property name="resource" value="classpath:products.txt"/>
  <property name="linesToSkip" value="1"/>
  <property name="encoding" value="UTF-8"/>
  <property name="lineMapper" ref="productLineMapper"/>
</bean>

<bean id="productLineMapper"
      class="org.springframework.batch.item.file.mapping.DefaultLineMapper">
  <property name="lineTokenizer" ref="productLineTokenizer"/>
  <property name="fieldSetMapper" ref="productFieldSetMapper"/>
</bean>

<bean id="productLineTokenizer"
      class="org.springframework.batch.item.file.transform.DelimitedLineTokenizer">
  <property name="delimiter" value=","/>
  <property name="names" value="id,name,description,price"/>
</bean>
```

`linesToSkip="1"` descarta a linha de cabeçalho (um `skippedLinesCallback` pode capturar essas linhas puladas se você precisar delas); `encoding` sobrescreve o charset default do reader; e o `resource` fixo acima costuma ser late-bound a um job parameter em vez disso (`spring-batch-step-scope-and-spel-late-binding`). Um `FieldSetMapper` customizado lê campos tipados do `FieldSet` por nome:

```java
public class ProductFieldSetMapper implements FieldSetMapper<Product> {
    public Product mapFieldSet(FieldSet fs) throws BindException {
        Product p = new Product();
        p.setId(fs.readString("id"));
        p.setName(fs.readString("name"));
        p.setDescription(fs.readString("description"));
        p.setPrice(fs.readBigDecimal("price"));
        return p;
    }
}
```

`FieldSet` expõe leitores tipados (`readString`, `readBigDecimal`, `readDate`, `readInt`, …), então o mapper só faz conversão de domínio, nunca split de string. Quando os nomes de propriedade do bean batem exatamente com os nomes de campo do tokenizer, você pode dispensar a classe customizada e usar o `BeanWrapperFieldSetMapper` já pronto (apontado para um bean prototype-scoped), que define cada propriedade reflexivamente a partir do campo correspondente.

### Tokenizers delimitados vs. de tamanho fixo

Dois tokenizers cobrem a maioria dos arquivos flat, e ambos produzem o mesmo `FieldSet`, então o `FieldSetMapper` a jusante é idêntico de qualquer forma — só o tokenizer muda. `DelimitedLineTokenizer` (acima) divide num delimitador (vírgula por default). Quando os campos não carregam nenhum separador, mas têm larguras de coluna fixas, `FixedLengthTokenizer` mapeia faixas de coluna para nomes:

```xml
<bean id="productLineTokenizer"
      class="org.springframework.batch.item.file.transform.FixedLengthTokenizer">
  <property name="columns" value="1-9,10-35,36-50,51-56"/>
  <property name="names" value="id,name,description,price"/>
</bean>
```

Faixas de coluna são **1-based** (o `RangeArrayPropertyEditor` do Spring faz o parse da string), uma armadilha comum de off-by-one para quem está acostumado com indexação zero-based.

### Registros multilinha: um `RecordSeparatorPolicy` customizado

Por padrão, uma linha física é um registro. Quando um registro lógico se estende por várias linhas, um `RecordSeparatorPolicy` diz ao reader onde um registro termina; `isEndOfRecord()` inspeciona o texto acumulado e retorna `false` até que o registro esteja completo:

```java
public class TwoLineProductRecordSeparatorPolicy implements RecordSeparatorPolicy {
    // a complete product has 4 comma-separated fields => 3 commas
    public boolean isEndOfRecord(String line) {
        return countCommas(line) == 3;
    }
    public String preProcess(String line) { return line; }
    public String postProcess(String record) { return record; }
}
```

Ligue-o através da propriedade `recordSeparatorPolicy` do reader; o tokenizer então vê o registro multilinha concatenado como uma única linha e faz o parsing normalmente.

### Registros heterogêneos: `PatternMatchingCompositeLineMapper`

Quando um arquivo mistura tipos de registro com layouts diferentes — digamos celulares (linhas prefixadas com `PRM`) e livros (`PRB`) — um único tokenizer não resolve. `PatternMatchingCompositeLineMapper` roteia cada linha por um padrão de prefixo para seu próprio tokenizer e field-set mapper:

```xml
<bean id="productLineMapper"
      class="org.springframework.batch.item.file.mapping.PatternMatchingCompositeLineMapper">
  <property name="tokenizers">
    <map>
      <entry key="PRM*" value-ref="mobileTokenizer"/>
      <entry key="PRB*" value-ref="bookTokenizer"/>
    </map>
  </property>
  <property name="fieldSetMappers">
    <map>
      <entry key="PRM*" value-ref="mobileFieldSetMapper"/>
      <entry key="PRB*" value-ref="bookFieldSetMapper"/>
    </map>
  </property>
</bean>
```

As chaves wildcard `*` escolhem o par tokenizer/mapper por linha — a forma usual de construir um modelo polimórfico (um `Product` base com subclasses `MobilePhoneProduct`/`BookProduct`) a partir de um único arquivo heterogêneo.

### Lendo JSON (a abordagem do livro)

O livro de 2012 lê JSON com um `JsonLineMapper`, que faz o parsing de cada objeto JSON num `java.util.Map<String,Object>` — não um objeto tipado:

```xml
<bean id="productsLineMapper"
      class="org.springframework.batch.item.file.mapping.JsonLineMapper"/>
```

Como normalmente você quer instâncias de `Product`, e não maps, o livro então envolve esse mapper num `LineMapper` delegante que converte cada `Map` manualmente:

```java
public class JsonLineMapperWrapper implements LineMapper<Product> {
    private JsonLineMapper delegate;
    public Product mapLine(String line, int lineNumber) throws Exception {
        Map<String, Object> m = delegate.mapLine(line, lineNumber);
        Product p = new Product();
        p.setId((String) m.get("id"));
        p.setName((String) m.get("name"));
        p.setPrice(new BigDecimal(m.get("price").toString()));
        return p;
    }
}
```

Essa dança manual de `Map` para objeto é exatamente o que o Spring Batch moderno elimina — veja a próxima seção.

### Livro vs. hoje: XML + `JsonLineMapper` → builders + `JsonItemReader`

Duas coisas mudaram desde o livro (Spring Batch 2.1, 2012).

Primeiro, desde o **Spring Batch 4** o `FlatFileItemReaderBuilder` fluente substitui a ligação XML: ele constrói o `DefaultLineMapper`, o tokenizer, e o `FieldSetMapper` para você. `.delimited()`/`.fixedLength()` escolhem o tokenizer, `.names(...)` define os nomes de campo, e `.targetType(Product.class)` instala um `BeanWrapperFieldSetMapper`:

```java
@Bean
@StepScope
public FlatFileItemReader<Product> productItemReader(
        @Value("#{jobParameters['input.file']}") Resource resource) {
    return new FlatFileItemReaderBuilder<Product>()
            .name("productItemReader")
            .resource(resource)
            .linesToSkip(1)
            .encoding("UTF-8")
            .delimited().delimiter(",")
            .names("id", "name", "description", "price")
            .targetType(Product.class)
            .build();
}
```

(Para largura fixa, troque por `.fixedLength().columns(new Range(1, 9), new Range(10, 35), …).names(…)`.) O namespace XML `batch:` ainda funciona, mas está deprecated desde o Spring Batch 6.0 (remoção planejada para a 7.0), então configuração Java mais builders é o estilo recomendado.

Segundo, desde o **Spring Batch 4.1** um `JsonItemReader` de primeira classe liga JSON diretamente a objetos tipados, removendo o código de `Map`-e-wrapper acima. Ele delega o parsing a um `JsonObjectReader` — `JacksonJsonObjectReader` (ou `GsonJsonObjectReader`):

```java
@Bean
public JsonItemReader<Product> productJsonReader() {
    return new JsonItemReaderBuilder<Product>()
            .name("productJsonReader")
            .resource(new ClassPathResource("products.json"))
            .jsonObjectReader(new JacksonJsonObjectReader<>(Product.class))
            .build();
}
```

Um detalhe de pacote que vale citar com precisão: no Spring Batch 6.0 essas classes de infraestrutura foram realocadas. `FlatFileItemReader` agora vive em `org.springframework.batch.infrastructure.item.file` e os tipos JSON em `org.springframework.batch.infrastructure.item.json`, enquanto a série 5.x e o livro usavam `org.springframework.batch.item.file`/`...item.json`. Confirmado pela referência atual do Spring Batch (Flat Files, e JSON Item Reading and Writing) e pelo Javadoc da API 6.0.x para `FlatFileItemReaderBuilder` e `JsonItemReader`.

## Trade-offs

- **Formato delimitado vs. largura fixa** — Arquivos delimitados são compactos e tolerantes a comprimentos de campo variáveis, mas quebram com um delimitador não escapado dentro dos dados; arquivos de largura fixa são posicionalmente autodescritivos e seguros contra delimitador, mas maiores, e frágeis se qualquer largura de coluna mudar. Combine o tokenizer com a fonte, não com o gosto.
- **`BeanWrapperFieldSetMapper` vs. um `FieldSetMapper` customizado** — O mapper bean-wrapper é zero-código quando os nomes de campo batem com as propriedades do bean, mas faz binding por nome via reflexão, com pouco espaço para validação; um mapper customizado é mais código, mas dá leituras tipadas explícitas (`readBigDecimal`, `readDate`), valores default, e validação. Convenção vs. controle.
- **Streaming, um item por vez** — `FlatFileItemReader` lê e mapeia de forma preguiçosa a cada `read()`, então a memória fica constante para arquivos enormes e a posição é reiniciável. O custo é que o reader é inerentemente stateful e não thread-safe por padrão, então paralelizar um único arquivo exige particionamento deliberado em vez de simplesmente compartilhar um reader.
- **Policies orientadas a configuração vs. um `LineMapper` customizado** — Um `RecordSeparatorPolicy` ou `PatternMatchingCompositeLineMapper` mantém o reader declarativo, mas gramáticas de registro genuinamente complexas forçam o casamento por prefixo além do razoável; a partir de um certo ponto um `LineMapper` escrito à mão (ou um formato de origem melhor estruturado) é mais claro do que esticar wildcards.
- **`JsonItemReader` vs. o `JsonLineMapper` do livro** — O reader tipado moderno remove o boilerplate de `Map`-para-objeto e dá um tipo alvo concreto, mas espera um stream de objetos JSON e uma biblioteca de binding (Jackson/Gson) no classpath; a abordagem `Map` do livro é não tipada, mas leve em dependências.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 5, "Reading data", sections 5.1-5.2, "Data reading concepts" / "Reading flat files", p. 117-135 — doc
- [Spring Batch Reference — Flat Files](https://docs.spring.io/spring-batch/reference/readers-and-writers/flat-files.html) — doc
- [Spring Batch Reference — JSON Item Reading and Writing](https://docs.spring.io/spring-batch/reference/readers-and-writers/json-reading-writing.html) — doc
