---
version: 1.0
updatedAt: 2026-08-03
title: Ajustando a Autoconfiguração com Configuration Properties do Spring Boot
---
## Objective

O Spring Boot autoconfigura um `DataSource` funcional, um servlet container
embutido e uma configuração de logging sem nenhum método `@Bean` explícito —
mas "zero código" não significa "zero controle." A abstração de environment
do Spring puxa propriedades de várias fontes (system properties da JVM,
variáveis de ambiente do SO, argumentos de linha de comando,
`application.properties`/`application.yml`) para um único lugar, e os beans
autoconfigurados do Spring Boot estão todos conectados para ler dessa fonte.
Aprender o punhado de propriedades que ajustam os beans autoconfigurados mais
comuns — `server.port`, `spring.datasource.*`, `logging.level.*` — substitui
um método `@Bean` que existiria por uma única linha de YAML.

## Use Cases

- Apontar o `DataSource` autoconfigurado para um banco de dados real (URL,
  usuário, senha) em vez do banco H2 embutido usado durante o
  desenvolvimento, sem escrever à mão um método `@Bean` de `DataSource`.
- Fazer um servlet container escutar numa porta específica em um ambiente e
  numa porta livre escolhida aleatoriamente em outro (útil para testes de
  integração que rodam concorrentemente e não podem colidir numa porta
  fixa).
- Aumentar a verbosidade de logging para um pacote específico (ex.: Spring
  Security, enquanto se depura um problema de autenticação) sem mexer no
  nível de log do resto da aplicação nem escrever um arquivo `logback.xml`.
- Derivar o valor de uma propriedade a partir de outra (ex.: uma mensagem de
  boas-vindas que ecoa `spring.application.name`) em vez de codificar o
  mesmo valor em dois lugares.

## Deep Dive

### O environment do Spring: uma abstração, várias fontes de propriedade

Existem dois tipos de configuração diferentes, mas relacionados, no Spring:
a **conexão de beans** (declarar quais beans existem e como são injetados) e
a **injeção de propriedades** (definir valores em beans que já existem). Sem
o Spring Boot, os dois costumam ficar misturados no mesmo método `@Bean`:

```java
@Bean
public DataSource dataSource() {
    return new EmbeddedDataSourceBuilder()
        .setType(H2)
        .addScript("taco_schema.sql")
        .addScripts("user_data.sql", "ingredient_data.sql")
        .build();
}
```

A autoconfiguração torna esse método desnecessário — se a dependência do H2
está no classpath, o Spring Boot cria um bean `DataSource` equivalente
sozinho, aplicando `schema.sql`/`data.sql` por convenção. O que a
autoconfiguração *não consegue* adivinhar é o que fazer de diferente: um
nome de script diferente, uma porta diferente, um nível de log diferente. É
para isso que servem as configuration properties, e todas elas passam pela
mesma abstração — o environment do Spring agrega propriedades de system
properties da JVM, variáveis de ambiente do SO, argumentos de linha de
comando e `application.properties`/`application.yml`, e as disponibiliza
para qualquer bean autoconfigurado (ou customizado) que peça. O mesmo valor
de `server.port` pode ser definido de qualquer uma dessas formas:

```properties
# application.properties
server.port=9090
```

```yaml
# application.yml
server:
  port: 9090
```

```bash
# command-line argument
$ java -jar tacocloud-0.0.5-SNAPSHOT.jar --server.port=9090

# OS environment variable (note the different naming style —
# Spring resolves SERVER_PORT to server.port automatically)
$ export SERVER_PORT=9090
```

### Configurando o data source autoconfigurado

Em vez de escrever um `@Bean` de `DataSource`, apontar para um banco de
dados real é umas poucas linhas de YAML:

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost/tacocloud
    username: tacodb
    password: tacopassword
```

O Spring Boot infere a classe do driver JDBC a partir da URL na maioria dos
casos; se não conseguir, `spring.datasource.driver-class-name` sobrescreve o
palpite. Assim que uma implementação de connection pool é encontrada no
classpath, o Spring Boot faz o pool do bean `DataSource` com ela
automaticamente — nenhuma configuração explícita de pool é necessária a
menos que os padrões não sirvam.

### Configurando o servidor embutido: portas aleatórias e HTTPS

Definir `server.port` como `0` não faz o servidor falhar ao subir — em vez
disso, ele sobe numa porta disponível escolhida aleatoriamente, exatamente o
que testes de integração rodando concorrentemente precisam para não colidir
numa porta fixa:

```yaml
server:
  port: 0
```

Habilitar HTTPS no container embutido precisa de um keystore (criado uma
vez via o `keytool` do JDK) e mais três propriedades:

```yaml
server:
  port: 8443
  ssl:
    key-store: file:///path/to/mykeys.jks
    key-store-password: letmein
    key-password: letmein
