---
version: 1.0
updatedAt: 2026-08-22
title: "Múltiplas Unidades de Persistência no Quarkus"
summary: "Como declarar unidades de persistência nomeadas apoiadas em datasources separados, direcionar classes de modelo a elas, e injetar ou estender cada unidade de forma independente via CDI."
---
## Objective

A maioria das aplicações se vira com uma única unidade de persistência implícita, apoiada no datasource padrão. Mas quando uma aplicação precisa falar com mais de um banco de dados, um armazenamento de `users` e um armazenamento separado de `inventory`, por exemplo, o Quarkus permite declarar unidades de persistência *nomeadas* adicionais, cada uma ligada ao seu próprio datasource, seu próprio conjunto de pacotes de entidade, e sua própria configuração de schema/cache/tenancy. Este conceito cobre como declarar unidades de persistência nomeadas e datasources juntos, como anexar classes de modelo à unidade certa, e como injetar e estender cada unidade a partir do CDI.

## Use Cases

- Uma aplicação que precisa ler/escrever em dois bancos de dados logicamente separados (por exemplo, um sistema legado e um schema novo, de propriedade de um microsserviço) a partir do mesmo deployável.
- Dividir entidades por contexto delimitado para que cada unidade de persistência só veja os pacotes relevantes a ela, mantendo a geração de schema e o cache com o escopo correto.
- Registrar customizações por unidade (interceptors, statement inspectors, tenant resolvers) sem que vazem para toda outra unidade na aplicação.
- Ativar/desativar seletivamente uma unidade de persistência (e seu datasource subjacente) por ambiente.

## Deep Dive

### Declarando datasources e unidades de persistência nomeados juntos

Toda unidade de persistência nomeada precisa de um datasource nomeado para se apoiar, mais um escopo de `packages` para que o Hibernate saiba quais entidades pertencem a ela:

```properties
# Datasource definitions
quarkus.datasource."users".db-kind=h2
quarkus.datasource."users".jdbc.url=jdbc:h2:mem:users;DB_CLOSE_DELAY=-1

quarkus.datasource."inventory".db-kind=h2
quarkus.datasource."inventory".jdbc.url=jdbc:h2:mem:inventory;DB_CLOSE_DELAY=-1

# Persistence unit configuration
quarkus.hibernate-orm."users".datasource=users
quarkus.hibernate-orm."users".packages=org.acme.model.user

quarkus.hibernate-orm."inventory".datasource=inventory
quarkus.hibernate-orm."inventory".packages=org.acme.model.inventory
```

A unidade de persistência padrão (sem nome) ainda pode coexistir e recebe seu próprio escopo de pacote:

```properties
quarkus.hibernate-orm.packages=org.acme.model.defaultpu
quarkus.hibernate-orm."users".packages=org.acme.model.shared,org.acme.model.user
```

Aqui, classes de modelo sob `org.acme.model.shared` e `org.acme.model.user` acabam ligadas à unidade `users`.

### Anexando entidades com `@PersistenceUnit` no nível de pacote

Em vez de (ou além de) a propriedade `packages`, você pode anotar um `package-info.java` para declarar a qual unidade suas classes pertencem:

```java
@PersistenceUnit("users")
package org.acme.model.user;

import io.quarkus.hibernate.orm.PersistenceUnit;
```

Isto precisa ser `io.quarkus.hibernate.orm.PersistenceUnit`, não a anotação de nome semelhante da Jakarta Persistence, já que é um mecanismo específico do Quarkus para direcionar entidades a uma unidade nomeada.

### Injetando os recursos de uma unidade nomeada via CDI

Uma vez que uma unidade é declarada, qualifique qualquer ponto de injeção com `@PersistenceUnit("name")` para obter os componentes com escopo dessa unidade específica:

```java
@Inject
@PersistenceUnit("users")
EntityManager entityManager;

@Inject
@PersistenceUnit("users")
EntityManagerFactory entityManagerFactory;
```

O mesmo qualificador funciona para outros componentes injetáveis por unidade: `CriteriaBuilder`, `HibernateCriteriaBuilder`, `Metamodel`, `jakarta.persistence.Cache`, `org.hibernate.Cache`, `jakarta.persistence.PersistenceUnitUtil`, e as versões Jakarta e Hibernate de `SchemaManager`.

### Registrando extensões por unidade com `@PersistenceUnitExtension`

Implementações customizadas de SPI do Hibernate (interceptors, statement inspectors, tenant resolvers, e mais) podem ter escopo restrito a uma única unidade anotando a classe do bean:

```java
@PersistenceUnitExtension("users")
public class CustomComponent implements TenantResolver {
    // Implementation
}
```

Tipos de componente suportados incluem `org.hibernate.Interceptor`, `org.hibernate.resource.jdbc.spi.StatementInspector`, `org.hibernate.type.format.FormatMapper`, `io.quarkus.hibernate.orm.runtime.tenant.TenantResolver`, `io.quarkus.hibernate.orm.runtime.tenant.TenantConnectionResolver`, `org.hibernate.boot.model.FunctionContributor`, e `org.hibernate.boot.model.TypeContributor`.

### Desativando uma unidade de persistência

Uma unidade nomeada (e seu datasource) pode ser totalmente desligada, tipicamente por perfil:

```properties
quarkus.hibernate-orm."pg".active=false
quarkus.datasource."pg".active=false
```

Quando desativada, o SessionFactory dessa unidade nunca inicia, e qualquer ponto de injeção CDI qualificado para ela falha; então a desativação deveria vir acompanhada da remoção ou desabilitação condicional dos caminhos de código que dependem dela.

## Trade-offs

- **Múltiplas unidades significam múltiplas coisas para manter consistentes por ambiente**: cada unidade nomeada tem suas próprias configurações de gerenciamento de schema, cache e datasource, então configuração específica de ambiente (`%dev`/`%prod`) precisa ser duplicada por unidade, em vez de definida uma única vez.
- **O escopo de pacote é fácil de errar sutilmente**: uma entidade que não é coberta por nenhum `packages` de unidade (ou anotação de pacote `@PersistenceUnit`) simplesmente não é reconhecida por essa unidade, silenciosamente.
- **`@PersistenceUnitExtension` acopla um componente a uma unidade**: conveniente para isolamento, mas se o mesmo comportamento (por exemplo, um `StatementInspector`) é necessário em várias unidades, ele precisa ser registrado separadamente para cada uma.
- **Desativar uma unidade é um interruptor tudo-ou-nada**: qualquer bean exigindo `@PersistenceUnit("name")` para uma unidade desativada falha no momento da injeção, então a desativação precisa ser coordenada com o resto da configuração do deploy, não simplesmente ligada isoladamente.
  ```properties
  quarkus.hibernate-orm."pg".active=false
  ```

## Documentation Links

- [Guia Hibernate ORM: Quarkus](https://quarkus.io/guides/hibernate-orm) (guia fonte cobrindo unidades de persistência nomeadas, propriedades `quarkus.hibernate-orm."name".*`, `@PersistenceUnit`, e `@PersistenceUnitExtension`)
