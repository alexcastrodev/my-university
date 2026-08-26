---
version: 1.0
updatedAt: 2026-08-06
title: "Lendo de Bancos de Dados Relacionais: Item Readers JDBC e ORM"
---
## Objective

O banco de dados relacional é a outra fonte de input padrão de batch, ao lado de
arquivos (compare com o parsing orientado a linha em `spring-batch-reading-flat-files`).
A parte difícil é o tamanho: se um `SELECT` retorna um milhão de linhas, um
`JdbcTemplate.query(...)` ingênuo mantém todo objeto mapeado em memória até que o
result set inteiro seja lido. O Spring Batch resolve isso com implementações de
`ItemReader` que devolvem uma linha por `read()`, para que o chunk step
(`spring-batch-chunk-processing`) possa processar e commitar incrementalmente enquanto
a memória permanece estável. Esses readers tipicamente compartilham o mesmo
`DataSource` que sustenta as tabelas de metadados do job
(`spring-batch-job-repository-database-configuration`), mas eles rodam queries de
negócio, não a contabilidade do framework.

Existem duas famílias, e escolher entre elas é toda a história. Readers
**cursor-based** (`JdbcCursorItemReader`, `StoredProcedureItemReader`, e o
`HibernateCursorItemReader` do livro) emitem uma query e fazem streaming das linhas
através de um `ResultSet` JDBC ao vivo numa conexão mantida aberta. Readers **paging**
(`JdbcPagingItemReader`, `JpaPagingItemReader`, `HibernatePagingItemReader`) emitem
`SELECT`s sucessivos de tamanho fixo, cada um buscando uma página. Ambos vêm num sabor
JDBC puro e num sabor ORM; o sabor ORM troca SQL explícito por mapeamento de entidades.

## Use Cases

- Fazer streaming de uma tabela `product` grande num chunk step com um
  `JdbcCursorItemReader` e um `RowMapper`, uma linha por vez, sem bufferizar o
  resultado inteiro.
- Ler uma tabela ainda maior de forma **restartable** e sob **múltiplas threads** com
  `JdbcPagingItemReader`, onde cada página é um `SELECT` independente ordenado por uma
  chave de ordenação única.
- Originar linhas de um banco de dados via `StoredProcedureItemReader` (um `ResultSet`
  retornado, um parâmetro out com ref-cursor, ou um resultado de stored function).
- Ler entidades já mapeadas via ORM com uma query JPQL usando `JpaPagingItemReader`
  quando o modelo de domínio é definido com annotations JPA.
- Aplicar o padrão driving-query: ler somente identificadores com um reader cursor/
  paging JDBC, e deixar o processor carregar os objetos completos através do ORM na
  transação do writer.

## Deep Dive

### `JdbcCursorItemReader`: uma query, um cursor ao vivo

O reader cursor deixa a busca de dados a cargo do `ResultSet` JDBC — a forma em objeto
de um cursor de banco de dados. O Spring Batch executa exatamente um statement, depois
move o cursor uma linha por `read()`. As propriedades mínimas são `dataSource`, `sql` e
`rowMapper`:

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.database.JdbcCursorItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql"
            value="select id, name, description, price from product"/>
  <property name="rowMapper" ref="productRowMapper"/>
</bean>

<bean id="productRowMapper"
      class="com.manning.sbia.reading.jdbc.ProductRowMapper"/>
```

O `RowMapper` é a única peça que você sempre escreve — uma fábrica que transforma a
linha atual do `ResultSet` num objeto de domínio (o análogo no mundo de flat file é o
`FieldSetMapper` em `spring-batch-reading-flat-files`):

```java
public class ProductRowMapper implements RowMapper<Product> {
    public Product mapRow(ResultSet rs, int rowNum) throws SQLException {
        Product product = new Product();
        product.setId(rs.getString("id"));
        product.setName(rs.getString("name"));
        product.setDescription(rs.getString("description"));
        product.setPrice(rs.getFloat("price"));
        return product;
    }
}
```

Quando o SQL é parametrizado, defina um `preparedStatementSetter` (um
`PreparedStatementSetter` que liga placeholders `?`); ajuste o throughput com
`maxRows` (um limite rígido) e `fetchSize` (uma dica ao driver de quantas linhas puxar
por round-trip de rede):

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.database.JdbcCursorItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="sql"
            value="select id, name, description, price from product where name like ?"/>
  <property name="preparedStatementSetter" ref="samsungStatementSetter"/>
  <property name="rowMapper" ref="productRowMapper"/>
  <property name="fetchSize" value="100"/>
  <property name="maxRows" value="3000"/>
</bean>
```

O trade-off é estrutural: a conexão fica aberta durante o step inteiro, e como o mesmo
`ResultSet` é avançado a cada chamada, um `JdbcCursorItemReader` **não é thread-safe**.
Por padrão o cursor usa sua própria conexão e não entra na transação do step; defina
`useSharedExtendedConnection` (com um `ExtendedConnectionDataSourceProxy`) para manter
o cursor aberto através de commits.

