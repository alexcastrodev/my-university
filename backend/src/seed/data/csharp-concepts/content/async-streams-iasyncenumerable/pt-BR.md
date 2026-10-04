---
version: 1.0
updatedAt: 2026-10-04
title: "Streams Assíncronos com IAsyncEnumerable"
summary: await foreach, iteradores assíncronos, cancelamento com EnumeratorCancellation, streaming de JSON no ASP.NET Core e o que acontece quando o stream falha no meio.
---
## Objective

`Task<List<T>>` faz quem chama esperar todos os itens antes de ver o primeiro, e
mantém todos eles na memória ao mesmo tempo. `IAsyncEnumerable<T>` produz os
itens um por vez, de forma assíncrona, e deixa o consumidor processar cada um
conforme chega. É o formato certo para resultados grandes, lentos de produzir ou
sem fim definido: linhas lidas de um banco, linhas lidas de um stream de rede,
páginas buscadas numa API remota ou um array JSON enviado a um cliente. Este
conceito cobre como escrever e consumir um, como o cancelamento e o
`ConfigureAwait` funcionam com `await foreach`, como o ASP.NET Core e o EF Core o
usam e o que acontece quando o stream falha no meio.

## Use Cases

- Exportar um milhão de linhas como JSON sem carregá-las todas na memória.
- Ler uma API remota paginada e entregar cada item a quem chama assim que a
  página chega.
- Um feed de progresso ou um tail de log que nunca termina e precisa parar
  quando o cliente se desconecta.
- Processar um arquivo linha a linha fazendo trabalho assíncrono por linha.

## Deep Dive

### Produzindo e consumindo

Um iterador assíncrono é um método `async`, que devolve `IAsyncEnumerable<T>` e
usa `yield return`. O consumidor usa `await foreach`:

```csharp
public static async IAsyncEnumerable<string> ReadLinesAsync(
    string path,
    [EnumeratorCancellation] CancellationToken ct = default)
{
    using var reader = new StreamReader(path);
    while (await reader.ReadLineAsync(ct) is { } line)
        yield return line;
}

await foreach (var line in ReadLinesAsync("big.log", ct))
    Console.WriteLine(line);
```

Como num iterador síncrono, o compilador transforma o método numa state machine.
Nada roda até o primeiro `MoveNextAsync`, e o corpo só retoma depois de cada
`yield return` quando o consumidor pede o próximo item. Esse modelo de puxar é o
que dá backpressure: um consumidor lento desacelera o produtor.

### Cancelamento com `[EnumeratorCancellation]`

Quem chama nem sempre passa o token ao método iterador, por exemplo quando o
stream chega por uma interface. `WithCancellation` entrega um token ao
enumerador, e `[EnumeratorCancellation]` diz ao compilador para ligar o
parâmetro a ele:

```csharp
IAsyncEnumerable<string> lines = ReadLinesAsync("big.log");

await foreach (var line in lines.WithCancellation(ct))
    Process(line);
```

Sem o atributo, o token passado a `WithCancellation` é ignorado em silêncio, e o
compilador apenas emite um aviso. Se quem chama já passa um token ao método e
também usa `WithCancellation`, os dois são combinados.

### `ConfigureAwait` e descarte

O `await foreach` aguarda a cada `MoveNextAsync` e mais uma vez em
`DisposeAsync`. Código de biblioteca que não deve retomar no contexto capturado
configura o laço inteiro:

```csharp
await foreach (var item in source.ConfigureAwait(false))
    Handle(item);
```

Sair do laço de qualquer forma (`break`, `return`, uma exceção) chama
`DisposeAsync`, que executa os blocos `finally` do iterador e a limpeza de
`await using`. É assim que um reader de banco ou um handle de arquivo dentro do
iterador é liberado cedo, então consuma sempre o stream com `await foreach` em
vez de chamar `GetAsyncEnumerator` à mão e esquecer de descartá-lo.

### Streaming de JSON a partir de um endpoint

