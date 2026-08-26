---
version: 1.0
updatedAt: 2026-08-21
title: "NIO Channels e Buffers: O Modelo de I/O Não Bloqueante"
summary: Explica o modelo de Channel orientado a buffer em java.nio.channels, cobrindo o estado do ByteBuffer, buffers diretos vs. heap, zero-copy e I/O mapeado em memória do FileChannel, sockets não bloqueantes, e leituras/escritas scatter/gather.
---
## Objective

`java.nio.channels` e `java.nio.ByteBuffer` são a camada abaixo tanto da API de alto nível `Path`/`Files` (`nio2-path-and-files-api`) quanto dos sockets bloqueantes clássicos cobertos em `sockets-and-raw-http-anatomy`. Onde um `InputStream`/`OutputStream` clássico é unidirecional e move dados um byte (ou array de bytes) por vez, um `Channel` é bidirecional e sempre move dados para dentro ou para fora de um `ByteBuffer` — um bloco de memória de tamanho fixo com seu próprio cursor de leitura/escrita. Essa é a real mudança: I/O deixa de ser "puxe o próximo byte" e vira "encha esse buffer, depois esvazie-o", que é o que torna possível leituras não bloqueantes, transferências zero-copy e arquivos mapeados em memória.

## Use Cases

- Copiar ou encaminhar arquivos grandes (envio de logs, proxies de upload) onde `FileChannel.transferTo` evita copiar bytes passando pelo user-space por completo.
- Analisar ou indexar um arquivo grande sem carregá-lo inteiro em um `byte[]`, via um `MappedByteBuffer` mapeado em memória que deixa o SO paginá-lo sob demanda.
- Escrever um servidor ou cliente TCP de baixo nível e alta vazão que não pode se dar ao luxo de uma thread de SO bloqueada por conexão — o ponto de entrada para o qual channels não bloqueantes existem, antes de um `Selector` ser adicionado por cima (veja `jvm-concepts` → `nio-servers-and-async` para o tratamento completo do event-loop).
- Ler um protocolo binário cujo cabeçalho e payload são buffers separados, usando `read`/`write` scatter/gather em vez de concatenar arrays de bytes manualmente.
- Escolher entre buffers de heap e diretos quando o profiling mostra pressão de GC ou overhead de cópia em um caminho de I/O quente.

## Deep Dive

### Channel vs. Stream: um modelo mental diferente, não só um novo nome de classe

Um par `InputStream`/`OutputStream` é unidirecional: um objeto lê, outro objeto diferente escreve, e ambos movem bytes brutos sob demanda. Um `Channel` é um único objeto que pode ser lido *e* escrito, e nunca entrega um byte diretamente — ele sempre enche ou esvazia um `ByteBuffer` que você fornece:

```java
// classic stream: pull one array's worth of bytes at a time
try (InputStream in = new FileInputStream("data.bin")) {
    byte[] arr = new byte[1024];
    int n = in.read(arr);
}

// channel: the channel writes into a buffer you own and control
try (FileChannel channel = FileChannel.open(Path.of("data.bin"), StandardOpenOption.READ)) {
    ByteBuffer buf = ByteBuffer.allocate(1024);
    int n = channel.read(buf); // fills buf, returns bytes read or -1 at EOF
}
```

O buffer, não o channel, rastreia onde você está nos dados — motivo pelo qual entender o estado interno do `ByteBuffer` é o verdadeiro pré-requisito para usar channels corretamente.

### Os quatro marcadores do ByteBuffer: capacity, position, limit, mark

Todo `Buffer` (não só `ByteBuffer`) rastreia quatro índices em seu armazenamento subjacente:

- `capacity` — o tamanho fixo do buffer, definido na criação, nunca muda.
- `position` — onde a próxima leitura ou escrita acontece; avança após cada operação.
- `limit` — o primeiro índice que não pode ser lido ou escrito; para um buffer recém-alocado isso é igual a `capacity`.
- `mark` — uma posição salva para a qual você pode voltar com `reset()`; não definida até você chamar `mark()`.

