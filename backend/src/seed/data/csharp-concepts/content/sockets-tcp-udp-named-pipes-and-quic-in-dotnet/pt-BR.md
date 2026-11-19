---
version: 1.0
updatedAt: 2026-11-19
title: "Sockets TCP e UDP, Named Pipes e QUIC no .NET"
summary: Socket, TcpListener e TcpClient, TCP como fluxo de bytes sem fronteira, enquadramento por prefixo de tamanho, NoDelay, backlog, fechamento e reset, timeouts, UDP, named pipes, Unix domain sockets e System.Net.Quic, tudo medido em loopback no macOS.
---
## Objective

O `HttpClient` e o Kestrel ficam em cima de sockets. Quando você escreve o seu
próprio protocolo (um RPC binário, um log replicado, um lab de sistemas
distribuídos), trabalha no nível de baixo, e este conceito mede o que ele
entrega. TCP é um fluxo de bytes sem fronteira de mensagem, então todo protocolo
precisa de enquadramento. Fechar, resetar, estourar tempo e ser recusado
aparecem cada um como uma exceção específica ou como uma leitura de zero bytes.
UDP preserva a fronteira do datagrama e não promete mais nada. Named pipes e
Unix domain sockets são as alternativas locais, e o `System.Net.Quic` tem um
requisito de plataforma que decide se você consegue usá-lo. Tudo rodou em
loopback, no macOS.

Versões: .NET SDK 10.0.100, TFM `net10.0`, nenhum pacote NuGet (só o shared
framework), macOS arm64.

## Use Cases

- Um protocolo binário próprio entre dois serviços seus, sem o custo do HTTP.
- Um lab de sistemas distribuídos (chave-valor, peer Raft, gossip) sobre TCP e
  UDP.
- Um sidecar local falando com o processo principal por named pipe ou Unix
  domain socket em vez de uma porta TCP.

## Deep Dive

### Três níveis: Socket, TcpListener/TcpClient, NetworkStream

`TcpListener` e `TcpClient` embrulham o `Socket` e entregam um `NetworkStream`,
um `Stream` comum (veja o concept da hierarquia de Stream). Fique nesse nível
enquanto só conecta, aceita, lê e escreve. Desça para o `Socket`
(`tcpClient.Client`) para o que os wrappers escondem: `Shutdown`,
`Listen(backlog)`, `SetSocketOption`, UDP, Unix domain sockets e
`SendAsync`/`ReceiveAsync` sobre `Memory<byte>`.

### TCP é um fluxo de bytes, não de mensagens

Um cliente escreveu `HEL`, `LO-`, `WORLD` com pausas de 50 ms, depois `A`, `B`,
`C` seguidos. O servidor leu com um buffer de 1024 bytes:

```text
read 1: 3 bytes "HEL"
read 2: 3 bytes "LO-"
read 3: 5 bytes "WORLD"
read 4: 2 bytes "AB"
read 5: 1 bytes "C"
```

Os pedaços chegaram separados e `A`, `B` vieram juntos. Com o servidor dormindo
400 ms antes da primeira leitura, as seis escritas chegaram numa só:
`read 1: 14 bytes "HELLO-WORLDABC"`. Uma leitura devolve o que o kernel tiver,
então "um `Write` igual a um `Read`" é um bug que só aparece sob carga ou em
link lento.

### Enquadramento por prefixo de tamanho

A solução é um protocolo: 4 bytes de tamanho, depois o corpo, lido com
`ReadExactlyAsync` (repete por dentro e lança `EndOfStreamException` se o par
fechar antes):

```csharp
var hdr = new byte[4];
await s.ReadExactlyAsync(hdr);
var len = BinaryPrimitives.ReadInt32BigEndian(hdr);
var body = new byte[len];
await s.ReadExactlyAsync(body);
```

Três frames enviados em pedaços de 5 bytes, então os cortes caíram dentro de
cabeçalhos e corpos:

```text
frame (3 bytes): one
frame (14 bytes): second message
frame (1 bytes): 3
ReadExactlyAsync: EndOfStreamException at frame boundary
```

A última linha é um fim limpo (fechou entre frames); a mesma exceção no meio de
um frame indica mensagem truncada. O mesmo parse com `PipeReader.Create(stream)`
fatia o `ReadOnlySequence<byte>` sem copiar e chama
`AdvanceTo(buffer.Start, buffer.End)` quando o frame está incompleto; imprimiu
os mesmos três frames. Valide sempre `len` contra um máximo antes de alocar: um par
que mande `0x7FFFFFFF` não pode fazer você alocar 2 GB.

