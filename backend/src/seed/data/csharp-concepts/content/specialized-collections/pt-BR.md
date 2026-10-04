---
version: 1.0
updatedAt: 2026-10-04
title: "Coleções Especializadas"
summary: Queue, Stack, LinkedList, SortedDictionary vs SortedList, SortedSet e PriorityQueue, com o custo de cada estrutura e os limites que surpreendem.
---
## Objective

`List<T>`, `Dictionary<TKey, TValue>` e `HashSet<T>` cobrem a maior parte do
código, e as coleções especializadas existem para os casos em que o padrão de
acesso é o ponto: primeiro a entrar, primeiro a sair; último a entrar, primeiro
a sair; sempre o menor item em seguida; ou chaves que precisam voltar em ordem.
Escolher uma delas é sobretudo saber em que cada uma é construída, porque a
estrutura de dados decide quais operações são baratas. Este conceito cobre
`Queue<T>`, `Stack<T>`, `LinkedList<T>`, as coleções ordenadas e
`PriorityQueue<TElement, TPriority>`, com seus custos e os limites que
surpreendem.

## Use Cases

- Processar itens de trabalho na ordem de chegada, ou desfazer ações na ordem
  inversa.
- Um scheduler que precisa sempre escolher a tarefa com o prazo mais próximo.
- Manter um ranking ou um índice de tempo que pode ser percorrido na ordem das
  chaves e consultado por intervalo.
- Um cache que move entradas para a frente a cada acerto e remove pelo fim.
- Mesclar ou buscar em entradas grandes, onde um heap ou uma estrutura ordenada
  evita ordenar tudo de novo a cada vez.

## Deep Dive

### Queue e Stack

`Queue<T>` é um array circular: `Enqueue` adiciona no fim, `Dequeue` remove do
início, e ambos são O(1) amortizado. `Stack<T>` também é um array, com `Push` e
`Pop` no topo. Os dois lançam `InvalidOperationException` quando você lê de uma
coleção vazia, então use os métodos `Try` quando estar vazia é normal:

```csharp
var queue = new Queue<string>();
queue.Enqueue("a");
queue.Enqueue("b");
while (queue.TryDequeue(out var item))
    Console.WriteLine(item);          // a, depois b

var undo = new Stack<Action>();
undo.Push(() => Console.WriteLine("undo 1"));
if (undo.TryPop(out var action)) action();
```

Não existe uma fila de duas pontas embutida. Se você precisa adicionar e remover
nas duas extremidades (o `ArrayDeque` do Java), `LinkedList<T>` oferece
`AddFirst`, `AddLast`, `RemoveFirst` e `RemoveLast`, e para cenários de produtor
e consumidor entre threads, `ConcurrentQueue<T>` e `System.Threading.Channels`
são as ferramentas, e não estes tipos.

### LinkedList: raramente a resposta certa

`LinkedList<T>` é uma lista duplamente encadeada de nós. Inserir ou remover ao
lado de um nó que você já tem é O(1), mas não há índice, achar um item é O(n), e
cada item é um objeto separado no heap, então a travessia salta pela memória:

```csharp
var lru = new LinkedList<string>();
var node = lru.AddFirst("page-1");
lru.AddFirst("page-2");

// O(1) porque temos o nó: move um acerto para a frente.
lru.Remove(node);
lru.AddFirst(node);
```

Ela se justifica quando você guarda os nós (um cache LRU é o caso clássico). Para
a maioria dos outros usos, um `List<T>` é mais rápido até para inserção no meio,
porque o deslocamento acontece em memória contígua.

### SortedDictionary, SortedList e SortedSet

As três mantêm as chaves ordenadas e custam O(log n) na busca, mas são
construídas de formas diferentes:

```csharp
var tree = new SortedDictionary<int, string>();   // árvore rubro-negra
var array = new SortedList<int, string>();         // dois arrays paralelos
var set = new SortedSet<int> { 5, 1, 9, 3 };       // árvore rubro-negra, valores únicos

tree[10] = "ten";            // inserção O(log n)
array[10] = "ten";           // inserção O(n) no meio, O(1) no fim se as chaves chegam em ordem
var between = set.GetViewBetween(2, 6);   // 3, 5: uma visão viva do intervalo
```

