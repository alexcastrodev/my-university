---
version: 1.0
updatedAt: 2026-08-22
title: "Gerenciamento de Schema: Modo Dev vs Modo Produção"
summary: "Como quarkus.hibernate-orm.schema-management.strategy e sql-load-script diferem entre perfis dev e produção, e por que a produção deveria entregar o controle de schema a uma ferramenta de migração."
---
## Objective

O Hibernate ORM consegue gerenciar o schema do seu banco de dados para você: criando-o, descartando-o, atualizando-o incrementalmente, ou só validando-o contra suas entidades, e o Quarkus expõe isso através de uma única propriedade `quarkus.hibernate-orm.schema-management.strategy`. A estratégia que faz sentido enquanto se itera localmente (recriar tudo a cada mudança) é exatamente a estratégia que vai destruir dados em produção, então o sistema de perfis de configuração do Quarkus (`%dev`, `%prod`) é o mecanismo para manter esses dois mundos claramente separados em uma única base de código.

## Use Cases

- Desenvolvimento local, onde mudanças de entidade deveriam se refletir no schema imediatamente, sem scripts de migração manuais.
- Semear um conjunto de dados conhecido e repetível para testes manuais ou demos via `import.sql`.
- Deploys de produção onde mudanças de schema precisam passar por uma ferramenta de migração controlada e auditável, em vez de geração automática do Hibernate.
- Verificar, na inicialização, que o schema de um banco de dados alvo de fato corresponde ao que o modelo de entidade espera (`validate`), antes de permitir que a aplicação atenda tráfego.

## Deep Dive

### As estratégias de gerenciamento de schema

Todas as estratégias de schema são controladas por uma única propriedade:

```properties
quarkus.hibernate-orm.schema-management.strategy=[strategy]
```

Valores disponíveis:

- `none`: nenhum gerenciamento automático de schema.
- `create`: cria o schema na inicialização (falha se já existir / não lida com drops).
- `drop-and-create`: descarta o schema, então o cria do zero, a cada inicialização.
- `drop`: só descarta o schema na inicialização.
- `update`: altera incrementalmente o schema existente para casar com o modelo de entidade.
- `validate`: compara o schema existente contra o modelo de entidade e falha a inicialização se não corresponderem, sem mudar nada.

### Modo dev: recriar o schema e recarregar dados de fixture a cada mudança

Em desenvolvimento, o Hibernate ORM se beneficia dos Dev Services de datasource, então frequentemente não há nada a configurar para a própria conexão; o Quarkus sobe um container de banco de dados correspondente automaticamente. A configuração de dev idiomática combina `drop-and-create` com um arquivo SQL de fixture:

```properties
%dev.quarkus.hibernate-orm.schema-management.strategy = drop-and-create
%dev.quarkus.hibernate-orm.sql-load-script = import-dev.sql
```

Isso é o que faz o live reload do Quarkus parecer "mágico" para código de persistência: qualquer mudança em uma entidade, ou em `import.sql`, é detectada, e o schema é recriado e repopulado sem reiniciar a aplicação.

### Carregando fixtures SQL com `sql-load-script`

Para carregar statements SQL quando o Hibernate ORM inicia, adicione um arquivo `import.sql` na raiz do diretório `resources`; o Quarkus o pega automaticamente. Para apontar para um arquivo diferente, ou desabilitar o carregamento por completo:

```properties
quarkus.hibernate-orm.sql-load-script=custom-import.sql
quarkus.hibernate-orm.sql-load-script=no-file
```

### Modo produção: mãos afastadas, deixe uma ferramenta de migração ser dona do schema

Em produção, a recomendação é o oposto do modo dev: não deixe o Hibernate tocar no schema de forma alguma, e não carregue um arquivo de fixture só de dev:

```properties
%prod.quarkus.hibernate-orm.schema-management.strategy = none
%prod.quarkus.hibernate-orm.sql-load-script = no-file
```

O guia é explícito quanto a isto: não defina `schema-management.strategy` como `drop-and-create` ou `update` em um ambiente de produção; a evolução de schema ali deveria passar por uma ferramenta de migração de verdade (veja a integração com Flyway).

### Camadas de perfis adicionais para controle mais fino

Como isso é configuração comum baseada em perfil do Quarkus, você pode definir perfis mais granulares além de só `%dev`/`%prod`, por exemplo, um perfil que roda contra uma *cópia* de dados de produção enquanto ainda auto-atualiza o schema:

```properties
%dev.quarkus.hibernate-orm.schema-management.strategy = drop-and-create
%dev-with-data.quarkus.hibernate-orm.schema-management.strategy = update
%prod.quarkus.hibernate-orm.schema-management.strategy = none
```

Ativado com `quarkus dev -Dquarkus.profile=dev-with-data`. Isso dá três posturas distintas de tempo de desenvolvimento: `drop-and-create` mais `import.sql` para uma fixture do zero a cada mudança; `update` quando você precisa de muitas mudanças de entidade mas quer preservar uma cópia funcional de dados parecidos com produção; e `none` (combinado com uma ferramenta de migração) quando você quer controle total da evolução de schema mesmo localmente.

## Trade-offs

- **`drop-and-create` garante um schema limpo e reprodutível, mas destrói todo dado a cada reinício**: bom para dev/teste, nunca aceitável assim que dados reais existirem.
  ```properties
  %dev.quarkus.hibernate-orm.schema-management.strategy = drop-and-create
  ```
- **`update` preserva dados, mas sua lógica de inferência é best-effort**: consegue adicionar colunas/tabelas que detecta estarem faltando, mas não é uma ferramenta confiável para renomeações, mudanças de tipo, ou remoções, e seu comportamento não é algo do qual você deveria depender fora do desenvolvimento local.
- **`none` é a única escolha segura para produção, mas significa que o Hibernate não faz nada por você**: a evolução de schema precisa ser inteiramente tratada por uma ferramenta externa (por exemplo, Flyway), o que é mais configuração inicial em troca de migrações auditáveis e versionadas.
- **Sobrescritas baseadas em perfil são fáceis de fazer ao contrário**: esquecer o prefixo `%prod.` em uma sobrescrita de estratégia faz o valor sem prefixo (frequentemente orientado a dev) se aplicar silenciosamente em toda parte, incluindo produção.
- **`validate` captura deriva, mas exige que o schema já esteja certo**: é uma checagem de segurança, não uma forma de ir de "nenhum schema" a "schema correto"; precisa ser combinado com um passo real de migração.

## Documentation Links

- [Guia Hibernate ORM: Quarkus](https://quarkus.io/guides/hibernate-orm) (guia fonte cobrindo os valores de `schema-management.strategy`, `sql-load-script`/`import.sql`, e as recomendações de perfil `%dev`/`%prod`)
