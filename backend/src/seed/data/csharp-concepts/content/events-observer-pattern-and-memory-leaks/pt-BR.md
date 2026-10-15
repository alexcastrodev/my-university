---
version: 1.0
updatedAt: 2026-10-15
title: "Events, o padrão Observer e vazamentos de memória"
summary: O que a palavra event restringe em relação a um campo delegate, os acessores add/remove com Interlocked.CompareExchange que o compilador gera (assinaturas perdidas medidas), EventHandler<TEventArgs> e disparo seguro com ?.Invoke, o vazamento causado por um publisher de vida longa medido com WeakReference e GC, como desinscrever, weak events, acessores próprios e partial events do C# 14.
---
## Objective

Um event é um delegate multicast com uma proteção em volta: código de fora só
consegue se inscrever e se desinscrever, e só o tipo que declara o event pode
dispará-lo. É o padrão Observer embutido na linguagem. Este conceito mostra o
que a palavra `event` restringe e o que o compilador gera (um par `add`/`remove`
thread-safe), a convenção `EventHandler<TEventArgs>` e como disparar um event
com segurança, e depois o problema mais comum com events em produção: um
publisher de vida longa mantendo milhares de subscribers mortos na memória. O
vazamento é medido com `WeakReference` e com o GC, e corrigido. No fim entram
os acessores escritos à mão e os partial events do C# 14.

## Use Cases

- Um objeto de domínio anunciando `BalanceChanged` ou `OrderShipped` para
  ouvintes que ele não conhece.
- Componentes de UI, file watchers, timers e relatório de progresso, em que
  vários consumidores reagem a uma única fonte.
- Diagnosticar um vazamento de memória em que objetos que "já deviam ter
  sumido" sobrevivem a toda coleta de lixo.
- Expor uma inscrição como `IDisposable`, para que um `using` ou um escopo de
  DI a encerre.
- Deixar um source generator declarar um event enquanto você escreve o
  armazenamento.

## Deep Dive

### `event` versus um campo delegate público

As duas declarações abaixo guardam um `EventHandler?`. A diferença é o que quem
está fora da classe pode fazer:

```csharp
class Account
{
    public event EventHandler? Changed;   // event
    public EventHandler? Raw;             // campo delegate comum
}

a.Changed = null;                    // error CS0070
a.Changed(a, EventArgs.Empty);       // error CS0070
a.Raw = null;                        // compila: qualquer um apaga todos os subscribers
a.Raw?.Invoke(a, EventArgs.Empty);   // compila: qualquer um dispara
```

O CS0070 diz "The event 'Account.Changed' can only appear on the left hand side
of += or -= (except when used from within the type 'Account')". Com um campo,
um `=` descuidado no lugar de `+=` remove em silêncio os handlers de todo
mundo. O event deixa essas decisões dentro do publisher.

### O que o compilador gera

Um event no estilo campo vira um campo delegate privado mais dois métodos
acessores, `add_Changed` e `remove_Changed`, que o `+=` e o `-=` chamam. O IL
de `add_Changed`, lido com `ilspycmd -il` (resumido):

```text
.field private class System.EventHandler Changed
IL_0001: ldfld class System.EventHandler Account::Changed
// loop start
IL_000b: call class System.Delegate System.Delegate::Combine(class System.Delegate, class System.Delegate)
IL_001e: call !!0 System.Threading.Interlocked::CompareExchange<class System.EventHandler>(!!0&, !!0, !!0)
IL_0026: bne.un.s IL_0007   // outra thread mudou o campo: tenta de novo
```

Ele lê a lista atual, monta uma nova com `Combine` e publica com
`Interlocked.CompareExchange`, repetindo se outra thread chegou antes. Como
delegates são imutáveis (conceito anterior), esse laço sem lock basta. Medindo
com 4 threads, cada uma fazendo 2.000 `+=` num campo delegate comum e num event
(.NET 10.0.0, Apple M4 Max, arm64, Release), três execuções:

```text
run 0: field 7013, event 8000 (expected 8000)
run 1: field 6715, event 8000 (expected 8000)
run 2: field 6757, event 8000 (expected 8000)
```

