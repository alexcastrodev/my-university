---
version: 1.0
updatedAt: 2026-11-21
---
## Objective

MVVM splits a client app in three: the View (what is drawn), the ViewModel (the state and the actions the View needs, with no reference to any control) and the Model (the data and rules). The View binds to the ViewModel through two small contracts: `INotifyPropertyChanged` says "this value changed" and `ICommand` says "this action exists and may or may not run now". The payoff is not the binding itself but that a ViewModel is a plain class you can test without a window. `CommunityToolkit.Mvvm` (the Microsoft-maintained successor of MVVM Light) writes the repetitive part with source generators. This lesson runs the real package in a console project on macOS (the Toolkit has no UI dependency): the code the generators write, the exact order of events, async commands and the exception that kills the app, weak against strong messengers measured with the GC, `Ioc.Default`, and a ViewModel tested with MSTest 4 with no UI. XAML, `{Binding}`, compiled bindings and anything that needs WPF, WinUI or MAUI is labelled docs only.
Versions (NuGet, resolved 2026-11-21): `CommunityToolkit.Mvvm` 8.4.2 (published 2026-03-25, newest stable), `Microsoft.Extensions.DependencyInjection` 10.0.15 (11.0.0 on net11.0), `MSTest` 4.5.3 (MSTest.Sdk, Microsoft.Testing.Platform), TFM `net10.0` on SDK 10.0.100 (runtime 10.0.0) and `net11.0` on SDK 11.0.100 (runtime 11.0.0), one Apple M4 Max with macOS 27.2.1 (timings are from it).

## Use Cases

- Building a WPF, WinUI or .NET MAUI screen whose logic must be unit tested without starting the UI.
- Replacing 40 lines of hand-written `INotifyPropertyChanged` and `ICommand` plumbing per ViewModel with attributes.
- Validating input in the ViewModel (`INotifyDataErrorInfo`) so the form shows errors from the same rules the tests use.
- Letting two screens talk (a user changed, a list must refresh) without one holding a reference to the other.
- Migrating an MVVM Light or hand-written `ViewModelBase` code base, or a MAUI app that used `MessagingCenter`.

## Deep Dive

### What MVVM is, and what it is not

