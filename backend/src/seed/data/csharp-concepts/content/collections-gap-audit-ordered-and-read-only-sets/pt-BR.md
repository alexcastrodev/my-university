---
version: 1.0
updatedAt: 2026-10-15
title: "Auditoria de Lacunas de Coleções: OrderedDictionary e ReadOnlySet"
summary: OrderedDictionary<TKey,TValue> (.NET 9, com overloads que devolvem índice no .NET 10), ReadOnlySet<T>, EnsureCapacity em Queue, Stack e PriorityQueue, e o resultado da auditoria dos conceitos de coleções existentes.
---
## Objective

Os conceitos de coleções já cobrem interfaces, `List<T>`, `Dictionary<TKey, TValue>`,
sets, filas, coleções ordenadas e as famílias imutável e frozen. Este conceito fecha
as lacunas que sobraram, achadas ao auditar esses cinco conceitos contra o capítulo
de coleções do livro: `OrderedDictionary<TKey, TValue>` (.NET 9, com overloads que
devolvem índice no .NET 10), `ReadOnlySet<T>` (.NET 9) e `EnsureCapacity` em
`Queue<T>`, `Stack<T>` e `PriorityQueue<TElement, TPriority>`. Ele também registra o
resultado da auditoria, para você ver o que já estava coberto e quais pequenos
patches foram feitos nos conceitos mais antigos.

## Use Cases

- Um dicionário cuja ordem de enumeração precisa ser a ordem de inserção: campos de
  um formulário, uma configuração ordenada, um objeto estilo JSON que precisa
  ida e volta na mesma ordem.
- Um cache que precisa tanto de "achar por chave" quanto de "despejar a entrada
  inserida primeiro" (posição 0).
- Expor um set de uma classe sem deixar quem chama alterá-lo.
- Pré-dimensionar uma fila ou pilha preenchida em lote, para evitar crescimentos
  repetidos.

## Deep Dive

### OrderedDictionary: busca por chave mais uma posição

`OrderedDictionary<TKey, TValue>` (`System.Collections.Generic`, .NET 9) é um
dicionário que também mantém suas entradas numa lista. A documentação descreve a
complexidade assim: as operações são parecidas com as de `List<T>`, exceto que a
busca por chave é parecida com a de `Dictionary<TKey, TValue>`. O livro o lista
entre as coleções "auto-ordenadas", mas ele não ordena: mantém a ordem de
inserção, o que confirmamos rodando. Se você precisa das chaves em ordem
classificada, `SortedDictionary` continua sendo a ferramenta.

```csharp
var od = new OrderedDictionary<string, int>();
od["banana"] = 2; od["apple"] = 1; od.Add("cherry", 3);
Console.WriteLine(string.Join(",", od.Keys));        // banana,apple,cherry
od["banana"] = 20;                                    // atualizar mantém a posição
od.Remove("apple"); od.Add("apple", 9);
Console.WriteLine(string.Join(",", od.Keys));        // banana,cherry,apple: o reinserido vai por último
Console.WriteLine(od.GetAt(0) + " " + od.IndexOf("cherry"));   // [banana, 20] 1
od.Insert(1, "date", 4);                              // põe uma entrada numa posição
od.SetAt(0, 777);                                     // muda um valor por posição
od.RemoveAt(0);
```

Uma armadilha aparece quando o tipo da chave é `int`: o indexador é por chave, não por
posição. O acesso por posição é `GetAt` e `SetAt`, ou a implementação explícita de
`IList`:

```csharp
var ints = new OrderedDictionary<int, string>();
ints.Add(10, "ten"); ints.Add(5, "five"); ints.Add(7, "seven");
Console.WriteLine(ints[5]);          // five   (chave 5)
Console.WriteLine(ints.GetAt(0));    // [10, ten]   (posição 0)
ints.Add(5, "again");                // ArgumentException: chave duplicada
ints.GetAt(9);                       // ArgumentOutOfRangeException
```

Alterar o dicionário durante um `foreach` lança `InvalidOperationException`, como nas
outras coleções. Ele implementa `IDictionary<TKey, TValue>` e
`IList<KeyValuePair<TKey, TValue>>`, além das versões somente leitura de cada uma,
então dá para entregá-lo a código que espera qualquer um dos formatos. Segundo a
documentação, as operações por índice custam como as de `List<T>`, o que significa
que inserir ou remover cedo num dicionário grande desloca as entradas seguintes.

### Os overloads do .NET 10 que devolvem o índice

Um padrão frequente é "adicionar, ou atualizar se já existe", que consultaria a chave
duas vezes. O .NET 10 acrescenta `TryAdd(key, value, out int index)` e
`TryGetValue(key, out value, out int index)`, para que o segundo passo use a posição:

```csharp
static void Increment(OrderedDictionary<string, int> d, string key)
{
    if (!d.TryAdd(key, 1, out int index))
    {
        int value = d.GetAt(index).Value;
        d.SetAt(index, value + 1);
    }
}
var counts = new OrderedDictionary<string, int>();
foreach (var w in "b a b c b a".Split(' ')) Increment(counts, w);
Console.WriteLine(string.Join(",", counts.Select(kv => $"{kv.Key}:{kv.Value}")));   // b:3,a:2,c:1
Console.WriteLine(counts.TryGetValue("c", out var cv, out int ci) + $" {cv} {ci}");  // True 1 2
```

O resultado também mostra a ordem de primeira aparição (`b`, `a`, `c`), que é o ponto
do tipo. A versão importa, e conferimos compilando: as mesmas duas chamadas falham com
`CS1501` quando o projeto mira `net9.0`, e compilam em `net10.0`. A página de
referência da API para `TryAdd` lista o overload com índice, mas sem dizer em que
versão ele surgiu, então confie na checagem de compilação e no livro, não na página,
quando você fizer multi-targeting.