```java
ByteBuffer buf = ByteBuffer.allocate(10);
System.out.println(buf.capacity()); // 10
System.out.println(buf.position()); // 0
System.out.println(buf.limit());    // 10

buf.put((byte) 1).put((byte) 2).put((byte) 3);
System.out.println(buf.position()); // 3 — advanced by each put()
System.out.println(buf.limit());    // 10 — unchanged, still write-mode
```

### O ciclo flip/clear/compact — e o bug clássico de esquecer flip()

Um buffer está sempre em um de dois modos implícitos: **modo escrita** (enchê-lo até `limit`) ou **modo leitura** (esvaziá-lo até `limit`). `flip()` alterna de escrita para leitura definindo `limit = position` e `position = 0` — esse é o passo fácil de esquecer:

```java
// the bug: writing, then trying to read without flipping first
ByteBuffer buf = ByteBuffer.allocate(10);
buf.put((byte) 65).put((byte) 66).put((byte) 67); // position=3, limit=10

byte[] out = new byte[3];
buf.get(out); // reads from position 3 onward — past what was written!
// no exception here necessarily, but the bytes read are garbage (zeros),
// not the 65/66/67 just written
```

```java
// fixed: flip() before reading
ByteBuffer buf = ByteBuffer.allocate(10);
buf.put((byte) 65).put((byte) 66).put((byte) 67);
buf.flip();                    // limit=3 (old position), position=0
byte[] out = new byte[3];
buf.get(out);                  // reads exactly the 3 bytes written: 65, 66, 67
```

`clear()` volta o buffer para o modo escrita completo (`position = 0`, `limit = capacity`) *sem* preservar dados não lidos — o que ainda não foi consumido é simplesmente sobrescrito pelas próximas escritas. `compact()` é a alternativa mais segura quando uma leitura foi parcial: ele desloca os bytes não lidos (de `position` até `limit`) para o índice 0, define `position` como o número de bytes movidos, e define `limit = capacity`, pronto para mais escritas sem perder o que ainda não foi consumido:

```java
buf.flip();          // read mode
buf.get();           // consume 1 byte, 2 remain unread
buf.compact();        // the 2 unread bytes move to index 0; position=2, limit=capacity
// buf is back in write mode, with the leftover bytes preserved at the front
```

### Buffers de heap vs. buffers diretos

`ByteBuffer.allocate(n)` cria um **buffer de heap**, apoiado em um array de bytes da JVM; `ByteBuffer.allocateDirect(n)` cria um **buffer direto**, apoiado em memória alocada fora do heap da JVM:

```java
ByteBuffer heap   = ByteBuffer.allocate(4096);        // fast to allocate, lives on the Java heap
ByteBuffer direct = ByteBuffer.allocateDirect(4096);   // slower to allocate, lives in native memory
```

O SO consegue entregar a operações de I/O nativas o endereço de um buffer direto e ler/escrever diretamente nele; um buffer de heap, como pode ser movido pelo garbage collector, precisa ser copiado para um buffer nativo temporário pela JVM antes que uma system call possa usá-lo, e copiado de volta nas leituras. A alocação de buffer direto é comparativamente cara (ela não é recuperada da mesma forma que objetos comuns — muitas vezes só é liberada quando uma GC completa roda, embora `isDirect()` não diga nada sobre *quando*) e sua memória não é agrupada em pool por padrão, então eles valem a pena para buffers grandes, reutilizados repetidamente (um loop de cópia de `FileChannel`), ou mantidos por muito tempo — não para buffers pequenos e de vida curta, onde o overhead de alocação supera a cópia que ele evita.

```java
System.out.println(ByteBuffer.allocate(10).isDirect());       // false
System.out.println(ByteBuffer.allocateDirect(10).isDirect()); // true
```

### FileChannel: lendo, escrevendo e transferência zero-copy

