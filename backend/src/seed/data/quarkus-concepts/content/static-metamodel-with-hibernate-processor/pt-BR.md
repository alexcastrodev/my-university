---
version: 1.0
updatedAt: 2026-08-22
title: "Metamodelo Estático com o Processador de Anotação do Hibernate"
summary: "O processador hibernate-processor gera classes de metamodelo type-safe para que queries CriteriaBuilder referenciem atributos de entidade em tempo de compilação, em vez de por string."
---
## Objective

O metamodelo estático é a forma do Hibernate transformar nomes de campo de entidade em símbolos verificados em tempo de compilação, em vez de literais de string propensos a erro. O processador de anotação `hibernate-processor` varre suas classes `@Entity` em tempo de compilação e gera uma classe companheira por entidade (convencionalmente com sufixo `_`), cujos campos estáticos espelham os atributos persistentes da entidade, então uma query da Criteria API pode referenciar `MyEntity_.name` em vez da string `"name"`, e um erro de digitação vira um erro de compilação em vez de um `IllegalArgumentException` em tempo de execução.

## Use Cases

- Construir queries `CriteriaBuilder` onde nomes de atributo precisam sobreviver a refatorações: renomeie um campo, obtenha um erro de compilação em toda query que o referenciava, em vez de uma falha silenciosa em tempo de execução.
- Qualquer base de código com mais do que um punhado de queries de Criteria API, onde referências de atributo baseadas em string se tornam um passivo de manutenção.
- Times que querem autocomplete de IDE para atributos de entidade ao construir queries dinâmicas, montadas programaticamente.

## Deep Dive

### Habilitando o processador no build

O metamodelo não é gerado automaticamente só porque o Hibernate ORM está no classpath; o `hibernate-processor` precisa ser registrado explicitamente como um processador de anotação. Para Maven, ele é adicionado à configuração do `maven-compiler-plugin`, com gerenciamento de dependência forçado, para que a versão do processador acompanhe a versão do Hibernate ORM que o Quarkus gerencia:

```xml
<plugin>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <annotationProcessorPaths>
            <path>
                <groupId>org.hibernate.orm</groupId>
                <artifactId>hibernate-processor</artifactId>
            </path>
        </annotationProcessorPaths>
        <annotationProcessorPathsUseDepMgmt>true</annotationProcessorPathsUseDepMgmt>
    </configuration>
</plugin>
```

Para Gradle, o equivalente é declarar o processador como uma dependência `annotationProcessor`, com a versão fixada via uma plataforma imposta, para que corresponda ao BOM do Hibernate ORM que o Quarkus já gerencia:

```gradle
annotationProcessor enforcedPlatform("${quarkusPlatformGroupId}:quarkus-bom:${quarkusPlatformVersion}")
annotationProcessor 'org.hibernate.orm:hibernate-processor'
```

### O que é gerado

Para uma entidade `MyEntity`, o processador emite uma classe `MyEntity_` no mesmo pacote, com um campo estático por atributo persistente. Esses campos são tipados contra os tipos de atributo do metamodelo do Hibernate, o que é o que permite à Criteria API checar tipos no acesso a atributo, em vez de aceitar uma string arbitrária.

### Usando o metamodelo com CriteriaBuilder

A classe gerada é consumida diretamente onde quer que você passaria uma string de nome de atributo para a Criteria API:

```java
var builder = session.getCriteriaBuilder();
var criteria = builder.createQuery(MyEntity.class);
var e = criteria.from(MyEntity_.class);
criteria.where(e.get(MyEntity_.name).equalTo(name));
```

`e.get(MyEntity_.name)` resolve para uma expressão de caminho fortemente tipada para o atributo `name`; o compilador verifica tanto que `name` existe em `MyEntity` quanto que o valor passado a `equalTo` é atribuível ao seu tipo.

### Onde isso se encaixa em relação a outros estilos de query

O metamodelo estático só importa se você estiver escrevendo queries de Criteria API diretamente; é uma rede de segurança em tempo de compilação para esse estilo específico de construção dinâmica de query. É ortogonal a (e pode coexistir com) estilos de acesso a dados de nível mais alto: as strings de query simplificadas do Panache e os métodos de repositório declarativos do Jakarta Data não precisam nem usam as classes `_` geradas, já que não pedem que você referencie atributos por nome em código Java da forma como o `CriteriaBuilder` pede.

## Trade-offs

- **Custo em tempo de build, não em tempo de execução**: o processador adiciona um passo de compilação e fontes geradas para revisar/ignorar no controle de versão, mas tem overhead zero em tempo de execução, uma vez compilado.
- **Só compensa com uso real de Criteria API**: se uma base de código majoritariamente usa strings JPQL, finders do Panache, ou repositórios Jakarta Data, montar o processador de metamodelo para uma ou duas queries dinâmicas provavelmente não vale a configuração de build.
- **Alinhamento de versão importa**: o `hibernate-processor` precisa acompanhar a mesma versão de Hibernate ORM do runtime, motivo pelo qual a configuração recomendada o fixa através do próprio gerenciamento de dependência do Quarkus (`annotationProcessorPathsUseDepMgmt` / a plataforma imposta), em vez de uma versão fixada à mão.
  ```xml
  <annotationProcessorPathsUseDepMgmt>true</annotationProcessorPathsUseDepMgmt>
  ```
- **Classes geradas são artefatos de compilação**: precisam ser excluídas de edições manuais e tipicamente de revisões de diff no controle de versão, já que são regeneradas a cada build a partir da fonte de verdade que é a entidade.

## Documentation Links

- [Guia Hibernate ORM: Metamodelo estático](https://quarkus.io/guides/hibernate-orm) (guia fonte cobrindo a configuração do `hibernate-processor` e o uso do `CriteriaBuilder` com classes de metamodelo geradas)
