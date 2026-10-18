---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

An event is a multicast delegate with a guard around it: outside code can only
subscribe and unsubscribe, and only the declaring type can raise it. That is
the observer pattern built into the language. This concept shows what the
`event` keyword restricts and what the compiler generates (a thread-safe
`add`/`remove` pair), the `EventHandler<TEventArgs>` convention and how to raise
an event safely, then the most common production problem with events: a
long-lived publisher keeping thousands of dead subscribers in memory. The leak
is measured with `WeakReference` and the GC, and fixed. It ends with custom
accessors and the partial events added in C# 14.

## Use Cases

- A domain object announcing `BalanceChanged` or `OrderShipped` to listeners it
  does not know about.
- UI components, file watchers, timers and progress reporting, where many
  consumers react to one source.
- Diagnosing a memory leak where objects that "should be gone" survive every
  garbage collection.
- Exposing a subscription as an `IDisposable`, so `using` or a DI scope ends it.
- Letting a source generator declare an event while you write the storage.

## Deep Dive

### `event` versus a public delegate field

Both declarations below hold an `EventHandler?`. The difference is what callers
outside the class may do:

```csharp
class Account
{
    public event EventHandler? Changed;   // event
    public EventHandler? Raw;             // plain delegate field
}

a.Changed = null;                    // error CS0070
a.Changed(a, EventArgs.Empty);       // error CS0070
a.Raw = null;                        // compiles: any caller can wipe every subscriber
a.Raw?.Invoke(a, EventArgs.Empty);   // compiles: any caller can raise it
```

CS0070 reads "The event 'Account.Changed' can only appear on the left hand
side of += or -= (except when used from within the type 'Account')". With a
field, one careless `=` instead of `+=` silently removes everybody else's
handlers. The event keeps those decisions inside the publisher.

### What the compiler generates

A field-like event becomes a private delegate field plus two accessor methods,
`add_Changed` and `remove_Changed`, which `+=` and `-=` call. The IL of
`add_Changed`, read with `ilspycmd -il` (trimmed):

```text
.field private class System.EventHandler Changed
IL_0001: ldfld class System.EventHandler Account::Changed
// loop start
IL_000b: call class System.Delegate System.Delegate::Combine(class System.Delegate, class System.Delegate)
IL_001e: call !!0 System.Threading.Interlocked::CompareExchange<class System.EventHandler>(!!0&, !!0, !!0)
IL_0026: bne.un.s IL_0007   // someone else changed the field: retry
```

It reads the current list, builds a new one with `Combine`, and publishes it
with `Interlocked.CompareExchange`, retrying if another thread got there first.
Since delegates are immutable (previous concept), this lock-free loop is enough.
Measured with 4 threads each doing 2,000 `+=` on a plain delegate field and on
an event (.NET 10.0.0, Apple M4 Max, arm64, Release), three runs:

```text
run 0: field 7013, event 8000 (expected 8000)
run 1: field 6715, event 8000 (expected 8000)
run 2: field 6757, event 8000 (expected 8000)
```

The field lost up to 16% of the subscriptions; the event lost none.

### The standard shape and raising safely

The .NET convention is `void Handler(object? sender, TEventArgs e)`, expressed
with `EventHandler` or `EventHandler<TEventArgs>`, and a `protected virtual
OnX` method so derived classes can hook in:

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
// account.Deposit(10) with no subscribers: nothing happens, no exception
// after subscribing, Deposit(5) prints: balance 10 -> 15 from Account
```

`BalanceChanged?.Invoke(this, e)` reads the field once into a temporary, so a
thread that removes the last handler between the null check and the call
cannot cause a `NullReferenceException`. The older
`if (BalanceChanged != null) BalanceChanged(this, e);` reads it twice and has
that race. Keep event args immutable: every handler receives the same instance.
The Microsoft Learn event guide notes that on .NET Core `TEventArgs` no longer
has to derive from `EventArgs`, so `EventHandler<int>` is legal.

Two runtime facts from delegates still apply: handlers run synchronously, in
subscription order, on the raising thread; and an exception in one handler
skips the rest. An `async` handler is necessarily `async void`, so the guide
recommends wrapping its body in `try`/`catch`, since there is no task to carry
the exception.

### The leak: a long-lived publisher

Each subscription stores a delegate whose `Target` is the subscriber. The
publisher therefore holds a strong reference to every subscriber until they
unsubscribe. If the publisher lives forever (a static, a singleton service, an
application-wide clock), so do they:

```csharp
static class Clock { public static readonly TickSource Ticks = new(); }

