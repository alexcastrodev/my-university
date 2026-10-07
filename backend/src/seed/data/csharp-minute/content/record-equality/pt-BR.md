---
version: 1.0
updatedAt: 2026-09-23
question: Como os records implementam igualdade?
---
## Question

# Como os records implementam igualdade?

## Short Answer

O compilador gera **igualdade baseada em valor** pra você: `Equals`, `GetHashCode`, `==` e `!=` comparam todos os campos, além de uma propriedade oculta `EqualityContract` para que dois records de tipos diferentes nunca sejam iguais, mesmo com os mesmos valores.

## What It Is

Um `record` (uma classe) ou `record struct` é um tipo que o compilador preenche com código repetitivo. Para igualdade, duas instâncias de record são iguais quando:

1. têm o mesmo `EqualityContract` (por padrão, o `typeof` do próprio tipo do record), e
2. todos os campos são iguais segundo `EqualityComparer<T>.Default`.

Como um `record` continua sendo um tipo por referência, `ReferenceEquals(a, b)` continua dizendo se são o mesmo objeto, mas `a == b` agora significa "mesmos valores".

## The Shallow Part

A comparação é **campo a campo, um nível de profundidade**. Se um campo é um `List<T>` ou um array, ele é comparado com o `Equals` do próprio tipo, que é igualdade por referência. Dois records com listas contendo os mesmos itens **não** são iguais.

O mesmo vale para expressões `with`: elas fazem uma cópia rasa. O novo record compartilha a mesma instância de lista com o original.

## Practical Example

```csharp
public record Point(int X, int Y);
public record ColoredPoint(int X, int Y, string Color) : Point(X, Y);
public record Order(int Id, List<string> Items);

new Point(1, 2) == new Point(1, 2);                  // true
new Point(1, 2) == new ColoredPoint(1, 2, "red");    // false: EqualityContract diferente

var a = new Order(1, ["book"]);
var b = new Order(1, ["book"]);
a == b;                                              // false: listas comparadas por referência

var c = a with { Id = 2 };
c.Items.Add("pen");                                  // a.Items também tem "pen" agora
```

## Solution and Conclusion

Records são ideais para dados imutáveis cujos campos também são valores (números, strings, outros records). Se você precisa de coleções dentro deles, prefira coleções imutáveis e sobrescreva `Equals(R? other)` e `GetHashCode` quando quiser igualdade por sequência. E lembre que `with` nunca faz cópia profunda.

## References

- [Records: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [Equality comparisons: C# guide](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/statements-expressions-operators/equality-comparisons) (doc)
