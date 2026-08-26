---
version: 1.0
updatedAt: 2026-08-19
title: Logging em Java: SLF4J, Logback e java.util.logging
summary: A API nativa de logging do JDK, java.util.logging, raramente é chamada diretamente; código real faz logging através da fachada SLF4J contra um backend trocável (geralmente Logback), usando placeholders {} e MDC para saída estruturada e correlacionável.
---
## Objective

O JDK vem com uma API de logging desde o Java 1.4 — `java.util.logging` (JUL), com `Logger`, `Level`, `Handler` e `Formatter` — mas quase nenhum código Java real a chama diretamente. Bibliotecas não têm como saber qual framework de logging a *aplicação* que as usa quer, então o ecossistema se firmou em uma divisão de duas camadas: o **SLF4J** (Simple Logging Facade for Java) é a API que seu código e toda biblioteca chamam, e um **binding** separado decide em tempo de execução qual backend de fato escreve a linha — geralmente **Logback**, às vezes **Log4j 2**, ocasionalmente o próprio JUL. Errar essa divisão fachada/backend te dá ou silêncio total (nenhum binding presente) ou o famoso aviso de "multiple bindings" (mais de um presente); acertar te permite trocar Logback por Log4j 2 numa mudança de dependência, sem alterar nenhum código em toda a cadeia de chamadas.

## Use Cases

- Qualquer código de serviço ou biblioteca: chame `LoggerFactory.getLogger(YourClass.class)` e faça logging através do SLF4J, nunca diretamente pela API de um backend concreto, para que quem usa sua biblioteca não seja forçado a adotar sua escolha de logging.
- Logs estruturados e correlacionáveis em um serviço multi-request ou multi-tenant — IDs de requisição, IDs de usuário, IDs de trace anexados a cada linha de uma determinada requisição sem passar um parâmetro por todo método.
- Aplicações Spring Boot, onde SLF4J + Logback é o stack padrão (`spring-boot-starter-logging`) e a maior parte do trabalho é *configurá-lo*, não chamá-lo.
- Migrar uma base de código antiga que usa `java.util.logging` ou Log4j 1.x sem tocar nos pontos de chamada, trocando o binding por baixo do SLF4J.
- Diagnosticar por que a saída de log de uma biblioteca nunca aparece, ou por que aparece duas vezes — quase sempre um problema de classpath/binding, não um problema de código.
- Auditar uma árvore de dependências em busca da classe de vulnerabilidade JNDI do Log4j 2 (Log4Shell) e entender por que "só usar SLF4J" não te deixa automaticamente seguro.

## Deep Dive

### A fachada: SLF4J

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class OrderService {
    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    public void place(Order order) {
        log.info("Placing order {} for customer {}", order.id(), order.customerId());
        try {
            // ...
        } catch (PaymentException e) {
            log.error("Payment failed for order {}", order.id(), e);
        }
    }
}
```

Dois detalhes que importam mais do que parecem:

- **Placeholders `{}`, não concatenação de strings.** `log.info("Placing order {} for customer {}", id, custId)` só monta a string final se o nível `INFO` estiver de fato habilitado. `log.info("Placing order " + id + "...")` monta a string toda vez, tenha ou não algo logando isso — um custo real em um caminho quente com nível desabilitado.
- **O último argumento, quando é um `Throwable`, vira o stack trace**, não uma substituição de `{}`. `log.error("Payment failed for order {}", order.id(), e)` loga a mensagem com `order.id()` preenchido *e* imprime o stack trace completo de `e` logo abaixo — uma chamada, as duas coisas.

Os níveis são `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR` — sem `FATAL` (o SLF4J deliberadamente o deixou de fora; uma chamada de logging nunca seria o que encerra a JVM).

### O binding: como o SLF4J encontra uma implementação

O SLF4J 2.x resolve seu backend via `ServiceLoader`, não via varredura de classpath por nomes mágicos de classe. Adicione exatamente um artefato de binding e ele é encontrado automaticamente:

```xml
<dependency>
  <groupId>org.slf4j</groupId>
  <artifactId>slf4j-api</artifactId>
  <version>2.0.17</version>
