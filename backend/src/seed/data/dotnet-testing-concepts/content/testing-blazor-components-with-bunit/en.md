---
version: 1.0
updatedAt: 2026-10-18
---
## Objective

A Blazor component is a function of its parameters, its services and the events
the user fires, and most of its bugs live there: a button that stays enabled, a
validation message that never shows, a delete that ignores "Cancel". bUnit renders
a component in memory, without a browser, lets the test click and type, and
exposes the resulting markup for assertions, in milliseconds. The goal is to test
components with bUnit inside MSTest: parameters and callbacks, forms, injected
services with a fake, JavaScript interop, cascading values, authorization and
asynchronous rendering, while avoiding the three ways a bUnit test lies (asserting
before the render finished, hiding JavaScript calls behind loose mode, and
selecting by CSS class), and knowing what bUnit cannot test at all.

## Use Cases

- Proving that a form shows its validation messages and raises its callback only
  for valid input.
- Testing a component that loads data in `OnInitializedAsync`, including its
  loading and empty states, without a server or a database.
- Pinning down the JavaScript a component calls (`confirm`, an analytics or
  announce function) and its behavior for each answer.
- Checking that an `AuthorizeView` hides an action from users without a role.
- Keeping component tests green through a CSS redesign.

## Deep Dive

### The package and the context

The current bUnit is 2.11.3, one `bunit` package with a `net10.0` target. It is
test-framework agnostic, so it sits next to MSTest in an ordinary test project:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.5.1" />
  <PackageReference Include="bunit" Version="2.11.3" />
</ItemGroup>
<ItemGroup>
  <Using Include="Microsoft.VisualStudio.TestTools.UnitTesting" />
  <Using Include="Bunit" />
</ItemGroup>
```

Everything goes through a `BunitContext`: the renderer, a service collection, the
fake JSInterop. The simplest setup is to inherit from it:

```csharp
[TestClass]
public sealed class CounterTests : BunitContext
{
    [TestMethod]
    public void ClickingTheButtonIncrementsTheCount()
    {
        var cut = Render<Counter>();

        cut.Find("button").Click();

        cut.Find("[role=status]").MarkupMatches("<p role=\"status\">Clicked 1 of 3</p>");
    }
}
```

MSTest creates a new instance of the class for every test method and disposes it
afterwards, so each test gets its own renderer and services, and
`[Parallelize(Scope = ExecutionScope.MethodLevel)]` stays safe. When a class
already has a base class, create the context instead: `using var ctx = new
BunitContext();`.

Before bUnit 2 the class was called `TestContext`, which is also the name of
MSTest's `TestContext`. A file that imports both namespaces does not compile:

```text
error CS0104: 'TestContext' is an ambiguous reference between 'Bunit.TestContext'
and 'Microsoft.VisualStudio.TestTools.UnitTesting.TestContext'
```

bUnit 2 renamed it to `BunitContext`, replaced `RenderComponent` with `Render`, and
renamed the `Fake*` test doubles to `Bunit*`. Old blog posts with
`RenderComponent<T>` and `TestContext` are bUnit 1.

### Parameters, callbacks and markup

Parameters go through a builder. An `EventCallback` parameter accepts a lambda,
which is how a test captures what the component raised:

```csharp
var reached = new List<int>();
var cut = Render<Counter>(p => p
    .Add(c => c.Max, 2)
    .Add(c => c.OnLimitReached, (int count) => reached.Add(count)));

cut.Find("button").Click();
cut.Find("button").Click();

