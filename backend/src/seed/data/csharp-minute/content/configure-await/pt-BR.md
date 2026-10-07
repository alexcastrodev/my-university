---
version: 1.0
updatedAt: 2026-10-02
question: O que ConfigureAwait(false) realmente faz?
---
## Question

# O que `ConfigureAwait(false)` realmente faz?

## Short Answer

Ele diz para o `await` **não voltar para o contexto original** para executar o restante do método. A continuação roda onde a task terminou, normalmente em uma thread do thread pool. Não tem nada a ver com "configurar" a task em si.

## What It Is

Quando você faz `await` em uma task que ainda não terminou, o compilador captura o `SynchronizationContext` atual (ou o `TaskScheduler` atual) e, quando a task completa, envia o restante do seu método de volta para ele.

Em uma aplicação de UI (WPF, WinForms, MAUI), esse contexto é a thread de UI. É exatamente o que você quer em handlers de eventos: depois do `await`, você pode mexer nos controles de novo. Em código de biblioteca, porém, voltar para a thread de UI é puro overhead, e pode ser pior do que isso.

## The Classic Deadlock

1. Um handler de evento de UI chama `GetDataAsync().Result`, bloqueando a thread de UI.
2. Dentro de `GetDataAsync`, um `await` capturou o contexto de UI.
3. Quando o I/O termina, a continuação precisa da thread de UI para retomar.
4. A thread de UI está bloqueada esperando essa mesma continuação. Ninguém anda.

Se a biblioteca tivesse usado `ConfigureAwait(false)`, a continuação rodaria no thread pool, a task completaria e `.Result` retornaria. (A solução de verdade é não bloquear em código assíncrono, mas bibliotecas não controlam quem as chama.)

## Practical Example

```csharp
// Código de biblioteca: não importa qual thread retoma
public async Task<string> ReadConfigAsync(string path)
{
    string text = await File.ReadAllTextAsync(path).ConfigureAwait(false);
    return text.Trim();
}

// Código de UI: precisa retomar na thread de UI para atualizar o label
private async void OnLoadClicked(object sender, EventArgs e)
{
    string config = await _service.ReadConfigAsync("app.json");
    _statusLabel.Text = config;
}

// .NET 8+: mais controle com ConfigureAwaitOptions
await task.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
```

## Solution and Conclusion

Regra prática: em **código de biblioteca de uso geral**, use `ConfigureAwait(false)` em todo `await`. Em **código de aplicação** (handlers de UI, controllers), faça `await` normalmente. O ASP.NET Core não tem `SynchronizationContext`, então lá não há diferença de comportamento, mas a sua biblioteca ainda pode ser chamada por uma aplicação de UI algum dia.

## References

- [ConfigureAwait FAQ: .NET Blog](https://devblogs.microsoft.com/dotnet/configureawait-faq/) (doc)
- [Task.ConfigureAwait: .NET API](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.task.configureawait) (doc)
