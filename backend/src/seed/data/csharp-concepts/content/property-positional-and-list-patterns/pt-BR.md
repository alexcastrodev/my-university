---
version: 1.0
updatedAt: 2026-10-15
title: "Property, Positional e List Patterns"
summary: Property patterns estendidos, positional patterns via Deconstruct e tuplas, list patterns com slice sobre arrays, listas, spans e strings, o custo dos slices, exaustividade com sequências e casos reais como parser de comandos e máquina de estados.
---
## Objective

Patterns de tipo, constante e relacionais testam um valor isolado. Os patterns
recursivos olham para dentro dele: um property pattern testa membros, um
positional pattern desconstrói o valor e testa cada parte, e um list pattern
testa os elementos de uma sequência, com um slice `..` para "qualquer quantidade
de elementos aqui". Como cada um deles contém patterns aninhados, eles se
combinam numa expressão que descreve a forma dos dados, de
`{ Address.City: "Lisbon" }` a `["move", var x, var y]`. Este conceito explica o
que cada pattern exige do tipo, quais métodos o compilador chama (e quantas
vezes), onde os slices alocam, como a exaustividade funciona com sequências, e
dois lugares onde esses patterns se pagam: parsers de comando e máquinas de
estado.

## Use Cases

- Checar uma condição aninhada como "cliente em Portugal com pelo menos um
  pedido" sem uma cadeia de checagens de null.
- Despachar sobre um par de valores, como o estado atual e um gatilho que chega,
  com um `switch` sobre tupla.
- Fazer parsing de entrada tokenizada (`args`, `line.Split(' ')`) pela forma: um
  verbo e depois uma quantidade fixa ou variável de argumentos.
- Casar o começo e o fim de uma string, array ou span capturando o meio.

## Deep Dive

### Property patterns

Um property pattern `{ Membro: pattern, ... }` casa quando o valor não é `null`
e cada propriedade ou campo listado casa com o pattern aninhado. Desde o C# 10,
a forma estendida `{ A.B: pattern }` alcança membros aninhados, e é segura contra
null em cada passo:

```csharp
record Address(string City, string Country);
record Customer(string Name, Address? Address, int Orders);

var withAddr = new Customer("Ana", new Address("Lisbon", "PT"), 3);
var noAddr   = new Customer("Bia", null, 0);

noAddr   is { Address.City: "Lisbon" };              // False, sem NullReferenceException
withAddr is { Address.City: "Lisbon", Orders: > 0 }; // True
withAddr is { Address: { Country: "PT" } };          // True, a forma aninhada anterior ao C# 10
```

O property pattern vazio `{ }` casa com qualquer valor não nulo, o que faz de
`maybe is { } nonNull` um jeito compacto de testar e capturar num passo só, e um
property pattern pode levar um tipo e uma variável:
`string { Length: > 2 } name`.

### Positional patterns

Um positional pattern `(p1, p2, ...)` chama um método `Deconstruct` com a
quantidade correspondente de parâmetros `out` e testa cada saída. Records
posicionais ganham `Deconstruct` de graça; tuplas funcionam direto; qualquer
outro tipo pode declarar o método. O compilador o chama uma vez por `switch`, e
não uma vez por braço. Com um contador dentro do `Deconstruct`, este switch de
quatro braços registra uma única chamada:

```csharp
string where = new Point(3, 0) switch
{
    (0, 0) => "origin",
    (_, 0) => "on X axis",
    (0, _) => "on Y axis",
    _ => "elsewhere",
};
// on X axis, Deconstruct calls = 1
```

Uma aridade errada falha na compilação: `p is (1, 2, 3)` num record de dois
membros dá CS1501 "No overload for method 'Deconstruct' takes 3 arguments" e
CS8129 "No suitable 'Deconstruct' instance or extension method was found".

Positional patterns aceitam nomes de elementos (`is (Sum: var sum, Count: > 0)`),
podem ter um tipo na frente (`Circle(> 1) c`) e também funcionam sobre uma tupla
boxed tipada como `object`, pela interface `ITuple`: `object boxed = (1, "x");
boxed is (1, _)` é `True`.

Switches sobre tuplas são o jeito natural de escrever uma máquina de estados.
Cada transição é uma linha, e o braço de descarte documenta o que é inválido:

```csharp
static State Next(State state, Trigger t) => (state, t) switch
{
    (State.Closed, Trigger.Open)   => State.Open,
    (State.Open,   Trigger.Close)  => State.Closed,
    (State.Closed, Trigger.Lock)   => State.Locked,
    (State.Locked, Trigger.Unlock) => State.Closed,
    _ => throw new InvalidOperationException($"{t} is not valid in {state}"),
};
// Next(State.Open, Trigger.Lock) lança: "Lock is not valid in Open"
```

