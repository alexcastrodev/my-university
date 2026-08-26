---
version: 1.0
updatedAt: 2026-08-06
title: RabbitMQ e Mensageria AMQP
---
## Objective

Um producer JMS endereça uma mensagem diretamente para o destino onde quer que
ela caia — `jms.convertAndSend("tacocloud.order.queue", order)` nomeia a fila
diretamente. AMQP quebra esse acoplamento ao meio: um producer publica numa
*exchange* com uma *routing key*, e é o tipo da exchange somado aos *bindings*
entre essa exchange e suas filas — topologia do lado do servidor que o
producer nunca vê — que decidem quais fila(s), se alguma, recebem uma cópia.
RabbitMQ é o broker AMQP 0-9-1 mais proeminente, e o Spring AMQP o encapsula
num par template/listener que vai parecer imediatamente familiar se você já
usou JMS: `RabbitTemplate` para envio e recebimento pull-based,
`@RabbitListener` para consumo push-based. O modelo de programação é quase
idêntico ao de [JMS Messaging](spring-jms-messaging); o que realmente difere é
o modelo de endereçamento, que troca a distinção simples de fila-vs-tópico do
JMS por uma camada de roteamento que você pode reconfigurar sem tocar no
código de nenhum dos dois lados. Para mensageria estruturada em log,
replayable e baseada em partições — um problema diferente novamente — veja
[Kafka Messaging](spring-kafka-messaging).

## Use Cases

- Distribuir um único evento de domínio para vários consumidores independentes
  (billing, analytics, notificações) via uma exchange fanout ou topic, onde
  adicionar um quarto consumidor significa declarar mais um binding e não
  mudar nenhum código de producer.
- Roteamento baseado em atributos: publicar orders com routing keys como
  `order.us-east.priority` e deixar cada cozinha vincular uma exchange topic
  com um padrão (`order.us-east.#`) que seleciona só o subconjunto que lhe
  interessa.
- Desacoplar totalmente um producer da contagem e da topologia de consumers —
  o producer conhece um nome de exchange e uma convenção de routing key, e
  operações pode re-particionar consumers editando bindings no broker.
- Sistemas cross-language onde um serviço Java publica e um serviço Python ou
  Go consome, o que descarta JMS (uma especificação Java) e descarta
  serialização Java como formato de wire.
- Filas de trabalho ponto-a-ponto que precisam de semântica estilo JMS sem um
  broker JMS: publique na exchange default com o nome da fila como routing
  key e você tem exatamente o comportamento de fila JMS de volta.

## Deep Dive

### O modelo de endereçamento: exchange, routing key, binding, queue

Nada em AMQP publica numa fila. Um producer publica numa exchange e anexa uma
routing key; o broker compara essa routing key contra os bindings
registrados na exchange e copia a mensagem para toda fila cujo binding
combina. Consumers, por sua vez, leem apenas de filas e nunca veem exchanges
ou routing keys.

```mermaid
flowchart LR
    P[Producer] -->|"convertAndSend(exchange, routingKey, order)"| X{{"Exchange<br/>tacocloud.orders"}}
    X -->|"binding: kitchens.central"| Q1[(Queue<br/>kitchen.central)]
    X -->|"binding: kitchens.#"| Q2[(Queue<br/>audit.all-orders)]
    Q1 --> C1[@RabbitListener]
    Q2 --> C2[@RabbitListener]
```

Essa indireção é todo o ponto. A chamada do producer não muda se zero, uma ou
cinco filas estão vinculadas; se uma mensagem é broadcast ou unicast é uma
propriedade da topologia, não da chamada de envio.

O *tipo* da exchange decide como as routing keys são comparadas:

- **Default** — uma exchange direct sem nome (`""`) que o broker cria
  automaticamente. Toda fila é auto-vinculada a ela com seu próprio nome como
  binding key, então publicar com routing key `tacocloud.order.queue` entrega
  na fila com exatamente esse nome. Isso é a emulação de fila JMS.