### NoDelay (Nagle) e mensagens pequenas

O algoritmo de Nagle segura um segmento pequeno enquanto o anterior não foi
confirmado. A armadilha clássica é escrever-escrever-ler. 30 idas e voltas com
duas escritas de 1 byte e uma resposta de 1 byte:

```text
NoDelay=False: median 0.09 ms, max 0.17 ms
NoDelay=True: median 0.09 ms, max 0.14 ms
```

Nenhuma diferença visível no loopback do macOS. O atraso vem do ACK atrasado do
receptor e costuma ser descrito como dezenas de milissegundos em links reais
(não medido aqui). A regra continua: para mensagens pequenas de requisição e
resposta, use `NoDelay = true` e escreva cada mensagem num buffer só.

### Backlog: quando o accept não acompanha

`Listen(1)` e nenhum `Accept`, seis clientes conectando com timeout de 1,5 s:

```text
client 0: connected after 0 ms
client 1: ConnectionReset
connected 1, failed 5 with Listen(1) and no Accept
```

Os clientes 2 a 5 também receberam `ConnectionReset`. Outras três execuções
conectaram 5, 2 e 1 clientes (o backlog é só uma dica). O estável é o modo de
falha no macOS: `ConnectionReset` imediato, não trava. O Linux é descrito como
descartando o SYN, e o cliente trava até o timeout (não medido aqui). Nos dois
casos: aceite num laço apertado, uma task por conexão, e dimensione o backlog
(`TcpListener.Start(backlog)`) para rajadas.

### Fechar: Shutdown, Close e a leitura de zero bytes

```text
server read after client Shutdown(Send): 0
client can still read after its own Shutdown(Send): 2 bytes
client read after server Close: 0
```

`Shutdown(SocketShutdown.Send)` envia um FIN: a leitura do par devolve 0, mas
você ainda recebe ("sem mais requisições, mande o resto"). `Close`/`Dispose`
fecha as duas direções e libera o descritor. Ler 0 é o fim normal do fluxo, não
um erro. Depois do half-close, `TcpClient.Connected` ficou falso e
`GetStream()` lançou exceção, então pegue o stream antes.

### Reset e as exceções reais

