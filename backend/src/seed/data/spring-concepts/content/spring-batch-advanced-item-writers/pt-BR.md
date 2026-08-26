---
version: 1.0
updatedAt: 2026-08-06
title: Item Writers Avançados e Compostos no Spring Batch
summary: Como o Spring Batch reaproveita um serviço existente como writer com ItemWriterAdapter, implementa um ItemWriter customizado através do contrato write(Chunk), e distribui ou roteia um chunk com CompositeItemWriter versus ClassifierCompositeItemWriter — além dos writers de nicho JMS e email — e como essas classes se mudaram para os pacotes org.springframework.batch.infrastructure.item.* no Spring Batch 6.0.
---
## Objective

Depois de entender os writers de arquivo (`spring-batch-writing-files`) e os writers de banco de dados (`spring-batch-database-item-writers`), a última peça do lado de escrita é *reaproveitar* e *compor* writers. Todo `ItemWriter<T>` ainda recebe o **chunk inteiro de uma vez**, então um writer avançado é ou uma ponte fina para código que você já tem, ou um wrapper que entrega esse chunk para vários outros writers. Este conceito cobre quatro abordagens: transformar um serviço existente em um writer com `ItemWriterAdapter`, empurrar itens para destinos de nicho (`JmsItemWriter`, `SimpleMailMessageItemWriter`), escrever à mão um `ItemWriter` customizado e — o verdadeiro ganho — distribuir ou rotear um chunk com `CompositeItemWriter` e `ClassifierCompositeItemWriter`.

`ItemWriterAdapter` é o espelho exato, do lado de escrita, do adapter de reader em `spring-batch-custom-and-service-readers`: o adapter do reader chama um método sem argumentos que *retorna* um item, enquanto o adapter do writer chama um método de um argumento que *consome* um item. Tudo aqui ainda depende do step em chunk (`spring-batch-chunk-processing`): o reader e o processor preenchem um chunk, o writer avançado faz o flush ou o despacha, e tudo faz commit dentro de uma transação no limite do chunk.

## Use Cases

- Reaproveitar um bean `ProductService.write(product)` existente como o writer do step em vez de escrever uma nova classe, quando a lógica de persistência já vive em um serviço.
- Extrair várias propriedades de bean como argumentos separados para um método legado de serviço com múltiplos argumentos (`PropertyExtractingDelegatingItemWriter`).
- Fan-out: escrever cada item processado em um arquivo flat **e** em uma tabela relacional em um único step (`CompositeItemWriter`).
- Roteamento: enviar registros `C`/`U`/`D` (ou válidos vs. rejeitados) para writers de destino diferentes com base em um campo (`ClassifierCompositeItemWriter`).
- Integração de nicho: colocar cada item em uma fila JMS (`JmsItemWriter`) ou enviar um email de boas-vindas por linha (`SimpleMailMessageItemWriter`).

## Deep Dive

### Reaproveitando um serviço como writer: `ItemWriterAdapter`

Se um bean simples já sabe como persistir um item, o `ItemWriterAdapter` delega a escrita a ele — para cada item do chunk, invoca um método, passando o item como argumento. O delegate é código comum, sem nenhum tipo do Spring Batch:

```java
public class ProductService {
    public void write(Product product) {   // one item in, void out
        // existing persistence / business logic
    }
}
```

Você o conecta com `targetObject` (o serviço) e `targetMethod` (o nome do método); o livro usa XML:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.adapter.ItemWriterAdapter">
  <property name="targetObject" ref="productService"/>
  <property name="targetMethod" value="write"/>
</bean>
<bean id="productService" class="com.manning.sbia.ch06.service.ProductService"/>
```

Este é o gêmeo simétrico do `ItemReaderAdapter` (`spring-batch-custom-and-service-readers`): a mesma conexão via `targetObject`/`targetMethod`, direção de dados oposta. Quando o método do serviço recebe vários argumentos primitivos em vez do próprio item, troque para `PropertyExtractingDelegatingItemWriter`, que extrai propriedades nomeadas do item e as espalha pela chamada — aqui `write(id, name, description, price)`:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.adapter.PropertyExtractingDelegatingItemWriter">
  <property name="targetObject" ref="productService"/>
  <property name="targetMethod" value="write"/>
  <property name="fieldsUsedAsTargetMethodArguments">
    <list><value>id</value><value>name</value><value>description</value><value>price</value></list>
  </property>
</bean>
```

Como o delegate vive fora do Spring Batch, nenhum dos dois adapters registra nada no contexto de execução — a possibilidade de restart é problema do próprio delegate.

### Destinos de nicho: writers de item JMS e email

Dois writers prontos cobrem destinos de mensageria e email. `JmsItemWriter` envia cada item para o destino padrão de um `JmsTemplate` do Spring, então um step pode publicar produtos em um sistema de faturamento apenas com configuração:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.jms.JmsItemWriter">
  <property name="jmsTemplate" ref="jmsTemplate"/>
