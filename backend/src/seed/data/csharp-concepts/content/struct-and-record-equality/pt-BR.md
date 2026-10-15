---
version: 1.0
updatedAt: 2026-10-15
title: "Igualdade em Structs e Records"
summary: Os padrões de igualdade de classes, structs, records, tuplas e arrays lado a lado, o hash fraco da struct comum, como implementar IEquatable<T> numa struct, como customizar a igualdade de um record com coleções e como manter Equals simétrico numa hierarquia de classes.
---
## Objective

"Esses dois são iguais?" tem uma resposta padrão diferente para cada tipo de
C#. Uma classe compara referências, uma struct comum compara campos por
reflexão mas não tem `==`, um record compara campos e tem `==`, uma tupla
compara elemento a elemento, e um array compara referências mesmo quando o
conteúdo bate. Este conceito põe esses padrões lado a lado, mostra onde cada um
dá errado (um hash de struct que ignora campos, um record com uma lista que
nunca é igual, uma hierarquia de classes que quebra a simetria) e como
implementar igualdade por valor do jeito certo quando o padrão não basta. O
contrato geral de `Equals`/`GetHashCode` e o bug da chave mutável estão em
Dictionary, HashSet, and Equality; o que um record gera está em Records and
with Expressions.

## Use Cases

- Value objects (`Money`, `DateRange`, `Coordinate`) que precisam comparar por
  conteúdo e funcionar como chave de dicionário.
- Structs pequenas usadas em caminho quente ou como chave, onde igualdade com
  boxing tem custo.
- Records que guardam coleções, como um pedido com linhas ou um DTO com tags,
  e que deveriam comparar pelo conteúdo.
- Comparar arrays, tuplas e chaves compostas em testes e caches.

## Deep Dive

### Os padrões, medidos

| Tipo | `a == b` | `a.Equals(b)` | Hash |
|---|---|---|---|
| class | referência | referência | por objeto |
| struct comum | CS0019, sem operador | campo a campo via `ValueType.Equals` | `ValueType.GetHashCode`, fraco |
| `record` / `record struct` | campo a campo | campo a campo | combina todos os campos |
| tupla | elemento a elemento | elemento a elemento | combina todos os elementos |
| array | referência | referência | por objeto |

```csharp
int[] a = [1, 2, 3]; int[] b = [1, 2, 3];
a == b;                                                    // False
a.SequenceEqual(b);                                        // True
StructuralComparisons.StructuralEqualityComparer.Equals(a, b); // True, e os hashes batem

var t1 = (Id: 1, Name: "a"); var t2 = (Key: 1, Label: "a");
t1 == t2;                       // True: nomes são ignorados, posições importam
(1, 2L) == (1L, 2);             // True: elementos convertem como num == comum
(1, new List<int> { 1 }) == (1, new List<int> { 1 });   // False: List compara referências
```