O campo perdeu até 16% das inscrições; o event não perdeu nenhuma.

### O formato padrão e o disparo seguro

A convenção do .NET é `void Handler(object? sender, TEventArgs e)`, expressa
com `EventHandler` ou `EventHandler<TEventArgs>`, mais um método
`protected virtual OnX` para que classes derivadas possam se encaixar:

```csharp
sealed class ValueChangedEventArgs(decimal oldValue, decimal newValue) : EventArgs
{
    public decimal OldValue { get; } = oldValue;
    public decimal NewValue { get; } = newValue;
}

class Account
{
    private decimal _balance;
    public event EventHandler<ValueChangedEventArgs>? BalanceChanged;

    public void Deposit(decimal amount)
    {
        var old = _balance;
        _balance += amount;
        OnBalanceChanged(new ValueChangedEventArgs(old, _balance));
    }

    protected virtual void OnBalanceChanged(ValueChangedEventArgs e) => BalanceChanged?.Invoke(this, e);
}
// account.Deposit(10) sem subscribers: nada acontece, sem exceção
// depois de inscrever um handler, Deposit(5) imprime: balance 10 -> 15 from Account
```

`BalanceChanged?.Invoke(this, e)` lê o campo uma vez para uma variável
temporária, então uma thread que remove o último handler entre a checagem de
null e a chamada não consegue causar `NullReferenceException`. O antigo
`if (BalanceChanged != null) BalanceChanged(this, e);` lê duas vezes e tem essa
corrida. Mantenha os event args imutáveis: todos os handlers recebem a mesma
instância. O guia de events do Microsoft Learn observa que no .NET Core o
`TEventArgs` não precisa mais derivar de `EventArgs`, então
`EventHandler<int>` é válido.

Dois fatos de runtime dos delegates continuam valendo: os handlers rodam de
forma síncrona, na ordem de inscrição, na thread que disparou; e uma exceção
num handler pula os seguintes. Um handler `async` é obrigatoriamente
`async void`, então o guia recomenda envolver o corpo dele em `try`/`catch`,
já que não existe task para carregar a exceção.

### O vazamento: um publisher de vida longa

Cada inscrição guarda um delegate cujo `Target` é o subscriber. O publisher
portanto segura uma referência forte para cada subscriber até que ele se
desinscreva. Se o publisher vive para sempre (um static, um serviço singleton,
um relógio da aplicação inteira), eles também vivem:

```csharp
static class Clock { public static readonly TickSource Ticks = new(); }

class TickSource
{
    public event EventHandler? Tick;
    public int HandlerCount => Tick?.GetInvocationList().Length ?? 0;
}

sealed class Widget : IDisposable
{
    private readonly byte[] _buffer = new byte[1024 * 1024];      // 1 MB por widget
    public Widget() => Clock.Ticks.Tick += OnTick;
    public void OnTick(object? sender, EventArgs e) => _buffer[0]++;
    public void Dispose() => Clock.Ticks.Tick -= OnTick;
}
```

O experimento cria 100 widgets dentro de um método, guarda só uma
`WeakReference` para cada um, força uma coleta completa e conta os
sobreviventes (mesmo ambiente de antes):

```text
no unsubscribe: 100 of 100 alive, publisher holds 100
  heap after GC: 100 MB
  after publisher drops handlers: 0 alive, heap 0 MB
with Dispose: 0 of 100 alive, publisher holds 0, heap 0 MB
```

Nada no programa referencia mais os widgets, e mesmo assim os 100 MB
sobreviveram, porque o `Clock.Ticks` estático é uma raiz do GC e a lista de
invocação dele aponta para cada widget. Quando o experimento colocou `null` no
campo `Tick` do publisher, os mesmos widgets foram coletados na hora. A direção
importa: um publisher de vida curta com um subscriber de vida longa não vaza;
na mesma execução, um `TickSource` criado dentro de um método, com um widget de
vida longa inscrito, foi coletado (`IsAlive` deu `False`), porque a referência
vai do publisher para o subscriber, nunca de volta.

### Corrigindo

