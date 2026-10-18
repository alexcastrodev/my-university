---
version: 1.0
updatedAt: 2026-08-02
title: "HttpClient: A API Moderna do java.net.http"
summary: Como o padrão builder do HttpClient substituiu a API de baixo nível e pouco prática do HttpURLConnection — send() síncrono vs. sendAsync() assíncrono retornando um CompletableFuture — e como o BodyHandlers decide em que formato o corpo da resposta chega.
---
## Objective

O `HttpClient` (em `java.net.http`, desde o Java 11) substituiu o antigo `HttpURLConnection` por uma API baseada em builders, construída especificamente para HTTP: uma requisição e sua configuração são montadas com builders fluentes em vez de mutar um objeto de conexão propriedade por propriedade, o client fala HTTP/2 por padrão, e toda requisição pode ser enviada de forma síncrona (`send()`, bloqueante) ou assíncrona (`sendAsync()`, retornando um `CompletableFuture`).

## Use Cases

- Chamar uma API REST e obter o corpo da resposta de volta como `String`, sem conectar manualmente um `InputStreamReader` sobre o stream de entrada da conexão.
- Disparar várias chamadas HTTP independentes concorrentemente e compor seus resultados com `CompletableFuture`, em vez de bloquear uma thread por chamada.
- Baixar um arquivo direto para o disco entregando ao corpo da resposta um `Path` de destino, sem fazer streaming de bytes manualmente pelo código da aplicação.
- Configurar um client (timeouts, política de redirecionamento, proxy) uma única vez e reutilizá-lo para toda requisição na aplicação, já que instâncias de `HttpClient` são imutáveis e thread-safe.

## Deep Dive

### Construindo um client

```java
HttpClient client = HttpClient.newHttpClient();   // default settings
```

```java
HttpClient client = HttpClient.newBuilder()
    .version(HttpClient.Version.HTTP_1_1)
    .followRedirects(HttpClient.Redirect.NORMAL)
    .connectTimeout(Duration.ofSeconds(20))
    .build();
```

`newHttpClient()` é um atalho para o caso comum; `newBuilder()` expõe os botões de configuração — versão do protocolo, política de redirecionamento (`ALWAYS`, `NEVER`, ou `NORMAL`, que segue redirecionamentos exceto downgrades de HTTPS para HTTP), timeout de conexão, seletor de proxy, autenticador. Sem configuração, o client prefere HTTP/2 e recua para HTTP/1.1 quando o servidor ou proxy não o suporta. Um `HttpClient` já construído é imutável e seguro para compartilhar/reutilizar entre muitas requisições em vez de construir um por chamada.

### Construindo uma requisição

```java
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/users/42"))
    .header("Accept", "application/json")
    .GET()                       // default method is GET; also POST/PUT/DELETE(...) etc.
    .build();
```

Assim como o client, `HttpRequest` é construído uma vez via `HttpRequest.newBuilder()` e é imutável depois disso — headers, método, URI e corpo ficam todos fixos no momento da construção.

### Enviando: síncrono vs. assíncrono

```java
HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.statusCode());
System.out.println(response.body());
```

`send()` bloqueia a thread chamadora até a resposta chegar — direto ao ponto para scripts e cadeias de chamada simples.

```java
client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
    .thenApply(HttpResponse::body)
    .thenAccept(System.out::println);
```

`sendAsync()` retorna um `CompletableFuture<HttpResponse<T>>` imediatamente; a requisição de fato roda sem bloquear a thread chamadora, e `.thenApply()`/`.thenAccept()`/`.thenCombine()` encadeiam processamento adicional assim que a resposta chega — o mesmo estilo de composição de qualquer outro `CompletableFuture`.

### BodyHandlers: escolhendo o formato do corpo da resposta

```java
HttpResponse.BodyHandlers.ofString();          // response.body() is a String
HttpResponse.BodyHandlers.ofByteArray();        // response.body() is a byte[]
HttpResponse.BodyHandlers.ofFile(Path.of("out.bin"));  // streams straight to a file
HttpResponse.BodyHandlers.ofInputStream();      // response.body() is an InputStream
```

O `BodyHandler` passado para `send()`/`sendAsync()` determina o parâmetro de tipo de `HttpResponse<T>` — escolha `ofFile()` para um download grande, de modo que os bytes sejam gravados em disco em stream em vez de bufferizar a resposta inteira em memória, e `ofString()` para uma resposta típica de API JSON.

## Trade-offs

