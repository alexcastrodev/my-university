---
version: 1.0
updatedAt: 2026-08-06
title: Item Writers de Banco de Dados no Spring Batch
summary: Como o Spring Batch escreve um chunk em um banco relacional — o JdbcBatchItemWriter reduzindo N inserts a um único batch JDBC por chunk, as estratégias de binding por parâmetro nomeado vs. posicional, e os writers ORM JpaItemWriter/HibernateItemWriter, além das APIs de builder do Spring Batch 6.0 e da realocação do pacote infrastructure.item.
---
## Objective

Escrever é a última fase do processamento orientado a chunk, e o Spring Batch modela isso com um único contrato, `ItemWriter<T>`, cujo `write(...)` recebe o **chunk inteiro de uma vez** em vez de um único item. Writers de banco de dados diferem em espírito dos writers de arquivo: um writer de arquivo precisa imitar uma transação (armazenando em buffer os itens escritos e fazendo flush no commit), mas uma escrita em banco de dados já está dentro de uma transação, então nenhum controle desse tipo é necessário. O que o writer JDBC adiciona em vez disso é throughput — `JdbcBatchItemWriter` acumula os N itens do chunk e os emite como um *único* batch JDBC (`PreparedStatement.addBatch()` por item, depois um `executeBatch()`), então N inserts se reduzem a um único round-trip de banco de dados por chunk.

Este é o espelho do lado de escrita da leitura em chunk (`spring-batch-database-item-readers`) e depende do mesmo step em chunk (`spring-batch-chunk-processing`): o reader/processor preenchem um chunk, o writer faz o flush dele, e a transação do step faz commit — tudo no limite do chunk. Existem duas famílias: JDBC (`JdbcBatchItemWriter`) e ORM (`JpaItemWriter`, mais o `HibernateItemWriter` do livro, agora removido). Esses writers têm como alvo suas tabelas de *negócio*; as tabelas de metadados do batch são uma preocupação de `DataSource` separada (`spring-batch-job-repository-database-configuration`), e, ao contrário dos writers de arquivo, não há um writer por formato para configurar (compare com `spring-batch-writing-files`).

## Use Cases

- Fazer bulk-insert de um chunk processado de linhas `Product` com um único `INSERT` em batch por commit interval, em vez de uma instrução por item.
- Vincular parâmetros SQL nomeados (`:id`, `:name`) diretamente a partir de propriedades de JavaBean, sem código de parâmetro escrito à mão.
- Usar marcadores posicionais `?` quando o mapeamento coluna-para-propriedade precisa de controle explícito e tipado (conversões customizadas, ordenação).
- Persistir entidades JPA/Hibernate e deixar o ORM decidir entre `INSERT` e `UPDATE`, fazendo flush uma vez por chunk.
- Capturar uma escrita silenciosamente sem efeito — uma instrução que atualizou zero linhas — via `assertUpdates`.

## Deep Dive

### `JdbcBatchItemWriter`: um batch JDBC por chunk (o ganho de throughput)

`JdbcBatchItemWriter` fica em cima da camada JDBC do Spring e precisa de duas coisas: uma instrução `sql` e **exatamente uma** estratégia de binding — um `ItemSqlParameterSourceProvider` (parâmetros nomeados) ou um `ItemPreparedStatementSetter` (`?` posicional). A configuração de parâmetro nomeado do livro conecta o `BeanPropertyItemSqlParameterSourceProvider` padrão, que mapeia cada `:param` para a propriedade de bean correspondente:

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.database.JdbcBatchItemWriter">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql"
            value="INSERT INTO PRODUCT (ID, NAME, PRICE) VALUES (:id, :name, :price)"/>
  <property name="itemSqlParameterSourceProvider">
    <bean class="org.springframework.batch.item.database.BeanPropertyItemSqlParameterSourceProvider"/>
  </property>
  <property name="assertUpdates" value="true"/>
