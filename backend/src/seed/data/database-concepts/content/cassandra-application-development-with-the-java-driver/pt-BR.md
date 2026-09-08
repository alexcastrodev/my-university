---
version: 1.0
updatedAt: 2026-08-20
title: "Desenvolvimento de Aplicações Cassandra com o Driver Java DataStax (Apache)"
summary: Construindo um cliente Cassandra real com o driver Java, um único CqlSession de vida longa criado com o builder fluente, por que PreparedStatement supera SimpleStatement por mais do que conveniência (preparação única, roteamento com reconhecimento de token, proteção contra injeção), o QueryBuilder e o mapeador de objetos orientado a anotações como alternativas de nível mais alto, e execução assíncrona com CompletionStage. Além disso, o que mudou desde a cobertura do livro voltada para a versão 4.0, agora que o driver é governado pela Apache sob org.apache.cassandra na linha 4.19.x.
---
## Objective

Aprender como uma aplicação Java conversa de fato com o Cassandra usando o Driver Java DataStax (hoje Apache): construir e reutilizar um único `CqlSession`, migrar de `SimpleStatement`s ad hoc para `PreparedStatement`s e entender por que a preparação é uma decisão de performance e corretude, não apenas de conveniência, usar o mapeador de objetos para trabalhar contra classes de entidade em vez de CQL bruto, e emitir queries de forma assíncrona com `CompletionStage`. O objetivo é conseguir ler e escrever código de driver idiomático para um serviço real (o exemplo condutor do livro é um microsserviço de Reservation Service), em vez de tratar o driver como uma caixa-preta que você copia e cola em torno de uma chamada `session.execute(String)`.

## Use Cases

- Escrever a camada de acesso a dados de um microsserviço Spring Boot ou Java puro que conversa com o Cassandra, e decidir como estruturar um `CqlSession` compartilhado, construído uma vez na inicialização e reutilizado durante toda a vida da aplicação.
- Converter um protótipo que monta CQL por concatenação de strings em código de produção que usa `PreparedStatement`/`BoundStatement`, tanto para evitar risco de injeção quanto para obter roteamento correto com reconhecimento de token.
- Escolher entre quatro formas de produzir uma statement (string bruta, `SimpleStatement`, `QueryBuilder`, ou os DAOs anotados do mapeador de objetos) para um determinado trecho de código (script pontual versus query executada a cada requisição versus query com predicados opcionais/variáveis).
- Disparar várias queries em paralelo com `executeAsync()` em vez de bloquear sequencialmente, ou encadear um `SELECT` em um `DELETE`/`INSERT` dependente com `CompletionStage.thenCompose()`.
- Diagnosticar falhas no momento da conexão (`NoHostAvailableException`, `AuthenticationException`) e escolher múltiplos contact points mais um datacenter local explícito para implantações de produção, em vez do contact point único padrão, que serve bem para um laptop.
- Externalizar as configurações do driver (contact points, timeouts, nível de consistência, tamanho de página) para um arquivo `application.conf` (HOCON) em vez de fixá-las no builder, e sobrepor perfis de execução para o punhado de queries que precisam de configurações diferentes do padrão.
- Adicionar uma dependência Maven para `java-driver-core` (e, se necessário, `java-driver-query-builder` ou os módulos do mapper) a um novo serviço, sabendo qual groupId é o atual antes de copiar um trecho antigo de um tutorial ou de uma resposta do Stack Overflow.

## Deep Dive

### `CqlSession`: um objeto pesado por aplicação

O livro apresenta o driver da mesma forma que um desenvolvedor Java já pensa sobre JDBC (uma API neutra em relação a fornecedor, com `Statement`, `PreparedStatement`, `ResultSet`, apoiada em uma implementação específica do fornecedor) e imediatamente aponta onde a analogia se rompe: `com.datastax.oss.driver.api.core.CqlSession` é ao mesmo tempo a conexão e o cliente, construído com um builder fluente:

