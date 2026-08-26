---
version: 1.0
updatedAt: 2026-08-19
title: O Servidor HTTP Embutido do JDK
summary: "O JDK distribui um servidor HTTP oficialmente suportado no módulo jdk.httpserver — HttpServer, HttpExchange, HttpsServer com um SSLContext para TLS, e SimpleFileServer/jwebserver — dando um endpoint HTTP sem dependências que a própria documentação escopa explicitamente para testes, desenvolvimento e depuração, não produção."
---
## Objective

O JDK distribui um servidor HTTP. Não uma biblioteca de sockets a partir da qual você constrói um — um servidor de verdade, no módulo `jdk.httpserver`, exportado como `com.sun.net.httpserver` e oficialmente suportado desde o Java 6: você chama `HttpServer.create(...)`, registra um handler por caminho de URL, `start()`, e você tem um endpoint HTTP sem nenhuma dependência de Tomcat, Jetty, Netty, ou Spring. `HttpsServer` é a mesma API com um `SSLContext` anexado para TLS. A própria documentação do módulo é explícita de que a implementação embutida é voltada para "local testing, development, and debugging" e "does not intend to be a full-featured, high performance HTTP server" — então o ponto de conhecê-lo não é substituir seu framework, é ter um endpoint HTTP sem dependências sempre que você precisar de um, e ver o ciclo request/response no seu menor tamanho possível: um único objeto `HttpExchange` carregando as duas direções.

## Use Cases

- Montar um upstream falso em um teste de integração — um servidor HTTP real em uma porta real retornando respostas prontas, em vez de mockar o cliente HTTP.
- Um endpoint de health/metrics/admin grudado em um processo que não é uma aplicação web (um job batch, uma aplicação desktop, um consumidor de mensagens) sem puxar um framework web para dentro dele.
- Reproduzir um bug do lado cliente que depende de um comportamento de servidor que você não consegue de um servidor real: um `Content-Length` errado, uma resposta lenta, um 500 na terceira chamada.
- Servir um diretório de arquivos estáticos durante o desenvolvimento, via `jwebserver` na linha de comando ou `SimpleFileServer` a partir de código, em vez de instalar nginx.
- Ensinar ou aprender HTTP: `HttpExchange` expõe o método, a URI, os headers, e os streams de corpo diretamente, sem nada entre você e o protocolo.

## Deep Dive

### Criar, registrar um contexto, iniciar

```java
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

HttpServer server = HttpServer.create(new InetSocketAddress(8931), 0);  // 0 backlog = system default

server.createContext("/hello", exchange -> {
    byte[] body = "Hello from the JDK\n".getBytes(StandardCharsets.UTF_8);
    exchange.getResponseHeaders().set("Content-Type", "text/plain; charset=utf-8");
    exchange.sendResponseHeaders(200, body.length);
    try (var out = exchange.getResponseBody()) {
        out.write(body);
    }
});

server.start();          // returns immediately — the server runs on a background thread
// ... later
server.stop(0);          // stop accepting, wait up to N seconds for in-flight handlers, then close
```

Três peças móveis. `HttpServer.create(addr, backlog)` vincula o socket de escuta (backlog é a profundidade da fila de aceite TCP; `<= 0` significa "usar o padrão do sistema"). `createContext(path, handler)` mapeia um *prefixo* de caminho de URI para um `HttpHandler` — uma interface funcional, então uma lambda funciona. `start()` gera uma thread em background e retorna, o que significa que um `main` que inicia um servidor e chega ao fim continua rodando; `stop(delay)` é a contrapartida, e um servidor parado não pode ser reiniciado.

O casamento de caminho é por prefixo mais longo, não exato — `/hello` também atende `/hello/world` a menos que um contexto mais específico o reivindique:

```java
server.createContext("/",       rootHandler);      // catch-all
server.createContext("/api",    apiHandler);       // wins for /api and /api/anything
server.createContext("/api/v2", v2Handler);        // wins for /api/v2/... — longest prefix
```

### `HttpExchange`: um objeto para as duas direções

```java
server.createContext("/echo", exchange -> {
    String method = exchange.getRequestMethod();          // "GET", "POST", ...
    java.net.URI uri = exchange.getRequestURI();          // "/echo?name=ana" — path + query, no host
    String accept = exchange.getRequestHeaders().getFirst("Accept");
    byte[] requestBody = exchange.getRequestBody().readAllBytes();   // an InputStream

    exchange.getResponseHeaders().add("X-Method", method);
    exchange.sendResponseHeaders(200, requestBody.length);           // status + body length
    try (var out = exchange.getResponseBody()) {                     // an OutputStream
        out.write(requestBody);
    }
});
```

