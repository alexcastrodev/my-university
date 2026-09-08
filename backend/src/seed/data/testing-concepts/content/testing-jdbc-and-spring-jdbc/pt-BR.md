---
version: 1.0
updatedAt: 2026-08-06
title: "Testando JDBC e Spring JDBC"
summary: "Testando código de acesso a dados contra um banco de dados em memória, do JDBC puro (Connection/PreparedStatement/ResultSet) ao JdbcTemplate/NamedParameterJdbcTemplate do Spring, com notas sobre o carregamento obsoleto de driver via Class.forName, o JdbcTemplate injetado em vez do JdbcDaoSupport, e a fatia @JdbcTest, do JUnit in Action, Third Edition, Cap. 19.1-19.3."
---
## Objective

Antes de uma aplicação recorrer a um ORM, ela fala com um banco de dados relacional através do `JDBC`, a API Java de baixo nível para abrir uma conexão, rodar SQL e ler um `ResultSet`. Testar esse tipo de código significa apontá-lo para um banco de dados que o teste controla, tipicamente um em memória (H2) criado e descartado ao redor de cada teste para que as execuções continuem rápidas e isoladas. O `JdbcTemplate` do Spring fica em cima do JDBC puro e remove o boilerplate de conexão/exceção/recurso, então o mesmo teste de acesso a dados fica bem mais curto, ainda exercitando SQL real contra um banco de dados (embutido) real.

## Use Cases

- Testar um DAO que emite SQL escrito à mão, criando o schema, inserindo linhas conhecidas, rodando o DAO e afirmando sobre os resultados, tudo contra um banco de dados em memória.
- Verificar que uma query mapeia colunas de `ResultSet` para objetos de domínio corretamente (campos certos, ordem certa).
- Migrar acesso a dados via JDBC puro para o `JdbcTemplate`/`NamedParameterJdbcTemplate` do Spring, mantendo os testes verdes durante a mudança.
- Testar SQL com parâmetros nomeados (`:name`) em vez de placeholders posicionais `?`, mais fáceis de ler e reordenar.
- Obter feedback rápido e determinístico de acesso a dados em CI, sem provisionar um servidor de banco de dados externo.

## Deep Dive

### Acesso a dados via JDBC puro

O JDBC puro gerencia tudo à mão: abrir uma conexão, preparar uma statement, iterar o `ResultSet`, fechar recursos. O DAO do livro lê países de um banco H2:

```java
public List<Country> getCountryList() {
    List<Country> countryList = new ArrayList<>();
    try {
        Connection connection = openConnection();
        PreparedStatement statement = connection.prepareStatement("select * from country");
        ResultSet resultSet = statement.executeQuery();
        while (resultSet.next()) {
            countryList.add(new Country(resultSet.getString(2), resultSet.getString(3)));
        }
        statement.close();
    } catch (SQLException e) {
        throw new RuntimeException(e);
    } finally {
        closeConnection();
    }
    return countryList;
}
```

### Testando contra um banco de dados em memória

O teste controla o schema: cria a tabela (e semeia linhas) antes de cada teste, a descarta depois, de modo que todo teste comece de um estado conhecido. Como o H2 roda em processo, nenhum servidor precisa ser iniciado:

```java
@BeforeEach
void setUp() {
    TablesManager.createTable();   // CREATE TABLE COUNTRY(...)
    // insert known rows
}

@AfterEach
void tearDown() {
    TablesManager.dropTable();     // DROP TABLE IF EXISTS COUNTRY
}

@Test
void testGetCountryList() {
    List<Country> countries = countryDao.getCountryList();
    assertEquals(expectedCountries, countries);
}
```

### Spring JDBC: o `JdbcTemplate` remove o boilerplate

O `JdbcTemplate` cuida da conexão, da statement, da tradução de exceção e da limpeza de recursos, então o DAO encolhe para o SQL e um mapeamento de linha. O `NamedParameterJdbcTemplate` adiciona parâmetros nomeados:

```java
NamedParameterJdbcTemplate template = new NamedParameterJdbcTemplate(dataSource);
Map<String, Object> params = Map.of("name", name + "%");
return template.query(
    "select * from country where name like :name",
    params,
    (rs, rowNum) -> new Country(rs.getString("NAME"), rs.getString("CODE_NAME")));
```