</bean>
```

`SimpleMailMessageItemWriter` envia uma `SimpleMailMessage` por item através de um `MailSender`. Como o writer apenas *envia*, você o combina com um `ItemProcessor` que transforma cada objeto de domínio em uma mensagem pronta para envio, depois conecta o `mailSender`:

```xml
<bean id="mailMessageItemWriter"
      class="org.springframework.batch.item.mail.SimpleMailMessageItemWriter">
  <property name="mailSender" ref="javaMailSender"/>
</bean>
```

Ambos ainda existem hoje, mas são de nicho (veja *Livro vs. hoje*): email em particular não é transacional, então um chunk revertido não consegue "desenviar" um email.

### Escrevendo um `ItemWriter` customizado: o contrato `write(Chunk)`

Quando nada pronto se encaixa, implemente a interface diretamente. Todo o contrato é um método que recebe o chunk; você percorre e persiste. O livro escreve um upsert JDBC; aqui está na assinatura **moderna**, que recebe um `Chunk` em vez de uma `List`:

```java
public class JdbcProductItemWriter implements ItemWriter<Product> {
    private final JdbcTemplate jdbcTemplate;
    public JdbcProductItemWriter(JdbcTemplate jdbcTemplate) { this.jdbcTemplate = jdbcTemplate; }

    @Override
    public void write(Chunk<? extends Product> chunk) {   // was List<? extends Product> in the book
        for (Product item : chunk) {
            int updated = jdbcTemplate.update("UPDATE PRODUCT SET NAME=?, PRICE=? WHERE ID=?",
                    item.getName(), item.getPrice(), item.getId());
            if (updated == 0) {
                jdbcTemplate.update("INSERT INTO PRODUCT (ID, NAME, PRICE) VALUES (?, ?, ?)",
                        item.getId(), item.getName(), item.getPrice());
            }
        }
    }
}
```

Para um writer de banco de dados como este, a possibilidade de restart é uma preocupação do *reader*: o writer simplesmente persiste o que o reader empurra, e um chunk revertido é relido no restart. Os writers baseados em arquivo são os que precisam retomar no meio de um recurso, o que as implementações já fornecidas já tratam (`spring-batch-writing-files`).

### Fan-out com `CompositeItemWriter` vs. roteamento com `ClassifierCompositeItemWriter`

Um step em chunk permite exatamente **um** writer, então escrever para dois destinos significa compor. `CompositeItemWriter` implementa o padrão Composite: mantém uma lista ordenada de delegates e passa **cada** chunk para **todos** eles, em ordem. Use-o para escrever cada item em mais de um lugar — digamos, um arquivo delimitado e um arquivo de largura fixa, ou um arquivo e um banco de dados:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.support.CompositeItemWriter">
  <property name="delegates">
    <list>
      <ref local="delimitedProductItemWriter"/>
      <ref local="fixedWidthProductItemWriter"/>
    </list>
  </property>
</bean>
```

`ClassifierCompositeItemWriter` faz o oposto: envia **cada item para exatamente um** delegate, escolhido em tempo de execução por um `Classifier`. Dado um input com uma coluna `OPERATION` (`C` criar, `U` atualizar, `D` deletar), você roteia itens para writers de inserção/atualização/exclusão. O roteador do livro retorna a chave da operação através da anotação `@Classifier`:

```java
public class ProductRouterClassifier {
    @Classifier
    public String classify(Product product) {
        return product.getOperation();   // "C", "U", or "D"
    }
}
```

Um `BackToBackPatternClassifier` mapeia essa chave para um writer através do seu `matcherMap`, e o `ClassifierCompositeItemWriter` o envolve:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.support.ClassifierCompositeItemWriter">
  <property name="classifier">
    <bean class="org.springframework.batch.classify.BackToBackPatternClassifier">
      <property name="routerDelegate"><bean class="com.manning.sbia.ch06.advanced.ProductRouterClassifier"/></property>
      <property name="matcherMap">
        <map>
          <entry key="C" value-ref="insertJdbcBatchItemWriter"/>
          <entry key="U" value-ref="updateJdbcBatchItemWriter"/>
          <entry key="D" value-ref="deleteJdbcBatchItemWriter"/>
        </map>
      </property>
    </bean>
  </property>