### `StoredProcedureItemReader`: um cursor a partir de uma stored procedure

Quando o SQL vive no banco de dados, `StoredProcedureItemReader` estende a abordagem
cursor: substitua `sql` por `procedureName`. Ele lida com um `ResultSet` retornado, um
ref-cursor num parâmetro out (`refCursorPosition`), ou um resultado de stored function
(`function=true`), e reaproveita todas as demais propriedades de
`JdbcCursorItemReader`.

```xml
<bean id="reader"
      class="org.springframework.batch.item.database.StoredProcedureItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="procedureName" value="sp_product"/>
  <property name="rowMapper" ref="productRowMapper"/>
</bean>
```

### `JdbcPagingItemReader`: `SELECT`s sucessivos de tamanho fixo

Em vez de um cursor de vida longa, o reader paging roda muitas queries limitadas. Ele
precisa de um `PagingQueryProvider`; em vez de escolher um específico do banco na mão,
configure o `SqlPagingQueryProviderFactoryBean`, que detecta automaticamente o banco de
dados e retorna o provider certo (por exemplo `PostgresPagingQueryProvider`):

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.database.JdbcPagingItemReader">
  <property name="dataSource" ref="dataSource"/>
  <property name="queryProvider" ref="productQueryProvider"/>
  <property name="rowMapper" ref="productRowMapper"/>
  <property name="pageSize" value="1500"/>
</bean>

<bean id="productQueryProvider"
      class="org.springframework.batch.item.database.support.SqlPagingQueryProviderFactoryBean">
  <property name="dataSource" ref="dataSource"/>
  <property name="selectClause" value="select id, name, description, price"/>
  <property name="fromClause" value="from product"/>
  <property name="sortKey" value="id"/>
</bean>
```

Você fornece o `selectClause`, o `fromClause`, um `whereClause` opcional, e um
`sortKey`; o provider monta o SQL paginado. A primeira página é uma query limitada
simples, e cada página posterior adiciona um predicado na chave de ordenação:

```sql
SELECT id, name, description, price FROM product LIMIT 1500
SELECT id, name, description, price FROM product WHERE id > ? LIMIT 1500
```

Como as páginas são reancoradas na `sortKey` em vez de num cursor ao vivo, esse reader
é **restartable** e seguro para steps **multithreaded** — mas a sort key precisa ser
única, ou linhas podem ser puladas ou duplicadas entre páginas. O tamanho da página é
um knob de ajuste (a regra de bolso do livro é ~1.000, geralmente maior que o commit
interval): muito pequeno inunda o banco de dados de queries, muito grande anula a
economia de memória.

### Readers ORM: `HibernateCursorItemReader` e `JpaPagingItemReader`

ORM remove SQL escrito à mão mas complica o batch, porque o cache de primeiro nível
cresce conforme as linhas se acumulam. A resposta cursor do livro é a
`StatelessSession` do Hibernate (sem cache, sem dirty checking), exposta através do
`HibernateCursorItemReader` com `useStatelessSession=true` por padrão:

```xml
<bean id="productItemReader"
      class="org.springframework.batch.item.database.HibernateCursorItemReader">
  <property name="sessionFactory" ref="sessionFactory"/>
  <property name="queryString" value="from Product"/>
</bean>
```

O JPA não tem um equivalente sem cache à `StatelessSession`, então seu modo natural é
paging: `JpaPagingItemReader` roda uma query JPQL uma página por vez, depois
**desanexa as entidades e limpa o persistence context** após cada página para que
possam ser coletadas pelo garbage collector. `HibernatePagingItemReader` é a
contrapartida paging do Hibernate. A configuração espelha a forma cursor — troque a
factory e forneça a query.

### Livro vs. hoje: beans XML → builders fluentes, realocação para `infrastructure`, JPA em vez de Hibernate

Três mudanças concretas desde o livro de 2012 (Spring Batch 2.1), todas contra a linha
atual 6.0.x.

**Configuração Java + builders substituem os beans XML.** Desde o Spring Batch 4 cada
reader tem um `*Builder` fluente, e é isso que a referência atual mostra primeiro:

```java
@Bean
public JdbcCursorItemReader<Product> productItemReader(DataSource dataSource) {
    return new JdbcCursorItemReaderBuilder<Product>()
            .name("productItemReader")
            .dataSource(dataSource)
            .sql("select id, name, description, price from product")
            .rowMapper(new ProductRowMapper())
            .fetchSize(100)
            .build();
}

