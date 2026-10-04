---
version: 1.0
updatedAt: 2026-10-04
title: "I/O Assíncrono e System.IO.Pipelines"
summary: ReadAsync com Memory, CopyToAsync, ArrayPool, PipeReader e PipeWriter com AdvanceTo e backpressure, e quando Pipelines compensa em vez de um Stream simples.
---
## Objective

Ler e escrever dados sem bloquear uma thread é o básico de qualquer servidor em
.NET. Os métodos assíncronos de `Stream` cobrem a maioria dos casos, mas deixam
para você o gerenciamento de buffers, leituras parciais e pressão de memória. O
`ArrayPool<byte>` elimina o custo de alocar buffers temporários, e o
`System.IO.Pipelines` vai além: ele é dono do buffering, deixa um parser olhar os
dados sem copiá-los e desacelera um produtor rápido quando o consumidor fica
para trás. Este conceito mostra quando cada nível basta e o que cada um custa.

## Use Cases

- Copiar um arquivo enviado por upload para o disco ou para um blob storage sem
  carregá-lo todo em memória.
- Um caminho quente que precisa de um buffer temporário por requisição e não
  pode alimentar o garbage collector.
- Fazer o parse de um protocolo de rede com framing (prefixo de tamanho ou por
  linha) em que uma mensagem pode chegar dividida em várias leituras.
- Um produtor que lê de um socket mais rápido do que o consumidor processa e não
  pode deixar a memória crescer sem limite.

## Deep Dive

### Leituras e escritas assíncronas com Memory

As sobrecargas com `Memory<byte>` de `ReadAsync` e `WriteAsync` retornam
`ValueTask`, então uma chamada que completa de forma síncrona não aloca nada.
Uma leitura pode devolver menos bytes do que o buffer comporta, e zero significa
fim do stream, então a leitura sempre fica dentro de um laço:

```csharp
static async Task<int> CountBytesAsync(Stream input, CancellationToken ct)
{
    var buffer = new byte[16 * 1024];
    var total = 0;
    int read;
    while ((read = await input.ReadAsync(buffer.AsMemory(), ct)) > 0)
        total += read; // só buffer[..read] contém dados válidos
    return total;
}
```

Quando você só move bytes de um stream para outro, não escreva esse laço:
`CopyToAsync` faz isso, com um buffer padrão de 81920 bytes que dá para mudar
por uma sobrecarga:

```csharp
await using var file = File.Create(path);
await request.Body.CopyToAsync(file, bufferSize: 64 * 1024, ct);
```

### Alugando buffers com ArrayPool

Alocar um array novo a cada requisição faz o garbage collector trabalhar à toa.
O `ArrayPool<byte>.Shared` empresta arrays e os recebe de volta:

```csharp
var buffer = ArrayPool<byte>.Shared.Rent(minimumLength: 4096);
try
{
    var read = await stream.ReadAsync(buffer.AsMemory(0, 4096), ct);
    Process(buffer.AsSpan(0, read));
}
finally
{
    ArrayPool<byte>.Shared.Return(buffer, clearArray: true); // limpe se continha segredos
}
```

Duas regras evitam a maioria dos bugs. `Rent` pode devolver um array maior do
que o pedido, então sempre controle o tamanho que você realmente usa e nunca
dependa de `buffer.Length`. E depois do `Return`, o array volta a ser do pool:
guardar uma referência, ou devolvê-lo duas vezes, corrompe os dados de outro
chamador.

### Pipelines: pool, buffering e parser num só lugar

O `System.IO.Pipelines` divide o trabalho em duas pontas unidas por um `Pipe`. O
writer pede memória, preenche e faz flush. O reader recebe uma
`ReadOnlySequence<byte>` (possivelmente com vários segmentos) e diz ao pipe
quanto usou:

```csharp
static async Task ReadLinesAsync(PipeReader reader, CancellationToken ct)
{
    while (true)
    {
        ReadResult result = await reader.ReadAsync(ct);
        ReadOnlySequence<byte> buffer = result.Buffer;

        while (TryReadLine(ref buffer, out ReadOnlySequence<byte> line))
            Handle(line);

        // consumed: já processado e descartado. examined: já visto, então só me acorde quando chegar mais.
        reader.AdvanceTo(buffer.Start, buffer.End);

        if (result.IsCompleted) break;
    }
    await reader.CompleteAsync();
}

static bool TryReadLine(ref ReadOnlySequence<byte> buffer, out ReadOnlySequence<byte> line)
{
    var position = buffer.PositionOf((byte)'\n');
    if (position is null) { line = default; return false; }
    line = buffer.Slice(0, position.Value);
    buffer = buffer.Slice(buffer.GetPosition(1, position.Value));
    return true;
}
```