- **Direct** — entrega em filas cuja binding key é exatamente igual à routing
  key.
- **Topic** — compara routing keys contra padrões de binding com wildcards
  (`*` para uma palavra, `#` para zero ou mais), ex. `order.us-east.#`.
- **Fanout** — ignora routing keys completamente e copia para toda fila
  vinculada. Este é o equivalente ao tópico JMS.
- **Headers** — roteia com base em valores de header da mensagem em vez da
  routing key, usando um argumento `x-match` para decidir entre semântica
  any/all.

Dead-letter exchanges capturam mensagens rejeitadas, expiradas ou que
estouram uma fila, dando um lugar para inspecionar falhas em vez de perdê-las.

### Conectando RabbitMQ numa aplicação Spring Boot

Um starter substitui qualquer starter JMS que estivesse lá:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

A autoconfiguração cria uma connection factory, um `RabbitTemplate`, um
`AmqpAdmin`, e a listener container factory que `@RabbitListener` precisa.
Localização e credenciais do broker vêm de `spring.rabbitmq.*`:

```yaml
spring:
  config:
    activate:
      on-profile: prod
  rabbitmq:
    host: rabbit.tacocloud.com
    port: 5673
    username: tacoweb
    password: l3tm31n
```

`spring.rabbitmq.addresses` aceita uma lista separada por vírgulas (ou uma URI
completa `amqp://user:pass@host`) quando você está apontando para um cluster;
`host` tem default `localhost` e `port` default `5672`, o que explica por que
um broker local geralmente não precisa de nenhuma configuração.

### Enviando: `send()` com uma `Message` explícita

`RabbitTemplate` implementa `AmqpTemplate`, cujos métodos de envio diferem dos
de `JmsTemplate` em exatamente um aspecto — eles recebem uma exchange e uma
routing key em vez de um destination:

```java
void send(Message message) throws AmqpException;
void send(String routingKey, Message message) throws AmqpException;
void send(String exchange, String routingKey, Message message) throws AmqpException;
```

Construir a `Message` manualmente significa pegar emprestado o próprio
converter do template:

```java
@Service
public class RabbitOrderMessagingService implements OrderMessagingService {

    private final RabbitTemplate rabbit;

    public RabbitOrderMessagingService(RabbitTemplate rabbit) {
        this.rabbit = rabbit;
    }

    @Override
    public void sendOrder(Order order) {
        MessageConverter converter = rabbit.getMessageConverter();
        MessageProperties props = new MessageProperties();
        Message message = converter.toMessage(order, props);
        rabbit.send("tacocloud.order", message);
    }
}
```

Note o que aquele `send()` de dois argumentos realmente fez: forneceu uma
*routing key* de `tacocloud.order` e deixou a exchange no seu default de
`""` — a exchange default sem nome — então isso é um envio ponto-a-ponto para
a fila chamada `tacocloud.order`. Ambos os defaults são configuráveis no
template:

```yaml
spring:
  rabbitmq:
    template:
      exchange: tacocloud.orders
      routing-key: kitchens.central
```

Com esses definidos, um `send()` que não nomeia nenhum dos dois publica em
`tacocloud.orders` com routing key `kitchens.central`. Argumentos explícitos
sempre vencem sobre os defaults do template.

### Enviando: `convertAndSend()` e o message converter

Construir a `Message` você mesmo quase nunca vale a pena. `convertAndSend()`
faz a conversão internamente:

```java
public void sendOrder(Order order) {
    rabbit.convertAndSend("tacocloud.orders", "kitchens.central", order);
}
```

O converter que roda ali é `SimpleMessageConverter` por default, que lida com
`String`, `byte[]`, e qualquer coisa `Serializable` — este último por
serialização Java, que amarra as duas pontas do canal à JVM e a definições de
classe correspondentes. Para qualquer coisa que cruze uma fronteira de
serviço, você o troca. A autoconfiguração do Spring AMQP adota qualquer bean
único `MessageConverter` no contexto e o injeta no template
auto-configurado:

```java
@Bean
public MessageConverter messageConverter() {
    return new JacksonJsonMessageConverter();   // Spring AMQP 4.x, Jackson 3
    // return new Jackson2JsonMessageConverter(); // Spring AMQP 1.x-3.x
}
```

Aquele único bean muda o formato de wire para JSON nas duas direções —
`convertAndSend()` serializa com ele e `receiveAndConvert()` /
`@RabbitListener` deserializam com ele. Outros converters vêm de fábrica:
`MarshallingMessageConverter` (o `Marshaller`/`Unmarshaller` do Spring),
`SerializerMessageConverter`, `ContentTypeDelegatingMessageConverter` (escolhe
um delegate por header `contentType`), e `MessagingMessageConverter`.

### Definindo headers: `MessageProperties` e `MessagePostProcessor`

Quando você constrói a `Message` você mesmo, headers vão em `MessageProperties`
que você entrega ao converter:

```java
MessageProperties props = new MessageProperties();
props.setHeader("X_ORDER_SOURCE", "WEB");
Message message = converter.toMessage(order, props);
rabbit.send("tacocloud.order", message);
```

`convertAndSend()` esconde a `Message`, então os overloads que aceitam um
`MessagePostProcessor` existem para dar a você um hook depois da conversão e
antes da publicação:

```java
rabbit.convertAndSend("tacocloud.orders", "kitchens.central", order,
    message -> {
        message.getMessageProperties().setHeader("X_ORDER_SOURCE", "WEB");
        return message;
    });
```

`MessagePostProcessor` é uma interface funcional, então a lambda acima
substitui a classe interna anônima que o livro escreve por extenso.

### Recebendo, modelo pull: `receive()` e `receiveAndConvert()`

O lado de recebimento espelha o lado de envio, menos os conceitos de
roteamento — uma vez que uma mensagem está numa fila, exchanges e routing
keys são irrelevantes para o consumer, então todo método recebe apenas um
nome de fila:

```java
Message receive(String queueName) throws AmqpException;
Message receive(String queueName, long timeoutMillis) throws AmqpException;
Object  receiveAndConvert(String queueName) throws AmqpException;
<T> T   receiveAndConvert(String queueName, ParameterizedTypeReference<T> type);
```

A forma crua obriga você a converter:

```java
@Component
public class RabbitOrderReceiver {

    private final RabbitTemplate rabbit;
    private final MessageConverter converter;

    public RabbitOrderReceiver(RabbitTemplate rabbit) {
        this.rabbit = rabbit;
        this.converter = rabbit.getMessageConverter();
    }

    public Order receiveOrder() {
        Message message = rabbit.receive("tacocloud.orders");
        return message != null ? (Order) converter.fromMessage(message) : null;
    }
}
```

A diferença crítica em relação a `JmsTemplate.receive()`: o `receiveTimeout`
default é `0`, então isso retorna *imediatamente* com `null` quando a fila
está vazia em vez de bloquear. Passar um timeout — ou definir
`spring.rabbitmq.template.receive-timeout` — faz bloquear até esse número de
milissegundos (um valor negativo bloqueia indefinidamente), mas um retorno
`null` continua possível e o chamador precisa tratá-lo.

`receiveAndConvert()` embute a conversão, e o overload
`ParameterizedTypeReference` remove o cast:

```java
public Order receiveOrder() {
    return rabbit.receiveAndConvert("tacocloud.orders",
            new ParameterizedTypeReference<Order>() {});
}
```

