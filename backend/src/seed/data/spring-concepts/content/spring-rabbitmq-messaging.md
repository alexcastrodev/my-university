---
version: 1.0
updatedAt: 2026-08-06
---
## Objective

A JMS producer addresses a message to the destination it wants it to land in —
`jms.convertAndSend("tacocloud.order.queue", order)` names the queue directly.
AMQP breaks that coupling in half: a producer publishes to an *exchange* with a
*routing key*, and it is the exchange's type plus the *bindings* between that
exchange and its queues — server-side topology the producer never sees — that
decide which queue(s), if any, receive a copy. RabbitMQ is the most prominent
AMQP 0-9-1 broker, and Spring AMQP wraps it in a template/listener pair that
will look immediately familiar if you've used JMS: `RabbitTemplate` for sending
and pull-based receiving, `@RabbitListener` for push-based consumption. The
programming model is nearly identical to [JMS Messaging](spring-jms-messaging);
what genuinely differs is the addressing model, which trades JMS's simple
queue-vs-topic distinction for a routing layer you can reconfigure without
touching either side's code. For log-structured, replayable, partition-based
messaging — a different problem again — see [Kafka
Messaging](spring-kafka-messaging).

## Use Cases

- Fanning a single domain event out to several independent consumers (billing,
  analytics, notifications) via a fanout or topic exchange, where adding a
  fourth consumer means declaring one more binding and changing no producer
  code.
- Attribute-based routing: publishing orders with routing keys like
  `order.us-east.priority` and letting each kitchen bind a topic exchange with
  a pattern (`order.us-east.#`) that selects only the subset it cares about.
- Decoupling a producer from consumer count and topology entirely — the
  producer knows one exchange name and one routing key convention, and
  operations can re-shard consumers by editing bindings in the broker.
- Cross-language systems where a Java service publishes and a Python or Go
  service consumes, which rules out JMS (a Java specification) and rules out
  Java serialization as a wire format.
- Point-to-point work queues that need JMS-like semantics without a JMS broker:
  publish to the default exchange with the queue name as the routing key and
  you have exactly the JMS queue behaviour back.

## Deep Dive

### The addressing model: exchange, routing key, binding, queue

Nothing in AMQP publishes to a queue. A producer publishes to an exchange and
attaches a routing key; the broker matches that routing key against the
bindings registered on the exchange and copies the message into every queue
whose binding matches. Consumers, in turn, read only from queues and never see
exchanges or routing keys at all.

```mermaid
flowchart LR
    P[Producer] -->|"convertAndSend(exchange, routingKey, order)"| X{{"Exchange<br/>tacocloud.orders"}}
    X -->|"binding: kitchens.central"| Q1[(Queue<br/>kitchen.central)]
    X -->|"binding: kitchens.#"| Q2[(Queue<br/>audit.all-orders)]
    Q1 --> C1[@RabbitListener]
    Q2 --> C2[@RabbitListener]
```

That indirection is the whole point. The producer's call is unchanged whether
zero, one, or five queues are bound; whether a message is broadcast or
unicast is a property of the topology, not of the send call.

The exchange *type* decides how routing keys are matched:

- **Default** — a nameless direct exchange (`""`) the broker creates
  automatically. Every queue is auto-bound to it with its own name as the
  binding key, so publishing with routing key `tacocloud.order.queue` delivers
  to the queue of that exact name. This is the JMS-queue emulation.
- **Direct** — delivers to queues whose binding key equals the routing key
  exactly.
- **Topic** — matches routing keys against binding patterns with wildcards
  (`*` for one word, `#` for zero or more), e.g. `order.us-east.#`.
- **Fanout** — ignores routing keys entirely and copies to every bound queue.
  This is the JMS-topic equivalent.
- **Headers** — routes on message header values rather than the routing key,
  using an `x-match` argument to decide between any/all semantics.

