---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A Razor component is a C# class with a lifecycle: the framework creates it, hands
it parameters, renders it, and later disposes it. The lifecycle methods are where
most Blazor bugs live: data loaded twice, a callback that updates state but not
the screen, a `StateHasChanged` that throws, a list whose inputs keep the wrong
text after a sort. This concept logs every hook on a real app (SDK 10.0.100,
Interactive Server, prerendering on) and shows what runs, in which order, in the
prerender and in the interactive instance, plus the parameter mechanisms that
feed it: `[Parameter]`, `EventCallback`, cascading values and `@key`. Render modes
and prerendering are in
Blazor Render Modes and Hosting Models,
routing in
Blazor Routing, Layouts and Navigation.

## Use Cases

- Loading data in the right hook, without a second query from the prerender and
  without a flash of empty content.
- Reacting to a parameter change (a route id, a filter) by reloading, and not
  reloading when an unrelated parent re-render happens.
- Wiring a child to its parent with `EventCallback` so the screen updates.
- Cleaning up subscriptions and timers when the user leaves the page.

## Deep Dive

### The hooks, measured

One child component overrides every hook and logs it, with the renderer
(`RendererInfo.IsInteractive`) in brackets. The parent passes an `int Value`, a
`List<int>` and a `string`. The first request, the prerender, logged:

```text
SetParametersAsync start (prerender)
OnInitialized
OnInitializedAsync start / end
OnParametersSet value=0
OnParametersSetAsync
ShouldRender
SetParametersAsync end
Dispose
```

`SetParametersAsync` wraps everything: the base implementation assigns the
`[Parameter]` properties, then calls the initialization hooks (first time only)
and `OnParametersSet{Async}` (every time). `OnAfterRender` is absent, and the
instance was disposed right after the render: a prerendered component is thrown
away when the response ends, and the browser then starts a new instance. In the
interactive instance the same sequence shows up again, now with
`OnAfterRender first=True`, and the later parameter changes log only
`SetParametersAsync`, `OnParametersSet{Async}`, `ShouldRender` and
`OnAfterRender first=False`.

The detail that surprises people is in the middle of the interactive log:

```text
OnInitializedAsync start
OnAfterRender first=True          <- the first render happened here
OnInitializedAsync end            (after the 300 ms delay)
OnParametersSet value=0
```

When `OnInitializedAsync` really awaits something, the framework renders the
component at the first `await` and renders again when the task completes. A
component must therefore handle the state "not loaded yet" (`items is null`),
and `OnAfterRender(firstRender: true)` can run before the data arrived. If the
method completes synchronously, there is a single render.

### What `OnAfterRender` is for

`OnAfterRender{Async}` runs when the DOM exists, so it is the place for
JavaScript interop. During prerendering there is no browser to call. Calling
`IJSRuntime` from `OnInitializedAsync` logged:

```text
InvalidOperationException: JavaScript interop calls cannot be issued at this time.
This is because the component is being statically rendered. When prerendering
is enabled, JavaScript interop calls can only be performed during the
OnAfterRenderAsync lifecycle method.
```

The same call inside `if (firstRender)` in `OnAfterRenderAsync` worked. Do not
call `StateHasChanged` unconditionally in `OnAfterRender`: it schedules another
render, which runs `OnAfterRender` again, an infinite loop. Guard it with
`firstRender` or a state check.

### When parameters set again

Clicking a parent button that only changes an unrelated `other` counter made the
`List<int>` child run `SetParametersAsync` and `OnParametersSet` again, with the
same values. A second child with only an `int` and a `string` did not:

```text
[prim] OnParametersSet value=0   (initial)
(click "other": nothing logged)
[prim] OnParametersSet value=1   (click "v": a parameter changed)
```

The documentation explains it: the hooks run when the parent re-renders and
supplies known or primitive immutable types with at least one change, or when
any complex-typed parameter is present, because the framework cannot know
whether a mutable object changed inside. So `OnParametersSetAsync` is not "the
parameter changed". Compare with the previous value yourself before reloading:

```csharp
[Parameter] public int ProductId { get; set; }
private int loadedId;

protected override async Task OnParametersSetAsync()
{
    if (ProductId == loadedId) return;   // a parent re-render with same id: skip
    loadedId = ProductId;
    product = await Service.GetAsync(ProductId);
}
```

Overriding `ShouldRender` to return `false` skips the render but does not skip the
parameter hooks. `OnInitializedAsync` is the wrong place to load by parameter,
because it runs once per instance and a route to the same component with another
id reuses the instance.

### `EventCallback` versus a delegate

A child that reports to its parent takes an `EventCallback` or
`EventCallback<T>`. The same child had two buttons, one invoking an
`EventCallback<int>` and one an `Action<int>`, both bound to a parent method that
did `picked += n`:

```text
click callback  -> screen: picked=1
click action    -> screen: picked=1   (the field was 2, the UI was not re-rendered)
click "other"   -> screen: picked=2   (any later render shows it)
```

`EventCallback.InvokeAsync` calls the handler and then re-renders the component
that owns it, which is what the documentation means by `StateHasChanged` being
called automatically. A raw `Action` or `Func<Task>` runs the code and nothing
more. `EventCallback` also tolerates an unset parameter (calling it does
nothing), and `EventCallback<T>` can be used with `@bind` through the
`ValueChanged` convention.

### `StateHasChanged` and the dispatcher

A component updates the screen by queuing a render. Handlers that the framework
invokes (events, `EventCallback`, lifecycle hooks) already run on the renderer's
synchronization context. Code that wakes up elsewhere (a `Task.Run`, a timer, an
event from a service) does not. Calling `StateHasChanged` there threw:

```text
InvalidOperationException: The current thread is not associated with the
Dispatcher. Use InvokeAsync() to switch execution to the Dispatcher when
triggering rendering or component state.
```

The fix is `await InvokeAsync(StateHasChanged);`, and state changes made from
that outside code should be inside the `InvokeAsync` too. In the run, the field
had already been changed from the wrong thread before the exception, a data race
the exception only half-reports.

### Cascading values

`<CascadingValue Value="theme">` makes a value available to every descendant
with a `[CascadingParameter]` of the matching type (or `Name`). When the
parent's value changes, subscribed descendants re-run `OnParametersSet`:

```razor
<CascadingValue Value="theme"><Themed /></CascadingValue>
<CascadingValue Value="theme" IsFixed="true"><Themed /></CascadingValue>
```

After flipping `theme` from `dark` to `light`, only the first `Themed` logged
`OnParametersSet theme=light`. `IsFixed` skips the subscription, which the
documentation presents as the cheaper choice when the value never changes. Two
limits from the same page: cascading parameters do not cross a render mode
boundary (a static page cannot cascade a value into an interactive component),
and for app-wide state the supported route is `AddCascadingValue` as a root-level
service, because it is available to interactive components.

### `@key` and disposal

Blazor diffs a list by position. Two lists of three `Row` components, each with
an `<input>` filled with `typed-0`, `typed-1`, `typed-2`, then reversed:

```text
no @key : c (instance 13)|typed-0   b (instance 14)|typed-1   a (instance 15)|typed-2
@key    : c (instance 18)|typed-2   b (instance 17)|typed-1   a (instance 16)|typed-0
```

Without `@key` the component instances stayed in place and only their `Label`
parameter changed, so the text in the DOM input no longer matched the item. With
`@key="n"` the instances moved with their items, and so did the typed text. Use a
stable identity (an id, not the loop index) wherever rows hold state.

`IDisposable` (or `IAsyncDisposable`) is the hook for unsubscribing. Besides the
prerender instance, `Dispose` also ran for the interactive instance after the
tab navigated away, a few seconds later, when the circuit was torn down. A timer
or event subscription created in `OnInitialized` and never released keeps the
component alive on the server.

## Trade-offs

- **Loading in `OnInitializedAsync` runs twice with prerendering.** Both the
  prerender and the interactive instance run it, so the query happens twice unless
  the state is persisted between them.
  ```csharp
  [PersistentState] public List<Product>? Products { get; set; }
  protected override async Task OnInitializedAsync() => Products ??= await Service.ListAsync();
  ```
- **`OnParametersSet` is a "parent rendered" signal, not a change signal.**
  A mutable parameter makes it fire on every parent render, so reload only on a
  real change.
- **`EventCallback` is the safe default for child-to-parent.** A plain delegate
  is fine for a helper that never touches state, but it will not refresh the
  parent.
- **`@key` costs memory and diffing work.** It is worth it for rows with state or
  animations, and noise for a static list.
- **Fixed cascading values are fast and frozen.** A value that is replaced
  later needs a non-fixed `CascadingValue`, and every subscriber pays for it.
- **`StateHasChanged` is a smell in handlers.** Events already re-render;
  calling it by hand usually means the code runs outside the dispatcher and
  needs `InvokeAsync`.

## Documentation Links

- [ASP.NET Core Razor component lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/lifecycle) (doc)
- [ASP.NET Core Razor component rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/rendering) (doc)
- [ASP.NET Core Blazor event handling and EventCallback, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/event-handling) (doc)
- [ASP.NET Core Blazor cascading values and parameters, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/cascading-values-and-parameters) (doc)
- [Prerender ASP.NET Core Razor components, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/prerender) (doc)