Um fechamento abortivo (`LingerState = new LingerOption(true, 0)`) envia um RST
e a leitura do par lança `IOException` com interna `ConnectionReset`. Uma porta
sem ninguém ouvindo dá `ConnectionRefused`. Escrever para um par que fechou com
dados não lidos deu interna `SocketError.Shutdown` (mensagem do SO "Broken
pipe"; a leitura dele tinha devolvido 0 antes). No `NetworkStream` a
`SocketException` vem embrulhada numa `IOException`, então olhe a
`InnerException`; o `Socket` puro lança a exceção direta. Registre o
`SocketErrorCode`, não o texto da mensagem.

### Timeouts e cancelamento

Um token de 300 ms cancelou a leitura em 301 ms; um `ReceiveTimeout` de 200 ms
numa leitura síncrona lançou exceção em 201 ms. Passe um `CancellationToken` (`new CancellationTokenSource(300)` para um prazo)
para `ReadAsync`, `ConnectAsync` ou `ReceiveAsync`: ele lança
`OperationCanceledException`. `ReceiveTimeout`/`SendTimeout` valem para chamadas
síncronas e aparecem como `SocketError.TimedOut`. Uma leitura cancelada no meio
de um frame deixa o fluxo numa posição desconhecida: feche a conexão.

### UDP: fronteira preservada, entrega não garantida

Datagramas de 1, 2 e 3 bytes saíram como três recebimentos de exatamente 1, 2 e
3 bytes: a fronteira é preservada. Apareceram dois limites:

```text
100-byte datagram into 10-byte buffer: Receive returned 10, rest discarded; Available now 0
70000 bytes: MessageSize
```

Um buffer pequeno trunca em silêncio aqui (sem exceção), e 70000 bytes passam
do limite do UDP. Para provocar perda, o receptor usou `ReceiveBufferSize =
8192` e não leu enquanto o emissor disparava 2000 datagramas de 1000 bytes:

```text
ReceiveBufferSize requested 8192, effective 8192
sent 2000, received 7, dropped 1993; first 0, last 6, in order: True
```

Os 2000 `Send` deram certo e 1993 sumiram sem erro nos dois lados. A ordem foi
mantida porque o loopback tem um caminho só; reordenação exige rede real e não
foi medida (limitação). Um protocolo UDP precisa dos próprios números de
sequência, confirmações e retentativas.

### Named pipes e Unix domain sockets no macOS

Os dois funcionam no .NET 10 no macOS. Um eco com `NamedPipeServerStream` e
`NamedPipeClientStream` levou 1 ms incluindo a conexão. No Unix, o .NET
implementa named pipes sobre Unix domain sockets: apareceu um arquivo
`CoreFxPipe_<nome>` no diretório temporário (a doc descreve pipes reais do
kernel no Windows). Um `Socket` com `UnixDomainSocketEndPoint` também funcionou:

```text
bind again on same path: AddressAlreadyInUse
file exists after Dispose: False
```

O arquivo é o endereço: existe enquanto ligado e foi removido no dispose
(depois de um crash pode ficar, então apague um arquivo velho antes do bind).
Idas e voltas de 1 byte, 20000 iterações após aquecimento, TCP com `NoDelay`:

```text
TCP loopback ping-pong: 35.1 us/round trip
Unix socket ping-pong: 10.3 us/round trip
Named pipe ping-pong: 9.9 us/round trip
```

Os transportes locais foram mais de 3 vezes mais rápidos e não abrem porta
(use permissões de arquivo), mas só alcançam a mesma máquina (named pipes do
Windows também cruzam a rede, segundo o how-to: docs only).

### QUIC

```text
QuicConnection.IsSupported = False; QuicListener.IsSupported = False
```

Não usável neste macOS. A doc diz que o `System.Net.Quic` embrulha o MsQuic:
embutido no .NET no Windows 11 e Windows Server 2022 ou posterior, `libmsquic`
(2.2+) instalada por você no Linux e um build manual do MsQuic nos demais, fora
da matriz testada. A API é estável desde o .NET 9. O resto é docs only, não
rodou: cheque `IsSupported` primeiro, QUIC exige TLS 1.3 e um protocolo ALPN,
`QuicListener.ListenAsync` aceita conexões e cada `QuicConnection` abre muitos
`QuicStream`s independentes (o HTTP/3 é construído sobre isso).

### Pontes: sistemas operacionais e sistemas distribuídos

Um socket é um descritor de arquivo, e os bytes ficam em buffers do kernel entre
o seu `Write` e o `Read` do par: os datagramas perdidos foram esse buffer
estourando, e o backpressure do TCP é ele enchendo. Em
sistemas distribuídos, um RPC escrito à mão precisa de enquadramento, de um
timeout em cada chamada e de operações idempotentes, porque depois de um
timeout quem chamou não sabe se o servidor executou o pedido, então a
retentativa precisa ser segura.

## Trade-offs

- **Controle versus HTTP.** Um protocolo cru não traz enquadramento, auth nem
  TLS de graça. Use se você controla as duas pontas, senão `HttpClient` ou gRPC.
- **TCP versus UDP.** TCP dá ordem e entrega; UDP dá fronteira e baixa latência,
  e você reconstrói a confiabilidade (1993 de 2000 perdidos em silêncio acima).
- **NoDelay troca banda por latência.** Certo para requisição e resposta,
  desperdício para dados em massa. Efeito medido aqui: nenhum no loopback do
  macOS.
- **Transportes locais versus TCP.** Mais de 3 vezes mais rápidos por ida e
  volta e sem porta, mas só na mesma máquina, e o arquivo do socket precisa de
  limpeza.
- **QUIC não existe em todo lugar.** No Linux exige `libmsquic`; proteja com
  `QuicConnection.IsSupported` e mantenha um fallback em TCP.
- **As falhas variam por SO.** Um backlog cheio foi `ConnectionReset` no macOS e
  é descrito como trava no Linux: teste os caminhos de falha no SO de destino.

## Documentation Links

- [Use Sockets to send and receive data over TCP, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/sockets/socket-services) (doc)
- [TCP/UDP classes overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/sockets/tcp-classes) (doc)
- [Sockets overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/sockets/sockets-overview) (doc)
- [QUIC support in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/networking/quic/quic-overview) (doc)
- [How to use named pipes for network interprocess communication, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/io/how-to-use-named-pipes-for-network-interprocess-communication) (doc)
- [Socket.Shutdown, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.sockets.socket.shutdown) (doc)
- [UnixDomainSocketEndPoint, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.sockets.unixdomainsocketendpoint) (doc)
- [QuicConnection.IsSupported, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.net.quic.quicconnection.issupported) (doc)
