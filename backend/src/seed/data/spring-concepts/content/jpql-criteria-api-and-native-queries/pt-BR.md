---
version: 1.0
updatedAt: 2026-09-11
---
## Objective

O JPA oferece três formas de definir uma query: JPQL, Criteria API e SQL nativo. Elas parecem três formas de fazer a mesma coisa, mas não são: cada uma equilibra de um jeito diferente portabilidade, type safety e acesso a recursos específicos do banco, e o Hibernate (ou qualquer provedor JPA) só consegue traduzir o que ele entende. JPQL e Criteria API expõem o mesmo conjunto de recursos (JPQL como uma linguagem de query baseada em strings, Criteria API como uma API Java sobre esse mesmo modelo), e ambas são intencionalmente menos poderosas que SQL puro. Queries nativas removem esse limite por completo.

## Use Cases

- Escrever uma query contra o seu domain model (classes de entidade e suas associações mapeadas) em vez de nomes de tabelas e colunas de chave estrangeira, para que a query continue válida se o schema subjacente for refatorado: use JPQL.
- Dar suporte a múltiplos bancos de dados com uma única base de código, onde uma instrução SQL escrita à mão precisaria de um dialeto diferente por fornecedor: use JPQL ou a Criteria API, já que o Hibernate gera o SQL específico do fornecedor para você.
- Construir uma query cujos joins, filtros ou colunas selecionadas dependem de input em tempo de execução (um formulário de busca com uma dúzia de campos opcionais), em vez de uma query fixa em tempo de compilação: use a Criteria API.
- Precisar de um recurso específico do banco, de uma função complexa ou de SQL ajustado com precisão que o JPQL simplesmente não consegue expressar: use uma query nativa.

## Deep Dive

### JPQL: baseado em strings, mas sobre o domain model

```java
TypedQuery<Book> query = em.createQuery(
    "SELECT b FROM Book b WHERE b.title LIKE :title", Book.class);
query.setParameter("title", "%Hibernate%");
List<Book> books = query.getResultList();
```

`SELECT b FROM Book b` se refere à entidade `Book`, não a uma tabela que o banco de dados entende. O Hibernate traduz isso na instrução SQL que de fato roda, resolvendo `Book` para sua tabela e colunas mapeadas. O bind parameter nomeado (`:title`, definido com `setParameter`) é o que protege essa query contra SQL injection; concatenar a string de busca diretamente na query não ofereceria essa proteção.

Você também pode declarar uma query JPQL uma única vez, junto à entidade, como uma named query:

```java
@Entity
@NamedQuery(
    name = "Book.findByTitle",
    query = "SELECT b FROM Book b WHERE b.title LIKE :title"
)
public class Book { /* ... */ }
```

```java
TypedQuery<Book> query = em.createNamedQuery("Book.findByTitle", Book.class);
query.setParameter("title", "%Hibernate%");
```

### Criteria API: o mesmo conjunto de recursos, como um grafo de objetos Java

```java
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery<Book> cq = cb.createQuery(Book.class);

Root<Book> book = cq.from(Book.class);
Join<Book, Author> author = book.join(Book_.authors);

ParameterExpression<String> firstName = cb.parameter(String.class);
ParameterExpression<String> lastName = cb.parameter(String.class);

cq.where(cb.and(
    cb.equal(author.get(Author_.firstName), firstName),
    cb.equal(author.get(Author_.lastName), lastName)
));

TypedQuery<Book> query = em.createQuery(cq);
query.setParameter(firstName, "Joshua");
query.setParameter(lastName, "Bloch");
List<Book> books = query.getResultList();
```

`Book_` e `Author_` são classes de metamodel estático geradas pelo annotation processor do JPA, uma por entidade, espelhando seus atributos mapeados como campos estáticos. Referenciar `Book_.authors` em vez da string `"authors"` é o que dá à Criteria API suas principais vantagens sobre o JPQL: um erro de digitação se torna um erro de compilação, e renomear um atributo da entidade passa a ser uma refatoração segura em vez de uma falha silenciosa em tempo de execução dentro de uma string de query.