O ponto central é o `AdvanceTo(consumed, examined)`. Os dados antes de
`consumed` são liberados. Os dados entre `consumed` e `examined` continuam no
pipe, mas o próximo `ReadAsync` espera bytes novos em vez de devolver a mesma
mensagem incompleta num laço ocupado.

Dá para embrulhar um stream existente sem escrever o produtor:
`PipeReader.Create(stream)` e `PipeWriter.Create(stream)`.

### Backpressure

Um `Pipe` tem dois limites em `PipeOptions`. Quando os dados não lidos passam de
`pauseWriterThreshold`, o `FlushAsync` do writer só completa depois que o reader
consome o bastante para ficar abaixo de `resumeWriterThreshold`:

```csharp
var pipe = new Pipe(new PipeOptions(
    pauseWriterThreshold: 64 * 1024,   // o writer espera acima disto
    resumeWriterThreshold: 32 * 1024)); // e retoma abaixo disto

PipeWriter writer = pipe.Writer;
Memory<byte> memory = writer.GetMemory(sizeHint: 4096);
int bytesRead = await socket.ReceiveAsync(memory, SocketFlags.None, ct);
writer.Advance(bytesRead);
FlushResult flush = await writer.FlushAsync(ct); // espera aqui quando o reader está atrasado
```

Esse é o ponto contra um `MemoryStream` feito à mão com um laço: um consumidor
lento desacelera o produtor em vez de encher a memória.

### Quando vale a pena

O servidor Kestrel do ASP.NET Core é construído sobre Pipelines exatamente por
esses motivos. No seu código, `Stream` com `ArrayPool` basta quando você copia,
calcula hash ou transforma dados em blocos de tamanho fixo. Use Pipelines quando
fizer parse de um protocolo cujas mensagens cruzam fronteiras de leitura, quando
precisar limitar a memória diante de um produtor rápido, ou quando a cópia de
bytes entre buffers aparecer num profile.

## Trade-offs

- **`ArrayPool` passa a responsabilidade para você.** Um buffer que você esquece
  de devolver só custa uma alocação nova depois, mas um que você mantém depois de
  devolver é uma corrida de dados com quem alugar o array em seguida.
  ```csharp
  ArrayPool<byte>.Shared.Return(buffer);
  buffer[0] = 1; // outro chamador pode ser dono deste array agora
  ```
- **O array devolvido pode ser maior do que o pedido.** Código que calcula hash
  ou envia `buffer` em vez de `buffer.AsMemory(0, read)` envia bytes velhos de um
  uso anterior do mesmo array.
- **Pipelines têm uma API mais íngreme.** A `ReadOnlySequence<byte>` pode ter
  vários segmentos, então um parser precisa de `SequenceReader<byte>` ou de
  fatiamento cuidadoso, e um `AdvanceTo` errado perde dados ou gira a 100% de
  CPU.
  ```csharp
  reader.AdvanceTo(buffer.Start);               // nada consumido nem examinado: ReadAsync volta na hora
  reader.AdvanceTo(buffer.Start, buffer.End);   // examinou tudo: espera mais dados
  ```
- **Backpressure move o problema, não o remove.** Um writer pausado significa um
  socket que não está sendo lido, então o lado remoto também acaba parando. É o
  efeito desejado, mas precisa de timeouts para que um cliente lento não segure
  uma conexão para sempre.
- **Nem toda carga precisa disso.** Para um handler que copia um corpo para um
  arquivo, `CopyToAsync` é mais curto, mais legível e rápido o bastante.

## Documentation Links

- [Stream.ReadAsync and the Memory overloads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.stream.readasync) (doc)
- [Stream.CopyToAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.stream.copytoasync) (doc)
- [ArrayPool<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1) (doc)
- [System.IO.Pipelines in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/io/pipelines) (doc)
- [PipeOptions class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipelines.pipeoptions) (doc)
