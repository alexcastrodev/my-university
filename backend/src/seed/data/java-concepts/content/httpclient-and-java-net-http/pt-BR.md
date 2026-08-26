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

## Documentation Links

- [HttpClient — Java SE 25 API (java.net.http)](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html) — doc
- [HttpRequest — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpRequest.html) — doc
- [HttpResponse.BodyHandlers — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpResponse.BodyHandlers.html) — doc
