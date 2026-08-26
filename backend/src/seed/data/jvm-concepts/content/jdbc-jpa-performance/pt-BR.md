---
version: 1.0
updatedAt: 2026-08-13
title: Pooling de Statement no JDBC e o Problema N+1 do JPA
summary: Por que prepared statements só compensam quando são pooled por conexão, e por que o fetch eager de relacionamento do JPA dispara uma query por entidade relacionada em vez de um único JOIN — o clássico problema de query N+1.
---
## Objective

Entender duas das formas mais comuns de acesso a banco de dados custar mais do que deveria silenciosamente a partir de Java: prepared statements que nunca são pooled, e relacionamentos JPA que buscam entidades relacionadas uma query de cada vez em vez de juntas.

## Use Cases

- Explicar por que a primeira chamada a um determinado statement SQL numa conexão nova é mais lenta que a centésima, e por que isso é esperado, não um bug.
- Diagnosticar por que buscar uma entidade no JPA dispara silenciosamente dezenas ou centenas de queries extras.
- Decidir se um relacionamento JPA deve ser lazy, eager, ou buscado explicitamente com um `JOIN` numa query.

## Deep Dive

### Prepared statements só compensam quando são pooled

A vantagem de um `PreparedStatement` sobre um `Statement` simples é que o banco de dados pode reutilizar o que já sabe sobre o plano de execução de um statement — mas essa reutilização só acontece se o *mesmo* objeto de prepared statement for reutilizado, não recriado a cada chamada. O pooling de statement acontece **por conexão**: se duas threads pegam duas conexões diferentes do pool, cada conexão acaba com seu próprio pool separado de prepared statements, mesmo para o SQL idêntico. Isso tem duas consequências diretas: o tamanho do pool de conexões afeta a frequência com que uma query cai num statement "frio", ainda não pooled, numa dada conexão, e cada statement pooled consome espaço de heap na sua conexão — um pool de conexões maior significa mais memória presa em metadados de statement em cache, o que é um custo real contra o tempo de GC, não só um número para maximizar cegamente.

### A escolha lazy/eager do JPA, e por que eager não significa `JOIN`

O JPA lê dados de três formas: `entityManager.find()`, uma query JPQL, ou navegando por um relacionamento a partir de uma entidade já carregada. Fields de relacionamento podem ser marcados `@Basic(fetch = FetchType.LAZY)` (não carregar até o getter ser efetivamente chamado — vale a pena para colunas `@Lob` grandes) ou `FetchType.EAGER` (carregar imediatamente junto com a entidade dona, o que já é o padrão para `@OneToOne`/`@ManyToOne`).

A parte que surpreende as pessoas: **fetch eager não significa que o provider JPA gera um `JOIN`.** Um provider típico emite uma query para a entidade principal, e depois uma query *separada* por entidade relacionada (ou por coleção relacionada) que precisa carregar eagerly:

```java
@OneToMany(mappedBy = "stock", fetch = FetchType.EAGER)
private Collection<StockOptionPriceImpl> optionsPrices;
```

Busque essa ação 100 vezes num loop, e você tem 1 query para cada ação mais 1 query a mais para seus preços de opção — 200 queries onde uma única query baseada em `JOIN` poderia ter feito o trabalho numa única ida ao banco. Este é o clássico **problema de query N+1**: N idas extras ao banco, uma por linha, em vez da única query que um `JOIN` escrito à mão usaria. O `find()` e queries simples do JPQL não te dão controle nenhum sobre isso — a única forma de forçar um `JOIN` de verdade é escrevê-lo explicitamente numa query JPQL/Criteria em vez de confiar só nas annotations de fetch de relacionamento.

## Trade-offs

- **`FetchType.LAZY` é uma dica, não uma garantia** — o provider JPA tem liberdade para carregar os dados eagerly mesmo assim; não assuma que uma annotation lazy é levada a sério sem checar o que o provider realmente faz.
- **Um pool de conexões pequeno demais paga o custo do "statement frio" constantemente; um grande demais desperdiça heap com metadados de statement em cache em conexões que quase não são usadas** — este é um problema genuíno de tuning dos dois lados, não um "maior é sempre mais seguro".
- **O problema N+1 é invisível no código e só aparece no log de queries ou num profiler** — a travessia do grafo de entidades (`stock.getOptionsPrices()`) parece idêntica quer custe uma query ou cem; detectar isso exige efetivamente olhar o SQL gerado (ou uma ferramenta como as estatísticas/`SHOW_SQL` do Hibernate), não só revisão de código:

  ```java
  for (Stock s : stocks) {           // 1 query para carregar `stocks`
      s.getOptionsPrices().size();    // +1 query POR ação se buscado eagerly-mas-separadamente
  }
  ```

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 11 "Database Performance Best Practices", pp. 329-361 — book
- [Jakarta Persistence Specification](https://jakarta.ee/specifications/persistence/) — doc
- [PreparedStatement — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.sql/java/sql/PreparedStatement.html) — doc