```

### Configurando logging sem um arquivo logback.xml

O Spring Boot faz log via Logback em `INFO` por padrão. Para controle total,
um `logback.xml` na raiz do classpath assume por completo — mas para as duas
mudanças mais comuns (níveis de log por pacote, escrever num arquivo),
configuration properties já bastam sozinhas, sem exigir nenhum arquivo XML:

```yaml
logging:
  level:
    root: WARN
    org.springframework.security: DEBUG
```

### Derivando o valor de uma propriedade a partir de outra

Os valores de propriedade não se limitam a strings fixas — placeholders
`${}` referenciam o valor de outra propriedade, inclusive misturado com
outro texto:

```yaml
greeting:
  welcome: You are using ${spring.application.name}.
```

## Trade-offs

- **Configuration properties trocam um método `@Bean` explícito por um
  contrato implícito** — o nome da propriedade (`server.port`,
  `spring.datasource.url`) precisa ser conhecido ou pesquisado; não há
  compilador para pegar `sever.port` como um typo da forma que um argumento
  de método ausente seria pego. O ganho é que dezenas de propriedades entre
  data source, servidor e logging não precisam de nenhum código Java.
- **`server.port=0` é genuinamente útil para isolamento de testes, mas é
  fácil esquecer que não é um número de porta real** — ler `port: 0` num
  arquivo de configuração sem esse contexto parece uma configuração errada
  em vez de uma instrução deliberada de "me atribua qualquer porta livre."
- **Definir propriedades como variáveis de ambiente usa uma convenção de
  nomenclatura diferente da de arquivos YAML/properties** (`SERVER_PORT` em
  vez de `server.port`) — o Spring resolve isso automaticamente via um
  algoritmo de binding relaxado, mas a diferença visual entre as duas formas
  é uma fonte comum de confusão do tipo "por que minha variável de ambiente
  não está sendo lida" quando a convenção de nomenclatura não é seguida à
  risca (tudo maiúsculo, underscores em vez de pontos/hífens).
- **Book vs. today: `spring.datasource.schema`/`spring.datasource.data`
  foram depreciados no Spring Boot 2.5 e removidos na 3.0**, em favor de
  `spring.sql.init.schema-locations`/`spring.sql.init.data-locations` —
  confirmado pela documentação de referência atual do Spring Boot. O exemplo
  do livro (`spring.datasource.schema: [order-schema.sql, ...]`) não
  funciona mais numa versão atual do Spring Boot; a mesma intenção hoje é
  expressa assim:
  ```yaml
  spring:
    sql:
      init:
        schema-locations: order-schema.sql,ingredient-schema.sql
        data-locations: ingredients.sql
  ```
- **Book vs. today: `logging.file`/`logging.path` desapareceram, não foram
  só renomeados por baixo dos panos** — foram removidos a partir do Spring
  Boot 2.3 (o mesmo ano em que essa 5ª edição foi publicada), substituídos
  por `logging.file.name` e `logging.file.path` respectivamente. Confirmado
  pela referência de logging atual do Spring Boot; o próprio exemplo do
  livro com `logging.path`/`logging.file` já era anterior a essa remoção
  segundo a própria linha do tempo do Spring Boot, então é um caso da
  orientação do livro envelhecer logo depois da publicação, não uma
  depreciação distante no futuro.
- **Book vs. today (já impreciso na própria versão do livro, não algo que
  mudou depois): a ordem de preferência de connection pool.** O livro afirma
  que o pool JDBC do Tomcat é tentado primeiro, caindo para HikariCP ou
  Commons DBCP 2. Na realidade, o Spring Boot 2.0 — a própria versão que
  este livro de 2019 tem como alvo — já tinha mudado a preferência *padrão*
  para HikariCP primeiro, depois Tomcat, depois Commons DBCP2 (o Oracle UCP
  foi adicionado como um quarto fallback depois). Confirmado pelas próprias
  notas de lançamento do Spring Boot 2.0.0 M2 e pelo guia de data-access
  atual — esse detalhe já estava desatualizado na época da publicação do
  livro, a mesma categoria de imprecisão de livro encontrada em outros
  pontos deste workflow (ex.: a afirmação do SQL Cookbook sobre o PostgreSQL
  precisar de um workaround `NULLS FIRST`/`LAST`).

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 5, "Working with configuration properties", section 5.1, p. 114-122 — doc
- [Spring Boot Reference — Externalized Configuration](https://docs.spring.io/spring-boot/reference/features/external-config.html) — doc
- [Spring Boot Reference — Database Initialization (spring.sql.init.*)](https://docs.spring.io/spring-boot/how-to/data-initialization.html) — doc
- [Spring Boot Reference — Logging (logging.file.name/logging.file.path)](https://docs.spring.io/spring-boot/reference/features/logging.html) — doc
- [Spring Boot Reference — Configure a DataSource (connection pool auto-detection order)](https://docs.spring.io/spring-boot/how-to/data-access.html) — doc
