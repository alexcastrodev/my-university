---
version: 1.0
updatedAt: 2026-10-14
title: "LINQ: Famílias de Operadores e Sintaxe de Query"
summary: Mapa das famílias de operadores do LINQ, como o compilador reescreve a sintaxe de query (let, into, identificadores transparentes) e ordenação estável, ThenBy, Order() e comparação de strings sensível à cultura.
---
## Objective

`System.Linq.Enumerable` tem bem mais de cinquenta operadores, e a maioria das
pessoas aprende um de cada vez pelo autocomplete. Vale mais enxergá-los como um
punhado de famílias: quando você sabe que `Single` é um operador de elemento e
`Any` é um quantificador, já sabe como cada um se comporta numa sequência vazia
antes de abrir a documentação. A outra metade do quadro é a sintaxe de query.
`from ... where ... select` não é um motor separado; o compilador a reescreve em
chamadas de método comuns, pelo nome, e entender essa reescrita explica o `let`,
o `into` e por que alguns operadores só existem como método. Este conceito mapeia
as famílias de operadores, mostra o lowering da sintaxe de query e entra a fundo
em ordenação: sort estável, `ThenBy`, `Order()` e comparação de strings sensível à
cultura. Execução adiada, streaming versus buffering e os operadores do .NET 9
estão no conceito pré-requisito e não se repetem aqui.

## Use Cases

- Escolher entre `First`, `Single` e as versões `OrDefault` pelo que os dados
  garantem, e não pela primeira que compilou.
- Ler uma query em sintaxe de query e saber exatamente quais métodos ela chama, o
  que importa quando ela roda contra o EF Core.
- Ordenar por várias chaves sem que o segundo `OrderBy` descarte o primeiro em
  silêncio.
- Obter a mesma ordem no notebook do desenvolvedor e num container com outra
  cultura.
- Extrair os itens de um tipo de uma lista heterogênea sem exceção de cast.

## Deep Dive

### As famílias de operadores

Agrupar os operadores pelo que eles devolvem explica a maior parte do
comportamento:

| Família | Operadores | Devolve |
|---|---|---|
| Restrição | `Where`, `OfType` | menos itens, mesmo formato |
| Projeção | `Select`, `SelectMany`, `Cast`, `Zip` | os mesmos ou mais itens, formato novo |
| Particionamento | `Take`, `Skip`, `TakeWhile`, `SkipWhile`, `TakeLast`, `Chunk` | uma fatia |
| Ordenação | `OrderBy`, `ThenBy`, `Order`, `Reverse` (e as formas `Descending`) | os mesmos itens, outra ordem |
| Conjuntos | `Distinct`, `Union`, `Intersect`, `Except` (e as formas `By`) | itens sem duplicatas |
| Agrupamento e joins | `GroupBy`, `Join`, `GroupJoin`, `LeftJoin`, `RightJoin`, `ToLookup` | itens combinados ou aninhados |
| Elemento | `First`, `Last`, `Single`, `ElementAt` (e as formas `OrDefault`) | um item |
| Quantificadores | `Any`, `All`, `Contains`, `SequenceEqual` | `bool` |
| Agregação | `Count`, `Sum`, `Min`, `Max`, `Average`, `Aggregate`, `MinBy`, `MaxBy` | um valor |
| Conversão | `ToList`, `ToArray`, `ToDictionary`, `ToHashSet`, `AsEnumerable` | uma coleção ou uma sequência com outro tipo |
| Geração | `Enumerable.Range`, `Repeat`, `Empty` | uma sequência nova |

Os operadores que devolvem sequência são preguiçosos; os que devolvem um valor
único ou uma coleção executam a query na hora. Conjuntos, joins e agrupamento têm
um conceito próprio, e agregação e paginação têm outro.

### Operadores de elemento e sequências vazias

É na família de elemento que a escolha carrega significado. `First` diz "existe
pelo menos um", `Single` diz "existe exatamente um" e confere, e as versões
`OrDefault` dizem "zero é uma resposta normal":

