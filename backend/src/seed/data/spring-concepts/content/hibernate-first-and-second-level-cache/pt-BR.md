---
version: 1.0
updatedAt: 2026-09-11
---
## Objective

O first-level cache do Hibernate (o persistence context) e o second-level cache só são consultados em caminhos de acesso específicos, `em.find()` e ao percorrer uma associação to-one, não em toda forma de ler dados. Uma query JPQL, Criteria ou nativa sempre bate primeiro no banco de dados; os caches só entram em jogo depois, quando o Hibernate reconcilia as linhas que recebeu com entidades que talvez já gerencie.

## Use Cases

- Entender por que chamar repetidamente `em.find(Book.class, id)` para o mesmo id dentro de um mesmo persistence context retorna a mesma instância gerenciada sem uma segunda ida ao banco.
- Explicar por que uma query que retorna entidades ainda executa SQL toda vez, mesmo quando todas essas entidades já estão em cache.
- Decidir se o cache se aplica a um determinado padrão de acesso antes de recorrer ao second-level cache como correção de performance.
- Distinguir "entidade está em cache" de "resultado da query está em cache", dois mecanismos relacionados mas separados.

## Deep Dive

### `find()` e navegação to-one: cache primeiro

```java
Book book1 = em.find(Book.class, 1L);   // bate no banco
Book book2 = em.find(Book.class, 1L);   // mesmo persistence context: retornado do first-level cache, sem SQL
```

```java
Author author = book.getAuthor();       // associação to-one: a mesma busca em cache se aplica
```

Tanto `em.find()` quanto navegar por uma associação to-one passam pela mesma busca: primeiro checa o first-level cache (o persistence context atual), depois o second-level cache se houver um configurado e o tipo da entidade estiver marcado como cacheable, e só recorre ao banco se nenhum dos dois tiver a entidade.

### Queries sempre executam SQL, mas reaproveitam o que já foi carregado

```java
List<Book> books = em.createQuery("SELECT b FROM Book b", Book.class).getResultList();
```

Isso sempre envia um `SELECT` ao banco, não há checagem de cache antes de a query rodar. O que o cache *afeta* é o que acontece com cada linha depois: para cada linha no result set do JDBC, o Hibernate verifica se o first-level cache já tem uma entidade gerenciada para aquele identificador. Se tiver, essa linha é descartada e a instância já gerenciada é retornada no lugar dela, em vez de hidratar um segundo objeto para a mesma linha.

```java
// mesmo id já gerenciado a partir de um find() anterior neste persistence context
Book cached = em.find(Book.class, 1L);
List<Book> books = em.createQuery("SELECT b FROM Book b WHERE b.id = :id", Book.class)
    .setParameter("id", 1L)
    .getResultList();
// books.get(0) == cached -> true: o SQL ainda rodou, mas a linha virou a instância existente
```

### Fazer cache do resultado de uma query: o Query Cache separado

```java
TypedQuery<Book> query = em.createQuery("SELECT b FROM Book b WHERE b.author.id = :authorId", Book.class);
query.setParameter("authorId", 1L);
query.setHint("org.hibernate.cacheable", true);
```

Para pular a reexecução de uma query por completo, não só evitar rehidratar entidades, é preciso o Query Cache, um cache distinto e opt-in em relação aos caches de entidade de primeiro e segundo nível. Ele armazena os identificadores que uma query retornou, indexados pela query e seus parâmetros, e ainda depende do second-level cache para resolver esses identificadores de volta em dados de entidade.

## Trade-offs

- **Uma entidade cacheable não torna suas queries gratuitas.** A ida ao banco para uma query JPQL/Criteria/nativa acontece independentemente de quantas das linhas retornadas já estão em cache; só o custo de instanciação dos objetos é evitado.
- **O Query Cache adiciona complexidade de invalidação.** Qualquer insert, update ou delete na tabela subjacente pode invalidar resultados de query em cache, o que torna o Query Cache mais valioso para dados que mudam raramente em relação à frequência com que são consultados, e uma perda líquida caso contrário.
- **O escopo do first-level cache é o persistence context, não a aplicação.** Duas requisições diferentes, cada uma com seu próprio `EntityManager`, não compartilham first-level cache; só o second-level cache (opcional) é compartilhado entre persistence contexts.

## Documentation Links

- [Hibernate ORM User Guide — Caching](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#caching) — doc
- [Jakarta Persistence API — EntityManager.find](https://jakarta.ee/specifications/persistence/3.2/apidocs/jakarta.persistence/jakarta/persistence/entitymanager) — doc
- [Thorben Janssen — JPQL, Criteria API and Native Queries (Coffee with Thorben)](https://thorben-janssen.com/coffee-with-thorben/) — doc