Não há um par `HttpServletRequest`/`HttpServletResponse` aqui — um único `HttpExchange` carrega a requisição (`Headers` imutáveis, um `InputStream`) e a resposta (`Headers` mutáveis, um `OutputStream`). A regra de ordem é estrita e fácil de errar: os headers de resposta precisam ser setados **antes** de `sendResponseHeaders(...)`, e `getResponseBody()` só é utilizável **depois** disso.

O segundo argumento de `sendResponseHeaders` é onde o protocolo cru transparece, com três significados distintos:

```java
exchange.sendResponseHeaders(200, body.length);  // > 0: exactly this many bytes must be written
exchange.sendResponseHeaders(200, 0);            //   0: chunked transfer encoding, write any amount
exchange.sendResponseHeaders(204, -1);           //  -1: no response body at all
```

Use `-1` para um `204 No Content`, um `304`, ou um status de erro com corpo vazio. Use `0` quando estiver fazendo streaming e não souber o tamanho de antemão — o servidor troca para `Transfer-Encoding: chunked` e fechar o stream termina o corpo.

### Um handler mínimo estilo REST

Nada roteia por método HTTP para você, então um recurso meio-REST é um `switch` sobre `getRequestMethod()` dentro de um único contexto:

```java
import com.sun.net.httpserver.HttpExchange;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

class ProductsHandler implements com.sun.net.httpserver.HttpHandler {
    private final Map<String, String> store = new ConcurrentHashMap<>();

    @Override
    public void handle(HttpExchange exchange) throws IOException {
        try (exchange) {                                   // HttpExchange is AutoCloseable
            String id = exchange.getRequestURI().getPath()
                                .replaceFirst("^/products/?", "");   // "" or "42"
            switch (exchange.getRequestMethod()) {
                case "GET" -> {
                    String found = store.get(id);
                    if (found == null) {
                        exchange.sendResponseHeaders(404, -1);
                    } else {
                        respond(exchange, 200, found);
                    }
                }
                case "PUT" -> {
                    String body = new String(exchange.getRequestBody().readAllBytes(),
                                             StandardCharsets.UTF_8);
                    boolean created = store.put(id, body) == null;
                    exchange.sendResponseHeaders(created ? 201 : 204, -1);
                }
                case "DELETE" -> exchange.sendResponseHeaders(store.remove(id) == null ? 404 : 204, -1);
                default -> {
                    exchange.getResponseHeaders().set("Allow", "GET, PUT, DELETE");
                    exchange.sendResponseHeaders(405, -1);   // Method Not Allowed
                }
            }
        }
    }

    private static void respond(HttpExchange exchange, int status, String json) throws IOException {
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
```

Dois detalhes que valem a pena copiar. `try (exchange)` funciona porque `HttpExchange` implementa `AutoCloseable`, e fechá-lo libera a conexão — um handler que retorna sem fechar (ou sem escrever exatamente a contagem de bytes prometida) deixa o cliente esperando. E um método não tratado precisa ser respondido explicitamente com `405` mais um header `Allow`; não existe padrão de framework fazendo isso por você.

### O executor: por que o servidor padrão atende uma requisição por vez

```java
HttpServer server = HttpServer.create(new InetSocketAddress(8951), 0);
// no setExecutor(...) call — every exchange runs on the single start() thread
```

Se `setExecutor` nunca é chamado (ou é chamado com `null`), *todos* os exchanges são tratados na única thread em background que `start()` criou. Três requisições concorrentes para um handler que dorme 500 ms levam cerca de 1,5 segundos, porque rodam uma depois da outra. Dar ao servidor um executor resolve isso:

```java
import java.util.concurrent.Executors;

HttpServer server = HttpServer.create(new InetSocketAddress(8952), 0);
server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());   // must be before start()
server.start();
```

Medido contra o mesmo handler de 500 ms, três requisições concorrentes agora terminam em ~505 ms em vez de ~1553 ms. Um executor de uma virtual thread por task é a escolha natural aqui — código de handler é I/O bloqueante, que é exatamente para o que virtual threads servem (veja `thread-model-legacy-vs-virtual-threads`). `setExecutor` lança `IllegalStateException` se o servidor já iniciou, então pertence logo depois de `create`.

### Handlers prontos e filtros que adaptam a requisição (JDK 18+)

O JDK 18 adicionou helpers para que handlers triviais não precisem nem de corpo de lambda:

```java
import com.sun.net.httpserver.Filter;
import com.sun.net.httpserver.Headers;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpHandlers;
import java.util.List;

// canned response — status, headers, body, fixed
HttpHandler teapot = HttpHandlers.of(418, Headers.of("Content-Type", "text/plain"), "teapot\n");

// route by any predicate over the request, with a fallback
HttpHandler routed = HttpHandlers.handleOrElse(
        request -> request.getRequestMethod().equals("PUT"),
        putHandler,
        getHandler);

// pre-processing filter that rewrites the request before the handler sees it
Filter addHeader = Filter.adaptRequest("tag request",
        request -> request.with("X-Source", List.of("internal")));

HttpServer server = HttpServer.create(new InetSocketAddress(8080), 10, "/api", routed, addHeader);
server.createContext("/teapot", teapot);
```

`HttpHandlers.of(...)` realmente retorna o status dado ao pé da letra — um `GET /teapot` contra o servidor acima responde `418 text/plain teapot`. A interface `Request` que esses helpers recebem é deliberadamente menor que `HttpExchange`: método, URI, headers, e um método de cópia `with(name, values)`, sem streams de corpo, porque um filtro ou um roteador não tem nenhum negócio consumindo o corpo. Note o overload de cinco argumentos `HttpServer.create(addr, backlog, path, handler, filters...)` — também do JDK 18 — que cria o servidor e seu primeiro contexto em uma única chamada.

### `SimpleFileServer` e `jwebserver`: arquivos estáticos sem código

```java
import com.sun.net.httpserver.SimpleFileServer;
import com.sun.net.httpserver.SimpleFileServer.OutputLevel;
import java.nio.file.Path;

var server = SimpleFileServer.createFileServer(
        new InetSocketAddress(8000),
        Path.of("/srv/site"),          // must be an absolute path
        OutputLevel.INFO);             // NONE | INFO | VERBOSE request logging
server.start();
```

A mesma coisa a partir do shell, sem nenhum arquivo Java:

```
$ jwebserver -p 8000 -d /srv/site
Binding to loopback by default. For all interfaces use "-b 0.0.0.0" or "-b ::".
Serving /srv/site and subdirectories on 127.0.0.1 port 8000
URL http://127.0.0.1:8000/
127.0.0.1 - - [19/Aug/2026:13:34:11 +0000] "GET /index.html HTTP/1.1" 200 -
```

Ambos vêm da JEP 408 (JDK 18). Os padrões são deliberadamente conservadores: porta 8000, vinculada apenas a **loopback**, só `GET` e `HEAD` (qualquer outra coisa recebe `501` ou `405`), HTTP/1.1 sem HTTPS, tipos MIME inferidos pela extensão do arquivo, links simbólicos e arquivos ocultos nem listados nem servidos. As peças também são reutilizáveis individualmente — `SimpleFileServer.createFileHandler(root)` te dá só o handler de arquivo estático para montar sob qualquer caminho no seu próprio servidor, e `createOutputFilter(out, level)` te dá só o log de acesso.

### TLS: `HttpsServer` mais um `SSLContext`

```java
import com.sun.net.httpserver.HttpsConfigurator;
import com.sun.net.httpserver.HttpsServer;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.KeyStore;
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;

KeyStore keyStore = KeyStore.getInstance("PKCS12");
try (InputStream in = new FileInputStream("ks.p12")) {
    keyStore.load(in, "secret".toCharArray());
}
KeyManagerFactory kmf = KeyManagerFactory.getInstance("PKIX");
kmf.init(keyStore, "secret".toCharArray());

SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(kmf.getKeyManagers(), null, null);   // key managers, trust managers, RNG

HttpsServer server = HttpsServer.create(new InetSocketAddress(8443), 0);
server.setHttpsConfigurator(new HttpsConfigurator(sslContext));   // required
server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
server.createContext("/secure", exchange -> {
    byte[] body = "over TLS\n".getBytes(StandardCharsets.UTF_8);
    exchange.sendResponseHeaders(200, body.length);
    try (var out = exchange.getResponseBody()) { out.write(body); }
});
server.start();
```

`HttpsServer` é uma subclasse de `HttpServer`, então contextos, handlers e executors funcionam de forma idêntica — a única adição é `setHttpsConfigurator(new HttpsConfigurator(sslContext))`, e toda a história de TLS vive no `SSLContext` que você entrega a ele, não na API do servidor. Esse `SSLContext` precisa de um certificado de servidor e uma chave privada, que é o que o keystore guarda; um autoassinado do `keytool` serve bem para trabalho local:

```
$ keytool -genkeypair -alias demo -keyalg RSA -keysize 2048 -validity 365 \
      -dname "CN=localhost" -keystore ks.p12 -storetype PKCS12 -storepass secret -keypass secret
```

