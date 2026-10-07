---
version: 1.0
updatedAt: 2026-09-18
question: O que acontece quando um int estoura em C#?
---
## Question

# O que acontece quando um `int` estoura em C#?

## Short Answer

Por padrão, **nada visível**: o valor dá a volta silenciosamente. `int.MaxValue + 1` vira `int.MinValue`. Você só recebe uma `OverflowException` dentro de um contexto `checked`, ou se o projeto inteiro for compilado com a checagem de overflow ligada.

## What It Is

A aritmética de inteiros em C# roda em um contexto `unchecked`, a menos que você diga o contrário. A CPU simplesmente mantém os 32 (ou 64) bits menos significativos do resultado, o que, em complemento de dois, transforma um número positivo grande em um número negativo grande.

Existe uma exceção: **expressões constantes** são sempre checadas em tempo de compilação. `int x = int.MaxValue + 1;` não compila (erro CS0220), o que pode dar a falsa impressão de que o overflow é sempre detectado.

## Not Every Type Behaves the Same

- `int`, `long`, `byte`... dão a volta silenciosamente (unchecked) ou lançam `OverflowException` (checked).
- `decimal` **sempre** lança `OverflowException`, com ou sem checked.
- `float` e `double` nunca lançam exceção: vão para `PositiveInfinity` / `NegativeInfinity`.
- Divisão inteira por zero sempre lança `DivideByZeroException`, independente do contexto.

## Practical Example

```csharp
int max = int.MaxValue;

int wrapped = max + 1;                 // -2147483648, sem erro

int safe = checked(max + 1);           // OverflowException

checked
{
    long total = 0;
    foreach (var amount in amounts)
        total += amount;               // toda operação do bloco é checada
}

decimal big = decimal.MaxValue;
big += 1;                              // OverflowException, sempre

double d = double.MaxValue * 2;        // PositiveInfinity
```

## Solution and Conclusion

Onde um overflow seria um bug (dinheiro, contadores, tamanhos, índices calculados a partir de entrada do usuário), envolva a aritmética em `checked`, ou habilite `<CheckForOverflowUnderflow>true</CheckForOverflowUnderflow>` nos builds de debug para pegar problemas cedo. Use `unchecked` explícito em código que depende intencionalmente da volta, como cálculos de hash code.

## References

- [checked and unchecked statements: C# language reference](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/checked-and-unchecked) (doc)
- [CheckForOverflowUnderflow compiler option](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language#checkforoverflowunderflow) (doc)
