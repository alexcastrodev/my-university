---
version: 1.0
updatedAt: 2026-08-22
title: "Hibernate Envers: Auditoria e Versionamento"
summary: "A extensão quarkus-hibernate-envers registra um histórico de mudanças completo por entidade via @Audited, entidades de revisão, e a API de consulta AuditReader."
---
## Objective

O Hibernate Envers é o módulo embutido de auditoria e versionamento do Hibernate ORM: anote uma entidade (ou campos específicos) com `@Audited` e o Envers mantém de forma transparente uma "tabela de auditoria" espelho por entidade auditada, escrevendo uma linha por revisão a cada vez que a entidade muda. No Quarkus, a extensão `quarkus-hibernate-envers` conecta esse módulo à extensão Hibernate ORM sem nenhuma configuração adicional necessária: você adiciona a dependência, anota suas entidades, e o Envers começa a registrar histórico ao lado dos seus dados transacionais normais.

## Use Cases

- Trilhas de auditoria regulatórias ou de compliance (quem mudou o quê, e quando) para dados financeiros, de saúde ou de RH.
- Reconstruir o estado de uma entidade como ela estava em um ponto arbitrário no passado, para depuração ou resolução de disputas.
- Rastrear o histórico completo de mudanças de um registro (todo valor intermediário, não só o atual) sem construir à mão colunas e triggers de auditoria.
- Anexar metadados customizados a cada mudança (o usuário que agiu, um ID de requisição, um código de motivo) estendendo a própria entidade de revisão.

## Deep Dive

### Adicionando a extensão e auditando uma entidade

Adicione a extensão:

```xml
<dependency>
    <groupId>io.quarkus</groupId>
    <artifactId>quarkus-hibernate-envers</artifactId>
</dependency>
```

Então marque a entidade (ou só os campos com os quais se importa) com `@Audited`:

```java
@Entity
public class Person {

    @Id
    @GeneratedValue
    private Integer id;

    @Audited
    private String name;

    @Audited
    private String surname;

    @Audited
    @ManyToOne
    private Address address;
}
```

A extensão "se integra automaticamente com o Quarkus sem exigir propriedades de configuração adicionais"; não existe um namespace `quarkus.hibernate-envers.*` para ligá-la. Uma vez que a dependência está presente e ao menos uma entidade é `@Audited`, o Envers cria uma tabela companheira `_AUD` (por exemplo, `person_AUD`) para cada entidade auditada e a popula em cada insert, update e delete.

### Entidades de revisão

Toda mudança que o Envers registra é agrupada em uma *revisão*: uma linha em uma tabela de revisões compartilhada por todas as entidades auditadas. Por padrão, essa é a entidade de revisão padrão embutida do Envers, mas você pode definir a sua própria para anexar metadados customizados (um nome de usuário que agiu, endereço IP, etc.) usando as anotações centrais do Hibernate Envers:

```java
@Entity
@RevisionEntity
public class CustomRevisionEntity {

    @Id
    @GeneratedValue
    @RevisionNumber
    private int id;

    @RevisionTimestamp
    private long timestamp;

    private String username;
}
```

`@RevisionNumber` marca o campo que guarda o id de revisão monotonicamente crescente, e `@RevisionTimestamp` marca o campo que o Envers carimba com o horário de relógio da revisão. Campos que *não* deveriam ser rastreados de forma alguma, mesmo em uma entidade que por outro lado é `@Audited`, são marcados `@NotAudited`.

### Consultando histórico com AuditReader

O histórico é consultado através da API `AuditReader`, obtida do `EntityManager` do JPA via `AuditReaderFactory`:

```java
AuditReader reader = AuditReaderFactory.get(entityManager);

// the entity as it looked at a specific revision
Person historicPerson = reader.find(Person.class, personId, revisionNumber);

// every revision number at which this entity changed
List<Number> revisions = reader.getRevisions(Person.class, personId);

// a full query API for filtering by revision, property, or date range
List<?> results = reader.createQuery()
        .forRevisionsOfEntity(Person.class, false, true)
        .getResultList();
```

Isso permite reconstruir qualquer versão passada de uma entidade, listar toda revisão que a tocou, ou consultar revisões em que uma dada propriedade mudou, tudo sem escrever SQL manual de rastreamento de histórico.

### Ajustando o comportamento do Envers

Como a extensão do Quarkus em si não expõe propriedades de configuração dedicadas, configurações nativas do Hibernate Envers (todas sob o namespace `org.hibernate.envers.*`, como `audit_table_suffix`, o sufixo usado para as tabelas de auditoria geradas, `_AUD` por padrão, ou `store_data_at_delete`) são passadas pela válvula de escape do Quarkus para propriedades brutas do Hibernate, `quarkus.hibernate-orm.unsupported-properties`, na unidade de persistência que você quer afetar:

```properties
quarkus.hibernate-orm.unsupported-properties."org.hibernate.envers.audit_table_suffix"=_history
```

## Trade-offs

- **Toda escrita auditada vira duas escritas**: um insert/update/delete na tabela base mais uma linha na sua tabela `_AUD`, então escritas de alta frequência em entidades fortemente auditadas adicionam overhead mensurável.
- **O armazenamento cresce sem limite por padrão**: o Envers nunca poda revisões antigas; uma estratégia de retenção/arquivamento para tabelas de auditoria é uma preocupação separada que você precisa possuir.
- **A evolução de schema toca duas tabelas**: adicionar, renomear ou remover uma coluna auditada significa que o schema da tabela de auditoria (e qualquer migração Flyway/Liquibase) precisa ser mantido sincronizado ao lado da entidade base.
- **Sem superfície de configuração dedicada no Quarkus**: como a extensão "não expõe propriedades de configuração adicionais", qualquer coisa além dos padrões (entidades de revisão customizadas à parte) exige recorrer a `unsupported-properties`, uma válvula de escape menos descobrível e menos estável do que uma chave `quarkus.*` de primeira classe.
- **A extensão está marcada como experimental** no catálogo de extensões do Quarkus, então sua superfície de configuração e garantias ainda podem mudar entre releases.

## Documentation Links

- [Usando Hibernate ORM e Jakarta Persistence: seção Envers](https://quarkus.io/guides/hibernate-orm) (guia do Quarkus cobrindo a extensão `quarkus-hibernate-envers` e `@Audited`)
- [Hibernate Envers](https://hibernate.org/orm/envers/) (visão geral oficial do Hibernate Envers, uso do `@Audited`, e capacidades do `AuditReader`)