</dependency>
<dependency>
  <groupId>ch.qos.logback</groupId>
  <artifactId>logback-classic</artifactId>
  <version>1.5.18</version>
</dependency>
```

`logback-classic` *é* um provider do SLF4J — o Logback foi escrito pelo próprio autor do SLF4J como a implementação de referência, então não existe camada de adaptador entre eles. O Log4j 2 precisa de uma: `log4j-slf4j2-impl` faz a ponte das chamadas do SLF4J para o motor do Log4j 2.

Dois ou mais bindings no classpath produzem o próprio diagnóstico do SLF4J na inicialização, listando cada um encontrado — um modo de falha real e comum em projetos com várias dependências transitivas que puxam cada uma seu próprio stack de logging, e a correção é sempre excluir todos menos um.

### Fazendo a ponte de logging legado para o SLF4J

Uma dependência escrita contra `java.util.logging`, Log4j 1.x ou Apache Commons Logging não chama o SLF4J — ela chama sua própria API, e por padrão essa saída cai em algum lugar completamente diferente (ou em lugar nenhum). O SLF4J traz módulos de ponte que interceptam essas chamadas e as redirecionam:

```xml
<dependency>
  <groupId>org.slf4j</groupId>
  <artifactId>jul-to-slf4j</artifactId>
</dependency>
```

```java
// once, at application startup
java.util.logging.LogManager.getLogManager().reset();
org.slf4j.bridge.SLF4JBridgeHandler.install();
```

Depois disso, uma chamada em `java.util.logging.Logger` é roteada pelo SLF4J e sai pelo binding que você de fato configurou — então uma única configuração do Logback controla toda linha de log do processo, independentemente de qual API uma dada biblioteca foi escrita contra.

### Configurando o backend: Logback

O Logback lê `logback.xml` do classpath. Uma configuração mínima e real:

```xml
<configuration>
  <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
    <encoder>
      <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
    </encoder>
  </appender>

  <logger name="com.example.app" level="DEBUG"/>

  <root level="INFO">
    <appender-ref ref="STDOUT"/>
  </root>
</configuration>
```

`root` é o nível e conjunto de appenders padrão para todo logger; um `<logger>` nomeado o sobrescreve para aquele prefixo de pacote/classe — assim bibliotecas de terceiros podem ficar em `INFO` enquanto seu próprio código roda em `DEBUG`, no mesmo processo, sem mudança de código.

### Contexto estruturado: MDC

O Mapped Diagnostic Context anexa pares chave/valor a cada linha de log emitida na thread atual, sem passá-los como parâmetro por toda chamada de método — a forma padrão de colocar um ID de requisição ou de trace em toda linha do log de uma requisição:

```java
import org.slf4j.MDC;

public void handle(HttpServletRequest req) {
    MDC.put("requestId", req.getHeader("X-Request-Id"));
    try {
        log.info("Handling request");     // requestId is available to the pattern below
        // ... business logic, more log.info/warn/error calls ...
    } finally {
        MDC.clear();                       // mandatory: thread-local, and threads get reused
    }
}
```

```xml
<pattern>%d{HH:mm:ss.SSS} [%X{requestId}] %-5level %logger{36} - %msg%n</pattern>
```

O `finally { MDC.clear(); }` não é limpeza opcional — o MDC é thread-local, e em um executor com pool uma thread que pula o clear vai anexar o ID da requisição *anterior* aos logs da *próxima* requisição.

### A resposta do próprio JDK: java.util.logging

O JUL ainda existe, não exige nenhuma dependência, e é configurado via um arquivo `logging.properties` (ou `-Djava.util.logging.config.file=...`) em vez de XML:

```java
import java.util.logging.Logger;