Esqueça o configurator e o servidor inicia tranquilamente, depois falha por conexão no momento do handshake em vez de na inicialização:

```
WARNING: sun.net.httpserver.ServerImpl$Exchange run: SSL connection received. No https context created
```
```
javax.net.ssl.SSLHandshakeException: Remote host terminated the handshake
```

Você também pode fazer subclasse de `HttpsConfigurator` e sobrescrever `configure(HttpsParameters)` para fixar protocolos/cipher suites ou exigir certificados de cliente, em vez de aceitar os padrões do `SSLContext`.

## Trade-offs

- **API oficialmente suportada, implementação explicitamente não voltada para produção — duas alegações diferentes, e vale a pena mantê-las separadas.** O pacote `com.sun.net.httpserver` é documentado e suportado (a JEP 408 diz claramente: "The package is officially supported"), então o prefixo `com.sun` não é o sinal usual de "interno, não mexa" aqui. O que *não* é de nível produção é a implementação embutida, segundo a própria documentação do `jdk.httpserver`: destinada a "local testing, development, and debugging", e "does not intend to be a full-featured, high performance HTTP server". É específica do JDK, não do Java SE, então está ausente de um runtime feito com `jlink` que não inclua `jdk.httpserver`, e de runtimes que não derivam do JDK.
- **Só HTTP/1.1.** Sem HTTP/2, sem upgrade para WebSocket, sem multiplexação — um cliente que prefere HTTP/2 negocia para baixo. Reproduzir qualquer coisa específica de HTTP/2 precisa de um servidor real.
```java
var resp = HttpClient.newHttpClient().send(request, BodyHandlers.ofString());
System.out.println(resp.version());   // HTTP_1_1, even against HttpsServer with ALPN-capable clients
```
- **O executor padrão faz um servidor concorrente parecer lento.** Esquecer `setExecutor` não falha, apenas serializa silenciosamente toda requisição na thread do `start()` — um sintoma que só aparece sob carga concorrente, que é exatamente quando uma suíte de testes começa a ficar instável.
```java
// 3 concurrent requests, handler sleeps 500ms:
// no setExecutor(...)                        -> ~1553 ms  (serialized)
// setExecutor(newVirtualThreadPerTaskExecutor()) -> ~505 ms  (concurrent)
```
- **Sem roteamento, sem serialização, sem validação, sem negociação de conteúdo.** Tudo que um framework te dá — path variables, `@PathParam`, JSON binding, tratamento de `Accept`, mapeamento de erro — é trabalho de string feito à mão aqui, o que é tranquilo para três endpoints e miserável para trinta. Jakarta EE/JAX-RS (RESTEasy, Jersey) e Spring Boot, Quarkus, Helidon, e Micronaut existem para o caso de trinta endpoints; vários deles distribuem seu próprio servidor HTTP embutido, então "sem processo de servidor externo" não é motivo para preferir o do JDK.
- **O contrato do exchange é implacável sobre contagens de bytes e fechamento.** Prometa `n` bytes com `sendResponseHeaders(200, n)` e escreva menos, e o cliente fica bloqueado esperando pelo resto; retorne de um handler sem fechar o exchange e a conexão vaza. Frameworks disfarçam os dois.
```java
byte[] body = "12345".getBytes();
exchange.sendResponseHeaders(200, 10);   // claims 10 bytes...
exchange.getResponseBody().write(body);  // ...sends 5 — client hangs on the missing 5
```
- **`SimpleFileServer` vincula a loopback e serve só `GET`/`HEAD`, por design.** Isso é um recurso para um servidor de desenvolvimento e um bloqueio total para qualquer outra coisa: sem HTTPS, sem autenticação, sem controle de acesso, sem uploads. Expô-lo com `-b 0.0.0.0` publica uma árvore de diretórios na rede sem nenhuma autenticação.

## Documentation Links

- [jdk.httpserver module — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/module-summary.html) — doc
- [HttpServer — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpServer.html) — doc
- [HttpExchange — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpExchange.html) — doc
- [HttpsConfigurator — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpsConfigurator.html) — doc
- [SimpleFileServer — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/SimpleFileServer.html) — doc
- [HttpHandlers — com.sun.net.httpserver (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.httpserver/com/sun/net/httpserver/HttpHandlers.html) — doc
- [jwebserver — JDK 25 tool reference](https://docs.oracle.com/en/java/javase/25/docs/specs/man/jwebserver.html) — doc
- [JEP 408: Simple Web Server](https://openjdk.org/jeps/408) — doc