### List patterns (C# 11)

Um list pattern `[p1, p2, ...]` casa com uma sequência cujo tamanho é igual à
quantidade de patterns e cujos elementos casam com eles, em ordem. O slice
pattern `..` casa com zero ou mais elementos, pode aparecer no máximo uma vez e
pode capturar o que casou com `.. var rest`:

```csharp
int[] nums = [1, 2, 3, 4];
nums switch
{
    [] => "empty",
    [var only] => $"one: {only}",
    [var first, .. var rest] => $"first {first}, rest [{string.Join(",", rest)}]",
};
// first 1, rest [2,3,4]

"aBBA" is ['a' or 'A', .. var mid, 'a' or 'A'];   // True, mid = "BB"
```

O tipo de entrada precisa ser contável (um `Length` ou `Count` acessível) e
indexável (um indexador de `int` ou `Index`). Capturar um slice exige ainda um
indexador de `Range` ou um método `Slice(int, int)`. Isso exclui alguns tipos:

```csharp
IEnumerable<int> e = ...;
e is [1, ..];
// error CS8985: List patterns may not be used for a value of type
// 'IEnumerable<int>'. No suitable 'Length' or 'Count' property was found.

a is [.., 1, ..];
// error CS8980: Slice patterns may only be used once and directly inside a list pattern.

bag is [_, .. var rest];   // Bag tem Count e this[int], mas não tem Slice
// error CS1503: Argument 1: cannot convert from 'System.Range' to 'int'
bag is [_, ..];            // compila: slice sem captura não precisa de Slice
```

### Quanto custam os slices

O código gerado testa primeiro o tamanho, depois os elementos de que precisa, e
só então produz o slice, chamando um método diferente para cada tipo. Um build
Release desmontado de `x is [_, .. var r]` mostra:

| Tipo de entrada | Chamada que monta `r` | Aloca? |
|---|---|---|
| `int[]` | `RuntimeHelpers.GetSubArray` | sim, um array novo |
| `List<int>` | `List<int>.Slice` | sim, uma lista nova |
| `string` | `string.Substring` | sim, uma string nova |
| `Span<int>` | `Span<int>.Slice` | não, é uma view |

Então uma recursão `[var head, .. var tail]` sobre um array copia a cada chamada,
a mesma armadilha quadrática do `Substring` repetido. Em caminhos quentes, case
sobre um `ReadOnlySpan<T>` (um array converte implicitamente) ou descarte o
slice e indexe direto.

### Exaustividade com sequências

O compilador raciocina sobre tamanhos. `a switch { [] => 0, [_] => 1 }` sobre um
`int[]` gera o aviso CS8509 com o pattern de exemplo `'{ Length: 2 }'`, enquanto
`[]`, `[_]` e `[_, _, ..]` juntos compilam sem aviso, porque cobrem todos os
tamanhos. A referência da linguagem diz que list patterns não geram o aviso de
não exaustividade; com o SDK 10.0.100 eles geram neste caso, então confie na
saída do compilador mais do que nessa frase. Subsunção também funciona: `[1, 2]`
depois de `[_, ..]` é o erro CS8510.

### Um parser de comandos

Quebrar uma linha e casar sobre o array resultante dá um parser legível, em que
a forma de cada comando aparece de relance:

```csharp
static string Parse(string line) => line.Split(' ', StringSplitOptions.RemoveEmptyEntries) switch
{
    ["move", var x, var y] when int.TryParse(x, out var dx) && int.TryParse(y, out var dy)
                       => $"move by ({dx}, {dy})",
    ["say", .. var words] => $"say '{string.Join(' ', words)}'",
    ["quit" or "exit"]    => "bye",
    [var cmd, ..]         => $"unknown command '{cmd}'",
    []                    => "empty line",
};
// "move 3 4" -> move by (3, 4)
// "say hello world" -> say 'hello world'
// "jump" -> unknown command 'jump'
```

## Trade-offs

- **Patterns profundos podem esconder a intenção.** Um pattern com três níveis e
  vários combinadores é difícil de revisar. Extraia um método ou propriedade com
  nome quando o pattern deixar de ler como uma frase.
  ```csharp
  static bool IsDomesticBuyer(Customer c) => c is { Address.Country: "PT", Orders: > 0 };
  ```
- **Positional patterns acoplam quem chama à ordem dos membros.** Reordenar os
  parâmetros de um record posicional muda em silêncio o que `(0, _)` significa.
  Property patterns nomeiam os membros e sobrevivem à reordenação.