class TickSource
{
    public event EventHandler? Tick;
    public int HandlerCount => Tick?.GetInvocationList().Length ?? 0;
}

sealed class Widget : IDisposable
{
    private readonly byte[] _buffer = new byte[1024 * 1024];      // 1 MB per widget
    public Widget() => Clock.Ticks.Tick += OnTick;
    public void OnTick(object? sender, EventArgs e) => _buffer[0]++;
    public void Dispose() => Clock.Ticks.Tick -= OnTick;
}
```

The experiment creates 100 widgets in a method, keeps only a `WeakReference`
to each, forces a full collection, and counts survivors (same environment as
above):

```text
no unsubscribe: 100 of 100 alive, publisher holds 100
  heap after GC: 100 MB
  after publisher drops handlers: 0 alive, heap 0 MB
with Dispose: 0 of 100 alive, publisher holds 0, heap 0 MB
```

Nothing in the program references the widgets any more, yet all 100 MB
survived, because the static `Clock.Ticks` is a GC root and its invocation list
points at each widget. When the experiment set the publisher's `Tick` field to
`null`, the same widgets were collected at once. The direction matters: a short-lived publisher with a
long-lived subscriber does not leak; in the same run, a `TickSource` created
inside a method, with a long-lived widget subscribed, was collected
(`IsAlive` was `False`), because the reference goes from publisher to
subscriber, never back.

### Fixing it

- **Unsubscribe where the subscriber's lifetime ends**, usually in `Dispose`,
  using the same method group or a stored delegate. A lambda written twice is
  two different delegates, so `-=` with a new lambda removes nothing.
- **Return the subscription as an `IDisposable`**, the shape `IObservable<T>`
  uses, so ending it is a `using` or a container disposal:

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
// inside the using: 1 handler; after it: 0
```

- **Weak events** keep a `WeakReference` to the subscriber, so the publisher
  never extends its life. The BCL has no general-purpose weak event; WPF ships
  `WeakEventManager` for its own scenarios. A weak handler is invoked only
  until the GC happens to run, which hides the real bug (a missing
  unsubscribe) and makes behavior depend on GC timing. Prefer explicit
  lifetime.
- **Make the publisher's lifetime match**: a scoped publisher in DI goes away
  with its scope and takes the invocation list with it.

### Custom accessors and partial events (C# 14)

You can write the `add` and `remove` accessors yourself, for example to store
handlers in a list or a dictionary keyed by event (how UI frameworks avoid one
field per event). C# 14 also lets an event be `partial`: one defining
declaration, field-like, and one implementing declaration, which must have both
accessors. This is aimed at source generators, where one half is generated:

```csharp
partial class Button
{
    public partial event EventHandler? Click;           // defining declaration
}

partial class Button
{
    private readonly List<EventHandler> _handlers = [];
    public partial event EventHandler? Click             // implementing declaration
    {
        add { if (value is not null) _handlers.Add(value); }
        remove { if (value is not null) _handlers.Remove(value); }
    }
}
```