`FileChannel` abre um arquivo para I/O baseado em channel e, diferente de um stream, suporta acesso aleatório via `position(long)`:

```java
try (FileChannel channel = FileChannel.open(Path.of("data.bin"),
        StandardOpenOption.READ, StandardOpenOption.WRITE)) {
    ByteBuffer buf = ByteBuffer.allocate(256);
    int read = channel.read(buf);   // reads at the current file position
    channel.position(0);            // seek back to the start
}
```

`transferTo`/`transferFrom` movem bytes diretamente entre dois channels — tipicamente arquivo-para-socket ou arquivo-para-arquivo — sem nunca copiar os dados por um buffer visível ao Java, motivo pelo qual isso é chamado de zero-copy:

```java
try (FileChannel source = FileChannel.open(Path.of("large-upload.bin"), StandardOpenOption.READ);
     SocketChannel destination = SocketChannel.open(new InetSocketAddress("host", 8080))) {
    long size = source.size();
    long transferred = 0;
    while (transferred < size) {
        transferred += source.transferTo(transferred, size - transferred, destination);
    }
}
```

A JVM delega isso, onde o SO suporta, a uma operação em nível de kernel (ex.: `sendfile` no Linux) — os dados nunca cruzam para a memória Java em user-space, o que é o que torna isso mais rápido que um loop manual de ler-para-buffer/escrever-de-buffer para arquivos grandes.

### Arquivos mapeados em memória: tratando um arquivo como um array de bytes

`FileChannel.map()` pede ao SO para mapear uma região de um arquivo diretamente no espaço de endereçamento do processo, retornado como um `MappedByteBuffer`; ler ou escrever nesse buffer lê ou escreve o arquivo, com o SO paginando os dados sob demanda em vez do programa emitir chamadas explícitas de `read`/`write`:

```java
try (FileChannel channel = FileChannel.open(Path.of("big-index.dat"),
        StandardOpenOption.READ, StandardOpenOption.WRITE)) {
    MappedByteBuffer mapped = channel.map(FileChannel.MapMode.READ_WRITE, 0, channel.size());
    byte firstByte = mapped.get(0);      // a memory read, not an explicit syscall per access
    mapped.put(0, (byte) 42);            // written back to the file by the OS, on its own schedule
}
```

Isso compensa para arquivos grandes acessados de forma aleatória ou repetida (um arquivo de índice de banco de dados, um blob binário grande varrido muitas vezes) porque o page cache do SO faz o trabalho de decidir o que fica residente, evitando tanto uma cópia completa em memória quanto uma sequência tagarela de pequenas chamadas `read`. É uma escolha ruim para um arquivo lido uma vez do início ao fim — uma leitura simples com stream bufferizado é mais simples e igualmente rápida nesse caso — e o unmapping não é totalmente determinístico em JDKs mais antigos (`MappedByteBuffer` não tem `close()`/`unmap()` explícito; o mapeamento é liberado quando o buffer é coletado pelo garbage collector, embora as APIs mais novas de `java.lang.foreign` ofereçam controle mais determinístico fora do próprio `java.nio`).

### SocketChannel / ServerSocketChannel: modo não bloqueante

`SocketChannel` e `ServerSocketChannel` são as contrapartes baseadas em channel de `Socket`/`ServerSocket` (`sockets-and-raw-http-anatomy`), e o motivo pelo qual existem é `configureBlocking(false)`: um socket que pode ser instruído a não esperar quando ainda não há nada a fazer.

```java
ServerSocketChannel server = ServerSocketChannel.open();
server.bind(new InetSocketAddress(8350));
server.configureBlocking(false);

SocketChannel client = server.accept(); // returns immediately: a SocketChannel, or null if none waiting
```

```java
SocketChannel channel = SocketChannel.open();
channel.configureBlocking(false);
channel.connect(new InetSocketAddress("localhost", 8350)); // returns immediately, connection in progress

ByteBuffer buf = ByteBuffer.allocate(256);
int n = channel.read(buf); // returns immediately: 0 if no data is available yet, not a block
```

