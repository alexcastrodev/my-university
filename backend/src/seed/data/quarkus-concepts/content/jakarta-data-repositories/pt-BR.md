---
version: 1.0
updatedAt: 2026-08-22
title: "Repositórios Jakarta Data"
summary: "Como o Jakarta Data permite declarar interfaces de repositório como CrudRepository e obter implementações geradas em tempo de build, queries customizadas via @Query/@Find, e segurança no nível de método."
---
## Objective

O Jakarta Data é uma abstração de repositório padrão e independente de vendor: em vez de escrever boilerplate de DAO ou métodos de query feitos à mão, você declara uma interface estendendo um contrato de repositório embutido, como `CrudRepository`, e o provedor de persistência (Hibernate ORM, no Quarkus) gera a implementação em tempo de build. Métodos de query podem ser derivados de seu nome, ou escritos explicitamente com `@Query`/`@Find`, e o Quarkus conecta tudo ao CDI e, opcionalmente, à segurança.

## Use Cases

- Substituir boilerplate repetido de `EntityManager` (buscar por id, salvar, deletar, listar tudo) por uma única declaração de interface.
- Expor métodos finder customizados sem escrever JPQL à mão, quando a query é simples o suficiente para ser derivada da assinatura do método.
- Proteger acesso a dados no nível de método ou de repositório usando as mesmas anotações usadas em outras partes de uma aplicação Quarkus (`@RolesAllowed`, `@Authenticated`).
- Direcionar uma unidade de persistência específica em uma aplicação com múltiplas unidades de persistência, de dentro de uma interface de repositório.

## Deep Dive

### Declarando um repositório

Um repositório Jakarta Data é só uma interface estendendo um dos contratos padrão embutidos, mais comumente `CrudRepository<EntityType, IdType>`:

```java
public interface MyEntityRepository extends CrudRepository<MyEntity, Integer> {
}
```

A implementação Jakarta Data do Hibernate ORM gera a classe subjacente em tempo de build, e o Quarkus a torna injetável como qualquer outro bean CDI; nenhum `@ApplicationScoped` ou conexão manual necessária na própria interface.

### Métodos de query customizados

Além das operações CRUD herdadas, uma interface de repositório pode declarar métodos adicionais apoiados em uma query explícita:

```java
public interface MyEntityRepository extends CrudRepository<MyEntity, Integer> {

    @Query("select e from MyEntity e where e.name = :name")
    List<MyEntity> findByCustomCriteria(String name);

    @Find
    MyEntity findByName(String name);

    @Delete
    void removeExpired();
}
```

`@Query` recebe uma string de query explícita, no estilo JPQL, quando a operação é mais do que uma busca simples. `@Find` e `@Delete` marcam métodos que o provedor do Hibernate ORM mapeia para operações de busca/exclusão com base em nomes de parâmetro e convenções de método, sem exigir que uma string de query seja escrita por extenso.

### Direcionando uma unidade de persistência que não é a padrão

Em uma aplicação com múltiplas unidades de persistência, um repositório é fixado em uma delas via `@Repository`:

```java
@Repository(dataStore = "other")
public interface OtherEntityRepository extends CrudRepository<OtherEntity, Long> {
}
```

`dataStore` casa com o nome configurado da unidade de persistência; sem ele, um repositório é assumido como pertencente à unidade de persistência padrão.

### Protegendo métodos de repositório

Como as implementações de repositório geradas são beans CDI comuns, anotações de segurança padrão do Quarkus se aplicam diretamente a elas, tanto no nível de método quanto de classe:

```java
public interface AdminRepository extends CrudRepository<Account, Long> {

    @RolesAllowed("admin")
    void deleteAll();
}
```

Um `@Authenticated` no nível de classe restringe todo método do repositório a chamadores autenticados. Uma ressalva mencionada no guia: métodos genéricos com variáveis de tipo em sua assinatura não podem ser protegidos de forma confiável dessa maneira, já que o interceptor de segurança precisa de uma assinatura de método concreta para checar.

## Trade-offs

- **Padrão, mas jovem**: o Jakarta Data é uma especificação mais nova do Jakarta EE; ela compra portabilidade entre provedores compatíveis em princípio, mas o ecossistema de exemplos e ferramentas é mais fino do que para JPQL escrito à mão ou Panache.
- **Queries derivadas/baseadas em anotação têm um teto**: `@Find` e métodos derivados por nome lidam bem com buscas diretas, mas qualquer coisa com complexidade real de query (joins, agregações, predicados dinâmicos) se expressa melhor com um `@Query` explícito, ou recorre inteiramente a `CriteriaBuilder`/JPQL.
- **Métodos genéricos não podem ser protegidos**: um método de repositório cuja assinatura inclui uma variável de tipo não pode ter `@RolesAllowed` aplicado de forma confiável, o que restringe como interfaces base genéricas podem ser compartilhadas entre repositórios protegidos.
- **A conexão com múltiplas unidades de persistência é implícita, a menos que declarada**: esquecer `@Repository(dataStore = "...")` liga silenciosamente um repositório à unidade de persistência padrão, em vez de falhar ruidosamente, o que pode ser um bug confuso em configurações com múltiplas unidades.
  ```java
  @Repository(dataStore = "other")
  ```

## Documentation Links

- [Guia Hibernate ORM: repositórios Jakarta Data](https://quarkus.io/guides/hibernate-orm) (guia fonte cobrindo `CrudRepository`, `@Query`/`@Find`/`@Delete`, `@Repository(dataStore=...)`, e segurança no nível de método em repositórios)
