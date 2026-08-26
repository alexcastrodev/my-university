---
version: 1.0
updatedAt: 2026-08-19
title: Servidores Multi-Cliente e Unix Domain Sockets
summary: Separar o loop de accept de um ServerSocket da conversa por cliente para que o servidor realmente atenda clientes de forma concorrente, e usar Unix domain sockets (JEP 380, JDK 16) como uma alternativa mais rápida, protegida por permissões de arquivo e estritamente local ao TCP loopback.
---
## Objective

Um server socket faz duas tarefas fáceis de confundir: ele *aceita* conexões e *conversa* nelas. Fazer as duas coisas na mesma thread produz um servidor que funciona perfeitamente com um cliente e silenciosamente serializa todos os outros. Acertar essa separação — um loop de accept que imediatamente repassa cada `Socket` para outro lugar — é tudo o que significa "lidar com múltiplos clientes", e as virtual threads tornaram a versão mais barata disso (uma thread por conexão) a resposta padrão outra vez. Separadamente, quando os dois lados vivem na mesma máquina, TCP loopback não é o único transporte disponível: desde o JDK 16 (JEP 380), a mesma API `SocketChannel`/`ServerSocketChannel` consegue abrir **Unix domain sockets**, endereçados por um caminho de sistema de arquivos em vez de host e porta, protegidos por permissões de arquivo em vez de regras de firewall, e mais rápidos de configurar do que uma conexão loopback. É assim que o IPC local realmente acontece na prática — o socket do daemon do Docker, sockets de banco de dados, sidecars de service mesh compartilhando um volume. A mecânica do próprio `ServerSocket` é coberta em `sockets-and-raw-http-anatomy`; este conceito trata de torná-lo concorrente e da opção não-TCP ao seu lado.

## Use Cases

- Um servidor que precisa conversar com mais de um cliente ao mesmo tempo — a diferença concreta entre três requisições de 500 ms levarem 1,5 s ou 0,5 s.
- Restringir um serviço a uma interface de rede (só loopback, ou a NIC interna em um host multi-homed) em vez de vincular a todo endereço que a máquina tem.
- Conversar com o daemon do Docker, um banco de dados local ou um sidecar de service mesh pelo seu Unix socket (`/var/run/docker.sock`, `/tmp/.s.PGSQL.5432`) a partir do Java, sem uma biblioteca nativa.
- IPC local entre dois processos que *não* podem ser alcançáveis pela rede de forma alguma — um Unix socket não tem porta, então nada fora do host consegue alcançá-lo, por construção.
- Autenticar um peer local pela identidade do SO em vez de uma senha, usando a opção de credenciais de peer do socket.
- Enumerar as interfaces de rede e endereços da máquina (`NetworkInterface`) para decidir a que se vincular, ou para reportar onde um servidor está de fato escutando.

## Deep Dive

### O bug: um loop de accept que também faz o trabalho

```java
ServerSocket serverSocket = new ServerSocket(8982);
while (true) {
    Socket client = serverSocket.accept();
    handle(client);                    // <-- blocks here; no accept() until this returns
}
```

`accept()` retorna um `Socket` para um cliente e o loop então *conversa naquele socket inline*. Nada nisso falha ou lança exceção — o segundo e o terceiro clientes conectam normalmente (o kernel os enfileira no backlog de accept) e ficam esperando a vez. Contra um `handle()` que leva 500 ms, três clientes concorrentes medem **~1522 ms**. O conserto é repassar o socket e voltar direto para `accept()`:

```java
try (ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();
     ServerSocket serverSocket = new ServerSocket(8983)) {
    while (true) {
        Socket client = serverSocket.accept();
        pool.submit(() -> handle(client));   // returns immediately
    }
}
```

Mesmo handler, mesmos três clientes: **~505 ms**. `Executors.newVirtualThreadPerTaskExecutor()` cria uma virtual thread nova por tarefa, então "uma thread por conexão" — o modelo que costumava atingir seu teto na casa dos milhares com platform threads — se torna viável em uma contagem de conexões bem maior, porque uma virtual thread bloqueada em `InputStream.read()` libera sua carrier OS thread em vez de deixá-la parada (veja `thread-model-legacy-vs-virtual-threads`). `ExecutorService` é `AutoCloseable` desde o JDK 19, então try-with-resources cuida do shutdown.

Note o que *não* muda: cada conexão ainda recebe um loop de leitura bloqueante dedicado. NIO não-bloqueante baseado em `Selector` é a alternativa que evita completamente uma thread por conexão, a um custo grande em complexidade de código — com virtual threads, a versão bloqueante costuma ser a melhor troca.

### `handle()`: uma conversa, fechada corretamente