Logger logger = Logger.getLogger(OrderService.class.getName());
logger.info("Placing order " + order.id());   // no {} placeholders — build the string yourself
```

Seus níveis não batem com os nomes do SLF4J (`SEVERE`, `WARNING`, `INFO`, `CONFIG`, `FINE`, `FINER`, `FINEST`), não tem equivalente de MDC, e seu `ConsoleHandler` padrão tem um formato verboso e difícil de reconfigurar comparado a um pattern do Logback de uma linha. Ele sobrevive principalmente como aquilo que frameworks fazem ponte *a partir de* (via `jul-to-slf4j`), e como opção de dependência zero para ferramentas pequenas onde trazer SLF4J + Logback é genuinamente mais do que o trabalho precisa.

### Log4Shell: por que isso importa além de estilo

A CVE-2021-44228 ("Log4Shell") foi uma vulnerabilidade de execução remota de código no recurso de lookup JNDI do Log4j 2: uma string manipulada chegando a `logger.error(userInput)` podia fazer a JVM buscar e executar código controlado por um atacante, sem exploit além de conseguir colocar essa string em uma linha de log. O Log4j 2.15.0 mitigou o problema; a correção ficou incompleta (CVE-2021-45046), e o 2.16.0 removeu o mecanismo de lookup JNDI por completo. A lição que sobreviveu ao incidente: mensagens de log continuam sendo uma string Java não estruturada alimentada por uma grande variedade de entrada não confiável (headers, nomes de usuário, URLs), então **qual backend e qual versão** é uma decisão de fato relevante para segurança, não um detalhe de implementação escondido atrás da fachada do SLF4J.

## Trade-offs

- **A fachada não torna o backend irrelevante.** O SLF4J isola seus *pontos de chamada* de uma troca de backend, mas os bugs, características de performance e CVEs do próprio backend continuam sendo problema seu para acompanhar — o Log4Shell vivia inteiramente na implementação do Log4j 2, não em nenhum código que chamava o SLF4J.
- **Placeholders só compensam se usados com consistência.** Um único `log.debug("x=" + expensive())` em um caminho quente, geralmente desabilitado, reintroduz o custo que os placeholders `{}` existem para evitar — a proteção precisa ser habitual, não aplicada só onde é conveniente.
- **O MDC é thread-local, o que é exatamente o problema em código async/reativo.** Um valor definido com `MDC.put` na thread da requisição fica invisível em uma thread diferente que continua a mesma requisição lógica (um callback de executor, um operador `Mono` reativo) a menos que seja explicitamente propagado — tanto Logback quanto Reactor têm mecanismos para isso, mas nenhum é automático.
- **`java.util.logging` não custa nada para começar e nada para manter expertise**, ao preço de uma lacuna real de ergonomia (`FINE`/`FINER`/`FINEST`, logging por concatenação de strings, sem MDC) assim que um projeto cresce além de um punhado de classes — a maioria dos times migra para SLF4J + Logback especificamente para fechar essa lacuna, não por um recurso que o JUL não tem em princípio.
- **Múltiplos bindings é um problema de build, não de código**, e fica mais fácil de acontecer, não mais difícil, conforme a árvore de dependências cresce — uma dependência transitiva que puxa `slf4j-simple` junto com seu próprio `logback-classic` produz exatamente o mesmo aviso de inicialização que escolher dois backends por conta própria.

## Documentation Links

- [SLF4J user manual](https://www.slf4j.org/manual.html) — doc
- [SLF4J error codes (multiple bindings, no providers, etc.)](https://www.slf4j.org/codes.html) — doc
- [Logback manual — configuration](https://logback.qos.ch/manual/configuration.html) — doc
- [Logback manual — Mapped Diagnostic Context (MDC)](https://logback.qos.ch/manual/mdc.html) — doc
- [java.util.logging.Logger — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.logging/java/util/logging/Logger.html) — doc
- [CVE-2021-44228 (Log4Shell) — NVD](https://nvd.nist.gov/vuln/detail/CVE-2021-44228) — doc
- [Logging — Spring Boot Reference Documentation](https://docs.spring.io/spring-boot/reference/features/logging.html) — doc
