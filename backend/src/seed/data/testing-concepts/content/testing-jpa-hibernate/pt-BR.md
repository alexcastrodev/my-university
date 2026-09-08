---
version: 1.0
updatedAt: 2026-08-06
title: "Testando JPA e Hibernate"
summary: "Testando uma camada de persistência JPA/Hibernate: mapeamento de entidade, persistence.xml, e queries de EntityManager contra um banco de dados de teste, com a mudança crítica de pacote javax para jakarta (Hibernate 6 / Spring 6), a fatia @DataJpaTest, e o Testcontainers para testes de integração com banco de dados real, do JUnit in Action, Third Edition, Cap. 19.4-19.6."
---
## Objective

Um ORM mapeia objetos para linhas de banco de dados, então você escreve Java em vez de SQL. `JPA` (a Jakarta Persistence API) é a especificação; `Hibernate` é sua implementação mais comum. Uma classe de domínio vira uma tabela via anotações (`@Entity`, `@Table`, `@Id`, `@Column`), e um `EntityManager` persiste e consulta esses objetos. Testar uma camada de persistência significa levantar um `EntityManager` contra um banco de dados de teste, semear entidades dentro de uma transação, e afirmar que as queries as retornam; o livro faz isso contra um banco H2 em memória, configurado via `persistence.xml`.

## Use Cases

- Testar que uma classe de domínio está mapeada corretamente: que persisti-la e lê-la de volta produz o mesmo grafo de objetos.
- Verificar que queries JPQL (`select c from Country c`) retornam as entidades esperadas e respeitam filtros.
- Checar que a geração de schema a partir de anotações produz uma tabela funcional para a entidade.
- Testar métodos de repository/DAO construídos sobre `EntityManager` sem escrever SQL à mão.
- Fazer teste de regressão do comportamento de persistência (cascades, IDs gerados, transações) ao redor de um banco de dados em memória ou um real dentro de container.

## Deep Dive

### Mapeando uma classe para uma tabela

Anotações transformam um POJO em uma entidade gerenciada; `@GeneratedValue` delega a chave primária a uma coluna de identidade do banco de dados:

```java
@Entity
@Table(name = "COUNTRY")
public class Country {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "ID")
    private int id;

    @Column(name = "NAME")
    private String name;

    @Column(name = "CODE_NAME")
    private String codeName;
}
```

### Configurando a unidade de persistência

O `persistence.xml` (sob `META-INF`) nomeia uma unidade de persistência, aponta para o provedor JPA, e configura o banco de dados de teste. `hibernate.hbm2ddl.auto=create` reconstrói o schema a partir das anotações a cada execução, apropriado para um banco de dados de teste descartável:

```xml
<persistence-unit name="manning.hibernate">
    <provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
    <class>com.manning.junitbook.databases.model.Country</class>
    <properties>
        <property name="jakarta.persistence.jdbc.driver" value="org.h2.Driver"/>
        <property name="jakarta.persistence.jdbc.url" value="jdbc:h2:mem:test;DB_CLOSE_DELAY=-1"/>
        <property name="hibernate.dialect" value="org.hibernate.dialect.H2Dialect"/>
        <property name="hibernate.hbm2ddl.auto" value="create"/>
    </properties>
</persistence-unit>
```

(As chaves de propriedade acima são mostradas na forma atual `jakarta.*`; o livro usa `javax.*`; veja a nota abaixo.)

### Testando com um EntityManager

O teste constrói um `EntityManagerFactory` para essa unidade de persistência, semeia dados dentro de uma transação, e então os consulta de volta com JPQL:

```java
private EntityManager em;

@BeforeEach
void setUp() {
    EntityManagerFactory emf = Persistence.createEntityManagerFactory("manning.hibernate");
    em = emf.createEntityManager();
    em.getTransaction().begin();
    for (String[] row : COUNTRY_INIT_DATA) {
        em.persist(new Country(row[0], row[1]));
    }
    em.getTransaction().commit();
}

@Test
void testCountryList() {
    List<Country> countries = em.createQuery("select c from Country c", Country.class).getResultList();
    assertEquals(COUNTRY_INIT_DATA.length, countries.size());
}
```

### Livro vs. hoje: `javax` para `jakarta`, fatias de teste, e Testcontainers