```csharp
int[] empty = [];
Console.WriteLine(empty.FirstOrDefault(-1));   // -1: a sobrecarga do .NET 6 escolhe o default
new[] { 1, 2 }.Single();                       // InvalidOperationException: Sequence contains more than one element
Console.WriteLine(empty.All(x => x > 100));    // True: nada contradiz o predicado
```

`Single` precisa ler além do primeiro match para provar que não há um segundo,
então custa mais que `First` e transforma um bug de dados numa exceção no lugar
certo. `All` numa sequência vazia é `true` (verdade vacuamente), então uma
checagem como "todos os itens estão em estoque" normalmente precisa de um `Any()`
junto.

### Sintaxe de query é uma reescrita em chamadas de método

O compilador traduz uma query expression em chamadas de método pelo nome, e só
depois faz a resolução de sobrecarga. Dá para ver a reescrita rodando a query
sobre `AsQueryable()`, que registra as chamadas como uma árvore de expressão em
vez de executá-las:

```csharp
string[] words = ["apple", "fig", "banana", "kiwi", "cherry"];
var q = from w in words.AsQueryable()
        where w.Length > 3
        select w;
Console.WriteLine(q.Expression);
// System.String[].Where(w => (w.Length > 3))
```

O `select w` sumiu: um select que devolve a variável de range sem mudança é
descartado quando outra cláusula já produziu a sequência. As outras cláusulas se
mapeiam de forma igualmente direta: `orderby a, b descending` vira
`OrderBy(...).ThenByDescending(...)`, `group w by w.Length` vira
`GroupBy(w => w.Length)`, um segundo `from` vira `SelectMany`, e
`join ... on ... equals` vira `Join`.

Como a reescrita é pelo nome, qualquer tipo com métodos `Where` e `Select`
adequados funciona com sintaxe de query, mesmo um que não seja sequência:

```csharp
var box = new Box<int>(20);
var r = from x in box where x > 10 select x * 2;
Console.WriteLine(r.Value);   // imprime "Box.Where", "Box.Select" e depois 40

class Box<T>(T value)
{
    public T Value => value;
    public Box<T> Where(Func<T, bool> p) { Console.WriteLine("Box.Where"); return p(Value) ? this : new Box<T>(default!); }
    public Box<U> Select<U>(Func<T, U> f) { Console.WriteLine("Box.Select"); return new Box<U>(f(Value)); }
}
```

Esse é o "query expression pattern" da especificação do C#, e é assim que
bibliotecas de parsers ou de tipos opcionais reaproveitam a sintaxe.

### `let`, `into` e identificadores transparentes

`let` introduz um valor calculado uma vez por item. Não existe método `Let`,
então o compilador empacota o item original e o valor novo num tipo anônimo e
carrega esse objeto pelo resto da query:

```csharp
var q = from w in words.AsQueryable()
        let len = w.Length
        where len > 3
        orderby len descending, w
        select new { w, len };
Console.WriteLine(q.Expression);
// System.String[].Select(w => new <>f__AnonymousType0`2(w = w, len = w.Length))
//   .Where(<>h__TransparentIdentifier0 => (<>h__TransparentIdentifier0.len > 3))
//   .OrderByDescending(<>h__TransparentIdentifier0 => <>h__TransparentIdentifier0.len)
//   .ThenBy(<>h__TransparentIdentifier0 => <>h__TransparentIdentifier0.w)
//   .Select(<>h__TransparentIdentifier0 => new <>f__AnonymousType0`2(...))
```

Esse parâmetro gerado pelo compilador é um identificador transparente: no seu
código você continua escrevendo `len` e `w`, e o compilador os reescreve como
acesso a membros do objeto escondido. Cada `let` acrescenta mais uma camada, o
que significa uma alocação extra por item em memória e uma projeção extra que um
provider de banco precisa entender.

`into` termina uma query e começa outra sobre o resultado dela, que é como você
filtra depois de agrupar:

```csharp
var lengths = from w in words
              group w by w.Length into g
              where g.Count() > 1
              select g.Key;          // 6 (banana e cherry)