Esse overload tipado exige que o converter configurado implemente
`SmartMessageConverter` — o converter JSON do Jackson é a escolha pronta que
faz isso. Fazer polling também custa um consumer novo por chamada, então é uma
opção ruim para filas de alto volume; ele vale a pena quando o consumer
precisa controlar seu próprio ritmo (um display de cozinha que puxa o próximo
pedido quando um cozinheiro está livre) em vez de ser alimentado.

### Recebendo, modelo push: `@RabbitListener`

Para tudo o mais, anote um método de bean e deixe o container invocá-lo:

```java
@Component
public class OrderListener {

    private final KitchenUI ui;

    public OrderListener(KitchenUI ui) {
        this.ui = ui;
    }

    @RabbitListener(queues = "tacocloud.order.queue")
    public void receiveOrder(Order order) {
        ui.displayOrder(order);
    }
}
```

O listener container puxa da fila em suas próprias threads, roda o
`MessageConverter` configurado para produzir o argumento `Order`, e faz ack no
retorno normal (rejeitando/reenfileirando ou dead-lettering em caso de
exception, conforme o modo de acknowledge do container). Comparado à versão
JMS, literalmente só o nome da annotation mudou — `@JmsListener` →
`@RabbitListener`, `destination` → `queues` — que é o payoff deliberado da
abstração template/listener do Spring: o broker muda, o modelo de
programação não muda.

> **Livro vs. hoje.** O lado AMQP deste capítulo envelheceu incomumente bem.
> O modelo exchange/routing-key/binding/queue do AMQP 0-9-1, os tipos de
> exchange, e a exchange default sem nome permanecem inalterados —
> `rabbitmq.com` os descreve hoje nos mesmos termos que o livro. A API central
> do Spring AMQP é igualmente estável através das versões 4.x:
> `send()`/`convertAndSend()` ainda recebem `(exchange, routingKey, message)`
> com defaults `""` para ambos, `receive()`/`receiveAndConvert()` ainda
> recebem um nome de fila e ainda retornam imediatamente com `null` a menos
> que um `receiveTimeout` esteja definido, e `@RabbitListener` continua sendo
> a contraparte orientada por annotation. Spring Boot ainda autoconfigura o
> template e ainda adota um bean `MessageConverter` se um estiver definido, e
> `SimpleMessageConverter` continua sendo o default — então a conversão JSON
> permanece um opt-in explícito, exatamente como o livro apresenta. Duas
> coisas mudaram. Primeiro, o nome da classe: `Jackson2JsonMessageConverter`
> está deprecated para remoção a partir do Spring AMQP 4.0 em favor de
> `JacksonJsonMessageConverter`, que é construído sobre Jackson 3; a
> declaração do bean é idêntica no resto. Segundo, a serialização Java foi
> endurecida — `SimpleMessageConverter` agora recusa desserializar qualquer
> classe a menos que combine com um padrão de allowed-list configurado
> (`setAllowedListPatterns(...)`), com uma lista vazia como default, então o
> comportamento implícito do livro de "Serializable simplesmente funciona"
> agora vai lançar exception a menos que você opte por habilitá-lo. As duas
> mudanças empurram na mesma direção que o livro já recomenda: configure um
> converter JSON.

## Trade-offs

- **Flexibilidade de roteamento vs. topologia que agora você precisa
  raciocinar sobre.** Uma exchange fanout ou topic permite adicionar um
  consumer sem tocar código de producer — genuinamente valioso — mas a
  resposta para "para onde essa mensagem realmente vai?" não mora mais no
  código-fonte. Ela mora em bindings do broker, possivelmente declarados por
  um time diferente, e um erro de digitação num padrão de binding produz
  não-entrega silenciosa em vez de uma exception. O `send(queueName, ...)` do
  JMS é menos poderoso e muito mais fácil de rastrear.