O `==` de tuplas (C# 7.3) avalia todos os elementos dos dois lados antes, depois
compara os pares em ordem e para na primeira diferença. Cada membro é comparado
com a sua própria igualdade, e é por isso que uma tupla, um record ou uma struct
com um `List<T>` ou um array nunca é igual a uma cópia.

### Structs comuns: corretas, lentas e com hash fraco

Uma struct sem overrides recebe `ValueType.Equals`, que chama `Equals` em cada
campo, então até campos string comparam por conteúdo:

```csharp
struct Name(string first, int n) { public string First = first; public int N = n; }

new Name("ana", 1).Equals(new Name(string.Concat("an", "a"), 1));  // True
new Name("x", 1).GetHashCode() == new Name("x", 2).GetHashCode();   // True: N foi ignorado
```

A segunda linha é a armadilha. A documentação de `ValueType.GetHashCode` diz só
que "um ou mais campos" são usados e que o resultado "provavelmente não serve
como chave de hash table". Nesta execução, uma struct com um campo referência
gerou o hash só a partir da string, então toda chave com o mesmo `First` cai no
mesmo bucket. Campos de ponto flutuante se comportam bem no .NET 10: `0.0` e
`-0.0` deram iguais e `NaN` foi igual a `NaN`, como em `double.Equals`.

Os outros custos: `a == b` não compila até você declarar o operador, e
`EqualityComparer<Pair>.Default` se revelou um `ObjectEqualityComparer`, que
passa por `Equals(object)` e faz boxing (Value Types, Reference Types and Boxing
mediu 48 bytes por chamada de `Equals` numa struct assim). Uma struct que
implementa `IEquatable<T>` recebe o `GenericEqualityComparer` no lugar.

### Implementando igualdade numa struct

Quando a struct não pode ser um `record struct`, implemente o conjunto completo:

```csharp
readonly struct Money(decimal amount, string currency) : IEquatable<Money>
{
    public decimal Amount { get; } = amount;
    public string Currency { get; } = currency;

    public bool Equals(Money other) => Amount == other.Amount && Currency == other.Currency;
    public override bool Equals(object? obj) => obj is Money m && Equals(m);
    public override int GetHashCode() => HashCode.Combine(Amount, Currency);
    public static bool operator ==(Money l, Money r) => l.Equals(r);
    public static bool operator !=(Money l, Money r) => !l.Equals(r);
}

new Money(10m, "EUR") == new Money(10.00m, "EUR");   // True, e os hashes batem
```

`HashCode.Combine` mistura até oito valores; para mais, ou para uma sequência,
use uma instância de `HashCode` com `Add` e `ToHashCode`. Valores iguais precisam
gerar hashes iguais, e o hash tem que seguir a mesma noção de igualdade do
`Equals`: aqui o `decimal` trata `10m` e `10.00m` como iguais e gera o mesmo
hash, mesmo que imprimam diferente (`10` e `10.00`). Se o `Equals` comparasse
strings sem diferenciar maiúsculas, o hash precisaria do mesmo comparer
(`hash.Add(name, StringComparer.OrdinalIgnoreCase)`). `HashCode` usa uma semente
aleatória por processo, então os resultados nunca devem ser persistidos nem
enviados para fora.

Um `readonly record struct Money(decimal Amount, string Currency)` gera tudo
isso numa linha, e é por isso que a documentação recomenda records sempre que o
tipo puder ser um.

### Customizando a igualdade de um record

A igualdade de um record usa o `Equals` de cada membro, então um membro coleção
a quebra. Substitua o `Equals(T)` e o `GetHashCode` gerados; o `==`, o `!=` e o
`Equals(object)` gerados chamam os seus:

```csharp
sealed record Order(string Id, IReadOnlyList<string> Lines)
{
    public bool Equals(Order? other) =>
        other is not null && Id == other.Id && Lines.SequenceEqual(other.Lines);

    public override int GetHashCode()
    {
        var h = new HashCode();
        h.Add(Id);
        foreach (var l in Lines) h.Add(l);
        return h.ToHashCode();
    }
}

new Order("A", ["x", "y"]) == new Order("A", ["x", "y"]);   // True
new HashSet<Order> { o1 }.Contains(o2);                      // True
// record PlainOrder(string Id, List<string> Lines): a mesma comparação dá False
```

O compilador protege o formato:

- Num record que não é sealed, `Equals(T)` tem que ser `virtual`: CS8872
  ("must allow overriding because the containing record is not sealed").
- `Equals` sem `GetHashCode` dá o aviso CS8851.
- Declarar `==` ou `!=` por conta própria dá CS0111: o record já define
  `op_Equality`.

Selar o record é a escolha mais simples. Num record não selado, a igualdade já
confere o `EqualityContract`, então um record derivado nunca é igual à base.

### Hierarquias de classes

Uma classe que não é record nem sealed precisa de duas coisas para manter o
`Equals` simétrico: um `Equals` tipado `virtual` e uma checagem do tipo em tempo
de execução.

```csharp
class Shape(string color) : IEquatable<Shape>
{
    public string Color { get; } = color;
    public override bool Equals(object? obj) => Equals(obj as Shape);
    public virtual bool Equals(Shape? other) =>
        other is not null && GetType() == other.GetType() && Color == other.Color;
    public override int GetHashCode() => HashCode.Combine(GetType(), Color);
}
class Circle(string color, double r) : Shape(color)
{
    public double R { get; } = r;
    public override bool Equals(Shape? other) => other is Circle c && base.Equals(c) && R == c.R;
    public override int GetHashCode() => HashCode.Combine(GetType(), Color, R);
}

Shape c = new Circle("red", 5); Shape s = new Shape("red");
c.Equals(s); s.Equals(c);    // False False: simétrico
```

Sem a checagem de `GetType()`, `s.Equals(c)` compararia só as cores e daria
verdadeiro enquanto `c.Equals(s)` dá falso. É isso que o `EqualityContract` de
um record faz por você; numa classe que não é record, selá-la elimina o problema
de vez.

### Escolhendo a comparação no ponto de chamada

Igualdade também é algo que quem chama pode escolher sem mudar o tipo:

- `ReferenceEquals(x, y)` para identidade; é sempre `false` para value types,
  porque cada argumento sofre boxing separado.
- `a.SequenceEqual(b)` e `StructuralComparisons.StructuralEqualityComparer`
  para arrays e listas.
- Um `IEqualityComparer<T>` passado a um dicionário, um set ou ao LINQ, quando um
  tipo precisa de igualdades diferentes em lugares diferentes (coberto em
  Dictionary, HashSet, and Equality).

## Trade-offs

- **Records dão igualdade correta de graça, mas rasa.** Membros coleção comparam
  por referência até você sobrescrever `Equals(T)` e `GetHashCode`.
- **A igualdade da struct comum funciona, mas não serve de chave.** Ela faz
  boxing via `ObjectEqualityComparer` e o hash pode ignorar campos:
  ```csharp
  new Name("x", 1).GetHashCode() == new Name("x", 2).GetHashCode();   // True
  ```
  Use um `record struct` ou implemente `IEquatable<T>` em tudo que vai para hash.
- **Igualdade escrita à mão tem cinco membros para manter em sincronia.**
  `Equals(T)`, `Equals(object)`, `GetHashCode`, `==` e `!=`. Faltar um compila,
  no máximo com um aviso.
- **Igualdade por valor em tipos mutáveis é frágil.** Se os campos mudam depois
  que o objeto entrou num set ou virou chave, as buscas falham; mantenha
  imutáveis os membros que definem a igualdade.
- **Hierarquias não seladas custam simetria.** Sem checagem do tipo em tempo de
  execução, base e derivada comparam diferente dependendo de quem chama. Prefira
  tipos selados ou records.
- **Comparação estrutural de coleções é O(n).** `SequenceEqual` no `Equals` e
  um loop no `GetHashCode` tornam cada busca no dicionário proporcional ao
  tamanho da coleção; guarde o hash em cache para coleções imutáveis grandes.

## Documentation Links

- [C# equality comparisons, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/expressions/equality) (doc)
- [Equality operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/equality-operators) (doc)
- [ValueType.GetHashCode method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.valuetype.gethashcode) (doc)
- [Tuple types: tuple equality, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/value-tuples#tuple-equality) (doc)
- [HashCode struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.hashcode) (doc)