```

Operadores sem cláusula (`Count`, `Distinct`, `Take`, `First`, `Sum`) são
chamados envolvendo a query em parênteses, então a maior parte do código real
mistura os dois estilos.

### Ordenação: estável, componível e sensível à cultura

`OrderBy` é documentado como sort estável: itens com chaves iguais mantêm a ordem
relativa original. Um segundo `OrderBy`, porém, começa uma nova ordenação
primária, e a primeira só sobrevive como efeito colateral dessa estabilidade:

```csharp
var people = new[] { ("Ana", 30), ("Bia", 25), ("Caio", 30), ("Duda", 25) };

people.OrderBy(p => p.Item2);
// (Bia, 25), (Duda, 25), (Ana, 30), (Caio, 30)

people.OrderBy(p => p.Item2).OrderBy(p => p.Item1.Length);
// (Bia, 25), (Ana, 30), (Duda, 25), (Caio, 30): ordenado só pelo tamanho do nome

people.OrderBy(p => p.Item1.Length).ThenBy(p => p.Item2);
// mesmo resultado, mas a intenção fica explícita e não depende da estabilidade
```

Use `ThenBy` para chaves secundárias. Em `IQueryable`, a estabilidade não é
garantida de jeito nenhum: o `ORDER BY` do SQL devolve empates em qualquer ordem,
a não ser que você acrescente uma coluna única como última chave.

O .NET 7 trouxe `Order()` e `OrderDescending()` para ordenar pelo próprio item.
Eles usam `Comparer<T>.Default`, que falha em runtime para tipos que não
implementam `IComparable`, e para strings compara usando a cultura atual:

```csharp
string[] names = ["b", "a", "B", "A", "é", "e"];
CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("en-US");
names.Order();                          // a A b B e é
names.Order(StringComparer.Ordinal);    // A B a b e é

new[] { new object(), new object() }.Order().ToList();
// InvalidOperationException: Failed to compare two elements in the array.
```

Passe `StringComparer.Ordinal` (ou `OrdinalIgnoreCase`) quando a ordem for
consumida por código, como chaves, nomes de arquivo ou saída determinística, e
deixe a ordem sensível à cultura para texto mostrado a pessoas.

### `OfType` versus `Cast`

Os dois transformam uma sequência não genérica ou de tipo frouxo numa sequência
tipada. `OfType<T>` filtra, `Cast<T>` afirma:

```csharp
object[] mixed = [1, "two", 3, null!, 4L];
mixed.OfType<int>();   // 1, 3: strings, null e o long são pulados
mixed.Cast<int>();     // InvalidCastException quando chega em "two"
```

`Cast<int>` faz unboxing, então um `long` boxed não é convertido para `int`
mesmo que o valor caiba.

## Trade-offs

- **Sintaxe de query lê bem em joins e `let`, e mal no resto.** Ela não tem
  cláusula para `Count`, `Take` ou `Distinct`, então a query costuma terminar
  metade em cada estilo. Escolha um estilo por query quando puder.
- **`let` aloca.** Cada `let` embrulha o item atual num objeto anônimo novo. Num
  laço quente em memória, um único `Select` para uma tupla ou uma função local
  sai mais barato.
- **`Single` é mais seguro e mais lento que `First`.** Ele lê pelo menos um item
  a mais para provar a unicidade, o que no banco vira `TOP(2)` ou `LIMIT 2`.
  ```csharp
  users.Single(u => u.Email == email);  // lança exceção se o email "único" estiver duplicado
  ```
- **A ordem padrão de strings depende da máquina.** A mesma chamada a `Order()`
  pode ordenar diferente sob outra cultura ou outra versão do ICU, então saída
  ordenada em testes ou nomes de arquivo deve usar um comparer ordinal.
- **`OfType` esconde problemas de dados.** Ele descarta em silêncio os itens do
  tipo errado, o que é certo para uma coleção mista e errado quando todo item
  deveria ser um `T`; use `Cast` quando um tipo inesperado for bug.

## Documentation Links

- [Standard query operators overview, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/standard-query-operators/) (doc)
- [Write LINQ queries (query syntax versus method syntax), C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/linq/get-started/write-linq-queries) (doc)
- [Query expressions, C# language specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/expressions#1223-query-expressions) (doc)
- [Enumerable.OrderBy method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.orderby) (doc)
- [Enumerable.Order method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.linq.enumerable.order) (doc)
- [let clause, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/let-clause) (doc)
