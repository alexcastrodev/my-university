---
version: 1.0
updatedAt: 2026-10-04
title: "Coleções Imutáveis e Frozen"
summary: ImmutableList vs ImmutableArray, builders, ImmutableDictionary, FrozenDictionary e FrozenSet, e a diferença entre uma visão somente leitura e uma coleção imutável.
---
## Objective

Uma coleção que não pode mudar é mais fácil de compartilhar: qualquer thread pode
lê-la, ela pode ser chave de cache e nenhum chamador consegue quebrá-la pelas
costas. O .NET tem duas famílias para isso, e elas resolvem problemas diferentes.
As coleções imutáveis de `System.Collections.Immutable` dão "cópias modificadas"
de um valor: você continua usando-as enquanto os dados mudam, e cada mudança
devolve uma nova coleção. As coleções frozen de `System.Collections.Frozen`
(.NET 8) dão a leitura mais rápida possível de uma tabela de consulta construída
uma vez e nunca alterada. Nenhuma das duas é o mesmo que um `IReadOnlyList<T>`,
que apenas restringe o que uma referência pode fazer.

## Use Cases

- Um snapshot de configuração ou de feature flags que muitas threads leem
  enquanto outra thread publica uma nova versão.
- Uma tabela de consulta estática, como códigos de país ou nomes de headers HTTP,
  construída na inicialização e consultada milhões de vezes.
- Um value object que guarda uma lista e precisa continuar igual ao estado
  anterior depois que outro código roda.
- Um histórico de desfazer, em que cada estado é uma cópia modificada e barata do
  anterior.

## Deep Dive

### Coleções imutáveis devolvem uma nova coleção

Todo método que "modifica" uma coleção imutável devolve a nova coleção e deixa a
original intacta:

```csharp
using System.Collections.Immutable;

ImmutableList<int> a = [1, 2, 3];       // collection expression, C# 12
ImmutableList<int> b = a.Add(4);

Console.WriteLine(a.Count); // 3: inalterada
Console.WriteLine(b.Count); // 4
```

Esquecer de usar o resultado é o bug clássico: `a.Add(4);` sozinho numa linha
compila e não faz nada.

### ImmutableList versus ImmutableArray

Elas são construídas de formas diferentes, então o perfil de custo é oposto:

```csharp
ImmutableList<int> list = ImmutableList.Create(1, 2, 3);   // árvore balanceada
ImmutableArray<int> array = ImmutableArray.Create(1, 2, 3); // embrulha um array comum

var x = list[1];    // O(log n)
var y = array[1];   // O(1)

var l2 = list.Add(4);    // O(log n): compartilha a maior parte da árvore com `list`
var a2 = array.Add(4);   // O(n): copia o array inteiro
```

Use `ImmutableArray<T>` quando os dados são construídos uma vez e lidos muitas
vezes, que é o caso comum: é uma struct com velocidade de array e sem alocação
extra por leitura. Use `ImmutableList<T>` quando você realmente aplica muitas
pequenas mudanças a uma coleção grande e mantém as versões antigas por perto,
porque a árvore compartilha estrutura em vez de copiar.

### Builders

Quando você monta uma coleção a partir de muitos itens, adicionar um a um a uma
instância imutável aloca uma nova coleção a cada vez. Um builder é um auxiliar
mutável que você preenche e depois congela:

```csharp
var builder = ImmutableArray.CreateBuilder<string>();
foreach (var line in File.ReadLines(path))
    builder.Add(line);

ImmutableArray<string> lines = builder.ToImmutable();
```

Para uma conversão direta de uma sequência existente, `ToImmutableArray()`,
`ToImmutableList()` e `ToImmutableDictionary(...)` fazem isso de uma vez.

### ImmutableDictionary e atualizações thread-safe

`ImmutableDictionary<TKey, TValue>` e `ImmutableHashSet<T>` seguem a mesma regra
e são baseados em árvore, então a busca é O(log n) e não o tempo quase constante
do `Dictionary`. Quando várias threads publicam novas versões de uma mesma
referência compartilhada, `ImmutableInterlocked` aplica a mudança com um laço de
compare-and-swap:

```csharp
private ImmutableDictionary<string, int> _counts = ImmutableDictionary<string, int>.Empty;

public void Increment(string key) =>
    ImmutableInterlocked.AddOrUpdate(ref _counts, key, 1, (_, old) => old + 1);
```

### Coleções frozen: construídas uma vez, lidas rápido

`FrozenDictionary<TKey, TValue>` e `FrozenSet<T>` não têm `Add` nem `Remove`.
Criar uma é caro de propósito: ela analisa as chaves e escolhe uma implementação
ajustada para elas. Em troca, a busca é mais rápida do que em `Dictionary` e
`HashSet`:

```csharp
using System.Collections.Frozen;

private static readonly FrozenDictionary<string, string> Mime =
    new Dictionary<string, string>
    {
        [".html"] = "text/html",
        [".json"] = "application/json",
        [".png"]  = "image/png",
    }.ToFrozenDictionary(StringComparer.OrdinalIgnoreCase);

bool ok = Mime.TryGetValue(".JSON", out var type);
```

Isso serve para tabelas criadas na inicialização num campo `static readonly`. É a
ferramenta errada para uma coleção que é montada e descartada a cada requisição.

### Somente leitura não é imutável

`IReadOnlyList<T>` é uma visão: quem guarda o `List<T>` por baixo ainda pode
alterá-lo, e a visão enxerga a mudança. `ImmutableArray<T>` e `FrozenSet<T>` não
têm esse dono, então ninguém pode alterá-los depois de criados.

```csharp
var source = new List<int> { 1, 2 };
IReadOnlyList<int> view = source;
ImmutableArray<int> snapshot = [.. source];

source.Add(3);
Console.WriteLine(view.Count);     // 3: a visão acompanha a lista
Console.WriteLine(snapshot.Length); // 2: o snapshot não
```

## Trade-offs

- **`default(ImmutableArray<T>)` não é um array vazio.** É uma struct não
  inicializada, e ler `Length` ou o indexador lança exceção.
  ```csharp
  ImmutableArray<int> a = default;
  var empty = a.IsDefault;                 // true
  // a.Length -> NullReferenceException; use ImmutableArray<int>.Empty no lugar
  ```
- **A igualdade de `ImmutableArray<T>` compara a referência do array, não os
  elementos.** Um record que guarda uma não ganha igualdade por valor sobre os
  itens.
  ```csharp
  record Tags(ImmutableArray<string> Items);
  new Tags(["a"]) == new Tags(["a"]);   // false: dois arrays diferentes
  // Compare com a.Items.SequenceEqual(b.Items) quando precisar de igualdade por elemento.
  ```
- **Coleções frozen pagam na criação.** `ToFrozenDictionary()` custa mais do que
  copiar para um `Dictionary`, então só compensa quando as leituras superam de
  longe a única construção.
- **Coleções imutáveis alocam a cada mudança.** Num caminho quente que atualiza
  uma coleção grande o tempo todo, um `Dictionary` atrás de um lock pode ser mais
  barato do que criar uma cadeia de nós de árvore a cada atualização.
- **Coleção imutável, itens mutáveis.** Nenhuma das famílias congela os objetos
  de dentro. Um set frozen de objetos mutáveis ainda deixa alguém mudar os campos
  de um objeto, e mudar o dado que gera o hash de uma chave quebra a busca.

## Documentation Links

- [Immutable collections, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable) (doc)
- [ImmutableArray<T> struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutablearray-1) (doc)
- [ImmutableList<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutablelist-1) (doc)
- [ImmutableInterlocked class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.immutable.immutableinterlocked) (doc)
- [FrozenDictionary<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.frozen.frozendictionary-2) (doc)
- [FrozenSet<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.frozen.frozenset-1) (doc)
- [Selecting a collection class, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/selecting-a-collection-class) (doc)
