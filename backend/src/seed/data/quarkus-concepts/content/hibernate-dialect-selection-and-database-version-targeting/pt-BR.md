---
version: 1.0
updatedAt: 2026-08-22
title: "Seleção de Dialeto do Hibernate e Direcionamento de Versão de Banco de Dados"
summary: "Como o Quarkus autodetecta o dialeto do Hibernate a partir do seu datasource, e como fixar uma versão exata de banco de dados ou sobrescrever o dialeto explicitamente."
---
## Objective

O Hibernate ORM precisa saber com qual dialeto SQL e com qual versão específica de banco de dados está falando, antes de conseguir gerar SQL ótimo e ciente de funcionalidades. O Quarkus remove quase toda essa cerimônia: para bancos de dados suportados, ele autodetecta o dialeto diretamente da configuração do seu datasource, e permite fixar a versão exata do banco de dados para que o Hibernate use sintaxe e funções mais novas, em vez de recorrer ao mínimo denominador comum conservador. Este conceito cobre como essa autodetecção funciona, quando e como sobrescrevê-la, e como o Quarkus protege você contra um descompasso entre a versão declarada e a versão à qual você de fato se conecta.

## Use Cases

- Rodar contra um banco de dados popular e bem suportado (PostgreSQL, MySQL, etc.) e querer seleção de dialeto com configuração zero.
- Fixar `db-version` para que o Hibernate emita SQL que aproveita funcionalidades de um lançamento específico do banco de dados (por exemplo, funções de janela mais novas, sintaxe de upsert) em vez do padrão conservador.
- Conectar a um banco de dados para o qual o Hibernate não vem com um dialeto embutido, ou que precise de uma classe de dialeto customizada/de terceiros.
- Proteger um deploy de produção contra rodar silenciosamente com a versão de banco de dados assumida errada depois de uma mudança de infraestrutura.

## Deep Dive

### Autodetecção a partir do datasource

Para bancos de dados suportados, o Quarkus infere o dialeto puramente a partir de `quarkus.datasource.db-kind`; não há nada específico de dialeto a configurar:

```properties
quarkus.datasource.db-kind = postgresql
```

Por padrão, o dialeto que o Hibernate escolhe mira a versão *mínima* suportada daquele tipo de banco de dados, o que é a escolha mais segura, mas não necessariamente a mais eficiente.

### Direcionando uma versão específica de banco de dados

Para obter geração de SQL mais eficiente e ciente da versão, diga ao Quarkus qual versão você de fato roda:

```properties
quarkus.datasource.db-kind = postgresql
quarkus.datasource.db-version = 18.1
```

Como regra, defina isso o mais alto possível, mas precisa permanecer menor ou igual à versão de toda instância de banco de dados à qual a aplicação de fato vai se conectar; a versão que você declara é um *piso* que o Hibernate tem permissão para assumir, não apenas documentação.

### Sobrescrita explícita de dialeto

Quando você está em um banco de dados que o Quarkus não autodetecta, ou precisa de um dialeto customizado, defina-o diretamente:

```properties
quarkus.hibernate-orm.dialect=Cockroach
```

Para dialetos embutidos, o valor é o nome da lista oficial de dialetos do Hibernate *sem* o sufixo `Dialect`; `Cockroach` mapeia para `CockroachDialect`. Para um dialeto de terceiros ou customizado, use o nome de classe totalmente qualificado em vez disso:

```properties
quarkus.hibernate-orm.dialect=com.acme.hibernate.AcmeDbDialect
```

### Checagem de versão na inicialização

O Quarkus não simplesmente confia na versão que você configurou; por padrão, ele valida a versão *real* do banco de dados conectado contra ela na inicialização, e falha rapidamente se o banco de dados real for mais antigo do que o declarado. Isso captura a classe de bug em que SQL gerado para uma versão mais nova quebra silenciosamente em tempo de execução em uma instância mais antiga:

```properties
quarkus.hibernate-orm.database.version-check.enabled=false
```

Desligar isso remove a rede de segurança; só faça isso se tiver outra forma de garantir que o contrato de versão se sustenta.

## Trade-offs

- **Declarar um `db-version` mais alto libera SQL melhor, mas eleva o piso**: se mais tarde você precisar suportar uma instância de banco de dados mais antiga do que a versão configurada, o Hibernate pode emitir SQL que essa instância não consegue rodar.
  ```properties
  quarkus.datasource.db-version = 18.1
  ```
- **Desabilitar a checagem de versão troca segurança por flexibilidade**: útil para casos de borda como conectar a forks/variantes gerenciadas ligeiramente divergentes de um banco de dados, mas remove uma proteção automática contra deriva de versão.
- **A autodetecção é conveniente, mas opaca**: depender dela significa que o dialeto efetivo não é visível em lugar nenhum da sua configuração; um `dialect` explícito é mais verboso, mas autodocumentado e necessário para qualquer coisa fora da lista suportada.
- **Dialetos de terceiros são uma válvula de escape, não um caminho de primeira classe**: eles funcionam, mas você passa a ser responsável por manter essa classe de dialeto compatível ao longo dos upgrades de Hibernate ORM que o próprio Quarkus distribui.

## Documentation Links

- [Guia Hibernate ORM: Quarkus](https://quarkus.io/guides/hibernate-orm) (guia fonte cobrindo autodetecção de dialeto, `db-version`, `quarkus.hibernate-orm.dialect` explícito, e `database.version-check.enabled`)