Assert.IsTrue(cut.Find("button").HasAttribute("disabled"));
Assert.AreEqual(2, Assert.ContainsSingle(reached));
```

`Find` takes a CSS selector and throws when nothing matches; `FindAll` returns a
list. `MarkupMatches` compares HTML semantically, so whitespace and the order of
attributes and classes do not matter. Use it for a small, stable fragment. For
anything else, assert on the one thing the test is about (an attribute, a text),
because a full-markup comparison breaks on every unrelated change.

### Events and forms

`Click()`, `Change(value)`, `Input(value)` and `Submit()` dispatch the same events
the browser would. An `EditForm` is a normal component tree, so a test fills the
inputs and submits the form:

```csharp
[TestMethod]
public void AValidSubmitRaisesOnCreateAndClearsTheForm()
{
    var cut = RenderForm();
    cut.Find("#title").Change("Buy milk");
    cut.Find("#priority").Change("5");

    cut.Find("form").Submit();

    var created = Assert.ContainsSingle(_created);
    Assert.AreEqual("Buy milk", created.Title);
    Assert.AreEqual(5, created.Priority);
    Assert.AreEqual("", cut.Find("#title").GetAttribute("value"));
}
```

`InputText` binds on `change`, so `Change` is the right event; an input bound with
`@bind:event="oninput"` needs `Input`. The invalid case checks both sides: the
message the `DataAnnotationsValidator` produced is in the markup, and the callback
never ran:

```csharp
cut.Find("form").Submit();

Assert.Contains("Give the task a title.", cut.Markup);
Assert.IsEmpty(_created);
```

### Services: register a fake before the first render

A component that injects a service gets it from `Services`, a normal
`IServiceCollection`. Register a hand-written fake:

```csharp
Services.AddSingleton<ITaskStore>(store);
var cut = Render<TaskList>();
```

The order matters. Once a render has resolved a service, the collection is
closed, and a later `AddSingleton` throws "New services/implementations cannot be
registered with the Services provider in a BunitContext, after the first services
has been retrieved from it". Register everything, then render.

### Asynchronous rendering: wait for the state, not for time

`TaskList` loads in `OnInitializedAsync`. When the store answers later, `Render`
returns with "Loading tasks..." and the component renders again when the task
completes. The lab's fake store holds `GetAllAsync` until the test calls
`Release()`, which makes the two moments explicit:

```csharp
[TestMethod]
public void ShowsLoadingUntilTheStoreAnswers()
{
    var store = new FakeTaskStore(_milk, _dog) { HoldLoading = true };
    var cut = RenderList(store);
    Assert.Contains("Loading tasks...", cut.Markup);

    store.Release();

    cut.WaitForAssertion(() => Assert.HasCount(2, cut.FindAll("li")));
}
```

`Assert.HasCount(2, cut.FindAll("li"))` right after `Release()` fails with
"actual count: 0". `WaitForAssertion` runs the assertion now and again after
every render, and throws `WaitForFailedException` if it has not passed within one
second (the default; the second argument changes it). `WaitForState(predicate)`
does the same with a condition. Never use `Thread.Sleep`.

The dangerous version passes. For an empty store, "there is no `<li>`" is also
true while the component is still loading:

```csharp
store.Release();

// Asserting "no <li>" right away would pass while the list is still loading.
cut.WaitForState(() => cut.Markup.Contains("No tasks yet."));
Assert.IsEmpty(cut.FindAll("li"));
```

Without the `WaitForState`, the test passes even when `OnInitializedAsync` never
assigns the list and the page is stuck on "Loading tasks..." forever. Wait for the
positive sign of the state you expect, then assert what must be absent.

### JavaScript interop: strict by default

bUnit replaces `IJSRuntime` with its own, and in the default `Strict` mode a call
the test did not plan throws. The message says what to add:

```text
Bunit.JSRuntimeUnhandledInvocationException: bUnit's JSInterop has not been configured to handle the call:
    InvokeAsync<bool>("confirm", "Delete 'Buy milk'?")
```

`Setup<T>` answers an `InvokeAsync<T>`, matching the identifier and, when given,
the exact arguments. `SetupVoid` handles `InvokeVoidAsync`, and `VerifyInvoke`
asserts that a call happened:

```csharp
JSInterop.Setup<bool>("confirm", "Delete 'Buy milk'?").SetResult(false);
var cut = RenderList(store);

cut.Find("button[aria-label='Delete Buy milk']").Click();