- **A exchange default torna o RabbitMQ fácil de começar e fácil de ler
  errado.** Um `send()` de dois argumentos parece nomear um destino, mas a
  string é uma *routing key* resolvida contra a exchange sem nome; ela só se
  comporta como um nome de fila porque toda fila é auto-vinculada a essa
  exchange sob seu próprio nome. No momento em que alguém define uma exchange
  default de template, a mesma linha roteia para um lugar completamente
  diferente:
  ```java
  // exchange defaults to "" → delivers to the queue literally named "tacocloud.order"
  rabbit.send("tacocloud.order", message);

  // with spring.rabbitmq.template.exchange=tacocloud.orders set,
  // the identical call publishes to that exchange with routing key "tacocloud.order"
  ```
- **Conversão JSON custa um bean; serialização Java custa portabilidade.**
  `SimpleMessageConverter` não precisa de configuração, o que é por que é
  fácil embarcar um protótipo sobre ele — mas um payload serializado em Java
  é ilegível para um consumer não-JVM e amarra as duas pontas a definições de
  classe correspondentes, então renomear um campo pode quebrar um consumer
  que você não implanta. Trocar para o converter Jackson é uma linha só e
  deveria ser tratado como a escolha default, não uma otimização:
  ```java
  @Bean
  MessageConverter messageConverter() {
      return new JacksonJsonMessageConverter();
  }
  ```
- **Pull é controlável, push é rápido, e o timeout default torna o pull
  surpreendente.** `@RabbitListener` processa mensagens tão rápido quanto
  chegam, o que é errado quando o consumer é o gargalo e buffering é
  inaceitável. Mas `RabbitTemplate.receive()` tem default de timeout `0` ms,
  então um loop de pull ingênuo gira retornando `null` e cria um consumer por
  chamada — o modelo pull precisa de um `receive-timeout` deliberado e é
  documentado como inadequado para filas de alto volume.
- **Um broker que você opera vs. uma especificação que você pode trocar.**
  JMS é uma especificação Java, então ActiveMQ, Artemis e outros são
  intercambiáveis por trás da mesma API ao custo de serem JVM-only. RabbitMQ
  é um produto específico: você ganha clients não-JVM e roteamento mais rico,
  e assume sua superfície operacional — clustering e quorum queues, vhosts e
  permissões, alarmes de memória e disco, políticas por fila, configuração de
  dead-letter. Esse é um custo real, e não tem relação com quão agradável é a
  API do Spring.
- **A abstração do Spring esconde diferenças de broker bem o suficiente para
  esconder mal a escolha de broker.** `@RabbitListener` e `@JmsListener`
  diferirem por uma palavra só é uma vitória ergonômica genuína, mas torna
  tentador tratar os brokers como intercambiáveis quando suas semânticas de
  entrega, ordenação e retenção não são. Esse é um julgamento de design
  sobre o que seu sistema precisa de um broker, não algo que um snippet
  demonstra.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 8,
  "Sending messages asynchronously", section 8.2 "Working with RabbitMQ and
  AMQP", p. 192-201 — doc
- [RabbitMQ — AMQP 0-9-1 Model Explained (exchanges, queues, bindings, routing keys)](https://www.rabbitmq.com/docs/amqp-concepts) — doc
- [Spring AMQP Reference — Sending Messages (AmqpTemplate send/convertAndSend, default exchange and routing key)](https://docs.spring.io/spring-amqp/reference/amqp/sending-messages.html) — doc
- [Spring AMQP Reference — Message Converters (SimpleMessageConverter default, JacksonJsonMessageConverter, allowed-list patterns)](https://docs.spring.io/spring-amqp/reference/amqp/message-converters.html) — doc
- [Spring AMQP Reference — Polling Consumer (receive/receiveAndConvert, receiveTimeout)](https://docs.spring.io/spring-amqp/reference/amqp/receiving-messages/polling-consumer.html) — doc
- [Spring Boot Reference — Messaging with AMQP (spring.rabbitmq.* properties, MessageConverter bean detection, @RabbitListener)](https://docs.spring.io/spring-boot/reference/messaging/amqp.html) — doc
