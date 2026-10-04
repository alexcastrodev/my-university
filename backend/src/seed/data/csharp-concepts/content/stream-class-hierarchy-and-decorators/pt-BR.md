---
version: 1.0
updatedAt: 2026-10-04
title: "Hierarquia de Stream e Decorators"
summary: Stream como abstração de arquivos, memória e rede, decorators como BufferedStream e GZipStream, leaveOpen e quem faz Dispose, Read que devolve menos bytes que o pedido, Seek e acesso assíncrono a arquivos.
---
## Objective

`System.IO.Stream` é a abstração única por trás de arquivos, buffers em memória,
sockets de rede, pipes e compressão. Código escrito contra `Stream` funciona com
todos eles, e wrappers (decorators) acrescentam comportamento guardando outro
stream: um `GZipStream` comprime o que embrulha, um `BufferedStream` agrupa
leituras e escritas pequenas. O modelo é pequeno, mas esconde quatro armadilhas
que causam bugs reais: um `Read` que devolve menos bytes do que você pediu, um
decorator que fecha o stream de que você ainda precisava, um wrapper que nunca
foi descarregado (flush) e uma chamada assíncrona num arquivo aberto para acesso
síncrono. Este conceito cobre a hierarquia, a cadeia de decorators e como posse
e descarte funcionam através dela.

## Use Cases

- Ler de um arquivo ou socket um cabeçalho de tamanho fixo e ter certeza de que
  veio inteiro.
- Comprimir um payload em memória com `GZipStream` e depois ler os bytes de
  volta.
- Escrever texto num stream que você não possui (o corpo de uma resposta HTTP,
  um stream de rede) sem fechá-lo ao terminar.
- Ler um arquivo grande de forma assíncrona sem bloquear uma thread do pool a
  cada chamada.
- Decidir se um stream pode ser rebobinado (`Seek`) ou só pode ser consumido uma
  vez.

## Deep Dive

### A hierarquia e a cadeia de decorators

`Stream` é abstrata. Algumas subclasses são fontes ou destinos de bytes
(`FileStream`, `MemoryStream`, `NetworkStream`), e outras são decorators que
recebem outro `Stream` no construtor e transformam o que passa por eles
(`BufferedStream`, `GZipStream`, `CryptoStream`). Você monta um pipeline
aninhando-os, com a fonte ou o destino real no meio:

```csharp
// Escrita: seus bytes -> gzip -> buffer -> arquivo
await using var file = new FileStream("log.gz", FileMode.Create, FileAccess.Write);
await using var buffered = new BufferedStream(file, 64 * 1024);
await using var gzip = new GZipStream(buffered, CompressionLevel.Optimal);

await gzip.WriteAsync(payload);
```

O `FileStream` já faz buffer internamente (o buffer padrão é de 4 KB), então
embrulhá-lo num `BufferedStream` só ajuda quando você quer outro tamanho. O
decorator vale a pena em streams que não fazem buffer, como o `NetworkStream`,
onde muitas escritas minúsculas virariam cada uma uma chamada de sistema.

### Read pode devolver menos bytes do que você pediu

`Read` devolve quantos bytes realmente colocou no buffer, e `0` apenas no fim do
stream. Num arquivo isso costuma ser a quantidade inteira, mas num stream de
rede ou comprimido uma única chamada pode devolver só o que já chegou. Código que
assume ter recebido tudo funciona nos testes e falha em produção:

```csharp
// Errado: ignora o valor de retorno.
var header = new byte[16];
stream.Read(header, 0, header.Length);

// Certo: repita até ter tudo.
int read = 0;
while (read < header.Length)
{
    int n = stream.Read(header, read, header.Length - read);
    if (n == 0) throw new EndOfStreamException();
    read += n;
}

// A mesma coisa, desde o .NET 7:
stream.ReadExactly(header);                 // lança EndOfStreamException se o stream acabar antes
await stream.ReadExactlyAsync(header, ct);
```

Use `ReadAtLeast(buffer, minimumBytes, throwOnEndOfStream = true)` quando um mínimo basta mas você quer encher um buffer maior. Ele devolve pelo menos `minimumBytes` bytes, ou lança `EndOfStreamException` se o stream acabar antes (com `throwOnEndOfStream: false` devolve menos).

### Posse: quem faz o Dispose do stream interno

Descartar um decorator descarta o stream que ele embrulha, por padrão. É o que
você quer quando montou a cadeia inteira, e um bug quando o stream interno
pertence a outra pessoa. A maioria dos wrappers recebe um argumento `leaveOpen`
para isso:

```csharp
// Escreve texto num stream que o chamador possui, e o deixa aberto.
using var writer = new StreamWriter(responseBody, Encoding.UTF8, bufferSize: 1024, leaveOpen: true);
await writer.WriteAsync(text);
await writer.FlushAsync(); // descarregue explicitamente: leaveOpen pula o close que teria feito o flush
```

Uma armadilha parecida: um stream de compressão só escreve seu bloco final no
Dispose. Se você ler os bytes comprimidos antes de descartar o `GZipStream`,
recebe um arquivo truncado.

```csharp
var ms = new MemoryStream();
using (var gzip = new GZipStream(ms, CompressionLevel.Optimal, leaveOpen: true))
    gzip.Write(payload);                 // o gzip é descartado (e finalizado) aqui
byte[] compressed = ms.ToArray();        // seguro agora, e o ms continua aberto
```

### Seek, CanSeek e streams de mão única

`FileStream` e `MemoryStream` conseguem fazer seek, mas `NetworkStream`,
`GZipStream` e pipes não, e `Length` e `Position` lançam
`NotSupportedException` neles. Confira `CanSeek` antes de rebobinar, e rebobine
um `MemoryStream` depois de escrever e antes de ler:

```csharp
var ms = new MemoryStream();
ms.Write(data);
ms.Position = 0;          // sem isso, a leitura começa no fim e devolve 0 bytes
var copy = new byte[data.Length];
ms.ReadExactly(copy);
```

### Texto por cima de bytes

`StreamReader` e `StreamWriter` convertem entre bytes e texto com um encoding.
Os dois usam UTF-8 por padrão, e o `StreamReader` também detecta a marca de ordem
de bytes (BOM). Passe o encoding explicitamente quando os dados não forem UTF-8,
porque decodificar com o errado produz lixo em vez de um erro:

```csharp
using var reader = new StreamReader(stream, Encoding.Latin1, detectEncodingFromByteOrderMarks: false);
string line = await reader.ReadLineAsync(ct) ?? "";
```

### Acesso assíncrono a arquivos

Um `FileStream` aberto sem `FileOptions.Asynchronous` (o padrão é `None`, que a doc descreve como I/O síncrono) ainda tem `ReadAsync`, mas ele não usa o suporte assíncrono do sistema operacional. Abra-o com a flag para usar esse suporte:

```csharp
await using var fs = new FileStream("big.bin", new FileStreamOptions
{
    Mode = FileMode.Open,
    Access = FileAccess.Read,
    Options = FileOptions.Asynchronous | FileOptions.SequentialScan,
    BufferSize = 4096,
});
await fs.CopyToAsync(destination, ct);
```

`using` e `await using` funcionam em streams. Prefira `await using` em código
assíncrono, porque o `DisposeAsync` consegue descarregar dados em buffer sem
bloquear.

## Trade-offs

- **Esquecer que um decorator fecha o stream interno.** O padrão é descartar os
  dois, o que quebra o código que continua usando o stream depois.
  ```csharp
  using (var reader = new StreamReader(stream)) { /* ... */ }
  stream.ReadByte(); // ObjectDisposedException: o reader o fechou
  ```
- **`leaveOpen: true` passa a limpeza para você.** O wrapper deixa de descarregar
  seu buffer quando o chamador descarta o stream interno depois, então um
  `StreamWriter` sem flush perde seu último bloco de dados.
- **Um buffer em cima de outro desperdiça memória.** Um `BufferedStream` em volta
  de um `FileStream` acrescenta uma segunda cópia e nenhuma velocidade. Use um só
  em streams que ainda não fazem buffer.
- **`MemoryStream` esconde alocações grandes.** Ele cresce dobrando, e um payload
  de 100 MB guardado nele gera um array de 100 MB mais cópias intermediárias.
  Para dados grandes ou sem limite, copie direto da origem para o destino.
- **Async num `FileStream` síncrono não é realmente assíncrono.** O padrão documentado é I/O síncrono, então num servidor movimentado o ganho pode ser menor do que parece. O custo da flag assíncrona é um pouco mais de overhead em
  leituras minúsculas, então use-a para arquivos grandes ou lentos.

## Documentation Links

- [Stream class, System.IO, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.stream) (doc)
- [Stream.ReadExactly method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.stream.readexactly) (doc)
- [FileStream class, System.IO, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.filestream) (doc)
- [BufferedStream class, System.IO, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.bufferedstream) (doc)
- [GZipStream class, System.IO.Compression, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.compression.gzipstream) (doc)
- [StreamReader class, System.IO, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.streamreader) (doc)