> **O pacote de persistência mudou de `javax.persistence` para `jakarta.persistence`.** Esta é a mudança mais importante desde o livro de 2020. Quando o Java EE virou Jakarta EE, o namespace do JPA foi renomeado; o Hibernate 6 (2022) e o Spring 6 / Spring Boot 3 usam `jakarta.persistence` **exclusivamente**. O `import javax.persistence.*;` do livro e suas chaves de propriedade `javax.persistence.jdbc.*` **não compilam / não são reconhecidos** em uma stack atual; todo import e toda chave de propriedade do `persistence.xml` precisam ser `jakarta`:

```java
// book (JPA in javax, Hibernate 5)          // today (Jakarta Persistence, Hibernate 6+)
import javax.persistence.Entity;             import jakarta.persistence.Entity;
import javax.persistence.EntityManager;      import jakarta.persistence.EntityManager;
// property name="javax.persistence.jdbc.url"   property name="jakarta.persistence.jdbc.url"
```

> **Fatias do Spring Boot cuidam do boilerplate.** `@DataJpaTest` carrega só a camada JPA, configura um banco de dados de teste, e envolve cada teste em uma transação que sofre **rollback automaticamente**, substituindo a construção manual de `EntityManagerFactory`, o `persistence.xml`, e o `begin()`/`commit()` administrado à mão:

```java
@DataJpaTest
class CountryRepositoryTest {
    @Autowired CountryRepository repository;   // transaction + rollback handled for you
}
```

> **Teste contra o banco de dados real com Testcontainers.** O livro testa em H2 em memória, que não se comporta identicamente ao motor de produção. O Testcontainers (ausente do livro de 2020, hoje o padrão de fato) sobe o banco de dados *real*, PostgreSQL, MySQL, em um container Docker para o teste, eliminando a deriva de dialeto:

```java
@Testcontainers
class CountryRepositoryIT {
    @Container
    static PostgreSQLContainer<?> db = new PostgreSQLContainer<>("postgres:16");
    // Spring Boot 3.1+: @ServiceConnection wires the datasource to the container automatically
}
```

## Trade-offs

- **O H2 em memória dá uma falsa sensação de confiança**: a geração de schema e o JPQL podem passar contra o H2 e ainda assim quebrar no banco de dados de produção (dialeto, sequences, queries nativas, semântica de restrição); o H2 é bom para testes de fumaça de mapeamento, mas comportamento de persistência do qual você depende deveria ser verificado com Testcontainers contra o motor real.
- **`hbm2ddl.auto=create` é uma configuração só para teste**: ela descarta e recria o schema na inicialização, o que é exatamente errado para qualquer ambiente com dados reais:

```xml
<property name="hibernate.hbm2ddl.auto" value="create"/> <!-- data loss if pointed at a real DB -->
```

- **Gerenciamento manual de transação é propenso a erro**: o `em.getTransaction().begin()/commit()` do livro precisa ser combinado corretamente e desfeito à mão em caso de falha; um `commit()` esquecido ou um rollback ausente deixa os dados do teste em um estado indefinido, motivo pelo qual a transação-por-teste (rollback automático) do Spring é preferível.
- **Erros de mapeamento aparecem tarde**: um `@Column` com nome errado ou incompatibilidade de tipo compila sem problemas e só falha na geração de schema ou em tempo de query, não em tempo de build, então testes de ORM são essenciais precisamente porque o compilador não consegue verificar o mapeamento.

## Documentation Links

- [Migração da Jakarta Persistence (JPA): de `javax` para `jakarta` (guia de migração do Hibernate 6 ORM)](https://docs.jboss.org/hibernate/orm/6.0/migration-guide/migration-guide.html) (doc)
- [Data JPA & `@DataJpaTest`: referência do Spring Boot](https://docs.spring.io/spring-boot/reference/testing/spring-boot-applications.html#testing.spring-boot-applications.autoconfigured-spring-data-jpa) (doc)
- [Testcontainers for Java: documentação oficial](https://java.testcontainers.org/) (doc)
- [`@ServiceConnection` (integração com Testcontainers): referência do Spring Boot](https://docs.spring.io/spring-boot/reference/testing/testcontainers.html) (doc)
- [JUnit in Action, 3rd Ed., Cap. 19.4-19.6, "Testing database applications" (Hibernate, Spring Hibernate), pp. 388-397 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