</bean>
```

O tamanho do batch é igual ao commit interval configurado no step em chunk: para um chunk de N itens o writer constrói N fontes de parâmetros, adiciona cada uma ao batch, e dispara um único `executeBatch()` — um round-trip em vez de N. É *por isso* que escritas em batch são o retorno de throughput do processamento orientado a chunk no lado de escrita, exatamente como leituras paginadas/por cursor são no lado de leitura (`spring-batch-database-item-readers`). Com `assertUpdates` em seu padrão `true`, uma instrução que atualiza zero linhas lança `EmptyResultDataAccessException`, capturando, digamos, um `UPDATE` cuja chave estava ausente.

### Parâmetros posicionais: `ItemPreparedStatementSetter`

Quando você quer preencher a instrução você mesmo, troque para marcadores `?` e um `ItemPreparedStatementSetter`, que entrega a você o `PreparedStatement` para cada item:

```java
public class ProductItemPreparedStatementSetter
        implements ItemPreparedStatementSetter<Product> {
    @Override
    public void setValues(Product item, PreparedStatement ps) throws SQLException {
        ps.setString(1, item.getId());
        ps.setString(2, item.getName());
        ps.setBigDecimal(3, item.getPrice());
    }
}
```

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.database.JdbcBatchItemWriter">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql" value="INSERT INTO PRODUCT (ID, NAME, PRICE) VALUES (?, ?, ?)"/>
  <property name="itemPreparedStatementSetter">
    <bean class="com.manning.sbia.ch06.database.ProductItemPreparedStatementSetter"/>
  </property>
</bean>
```

O batching é idêntico; só o estilo de binding muda. O binding nomeado é zero código quando os nomes dos parâmetros combinam com propriedades do bean; o binding posicional troca essa conveniência por controle explícito, coluna a coluna.

### Writers ORM: `JpaItemWriter` e `HibernateItemWriter`

Um writer ORM esconde a camada JDBC e deixa o contexto de persistência decidir entre `INSERT` e `UPDATE`. O núcleo do `HibernateItemWriter` do livro salva ou atualiza cada entidade que ainda não está na sessão, depois faz flush **uma vez** ao final do chunk:

```java
protected void doWrite(HibernateOperations hibernateTemplate, List<? extends T> items) {
    for (T item : items) {
        if (!hibernateTemplate.contains(item)) {
            hibernateTemplate.saveOrUpdate(item);
        }
    }
}
@Override
public void write(List<? extends T> items) {   // book signature (Spring Batch 2.x)
    doWrite(hibernateTemplate, items);
    hibernateTemplate.flush();                  // one flush per chunk
}
```

`JpaItemWriter` é o equivalente JPA, configurado com um `EntityManagerFactory` (e a entidade declarada em `META-INF/persistence.xml`):

```xml
<bean id="productItemWriter"
      class="org.springframework.batch.item.database.JpaItemWriter">
  <property name="entityManagerFactory" ref="entityManagerFactory"/>
</bean>
```

Ele faz `merge` de cada item que ainda não está gerenciado, depois faz flush do entity manager uma vez por chunk. Como `saveOrUpdate`/`merge` podem disparar um `SELECT` antes do `INSERT`/`UPDATE`, writers ORM fazem mais trabalho por item do que um batch JDBC puro — portabilidade e tratamento de cascade em troca de overhead. Crucialmente, esse flush acontece **dentro da transação do chunk**: o Spring Batch envolve cada chunk em uma transação (`spring-batch-chunk-processing`), o writer executa, e o commit faz flush do batch JDBC ou da sessão ORM; qualquer exceção reverte o chunk inteiro, então nenhum chunk parcial é persistido.

### Livro vs. hoje: builders substituem XML, e o 6.0 realocou os pacotes

Quatro coisas mudaram desde o livro (Spring Batch 2.x, 2012).

Primeiro, desde o **Spring Batch 4**, builders fluentes substituem o XML. `JdbcBatchItemWriterBuilder` (desde o 4.0) constrói o writer; `.beanMapped()` instala um `BeanPropertyItemSqlParameterSourceProvider`, enquanto `.itemPreparedStatementSetter(...)`/`.columnMapped()` cobrem o binding posicional:

```java
@Bean
public JdbcBatchItemWriter<Product> productItemWriter(DataSource dataSource) {
    return new JdbcBatchItemWriterBuilder<Product>()
            .dataSource(dataSource)
            .sql("INSERT INTO PRODUCT (ID, NAME, PRICE) VALUES (:id, :name, :price)")
            .beanMapped()          // BeanPropertyItemSqlParameterSourceProvider
            .assertUpdates(true)
            .build();
}
```

`JpaItemWriterBuilder` (desde o 4.1) faz o mesmo para JPA — e note que `JpaItemWriter` agora recebe seu `EntityManagerFactory` pelo **construtor** (o 5.0+ removeu o estilo de construtor padrão mais setter), com `.usePersist(true)` para chamar `persist` em vez do `merge` padrão:

