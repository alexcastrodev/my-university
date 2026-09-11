---
version: 1.0
updatedAt: 2026-09-11
---
## Objective

`hibernate.order_inserts` e `hibernate.order_updates` fazem o Hibernate agrupar e reordenar as instruções `INSERT`/`UPDATE` que ele empacota (batch) no momento do flush, para que instruções que tocam a mesma tabela aconteçam em uma ordem consistente entre transações. Em um cluster multi-node como o Galera, onde duas transações adquirindo locks nas mesmas linhas em ordens diferentes é uma causa comum de deadlock, essa ordenação consistente reduz a frequência com que isso acontece.

## Use Cases

- Rodar o Hibernate contra um cluster síncrono multi-primary (Galera, Percona XtraDB Cluster) onde deadlocks aparecem com mais frequência do que em um banco single-primary.
- Reduzir a frequência de deadlocks entre transações concorrentes que cada uma insere ou atualiza linhas em várias das mesmas tabelas, sem redesenhar as próprias transações.
- Uma mitigação barata, só de configuração, para tentar antes de recorrer a locking explícito, que troca throughput por segurança e não remove a contenção subjacente.

## Deep Dive

### O que "ordenação" significa aqui

Sem essas configurações, o Hibernate emite as instruções de insert/update na ordem em que as entidades foram persistidas ou modificadas no seu código, instruções de tabelas diferentes podem acabar intercaladas. Com a ordenação ativada, o Hibernate agrupa as instruções pendentes por tabela no momento do flush e executa o grupo de cada tabela junto, em uma ordem estável:

```properties
spring.jpa.properties.hibernate.order_inserts=true
spring.jpa.properties.hibernate.order_updates=true
```

```java
// código da aplicação intercala entidades de duas tabelas
em.persist(new Book(...));
em.persist(new Author(...));
em.persist(new Book(...));
// com order_inserts=true, o flush ainda agrupa: os dois inserts de Book, depois o insert de Author
```

### Por que isso ajuda com deadlocks, e por que não os previne

Um deadlock entre duas transações normalmente vem de cada uma adquirir locks no mesmo conjunto de linhas/tabelas em uma ordem diferente. Se toda transação consistentemente trava, digamos, `book` antes de `author`, as duas transações bloqueiam e esperam em vez de entrar em deadlock. Ordenar inserts e updates por tabela empurra o Hibernate nessa direção de ordenação consistente, mas não controla a ordem de leituras, deletes, ou qualquer locking que aconteça fora das instruções de insert/update em lote, então reduz a frequência de deadlocks em vez de eliminar a possibilidade.

### Benefício de batching como efeito colateral

Como instruções da mesma tabela acabam agrupadas, a ordenação também torna o batching do JDBC (`hibernate.jdbc.batch_size`) mais efetivo: um lote de `INSERT`s consecutivos contra a mesma tabela pode ser enviado como uma única instrução em lote, enquanto instruções intercaladas contra tabelas diferentes quebrariam o lote.

## Trade-offs

- **Isso reduz a probabilidade de deadlock, não garante execução livre de deadlocks.** Locking que acontece fora das instruções agrupadas de insert/update (locks explícitos de linha, leituras sob um nível de isolamento que adquire locks, deletes) não é afetado.
- **A primeira recomendação continua sendo evitar locking explícito por completo.** O locking tem um custo de performance próprio direto; recorra a `order_inserts`/`order_updates` como uma mitigação de baixo esforço, não como substituto para repensar por que os locks são necessários em primeiro lugar.
- **A ordenação muda o comportamento de flush para toda a persistence unit.** É uma configuração global, não algo que você pode restringir a uma única transação ou entidade, então seus efeitos colaterais de batching se aplicam em todo lugar uma vez ativada.

## Documentation Links

- [Hibernate ORM Configuration Properties — order_inserts / order_updates](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html#configurations-database-orderInserts) — doc
- [Thorben Janssen — JPQL, Criteria API and Native Queries (Coffee with Thorben)](https://thorben-janssen.com/coffee-with-thorben/) — doc