```java
static void handle(Socket socket) {
    try (socket;
         BufferedReader in = new BufferedReader(
                 new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
         PrintWriter out = new PrintWriter(
                 new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8), true)) {
        String line;
        while ((line = in.readLine()) != null) {
            out.print(line + "\r\n");   // CRLF: what most line-oriented protocols specify
            out.flush();                // without this, both ends can sit waiting on each other
        }
    } catch (IOException e) {
        System.err.println("client " + socket.getInetAddress() + ": " + e);
    }
}
```

`try (socket; ...)` fecha o socket mesmo com uma exceção no meio da conversa — um socket vazado em um loop de accept de longa duração é um vazamento de file descriptor. Dois detalhes de protocolo mordem aqui: terminadores de linha deveriam ser `\r\n` em vez do newline de `println()` da plataforma, se algo além do seu próprio cliente puder conectar, e um buffer de `PrintWriter` não flushado é um deadlock mútuo clássico — o servidor espera ler a próxima linha do cliente enquanto sua própria resposta ainda está sentada em um buffer local.

### Escolhendo a que vincular: backlog e interface

```java
// every interface, default backlog
new ServerSocket(9000);

// loopback only — unreachable from other machines
new ServerSocket(9000, 10, InetAddress.getLoopbackAddress());
// bound: localhost/127.0.0.1:9000

// a specific named interface address, backlog of 50
new ServerSocket(9000, 50, InetAddress.getByName("app-internal.example.com"));
```

O construtor de três argumentos recebe o *endereço de bind* (a qual endereço de interface escutar — omita e o socket escuta em todas elas) e o *backlog* (quantas conexões já completas, mas ainda não `accept()`adas, o kernel enfileira antes de recusar mais; `<= 0` significa o padrão do sistema). Vincular ao endereço de loopback é o controle de acesso mais barato possível para um serviço que só processos locais deveriam alcançar.

Para descobrir quais endereços existem, para começo de conversa, `NetworkInterface` tem uma factory que retorna stream (JDK 9+) ao lado da antiga baseada em `Enumeration`:

```java
NetworkInterface.networkInterfaces()
        .filter(iface -> {
            try { return iface.isUp() && !iface.isLoopback(); }
            catch (SocketException e) { return false; }
        })
        .forEach(iface -> System.out.println(iface.getName() + " -> "
                + iface.getInterfaceAddresses()));
```

Um "endereço IP" é uma propriedade de uma interface, não de uma máquina — um laptop tipicamente tem loopback mais uma interface ativa, um servidor ou host de container tem muitas, e a que você vincula decide quem consegue te alcançar.

### Unix domain sockets: o lado servidor

```java
import java.net.StandardProtocolFamily;
import java.net.UnixDomainSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

Path socketPath = Path.of("/tmp/jcb-demo.socket");
Files.deleteIfExists(socketPath);                   // see below — bind fails if the file exists

UnixDomainSocketAddress address = UnixDomainSocketAddress.of(socketPath);
ServerSocketChannel serverChannel = ServerSocketChannel.open(StandardProtocolFamily.UNIX);
serverChannel.bind(address);
// serverChannel.getLocalAddress() -> /tmp/jcb-demo.socket   (a UnixDomainSocketAddress)

SocketChannel channel;
while ((channel = serverChannel.accept()) != null) {
    try (channel) {
        ByteBuffer buffer = ByteBuffer.allocate(1024);
        int bytesRead;
        while ((bytesRead = channel.read(buffer)) > 0) {
            buffer.flip();                                       // switch from writing to reading
            System.out.println("[server] " + StandardCharsets.UTF_8.decode(buffer));
            buffer.clear();
        }
    }
}
```

Três elementos de API carregam toda a feature: `StandardProtocolFamily.UNIX` seleciona a família, `UnixDomainSocketAddress.of(path)` nomeia o endpoint, e as classes de channel são as *mesmas* `ServerSocketChannel`/`SocketChannel` usadas para TCP — `accept()`, `read()`, `write()` e a multiplexação por `Selector` se comportam exatamente como se comportam para sockets IP. Não há porta e não há host. `bind()` cria um arquivo de verdade naquele caminho (`ls -l` o mostra como um socket), e esse arquivo *é* o endereço.

O overload `open(ProtocolFamily)` em si data do JDK 15; `StandardProtocolFamily.UNIX` e `UnixDomainSocketAddress` chegaram com a JEP 380 no **JDK 16**, e Windows 10 / Windows Server 2019 e posteriores também os suportam, então isso não é código exclusivo de Unix, apesar do nome.

### Unix domain sockets: o lado cliente

```java
UnixDomainSocketAddress address = UnixDomainSocketAddress.of(Path.of("/tmp/jcb-demo.socket"));

try (SocketChannel channel = SocketChannel.open(StandardProtocolFamily.UNIX)) {
    channel.connect(address);
    ByteBuffer buffer = ByteBuffer.wrap("Hello via a Unix domain socket"
            .getBytes(StandardCharsets.UTF_8));
    while (buffer.hasRemaining()) {
        channel.write(buffer);          // write() may be partial — loop until drained
    }
}
```