O teste se parece com o de antes, ainda roda SQL real contra o banco de dados embutido, mas o código de produção não gerencia mais conexões à mão.

### Livro vs. hoje: carregamento obsoleto de driver, `JdbcDaoSupport`, e fatias de teste

> **`Class.forName("org.h2.Driver")` está obsoleto.** O `ConnectionManager` do livro carrega o driver explicitamente. Desde o JDBC 4.0 (Java 6, 2008), drivers no classpath são auto-registrados via o mecanismo `ServiceLoader`, então a chamada `Class.forName(...)` é código morto desnecessário hoje:

```java
// book: manual, no longer needed
Class.forName("org.h2.Driver");
Connection c = DriverManager.getConnection("jdbc:h2:~/country", "sa", "");
// today: the driver registers itself; just get the connection
Connection c = DriverManager.getConnection("jdbc:h2:~/country", "sa", "");
```

> **Prefira um `JdbcTemplate` injetado em vez de estender `JdbcDaoSupport`.** Os DAOs do livro `extends JdbcDaoSupport` e chamam `getJdbcTemplate()`. Essa classe base é anterior à injeção por construtor; o Spring moderno injeta um `JdbcTemplate` (ou `NamedParameterJdbcTemplate`) diretamente, o que é mais fácil de testar e não amarra o DAO a uma classe base do Spring:

```java
@Repository
public class CountryDao {
    private final JdbcTemplate jdbcTemplate;
    public CountryDao(JdbcTemplate jdbcTemplate) {  // injected, no JdbcDaoSupport
        this.jdbcTemplate = jdbcTemplate;
    }
}
```

> **O Spring Boot tem uma fatia para isto.** `@JdbcTest` carrega só a infraestrutura JDBC e um banco de dados embutido, e `@Sql` roda scripts de setup, substituindo o encanamento manual de `createTable()`/`dropTable()`.

## Trade-offs

- **Um banco de dados em memória é rápido, mas não é o seu banco de dados de produção**: o H2 não é PostgreSQL/Oracle; seu dialeto SQL, coerções de tipo e comportamento de restrição diferem, então um teste pode passar no H2 e o mesmo SQL falhar em produção (o "descompasso de impedância" que o livro nomeia). Para SQL do qual você depende, faça teste de integração contra o motor real (veja a nota sobre Testcontainers no conceito de JPA/Hibernate).
- **JDBC puro vaza recursos se você esquecer o `finally`**: toda conexão/statement precisa ser fechada explicitamente, e um `close()` esquecido é um vazamento que o compilador não vai capturar:

```java
PreparedStatement statement = connection.prepareStatement(sql);
// no finally { statement.close(); connection.close(); } → leaked on exception
```

- **O `JdbcTemplate` troca explicitude por mágica**: ele engole o ciclo de vida da conexão e traduz `SQLException` para a `DataAccessException` não verificada do Spring; conveniente, mas você não vê mais exatamente quando a conexão abre/fecha, o que importa para depurar limites de transação.
- **Acesso por índice de coluna é frágil**: o `resultSet.getString(2)` do livro quebra silenciosamente se a ordem das colunas do `SELECT` mudar; `getString("NAME")` (ou um `RowMapper`) é mais robusto:

```java
new Country(rs.getString(2), rs.getString(3)); // breaks if the query's column order changes
```

## Documentation Links

- [Acesso a Dados com JDBC: referência do Spring Framework](https://docs.spring.io/spring-framework/reference/data-access/jdbc.html) (doc)
- [`JdbcTemplate` / `NamedParameterJdbcTemplate`: Spring Framework](https://docs.spring.io/spring-framework/reference/data-access/jdbc/core.html) (doc)
- [Auto-configuração do `@JdbcTest`: referência do Spring Boot](https://docs.spring.io/spring-boot/appendix/test-auto-configuration/index.html) (doc)
- [JUnit in Action, 3rd Ed., Cap. 19.1-19.3, "Testing database applications" (JDBC, Spring JDBC), pp. 373-388 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