```java
CqlSession cqlSession = CqlSession.builder()
    .addContactPoint(new InetSocketAddress("127.0.0.1", 9042))
    .build();
```

Os nós listados são **contact points**, usados apenas para descobrir o restante do cluster, de forma análoga aos próprios seed nodes do Cassandra. O padrão de contact point único do driver (`CqlSession.builder().build()`) é conveniente para um laptop, mas o livro é explícito ao dizer que código de produção deve listar vários contact points e definir um datacenter local, para que um único nó fora do ar no momento da inicialização não derrube a aplicação inteira:

```java
CqlSession cqlSession = CqlSession.builder()
    .addContactPoint(new InetSocketAddress("<ip 1>", 9042))
    .addContactPoint(new InetSocketAddress("<ip 2>", 9042))
    .withLocalDatacenter("<data center name>")
    .build();
```

Versões mais antigas do driver (3.x) dividiam isso em um objeto `Cluster` separado, que produzia `Session`s; o driver 4.0 fundiu os dois em `CqlSession`, algo que o livro destaca em um box próprio. Um segundo box é igualmente importante do ponto de vista operacional:

> **Sessions são caras.** "Como um `CqlSession` mantém conexões TCP com múltiplos nós, é um objeto relativamente pesado. Na maioria dos casos, você vai querer criar um único `CqlSession` e reutilizá-lo por toda a aplicação, em vez de ficar construindo e destruindo `CqlSession`s continuamente. Outra opção aceitável é criar um `CqlSession` por keyspace, se sua aplicação acessa múltiplos keyspaces."

Construir um `CqlSession` também lança exceções de forma antecipada: `NoHostAvailableException` se nenhum dos contact points responder, ou `AuthenticationException` se as credenciais forem rejeitadas. Ambas são falhas no momento da inicialização, não por query; é exatamente por isso que o objeto deve ser construído uma vez e mantido durante toda a vida da aplicação, em vez de ser construído a cada requisição.

### A escada de statements: string, `SimpleStatement`, `PreparedStatement`

`CqlSession.execute()` aceita uma string simples e, na prática, é apenas um wrapper de conveniência em torno de `SimpleStatement.newInstance(...)`. Isso funciona bem para um `SELECT * FROM ...` pontual em uma demonstração, mas o livro rapidamente avança para `SimpleStatement`s parametrizados, construídos com `SimpleStatementBuilder`, usando placeholders `?` e `.addPositionalValue(...)`:

```java
SimpleStatement reservationInsert = SimpleStatement.builder(
    "INSERT INTO reservations_by_confirmation (confirm_number, hotel_id, " +
        "start_date, end_date, room_number, guest_id) VALUES (?, ?, ?, ?, ?, ?)")
    .addPositionalValue("RS2G0Z")
    .addPositionalValue("NY456")
    .addPositionalValue("2020-06-08")
    .addPositionalValue("2020-06-10")
    .addPositionalValue(111)
    .addPositionalValue("1b4d86f4-ccff-4256-a63d-45c905df2677")
    .build();
cqlSession.execute(reservationInsert);
```

Isso já evita a concatenação manual de strings e o risco de injeção que vem junto com ela. Mas o livro é deliberado ao não parar por aí, porque a maioria das queries de uma aplicação não é pontual: são a mesma query de um padrão de acesso, executada repetidamente, que é exatamente para o que o `PreparedStatement` foi projetado:

```java
PreparedStatement reservationSelectPrepared = cqlSession.prepare(
    "SELECT * FROM reservations_by_confirmation WHERE confirm_number=?");

BoundStatement reservationSelectBound =
    reservationSelectPrepared.bind("RS2G0Z");

cqlSession.execute(reservationSelectBound);
```

### Por que prepared statements importam além da conveniência

É tentador ler `prepare()` + `bind()` apenas como um `SimpleStatement` com uma aparência mais elegante, mas o livro percorre três razões distintas pelas quais a preparação é, de fato, uma decisão de performance e corretude:

**1. O plano de query é enviado uma única vez, não a cada execução.** `cqlSession.prepare(...)` envia o texto CQL a um nó exatamente uma vez e recebe de volta um identificador único (visível via `PreparedStatement.getId()`); toda execução subsequente envia apenas esse identificador mais os valores vinculados. O driver então prepara proativamente a mesma statement também nos *outros* nós do cluster, de modo que qualquer um deles possa atendê-la como coordenador. Desde o Cassandra 3.10, os nós persistem prepared statements em uma tabela de sistema local (não apenas em um cache em memória), de forma que elas sobrevivem a um reinício de nó; a configuração `advanced.prepared-statements.reprepare-on-up` do driver existe principalmente para cobrir clusters que ainda rodam versões mais antigas. Se o driver alguma vez encontrar um nó onde a statement não foi preparada, ele a repara de forma transparente, ao custo de um round trip extra, que é o caminho de exceção, não o caso comum.

**2. O roteamento com reconhecimento de token depende disso.** É fácil não perceber isso, e o livro conecta o fato diretamente ao `LoadBalancingPolicy` padrão do driver: a consciência de token (rotear uma query diretamente a uma réplica dona da partition key, em vez de a um coordenador arbitrário) é descrita como algo que acontece "sempre que você usa um `PreparedStatement`". Um `BoundStatement` carrega valores tipados e posicionais que o driver pode usar para calcular o token da partição antes de enviar a requisição; uma statement de string bruta não dá ao driver essa estrutura para trabalhar. Então pular os prepared statements não custa apenas a economia do round trip, também pode custar o roteamento ótimo da requisição.

**3. Segurança, da mesma forma que o `PreparedStatement` do JDBC oferece.** O livro afirma isso claramente: "Além de melhorar a eficiência, `PreparedStatement`s também melhoram a segurança ao separar a lógica da query CQL dos dados. Isso oferece proteção contra ataques de injeção." Um `PreparedStatement` deliberadamente *não* é um subtipo de `Statement`, então não é possível passar acidentalmente uma prepared statement não vinculada para `execute()`; você é obrigado a passar por `bind()` primeiro.

O padrão prático recomendado pelo livro: criar um `PreparedStatement` por padrão de acesso (tipicamente um por query em torno da qual o modelo de dados foi desenhado) na inicialização, guardar os objetos `PreparedStatement` da mesma forma que se guarda o `CqlSession`, e chamar `bind()` com valores novos a cada chamada.

### `QueryBuilder`: statements programáticas para estrutura variável

Para queries cuja *forma* varia (predicados opcionais, colunas incluídas condicionalmente), templates de string e prepared statements se tornam pouco práticos. O `QueryBuilder` do driver (um módulo Maven separado, `java-driver-query-builder`) oferece uma API fluente que constrói objetos `Select`, `Insert`, `Update`, `Delete` de forma programática:

```java
Select reservationSelect =
    selectFrom("reservation", "reservations_by_confirmation")
        .all()
        .whereColumn("confirm_number").isEqualTo(bindMarker());

PreparedStatement reservationSelectPrepared =
    cqlSession.prepare(reservationSelect.build());
```

Repare na chamada `bindMarker()`: a saída do `QueryBuilder` pode ela mesma ser preparada, combinando construção programática com os benefícios de performance e segurança descritos acima. Assim como as prepared statements, também protege contra injeção, já que os valores nunca são inseridos manualmente no texto da query.

### O mapeador de objetos: entidades, DAOs e uma implementação gerada

A abstração de mais alto nível oferecida pelo driver é o mapeamento de objetos orientado a anotações, dividido entre um módulo processador em tempo de compilação e um módulo de runtime. Você anota um POJO como `@Entity` (opcionalmente com uma `@NamingStrategy` para converter o camelCase do Java no snake_case recomendado pelo CQL), marca o campo da partition key com `@PartitionKey`, define uma interface `@Dao` com métodos `@Select`/`@Insert`/`@Delete`/`@Query`, e uma interface `@Mapper` com um método `@DaoFactory`:

```java
@Entity
@NamingStrategy(convention = SNAKE_CASE_INSENSITIVE)
public class ReservationsByConfirmation {
    @PartitionKey
    private String confirmNumber;
    private String hotelId;
    private LocalDate startDate;
    private LocalDate endDate;
    private short roomNumber;
    private UUID guestId;
    // constructors, getters/setters, equals/hashCode
}

@Dao
public interface ReservationDao {
    @Select
    ReservationsByConfirmation findByConfirmationNumber(String confirmNumber);

    @Insert
    void save(ReservationsByConfirmation reservation);

    @Delete
    void delete(ReservationsByConfirmation reservation);
}

@Mapper
public interface ReservationMapper {
    @DaoFactory
    ReservationDao reservationDao();
}
```

O processador de anotações gera a implementação em tempo de compilação; em tempo de execução você envolve o `CqlSession` uma única vez (`new ReservationMapperBuilder(cqlSession).build()`) e obtém os DAOs a partir dele. `Mapper.save()` compila para um `INSERT`, e o livro reitera a razão pela qual esse único método cobre tanto criação quanto atualização: "essas são, na prática, a mesma operação para o Cassandra", a mesma semântica de upsert do modelo de dados CQL se propaga diretamente pelo mapper. Classes de entidade podem referenciar outras classes anotadas com `@Entity` para mapear tipos definidos pelo usuário, e o mapper as processa recursivamente. Assim como o próprio `CqlSession`, os objetos de mapper e DAO devem ser construídos uma vez e reutilizados, não recriados a cada chamada.

### Execução assíncrona com `CompletionStage`

`CqlSession.execute()` bloqueia. `executeAsync()` retorna `CompletionStage<AsyncResultSet>`, o tipo padrão de concorrência do Java 8, que permite compor operações dependentes em vez de executá-las sequencialmente e bloquear entre cada uma. (Isso, aliás, é um detalhe que vale a pena conhecer entre versões do driver: a linha 3.x usava o `ListenableFuture` do Guava; a 4.0 passou a usar `CompletionStage`, removendo a dependência do Guava do código da aplicação.) O exemplo trabalhado do livro encadeia uma busca em um delete dependente:

```java
CompletionStage<AsyncResultSet> selectStage = session.executeAsync(
    "SELECT * FROM reservations_by_confirmation WHERE confirm_number=RS2G0Z");

CompletionStage<AsyncResultSet> deleteStage = selectStage.thenCompose(resultSet -> {
    Row reservationRow = resultSet.one();
    return session.executeAsync(SimpleStatement.newInstance(
        "DELETE FROM reservations_by_hotel_date WHERE hotel_id = ? AND " +
            "start_date = ? AND room_number = ?",
        reservationRow.getString("confirm_number"),
        reservationRow.getLocalDate("start_date"),
        reservationRow.getInt("room_number")));
});

deleteStage.whenComplete((resultSet, error) -> {
    if (error != null) {
        System.out.printf("Failed to delete: %s%n", error.getMessage());
    } else {
        System.out.println("Delete successful");
    }
});
```

O driver também expõe `closeAsync()`, `prepareAsync()`, uma construção assíncrona via `CqlSessionBuilder.buildAsync()` e, desde a versão 4.4 do driver, uma extensão de reactive streams: `CqlSession` estende `ReactiveSession`, adicionando `executeReactive()` para processamento com backpressure baseado em `java.util.concurrent.Flow`.

### Configuração: chamadas no builder versus `application.conf`

Tudo o que foi mostrado acima pode ser configurado programaticamente no builder, mas o driver Java, de forma exclusiva entre os drivers da família DataStax, também suporta configuração baseada em arquivo via a biblioteca Typesafe Config, usando sintaxe HOCON e um `application.conf` varrido a partir do classpath:

```
datastax-java-driver {
  basic {
    contact-points = [ "127.0.0.1:9042", "127.0.0.2:9042" ]
    session-keyspace = reservation
  }
}
```

