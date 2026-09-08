---
version: 1.0
updatedAt: 2026-08-22
title: "Resolução Programática de Tenant com TenantConnectionResolver"
summary: "TenantConnectionResolver permite que uma aplicação construa provedores de conexão JDBC por id de tenant em tempo de execução, em vez de depender de schemas ou datasources configurados estaticamente."
---
## Objective

`TenantConnectionResolver` é a válvula de escape para cenários de multitenancy que as estratégias estáticas `SCHEMA`/`DATABASE`/`DISCRIMINATOR` não conseguem cobrir: em vez de rotear para um conjunto fixo e pré-configurado de schemas ou datasources, você fornece ao Hibernate um provedor de conexão JDBC calculado programaticamente, por id de tenant, em tempo de execução, por exemplo, buscando os detalhes de conexão do tenant em um banco de dados ou um registro de serviço, em vez de em `application.properties`.

## Use Cases

- Detalhes de conexão de tenant (host, credenciais, nome do banco de dados) armazenados em um banco de dados de control plane, que podem mudar sem um redeploy.
- Um conjunto de tenants em crescimento dinâmico, onde novos tenants são integrados em tempo de execução e não podem ser enumerados como datasources nomeados estáticos com antecedência.
- Lógica de pooling ou roteamento de conexão por tenant que vai além do que uma configuração fixa de multitenancy `DATABASE` consegue expressar (por exemplo, resolver um shard físico a partir de um id de tenant via um serviço de lookup).

## Deep Dive

### Implementando o resolver

A interface vive em `io.quarkus.hibernate.orm.runtime.tenant.TenantConnectionResolver`. Seu único método, `resolve(String tenantId)`, retorna um `ConnectionProvider` para aquele tenant; isso "permite exemplos que leem informação de tenant a partir de um banco de dados e criam uma conexão por tenant em tempo de execução":

```java
@ApplicationScoped
@PersistenceUnitExtension
public class ExampleTenantConnectionResolver
        implements TenantConnectionResolver {

    @Override
    public ConnectionProvider resolve(String tenantId) {
        return new YourOwnCustomConnectionProviderImpl(
                createDatasource(tenantId));
    }
}
```

Diferente do `TenantResolver`, que tem escopo de requisição (e só responde "para qual tenant é esta requisição?"), o `TenantConnectionResolver` responde "dado um id de tenant, como eu de fato me conecto aos seus dados?"; ele mesmo é dono da construção do provedor de conexão, então é o lugar certo para colocar lógica como buscar detalhes de conexão em um registro, construir preguiçosamente um pool de conexão por tenant, ou fazer cache de datasources provisionados.

### Registrando-o como um bean

O bean é application-scoped (uma instância de resolver para a aplicação inteira, já que são os provedores de conexão que variam por tenant, não o resolver em si) e anotado `@PersistenceUnitExtension` para que o Quarkus o conecte ao maquinário de resolução de tenant da extensão Hibernate ORM, para a unidade de persistência alvo; o mesmo padrão de qualificador usado para beans customizados de `TenantResolver`, `Interceptor` e `StatementInspector`.

### Relação com as estratégias embutidas

`TenantConnectionResolver` costuma ser combinado com tenancy no estilo `quarkus.hibernate-orm.multitenant=DATABASE`, mas onde `DATABASE` sozinho espera que o datasource de cada tenant seja nomeado e estaticamente configurado com antecedência, conectar um `TenantConnectionResolver` substitui essa configuração estática por código: o resolver decide, no momento da chamada, como obter (ou construir) o `ConnectionProvider` para um id de tenant que ele nunca viu configurado em `application.properties`.

## Trade-offs

- **Você é dono da correção do ciclo de vida da conexão**: com multitenancy `DATABASE` estática, o Quarkus gerencia a criação e o pooling de datasource; com `TenantConnectionResolver`, você é responsável por construir (e idealmente fazer cache/reutilizar) instâncias de `ConnectionProvider` você mesmo, incluindo dimensionamento de pool e limpeza.
- **Mais flexível, menos validado em tempo de build**: um datasource estático mal configurado falha rapidamente na inicialização; um bug em um resolver programático pode só surgir quando um id de tenant específico é solicitado pela primeira vez em tempo de execução.
- **Ainda precisa de um id de tenant vindo de algum lugar**: `TenantConnectionResolver` resolve uma *conexão* para um dado id de tenant, mas outra coisa (tipicamente um `TenantResolver` com escopo de requisição) ainda precisa determinar *qual* id de tenant se aplica à requisição atual.
- **Cache é uma decisão de design deliberada**: resolver/construir um novo provedor de conexão a cada chamada é desperdício se os detalhes de conexão do tenant são estáveis; a maioria das implementações reais faz cache de provedores indexados por id de tenant, o que então introduz sua própria questão de invalidação quando os detalhes de conexão de um tenant mudam.

## Documentation Links

- [Usando Hibernate ORM e Jakarta Persistence: Resolvendo Conexões de Tenant Programaticamente](https://quarkus.io/guides/hibernate-orm) (guia do Quarkus cobrindo `TenantConnectionResolver` e seu método `resolve(String tenantId)`)
