---
version: 1.0
updatedAt: 2026-08-06
title: "Processamento e Transformação de Itens: o Contrato ItemProcessor"
---
## Objective

Um `ItemProcessor<I, O>` é o estágio intermediário opcional de um step chunk-oriented — ele fica entre o item reader e o item writer (o loop read→process→write descrito em `spring-batch-chunk-processing`) e é invocado uma vez por item lido. Quando um step não declara nenhum processor, os itens fluem do reader para o writer como estão; quando existe um, o Spring Batch entrega cada item lido do tipo `I` para `process(...)` e encaminha o objeto retornado do tipo `O` para o writer. Este é o lugar designado para lógica de negócio — aplicar regras, enriquecer, ou remodelar dados — mantido fora do código de leitura e escrita para preservar a separação de responsabilidades.

O contrato cobre três papéis. **(1) Transformar/enriquecer**: mutar ou calcular sobre o item lido e retornar o mesmo tipo (`I` == `O`), por exemplo aplicar um desconto ou remapear um ID. **(2) Mudar tipo**: ler o tipo `I` e produzir um tipo de escrita `O` diferente (ler um `PartnerProduct`, emitir um `Product` da loja); os genéricos do reader, processor, e writer precisam bater. **(3) Hidratar uma driving query**: o reader emite chaves leves e o processor carrega o detalhe completo por item. O Spring Batch também traz processors prontos — `PassThroughItemProcessor` (no-op) e `ItemProcessorAdapter` (reutiliza um método de bean existente). Retornar `null` de `process` *filtra* o item para fora; esse desdobramento pertence a `spring-batch-filtering-and-validating-items`, não aqui.

## Use Cases

- Aplicar regras de negócio a itens lidos antes de escrevê-los — descontos, defaults, campos calculados — sem tocar no reader ou no writer.
- Remapear os IDs de produto de um parceiro para o namespace de ID próprio da loja online (mesmo tipo na entrada e na saída) através de um POJO de negócio simples.
- Converter um `PartnerProduct` recebido no modelo `Product` da loja quando os tipos de leitura e escrita diferem.
- O padrão driving-query: um reader seleciona apenas IDs de linha (veja `spring-batch-database-item-readers`) e o processor carrega cada objeto completo, evitando result sets grandes e travados.
- Reutilizar um método de serviço existente como processor via `ItemProcessorAdapter`, sem precisar escrever nenhuma classe `ItemProcessor` customizada.

## Deep Dive

### O contrato `ItemProcessor<I, O>`

O Spring Batch define um contrato de um único método; você escolhe os tipos concretos `I` e `O` na sua implementação:

```java
package org.springframework.batch.item;

public interface ItemProcessor<I, O> {
    O process(I item) throws Exception;
}
```

O processor é ligado ao elemento chunk com o atributo `processor`, ao lado do reader e do writer:

```xml
<batch:job id="readWriteJob">
  <batch:step id="readWriteStep">
    <batch:tasklet>
      <batch:chunk reader="reader" processor="processor"
                   writer="writer" commit-interval="100" />
    </batch:tasklet>
  </batch:step>
</batch:job>
```

Se você não tem nada a fazer ainda, o `PassThroughItemProcessor` embutido retorna cada item inalterado — um default útil. Retornar `null` em vez disso sinaliza filtering (o item lido nunca chega ao writer); o contrato completo de filtering/validation, incluindo `ValidatingItemProcessor`, vive em `spring-batch-filtering-and-validating-items`.

### Transformando in loco: alterar o estado do item lido

Quando os tipos de leitura e escrita são idênticos, o processor muta o item e o retorna. A ACME importa o catálogo de cada parceiro e precisa remapear IDs de produto do parceiro para o namespace da loja. A lógica de negócio é um POJO que depende só do Spring JDBC, não do Spring Batch:

```java
public class PartnerIdMapper {
    private String partnerId;
    private JdbcTemplate jdbcTemplate;

    public Product map(Product partnerProduct) {
        String storeProductId = jdbcTemplate.queryForObject(
            "select store_product_id from partner_mapping " +
            "where partner_id = ? and partner_product_id = ?",
            String.class, partnerId, partnerProduct.getId());
        partnerProduct.setId(storeProductId);
        return partnerProduct;
    }
    // setPartnerId / setDataSource ...
}
```

