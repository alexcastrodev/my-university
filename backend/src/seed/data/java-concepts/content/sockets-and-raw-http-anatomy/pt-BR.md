---
version: 1.0
updatedAt: 2026-08-05
title: Sockets e a Anatomia Bruta de uma Requisição HTTP
summary: Como ServerSocket/Socket implementam a primitiva accept-connect-read-write por trás de todo web server, e o formato literal, em nível de byte, de uma requisição/resposta HTTP/1.1 (request line, headers, terminador de linha em branco, corpos com Content-Length/chunked, classes de status code).
---
## Objective

Todo framework HTTP — Tomcat, Netty, o servidor embutido do Spring — é, por baixo dos panos, um programa que abre um `ServerSocket`, aceita conexões TCP, e lê/escreve bytes que por acaso seguem o formato textual do HTTP. Ninguém escreve isso à mão em produção hoje em dia, mas entender a camada crua explica comportamentos de framework que de outra forma parecem mágica: por que `Content-Length` precisa ser exato, o que "keep-alive" de fato mantém vivo, e por que uma requisição malformada produz uma falha em nível de conexão em vez de um erro HTTP limpo. `java.net.Socket`/`ServerSocket` é a primitiva accept-connect-read-write cliente/servidor por baixo de tudo isso; o próprio HTTP é só um protocolo textual específico rodando sobre essa conexão.

## Use Cases

- Diagnosticar uma requisição travada que na verdade é um descompasso de `Content-Length` (o cliente diz N bytes, envia mais ou menos) — algo que uma leitura de socket crua deixa óbvio e que a mensagem de exceção de um framework às vezes obscurece.
- Entender por que uma conexão "keep-alive" ociosa consome uma thread/socket do servidor mesmo entre requisições, o que motiva pooling de conexões e timeouts.
- Implementar um protocolo pequeno e próprio (pings de health-check, um handshake interno entre serviços) onde uma pilha HTTP completa é overkill e um loop de leitura/escrita cru em `Socket` é mais simples e rápido.
- Ler capturas do Wireshark/tcpdump ou a saída de `curl -v` e mapear o que está no fio de volta para o modelo de requisição/resposta que os frameworks abstraem.

## Deep Dive

### `ServerSocket`/`Socket`: a primitiva accept-connect-read-write

```java
// Server side
ServerSocket serverSocket = new ServerSocket(8350);
while (true) {
    Socket socket = serverSocket.accept();       // blocks until a client connects
    InputStream in = socket.getInputStream();     // bytes the client sent
    OutputStream out = socket.getOutputStream();  // bytes to send back
    // read the request, write the response, then typically socket.close()
}

// Client side
Socket socket = new Socket("localhost", 8350);    // connects — the TCP three-way handshake happens here
OutputStream out = socket.getOutputStream();
InputStream in = socket.getInputStream();
```

`ServerSocket` faz bind numa porta e faz exatamente uma coisa: `accept()` conexões de entrada, cada uma produzindo um novo `Socket` dedicado àquele cliente. A porta (1–65535) identifica *qual aplicação* na máquina; o endereço IP identifica *qual máquina*. Este é um socket **conectado** (TCP) — o SO garante entrega e ordenação. `DatagramSocket`, em contraste, é a API do Java para comunicação **não conectada** (UDP) — sem garantia de entrega, sem ordenação, mas com menos overhead, motivo pelo qual é usado para coisas como consultas DNS ou mídia em tempo real, em vez de tráfego de requisição/resposta confiável.

### A request line, os headers e o terminador de linha em branco

Lida byte a byte (ou linha a linha, uma vez decodificada como texto) a partir do `InputStream` de um `Socket`, uma requisição HTTP/1.1 tem um formato fixo:

```
GET /products/42 HTTP/1.1
Host: localhost:8080
Connection: keep-alive
Accept: application/json

```

Quatro partes, sempre nesta ordem: a **request line** (método + target + versão do protocolo), zero ou mais **headers** (um por linha, `Nome: valor`), uma **linha em branco** marcando o fim dos headers, e — só para métodos que carregam um corpo — o **corpo da mensagem** em si. Essa linha em branco é a única coisa que diz a um leitor de byte stream "os headers acabaram, o que vier a seguir é o corpo ou nada" — não há prefixo de tamanho no bloco de headers em si, então um servidor precisa ler linha a linha até encontrá-la.

### Por que `Content-Length` (ou chunked encoding) precisa ser exato

Uma requisição que carrega corpo precisa de uma forma de dizer ao leitor quantos bytes consumir, já que texto não se autodelimita como os headers (um corpo poderia legitimamente conter linhas em branco):

```
POST /form HTTP/1.1
Host: localhost:8080
Content-Type: text/plain
Content-Length: 294

Lorem ipsum dolor sit amet, consectetur adipiscing elit...
```

