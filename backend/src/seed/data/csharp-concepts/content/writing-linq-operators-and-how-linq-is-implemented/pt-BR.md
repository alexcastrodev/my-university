---
version: 1.0
updatedAt: 2026-10-15
title: "Escrevendo Operadores LINQ e Como o LINQ É Implementado"
summary: Como escrever um operador próprio no estilo do LINQ (validação imediata, iterador separado, generic math), os iteradores especializados que o .NET 10 escolhe por tipo de fonte, TryGetNonEnumeratedCount, os caminhos rápidos com span, OrderBy().First() sem ordenar, Sum vetorizado e quanto um pipeline aloca.
---
## Objective

O LINQ to Objects é C# comum dentro do `System.Linq.dll`: métodos de extensão
sobre `IEnumerable<T>`, classes de iterador e uma longa lista de verificações
de tipo que escolhem um caminho mais rápido quando a fonte é um array, um
`List<T>` ou outro iterador do LINQ. Conhecer esse código explica por que
`Count()` é instantâneo numa lista e lento numa query, por que
`OrderBy(...).First()` não ordena e quanto um pipeline custa em alocações. Este
conceito mostra como escrever um operador próprio no mesmo estilo e depois
percorre como a implementação do .NET 10 funciona, a partir do código do
runtime e de medições.

## Use Cases

- Criar um operador de domínio (`EveryNth`, `WhereNotNull`, um `Batch` com
  regra própria) que se comporte como os nativos.
- Escrever uma agregação numérica uma vez para todos os tipos de número.
- Entender um trace de profiler que mostra `ArrayWhereSelectIterator` ou
  `TryGetSpan`.
- Decidir se uma API que alimenta LINQ deve devolver `IEnumerable<T>`, array ou
  lista.

## Deep Dive

### Escrevendo um operador: valide agora, itere depois

Um operador próprio é um método de extensão sobre `IEnumerable<T>`. Coloque a
validação dos argumentos no método público e o laço com `yield` num iterador
separado, para que argumento inválido falhe na chamada e não no primeiro
`MoveNext()`. LINQ, Execução Adiada e Iteradores explica por que essa divisão é
necessária:

```csharp
public static class MyLinq
{
    public static IEnumerable<T> EveryNth<T>(this IEnumerable<T> source, int n)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(n);
        return Iterate(source, n);

        static IEnumerable<T> Iterate(IEnumerable<T> source, int n)
        {
            int i = 0;
            foreach (var item in source)
                if (i++ % n == 0) yield return item;
        }
    }
}

Enumerable.Range(1, 10).EveryNth(3);   // 1,4,7,10
MyLinq.EveryNth<int>(null!, 3);        // ArgumentNullException já na chamada
```

O compilador transforma `Iterate` numa classe que é ao mesmo tempo o enumerável
e o seu primeiro enumerador. Chamar `GetEnumerator()` nela devolveu o próprio
objeto na primeira vez, na thread que o criou, e uma cópia nova enquanto esse
primeiro enumerador ainda estava em uso ou quando a chamada veio de outra
thread. Os iteradores do próprio LINQ seguem a mesma regra, então uma alocação
atende o caso comum de "monta e faz um `foreach`".

### Uma agregação numérica com generic math

Desde o .NET 7 uma agregação pode ser escrita uma vez para todos os tipos
numéricos com as interfaces `INumber<T>` vistas em Generic math e membros
static abstract em interfaces. Um segundo parâmetro de tipo deixa o acumulador
ser mais largo que os elementos, que é exatamente como `Enumerable.Sum` é
construído:

```csharp
public static TResult SumChecked<T, TResult>(this IEnumerable<T> source)
    where T : INumber<T> where TResult : INumber<TResult>
{
    ArgumentNullException.ThrowIfNull(source);
    TResult sum = TResult.Zero;
    foreach (var v in source) sum = checked(sum + TResult.CreateChecked(v));
    return sum;
}

new byte[] { 200, 100 }.SumChecked<byte, int>();   // 300
new[] { 1.5, 2.5 }.SumChecked<double, double>();   // 4
new[] { int.MaxValue, 1 }.SumChecked<int, int>();  // OverflowException
```

