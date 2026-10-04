---
version: 1.0
updatedAt: 2026-10-04
title: "Paralelismo de Dados: Parallel e PLINQ"
summary: CPU-bound vs I/O-bound, Parallel.For e ForEachAsync, PLINQ, agregação sem lock com localInit e localFinally, e quando o paralelo fica mais lento.
---
## Objective

Paralelismo de dados divide uma coleção de trabalho independente entre vários
núcleos. O .NET oferece `Parallel.For`, `Parallel.ForEach`,
`Parallel.ForEachAsync` e PLINQ (`AsParallel`). Eles parecem um laço com ganho
de velocidade de graça, e essa é a armadilha: o paralelismo só ajuda quando o
trabalho é CPU-bound, grande o bastante para pagar o custo de agendamento e sem
estado compartilhado. Usado em itens minúsculos, em I/O ou dentro de uma
requisição web, ele deixa tudo mais lento ou esgota o thread pool que atende as
outras requisições. Este conceito cobre quando usar cada ferramenta, como
agregar sem locks e quando ficar sequencial.

## Use Cases

- Redimensionar alguns milhares de imagens num worker, onde cada imagem é um
  trabalho de CPU independente.
- Chamar uma API externa para 500 ids com no máximo 8 requisições em andamento,
  sem semáforos escritos à mão.
- Somar ou filtrar um grande array em memória com uma função pura.
- Decidir se um endpoint lento deve usar `Parallel.ForEach` (em geral: não).

## Deep Dive

### CPU-bound ou I/O-bound

Trabalho CPU-bound mantém um núcleo ocupado calculando (hash, processamento de
imagem, parsing). Mais núcleos ajudam, até o número de núcleos. Trabalho
I/O-bound espera um disco ou a rede, então a thread fica ociosa na maior parte
do tempo. Para I/O, a resposta é `async`/`await`, que libera a thread durante a
espera. Gastar uma thread por chamada em espera com `Parallel.ForEach` é a
ferramenta errada.

```csharp
// CPU-bound: corpo síncrono, uma thread de trabalho por núcleo.
Parallel.ForEach(files, file => Resize(file));

// I/O-bound: corpo assíncrono, concorrência limitada, sem threads bloqueadas.
await Parallel.ForEachAsync(
    ids,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (id, token) => await client.GetFromJsonAsync<Item>($"items/{id}", token));
```

`Parallel.ForEach` recebe um delegate síncrono. Passar uma lambda `async`
compila como `async void`, então o laço retorna antes de o trabalho terminar e
as exceções se perdem. `Parallel.ForEachAsync` (desde o .NET 6) é o que faz
await.

### Agregando sem lock

Escrever numa variável compartilhada a cada iteração é uma race, e envolver cada
escrita num `lock` serializa o trabalho que você queria paralelizar. A sobrecarga
com `localInit` e `localFinally` dá a cada worker seu próprio acumulador e faz o
merge uma vez por worker:

```csharp
long total = 0;
Parallel.For(
    0, numbers.Length,
    () => 0L,                                     // localInit: um acumulador por task
    (i, state, local) => local + Expensive(numbers[i]),
    local => Interlocked.Add(ref total, local));  // localFinally: merge uma vez por task
```

### PLINQ

`AsParallel()` transforma uma query LINQ numa query paralela. Os resultados
voltam sem ordem definida, a menos que você peça:

```csharp
var squares = numbers
    .AsParallel()
    .WithDegreeOfParallelism(Environment.ProcessorCount)
    .Where(n => IsPrime(n))
    .Select(n => n * n)
    .ToArray();

var inOrder = numbers.AsParallel().AsOrdered().Select(Expensive).ToArray();
```

`AsOrdered` mantém a ordem da origem e custa buffering. Prefira `Aggregate` ou
`Sum` a alterar estado externo em `ForAll`, porque eles combinam resultados
parciais com segurança.

### Não dentro de uma requisição, sem pensar

Uma requisição ASP.NET Core já roda numa thread do thread pool, e o pool é
compartilhado por todas as outras requisições. `Parallel.ForEach` dentro de um
handler toma várias threads a mais do mesmo pool, então uma requisição pode
esgotar as outras sob carga. Para um job grande de CPU disparado por um
endpoint, enfileire-o para um worker em segundo plano e retorne, e mantenha os
handlers `async` para I/O.

## Trade-offs

- **Trabalho pequeno fica mais lento em paralelo.** Particionar, agendar e fazer
  merge custam mais que o corpo do laço.
  ```csharp
  Parallel.For(0, 1_000, i => sum[i] = i * 2); // em geral mais lento que um for simples
  ```
  Meça com um tamanho realista antes de paralelizar.
- **Estado mutável compartilhado é uma race.** `results.Add(x)` num `List<T>` a
  partir de várias iterações corrompe a lista. Use `localInit`/`localFinally`,
  um `ConcurrentBag<T>` ou valores de retorno do PLINQ.
- **Contenção cancela o ganho.** Se toda iteração trava o mesmo objeto, ou acessa
  a mesma linha do banco, os workers entram em fila e você paga por threads que
  esperam.
- **Ordenação tem custo.** `AsOrdered` e `Parallel.ForEach` sobre uma origem com
  custo imprevisível por item podem deixar núcleos ociosos no final enquanto um
  pedaço lento termina. Não dependa da ordem de iteração do `Parallel.ForEach`.
- **Exceções são agregadas.** Uma iteração que falha cancela as demais na medida
  do possível, e quem chama vê uma `AggregateException` nas APIs síncronas,
  enquanto `ForEachAsync` lança a primeira quando recebe o await.
- **Concorrência sem limite sobrecarrega o destino.** `Parallel.ForEachAsync`
  usa por padrão o número de processadores em `MaxDegreeOfParallelism`, o que
  muitas vezes é errado para uma API com rate limit. Defina-o de propósito.

## Documentation Links

- [Data parallelism (Task Parallel Library), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/data-parallelism-task-parallel-library) (doc)
- [How to write a Parallel.For loop with thread-local variables, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/how-to-write-a-parallel-for-loop-with-thread-local-variables) (doc)
- [Parallel.ForEachAsync, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.parallel.foreachasync) (doc)
- [Parallel LINQ (PLINQ), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/introduction-to-plinq) (doc)
- [Potential pitfalls in data and task parallelism, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/potential-pitfalls-in-data-and-task-parallelism) (doc)