`Content-Length` diz ao leitor precisamente quantos bytes de corpo vêm depois da linha em branco. Se a contagem do remetente estiver errada — alta demais, e o leitor bloqueia esperando bytes que nunca chegam; baixa demais, e o leitor trata o restante como o início da próxima mensagem na mesma conexão — este é exatamente o modo de falha que `Transfer-Encoding: chunked` existe para evitar, em corpos cujo tamanho não é conhecido de antemão (conteúdo em streaming/gerado dinamicamente): em vez de um tamanho declarado, o corpo é enviado como uma série de chunks prefixados por tamanho, terminando com um chunk de tamanho zero como terminador.

### O formato espelhado da resposta, e as classes de status code

```
HTTP/1.1 200 OK
Content-Type: text/html
Content-Length: 149

<html><body><h1>Hello World!</h1></body></html>
```

Uma resposta espelha o formato da requisição: uma status line (versão do protocolo + status code de 3 dígitos + reason phrase) no lugar da request line, depois headers, uma linha em branco, e então um corpo opcional. O primeiro dígito do status code agrupa seu significado: `1xx` informacional, `2xx` sucesso, `3xx` redirecionamento, `4xx` erro do cliente, `5xx` erro do servidor — uma convenção precisa o suficiente para que um cliente possa tomar uma decisão grosseira ("tentar de novo?", "desistir?", "seguir o redirecionamento?") a partir apenas desse único dígito, antes mesmo de fazer parse da reason phrase.

### Uma página, muitas requisições

Um navegador renderizando `index.html` com uma imagem e uma stylesheet embutidas não recebe as três coisas em uma única resposta — HTML, CSS e a imagem são três recursos separados, então o navegador dispara três requisições HTTP separadas (historicamente três conexões TCP separadas; tanto o keep-alive do HTTP/1.1 quanto a multiplexação do HTTP/2 existem especificamente para evitar pagar o custo do handshake TCP por recurso). Essa é a razão concreta pela qual "um carregamento de página" pode significar dezenas de requisições na aba de rede de um navegador — todo recurso referenciado é seu próprio ciclo de requisição/resposta.

## Trade-offs

- **Um descompasso de contagem de bytes no `Content-Length` não é um erro HTTP limpo — é uma conexão travada.** Código de framework transforma isso em uma exceção legível; um leitor feito à mão que confia literalmente no header bloqueia em `InputStream.read()` esperando bytes que nunca foram enviados.
```java
// naive: trusts Content-Length completely, no timeout — will hang forever on a lying client
byte[] body = new byte[contentLength];
in.readNBytes(body, 0, contentLength);
```
- **O formato de serialização é uma decisão de compatibilidade, não só de conveniência** — o marshaling `Serializable`/`ObjectInputStream`/`ObjectOutputStream` do Java é simples quando os dois lados são Java, mas trava o protocolo a clientes JVM apenas; um formato textual como JSON custa um pouco mais para codificar/decodificar, mas funciona com qualquer linguagem do outro lado do socket. É exatamente por isso que praticamente toda API HTTP real hoje usa JSON/Protobuf no fio em vez da serialização de objetos nativa do Java, independentemente das preocupações de segurança de deserialização que a serialização nativa também carrega (veja `io-streams-fundamentals`).
- **Ler uma conexão = uma thread não escala além de alguns milhares de clientes** — o loop `accept()` ingênuo mostrado aqui bloqueia uma thread por conexão; servidores reais usam ou um thread pool (limitado, ainda uma thread por conexão ativa) ou um modelo de I/O não bloqueante/orientado a eventos (o `NioEventLoop` do Netty, o `Selector` do Java NIO) precisamente para evitar esse teto. Virtual threads (veja `thread-model-legacy-vs-virtual-threads`) tornam o modelo ingênuo "uma thread por conexão" viável de novo em uma escala muito maior, já que uma virtual thread bloqueada não prende uma thread do SO enquanto espera.
- **Keep-alive troca recursos do servidor por latência por requisição** — uma conexão keep-alive ociosa ainda mantém um socket (e, sem virtual threads, uma thread do SO) aberto no servidor entre requisições, mas evita repetir o handshake TCP a cada requisição subsequente na mesma conexão; timeouts de ociosidade do lado do servidor existem especificamente para recuperar esses recursos de clientes que nunca voltam.

## Documentation Links

- [ServerSocket — java.net API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/ServerSocket.html) — doc
- [Socket — java.net API docs (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/Socket.html) — doc
- [RFC 9110 — HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110) — doc
- [RFC 9112 — HTTP/1.1 (message syntax and routing)](https://www.rfc-editor.org/rfc/rfc9112) — doc
