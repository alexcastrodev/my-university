---
version: 1.0
updatedAt: 2026-08-22
title: "Panache: Padrões Active Record e Repository"
summary: "O Panache oferece entidades active-record e alternativas no estilo repository sobre o Hibernate ORM puro, com strings de query simplificadas, paginação e ordenação embutidas."
---
## Objective

O Panache é a camada opinativa do Quarkus sobre o Hibernate ORM, que retira a maior parte da cerimônia de JPA/EntityManager. Ele oferece dois estilos para as mesmas entidades subjacentes: um estilo active-record em que a própria classe de entidade expõe `find`/`list`/`persist` como métodos estáticos, e um estilo repository em que essas mesmas operações vivem em um `PanacheRepository` injetável. Os dois compilam para Hibernate ORM puro; o Panache é uma camada de conveniência, não um motor de persistência diferente.

## Use Cases

- Serviços CRUD pequenos a médios e intensivos em CRUD, onde o boilerplate completo de JPA (getters/setters, chamadas de `EntityManager` para toda operação) é puro overhead.
- Bases de código que preferem manter a lógica de query perto da entidade sobre a qual opera (active record) versus bases de código que preferem uma separação limpa entre entidades e lógica de acesso a dados (repository).
- Qualquer query que possa ser expressa como uma string de query Panache simplificada, evitando JPQL escrito à mão para o caso comum (filtros de igualdade, ordenação, parâmetros nomeados/posicionais).
- Paginar ou ordenar conjuntos de resultado sem escrever boilerplate manual de `setFirstResult`/`setMaxResults`/`ORDER BY`.

## Deep Dive

### Entidades active record

Uma entidade estende `PanacheEntity`, que fornece um `Long id` autogerado e um conjunto completo de métodos estáticos finder/persist:

```java
@Entity
public class Person extends PanacheEntity {
    public String name;
    public LocalDate birth;
    public Status status;
}
```

Os campos são públicos e acessados diretamente; o Panache abraça a ideia de que getters/setters não agregam valor para classes de dados simples. Queries customizadas são adicionadas como métodos estáticos adicionais na própria entidade:

```java
public static Person findByName(String name) {
    return find("name", name).firstResult();
}
```

Operações comuns: `Person.findAll()`, `Person.findById(id)`, `Person.list("status", Status.Alive)`, `Person.count()`, `person.persist()`, `Person.delete("name", "value")`. Variantes que retornam Stream existem para os métodos no estilo lista, quando você quer processar resultados de forma preguiçosa.

Se você precisar de um tipo ou estratégia de identificador customizado, em vez do `Long id` embutido, estenda `PanacheEntityBase` no lugar de `PanacheEntity` e declare o campo `@Id` você mesmo.

### Acesso no estilo repository

Para times que preferem entidades sem nenhum método estático ciente de persistência, a mesma funcionalidade está disponível através de `PanacheRepository<T>`, implementado por um bean injetável:

```java
@ApplicationScoped
public class PersonRepository implements PanacheRepository<Person> {
    public Person findByName(String name) {
        return find("name", name).firstResult();
    }
}
```

```java
@Inject
PersonRepository personRepository;

long count = personRepository.count();
personRepository.persist(person);
```

A superfície de métodos espelha quase um a um a API active-record, só movida de métodos estáticos na entidade para métodos de instância no repository. `PanacheRepositoryBase<Entity, IdType>` é o equivalente, do lado do repository, de `PanacheEntityBase`, para entidades com um identificador que não é `Long`.

### Strings de query simplificadas

Os métodos `find`/`list`/`count`/`delete` do Panache aceitam uma linguagem de query abreviada, em vez de exigir JPQL completo. Um nome de atributo simples vira uma checagem de igualdade contra o primeiro parâmetro; uma cláusula `order by` recebe um `FROM EntityName` completo, adicionado automaticamente:

```java
Person.list("status", Status.Alive);
Person.list("order by name");
```

Parâmetros posicionais e nomeados funcionam para qualquer coisa além de igualdade simples:

```java
Person.find("name = ?1 and status = ?2", "stef", Status.Alive);
Person.find("name = :name", Map.of("name", "stef")).firstResult();
```

### Paginação e ordenação

`PanacheQuery`, o objeto retornado por `find`, suporta paginação diretamente, sem matemática manual de offset/limit:

```java
PanacheQuery<Person> livingPersons = Person.find("status", Status.Alive);
livingPersons.page(Page.ofSize(25));
List<Person> firstPage = livingPersons.list();
List<Person> secondPage = livingPersons.nextPage().list();
```

A ordenação é expressa com o helper `Sort`, componível entre múltiplos campos:

```java
List<Person> persons = Person.list(
    Sort.by("name").and("birth"),
    Status.Alive
);
```

## Trade-offs

- **Active record acopla persistência à classe de entidade**: conveniente para serviços pequenos, mas significa que a entidade carrega responsabilidade de acesso a dados, algo que alguns times evitam intencionalmente usando o estilo repository em vez disso.
- **Campos públicos trocam encapsulamento por brevidade**: o estilo de acesso por campo do Panache é uma escolha deliberada de simplicidade, não compatível com bases de código que impõem acesso só via getter/setter ao estado da entidade.
- **A abreviação de query tem um teto**: a sintaxe de string simplificada cobre bem igualdade, ordenação e condições parametrizadas simples; qualquer coisa com joins ou predicados complexos ainda precisa de uma string JPQL real ou uma query `CriteriaBuilder`.
- **Ainda é Hibernate ORM puro por baixo**: o Panache não substitui a semântica de sessão/transação do Hibernate (dirty checking, lazy loading, preocupações de N+1 ainda se aplicam); ele só remove o boilerplate ao redor de invocá-lo.
- **Escolher `PanacheEntity` vs `PanacheEntityBase` é uma porta sem volta por entidade**: o `Long id` embutido de `PanacheEntity` não pode ser trocado por um identificador customizado depois sem migrar a entidade para `PanacheEntityBase` e redefinir `@Id` você mesmo.
  ```java
  public class Person extends PanacheEntityBase { @Id public String code; }
  ```

## Documentation Links

- [Guia Hibernate ORM com Panache](https://quarkus.io/guides/hibernate-orm-panache) (guia dedicado com exemplos completos de active-record e repository, abreviação de query, paginação e ordenação)
- [Guia Hibernate ORM](https://quarkus.io/guides/hibernate-orm) (referencia o Panache como a alternativa simplificada ao uso direto de Hibernate ORM/JPA)