A árvore de chamadas `and`/`equal`/`join` é o que torna a Criteria API mais verbosa de ler em comparação com o JPQL equivalente. Essa verbosidade compra a capacidade de construir a query condicionalmente: se o `join` deve ser adicionado, qual atributo comparar e quantas cláusulas `and` encadear podem todos ser decididos por código, com base em quais campos o chamador realmente forneceu, algo que uma string JPQL fixa não consegue fazer.

### Queries nativas: a abstração removida por completo

```java
Query query = em.createNativeQuery(
    "SELECT * FROM book b WHERE b.title LIKE :title", Book.class);
query.setParameter("title", "%Hibernate%");
List<Book> books = query.getResultList();
```

Agora `book` é a tabela, não a entidade, e `*` pode incluir colunas que a entidade nem mapeia. O Hibernate não faz nenhum parsing dessa instrução, ele apenas a entrega ao banco como está. Isso significa que você tem acesso a todos os recursos suportados pelo seu banco específico (funções do fornecedor, hints, construções complexas para as quais o JPQL não tem sintaxe), mas a instrução deixa de ser portável: a mesma query nativa pode precisar de um dialeto diferente no Oracle e no PostgreSQL.

### Bind parameters: a defesa real contra SQL injection

As três abordagens são igualmente seguras contra SQL injection, mas somente se bind parameters forem usados de forma consistente; concatenação de strings anula a proteção independentemente de qual API constrói a query. Os exemplos de JPQL e query nativa acima usam `setParameter` com um placeholder nomeado; a Criteria API alcança o mesmo resultado com `ParameterExpression`.

## Trade-offs

- **JPQL e Criteria API são tão poderosas quanto o que o Hibernate consegue traduzir para SQL.** O conjunto de recursos delas é intencionalmente um subconjunto do SQL completo, então uma query que precisa de uma função ou construção específica do banco simplesmente não pode ser escrita em nenhuma das duas, recaindo em uma query nativa.
- **A segurança e a flexibilidade extras da Criteria API vêm com verbosidade real.** Uma query com várias condições `and`/`or` se transforma em chamadas de builder profundamente aninhadas, difíceis de ler rapidamente.

  ```java
  cq.where(cb.and(
      cb.equal(author.get(Author_.firstName), firstName),
      cb.equal(author.get(Author_.lastName), lastName)
  ));
  ```

- **Queries nativas são as menos portáveis das três.** Uma instrução que usa sintaxe específica do PostgreSQL não vai rodar sem alteração no Oracle ou no SQL Server; suporte a múltiplos bancos empurra você de volta para JPQL ou Criteria API.
- **Selecionar a entidade, em vez de colunas específicas, busca todas as colunas mapeadas.** `SELECT b FROM Book b` carrega toda coluna que `Book` mapeia, mesmo quando só o título é necessário; selecionar atributos individuais (`SELECT b.title FROM Book b`) retorna uma projeção mais restrita.

  ```java
  List<Object[]> rows = em.createQuery(
      "SELECT b.id, b.title FROM Book b", Object[].class).getResultList();
  ```

- **O custo de performance da própria Criteria API está em construir a query, não em executá-la.** Uma vez traduzido, o SQL gerado para uma query JPQL e uma Criteria equivalentes é idêntico, então não há penalidade em tempo de execução por escolher uma em vez da outra para a mesma query; a escolha deve ser guiada por realmente precisar ou não de construção dinâmica.

## Documentation Links

- [Jakarta Persistence Specification — Jakarta Persistence Query Language (JPQL)](https://jakarta.ee/specifications/persistence/3.2/jakarta-persistence-spec-3.2#a4442) — doc
- [Jakarta Persistence API — CriteriaBuilder](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/criteria/criteriabuilder) — doc
- [Hibernate ORM User Guide — Native Queries](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#sql) — doc
- [Thorben Janssen — JPQL, Criteria API and Native Queries (Coffee with Thorben)](https://thorben-janssen.com/coffee-with-thorben/) — doc
