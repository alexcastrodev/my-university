---
version: 1.0
updatedAt: 2026-08-22
title: "Estratégias de Multitenancy: Schema, Banco de Dados e Discriminador"
summary: "O Quarkus oferece três estratégias de multitenancy (SCHEMA, DATABASE, DISCRIMINATOR) selecionadas via quarkus.hibernate-orm.multitenant, cada uma trocando força de isolamento por simplicidade operacional."
---
## Objective

Multitenancy na extensão Hibernate ORM do Quarkus permite que uma única aplicação sirva múltiplos tenants (clientes, organizações ou ambientes separados) mantendo seus dados isolados na camada de persistência. O Quarkus suporta três estratégias, selecionadas com `quarkus.hibernate-orm.multitenant`: `SCHEMA` (um datasource, um schema por tenant), `DATABASE` (um datasource por tenant), e `DISCRIMINATOR` (um datasource, uma tabela, uma coluna que marca o tenant de cada linha). Qual usar é principalmente uma troca entre força de isolamento e simplicidade operacional.

## Use Cases

- Produtos SaaS onde os dados de cada cliente nunca podem vazar para as queries de outro cliente.
- Requisitos regulatórios que exigem separação física de dados por tenant (favorece `DATABASE`).
- Deploys multi-ambiente ou multi-região compartilhando uma base de código de aplicação, mas precisando de versões de schema por tenant (favorece `SCHEMA`).
- Tenancy de baixo overhead para um grande número de tenants pequenos, onde provisionar um schema ou banco de dados por tenant não escalaria operacionalmente (favorece `DISCRIMINATOR`).

## Deep Dive

### Selecionando uma estratégia e resolvendo o tenant

A estratégia é uma única propriedade de nível superior:

```properties
quarkus.hibernate-orm.multitenant=SCHEMA
```

Os valores são `SCHEMA`, `DATABASE`, ou `DISCRIMINATOR`. Qualquer que seja a estratégia escolhida, o Hibernate ainda precisa saber *qual* tenant está ativo para a requisição atual. Esse é o trabalho de um `TenantResolver`, implementado contra `io.quarkus.hibernate.orm.runtime.tenant.TenantResolver` e registrado como um bean com escopo de requisição (a resolução de tenant depende da requisição de entrada, por exemplo, um header, subdomínio, ou claim de JWT):

```java
@PersistenceUnitExtension
@RequestScoped
public class CustomTenantResolver implements TenantResolver {

    @Override
    public String getDefaultTenantId() {
        return "base";
    }

    @Override
    public String resolveTenantId() {
        // e.g. inspect the current request to determine the tenant
        return currentTenant();
    }
}
```

### Abordagem SCHEMA

```properties
quarkus.hibernate-orm.multitenant=SCHEMA
```

Um único datasource é compartilhado por todos os tenants, mas cada tenant recebe seu próprio schema de banco de dados dentro dele; o Hibernate troca o schema ativo por requisição, com base no id de tenant resolvido. Como a própria geração de schema do Hibernate não é ciente de multitenancy, a criação de schema é delegada ao Flyway, migrando cada schema de tenant de forma independente:

```properties
quarkus.hibernate-orm.schema-management.strategy=none
quarkus.flyway.schemas=base,mycompany
quarkus.flyway.locations=classpath:schema
quarkus.flyway.migrate-at-start=true
```

### Abordagem DATABASE

```properties
quarkus.hibernate-orm.multitenant=DATABASE
```

Aqui os tenants são datasources totalmente separados, em vez de schemas dentro de um datasource. Para cada tenant você cria um datasource nomeado cujo identificador corresponde exatamente ao que o `TenantResolver` retorna para esse tenant, e o Hibernate roteia para o datasource correspondente em tempo de execução. Isso dá o isolamento mais forte das três estratégias (conexões separadas, pools de conexão separados, potencialmente bancos de dados físicos separados) ao custo de um conjunto fixo e estaticamente configurado de tenants, conhecido em tempo de build/deploy.

### Abordagem DISCRIMINATOR

```properties
quarkus.hibernate-orm.multitenant=DISCRIMINATOR
```

Todos os tenants compartilham um datasource e um schema físico; o isolamento é imposto no nível de linha via uma coluna discriminadora. Entidades declaram qual campo carrega a identidade do tenant com `@TenantId`:

```java
@Entity
public class Order {

    @Id
    @GeneratedValue
    private Long id;

    @TenantId
    private String tenantId;

    // ...
}
```

O campo `@TenantId` é "populado automaticamente, e será filtrado automaticamente em queries"; o código da aplicação nunca precisa adicionar uma cláusula `WHERE tenant_id = ...` manualmente; o Hibernate a injeta de forma transparente. Esta é a estratégia mais barata de operar (nenhum provisionamento de schema ou datasource por tenant), mas o isolamento mais fraco, já que um bug que contorna a filtragem do Hibernate poderia cruzar fronteiras de tenant no nível de SQL.

## Trade-offs

- **Isolamento vs. custo operacional**: `DATABASE` dá o isolamento de tenant mais forte, mas exige provisionar e configurar um datasource real por tenant com antecedência; `DISCRIMINATOR` é quase de graça para provisionar, mas depende inteiramente de a filtragem automática do Hibernate estar correta e nunca ser contornada por SQL bruto.
- **Conjunto fixo de tenants para SCHEMA/DATABASE**: ambos exigem que o schema ou datasource do tenant exista e esteja configurado antes de poder ser usado, então integrar um tenant novo é um passo de deploy/migração, não algo resolvido puramente em tempo de requisição.
- **A geração de schema do Hibernate é desabilitada sob SCHEMA**: `quarkus.hibernate-orm.schema-management.strategy=none` é obrigatório, empurrando todo o ciclo de vida de schema para o Flyway, um conjunto de migração de schema por tenant.
- **DISCRIMINATOR acopla toda query à filtragem correta**: uma query nativa, um update em lote, ou qualquer caminho de código que pule o filtro no nível de sessão do Hibernate arrisca vazar ou corromper linhas de outro tenant.
- **A resolução de tenant é uma preocupação separada, com escopo de requisição, em relação à própria estratégia**: escolher SCHEMA/DATABASE/DISCRIMINATOR só decide *como* o isolamento é imposto; você ainda precisa implementar `TenantResolver` (ou, para conexões dinâmicas por tenant, `TenantConnectionResolver`) para decidir *qual* tenant se aplica à requisição atual.

## Documentation Links

- [Usando Hibernate ORM e Jakarta Persistence: seção de Multitenancy](https://quarkus.io/guides/hibernate-orm) (guia do Quarkus cobrindo `quarkus.hibernate-orm.multitenant`, as abordagens SCHEMA/DATABASE/DISCRIMINATOR, e `TenantResolver`)
