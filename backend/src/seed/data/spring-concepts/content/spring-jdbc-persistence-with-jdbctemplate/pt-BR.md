---
version: 1.0
updatedAt: 2026-08-01
title: Persistência com JDBC no Spring usando JdbcTemplate e SimpleJdbcInsert
---
## Objective

JDBC puro enterra uma query de uma linha debaixo de configuração de conexão,
criação de statement e limpeza em try/finally — e obriga toda chamada a lidar
com uma `SQLException` checked que, na maioria das vezes, não dá pra
recuperar de forma significativa mesmo. O `JdbcTemplate` reduz essa cerimônia
à própria query e a um `RowMapper`; o `SimpleJdbcInsert` vai além para o caso
comum de "inserir uma linha e receber de volta sua chave gerada."

## Use Cases

- Consultar uma tabela de referência pequena (como uma lista de ingredientes
  de taco) e transformá-la em objetos de domínio sem escrever na mão o
  encanamento de `Connection`/`PreparedStatement`/`ResultSet`.
- Inserir uma linha e precisar imediatamente do ID gerado pelo banco para
  salvar linhas relacionadas numa tabela filha (ex.: o ID de um taco antes de
  inserir suas associações de ingrediente).
- Ter um schema de banco de dados novo e dados de referência carregados
  automaticamente toda vez que uma aplicação Spring Boot sobe, sem
  configuração extra.

## Deep Dive

### JdbcTemplate: query() e queryForObject() com um RowMapper

```java
@Repository
public class JdbcIngredientRepository implements IngredientRepository {

    private JdbcTemplate jdbc;

    public JdbcIngredientRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Iterable<Ingredient> findAll() {
        return jdbc.query("select id, name, type from Ingredient",
            this::mapRowToIngredient);
    }

    @Override
    public Ingredient findOne(String id) {
        return jdbc.queryForObject(
            "select id, name, type from Ingredient where id=?",
            this::mapRowToIngredient, id);
    }

    private Ingredient mapRowToIngredient(ResultSet rs, int rowNum) throws SQLException {
        return new Ingredient(
            rs.getString("id"),
            rs.getString("name"),
            Ingredient.Type.valueOf(rs.getString("type")));
    }
}
```

`query()` retorna uma coleção e precisa de um `RowMapper` (uma method
reference funciona bem, como mostrado acima, ou uma implementação explícita
de `RowMapper<T>` quando a lógica de mapeamento é reutilizada em outro lugar);
`queryForObject()` é a mesma ideia para uma única linha esperada, com os
parâmetros da query preenchidos via os varargs finais (`id`, aqui) em vez de
uma substituição de `?` crua que você teria que escapar sozinho.

### Inserindo do jeito difícil: PreparedStatementCreator + GeneratedKeyHolder

Quando um save precisa do ID gerado pelo banco de volta (para depois inserir
linhas filhas), `update()` recebe um `PreparedStatementCreator` e um
`KeyHolder`:

```java
private long saveTacoInfo(Taco taco) {
    taco.setCreatedAt(new Date());
    PreparedStatementCreator psc = new PreparedStatementCreatorFactory(
        "insert into Taco (name, createdAt) values (?, ?)",
        Types.VARCHAR, Types.TIMESTAMP
    ).newPreparedStatementCreator(
        Arrays.asList(taco.getName(), new Timestamp(taco.getCreatedAt().getTime())));

    KeyHolder keyHolder = new GeneratedKeyHolder();
    jdbc.update(psc, keyHolder);
    return keyHolder.getKey().longValue();
}
```

Esse é o caminho mais verboso de toda a seção — uma `PreparedStatementCreatorFactory`
construída a partir do SQL e do `java.sql.Types` de cada parâmetro, depois um
`PreparedStatementCreator` construído a partir dos valores reais, antes mesmo
de `update()` poder rodar.

### Inserindo do jeito fácil: SimpleJdbcInsert

Para uma tabela onde a chave gerada só precisa voltar como um valor (sem
passar por um `PreparedStatementCreator` customizado), o `SimpleJdbcInsert`
envolve o mesmo `JdbcTemplate` com bem menos código:

```java
this.orderInserter = new SimpleJdbcInsert(jdbc)
    .withTableName("Taco_Order")
    .usingGeneratedKeyColumns("id");

Map<String, Object> values = objectMapper.convertValue(order, Map.class);
values.put("placedAt", order.getPlacedAt());
long orderId = orderInserter.executeAndReturnKey(values).longValue();
```

`execute()`/`executeAndReturnKey()` recebem ambos um `Map<String, Object>`
cujas chaves são nomes de coluna — o livro constrói esse map reaproveitando o
`ObjectMapper.convertValue()` do Jackson para transformar o objeto `Order`
num `Map` em uma linha, em vez de copiar cada propriedade na mão.

### Auto-inicializando o banco: schema.sql e data.sql

O Spring Boot executa `schema.sql` e `data.sql` a partir da raiz do classpath
(`src/main/resources`) contra o datasource automaticamente na inicialização —
sem configuração extra necessária para esse comportamento em si:

```sql
-- schema.sql
create table if not exists Ingredient (
  id varchar(4) not null,
  name varchar(25) not null,
  type varchar(10) not null
);
```

```sql
-- data.sql
delete from Ingredient;
insert into Ingredient (id, name, type) values ('FLTO', 'Flour Tortilla', 'WRAP');
```

É por isso que os exemplos do livro funcionam de primeira contra o banco H2
embutido — o schema e os dados de referência simplesmente estão lá toda vez
que a aplicação sobe, o que é conveniente para um banco de demo/dev mas não é
algo que você gostaria de rodar de novo — com `delete from` destrutivo — a
cada restart contra um banco de produção real.

## Trade-offs

- **O `JdbcTemplate` elimina o boilerplate de conexão/statement/result-set e a
  necessidade de você mesmo lidar com `SQLException`, mas ainda é
  fundamentalmente SQL-em-string-mais-parâmetros-posicionais** — um typo no
  SQL ou um erro na ordem dos parâmetros só aparece em runtime, não em tempo
  de compilação.
- **A conveniência do `Map<String, Object>` do `SimpleJdbcInsert` (especialmente
  via `ObjectMapper.convertValue()`) troca explicitude por brevidade** — o
  próprio livro chama isso de "uso meio hackish do `ObjectMapper`"; funciona
  porque o Jackson já está no classpath via o starter web, não porque seja a
  ferramenta idiomática para conversão de objeto para map.
- **Book vs. today: o Spring Framework 6.1 introduziu o `JdbcClient`, uma
  fachada fluente unificando `JdbcTemplate` e `NamedParameterJdbcTemplate`** —
  a documentação oficial do Spring hoje aponta o `JdbcClient` como o ponto de
  entrada preferido para código novo (estilo
  `client.sql("...").param("id", 3).query(Type.class).optional()`), com
  `JdbcTemplate`/`SimpleJdbcInsert` permanecendo para casos de nível mais
  baixo ou mais complexos (operações em lote, stored procedures) em vez de
  serem a recomendação padrão. A abordagem do livro, de 2019, focada só em
  `JdbcTemplate`, ainda funciona perfeitamente hoje — o `JdbcClient` fica em
  cima dele, não substitui o mecanismo subjacente.
- **A auto-execução de `schema.sql`/`data.sql` é uma conveniência de
  dev/demo, não uma estratégia de migração** — não tem versionamento e roda
  de forma destrutiva a cada restart; aplicações reais recorrem a Flyway ou
  Liquibase assim que o schema precisa evoluir com segurança entre ambientes.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 3, "Working with data", section 3.1, p. 56-74 — doc
- [Spring Framework Reference — Data Access with JDBC (JdbcTemplate)](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html) — doc
- [Spring Framework API — JdbcClient (fluent facade over JdbcTemplate)](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/jdbc/core/simple/JdbcClient.html) — doc
- [Spring Boot Reference — SQL Databases (schema.sql/data.sql initialization)](https://docs.spring.io/spring-boot/how-to/data-initialization.html) — doc
