---
version: 1.0
updatedAt: 2026-09-30
question: Por que você deve evitar async void?
---
## Question

# Por que você deve evitar `async void`?

## Short Answer

Porque um método `async void` não dá ao chamador **nada para observar**: nenhuma `Task` para esperar, nenhuma forma de saber quando terminou e nenhuma forma de capturar suas exceções. Uma exceção não tratada dentro dele pode derrubar o processo inteiro.

## What It Is

Um método `async Task` retorna uma `Task` que representa a operação inteira. Se o método lançar uma exceção, ela fica guardada dentro dessa task e é relançada quando alguém faz `await` nela.

Um método `async void` não tem task onde guardar a exceção. Então a exceção é lançada diretamente no `SynchronizationContext` que estava ativo quando o método começou. Em uma aplicação de UI, isso é o handler de exceções não tratadas da thread de UI. Em uma aplicação console ou no ASP.NET Core, não existe contexto, então a exceção é lançada em uma thread do thread pool, e uma exceção não tratada ali **encerra o processo**.

## Why It Hurts

- Um `try/catch` em volta da chamada não captura nada: o método retorna no primeiro `await`, bem antes de a exceção acontecer.
- O chamador não consegue esperar a conclusão, então testes terminam antes do trabalho, e o desligamento da aplicação pode cortar o trabalho pela metade.
- Composição é impossível: você não consegue fazer `Task.WhenAll` em um monte de chamadas `async void`.

## Practical Example

```csharp
async void SaveAndForget()
{
    await Task.Delay(100);
    throw new InvalidOperationException("boom");
}

try
{
    SaveAndForget();   // retorna imediatamente no primeiro await
}
catch (InvalidOperationException)
{
    // nunca chega aqui: a exceção escapa depois, em outra thread
}

// A correção: retornar Task e fazer await
async Task SaveAsync()
{
    await Task.Delay(100);
    throw new InvalidOperationException("boom");
}

try { await SaveAsync(); }
catch (InvalidOperationException) { /* capturada como esperado */ }
```

## Solution and Conclusion

Sempre retorne `Task` (ou `Task<T>` / `ValueTask`) de métodos assíncronos. O **único** uso legítimo de `async void` é um handler de evento, porque a assinatura do evento exige `void`. Mesmo assim, envolva o corpo em um `try/catch` para que uma falha seja registrada em log em vez de derrubar a aplicação. Cuidado também com lambdas: passar uma lambda async para um parâmetro do tipo `Action` cria um `async void` sem você perceber.

## References

- [Async return types: void return type](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-return-types#void-return-type) (doc)
- [Async/Await: Best Practices in Asynchronous Programming](https://learn.microsoft.com/en-us/archive/msdn-magazine/2013/march/async-await-best-practices-in-asynchronous-programming) (doc)