- **Slices alocam em arrays, listas e strings.** Capturar `.. var rest` copia.
  Use spans ou descarte o slice em laços e recursão.
- **List patterns exigem tipos contáveis e indexáveis.** `IEnumerable<T>` e
  queries LINQ preguiçosas não podem ser casadas; materializá-las para casar custa
  uma enumeração completa.
- **Guardas `when` continuam fora da análise.** No parser acima, o braço `move`
  com guarda não cobre `["move", "a", "b"]`; quem pega é o braço
  `[var cmd, ..]`. Mantenha um braço genérico depois dos braços com guarda.

## Lab

Neste lab você recebe a classe estática `Patterns` com sete métodos **esboçados**, que lançam `NotImplementedException`, e testes xUnit prontos. O seu trabalho é implementá-los casando a forma de objetos, tuplas e sequências com padrões de propriedade, posicionais e de lista. A ideia central é ver o que cada padrão permite e quando ele não pode ser usado: um padrão de propriedade estendido é seguro contra `null`, um posicional exige `Deconstruct`, e um padrão de lista aceita uma fatia, mas a ordem dos braços decide qual caso vence.

**O cenário**

Pequenos casos reais: filtrar clientes, classificar coordenadas, controlar uma porta, interpretar comandos e descrever sequências.

- `Models.cs`: os records `Address(City, Country)`, `Customer(Name, Address?, Orders)` e `Point(X, Y)`, e os enums `State` (`Closed`, `Open`, `Locked`) e `Trigger` (`Open`, `Close`, `Lock`, `Unlock`).
- `Patterns.cs`: os métodos a implementar, um por TODO, cada um com a lista de casos no comentário.
- `PatternTests.cs`: os testes, com bordas como endereço nulo, linhas com espaços extras e comandos com números inválidos.

Como `Customer` e `Point` são records, o `Deconstruct` já existe e os padrões posicionais funcionam sem código extra.

**O que você vai fazer, passo a passo**

1. **Padrão de propriedade estendido (TODO-00).** Em `IsLisbonRegular`, use um único padrão com `Address.City` e `Orders > 0`. Se `Address` for `null`, a resposta deve ser `false`, sem exceção.
2. **Padrão posicional (TODO-01).** Em `Quadrant`, faça switch no `Point` combinando padrões relacionais e descartes (`_`) para devolver `origin`, `x-axis`, `y-axis` e `Q1` a `Q4`.
3. **Máquina de estados com tupla (TODO-02).** Em `Next`, faça switch em `(state, trigger)` com as quatro transições válidas. O braço de descarte lança `InvalidOperationException` com a mensagem `"{trigger} is not valid in {state}"`.
4. **Padrões de lista e fatias (TODO-03 e TODO-04).** Em `Describe`, trate `[]`, um elemento e `[var first, .. var rest]`, juntando a fatia com vírgula. Em `Inner`, use um único padrão de lista sobre a `string` com fatia para extrair o que está entre `(` e `)`, ou `null` se o texto não estiver embrulhado.
5. **Parser de comandos (TODO-05).** Em `Parse`, divida a linha por espaços (ignorando entradas vazias) e faça switch no array. A ordem importa: um `move` com números inválidos precisa cair em `unknown command 'move'`, o que pede um `when` ou um padrão que valide os inteiros.
6. **Tuplas boxeadas e records (TODO-06).** Em `IsOrigin`, o parâmetro é `object`: o padrão posicional funciona sobre a tupla boxeada, e para `Point` você precisa de um padrão de tipo antes (`Point(0, 0)`).

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `IsLisbonRegular` não lança com `Address` nulo e por que a ordem dos braços em `Parse` muda o resultado.

**Desafios opcionais**

- **TODO-07:** crie `Sum(ReadOnlySpan<int>)` com recursão `[var head, .. var tail]`. Por que não aloca para um span, mas alocaria para um `int[]`?
- **TODO-08:** crie uma classe `Rgb` com seu próprio `Deconstruct` e um método `IsGray(Rgb)` que a casa com um padrão posicional.

**Pré-requisitos:** padrões de tipo, constante e relacionais, records e switch expressions, e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Cada método esboçado lança `NotImplementedException` e traz um comentário `TODO-NN` com os casos esperados, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Patterns, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/patterns) (doc)
- [Deconstructing tuples and other types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/functional/deconstruct) (doc)
- [List and slice patterns, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/patterns/list-patterns) (doc)
- [Extended property patterns, C# 10 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-10.0/extended-property-patterns) (doc)
- [Tutorial: Build algorithms with pattern matching, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/build-algorithms-using-pattern-matching) (doc)