The View owns layout and gestures; the ViewModel owns state (`FirstName`, `IsRunning`, `Items`) and actions (`SaveCommand`); the Model owns data and business rules. The ViewModel never mentions a control, a window or a dialog type, which is exactly what makes it testable. What MVVM is not: code-behind that reads `NameTextBox.Text` and writes `ResultLabel.Text` (that is the View doing the ViewModel's job, and no test can reach it), a class named `...ViewModel` that still calls `MessageBox.Show`, or a pattern you need for a screen with one button. Per the MAUI docs, a Model is ignorant of the ViewModel and a ViewModel is ignorant of the View, and in small samples there is often no Model at all (docs only: the bindings live in XAML).

### By hand: INotifyPropertyChanged and INotifyDataErrorInfo

This is the base class every older book writes, plus a validating ViewModel, reduced to what compiles (`HandWrittenPerson`, about 35 lines in the lab):

```csharp
public abstract class ViewModelBase : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }
}
```

`INotifyDataErrorInfo` by hand adds `HasErrors`, `GetErrors(name)`, `ErrorsChanged` and a message dictionary you keep in sync. Setting `First` to `"a"`, `"a"` again, then `"Ada"` raised `PropertyChanged` 4 times (`First` and the computed `Full`, twice) and `ErrorsChanged` twice, and `HasErrors` ended false. The equality guard is why the second `"a"` raised nothing. The delegate and event mechanics underneath are in [Delegates and Multicast Invocation](/csharp-concepts/delegates-and-multicast-invocation) and [Events, the Observer Pattern and Memory Leaks](/csharp-concepts/events-observer-pattern-and-memory-leaks): a View that subscribes to `PropertyChanged` is the long-lived-publisher leak described there, which bindings handle for you.

### ObservableObject, ObservableValidator and [ObservableProperty]

`ObservableObject` is that base class (it also adds `PropertyChanging`, `SetProperty`, `SetPropertyAndNotifyOnCompletion`); `ObservableValidator` adds `INotifyDataErrorInfo` on top of `System.ComponentModel.DataAnnotations`. `[ObservableProperty]` writes the property. The Learn page for the Toolkit is dated 2024-11-07 and shows only fields (`[ObservableProperty] private string name;`). Version 8.4.0 (released 2024-12-12, release notes: "Add support for partial properties for [ObservableProperty]") changed the recommendation, and the repository now ships an Info diagnostic MVVMTK0042 that says a field "can be converted to a partial property instead, which is recommended". A partial property needs C# 14 (the `field` keyword), which is the default on `net10.0`. This is the ViewModel measured below:

```csharp
public partial class PersonViewModel : ObservableValidator
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FullName))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    [NotifyDataErrorInfo]
    [Required, MinLength(2)]
    public partial string FirstName { get; set; }

    partial void OnFirstNameChanging(string value) => Log.Add($"Changing({value})");
    partial void OnFirstNameChanged(string oldValue, string newValue) => Log.Add($"Changed({oldValue} -> {newValue})");

    bool CanSave() => !HasErrors && FirstName.Length > 0;
    [RelayCommand(CanExecute = nameof(CanSave))] void Save() => Saves++;
}
```

With `EmitCompilerGeneratedFiles` the compiler writes what the generator produced. The setter of `FirstName` (attributes and doc comments trimmed):

```csharp
public partial string FirstName
{
    get => field;
    [RequiresUnreferencedCode("The type of the current instance cannot be statically discovered.")]
    set
    {
        if (!EqualityComparer<string>.Default.Equals(field, value))
        {
            string __oldValue = field;
            OnFirstNameChanging(value);
            OnFirstNameChanging(__oldValue, value);
            OnPropertyChanging(__KnownINotifyPropertyChangingArgs.FirstName);
            OnPropertyChanging(__KnownINotifyPropertyChangingArgs.FullName);
            field = value;
            ValidateProperty(value, "FirstName");
            OnFirstNameChanged(value);
            OnFirstNameChanged(__oldValue, value);
            OnPropertyChanged(__KnownINotifyPropertyChangedArgs.FirstName);
            OnPropertyChanged(__KnownINotifyPropertyChangedArgs.FullName);
            SaveCommand.NotifyCanExecuteChanged();
        }
    }
}
```

Reading it: the same equality guard as the hand-written version; four optional partial hooks (`OnXChanging`/`OnXChanged`, each with a one-argument and an old/new overload, calls to unimplemented partials are removed by the compiler); a cached `PropertyChangedEventArgs` per name (no allocation per notification); one extra notification per `[NotifyPropertyChangedFor]`; validation between the assignment and the `Changed` hook; and `SaveCommand.NotifyCanExecuteChanged()` for `[NotifyCanExecuteChangedFor]`. The setter carries `[RequiresUnreferencedCode]` because `[NotifyDataErrorInfo]` validates through `DataAnnotations` reflection, so it is not trim-safe (the other property, `LastName`, has no such attribute). The generator also writes `CreateAllPropertiesValidator` for `ValidateAllProperties()`, so that call finds the properties without reflection over members. The generated files carry `GeneratedCode("...", "8.4.0.0")` although the package is 8.4.2: the generator assembly version, not the package version. The Roslyn side of how such a generator is written is in [Writing a Roslyn Analyzer and an Incremental Source Generator](/csharp-concepts/writing-a-roslyn-analyzer-and-an-incremental-source-generator), and the platform generators in [Source Generators and AOT-Friendly Code](/dotnet-concepts/source-generators-and-aot-friendly-code).

The order of events, measured by subscribing to everything and setting properties (`net10.0` and `net11.0` printed identical text):

```text
start: HasErrors=True CanExecute=False                 <- the constructor assigned "" and [Required] failed
FirstName = "a":
  Changing(a) / PropertyChanging(FirstName) / PropertyChanging(FullName)
  ErrorsChanged(FirstName)
  Changed( -> a) / PropertyChanged(FirstName) / PropertyChanged(FullName)
  CanExecuteChanged(CanExecute=False)
  errors=[The field FirstName must be a string or array type with a minimum length of '2'.]
FirstName = "a" again:   (nothing)
FirstName = "Ada":
  Changing(Ada) / PropertyChanging x2 / PropertyChanged(HasErrors) / ErrorsChanged(FirstName)
  Changed(a -> Ada) / PropertyChanged(FirstName) / PropertyChanged(FullName) / CanExecuteChanged(CanExecute=True)
```

Three surprises worth keeping: assigning a value in the constructor already validates (so `HasErrors` is true before any user input, and a form may show an error on first render); `ErrorsChanged` fires before `OnFirstNameChanged` and before the `PropertyChanged` of the property; `HasErrors` raises its own `PropertyChanged` only when its value flips. The field form, for contrast, generates `get => _title;` with `[MemberNotNull("_title")]` on the setter and `OnTitleChanged(string? oldValue, string newValue)`: the same behaviour, but the property does not exist for other generators and analyzers until the generator runs, which is the stated reason for the partial-property recommendation (MVVMTK0045 goes further for WinUI 3 and UWP: a field "will generate code that is not AOT compatible in WinRT scenarios", docs and repository only, not run here).

Two measured build gotchas. With `<LangVersion>13</LangVersion>` the same project failed with `CS9248: Partial property 'PersonViewModel.FirstName' must have an implementation part`: the generator emitted nothing, and I did not see the MVVMTK0041 message the repository documents in the CLI output. And `CompilerGeneratedFilesOutputPath` set to a folder inside the project (`generated`) made the next build fail with dozens of `CS0102`, `CS0111` and `CS0579` duplicates, because the default globbing compiled the emitted files again; `obj/generated` is safe.

### RelayCommand: ICommand without the class

`ICommand` is `Execute`, `CanExecute` and `CanExecuteChanged`. `[RelayCommand]` on a method generates a lazily created `IRelayCommand` property named after it (`Save` becomes `SaveCommand`, `LoadAsync` becomes `LoadCommand`):

```csharp
public IRelayCommand SaveCommand => saveCommand ??= new RelayCommand(new Action(Save), CanSave);
```

`CanExecute = nameof(CanSave)` links the guard, and `[NotifyCanExecuteChangedFor]` (above) is what re-raises `CanExecuteChanged`. In the event log above `CanExecuteChanged` fired after `FirstName` changed and the command reported `CanExecute=False`, then `True`. The `ICommand` contract is that the UI re-queries `CanExecute` when the event is raised (docs only: no UI here).

### AsyncRelayCommand: IsRunning, cancellation and the exception that crashes the app

For `async Task LoadAsync(CancellationToken ct)` the generator creates an `AsyncRelayCommand` and passes the token (`IncludeCancelCommand = true` adds a `...CancelCommand`). Measured with a command that waits 200 ms:

```text
before: IsRunning=False ExecutionTask=null
right after Execute: IsRunning=True CanExecute=False task=WaitingForActivation
after: IsRunning=False CanExecute=True task=RanToCompletion Calls=1
  at start and at end: PropertyChanged(ExecutionTask, IsRunning, CanBeCanceled ...), then CanExecuteChanged(False) and later (True)
```

`IsRunning` is `ExecutionTask is { IsCompleted: false }`, so a spinner binds to it. By default `CanExecute` is false while running (`AsyncRelayCommandOptions.AllowConcurrentExecutions` off; with `[RelayCommand(AllowConcurrentExecutions = true)]` it stayed true while running). Now the part the docs bury and the source confirms: `Execute` does not call `CanExecute`; the button does. Calling `Execute(null)` twice while running ran the delegate twice (`Calls=2`), and because the delegate takes a `CancellationToken` the second call cancelled the first (`first task is Canceled`).

What happens to an exception depends on `AsyncRelayCommandOptions.FlowExceptionsToTaskScheduler`. `Execute` ends in `static async void AwaitAndThrowIfFailed(Task)`, so by default the exception is rethrown on the caller's `SynchronizationContext`. I recorded what a UI-like context receives, and what a console (no context) does:

```text
default, delegate throws InvalidOperationException("boom"):   ExecutionTask Faulted; posted to the context: InvalidOperationException: boom
default, no SynchronizationContext (console):                  UnhandledException(terminating=True): boom, process exit code 134
default, Load2CancelCommand cancels the token:                 ExecutionTask Canceled; posted: TaskCanceledException: A task was canceled.
default, second Execute cancels the first:                     posted: TaskCanceledException
FlowExceptionsToTaskScheduler = true, throws:                  ExecutionTask Faulted ("boom2"); posted: nothing
  ...never awaited, no context: UnobservedTaskException raised once, after GC, process alive
await command.ExecuteAsync(null) with the flag:                the caller gets InvalidOperationException (nothing posted)
```

In a WPF or WinUI app a posted exception is the unhandled-dispatcher-exception path, i.e. a crash unless the app handles it (docs only: no UI here). The Learn page says so ("exceptions being thrown would just crash the app") and its cancellation example wraps the work in `catch (OperationCanceledException)`. So cancelling a cancelable async command without that `catch` is a crash by default, as measured. The two safe shapes: catch `OperationCanceledException` and your own exceptions inside the method, or set the flag and read `ExecutionTask` (it is also how you bind an error message), accepting that unrelated exceptions are then silent unless you log `UnobservedTaskException`.

### Messenger: weak against strong

`IMessenger` decouples ViewModels: a recipient registers for a message type (`Register<Ping>(this)` with `IRecipient<Ping>`, or a handler lambda) and any code calls `Send(new Ping(1))`. There are two implementations. `WeakReferenceMessenger` holds recipients weakly and is the default of `ObservableRecipient`; `StrongReferenceMessenger` holds them strongly and needs an explicit `Unregister`. The experiment: register a recipient, drop every reference, force the GC, send again (Release, one `NoInlining` method creates the recipient so the JIT cannot keep it alive):

```text
WeakReferenceMessenger     IRecipient<Ping>        after GC, no reference: received 0, recipient collected
WeakReferenceMessenger     lambda with and without this   received 0, collected
StrongReferenceMessenger   IRecipient<Ping>        received 1, recipientAlive=True   (all three variants)
StrongReferenceMessenger   after Unregister<Ping>(r): received 1 of 2 sends
```

The weak one silently stops delivering once the recipient is garbage, which is a feature for a screen that was closed and a bug for a recipient you forgot to keep (nothing throws). The strong one never lets the recipient go: the same leak as the event subscription in the [events lesson](/csharp-concepts/events-observer-pattern-and-memory-leaks), with the messenger as the long-lived publisher. Even a handler lambda that captures `this` was collected by the weak messenger (the docs advise `(r, m) => ...` to avoid capturing for speed; I measured only that it did not keep the recipient alive). The cost, `1000` recipients and `1000` sends (1,000,000 deliveries), Release, three runs each:

```text
                          net10.0 (10.0.0)              net11.0 (11.0.0)
Weak   per delivery       32 to 38 ns                   27 to 29 ns
Strong per delivery       24 to 27 ns                   18 to 20 ns
register 1000 recipients  0.11 to 0.9 ms (first run slowest, both)
200,000 short-lived recipients registered then dropped, heap after GC:
  Weak   -245 KB (nothing kept)     Strong +96,441 KB, about 480 bytes each   (net11.0: -122 KB and +56,805 KB)
```

Weak is roughly 1.3 to 1.4 times slower per delivery in these runs and retains nothing; strong is faster and retains everything until you unregister. The two runtimes differ in speed only (the messenger code is the same package), so read the numbers as this machine's. How the GC decides a recipient is dead is in [The Garbage Collector: Generations and the LOH](/csharp-concepts/garbage-collector-generations-and-the-loh). Other measured rules: registering the same recipient twice for the same message throws `InvalidOperationException: The target recipient has already subscribed to the target message.`; and `ObservableRecipient` registers its `IRecipient<T>` handlers when `IsActive = true` and unregisters on `false` (the generated `RegisterAll` code is plain `messenger.Register<Ping>(recipient)`).

Request messages turn a send into a question: `class WhoAmI : RequestMessage<string> { }`, a receiver calls `q.Reply("ada")`, and `string who = messenger.Send<WhoAmI>()` returned `'ada'`. With no receiver the implicit conversion threw `InvalidOperationException: No response was received for the given request message.` (assign the returned message to a variable instead to allow no reply). `AsyncRequestMessage<T>` and the collection variants exist (docs only).

### Ioc.Default: a service locator with a friendly name

`Ioc.Default` wraps one global `IServiceProvider`. Measured: before configuration `GetRequiredService` throws `InvalidOperationException: The service provider has not been configured yet.`; a second `ConfigureServices` throws `The default service provider has already been configured.` (it is configured once per process, which shapes tests). The trap is using it inside a ViewModel:

```csharp
sealed class ReportViewModel(IClock clock) { }                       // dependency visible, new ReportViewModel(fake) works
sealed class LocatorViewModel { readonly IClock _clock = Ioc.Default.GetRequiredService<IClock>(); }  // hidden, needs global setup
```

Both printed `clock=SystemClock` once configured, but only the first can be built in a test with a fake and no static state. That is the service locator pattern: the dependency list is no longer in the constructor. Use `Ioc.Default` at the composition root (resolve the first ViewModel for the window) and constructor injection below it; the lifetimes and registration are in [Dependency Injection and Service Lifetimes](/dotnet-concepts/dependency-injection-and-service-lifetimes). MAUI and the other hosts have their own DI integration (docs only).

### Testing a ViewModel with no UI

This is the central gain. Five MSTest 4.5.3 tests (project `MSTest.Sdk/4.5.3`, run with `dotnet test --project`) passed on `net10.0` and `net11.0`, total duration about 0.4 s, no window, no dispatcher:

```csharp
[TestMethod]
public async Task Load_sets_IsRunning_then_Message_without_any_UI()
{
    var greeter = new ManualGreeter();                 // IGreeter fake that returns a TaskCompletionSource task
    var vm = new GreetingViewModel(greeter);
    Assert.IsFalse(vm.LoadCommand.CanExecute(null));   // Name is empty
    vm.Name = "Ada";
    Task run = vm.LoadCommand.ExecuteAsync(null);      // ExecuteAsync, not Execute: the test awaits it
    Assert.IsTrue(vm.LoadCommand.IsRunning);
    greeter.Pending.SetResult("Hello, Ada");
    await run;
    Assert.IsFalse(vm.LoadCommand.IsRunning);
    Assert.AreEqual("Hello, Ada", vm.Message);
}
```

The others: a `PropertyChanged` handler collects names and asserts `FirstName` and `FullName` fired once, and nothing for the same value; `SaveCommand.CanExecuteChanged` fired twice across invalid then valid input; a failing greeter surfaces through `ExecuteAsync` as `InvalidOperationException` (the default options, awaited, so it is catchable, unlike `Execute`); and an `ObservableRecipient` built over `new WeakReferenceMessenger()` (never `.Default`) receives while `IsActive` and stops after. Use `ExecuteAsync` in tests: `Execute` returns before the work ends and rethrows on the thread pool. A `TaskCompletionSource` fake makes the intermediate state (`IsRunning=true`) observable without a delay. `dotnet test --project` needs `{"test":{"runner":"Microsoft.Testing.Platform"}}` in `global.json` and is read from the current directory: without it the SDK 10.0.100 passed the flag to MSBuild (`MSB1001: Unknown switch`). The framework side is in [MSTest Fundamentals](/dotnet-testing-concepts/mstest-fundamentals-lifecycle-and-testcontext) and [Test Doubles](/dotnet-testing-concepts/test-doubles-fakes-stubs-and-nsubstitute).

### Blazor and MVU, for contrast

Blazor has no `INotifyPropertyChanged` need: `@bind` wires an input to a component member and an event handler re-renders the component; when state changes from outside an event (a timer, a service callback) you call `StateHasChanged` yourself (see [Blazor Component Lifecycle and Parameters](/dotnet-concepts/blazor-component-lifecycle-and-parameters) and [Blazor Forms](/dotnet-concepts/blazor-forms-editform-and-validation)). The component is both View and ViewModel, so the testing story is bUnit rather than a plain class. Model-View-Update (MVU) goes further: one immutable state, messages describe what happened, a pure `update(state, message)` returns the next state and the view is a function of it, with no change notification at all. I only describe the idea here; no .NET MVU library was run for this lesson. For the choice of UI framework see [Choosing a .NET Client UI Framework](/dotnet-client-apps-concepts/choosing-a-dotnet-client-ui-framework).

### Docs only (needs a UI toolkit)

XAML `{Binding}` and `x:Bind`, `DataContext` and `BindingContext`, one-way and two-way modes, converters, `x:DataType` compiled bindings in MAUI (the compiled-bindings page; the data-binding page uses them in its samples) and WPF `Binding` are not run here. The MAUI MVVM page (dated 2024-08-30) states that MAUI marshals binding updates to the UI thread, so a ViewModel property may be set from any thread; I did not test that. MAUI `MessagingCenter`: the .NET 10 "what's new" page says it "has been made internal" and the `MessagingCenter` page says it is "deprecated in .NET 10"; both point to `WeakReferenceMessenger`. The two pages disagree on the word, the advice is the same.

### Book vs today

Older books and posts write `ViewModelBase`, `RelayCommand`/`DelegateCommand` and a messenger by hand, or use MVVM Light (`ViewModelBase`, `Messenger.Default`, `SimpleIoc`). MVVM Light's own README says "MVVM Light is not maintained anymore" and recommends the Microsoft MVVM Toolkit; its last NuGet release is 5.4.1.1 (2018-09-11), marked deprecated "Legacy" with `CommunityToolkit.Mvvm` as the alternate. Today the default is `CommunityToolkit.Mvvm` with `[ObservableProperty]` on partial properties and `[RelayCommand]`. Alternatives, from their own sources: Prism (9.0.537 on 2024-08-20) is a fuller framework with navigation and modules and, since 9.0, dual licensed: a free Community License and a Commercial License required by larger organizations (its README); ReactiveUI (27.0.1 on 2026-11-16, MIT) builds MVVM on observables (Rx), a different style, not measured here. I did not compare their performance or ergonomics.

## Trade-offs

- **Generated code is invisible until you look.** A bad attribute combination gives a diagnostic, not a stack trace. Emit the files once (`EmitCompilerGeneratedFiles`, output under `obj/`) and read them.
- **Partial properties raise the language floor.** They need C# 14; a net8 or net9 project must set `<LangVersion>14.0</LangVersion>` with SDK 10, or stay on fields. Measured: LangVersion 13 fails with CS9248.
- **`[NotifyDataErrorInfo]` is reflection-based validation.** Fine for forms, not trim-safe (`RequiresUnreferencedCode`), and it validates in the constructor assignment, so initial state may already be invalid.
- **The default async command crashes on cancel.** Catch `OperationCanceledException` in the method, or:
  ```csharp
  [RelayCommand(FlowExceptionsToTaskScheduler = true)] async Task SaveAsync(CancellationToken ct) { ... }
  ```
  and then log `TaskScheduler.UnobservedTaskException`, because errors become silent.
- **Weak messengers fail quietly, strong ones leak loudly.** Weak: a recipient nobody references stops receiving without an error. Strong: 480 bytes per forgotten recipient in the run above, forever. Default to weak, and unregister in `OnDeactivated` anyway.
- **`Ioc.Default` is global state.** One configuration per process, no per-test container. Keep it at the composition root.
- **MVVM has ceremony.** For a one-screen tool, code-behind is simpler; the cost pays back when the logic needs tests or the screen has several states.

## Documentation Links

- [MVVM Toolkit introduction, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/) (doc)
- [ObservableProperty attribute, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/generators/observableproperty) (doc)
- [RelayCommand attribute, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/generators/relaycommand) (doc)
- [AsyncRelayCommand, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/asyncrelaycommand) (doc)
- [Messenger, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/messenger) (doc)
- [Inversion of control (Ioc.Default), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/ioc) (doc)
- [ObservableValidator, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/observablevalidator) (doc)
- [CommunityToolkit/dotnet repository, GitHub](https://github.com/CommunityToolkit/dotnet) (doc)
- [CommunityToolkit 8.4.0 release notes, GitHub](https://github.com/CommunityToolkit/dotnet/releases/tag/v8.4.0) (doc)
- [Data binding and MVVM in .NET MAUI, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/xaml/fundamentals/mvvm) (doc)
- [What's new in .NET MAUI for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/whats-new/dotnet-10) (doc)
- [Publish and subscribe to messages (MessagingCenter), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/fundamentals/messagingcenter) (doc)
- [Compiled bindings in .NET MAUI, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/fundamentals/data-binding/compiled-bindings) (doc)
- [INotifyPropertyChanged interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.inotifypropertychanged) (doc)
- [INotifyDataErrorInfo interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.inotifydataerrorinfo) (doc)
- [ICommand interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.windows.input.icommand) (doc)
- [MVVM Light (not maintained), GitHub](https://github.com/lbugnion/mvvmlight) (doc)
- [Prism library, GitHub](https://github.com/PrismLibrary/Prism) (doc)