Um `ItemProcessor` fino delega para esse POJO. Os dois argumentos de tipo são `Product`, então o reader e o writer continuam trabalhando com o mesmo objeto:

```java
public class PartnerIdItemProcessor implements ItemProcessor<Product, Product> {
    private PartnerIdMapper mapper;

    @Override
    public Product process(Product item) throws Exception {
        return mapper.map(item);   // same type in, same type out
    }
    public void setMapper(PartnerIdMapper mapper) { this.mapper = mapper; }
}
```

### Mudando o tipo: ler `I`, escrever `O`

Quando os parceiros enviam um modelo diferente, o processor converte o `PartnerProduct` lido no `Product` da loja. Só os argumentos de tipo mudam — o writer agora recebe objetos `Product`:

```java
public class PartnerProductItemProcessor
        implements ItemProcessor<PartnerProduct, Product> {
    private PartnerProductMapper mapper;   // business POJO

    @Override
    public Product process(PartnerProduct item) throws Exception {
        return mapper.map(item);           // PartnerProduct in, Product out
    }
    public void setMapper(PartnerProductMapper mapper) { this.mapper = mapper; }
}
```

Os genéricos precisam bater de ponta a ponta: o reader precisa emitir `PartnerProduct`, o processor é `ItemProcessor<PartnerProduct, Product>`, e o writer precisa aceitar `Product`. Troque o processor por um de outro parceiro e você reutiliza o mesmo reader e writer.

### Reutilizando um POJO com `ItemProcessorAdapter`

Escrever uma classe cujo único trabalho é delegar uma chamada é boilerplate. `ItemProcessorAdapter` invoca qualquer método de um bean existente, então o `PartnerIdMapper` acima pode atuar como processor sem nenhum Java extra:

```xml
<bean id="processor"
      class="org.springframework.batch.item.adapter.ItemProcessorAdapter">
  <property name="targetObject" ref="partnerIdMapper" />
  <property name="targetMethod" value="map" />
</bean>
```

O adapter valida sua configuração quando o contexto sobe, então um `targetMethod` inválido falha rápido — mas é menos type-safe que uma classe dedicada, e o nome do método é um valor string que você pode digitar errado.

### O padrão driving-query

A driving query carrega só os IDs com os quais trabalhar, e então carrega cada objeto completo um de cada vez. Isso pode superar um cursor grande único, porque alguns engines fazem locks pessimistas em result sets grandes, prejudicando o acesso concorrente. No Spring Batch, o reader roda a driving query e o processor hidrata cada ID. Um cursor reader seleciona só os IDs (totalmente configurado em `spring-batch-database-item-readers`); o livro o restringe com `where update_timestamp > ?` amarrado a um job parameter:

```xml
<bean id="reader"
      class="org.springframework.batch.item.database.JdbcCursorItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql" value="select id from product"/>
  <property name="rowMapper">
    <bean class="org.springframework.jdbc.core.SingleColumnRowMapper">
      <constructor-arg value="java.lang.String" />
    </bean>
  </property>
</bean>
```

O processor pega o `String` do ID e retorna um `Product` totalmente carregado, então os parâmetros de tipo são `<String, Product>`:

```java
public class IdToProductItemProcessor implements ItemProcessor<String, Product> {
    private ProductDao productDao;

    @Override
    public Product process(String productId) throws Exception {
        return productDao.load(productId);   // one row fetched per item
    }
    public void setProductDao(ProductDao productDao) { this.productDao = productDao; }
}
```

Como o processor é um lugar natural para chamar um DAO ou uma sessão ORM, o padrão combina bem com Hibernate/JPA, cujos caches podem amortizar as cargas por item.

### Livro vs. hoje: realocação para `infrastructure.item.*` e ligação via Java config