Leaving out the implementation is error CS9275 ("must have an implementation
part"), two defining declarations are CS9277, and compiling
with `LangVersion` 13 gives CS8703 "The modifier 'partial' is not valid for
this item in C# 13.0". Custom accessors make thread safety your job: the
compiler's `CompareExchange` loop is gone. C# 14's null-conditional assignment
also works with events: `maybe?.BalanceChanged += handler;` subscribes only
when `maybe` is not null.

## Trade-offs

- **Events decouple the publisher, not lifetimes.** The publisher still holds
  every subscriber; somebody has to own the unsubscribe.
- **Synchronous fan-out.** A slow or throwing handler delays or breaks the
  rest, and the publisher pays for it on its own thread. For cross-process or
  durable delivery, use a queue or a message bus instead.
- **`async void` handlers cannot report failure** to the publisher. Wrap their
  bodies in `try`/`catch`.
- **Weak events trade a leak for nondeterminism.** Use them only when you
  cannot control the subscriber's lifetime.
- **Custom accessors cost thread safety.** Lock or use `Interlocked` inside them.
  ```csharp
  add { lock (_gate) _handlers.Add(value); }
  ```

## Lab

In this lab you get a long-lived publisher (`TickSource`) and the event args ready, plus several **stubbed** classes that throw `NotImplementedException`. Your job is to implement the standard event-raising pattern, return subscriptions as `IDisposable` and prove, with a `WeakReference`, that the classic leak is gone. The core idea is to feel that an event is a strong reference from the publisher to each subscriber: if nobody unsubscribes, the subscriber never dies.

**The scenario**

A publisher that lives forever (like a static application clock) keeps alive subscribers nobody else uses, unless they unsubscribe.

- `Models.cs`: `ValueChangedEventArgs` and `TickSource` (already done, with `HandlerCount` and `Raise`) and `PriceFeed`, where `Subscribe` is missing.
- `Account.cs`: `Account` with the `BalanceChanged` event, `Deposit` and `OnBalanceChanged`.
- `Widget.cs`: `Widget` (subscribes to `TickSource`), `WidgetFactory` (creates a widget and returns only a `WeakReference`) and `LambdaListener`.
- `Bonus.cs`: `Button` with custom `add`/`remove` accessors and `Subscriber.Attach`.

Notice that `WidgetFactory.Create` is marked `NoInlining`: without it the JIT may keep the widget alive in the caller's frame and the collection test would be misleading.

**What you will do, step by step**

1. **Raise the event the standard way (TODO-00).** In `Account.Deposit`, throw `ArgumentOutOfRangeException` when the amount is less than or equal to zero; otherwise update the balance and call `OnBalanceChanged` with the old and new balance. In `OnBalanceChanged`, raise `BalanceChanged` with `this` as sender, reading the event once with `?.Invoke`. With no subscribers nothing happens.
2. **Subscribe and unsubscribe with the same method (TODO-01).** In the `Widget` constructor, keep the source and subscribe `OnTick`. In `Dispose`, do `-=` with the same method so the `TickSource` stops holding the widget.
3. **Return the subscription as an IDisposable (TODO-02).** In `PriceFeed.Subscribe`, subscribe the handler and return an `IDisposable` whose `Dispose` unsubscribes. Calling `Dispose` twice must be harmless. A small private class or a lambda-based `IDisposable` both work.
4. **Prove the leak with a WeakReference (TODO-03).** In `WidgetFactory.Create`, create a `Widget` on the source, dispose it when `dispose` is `true` and return only a `WeakReference`, keeping no local reference. One test shows that without `Dispose` the widget stays alive, and the other shows that with `Dispose` it gets collected.
5. **Remember that a lambda written twice is two delegates (TODO-04).** In `LambdaListener`, `Attach` subscribes a handler that increments `Count` and `Detach` removes exactly the same instance. Store the delegate (or use a method group), because repeating the lambda creates another delegate and `-=` removes nothing.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why `ShouldLeakWhenTheWidgetIsNeverDisposed` sees `IsAlive == true` and `HandlerCount == 1`, and why after `Dispose` the same widget is collected.

**Optional challenges**

- **TODO-05:** in `Button.Click`, write `add`/`remove` accessors that store the handlers in a list under a `lock`, ignoring `null` (the shape of a C# 14 `partial event` implementation).
- **TODO-06:** in `Subscriber.Attach`, subscribe only when `maybe` is not null, using C# 14 null-conditional assignment: `maybe?.BalanceChanged += handler;`.

**Prerequisites:** delegates and multicast delegates, `IDisposable` and `using`, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Unimplemented methods throw `NotImplementedException` and the `TODO-NN` comments in the code explain what to do, so the red tests are your checklist.

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