- **Desinscreva onde a vida do subscriber termina**, normalmente no `Dispose`,
  usando o mesmo method group ou um delegate guardado. Uma lambda escrita duas
  vezes são dois delegates diferentes, então `-=` com uma lambda nova não
  remove nada.
- **Devolva a inscrição como `IDisposable`**, o formato que o `IObservable<T>`
  usa, para que encerrá-la seja um `using` ou o descarte do container:

```csharp
public IDisposable Subscribe(EventHandler<int> handler)
{
    PriceChanged += handler;
    return new Subscription(() => PriceChanged -= handler);
}
sealed class Subscription(Action unsubscribe) : IDisposable
{
    public void Dispose() => unsubscribe();
}
// dentro do using: 1 handler; depois dele: 0
```

- **Weak events** guardam uma `WeakReference` para o subscriber, então o
  publisher nunca estende a vida dele. A BCL não tem um weak event de uso
  geral; o WPF traz o `WeakEventManager` para os cenários dele. Um handler
  fraco só é chamado até o GC rodar, o que esconde o bug de verdade (o
  unsubscribe que faltou) e faz o comportamento depender do momento do GC.
  Prefira tempo de vida explícito.
- **Alinhe o tempo de vida do publisher**: um publisher scoped na DI vai embora
  com o escopo e leva a lista de invocação junto.

### Acessores próprios e partial events (C# 14)

Você pode escrever os acessores `add` e `remove` por conta própria, por exemplo
para guardar os handlers numa lista ou num dicionário indexado por event (é
assim que frameworks de UI evitam um campo por event). O C# 14 também permite
que um event seja `partial`: uma declaração de definição, no estilo campo, e
uma declaração de implementação, que precisa ter os dois acessores. O alvo são
os source generators, em que uma das metades é gerada:

```csharp
partial class Button
{
    public partial event EventHandler? Click;           // declaração de definição
}

partial class Button
{
    private readonly List<EventHandler> _handlers = [];
    public partial event EventHandler? Click             // declaração de implementação
    {
        add { if (value is not null) _handlers.Add(value); }
        remove { if (value is not null) _handlers.Remove(value); }
    }
}
```

Esquecer a implementação dá error CS9275 ("must have an implementation part"),
duas declarações de definição dão CS9277, e compilar com `LangVersion` 13 dá
CS8703 "The modifier 'partial' is not valid for this item in C# 13.0". Com
acessores próprios, a thread safety vira responsabilidade sua: o laço de
`CompareExchange` do compilador some. A atribuição null-conditional do C# 14
também funciona com events: `maybe?.BalanceChanged += handler;` só inscreve
quando `maybe` não é null.

## Trade-offs

- **Events desacoplam o publisher, não os tempos de vida.** O publisher
  continua segurando cada subscriber; alguém precisa ser dono do unsubscribe.
- **Fan-out síncrono.** Um handler lento ou que lança exceção atrasa ou quebra
  os demais, e o publisher paga por isso na própria thread. Para entrega entre
  processos ou durável, use uma fila ou um message bus.
- **Handlers `async void` não conseguem reportar falha** ao publisher. Envolva
  o corpo deles em `try`/`catch`.
- **Weak events trocam um vazamento por não determinismo.** Use só quando não
  der para controlar o tempo de vida do subscriber.
- **Acessores próprios custam a thread safety.** Use lock ou `Interlocked`
  dentro deles.
  ```csharp
  add { lock (_gate) _handlers.Add(value); }
  ```

## Documentation Links

- [Standard .NET event patterns, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/event-pattern) (doc)
- [The updated .NET Core event pattern, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/modern-events) (doc)
- [How to subscribe to and unsubscribe from events, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/events/how-to-subscribe-to-and-unsubscribe-from-events) (doc)
- [event keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/event) (doc)
- [How to implement custom event accessors, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/events/how-to-implement-custom-event-accessors) (doc)
- [Partial members, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/partial-member) (doc)
- [What's new in C# 14 (partial events, null-conditional assignment), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Observer design pattern, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/events/observer-design-pattern) (doc)
- [Weak event patterns, WPF, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/events/weak-event-patterns) (doc)