### ReadOnlySet: o set que faltava

Para listas havia `ReadOnlyCollection<T>`, para dicionários `ReadOnlyDictionary<TKey,
TValue>`, e para sets nada além da interface `IReadOnlySet<T>` (que quem chama pode
descartar com um cast). O .NET 9 acrescenta `ReadOnlySet<T>`, um wrapper em volta de
um `ISet<T>`:

```csharp
var hs = new HashSet<int> { 1, 2, 3 };
var ro = new ReadOnlySet<int>(hs);
Console.WriteLine(ro.Count + " " + ro.Contains(2));          // 3 True
hs.Add(4);
Console.WriteLine(ro.Count);                                  // 4: é uma view viva, não uma cópia
Console.WriteLine((object)ro as HashSet<int> is null);        // True: o cast para HashSet falha
((ICollection<int>)ro).Add(9);                                // NotSupportedException
Console.WriteLine(ro.IsSubsetOf([1, 2, 3, 4, 5]));            // True
```

Ele implementa `IReadOnlySet<T>` e também `ISet<T>` e `ICollection<T>`, com os membros
mutáveis implementados de forma explícita para lançar `NotSupportedException`
(conferimos `Add` e `UnionWith`). Isso o torna um tipo de retorno direto para uma API
que não pode deixar quem chama escrever, e bloqueia o downcast que um
`IReadOnlySet<T>` puro permite. Ainda é uma view: quem segura o `HashSet<T>` original
pode mudar o que os leitores veem, o mesmo aviso do `ReadOnlyCollection<T>`. Se o dado
nunca pode mudar, use `ImmutableHashSet<T>` ou `FrozenSet<T>` do conceito de coleções
imutáveis e frozen.

### EnsureCapacity além de List e Dictionary

Os conceitos anteriores mostram `EnsureCapacity` em `List<T>` e `Dictionary<TKey,
TValue>`. O mesmo método existe em `Queue<T>` e `Stack<T>` (a documentação os lista
desde o .NET 6) e em `PriorityQueue<TElement, TPriority>`, e devolve a capacidade
resultante:

```csharp
var q = new Queue<int>();               Console.WriteLine(q.EnsureCapacity(100) >= 100);    // True
var st = new Stack<int>();              Console.WriteLine(st.EnsureCapacity(100) >= 100);   // True
var pq = new PriorityQueue<int, int>(); Console.WriteLine(pq.EnsureCapacity(50) >= 50);     // True
```

Chame uma vez antes de um preenchimento em lote quando você souber o tamanho, pelo
mesmo motivo de uma lista: uma alocação em vez de vários dobramentos.

### O que a auditoria achou

Cada ponto do capítulo, contra os cinco conceitos existentes:

| Tópico do capítulo | Onde estava coberto |
|---|---|
| Interfaces, views somente leitura, collection expressions e spread | `collection-interfaces-and-choosing-a-collection` |
| `List<T>`, arrays, capacidade e `EnsureCapacity` | `list-and-array-internals` |
| `Dictionary`, `HashSet`, igualdade, sets | `dictionary-hashset-and-equality` |
| `Queue`, `Stack`, `PriorityQueue` (incluindo o `Remove` do .NET 9), coleções ordenadas | `specialized-collections` |
| Coleções imutáveis e frozen | `immutable-and-frozen-collections` |
| `OrderedDictionary<TKey, TValue>`, overloads com índice, `ReadOnlySet<T>`, `EnsureCapacity` em fila e pilha | não cobertos, escritos aqui |

Dois pequenos patches foram aplicados nos conceitos mais antigos: uma frase sobre
`ReadOnlySet<T>` no conceito de interfaces, e uma indicação do `OrderedDictionary` na
nota sobre ordem de enumeração do conceito de dicionários. O `PriorityQueue.Remove` já
estava coberto, então a lista de lacunas é a última linha da tabela.

## Trade-offs

- **`OrderedDictionary` custa mais que `Dictionary`.** Segundo a documentação, as
  operações por posição se comportam como as de `List<T>`, então remover ou inserir
  cedo desloca as entradas seguintes, e ele carrega informação de ordem que um
  `Dictionary` simples não carrega (não medimos a diferença de memória). Use quando a
  ordem for requisito, não como padrão.
- **Ordem de inserção não é ordem classificada.** `OrderedDictionary` não mantém as
  chaves ordenadas. Um `SortedDictionary` mantém, com outro perfil de custo.
- **Uma API posicional ao lado de uma por chave convida a erros.** Com chaves `int`,
  `od[5]` e `od.GetAt(5)` significam coisas diferentes, e nenhum dos dois é erro de
  compilação. Use um tipo próprio para a chave quando puder.
- **`ReadOnlySet<T>` é uma view, não um snapshot.** Devolvê-lo de um método que expõe
  um set interno ainda deixa o dono mudá-lo depois, e quem chama vê a mudança. Devolva
  um set imutável ou frozen quando precisar de snapshot.
- **Uma API específica de versão quebra o multi-targeting.** Os overloads que
  devolvem índice compilam em `net10.0` e não em `net9.0`, então uma biblioteca que
  mira os dois precisa de compilação condicional ou dos overloads simples.

## Documentation Links

- [OrderedDictionary<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.ordereddictionary-2) (doc)
- [ReadOnlySet<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.objectmodel.readonlyset-1) (doc)
- [PriorityQueue<TElement,TPriority>.Remove method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.priorityqueue-2.remove) (doc)
- [Queue<T>.EnsureCapacity method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.queue-1.ensurecapacity) (doc)
- [Commonly used collection types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/commonly-used-collection-types) (doc)