</bean>
```

O contraste é o ponto central: **composite = fan-out** (um item escrito N vezes, em N destinos), **classifier = roteamento** (um item escrito uma vez, no destino que sua classificação escolhe). Ambos delegam para writers reais, como o `JdbcBatchItemWriter` de `spring-batch-database-item-writers`.

### Livro vs. hoje: a realocação do 6.0, `write(Chunk)`, e builders

Quatro mudanças importam desde o livro (Spring Batch 2.x, 2012). Primeiro, a **realocação de pacotes do 6.0**: tudo em spring-batch-infrastructure se mudou de `org.springframework.batch.*` para `org.springframework.batch.infrastructure.*`. Então, hoje, é `org.springframework.batch.infrastructure.item.adapter.ItemWriterAdapter`, `...infrastructure.item.support.CompositeItemWriter`, `...infrastructure.item.support.ClassifierCompositeItemWriter`, `...infrastructure.item.jms.JmsItemWriter`, e `...infrastructure.item.mail.SimpleMailMessageItemWriter` — os caminhos `org.springframework.batch.item.*` do livro agora retornam 404.

Segundo, a assinatura de escrita: `write(List<? extends T>)` (livro) virou `write(Chunk<? extends T>)` no **5.0**, onde `Chunk` é `org.springframework.batch.infrastructure.item.Chunk`. Terceiro, desde o **4.0** builders fluentes substituem o XML — `CompositeItemWriterBuilder` e `ClassifierCompositeItemWriterBuilder`, e o classifier hoje costuma ser uma lambda simples em vez de `BackToBackPatternClassifier`:

```java
@Bean
public ClassifierCompositeItemWriter<Product> productItemWriter(
        ItemWriter<Product> insert, ItemWriter<Product> update, ItemWriter<Product> delete) {
    Map<String, ItemWriter<? super Product>> routes = Map.of("C", insert, "U", update, "D", delete);
    return new ClassifierCompositeItemWriterBuilder<Product>()
            .classifier(product -> routes.get(product.getOperation()))   // org.springframework.classify.Classifier
            .build();
}
```

Quarto, o estilo ao redor: `javax.*` virou `jakarta.*` no 5.0, e o namespace XML `batch:` está deprecated desde o 6.0 (remoção planejada para o 7.0), então Java config mais builders é a forma recomendada. Notavelmente, o adapter e os writers composite/classifier permanecem inalterados em comportamento; os tipos `Classifier`/`BackToBackPatternClassifier`/`@Classifier` ainda existem, mas agora vivem no pacote `org.springframework.classify` do spring-retry, não no `org.springframework.batch.classify` do livro. Os writers JMS e de email também sobrevivem, mas são de nicho — a ingestão de mensagens é tipicamente tratada pela stack de mensageria do Spring hoje. Confirmado via o Javadoc da API do Spring Batch 6.0.x para `ItemWriterAdapter`, `CompositeItemWriter`, `ClassifierCompositeItemWriter`, `JmsItemWriter`, e `SimpleMailMessageItemWriter` (todos sob `org.springframework.batch.infrastructure.item.*`), o Javadoc de `CompositeItemWriterBuilder`/`ClassifierCompositeItemWriterBuilder`, o Migration Guide do Spring Batch 6.0, e as fontes do `org.springframework.classify` do spring-retry.

## Trade-offs

- **Fan-out vs. roteamento** — `CompositeItemWriter` escreve cada item em *todos* os delegates (duplicação multi-destino, ex.: arquivo + BD); `ClassifierCompositeItemWriter` escreve cada item em *um* delegate escolhido por um `Classifier` (particionamento, ex.: válido vs. rejeitado). Use composite quando quiser os mesmos dados em vários lugares, classifier quando itens diferentes pertencem a lugares diferentes.
- **Reaproveitamento via adapter vs. writer customizado** — `ItemWriterAdapter` é código quase zero e reaproveita lógica de serviço já testada, mas o delegate é invisível ao Spring Batch, então nada é registrado em checkpoint e os erros são chamadas por item. Um `ItemWriter` customizado que recebe o `Chunk` inteiro pode agrupar a escrita em um único round-trip e controlar o comportamento de transação/flush, ao custo de escrevê-lo você mesmo.
- **Ordenação e rollback do composite** — delegates disparam na ordem da lista dentro da única transação do chunk, então um delegate de banco de dados reverte de forma limpa, mas um delegate não transacional que rodou antes (uma linha de arquivo, um envio JMS, um email) não pode ser desfeito se um delegate posterior lançar uma exceção. Coloque escritas transacionais por último, ou aceite a possibilidade de efeitos colaterais duplicados em um retry.
- **Falha do classifier** — se o `Classifier` retornar uma chave sem writer mapeado, o item não tem para onde ir; um `BackToBackPatternClassifier` precisa de uma entrada coringa (`*`) ou você corre o risco de uma falha em tempo de execução com um valor inesperado.
- **Writers de nicho, destinos não transacionais** — `SimpleMailMessageItemWriter` e `JmsItemWriter` são convenientes, mas ficam fora das garantias da transação do chunk (email não é transacional; JMS pode reentregar). Prefira armazenar itens e integrar de forma assíncrona quando a correção importar, em vez de enviar mensagens irreversíveis no meio do chunk.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 6, "Writing data", sections 6.4-6.9, "Adapting existing services for reuse" … "Advanced writing techniques", p. 183-192 — doc
- [Spring Batch Reference — Creating Custom ItemReaders and ItemWriters](https://docs.spring.io/spring-batch/reference/readers-and-writers/custom.html) — doc
- [Spring Batch 6.0 API — ClassifierCompositeItemWriter (org.springframework.batch.infrastructure.item.support)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/support/ClassifierCompositeItemWriter.html) — doc
- [Spring Batch 6.0 API — CompositeItemWriter (org.springframework.batch.infrastructure.item.support)](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/support/CompositeItemWriter.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