@Bean
public JdbcPagingItemReader<Product> productPagingReader(
        DataSource dataSource, PagingQueryProvider queryProvider) {
    return new JdbcPagingItemReaderBuilder<Product>()
            .name("productPagingReader")
            .dataSource(dataSource)
            .queryProvider(queryProvider)   // still built via SqlPagingQueryProviderFactoryBean
            .rowMapper(new ProductRowMapper())
            .pageSize(1000)
            .build();
}
```

O XML genérico de bean Spring acima ainda compila contra o nome de classe realocado,
mas o namespace XML específico de batch `batch:` está deprecated desde a 6.0, então
configuração Java mais `JdbcCursorItemReaderBuilder` / `JdbcPagingItemReaderBuilder` /
`JpaPagingItemReaderBuilder` é o estilo recomendado.

**As classes de item mudaram de pacote na 6.0.** O livro e a 5.x usavam
`org.springframework.batch.item.database.*`; o Spring Batch 6.0 os realocou para
`org.springframework.batch.infrastructure.item.database.*` (por exemplo
`org.springframework.batch.infrastructure.item.database.JdbcCursorItemReader`). Os
caminhos pré-6.0 de `org.springframework.batch.item.database.*` agora dão 404, então um
upgrade para 6.0 é uma mudança forçada de import, não algo drop-in.

**JPA agora é o reader ORM; os readers Hibernate se foram.** O Spring Batch 6.0 removeu
completamente `HibernateCursorItemReader` e `HibernatePagingItemReader` (eles já
estavam deprecated antes); o caminho de migração é `JpaCursorItemReader` (adicionado na
4.3, um cursor JPQL) e `JpaPagingItemReader`, ambos configurados com um
`EntityManagerFactory` em vez de um `SessionFactory` do Hibernate. A lista de readers do
apêndice da 6.0 confirma isso: ele distribui `JdbcCursorItemReader`/
`JdbcPagingItemReader`/`JpaCursorItemReader`/`JpaPagingItemReader` e nenhum reader
Hibernate. Confirmado pela referência 6.0.4 do Spring Batch, capítulo "Database", pelo
Javadoc da API 6.0.4 para `org.springframework.batch.infrastructure.item.database.JdbcCursorItemReader`,
e pelo Guia de Migração do Spring Batch 6.0.

## Trade-offs

- **Cursor vs. paging** — Um cursor emite uma query e faz streaming, mas fixa uma
  conexão para o step inteiro e é single-threaded; o mesmo `ResultSet` mantido torna
  `JdbcCursorItemReader` **não thread-safe**. Paging não mantém cursor longo, é
  restartable, e é thread-safe (`JdbcPagingItemReader`), ao custo de N queries e uma
  `sortKey` estrita e única. Trocar entre eles é só configuração, então o conselho do
  livro é testar os dois contra seu driver.
- **Ajuste de `fetchSize`** — Num reader cursor, `fetchSize` é só uma dica ao driver
  sobre linhas por round-trip; um bom valor reduz o tráfego de rede em leituras
  grandes, mas o efeito é inteiramente dependente do driver e do banco de dados, então
  é empírico, não garantido.
- **Tamanho da página** — Páginas maiores significam menos queries mas mais memória
  por página; páginas menores invertem isso. Ler 1M de linhas em páginas de 10 dispara
  100.000 queries. Mire perto de ~1.000 e geralmente acima do commit interval, depois
  meça.
- **ORM no batch** — A leitura roda numa transação separada do processamento/escrita,
  então lazy loading do ORM mais uma falha no meio do step é uma explosão clássica. O
  ORM cursor precisa da `StatelessSession` do Hibernate para impedir que o cache de
  primeiro nível cresça; o JPA contorna isso desanexando e limpando o contexto por
  página. Quando você precisa de semântica ORM de verdade, prefira o padrão
  driving-query a um cursor ORM simples.
- **JDBC vs. readers ORM** — JDBC puro força SQL explícito e um `RowMapper` mas é
  previsível e rápido; readers ORM apagam o SQL e reaproveitam mapeamentos de entidade
  existentes mas adicionam uma camada de cache que briga com o modelo de memória e
  transação do batch. Para importação em massa pura, JDBC paging costuma ser a escolha
  robusta mais simples.

## Documentation Links

- Cogoluègnes, Templier, Gregory, Bazoud, "Spring Batch in Action" (Manning, 2012) — Chapter 5, "Reading data", sections 5.5-5.6, "Reading from relational databases" / "Using ORM item readers", p. 139-151 — doc
- [Spring Batch Reference — Database (Cursor-based and Paging `ItemReader` implementations)](https://docs.spring.io/spring-batch/reference/readers-and-writers/database.html) — doc
- [Spring Batch 6.0.4 API — `org.springframework.batch.infrastructure.item.database.JdbcCursorItemReader`](https://docs.spring.io/spring-batch/reference/api/org/springframework/batch/infrastructure/item/database/JdbcCursorItemReader.html) — doc
- [Spring Batch 6.0 Migration Guide (Hibernate item readers removed; `infrastructure` package relocation)](https://github.com/spring-projects/spring-batch/wiki/Spring-Batch-6.0-Migration-Guide) — doc
