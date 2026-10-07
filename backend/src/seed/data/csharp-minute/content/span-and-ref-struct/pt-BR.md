---
version: 1.0
updatedAt: 2026-10-05
question: Por que um Span<T> nunca pode viver na heap?
---
## Question

# Por que um `Span<T>` nunca pode viver na heap?

## Short Answer

Porque `Span<T>` é uma `ref struct`: ela pode guardar uma referência que aponta **para o meio** de um array, de um buffer `stackalloc` ou de memória nativa. O runtime só consegue rastrear esse tipo de referência com segurança enquanto ela fica na stack, então o compilador proíbe qualquer coisa que possa levar um span para a heap.

## What It Is

Um `Span<T>` é uma visão sobre um bloco contíguo de memória: uma referência para o primeiro elemento mais um tamanho. Fatiar um span cria uma nova visão sobre a mesma memória, **sem copiar e sem alocar**. Por isso `"hello world".AsSpan(6)` é de graça, enquanto `"hello world".Substring(6)` aloca uma nova string.

A parte interessante é de onde essa memória pode vir: um array gerenciado, uma string, um buffer criado com `stackalloc` ou memória não gerenciada. Uma referência para o interior de um objeto (um "byref") é algo que o garbage collector só sabe tratar em posições da stack. Ela não pode existir como campo dentro de um objeto na heap.

## The Rules

Para manter essa garantia, uma `ref struct` como `Span<T>`:

- não pode ser campo de uma classe nem de uma struct comum;
- não pode sofrer boxing, então não pode ser convertida para `object` nem (antes do C# 13) para uma interface;
- não pode ser capturada por uma lambda ou por uma função local;
- não pode estar viva através de um `await` ou de um `yield return`. Desde o C# 13 você pode declará-la em um método `async` ou em um iterator, mas o tempo de vida dela não pode atravessar um ponto de suspensão.

Se você precisa guardar uma visão de buffer em um campo ou mantê-la através de um `await`, use `Memory<T>`, que é uma struct comum, e chame `.Span` na hora em que for realmente processar os dados.

## Practical Example

```csharp
static int SumDigits(ReadOnlySpan<char> text)
{
    int sum = 0;
    foreach (char c in text)
        if (char.IsDigit(c)) sum += c - '0';
    return sum;
}

string input = "order-2026-10-05";
int total = SumDigits(input.AsSpan(6));   // nenhuma substring alocada

Span<byte> buffer = stackalloc byte[128]; // vive na stack, sem GC envolvido

class Holder
{
    // Span<byte> _buffer;  // erro CS8345: campo não pode ser de um tipo ref struct
    Memory<byte> _buffer;   // ok
}
```

## Solution and Conclusion

Use `Span<T>` / `ReadOnlySpan<T>` em caminhos de código síncronos e quentes, que fatiam e fazem parsing de dados sem alocar. Quando os dados precisam sobreviver ao frame atual da stack (um campo, um método `async`, um callback), troque para `Memory<T>` e só obtenha um span no ponto em que for trabalhar com ele.

## References

- [ref struct types: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/ref-struct) (doc)
- [Span<T> struct: .NET API](https://learn.microsoft.com/en-us/dotnet/api/system.span-1) (doc)
- [Memory<T> and Span<T> usage guidelines](https://learn.microsoft.com/en-us/dotnet/standard/memory-and-spans/memory-t-usage-guidelines) (doc)