A API de channel é orientada a buffer, não a `String`, mas você não precisa ficar preso a isso: `java.nio.channels.Channels` adapta um channel para as classes de stream/reader já conhecidas, o que é o que torna prático falar um protocolo de texto sobre um Unix socket.

```java
import java.nio.channels.Channels;

try (SocketChannel channel = SocketChannel.open(StandardProtocolFamily.UNIX)) {
    channel.connect(UnixDomainSocketAddress.of(Path.of("/var/run/docker.sock")));

    var out = new PrintWriter(new OutputStreamWriter(
            Channels.newOutputStream(channel), StandardCharsets.US_ASCII));
    out.print("GET /_ping HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    out.flush();

    var in = new BufferedReader(new InputStreamReader(
            Channels.newInputStream(channel), StandardCharsets.UTF_8));
    in.lines().forEach(System.out::println);
}
// HTTP/1.1 200 OK
// Content-Type: application/json
// Content-Length: 15
//
// {"status":"OK"}
```

É exatamente assim que ferramentas conversam com o daemon do Docker: HTTP/1.1 puro, escrito à mão sobre um Unix socket, porque `java.net.http.HttpClient` não tem como aceitar um `UnixDomainSocketAddress` — sua API é construída em torno de uma `URI` com host e porta.

### O arquivo do socket é um arquivo de verdade, com ciclo de vida e permissões de verdade

```java
var serverChannel = ServerSocketChannel.open(StandardProtocolFamily.UNIX);
serverChannel.bind(UnixDomainSocketAddress.of(socketPath));
serverChannel.close();
System.out.println(Files.exists(socketPath));   // true — close() does NOT delete the file
```

Vincule de novo ao mesmo caminho sem deletá-lo e você recebe uma `BindException`, que é o equivalente do Unix socket a "porta já em uso", mas com um arquivo obsoleto em vez de um processo vivo por trás:

```
java.net.BindException: Address already in use
```

Então um servidor de Unix socket precisa de `Files.deleteIfExists(socketPath)` antes de vincular, e idealmente de um shutdown hook para se limpar depois. Mais dois fatos no nível de arquivo importam:

```java
// default permissions come from the process umask — often world-readable/writable-adjacent
Files.getPosixFilePermissions(socketPath);            // e.g. rwxr-xr-x
Files.setPosixFilePermissions(socketPath, PosixFilePermissions.fromString("rw-------"));
```

```java
serverChannel.bind(UnixDomainSocketAddress.of("/tmp/" + "x".repeat(200) + ".sock"));
// java.net.SocketException: Unix domain path too long
```

Controle de acesso *é* permissões de sistema de arquivos — o arquivo de socket criado por `bind()` herda o umask, então aperte-o (ou coloque o socket em um diretório que só os peers pretendidos consigam atravessar) em vez de assumir que ele já é privado. E o caminho tem um comprimento máximo específico da plataforma, documentado como "tipicamente próximo de, e geralmente não menor que, 100 bytes"; diretórios temporários profundos mais um nome longo vão bater nesse limite.

### Identificando o peer: sem endereço, mas com uma identidade de SO

```java
try (SocketChannel channel = serverChannel.accept()) {
    System.out.println("remote = '" + channel.getRemoteAddress() + "'");   // remote = ''
}
```

Um channel de Unix socket aceito reporta um endereço de peer **sem nome** (um caminho vazio), porque um cliente conectando normalmente nunca vincula um caminho próprio — não existe um equivalente a `getInetAddress()` para logar ou autorizar. O que você recebe em vez disso é melhor: a visão do kernel sobre como o processo peer roda, via uma opção de socket específica do JDK no módulo `jdk.net`:

```java
import jdk.net.ExtendedSocketOptions;
import jdk.net.UnixDomainPrincipal;

UnixDomainPrincipal peer = channel.getOption(ExtendedSocketOptions.SO_PEERCRED);
System.out.println(peer);
// UnixDomainPrincipal[user=alexandrocastro, group=staff]
```

`SO_PEERCRED` produz um `UnixDomainPrincipal` que nomeia o usuário e o grupo do peer como o SO os vê — uma identidade que o cliente não pode forjar, motivo pelo qual daemons locais comumente autorizam por permissões de socket mais credenciais de peer, em vez de por token. É específico do JDK e dependente de plataforma (disponível em plataformas cujo kernel suporta credenciais de peer, conforme a exceção explícita da JEP 380 aos seus próprios não-objetivos), então proteja-se contra `UnsupportedOperationException`.

### Um último risco: `SocketAddress` já não é sempre `InetSocketAddress`