O livro recomenda essa abordagem em vez da configuração programática para a maioria das opções, e separa as opções "basic" (contact points, keyspace, timeout de requisição, nível de consistência padrão, tamanho de página, política de balanceamento de carga) de uma lista mais longa de opções "advanced" (pool de conexões, política de retry, execução especulativa, segurança, logging, métricas), que são usadas com menos frequência, mas continuam sendo apenas chaves de configuração, recarregadas em um intervalo (`config-reload-interval`, padrão de 5 minutos) sem necessidade de reinício. **Perfis de execução** sobrepõem overrides nomeados (por exemplo, um perfil `long_request` com timeout maior e consistência mais forte) sobre os padrões, aplicados por statement com `statement.setExecutionProfileName(...)`.

Dois padrões de configuração merecem destaque, porque refletem escolhas de design deliberadas do próprio driver, descritas diretamente no livro: desde a reescrita da versão 4.0, o driver traz uma *única* `LoadBalancingPolicy` padrão (round-robin, com reconhecimento de token, ciente de datacenter, exigindo um datacenter local explícito) em vez das políticas combináveis da linha 3.x, e uma única `RetryPolicy` opinativa em vez da antiga escolha entre `FallthroughRetryPolicy`/`DowngradingConsistencyRetryPolicy`. O livro observa que a política de downgrade foi removida em parte porque "se você está disposto a aceitar um nível de consistência rebaixado em algumas circunstâncias, você realmente precisa de um nível de consistência mais alto no caso geral?"

### Book vs. today

O livro já cobre o driver 4.0, que corretamente identifica como uma reescrita com quebra de compatibilidade em relação à linha 3.x (fusão de `Cluster`/`Session` em `CqlSession`, `CompletionStage` substituindo os futures do Guava, políticas únicas e opinativas de balanceamento de carga e retry). Duas coisas mudaram desde então:

> **A governança e as coordenadas Maven mudaram em 2024.** A partir da versão **4.18** do driver, o projeto foi doado pela DataStax para a Apache Software Foundation e agora vive em `github.com/apache/cassandra-java-driver`. A consequência prática para um `pom.xml` copiado do livro ou de um tutorial mais antigo: o groupId mudou de `com.datastax.oss` para `org.apache.cassandra`, enquanto os nomes dos artefatos (`java-driver-core`, `java-driver-query-builder`, `java-driver-mapper-runtime`, `java-driver-mapper-processor`) permaneceram os mesmos. No momento em que este texto foi escrito, o driver está na linha **4.19.x**. Trata-se de uma mudança de coordenadas e de propriedade, não de uma reescrita de API: `CqlSession`, o padrão builder, `PreparedStatement`/`BoundStatement`, as anotações do mapper e a API assíncrona baseada em `CompletionStage` permanecem, na forma, inalterados em relação ao que o livro demonstra. Copiar um trecho antigo ainda funciona; só a declaração de dependência precisa ser atualizada para um projeto moderno.
>
> **O suporte a reactive streams, mencionado como novidade no próprio box do livro, hoje já é uma parte estabelecida da API.** `executeReactive()` (adicionado no driver 4.4, antes da transição para a ASF) continua disponível para times que usam Project Reactor ou outra stack baseada em `java.util.concurrent.Flow`, e não foi afetado pela mudança para a ASF.

Nada na explicação do livro sobre *por que* prepared statements importam (preparação única, roteamento com reconhecimento de token, proteção contra injeção) mudou; isso continua sendo a história central de performance e segurança do driver na atual linha 4.19.x.

## Trade-offs