```java
@Bean
public JpaItemWriter<Product> productJpaWriter(EntityManagerFactory emf) {
    return new JpaItemWriterBuilder<Product>()
            .entityManagerFactory(emf)   // jakarta.persistence, not javax.persistence
            .usePersist(true)
            .build();
}
```

Segundo, a **realocação de pacotes do 6.0**: essas classes se mudaram de `org.springframework.batch.item.database.*` para `org.springframework.batch.infrastructure.item.database.*` (builders sob `...infrastructure.item.database.builder`, e a interface `ItemWriter` para `org.springframework.batch.infrastructure.item.ItemWriter`). Os caminhos `org.springframework.batch.item.database.*` do livro e do 5.x agora retornam 404.

Terceiro, a assinatura de escrita mudou: `write(List<? extends T>)` (livro) virou `write(Chunk<? extends T>)` no Spring Batch 5.0, onde `Chunk` é `org.springframework.batch.infrastructure.item.Chunk`.

Quarto, `HibernateItemWriter` foi deprecated-for-removal no 5.x e **removido no 6.0** — migre para `JpaItemWriter`, que funciona com o Hibernate como provedor JPA (e `javax.persistence` virou `jakarta.persistence` no 5.0). O namespace XML `batch:` ainda faz parsing, mas está deprecated desde o 6.0 (remoção planejada para o 7.0), então Java config mais builders é o estilo recomendado. Confirmado via o Javadoc da API do Spring Batch 6.0.x para `JdbcBatchItemWriter`, `JpaItemWriter`, `JdbcBatchItemWriterBuilder`, e `JpaItemWriterBuilder`, o Javadoc do `HibernateItemWriter` da versão 5.0.5 (deprecated for removal), o Migration Guide do Spring Batch 6.0, e a referência de Database ItemReaders/Writers.

## Trade-offs

- **Binding nomeado vs. posicional** — `BeanPropertyItemSqlParameterSourceProvider` (`:name`) é zero código quando os nomes dos parâmetros SQL combinam com propriedades de bean; um `ItemPreparedStatementSetter` (`?`) é mais código, mas dá controle explícito e tipado e conversões por coluna. Convenção vs. controle.
- **Batch JDBC vs. writer ORM** — `JdbcBatchItemWriter` é o caminho mais rápido: um `executeBatch()` por chunk, sem `SELECT`s extras, comando total do SQL. `JpaItemWriter` compra portabilidade de dialeto e tratamento de cascade/identidade, mas `merge`/`saveOrUpdate` podem emitir um `SELECT` por item e, em geral, fazem mais trabalho.
- **O batching esconde qual item falhou** — como o chunk inteiro é escrito no commit, uma `DataIntegrityViolationException` aparece no momento do flush, não no item causador; skip/retry confiável força o Spring Batch a voltar para escritas item a item, trocando throughput por tratamento de erro preciso.
- **`assertUpdates` ligado vs. desligado** — deixá-lo `true` (padrão) captura uma instrução que atingiu zero linhas lançando `EmptyResultDataAccessException`; você precisa desligá-lo para instruções `MERGE`/upsert idempotentes que podem legitimamente não afetar linha nenhuma.
- **Nenhum writer em batch** — como uma escrita em banco de dados já é transacional, um `ItemWriter` sobre um DAO simples é perfeitamente válido; você abre mão do batching de round-trip único, mas ganha lógica de escrita arbitrária. Batching é uma otimização, não um requisito.

  ```java
  public class ProductDaoItemWriter implements ItemWriter<Product> {
      private final ProductDao dao;
      public ProductDaoItemWriter(ProductDao dao) { this.dao = dao; }
      @Override
      public void write(Chunk<? extends Product> chunk) {   // still inside the chunk transaction
          chunk.forEach(dao::save);                          // one call per item, no JDBC batch
      }
  }
  ```

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 6, "Writing data", section 6.3, "Writing to databases", p. 179-183 — doc
- [Spring Batch Reference — Database ItemReaders and ItemWriters](https://docs.spring.io/spring-batch/reference/readers-and-writers/database.html) — doc
- [Spring Batch 6.0 API — JdbcBatchItemWriter](https://docs.spring.io/spring-batch/docs/6.0.x/api/org/springframework/batch/infrastructure/item/database/JdbcBatchItemWriter.html) — doc
- [Spring Batch 6.0 Migration Guide](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