```java
InetSocketAddress addr = (InetSocketAddress) serverChannel.getLocalAddress();
// java.lang.ClassCastException: class java.net.UnixDomainSocketAddress
//   cannot be cast to class java.net.InetSocketAddress
```

Código escrito antes do JDK 16 rotineiramente faz cast do `SocketAddress` retornado por `getLocalAddress()`/`getRemoteAddress()` direto para `InetSocketAddress`, porque essa era a única possibilidade. A JEP 380 lista isso como seu principal risco de compatibilidade. O conserto é um pattern match em vez de um cast:

```java
String describe(SocketAddress address) {
    return switch (address) {
        case InetSocketAddress inet -> inet.getHostString() + ":" + inet.getPort();
        case UnixDomainSocketAddress unix -> "unix:" + unix.getPath();
        case null -> "unbound";
        default -> address.toString();
    };
}
```

## Trade-offs

- **Thread-por-conexão é simples e agora barato, mas ainda é uma stack por conexão viva.** Virtual threads movem o teto de milhares para um número bem maior, e leituras bloqueantes deixam de ser desperdício — mas cada conexão ainda mantém a stack de uma virtual thread e o file descriptor do seu socket, então `ulimit -n` e memória, em vez de contagem de threads, se tornam o limite.
```java
// 3 concurrent clients, handler sleeps 500ms:
// handle(client) inline in the accept loop          -> ~1522 ms
// pool.submit(() -> handle(client)), virtual threads -> ~505 ms
```
- **NIO não-bloqueante com `Selector` escala mais e custa muito mais para escrever.** Ele remove por completo a thread por conexão, mas cada handler vira uma máquina de estados sobre leituras e escritas parciais, sem fluxo de controle linear — uma troca de verdade, não um upgrade grátis, e raramente vale a pena fazer à mão agora que virtual threads bloqueantes existem.
- **Ajuste de backlog é um chute nos dois sentidos.** Pequeno demais e rajadas de clientes recebem recusas de conexão durante um handler lento; grande demais e o kernel enfileira conexões cujos clientes já deram timeout, então o servidor faz trabalho que ninguém está esperando. A documentação enquadra isso exatamente como um compromisso entre uso de recursos e throughput, sem um número recomendado.
- **Unix domain sockets são mais rápidos e mais seguros que TCP loopback, e estritamente locais — o que é ao mesmo tempo o recurso e o limite.** A JEP 380 cita configuração mais rápida, throughput maior e controle de acesso ao sistema de arquivos garantido pelo SO. As mesmas propriedades significam que, no momento em que um lado se muda para outro host ou outro namespace de rede, o transporte precisa mudar; não existe migração "mesmo código, endereço diferente" para TCP, porque o próprio tipo de endereço é diferente.
- **O arquivo de socket sobreviver ao processo é uma armadilha operacional real, ao contrário de uma porta TCP.** Um servidor que crasha deixa o arquivo para trás e o restart falha com `BindException`, mesmo que nada esteja escutando.
```java
Files.deleteIfExists(socketPath);   // required before bind() — close() never removes it
serverChannel.bind(UnixDomainSocketAddress.of(socketPath));
```
- **As permissões padrão do arquivo de socket vêm do umask, então "protegido pelo sistema de arquivos" só é verdade depois que você o torna verdadeiro.**
```java
Files.getPosixFilePermissions(socketPath);   // rwxr-xr-x straight after bind()
```
- **Boa parte do ecossistema ainda assume host-e-porta.** `java.net.http.HttpClient`, URLs de JDBC e a maioria das bibliotecas cliente recebem uma `URI` ou par host/porta, sem lugar para um caminho de sistema de arquivos, então usar um Unix socket costuma significar descer para I/O de channel bruto (ou uma biblioteca que explicitamente suporte isso), mesmo para um protocolo tão comum quanto HTTP.
- **Credenciais de peer são uma opção específica do JDK e dependente de plataforma.** `ExtendedSocketOptions.SO_PEERCRED` exige o módulo `jdk.net` e suporte do kernel; código que depende disso precisa de um fallback para plataformas onde `getOption` lança `UnsupportedOperationException`.

## Documentation Links

- [ServerSocket — java.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/ServerSocket.html) — doc
- [NetworkInterface — java.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/NetworkInterface.html) — doc
- [UnixDomainSocketAddress — java.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/UnixDomainSocketAddress.html) — doc
- [StandardProtocolFamily — java.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/net/StandardProtocolFamily.html) — doc
- [ServerSocketChannel — java.nio.channels API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/ServerSocketChannel.html) — doc
- [SocketChannel — java.nio.channels API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/SocketChannel.html) — doc
- [ExtendedSocketOptions — jdk.net API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.net/jdk/net/ExtendedSocketOptions.html) — doc
- [JEP 380: Unix-Domain Socket Channels](https://openjdk.org/jeps/380) — doc