Assert.HasCount(2, cut.FindAll("li"));
```

```csharp
JSInterop.SetupVoid("taskBoard.announce", "Added Walk the dog");
// ... fill the form and submit ...
JSInterop.VerifyInvoke("taskBoard.announce");
```

`JSInterop.Mode = JSRuntimeMode.Loose` answers every unplanned call with
`default(T)`. It is convenient for a component that calls JavaScript you do not
care about, but it also makes `confirm` return `false` silently and hides whether
the component calls JavaScript at all. Prefer strict with explicit setups, and
switch to loose per test, with a reason.

### Cascading values and authorization

`AddCascadingValue` wraps the component in a `<CascadingValue>`, as a parent
layout would:

```csharp
var cut = Render<TaskList>(p => p.AddCascadingValue(new BoardSettings(HideCompleted: true)));
```

An `<AuthorizeView>` needs the authorization services and the cascading
authentication state that a real app provides. Without them, rendering fails with
"There is no registered service of type
'Microsoft.AspNetCore.Authorization.IAuthorizationPolicyProvider'", even in tests
that are not about authorization. `AddAuthorization()` registers the services and
the cascade, and returns a `BunitAuthorizationContext` that sets the user:

```csharp
private readonly BunitAuthorizationContext _auth;

public TaskListTests() => _auth = AddAuthorization();

[TestMethod]
public void OnlyALeadSeesClearCompleted()
{
    _auth.SetAuthorized("bob");
    var cut = RenderList(new FakeTaskStore(_milk));
    Assert.IsFalse(cut.FindAll("button").Any(b => b.TextContent.Trim() == "Clear completed"));

    _auth.SetRoles("lead");
    cut.Render();

    Assert.IsNotNull(ButtonWithText(cut, "Clear completed"));
}
```

`SetRoles`, `SetPolicies` and `SetClaims` cover role-based, policy-based and
claim-based views. `AddAuthorization` is an extension on the context, so inside a
class that inherits `BunitContext` it is called on `this`.

### Select what the user sees, not the CSS

A done task renders `class="task done text-muted"`. A test that finds
`li.done` works until someone restyles the list. Select by what a user or a screen
reader sees instead: an `aria-label`, an `id` tied to a `<label>`, the text of a
button:

```csharp
cut.Find("input[aria-label='Done: Buy milk']").Change(true);

