---
version: 1.0
updatedAt: 2026-08-22
title: "Interceptors e StatementInspector: Conectando-se ao Ciclo de Vida do Hibernate"
summary: "Beans CDI Interceptor e StatementInspector, registrados com @PersistenceUnitExtension, permitem observar ou reescrever eventos de ciclo de vida de entidade e statements SQL sem tocar entidades ou queries."
---
## Objective

O Hibernate expõe dois pontos de extensão de baixo nível para se conectar ao que ele está fazendo por baixo dos panos: `org.hibernate.Interceptor`, chamado em eventos de ciclo de vida de entidade (load, save, flush, e mais), e `org.hibernate.engine.jdbc.spi.StatementInspector`, chamado a cada statement SQL que o Hibernate está prestes a executar. No Quarkus, os dois são conectados da mesma forma: como um bean CDI anotado `@PersistenceUnitExtension`, permitindo observar ou reescrever o comportamento do Hibernate sem tocar as entidades nem as queries em si.

## Use Cases

- Log de auditoria transversal que precisa de ganchos no nível de entidade em vez de log no nível de SQL (`Interceptor`).
- Carimbar campos automaticamente (por exemplo, uma coluna de "última modificação por") no load/save de entidade, sem repetir lógica em cada entidade (`Interceptor`).
- Registrar, redigir ou reescrever o SQL exato que o Hibernate envia ao banco de dados para depuração ou compliance (`StatementInspector`).
- Injetar um comentário ou hint no SQL gerado (por exemplo, para rastrear qual caminho de código emitiu uma query) sem modificar toda query da base de código (`StatementInspector`).

## Deep Dive

### Implementando um Interceptor

Implemente `org.hibernate.Interceptor` e sobrescreva o(s) callback(s) de ciclo de vida de que precisa; aqui, `onLoad`, que dispara quando uma entidade é carregada:

```java
@PersistenceUnitExtension
public static class MyInterceptor implements Interceptor {

    @Override
    public boolean onLoad(Object entity, Object id,
            Object[] state, String[] propertyNames, Type[] types) {
        // implementation
        return false;
    }
}
```

O registro é puramente por descoberta de bean CDI mais o qualificador `@PersistenceUnitExtension`; não existe uma propriedade `quarkus.hibernate-orm.interceptor` separada para definir; declarar o bean já é suficiente para o Quarkus conectá-lo à unidade de persistência alvo.

### Escopo do bean Interceptor: aplicação vs. por entity manager

Beans são application-scoped por padrão, o que significa que uma única instância de `Interceptor` é compartilhada por toda a aplicação, o que significa que ela precisa ser thread-safe se guardar qualquer estado. Se você precisa de uma instância de interceptor por entity manager em vez disso (por exemplo, para acumular com segurança estado por sessão), declare o bean como `@Dependent` para que o Quarkus crie uma instância nova por entity manager, em vez de compartilhar uma:

```java
@Dependent
@PersistenceUnitExtension
public class PerSessionInterceptor implements Interceptor {
    // safe to hold per-session mutable state here
}
```

### Implementando um StatementInspector

`StatementInspector` recebe uma olhada em toda string SQL bem antes de o Hibernate executá-la, e pode retornar uma string modificada para mudar o que de fato roda:

```java
@PersistenceUnitExtension
public class MyStatementInspector implements StatementInspector {

    @Override
    public String inspect(String sql) {
        return sql;
    }
}
```

Como `inspect` retorna o SQL que de fato é executado, este é o ponto de gancho tanto para inspeção passiva (registrar todo statement) quanto para reescrita ativa (anexar um comentário, ajustar um hint); o que quer que o método retorne substitui o que o Hibernate envia ao driver JDBC.

### Padrão de registro compartilhado entre os dois

`Interceptor` e `StatementInspector` são conectados da mesma forma: declare a classe como um bean CDI e anote-a com `@PersistenceUnitExtension` (opcionalmente com escopo para uma unidade de persistência nomeada em configurações com múltiplas unidades). Este é o mesmo padrão de qualificador usado em outros pontos da extensão Hibernate ORM para componentes plugáveis, como `TenantResolver` e `TenantConnectionResolver`; o Quarkus descobre o bean e o entrega à configuração Hibernate da unidade de persistência correspondente automaticamente, sem exigir nenhuma propriedade `quarkus.hibernate-orm.*` correspondente.

## Trade-offs

- **Application-scoped por padrão significa que estado compartilhado é perigoso**: um bean `Interceptor` sem `@Dependent` é uma única instância atendendo a todo entity manager concorrentemente, então qualquer campo mutável precisa ser tratado com o mesmo cuidado de um serviço singleton.
- **`StatementInspector` opera sobre strings SQL brutas**: reescrever SQL por manipulação de string é frágil comparado a modificar a query no nível JPQL/Criteria; uma mudança na forma do SQL gerado pelo Hibernate entre versões pode quebrar silenciosamente uma regra de inspeção/reescrita escrita à mão.
- **Os dois ganchos rodam no caminho quente de toda operação de persistência**: um callback de `Interceptor` ou uma chamada `StatementInspector.inspect()` adiciona overhead a todo load/save ou todo statement SQL respectivamente, então lógica cara ali (chamadas de rede, log pesado) tem um custo de desempenho desproporcional.
- **Sem propriedade de configuração `quarkus.*` dedicada**: o registro é inteiramente por descoberta de bean e o qualificador `@PersistenceUnitExtension`, o que significa que não há forma só de configuração para ligar/desligar esses ganchos por ambiente; habilitar/desabilitar significa mudar código (por exemplo, produzindo o bean condicionalmente).

## Documentation Links

- [Usando Hibernate ORM e Jakarta Persistence: Interceptors e Statement Inspectors](https://quarkus.io/guides/hibernate-orm) (guia do Quarkus cobrindo os pontos de extensão `Interceptor` e `StatementInspector` e o padrão de registro `@PersistenceUnitExtension`)