`SortedDictionary` tem inserções e remoções mais rápidas para dados fora de
ordem, mas usa mais memória por entrada. `SortedList` usa menos memória, permite
acesso por índice (`Keys[i]`, `Values[i]`) e é a melhor escolha quando os dados
são carregados uma vez, de preferência já ordenados, e depois quase só lidos.
`SortedSet<T>` acrescenta `Min`, `Max` e `GetViewBetween` para consultas por
intervalo.

### PriorityQueue

`PriorityQueue<TElement, TPriority>` (.NET 6) é um heap: o item com o menor valor
de prioridade sai primeiro, em O(log n), e espiar o topo é O(1):

```csharp
var pq = new PriorityQueue<string, int>();
pq.Enqueue("low", 10);
pq.Enqueue("urgent", 1);
pq.Enqueue("medium", 5);

while (pq.TryDequeue(out var task, out var priority))
    Console.WriteLine($"{priority}: {task}");   // 1: urgent, 5: medium, 10: low

// Maior primeiro: inverta a comparação.
var max = new PriorityQueue<string, int>(Comparer<int>.Create((a, b) => b.CompareTo(a)));
```

`UnorderedItems` enumera os elementos junto com suas prioridades sem ordem
definida, o que serve para inspeção, mas não para processar em ordem. Dois
limites importam: a fila não é estável, então itens com a mesma prioridade podem
sair em qualquer ordem, e a prioridade de um elemento que já está dentro não
pode ser alterada.

## Trade-offs

- **`PriorityQueue` não é estável.** Prioridades iguais não mantêm a ordem de
  inserção, então uma fila de tarefas que precisa ser justa entre iguais exige um
  critério de desempate.
  ```csharp
  // Use uma tupla como prioridade: (prioridade, número de sequência) para manter a ordem de chegada.
  var pq = new PriorityQueue<string, (int Priority, long Seq)>();
  pq.Enqueue("a", (1, seq++));
  pq.Enqueue("b", (1, seq++));   // "a" sai antes de "b"
  ```
- **Não dá para atualizar uma prioridade no lugar.** Algoritmos no estilo de
  Dijkstra costumam enfileirar uma duplicata com a prioridade melhor e ignorar as
  entradas obsoletas quando elas saem, em vez de reduzir a antiga. Versões mais
  recentes do .NET adicionam um método de remoção, mas ele percorre o heap, então
  é O(n).
- **`LinkedList<T>` custa memória e velocidade.** Cada nó carrega duas
  referências mais o cabeçalho do objeto, e a travessia perde o cache da CPU.
  Escolha-a pelos handles de nó, não porque a operação é "inserção".
- **Inserções em `SortedList` são O(n).** Adicionar chaves em ordem aleatória
  desloca os arrays a cada vez, por isso um `SortedDictionary` pode vencê-la em
  dados com muita escrita, e um `SortedList` ganha em dados construídos uma vez e
  lidos muitas.
- **Alterar uma coleção enquanto ela é enumerada lança exceção.** `Queue<T>`,
  `Stack<T>` e as coleções ordenadas controlam uma versão, então adicionar dentro
  de um `foreach` sobre a mesma coleção gera `InvalidOperationException`.
  ```csharp
  foreach (var x in queue) queue.Enqueue(x); // InvalidOperationException
  ```

## Documentation Links

- [Selecting a collection class, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/selecting-a-collection-class) (doc)
- [Queue<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.queue-1) (doc)
- [Stack<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.stack-1) (doc)
- [LinkedList<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.linkedlist-1) (doc)
- [SortedDictionary<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.sorteddictionary-2) (doc)
- [SortedList<TKey,TValue> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.sortedlist-2) (doc)
- [SortedSet<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.sortedset-1) (doc)
- [PriorityQueue<TElement,TPriority> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.priorityqueue-2) (doc)
