---
version: 1.0
updatedAt: 2026-09-25
question: Por que o foreach sobre um List<T> não aloca?
---
## Question

# Por que o `foreach` sobre um `List<T>` não aloca?

## Short Answer

Porque o `foreach` é **baseado em padrão**, não em interface. `List<T>.GetEnumerator()` retorna `List<T>.Enumerator`, que é uma `struct`, então o enumerador vive na stack. Itere a mesma lista através de `IEnumerable<T>` e você recebe um enumerador com boxing na heap.

## What It Is

O `foreach` não exige `IEnumerable`. O compilador só procura um método `GetEnumerator()` cujo tipo de retorno tenha um método `MoveNext()` e uma propriedade `Current`. É duck typing em tempo de compilação. (Desde o C# 9, `GetEnumerator` pode até ser um método de extensão.)

As coleções da BCL aproveitam isso: `List<T>`, `Dictionary<TKey, TValue>`, `HashSet<T>` e outras expõem um `GetEnumerator()` público que retorna um **enumerador struct**. O compilador chama esse método diretamente, sem despacho por interface e sem alocação.

## The Interface Trap

Quando o tipo estático da variável é `IEnumerable<T>` (ou `IList<T>`, `ICollection<T>`), o compilador só enxerga o método da interface, que retorna `IEnumerator<T>`. A struct sofre boxing para satisfazer esse tipo de retorno, e cada `MoveNext()` e `Current` vira uma chamada via interface. Em um loop quente, isso é uma alocação por loop mais chamadas mais lentas.

O enumerador struct também carrega uma checagem de versão: se a lista for modificada durante o loop, o próximo `MoveNext()` lança `InvalidOperationException`.

## Practical Example

```csharp
var numbers = new List<int> { 1, 2, 3 };

foreach (var n in numbers) { }          // List<int>.Enumerator, sem alocação

IEnumerable<int> asInterface = numbers;
foreach (var n in asInterface) { }      // IEnumerator<int> com boxing, 1 alocação

foreach (var n in numbers)
{
    if (n == 2) numbers.Add(4);         // InvalidOperationException no próximo MoveNext
}
```

## Solution and Conclusion

Em caminhos sensíveis a performance, mantenha o tipo concreto da coleção (ou `IReadOnlyList<T>` com um `for` por índice) em vez de passar tudo como `IEnumerable<T>`. Em código comum, a diferença é irrelevante, mas ela explica por que profilers às vezes mostram alocações de enumeradores em um loop que "não aloca nada".

## References

- [Iteration statements: the foreach statement](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/iteration-statements#the-foreach-statement) (doc)
- [List<T>.Enumerator struct: .NET API](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.list-1.enumerator) (doc)