Dead-letter exchanges catch messages that are rejected, expire, or overflow a
queue, giving you a place to inspect failures rather than losing them.

### Wiring RabbitMQ into a Spring Boot application

One starter replaces whatever JMS starter was there:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

Autoconfiguration creates a connection factory, a `RabbitTemplate`, an
`AmqpAdmin`, and the listener container factory that `@RabbitListener` needs.
Broker location and credentials come from `spring.rabbitmq.*`:

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

`spring.rabbitmq.addresses` takes a comma-separated list (or a full
`amqp://user:pass@host` URI) when you're pointing at a cluster; `host`
defaults to `localhost` and `port` to `5672`, which is why a local broker
usually needs no configuration at all.

### Sending: `send()` with an explicit `Message`

`RabbitTemplate` implements `AmqpTemplate`, whose send methods differ from
`JmsTemplate`'s in exactly one way — they take an exchange and a routing key
instead of a destination:

```java
void send(Message message) throws AmqpException;
void send(String routingKey, Message message) throws AmqpException;
void send(String exchange, String routingKey, Message message) throws AmqpException;
```

Building the `Message` by hand means borrowing the template's own converter:

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

Note what that two-argument `send()` actually did: it supplied a *routing key*
of `tacocloud.order` and left the exchange at its default of `""` — the
nameless default exchange — so this is a point-to-point send to the queue
named `tacocloud.order`. Both defaults are configurable on the template:

```yaml
spring:
  rabbitmq:
    template:
      exchange: tacocloud.orders
      routing-key: kitchens.central
```

With those set, a `send()` that names neither publishes to
`tacocloud.orders` with routing key `kitchens.central`. Explicit arguments
always win over the template defaults.

### Sending: `convertAndSend()` and the message converter

Constructing the `Message` yourself is almost never worth it. `convertAndSend()`
does the conversion internally:

```java
public void sendOrder(Order order) {
    rabbit.convertAndSend("tacocloud.orders", "kitchens.central", order);
}
```

The converter that runs there is `SimpleMessageConverter` by default, which
handles `String`, `byte[]`, and anything `Serializable` — the last of those by
Java serialization, which pins both ends of the channel to the JVM and to
matching class definitions. For anything crossing a service boundary you swap
it out. Spring AMQP autoconfiguration adopts any single `MessageConverter` bean
in the context and injects it into the auto-configured template:

```java
@Bean
public MessageConverter messageConverter() {
    return new JacksonJsonMessageConverter();   // Spring AMQP 4.x, Jackson 3
    // return new Jackson2JsonMessageConverter(); // Spring AMQP 1.x-3.x
}
```