Um endpoint de minimal API pode devolver `IAsyncEnumerable<T>`. O
`System.Text.Json` escreve o array de forma incremental, então o cliente começa
a receber itens enquanto o servidor ainda produz o resto, e o servidor nunca
guarda o resultado inteiro:

```csharp
app.MapGet("/orders/export", (OrdersDbContext db) =>
    db.Orders
        .AsNoTracking()
        .OrderBy(o => o.Id)
        .Select(o => new OrderRow(o.Id, o.Total))
        .AsAsyncEnumerable());
```

`AsAsyncEnumerable()` é o método do EF Core que transforma uma query em stream.
Ele lê as linhas conforme o consumidor as pede, então a conexão com o banco fica
aberta durante toda a enumeração. O sentido inverso também faz streaming:
`JsonSerializer.DeserializeAsyncEnumerable<T>(stream)` entrega os elementos de
um array JSON grande um de cada vez.

### LINQ sobre streams assíncronos

Os operadores LINQ síncronos não funcionam em `IAsyncEnumerable<T>`. Até pouco
tempo isso significava o pacote NuGet `System.Linq.Async`. De memória, o .NET 10
traz os mesmos operadores assíncronos na biblioteca base como
`System.Linq.AsyncEnumerable`, então `Where`, `Select`, `ToListAsync` e afins
funcionam sem o pacote extra. Confira a versão que o seu projeto usa antes de
depender disso.

```csharp
var big = await ReadOrdersAsync(ct)
    .Where(o => o.Total > 1_000)
    .Select(o => o.Id)
    .ToListAsync(ct);
```

## Trade-offs

- **Um stream esconde o custo de cada passo.** Cada `MoveNextAsync` pode ser uma
  ida à rede, então um consumidor que faz trabalho lento por item mantém abertos
  os recursos do produtor (uma conexão, um cursor) durante todo esse tempo.
  ```csharp
  await foreach (var row in db.Orders.AsAsyncEnumerable())
      await SendEmailAsync(row); // a conexão com o banco fica aberta durante cada e-mail
  ```
  Se o trabalho por item é lento, leia uma página para a memória primeiro e só
  então processe.
- **Os erros chegam no meio.** Uma exceção em `MoveNextAsync` pode acontecer
  depois de o consumidor já ter tratado muitos itens e, numa resposta HTTP,
  depois de o status e parte do corpo terem sido enviados. O cliente vê um corpo
  truncado, não um 500.
  ```csharp
  // Os itens 1..999 já foram enviados como 200 OK. O item 1000 lança: a resposta é cortada.
  ```
  Valide o que for possível antes de devolver o stream, e faça os clientes
  tratarem um array JSON incompleto como falha.
- **`await foreach` não é paralelo.** Os itens são puxados um de cada vez, então
  um passo assíncrono lento por item se multiplica pelo número de itens. Para
  sobrepor trabalho, entregue os itens a um `Channel<T>` ou use
  `Parallel.ForEachAsync` sobre o stream.
- **Streaming perde um total único e consistente.** Um `Task<List<T>>` pode ser
  contado, ordenado e devolvido com um `Content-Length`. Um stream não tem
  tamanho de antemão, e tudo que precisa do conjunto inteiro (ordenar por um
  valor calculado, uma contagem num header) precisa mesmo assim de buffer, o que
  elimina o benefício.
- **O atributo do token é fácil de esquecer.** Sem `[EnumeratorCancellation]` o
  código compila e roda, e então ignora o `WithCancellation`, então uma
  requisição cancelada continua produzindo itens que ninguém lê.

## Documentation Links

- [Asynchronous streams (IAsyncEnumerable), C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/generate-consume-asynchronous-stream) (doc)
- [await foreach statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements#the-await-foreach-statement) (doc)
- [EnumeratorCancellationAttribute, .NET API, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.enumeratorcancellationattribute) (doc)
- [How to serialize and deserialize JSON, streaming with IAsyncEnumerable, System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/deserialization#deserialize-to-iasyncenumerable) (doc)
- [Minimal APIs, responses, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses) (doc)
- [What is new in .NET 10 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