O contrato `ItemProcessor<I, O>` permanece inalterado e ainda é muito usado — no Spring Batch 6 ele é uma `@FunctionalInterface`, então uma lambda ou method reference funciona em qualquer lugar onde um processor é esperado. O que mudou foi o empacotamento. Até a série 5.x, o `org.springframework.batch.item.ItemProcessor` do livro estava correto; o Spring Batch 6.0 realocou as classes de item para `org.springframework.batch.infrastructure.item.*`, então a interface agora é `org.springframework.batch.infrastructure.item.ItemProcessor`, `PassThroughItemProcessor` é `...infrastructure.item.support.PassThroughItemProcessor`, e `ItemProcessorAdapter` é `...infrastructure.item.adapter.ItemProcessorAdapter`. Os caminhos pre-6.0 `org.springframework.batch.item.*` agora dão 404 — uma atualização para 6.0 é uma mudança de import obrigatória. (No framework como um todo, o Spring Batch 5+ também migrou para Jakarta EE, transformando imports `javax.*` de EE em `jakarta.*`; o `javax.sql.DataSource` do livro é um tipo JDBC do Java SE e não é afetado.)

A ligação também mudou. Desde a v4 cada step é construído com um builder fluente, e o namespace XML `batch:` está deprecated desde a 6.0, então o estilo recomendado é configuração Java com `StepBuilder.processor(...)`:

```java
@Bean
public ItemProcessor<PartnerProduct, Product> processor(PartnerProductMapper mapper) {
    return mapper::map;   // functional interface → method reference
}

@Bean
public Step readWriteStep(JobRepository jobRepository, PlatformTransactionManager tx,
        ItemReader<PartnerProduct> reader,
        ItemProcessor<PartnerProduct, Product> processor,
        ItemWriter<Product> writer) {
    return new StepBuilder("readWriteStep", jobRepository)
            .<PartnerProduct, Product>chunk(100, tx)
            .reader(reader).processor(processor).writer(writer)
            .build();
}
```

`ItemProcessorAdapter` ainda existe para reutilizar um método de POJO. O padrão driving-query também ainda é válido, mas hoje é frequentemente substituído por um único paging reader com um join (`JdbcPagingItemReader`) quando o join pode ser expresso em SQL, evitando N queries por item. Confirmado pelo capítulo "Item processing" da referência do Spring Batch, pelo Javadoc da API do Spring Batch 6.0.4 para `org.springframework.batch.infrastructure.item.ItemProcessor` / `...item.adapter.ItemProcessorAdapter` / `...item.support.PassThroughItemProcessor`, e pelo Guia de Migração do Spring Batch 6.0.

## Trade-offs

- **`ItemProcessor` dedicado vs. `ItemProcessorAdapter`** — uma classe escrita à mão é totalmente type-safe e fácil de ler; o adapter elimina o boilerplate, mas é stringly-typed em `targetMethod` e só faz type-check reflexivamente. Ele falha rápido no startup do contexto, não em tempo de compilação.
- **Mutar in loco vs. retornar um objeto novo** — mutar o item lido é barato, mas vaza efeitos colaterais se o item for compartilhado ou o step reiniciar; produzir um `O` novo mantém a transformação limpa, mas obriga os genéricos de reader/processor/writer a baterem exatamente.
- **Driving query vs. uma única query com join** — selecionar IDs e depois carregar por item evita locks pessimistas e result sets enormes, mas dispara N queries extras; quando um join é expressável, um paging reader é normalmente mais simples e mais rápido hoje.
- **Uma chamada por item** — `process` roda uma vez por item, então chamadas remotas/de banco pesadas por item dominam o throughput; prefira agregar esse tipo de trabalho no writer (que vê um chunk inteiro) em vez de fazê-lo item por item no processor.
- **`null` filtra silenciosamente** — retornar `null` descarta o item sem nenhuma chamada ao writer e sem erro; isso é filtering, não skipping, e o contrato completo está em `spring-batch-filtering-and-validating-items`.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 7, "Processing data", sections 7.1-7.2, "Processing items" / "Transforming items", p. 194-208 — doc
- [Spring Batch Reference — Item processing (`ItemProcessor`)](https://docs.spring.io/spring-batch/reference/processor.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.infrastructure.item.ItemProcessor`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/ItemProcessor.html) — doc
- [Spring Batch 6.0 Migration Guide (`infrastructure` package relocation; `batch:` XML deprecated)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