Essa última linha é a diferença comportamental chave em relação a um socket bloqueante: `read()` em um channel não bloqueante sem nada para ler retorna `0` imediatamente em vez de estacionar a thread, e `accept()` em um channel de servidor não bloqueante retorna `null` em vez de esperar por uma conexão. Fazer polling de cada channel em um loop para ver qual tem dados funciona, mas desperdiça CPU, motivo exato pelo qual channels não bloqueantes são quase sempre combinados com um `Selector` — uma única thread que bloqueia eficientemente em *muitos* channels ao mesmo tempo e só acorda quando um deles está de fato pronto. Esse mecanismo (registrar channels, selection keys, o event loop) é coberto em profundidade no conceito `nio-servers-and-async` do módulo `jvm-concepts`; este conceito para na camada channel/buffer sobre a qual o selector se apoia.

### Scatter/gather I/O: uma chamada, muitos buffers

Sobrecargas de `read`/`write` que recebem um `ByteBuffer[]` permitem que um channel encha (scatter) ou esvazie (gather) um array inteiro de buffers em uma única chamada, em ordem:

```java
ByteBuffer header  = ByteBuffer.allocate(16);  // fixed-size header
ByteBuffer payload = ByteBuffer.allocate(1024); // variable-size payload
ByteBuffer[] buffers = { header, payload };

channel.read(buffers); // fills header completely before spilling into payload

// later, to send both back out in one call:
header.flip();
payload.flip();
channel.write(buffers); // drains header, then payload, in order
```

Isso evita fatiar manualmente um buffer grande em uma região de cabeçalho e uma região de payload — cada parte da mensagem tem seu próprio buffer, e o channel cuida de enchê-los/esvaziá-los em sequência.

## Trade-offs

- **Buffers são stateful e mutáveis, o que torna esquecer `flip()`/`clear()` uma classe real de bug** — o mesmo objeto buffer se comporta silenciosamente de forma diferente dependendo de sua position/limit, diferente de uma leitura de stream imutável.
```java
buf.put((byte) 1);
buf.get(); // returns 0, not 1 — read happens from position 1 onward, past what was written
```
- **Buffers diretos trocam custo de alocação por velocidade de I/O** — vale a pena para buffers grandes ou reutilizados em muitas chamadas de I/O, uma perda líquida para buffers pequenos, de vida curta ou raramente reutilizados, onde o overhead de alocação domina.
- **O zero-copy de `transferTo`/`transferFrom` só entra em ação quando o SO e os tipos de channel o suportam** — caso contrário, ele degrada graciosamente para um loop de cópia comum, então é uma oportunidade de performance, não um comportamento garantido para depender por correção.
- **Arquivos mapeados em memória abrem mão de limpeza determinística** — não existe um `unmap()` direto em `java.nio`; o mapeamento é liberado na coleta de lixo do `MappedByteBuffer`, o que pode deixar o mapeamento de um arquivo (e, em algumas plataformas, um estado de exclusão pendente) vivo por mais tempo do que o código que o usou esperaria.
- **O modo não bloqueante sozinho não resolve concorrência — ele apenas evita bloqueio** — ler em um loop apertado sem um `Selector` queima CPU fazendo polling de channels que não têm nada pronto; o retorno dos channels não bloqueantes só aparece quando um selector (ou um reactor equivalente) os está conduzindo.
- **Scatter/gather ajuda no enquadramento de mensagens, mas não o valida** — passar buffers na ordem errada ou com os tamanhos errados lê/escreve dados silenciosamente desalinhados; a API garante a ordem de enchimento/esvaziamento, não que os limites correspondam ao protocolo real.

## Documentation Links

- [ByteBuffer — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html) — doc
- [FileChannel — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileChannel.html) — doc
- [SocketChannel — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/SocketChannel.html) — doc
- [ServerSocketChannel — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/ServerSocketChannel.html) — doc
- [MappedByteBuffer — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/MappedByteBuffer.html) — doc