- **`HttpURLConnection` ainda existe e ainda funciona** — o `HttpClient` não o substitui em nível de linguagem, ele é simplesmente a API para a qual a documentação oficial e a maioria dos tutoriais atuais apontam em código novo, graças à ergonomia dos builders e ao suporte assíncrono nativo que o `HttpURLConnection` nunca teve.
- **HTTP/2 por padrão significa conexões multiplexadas, o que muda algumas suposições carregadas de código que só conhecia HTTP/1.1** — por exemplo, contar com uma conexão por requisição para raciocínios de ordenação ou rate-limiting deixa de valer da mesma forma.
- **O `CompletableFuture` do `sendAsync()` compõe bem, mas exceções surgem de forma diferente do `send()`.** Um `send()` síncrono lança `IOException` diretamente; uma cadeia assíncrona embrulha falhas dentro do próprio future, e esquecer um estágio `.exceptionally()`/`.handle()` significa que uma requisição falha pode silenciosamente não produzir nenhum erro visível até que algo chame `.get()` ou `.join()`.
  ```java
  client.sendAsync(request, HttpResponse.BodyHandlers.ofString())
      .exceptionally(ex -> { System.err.println("request failed: " + ex); return null; })
      .thenAccept(System.out::println);
  ```
- **Escolher o `BodyHandler` errado para o tamanho da resposta importa.** `ofString()`/`ofByteArray()` bufferizam o corpo inteiro em memória antes de retornar — bom para um payload JSON pequeno, uma péssima escolha para um download de vários gigabytes, onde `ofFile()` (ou `ofInputStream()` para streaming manual) evita manter tudo em memória de uma vez.
- **O motivo original de existência do `sendAsync()` — não travar uma das threads de plataforma, que são limitadas, esperando I/O — praticamente desaparece com virtual threads (JDK 21+).** Uma virtual thread bloqueada em `send()` não prende uma thread do SO da forma que uma platform thread prenderia; a orientação atual para código baseado em virtual threads favorece o `send()` síncrono, mais simples, disparando muitas virtual threads para concorrência, em vez de compor cadeias de `CompletableFuture` para evitar bloquear um tipo de thread que já não é mais escasso.

## Lab

Neste lab você recebe `ApiClient`, um pequeno invólucro sobre `java.net.http.HttpClient`, com os métodos vazios. Seu trabalho é preenchê-los. A ideia central é praticar a API de builders de `HttpRequest`, a diferença entre o `send()` bloqueante e o `sendAsync()` que devolve `CompletableFuture`, e por que esquecer o `.exceptionally()` numa cadeia assíncrona deixa falhas sumirem em silêncio.

**O cenário**

Um cliente que faz GET em uma URL e devolve o corpo da resposta, de forma síncrona e assíncrona.

- `ApiClient.get(URI)`: GET síncrono que devolve o corpo como `String`.
- `ApiClient.getAsync(URI)`: GET assíncrono que devolve um `CompletableFuture<String>`.
- `ApiClient.getAsyncWithFallback(URI, fallback)`: versão assíncrona que se recupera de falhas (opcional).
- `ApiException`: exceção (com `statusCode()`) lançada para respostas fora de 2xx.

Os testes sobem um servidor HTTP local de verdade com `com.sun.net.httpserver.HttpServer`, que faz parte do JDK. Não há dependência extra nem acesso a rede externa, e mesmo assim você exercita o fluxo real de `send()`/`sendAsync()`.

**O que você vai fazer, passo a passo**

1. **Montar a requisição (TODO-00).** Construa um `HttpRequest` GET para a `uri` com o cabeçalho `Accept: application/json`.
2. **Enviar de forma síncrona (TODO-01).** Chame `client.send(...)` com `HttpResponse.BodyHandlers.ofString()`. Se o status não estiver entre 200 e 299, lance `new ApiException(response.statusCode())`. Senão, devolva o corpo.
3. **Enviar de forma assíncrona (TODO-02).** Monte a mesma requisição, use `client.sendAsync(...)` e transforme o `HttpResponse<String>` apenas no seu corpo, com `thenApply`.

**Como saber que terminou**

`mvn test` fica todo verde. Você deve conseguir explicar o que acontece com a exceção de uma requisição que falhou se ninguém tratar o `CompletableFuture`, e em que thread cada variante espera a resposta.

**Desafios opcionais**

- **TODO-03:** implemente `getAsyncWithFallback()`, recuperando-se de uma requisição que falhou (por exemplo, conexão recusada) com um valor padrão via `CompletableFuture.exceptionally()`.

**Pré-requisitos:** sintaxe básica de Java, noções de `CompletableFuture` (`thenApply`, `exceptionally`) e tratamento de exceções. O projeto usa Java 21 e Maven.

**Como rodar:** clone o repositório, entre em `java-concepts/httpclient-and-java-net-http` e rode `mvn test` (da raiz: `mvn -pl java-concepts/httpclient-and-java-net-http test`). Os métodos começam lançando `UnsupportedOperationException("Not implemented yet.")` e os comentários `TODO-NN` explicam cada passo, então os testes vermelhos são o seu checklist.

## Documentation Links

- [HttpClient — Java SE 25 API (java.net.http)](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html) — doc
- [HttpRequest — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpRequest.html) — doc
- [HttpResponse.BodyHandlers — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpResponse.BodyHandlers.html) — doc
