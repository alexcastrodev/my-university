---
version: 1.0
updatedAt: 2026-09-11
---
## Objective

Uma cláusula `IN` do JPQL (ou SQL) com um número grande de valores literais não é ilimitada em todo banco de dados: o Oracle a rejeita quando ela ultrapassa 1000 elementos. Esse limite é uma restrição do banco, não do JPA ou do Hibernate, então ele aparece independentemente de como a query foi construída. Existem três formas práticas de contornar isso: fazer o batching dos valores você mesmo, reescrever o filtro como um sub-select ou, especificamente ao filtrar por chave primária, usar a API de multi-identifier loading do Hibernate.

## Use Cases

- Filtrar `WHERE b.id IN (:ids)` onde `:ids` é uma coleção cujo tamanho depende de input do usuário ou do resultado de outra query, e pode ultrapassar 1000 elementos no Oracle.
- Buscar um lote de entidades a partir de uma lista de chaves primárias vinda de outro sistema (um payload de mensagem, um arquivo de exportação) sem saber o tamanho dela de antemão.
- Substituir uma lista `IN` grande por uma condição equivalente que nem chega perto do limite de parâmetros/elementos do banco.

## Deep Dive

### A falha

```java
List<Long> ids = /* 1500 ids */;
em.createQuery("SELECT b FROM Book b WHERE b.id IN :ids", Book.class)
    .setParameter("ids", ids)
    .getResultList();
// ORA-01795: maximum number of expressions in a list is 1000
```

Esse é o limite rígido do próprio Oracle para o número de elementos em uma lista `IN (...)`; outros bancos têm seus próprios limites ou nenhum na escala do Oracle, mas o padrão de "a lista pode crescer de forma imprevisível" vale a pena tratar de forma defensiva independentemente do banco alvo.

### Opção 1: fazer o batching dos valores você mesmo

```java
List<Book> books = new ArrayList<>();
for (List<Long> batch : Lists.partition(ids, 1000)) {
    books.addAll(em.createQuery("SELECT b FROM Book b WHERE b.id IN :ids", Book.class)
        .setParameter("ids", batch)
        .getResultList());
}
```

Direto e portável, mas significa N queries em vez de uma, e a lógica de batching (e seu tamanho de lote) agora é algo que o código da sua aplicação precisa manter e acertar.

### Opção 2: reescrever como sub-select

```sql
SELECT b.* FROM book b
WHERE b.id IN (SELECT ol.book_id FROM order_line ol WHERE ol.order_id = :orderId)
```

Quando os valores usados no filtro vêm de outra query em vez de uma lista arbitrária em memória, um sub-select evita materializar a lista de ids por completo, ele nunca esbarra no limite de tamanho da lista do `IN` porque não há lista literal, só uma query aninhada. Isso só se aplica quando os valores do filtro são eles mesmos deriváveis por uma query; não ajuda para uma lista externa arbitrária de ids.

### Opção 3: `MultiIdentifierLoadAccess`, especificamente para busca por chave primária

```java
List<Book> books = em.unwrap(Session.class)
    .byMultipleIds(Book.class)
    .multiLoad(ids);
```

Quando os valores são chaves primárias, o `MultiIdentifierLoadAccess` do Hibernate (obtido via `Session.byMultipleIds()`) busca muitas entidades por id em uma única chamada, fazendo o batching do SQL subjacente internamente de acordo com `hibernate.jdbc.batch_size` (ou um fetch size definido explicitamente no loader), então o limite de 1000 elementos é tratado para você em vez de por particionamento manual. É uma API específica do Hibernate (acessada via `unwrap(Session.class)`), não JPA portável, e serve para carregar entidades por id especificamente, não para um filtro `IN` arbitrário em uma coluna que não é chave.

## Trade-offs

- **O batching manual é portável, mas empurra a lógica de batching para o código da aplicação.** Todo ponto de chamada que possa ultrapassar o limite precisa do seu próprio particionamento, e o tamanho do lote vira um número mágico que precisa ficar sincronizado com o limite real do banco alvo.
- **A reescrita como sub-select só funciona quando os valores vêm de uma query, não de uma lista arbitrária.** Ela resolve um formato diferente de problema em relação a "eu tenho uma `List<Long>` de tamanho desconhecido vinda de fora do banco".
- **`MultiIdentifierLoadAccess` é a opção mais limpa para buscas por id, mas é API do Hibernate, não JPA.** Usá-la via `unwrap(Session.class)` acopla o código ao Hibernate como provedor; ela não se aplica ao filtrar por uma coluna que não é chave primária.

  ```java
  // não aplicável: filtrar por uma coluna que não é id ainda precisa de batching ou sub-select
  em.createQuery("SELECT b FROM Book b WHERE b.isbn IN :isbns", Book.class);
  ```

## Documentation Links

- [Hibernate ORM User Guide — Natural Id and Multiple Identifier Loading](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#pc-loading) — doc
- [Hibernate ORM API — MultiIdentifierLoadAccess](https://docs.jboss.org/hibernate/orm/current/javadocs/org/hibernate/MultiIdentifierLoadAccess.html) — doc
- [Thorben Janssen — JPQL, Criteria API and Native Queries (Coffee with Thorben)](https://thorben-janssen.com/coffee-with-thorben/) — doc