- **Uma string bruta para `execute()` é o caminho mais rápido para errar.** É o atalho mais curto para uma demonstração funcionando e, ao mesmo tempo, a forma mais fácil de reintroduzir risco de injeção e perder o roteamento com reconhecimento de token. É defensável para queries de diagnóstico genuinamente pontuais; não é um padrão para deixar em código de aplicação que roda a cada requisição.
- **`PreparedStatement` troca um round trip inicial por uma execução repetida mais barata e melhor roteada.** Preparar uma statement custa uma chamada de rede para cada nó do cluster na primeira vez; esse custo se amortiza no momento em que o mesmo padrão de acesso roda mais do que umas poucas vezes, que é o caso normal para um serviço construído em torno de um conjunto fixo de tabelas orientadas a query. Para uma query genuinamente executada uma única vez, a preparação é puro overhead; a própria orientação do livro é reservar `SimpleStatement` exatamente para esse caso.
- **`QueryBuilder` compra flexibilidade estrutural ao custo de uma segunda API para aprender e uma dependência extra para gerenciar.** Ele se justifica especificamente para queries cuja forma (não apenas seus valores) varia em tempo de execução: filtros opcionais, colunas incluídas dinamicamente. Para queries de forma fixa, é estritamente mais código do que um `PreparedStatement` construído a partir de um literal de string, sem benefício adicional.
- **O mapeador de objetos remove boilerplate, mas adiciona uma camada de processamento de anotações entre o seu código e o CQL que ele executa.** Ele brilha quando o modelo de domínio já espelha a forma orientada a query, uma tabela por padrão de acesso, que a modelagem de dados do Cassandra produz; o mapper não é um ORM genérico e vai atrapalhar se você esperar comportamento parecido com join ou uma única classe de entidade apoiando múltiplas tabelas de formas diferentes. Depurar implementações de DAO geradas também é um passo a mais em relação a depurar um `PreparedStatement` escrito à mão.
- **A execução assíncrona compra throughput e composabilidade, mas transfere o tratamento de erros e a segurança entre threads para quem chama.** Cadeias de `CompletionStage` se leem de forma limpa no caminho feliz; o próprio exemplo do livro de delete após select omite a checagem de nulo em `resultSet.one()` por questão de legibilidade, que é exatamente o tipo de lacuna que vira um `NullPointerException` em produção. Encadear também significa que você passa a raciocinar sobre em qual executor os callbacks rodam, não apenas sobre qual CQL é executado, um custo real para times que ainda não têm idiomas assíncronos em outras partes do código.
- **Um `CqlSession` único e de vida longa é, ao mesmo tempo, o padrão recomendado e um ponto único de risco de configuração.** Reutilizar um único `CqlSession` (ou um por keyspace) é correto e necessário; ele é dono de conexões TCP agrupadas por nó e é explicitamente documentado como pesado demais para ser construído por requisição. Mas, como tanta coisa (balanceamento de carga, política de retry, consistência padrão, perfis de execução) é configurada uma única vez no nível da sessão ou do arquivo, um padrão mal configurado se aplica silenciosamente a toda query da aplicação até que alguém perceba, em vez de falhar uma chamada de cada vez.

## Documentation Links

- [Jeff Carpenter and Eben Hewitt, "Cassandra: The Definitive Guide", Revised 3rd Edition (O'Reilly, 2022), Chapter 8, "Application Development with Drivers"](https://www.oreilly.com/library/view/cassandra-the-definitive/9781492097143/), doc
- [Java Driver for Apache Cassandra, official documentation (Apache Software Foundation)](https://apache.github.io/cassandra-java-driver/), doc
- [Java Driver for Apache Cassandra, GitHub repository (org.apache.cassandra, 4.19.x)](https://github.com/apache/cassandra-java-driver), doc
- [Java Driver for Apache Cassandra, CqlSession API reference](https://apache.github.io/cassandra-java-driver/4.19.0/api/com/datastax/oss/driver/api/core/CqlSession.html), doc
- [Java Driver for Apache Cassandra, Object Mapper manual](https://apache.github.io/cassandra-java-driver/4.19.0/mapper/), doc
- [Java Driver for Apache Cassandra, Asynchronous programming manual](https://apache.github.io/cassandra-java-driver/4.19.0/core/async/), doc
- [Java Driver for Apache Cassandra, Configuration reference](https://apache.github.io/cassandra-java-driver/4.19.0/core/configuration/), doc