### O que um pipeline realmente constrói

`Where` não devolve um iterador genérico único. No código do .NET 10 ele
verifica o tipo da fonte e escolhe uma classe especializada, e todo iterador do
LINQ deriva de um `Iterator<T>` interno que pode sobrescrever `Select`,
`Where`, `Skip`, `Count` e `First` para o seu formato:

```csharp
int[] arr = Enumerable.Range(1, 10).ToArray();
arr.Where(x => x > 2);                        // ArrayWhereIterator`1
arr.ToList().Where(x => x > 2);               // ListWhereIterator`1
Gen().Where(x => x > 2);                      // IEnumerableWhereIterator`1 (um método com yield)
arr.Where(x => x > 2).Select(x => x * 2);     // ArrayWhereSelectIterator`2: um estágio fundido
arr.Where(x => x > 2).Where(x => x < 8);      // ArrayWhereIterator`1: predicados combinados
Enumerable.Range(0, 5).Select(x => x);        // RangeSelectIterator`2
```

As versões de array e de lista acessam o armazenamento por índice em vez de
passar por `IEnumerator<T>`, e um `Where` seguido de `Select` vira um único
iterador que filtra e projeta no mesmo laço.

### Contando sem enumerar

`Count()` testa primeiro `ICollection<T>` e lê o seu `Count`. Depois pergunta a
contagem a um iterador do LINQ e só então enumera.
`TryGetNonEnumeratedCount` (.NET 6) faz as mesmas verificações mas nunca
enumera:

| Fonte | `TryGetNonEnumeratedCount` |
|---|---|
| `List<int>` com 10 itens | 10 |
| `arr.Select(...)` | 10 |
| `Enumerable.Range(0, 5).Select(...)` | 5 |
| `arr.Select(...).Skip(3)` | 7 |
| `arr.Where(...)` | desconhecido (`false`) |
| um método com `yield` | desconhecido (`false`) |

`Where` não sabe a contagem sem rodar o predicado, e um método iterador é
opaco. Há uma sutileza nas projeções: espera-se que `Select` rode o seletor em
todo elemento quando `Count()` força a execução, então `arr.Select(f).Count()`
rodou `f` dez vezes, enquanto `TryGetNonEnumeratedCount` não rodou nenhuma e
ainda respondeu 10.

### Caminhos rápidos: spans, e `OrderBy` sem ordenar

Vários operadores (`Sum`, `Count(predicate)`, `Any(predicate)`, `Min`, `Max`)
chamam primeiro um `TryGetSpan` interno, que só tem sucesso quando o tipo em
tempo de execução é exatamente `T[]` ou `List<T>` (ele compara `GetType()`, não
usa `is`). Aí o laço roda sobre um `ReadOnlySpan<T>`, sem enumerador nenhum.

Queries ordenadas também olham adiante. `OrderBy(...).First()` é respondido por
uma varredura única que guarda o menor elemento, e `ElementAt` usa uma seleção
parcial em vez de ordenar tudo:

```csharp
// 1.000 ints embaralhados, o comparer conta as próprias chamadas
data.OrderBy(x => x, counting).First();    // 999 comparações
data.OrderBy(x => x, counting).ToList();   // 10.917 comparações
```

### `Sum`: generic math mais vetorização

`Enumerable.Sum` é uma casca fina sobre um método genérico,
`Sum<TSource, TResult>` restrito a `INumber<T>`; `Sum(IEnumerable<float>)` o
chama com `TResult = double`. Quando a fonte é um span e os tipos de elemento e
de resultado coincidem, ele vetoriza `int` e `long` com `Vector<T>`, verificando
overflow em vetores inteiros pelos bits de sinal. O código exige
`Vector<T>.Count > 2`, então com vetores de 128 bits só `int` (4 posições) se
qualifica; `long` (2 posições) cai no laço escalar. Num Apple M4 (Arm64, 128
bits), sobre 10 milhões de elementos em Release:

| Chamada | Tempo |
|---|---|
| `int[].Sum()` | 2 ms, igual a um laço `for` unchecked escrito à mão |
| `long[].Sum()` | 10 ms |
| `IEnumerable<int>` (um `Select` sobre o array) `.Sum()` | 19 ms |

O caminho do array é rápido e checked; esconder o array atrás de uma projeção
ou de um `IEnumerable<T>` próprio perde o span e os vetores.

### Quanto um pipeline aloca

Medido por chamada com `GC.GetAllocatedBytesForCurrentThread()` depois do
aquecimento, no .NET 10:

| Código sobre um `int[]` de 10 elementos | Bytes |
|---|---|
| `arr.Sum()` | 0 |
| `arr.Count(x => x > 2)` | 0 |
| `arr.Where(x => x > 2).Sum()` | 48: um `ArrayWhereIterator` |
| `foreach` sobre `arr.Where(...).Select(...)` | 104: o iterador do `Where` mais o iterador fundido `WhereSelect` |
| `foreach` sobre `arr.EveryNth(2)` | 96 |

As lambdas não capturam nada, então o compilador guarda os delegates em cache e
eles não aparecem. Uma lambda com captura acrescenta uma closure e um delegate
por chamada, como mediu Value Types, Reference Types e Boxing.

## Trade-offs

- **Método iterador versus enumerador escrito à mão.** `yield return` é curto e
  correto; uma classe `IEnumerator<T>` escrita à mão pode ganhar os caminhos
  rápidos que o LINQ usa (contagem conhecida, acesso por índice), mas é muito
  mais código para acertar. Escreva uma só depois que o profiler apontar para
  ela.
- **Expor `IEnumerable<T>` versus um tipo concreto.** Devolver `IEnumerable<T>`
  deixa a API flexível, mas se quem chama roda LINQ em cima, os caminhos
  rápidos de span e de `ICollection<T>` só valem quando o objeto em tempo de
  execução é mesmo um array ou uma lista.
  ```csharp
  IEnumerable<int> Ids() => _ids;                    // continua int[]: Sum vetoriza
  IEnumerable<int> Ids() => _ids.Select(x => x);     // opaco: laço escalar, iterador alocado
  ```
- **Confiar em otimizações internas.** `OrderBy().First()` e os iteradores
  fundidos são detalhes de implementação do .NET 10, não contratos
  documentados. Escreva a forma clara (`MinBy`) quando ela existir e trate o
  resto como bônus.
- **LINQ versus laço num caminho quente.** Em arrays e listas, `Sum`, `Count` e
  `Any` com predicado não alocam nada e podem ganhar de um laço ingênuo;
  pipelines mais longos alocam um iterador por estágio a cada execução.

## Lab

Neste lab você recebe `MyLinq`, uma classe estática com seis operadores LINQ sem corpo. O seu trabalho é escrevê-los como métodos iteradores, validar argumentos na hora da chamada, liberar a origem quando o consumidor para cedo e tratar `ICollection<T>` e `IList<T>` como atalhos, do jeito que o `System.Linq` faz. A ideia central é que preguiça e atalhos se observam por contadores, nunca por tempo: o teste conta quantos itens foram puxados e quantos enumeradores foram criados e descartados.

**O cenário**

Os testes alimentam seus operadores com duas classes espiãs, em `Spies.cs`.

- `TrackedSource`: um iterador que registra quantos itens foram puxados (`Pulled`), quantas enumerações começaram (`Enumerations`) e quantos enumeradores foram descartados (`Disposed`).
- `ListSpy`: uma `IList<int>` que conta os enumeradores pedidos (`EnumeratorsCreated`).
- `MyLinq.cs`: `MyWhere`, `MySelect`, `MyTake`, `MyDistinctBy`, `MyChunk`, `MyCount` e `MyElementAt`.

Um método com `yield` não consegue validar de forma imediata, então a receita é dividir em duas partes.

**O que você vai fazer, passo a passo**

1. **Validar já, iterar depois (TODO-00).** Em `MyWhere` e `MySelect`, valide `source` e `predicate` ou `selector` no método público (o `ArgumentNullException` deve estourar na chamada, não no primeiro `MoveNext`) e devolva um método iterador privado com o `yield return`. O predicado e o seletor rodam uma vez por elemento, só quando o item é puxado, e são reavaliados a cada enumeração.
2. **Parar sem um MoveNext a mais (TODO-01).** `MyTake` valida de imediato (origem nula, contagem negativa) e depois produz no máximo `count` itens. Pare logo depois do último: não chame `MoveNext` na origem quando já tiver o bastante, e não toque na origem se `count` for 0. Sair do iterador cedo deve descartar o enumerador da origem (o `foreach`/`finally` faz isso por você).
3. **Streaming com conjunto "visto" (TODO-02).** `MyDistinctBy` produz cada elemento cuja chave ainda não apareceu, sem acumular a origem inteira, executando o `keySelector` uma vez por elemento. Mantenha o conjunto de chaves vistas **dentro** do iterador, para cada enumeração começar vazia. Valide os argumentos de imediato.
4. **Dividir em lotes (TODO-03).** `MyChunk` produz arrays de `size` itens, e o último pode ser menor. Puxe da origem só até onde o consumidor pedir (o primeiro chunk puxa exatamente `size` itens). Lance `ArgumentOutOfRangeException` de imediato se `size < 1`, não produza um chunk final vazio e descarte o enumerador se o consumidor parar cedo. Os arrays devem ser independentes.
5. **Atalhos por interface (TODO-04).** `MyCount`: se a origem for `ICollection<T>`, devolva `Count` sem criar enumerador; senão, enumere e conte. `MyElementAt`: se a origem for `IList<T>`, use o indexador; senão, enumere até o índice. Um índice negativo ou grande demais lança `ArgumentOutOfRangeException` nos dois caminhos, e o enumerador deve ser descartado.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que a validação não pode ficar no método com `yield`, por que `source.MyWhere(...).MySelect(...).First()` puxa só três itens de 100 e por que o `finally` da origem roda mesmo com `break`.

**Desafios opcionais**

- **TODO-05:** escreva `MyZip`, que para na sequência mais curta. Quando a primeira acaba, ele não pode puxar da segunda, e os dois enumeradores devem ser descartados.
- **TODO-06:** escreva `MyTryGetNonEnumeratedCount`, que responde para `ICollection<T>` e devolve `false` para iteradores, como `Enumerable.TryGetNonEnumeratedCount`. Por que `MyWhere` nunca poderia responder?

**Pré-requisitos:** extension methods e generics, `yield return` e `IEnumerable<T>`/`IEnumerator<T>`, execução adiada (veja o lab de deferred execution) e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` está num comentário com a dica, então os testes vermelhos são o seu checklist.

## Documentation Links

- [How to extend LINQ, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/how-to-extend-linq) (doc)
- [Iterators, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/concepts/iterators) (doc)
- [Enumerable.TryGetNonEnumeratedCount method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.trygetnonenumeratedcount) (doc)
- [Enumerable.Sum method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.sum) (doc)
- [Generic math, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/math) (doc)
- [Enumerable.Sum source, dotnet/runtime (release/10.0)](https://github.com/dotnet/runtime/blob/release/10.0/src/libraries/System.Linq/src/System/Linq/Sum.cs) (doc)