Assert.IsTrue(milk.Done);
Assert.IsTrue(cut.Find("input[aria-label='Done: Buy milk']").HasAttribute("checked"));
```

In the lab, renaming the class to `"task is-complete"` leaves all 14 tests green,
while a test written as `cut.FindAll("li.done")` turns red on a change that broke
nothing. An element that is hard to select without a CSS class is often missing
an accessible name, which is a bug of its own.

### Do the tests protect the components?

Break the production code on purpose, one change at a time. These are the
results for the lab's solution:

| Change to the production code | Tests that fail |
| --- | --- |
| `OnInitializedAsync` awaits the store but never assigns the list | 8 `TaskList` tests, including both loading tests |
| Delete ignores the answer of `confirm` | `DecliningTheDeleteKeepsTheTask` |
| Toggling a task does not save it | `TickingTheCheckboxMarksTheTaskDoneAndSavesIt` |
| `Roles="lead"` removed from `AuthorizeView` | `OnlyALeadSeesClearCompleted` |
| The cascading `HideCompleted` is ignored | `HideCompletedFromTheCascadingSettingsHidesDoneTasks` |
| The `taskBoard.announce` call is removed | `AddingATaskSavesItShowsItAndAnnouncesIt` |
| `<DataAnnotationsValidator />` removed | both invalid-form tests |
| The counter disables at `count > Max` | `AtTheLimitTheButtonIsDisabledAndTheCallbackGetsTheCount` |
| The CSS class of a done task renamed | none, as it should be |

The first row is the one the naive empty-store test misses.

### What bUnit does not test

bUnit renders in memory with its own renderer. It can emulate a render mode
(`SetAssignedRenderMode`, `SetRendererInfo`) so a branch on
`RendererInfo.IsInteractive` is testable, but it does not run a Blazor Server
circuit, WebAssembly or prerendering. It runs no real JavaScript (only the setups
you wrote), applies no CSS or layout, and its `BunitNavigationManager` records
`NavigateTo` calls without a browser behind them. Routing between pages, a
SignalR reconnect, a JS module that throws, or a button hidden behind another
element need an end-to-end test, for example Playwright against the running app.

## Trade-offs

- **bUnit vs Playwright.** bUnit tests run in milliseconds and pinpoint the
  component; Playwright tests the app a user sees, with real JS, CSS and render
  modes, and costs seconds per test and a running server. Many bUnit tests and a
  few end-to-end tests is the usual split.
- **Strict JSInterop is more setup.** Every JS call needs a line, and a new call
  in the component breaks old tests. That break is information: the test learns
  that the component now depends on JavaScript.
  ```csharp
  JSInterop.Mode = JSRuntimeMode.Loose; // per test, when the JS really does not matter
  ```
- **Hand-written fakes vs mocks.** A fake store with a `HoldLoading` gate makes the
  loading state explicit and needs no library; a mocking library is shorter for a
  one-off answer but tends to verify calls instead of the rendered result.
- **`MarkupMatches` on large fragments is brittle.** Semantic comparison forgives
  whitespace and attribute order, not a new wrapper `<div>`. Keep it for small,
  stable fragments.
- **Inheriting `BunitContext` uses the one base class.** A shared base class for
  your tests then has to inherit `BunitContext` itself, or the test creates a
  `BunitContext` and calls `ctx.Render`.
- **Tests in `.razor` files are an option.** bUnit can also render Razor
  fragments written inline (`Render(@<Counter Max="2" />)`), and its docs set the
  test project's SDK to `Microsoft.NET.Sdk.Razor` for that. They read well for
  markup-heavy components. The lab writes `.cs` tests only, and its test project
  runs on plain `Microsoft.NET.Sdk`.
- **xUnit and NUnit work the same.** bUnit is framework agnostic; with xUnit the
  test class inherits `BunitContext` just like here, and `[Fact]` replaces
  `[TestMethod]`.

## Lab

A task board in a Razor class library (a counter, an `EditForm` and a task list) is already implemented. Your job is to write the bUnit tests in MSTest and to learn where a component test can pass for the wrong reason.

**What you will practice**

- Rendering with parameters and `EventCallback`s, and asserting with `Find`, `FindAll` and `MarkupMatches`.
- Filling and submitting an `EditForm`, valid and invalid.
- Registering a fake service and waiting for asynchronous rendering with `WaitForAssertion` and `WaitForState`.
- Strict JSInterop with `Setup<T>`, `SetupVoid` and `VerifyInvoke`.
- Cascading values, `AddAuthorization`, and selectors that survive a CSS change.

**Prerequisites:** MSTest Fundamentals: Lifecycle and TestContext, Blazor Component Lifecycle and Parameters, Blazor Forms: EditForm and Validation, .NET 10 SDK.

**How it works:** every test method is declared with a hint and fails with `TODO-NN: write this test` until you write it. A fake store is provided and can hold the loading on purpose. The optional TODOs ask you to rename a CSS class and to break the components, and see which tests notice.

## Documentation Links

- [bUnit: writing tests](https://bunit.dev/docs/getting-started/writing-tests.html) (doc)
- [bUnit: migrating from 1.x to 2.x](https://bunit.dev/docs/migrations/1to2.html) (doc)
- [bUnit: verifying markup](https://bunit.dev/docs/verification/verify-markup.html) (doc)
- [bUnit: asynchronous assertions](https://bunit.dev/docs/verification/async-assertion.html) (doc)
- [bUnit: emulating IJSRuntime](https://bunit.dev/docs/test-doubles/emulating-ijsruntime.html) (doc)
- [bUnit: faking authentication and authorization](https://bunit.dev/docs/test-doubles/auth.html) (doc)
- [bUnit: render modes and RendererInfo](https://bunit.dev/docs/interaction/render-modes.html) (doc)
- [Test Razor components in ASP.NET Core Blazor, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/test) (doc)