That one bean changes the wire format to JSON for both directions —
`convertAndSend()` serializes with it and `receiveAndConvert()` /
`@RabbitListener` deserialize with it. Other converters ship in the box:
`MarshallingMessageConverter` (Spring's `Marshaller`/`Unmarshaller`),
`SerializerMessageConverter`, `ContentTypeDelegatingMessageConverter` (picks a
delegate per the `contentType` header), and `MessagingMessageConverter`.

### Setting headers: `MessageProperties` and `MessagePostProcessor`

When you build the `Message` yourself, headers go on the `MessageProperties`
you hand to the converter:

```java
MessageProperties props = new MessageProperties();
props.setHeader("X_ORDER_SOURCE", "WEB");
Message message = converter.toMessage(order, props);
rabbit.send("tacocloud.order", message);
```

`convertAndSend()` hides the `Message`, so the overloads that accept a
`MessagePostProcessor` exist to give you a hook after conversion and before
publication:

```java
rabbit.convertAndSend("tacocloud.orders", "kitchens.central", order,
    message -> {
        message.getMessageProperties().setHeader("X_ORDER_SOURCE", "WEB");
        return message;
    });
```

`MessagePostProcessor` is a functional interface, so the lambda above replaces
the anonymous inner class the book writes out in full.

### Receiving, pull model: `receive()` and `receiveAndConvert()`

The receive side mirrors the send side, minus the routing concepts — once a
message is in a queue, exchanges and routing keys are irrelevant to the
consumer, so every method takes a queue name only:

```java
Message receive(String queueName) throws AmqpException;
Message receive(String queueName, long timeoutMillis) throws AmqpException;
Object  receiveAndConvert(String queueName) throws AmqpException;
<T> T   receiveAndConvert(String queueName, ParameterizedTypeReference<T> type);
```

The raw form makes you convert:

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

The critical difference from `JmsTemplate.receive()`: the default
`receiveTimeout` is `0`, so this returns *immediately* with `null` when the
queue is empty rather than blocking. Passing a timeout — or setting
`spring.rabbitmq.template.receive-timeout` — makes it block up to that many
milliseconds (a negative value blocks indefinitely), but a `null` return is
still possible and the caller must handle it.

`receiveAndConvert()` folds the conversion in, and the
`ParameterizedTypeReference` overload removes the cast:

```java
public Order receiveOrder() {
    return rabbit.receiveAndConvert("tacocloud.orders",
            new ParameterizedTypeReference<Order>() {});
}
```

That typed overload requires the configured converter to implement
`SmartMessageConverter` — the Jackson JSON converter is the out-of-the-box
choice that does. Polling also costs a fresh consumer per call, so it is a
poor fit for high-volume queues; it earns its place when the consumer needs to
control its own pace (a kitchen display that pulls the next order when a cook
is free) rather than being fed.

### Receiving, push model: `@RabbitListener`

For everything else, annotate a bean method and let the container invoke it:

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

The listener container pulls from the queue on its own threads, runs the
configured `MessageConverter` to produce the `Order` argument, and acks on
normal return (rejecting/requeuing or dead-lettering on exception, per the
container's acknowledge mode). Compared to the JMS version, literally only the
annotation name changed — `@JmsListener` → `@RabbitListener`, `destination` →
`queues` — which is the deliberate payoff of Spring's template/listener
abstraction: the broker changes, the programming model doesn't.

> **Book vs. today.** The AMQP side of this chapter has aged unusually well.
> AMQP 0-9-1's exchange/routing-key/binding/queue model, the exchange types,
> and the nameless default exchange are unchanged — `rabbitmq.com` describes
> them today in the same terms the book does. Spring AMQP's core API is
> likewise stable across 4.x: `send()`/`convertAndSend()` still take
> `(exchange, routingKey, message)` with `""` defaults for both,
> `receive()`/`receiveAndConvert()` still take a queue name and still return
> immediately with `null` unless a `receiveTimeout` is set, and
> `@RabbitListener` is still the annotation-driven counterpart. Spring Boot
> still auto-configures the template and still adopts a `MessageConverter`
> bean if one is defined, and `SimpleMessageConverter` is still the default —
> so JSON conversion remains an explicit opt-in, exactly as the book presents
> it. Two things did move. First, the class name: `Jackson2JsonMessageConverter`
> is deprecated for removal as of Spring AMQP 4.0 in favour of
> `JacksonJsonMessageConverter`, which is built on Jackson 3; the bean
> declaration is otherwise identical. Second, Java serialization has been
> hardened — `SimpleMessageConverter` now refuses to deserialize any class
> unless it matches a configured allowed-list pattern
> (`setAllowedListPatterns(...)`), with an empty list as the default, so the
> book's implicit "Serializable just works" behaviour will now throw unless
> you opt in. Both changes push in the same direction the book already
> recommends: configure a JSON converter.

## Trade-offs

- **Routing flexibility vs. topology you now have to reason about.** A fanout
  or topic exchange lets you add a consumer without touching producer code —
  genuinely valuable — but the answer to "where does this message actually
  go?" no longer lives in the source. It lives in broker bindings, possibly
  declared by a different team, and a typo in a binding pattern produces
  silent non-delivery rather than an exception. JMS's `send(queueName, ...)`
  is less powerful and much easier to trace.
- **The default exchange makes RabbitMQ easy to start with and easy to
  misread.** A two-argument `send()` looks like it names a destination, but the
  string is a *routing key* resolved against the nameless exchange; it only
  behaves like a queue name because every queue is auto-bound to that exchange
  under its own name. The moment someone sets a template default exchange, the
  same line routes somewhere else entirely:
  ```java
  // exchange defaults to "" → delivers to the queue literally named "tacocloud.order"
  rabbit.send("tacocloud.order", message);

  // with spring.rabbitmq.template.exchange=tacocloud.orders set,
  // the identical call publishes to that exchange with routing key "tacocloud.order"
  ```
- **JSON conversion costs one bean; Java serialization costs portability.**
  `SimpleMessageConverter` needs no configuration, which is why it is easy to
  ship a prototype on it — but a Java-serialized payload is unreadable to a
  non-JVM consumer and couples both ends to matching class definitions, so a
  field rename can break a consumer you don't deploy. Swapping in the Jackson
  converter is a one-liner and should be treated as the default choice, not an
  optimization:
  ```java
  @Bean
  MessageConverter messageConverter() {
      return new JacksonJsonMessageConverter();
  }
  ```
- **Pull is controllable, push is fast, and the default timeout makes pull
  surprising.** `@RabbitListener` handles messages as fast as they arrive,
  which is wrong when the consumer is the bottleneck and buffering is
  unacceptable. But `RabbitTemplate.receive()` defaults to a `0` ms timeout, so
  a naive pull loop spins returning `null` and creates a consumer per call —
  the pull model needs a deliberate `receive-timeout` and is documented as
  unsuitable for high-volume queues.
- **A broker you operate vs. a specification you can swap.** JMS is a Java
  specification, so ActiveMQ, Artemis, and others are interchangeable behind
  the same API at the cost of being JVM-only. RabbitMQ is a specific product:
  you gain non-JVM clients and richer routing, and you take on its operational
  surface — clustering and quorum queues, vhosts and permissions, memory and
  disk alarms, per-queue policies, dead-letter configuration. That is a real
  cost, and it is unrelated to how pleasant the Spring API is.
- **The Spring abstraction hides broker differences well enough to hide broker
  choice badly.** `@RabbitListener` and `@JmsListener` differing by one word is
  a genuine ergonomic win, but it makes it tempting to treat the brokers as
  interchangeable when their delivery, ordering, and retention semantics are
  not. This is a design judgment about what your system needs from a broker,
  not something a snippet demonstrates.

## Documentation Links

- Craig Walls, "Spring in Action", 5th Edition (Manning, 2019) — Chapter 8,
  "Sending messages asynchronously", section 8.2 "Working with RabbitMQ and
  AMQP", p. 192-201 — doc
- [RabbitMQ — AMQP 0-9-1 Model Explained (exchanges, queues, bindings, routing keys)](https://www.rabbitmq.com/docs/amqp-concepts) — doc
- [Spring AMQP Reference — Sending Messages (AmqpTemplate send/convertAndSend, default exchange and routing key)](https://docs.spring.io/spring-amqp/reference/amqp/sending-messages.html) — doc
- [Spring AMQP Reference — Message Converters (SimpleMessageConverter default, JacksonJsonMessageConverter, allowed-list patterns)](https://docs.spring.io/spring-amqp/reference/amqp/message-converters.html) — doc
- [Spring AMQP Reference — Polling Consumer (receive/receiveAndConvert, receiveTimeout)](https://docs.spring.io/spring-amqp/reference/amqp/receiving-messages/polling-consumer.html) — doc
- [Spring Boot Reference — Messaging with AMQP (spring.rabbitmq.* properties, MessageConverter bean detection, @RabbitListener)](https://docs.spring.io/spring-boot/reference/messaging/amqp.html) — doc
