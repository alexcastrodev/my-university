---
version: 1.0
updatedAt: 2026-08-22
title: "Integração do Flyway com o Hibernate ORM"
summary: "O Flyway assume o versionamento de schema do Hibernate semeando sua primeira migração a partir do DDL gerado pelo Hibernate, e então passa a ser dono de toda migração daí em diante."
---
## Objective

O Flyway é a resposta do Quarkus para uma pergunta que a própria geração de schema do Hibernate não consegue responder com segurança sozinha: como obter um histórico de migração versionado e repetível a partir de um modelo de entidade que fica mudando? Em vez de escrever migrações SQL à mão do zero, o Quarkus deixa o Hibernate ORM gerar o SQL de schema em modo de desenvolvimento e entrega esse SQL ao Flyway como semente para um arquivo de migração de verdade, e então sai do caminho para que o Flyway seja o dono da evolução de schema em todo outro ambiente.

## Use Cases

- Inicializar a primeira migração (`V1.0.0__...sql`) de um projeto novo diretamente a partir das suas entidades JPA, em vez de transcrever DDL à mão.
- Gerar rascunhos de migração incremental depois de adicionar uma coluna, tabela ou índice a uma entidade, sem comparar o banco de dados manualmente.
- Rodar o Hibernate ORM com `database.generation=none` em produção enquanto o Flyway aplica migrações versionadas na inicialização, a configuração padrão de "Hibernate nunca toca o schema de produção".
- Manter o gerenciamento de schema sensato sob multitenancy, onde a própria geração de DDL do Hibernate não é suportada e o Flyway precisa ser quem inicializa os schemas/bancos de dados de tenant.

## Deep Dive

### Gerando a migração inicial a partir do DDL do Hibernate

Com a extensão `quarkus-flyway` no classpath, a Dev UI expõe uma ação "Create Initial Migration". Ela pega o DDL que o Hibernate ORM geraria a partir do seu modelo de entidade atual e o grava como um arquivo de migração de verdade:

```
src/main/resources/db/migration/V1.0.0__MyApp.sql
```

Essa única ação também configura as propriedades necessárias para fazer o Flyway de fato aplicá-lo automaticamente:

```properties
quarkus.flyway.baseline-on-migrate=true
quarkus.flyway.migrate-at-start=true

%dev.quarkus.flyway.clean-at-start=true
%test.quarkus.flyway.clean-at-start=true
```

`baseline-on-migrate` diz ao Flyway para tratar um banco de dados existente e não vazio como já estando em uma versão de baseline, em vez de falhar por ainda não existir uma tabela de histórico de migração. `migrate-at-start` roda migrações pendentes automaticamente quando a aplicação inicializa, o que é o que torna isso útil para os loops de dev/teste. As flags `clean-at-start` têm escopo por perfil (`%dev`, `%test`), então um estado limpo a cada reinício nunca vaza para a configuração de produção.

### Gerando migrações incrementais conforme as entidades evoluem

Uma vez que a primeira migração existe, a ação "Generate Migration File" da Dev UI produz um novo rascunho de migração sempre que o modelo de entidade tiver se distanciado do que a última migração criou. A nomenclatura segue uma convenção simples de versionamento: a versão major vem da última migração existente, e a porção minor/patch é derivada do timestamp atual, então rascunhos sucessivos se ordenam corretamente e nunca colidem:

```
V1.1.1692650000__MyApp.sql
```

Isso é um auxílio de fluxo de trabalho, não um mecanismo mágico de diffing; o SQL gerado ainda precisa ser revisado antes de ser commitado, da mesma forma que você revisaria qualquer migração escrita à mão.

### Deixando o Flyway ser dono do schema em vez do Hibernate

A divisão típica de trabalho é: o Hibernate ORM só gera schema em modo de desenvolvimento para semear migrações, e em todo ambiente real as mudanças de schema vêm de migrações do Flyway:

```properties
%dev.quarkus.hibernate-orm.database.generation=none
quarkus.flyway.migrate-at-start=true
```

Os valores de `database.generation` do Hibernate (`none`, `create`, `drop-and-create`, `update`, `validate`) e o motor de migração do Flyway não foram feitos para rodar contra as mesmas mudanças de schema ao mesmo tempo; deixar o Hibernate gerar DDL automaticamente enquanto o Flyway também migra as mesmas tabelas é como você obtém deriva e falhas de inicialização. O padrão seguro é: o Hibernate gera SQL só para *produzir* arquivos de migração, o Flyway é a única coisa que *aplica* mudanças de schema em tempo de execução.

### Flyway sob multitenancy

Quando uma unidade de persistência usa multitenancy baseada em schema ou em banco de dados, o próprio gerenciamento de schema do Hibernate ORM não pode ser usado; o guia é explícito ao dizer que "não é suportado pelo Hibernate ORM para multitenancy de schema". Nessa configuração, `quarkus.hibernate-orm.schema-management.strategy` precisa ser definido como `none`, e o Flyway (rodado uma vez por schema/banco de dados de tenant, tipicamente como parte do provisionamento de tenant) se torna o único mecanismo que inicializa e evolui o schema:

```properties
quarkus.hibernate-orm.schema-management.strategy=none
```

## Trade-offs

- **Migrações geradas são um ponto de partida, não uma resposta final**: o SQL que o Hibernate emite é um primeiro rascunho razoável, mas revisá-lo e ajustá-lo à mão (índices, restrições, `ALTER` que preserva dados vs. `DROP`/`CREATE`) antes de commitar ainda é responsabilidade sua.
- **Misturar auto-DDL do Hibernate e Flyway é a armadilha**: rodar `quarkus.hibernate-orm.database.generation=update` junto com migrações Flyway ativas contra o mesmo schema convida mudanças conflitantes; escolha um dono por ambiente.
  ```properties
  %dev.quarkus.hibernate-orm.database.generation=none
  ```
- **Multitenancy força a mão do Flyway**: estratégias de multitenancy por schema/banco de dados não podem depender do gerenciamento de schema do Hibernate de forma alguma, então o Flyway (ou uma ferramenta externa equivalente) é obrigatório ali, não opcional.
- **`clean-at-start` é uma conveniência só de dev/teste**: é fácil copiar um trecho de configuração sem perceber que ele tem escopo por perfil; um `clean-at-start=true` sem escopo chegando à produção derrubaria o schema a cada deploy.
- **A geração pela Dev UI é um gatilho manual**: ela não roda automaticamente a cada mudança de entidade, então é fácil esquecer de regenerar uma migração depois de uma refatoração que afeta o schema, e deixar o modo de desenvolvimento e o histórico de migração divergirem silenciosamente.

## Documentation Links

- [Guia Hibernate ORM: integração com Flyway](https://quarkus.io/guides/hibernate-orm) (guia fonte cobrindo o fluxo de geração de migração da Dev UI e a interação com o gerenciamento de schema em multitenancy)
- [Guia Flyway do Quarkus](https://quarkus.io/guides/flyway) (documentação dedicada às propriedades de configuração `quarkus.flyway.*`)
