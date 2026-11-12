---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Unit tests, `WebApplicationFactory` and bUnit all stop before a real browser. An
end-to-end test drives Chromium against the running app, with real JavaScript,
CSS and network, so it catches what the layers below cannot: a button that
exists but cannot be clicked, a script that never loads. The goal is to write
Playwright for .NET tests with MSTest 4 against an ASP.NET Core app running on a
real Kestrel socket (not `TestServer`): locators a user would use, web-first
assertions that wait, a trace to read a failure, and a Page Object so the DOM
lives in one class. It also covers a real compatibility trap: the
`Microsoft.Playwright.MSTest` package does not work with MSTest 4.

## Use Cases

- Proving that the page, the script and the API work together for a critical
  flow (add a task, check it out, see the total).
- Checking behavior only a browser has: focus, visibility, a slow response
  followed by a render, a reload that keeps the data.
- Reproducing a CI failure from a trace (screenshots, DOM snapshots, network)
  instead of a stack trace and a guess.
- Running a handful of smoke flows after a deployment while the many fast tests
  stay in unit and integration layers.

## Deep Dive

### The package that discovers 0 tests

The documented route is `Microsoft.Playwright.MSTest` and a `PageTest` base
class. With MSTest 4.5.3 on the .NET 11 GA SDK, a project that references
`MSTest` 4.5.3 and `Microsoft.Playwright.MSTest` 1.64.1 compiles, prints warning
MSTEST0082 for the inherited `[TestInitialize]` and `[TestCleanup]` members, and
`dotnet test` answers "No test is available". The cause is in the assembly
references: `Microsoft.Playwright.MSTest.dll` references
`Microsoft.VisualStudio.TestPlatform.TestFramework` 14.0.0.0, the assembly name
of MSTest 2.x, while MSTest 4 ships `MSTest.TestFramework`. MSTest matches its
attributes by exact type identity, so the hooks of `PageTest` are silently
ignored, and the adapter fails to load the old framework assembly when it
discovers tests. The package's nuspec still depends on MSTest 2.2.7. Replacing
MSTest with 3.11.1 makes the same test pass, which confirms it.

The fix with MSTest 4 is to reference the core `Microsoft.Playwright` package
(1.64.1) and write the small base class yourself:

```xml
<PackageReference Include="MSTest" Version="4.5.3" />
<PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.14" />
<PackageReference Include="Microsoft.Playwright" Version="1.64.1" />
```

That is about 30 lines, shown below, and it removes the dependency on a package
that is behind the framework.

### Install the browser once

Playwright drives its own browser builds. Building a test project copies
`playwright.ps1` next to the assembly; run it once:

```bash
dotnet build
pwsh bin/Debug/net10.0/playwright.ps1 install chromium
```

Without PowerShell, a console app that calls
`Microsoft.Playwright.Program.Main(["install", "chromium"])` does the same (that
is how the lab was verified). Set `PLAYWRIGHT_BROWSERS_PATH` to choose where the
browsers go. The test only needs Chromium; on CI, install it before `dotnet test`
and cache the folder.

### A real Kestrel server, not TestServer

`WebApplicationFactory` hosts the app on `TestServer` by default, which has no
socket: a browser cannot open it. Start Kestrel instead, once for the run:

```csharp
[TestClass]
public static class TestEnvironment
{
    private static WebApplicationFactory<Program>? _factory;
    private static IPlaywright? _playwright;
    public static string BaseUrl { get; private set; } = "";
    public static IBrowser Browser { get; private set; } = null!;
    public static TaskStore Store => _factory!.Services.GetRequiredService<TaskStore>();

    [AssemblyInitialize]
    public static async Task Start(TestContext _)
    {
        _factory = new WebApplicationFactory<Program>();
        _factory.UseKestrel(0);          // a free port on 127.0.0.1
        _factory.StartServer();
        BaseUrl = _factory.CreateClient().BaseAddress!.ToString();

        _playwright = await Playwright.CreateAsync();
        Browser = await _playwright.Chromium.LaunchAsync(new() { Headless = true });
    }

    [AssemblyCleanup]
    public static async Task Stop()
    {
        await Browser.CloseAsync();
        _playwright?.Dispose();
        if (_factory is not null) await _factory.DisposeAsync();
    }
}
```

`UseKestrel(0)` (new in .NET 10, see the WebApplicationFactory concept) picks a
free port, and the client's `BaseAddress` tells you which. One host and one
browser process serve the whole run; starting a browser per test is the slow
mistake. Because the host is shared, tests reset the server state (here the
`TaskStore` singleton) before each one.

### A base class: one context per test, a trace when it fails

The replacement for `PageTest` is a base class with MSTest hooks. A browser
context is cheap and isolated (its own cookies and storage), so every test gets a
new one. The trace records screenshots and DOM snapshots and is saved only when
the test did not pass:

```csharp
public abstract class E2ETest
{
    public TestContext TestContext { get; set; } = null!;
    protected IBrowserContext Context { get; private set; } = null!;
    protected IPage Page { get; private set; } = null!;

    [TestInitialize]
    public async Task OpenBrowserContext()
    {
        TestEnvironment.Store.Clear();
        Context = await TestEnvironment.Browser.NewContextAsync(new() { BaseURL = TestEnvironment.BaseUrl });
        await Context.Tracing.StartAsync(new() { Screenshots = true, Snapshots = true });
        Page = await Context.NewPageAsync();
    }

    [TestCleanup]
    public async Task CloseBrowserContext()
    {
        var failed = TestContext.CurrentTestOutcome != UnitTestOutcome.Passed;
        await Context.Tracing.StopAsync(failed
            ? new() { Path = Path.Combine(TestContext.TestResultsDirectory!, $"{TestContext.TestName}.zip") }
            : null);
        await Context.CloseAsync();
    }
}
```

A failing test leaves `<TestName>.zip` in the test results folder (with the
default settings, next to the test assembly). Open it with
`playwright.ps1 show-trace file.zip`: a timeline with each action, the page before
and after, the console and the network.

### Locators and web-first assertions

A locator describes how a user finds an element, and it is lazy: nothing is
searched until an action or an assertion uses it. Prefer role, label, text and test
id over CSS:

```csharp
Page.GetByRole(AriaRole.Button, new() { Name = "Add task" });
Page.GetByLabel("New task", new() { Exact = true });
Page.GetByTestId("open-count");
```

These survive a restyle and double as an accessibility check, since an element
without a role or a label is hard to find for a screen reader too. Actions
(`ClickAsync`, `FillAsync`, `CheckAsync`) wait for the element to be attached,
visible, stable and enabled before acting. Assertions use `Expect`, which retries
until it passes or times out (5 seconds by default):

```csharp
using static Microsoft.Playwright.Assertions;

await Expect(Tasks.Loading).ToBeVisibleAsync();
await Expect(Tasks.Loading).ToBeHiddenAsync();
await Expect(Tasks.OpenCount).ToHaveTextAsync("0 open");
```

The page of the lab shows "Loading tasks..." for 300 ms because the API is slow
on purpose. The test needs no sleep: each `Expect` waits for the page to arrive.
Do not read a value once and `Assert.AreEqual` it (`await locator.TextContentAsync()`):
that snapshot has no retry and is the main source of flaky E2E tests.

Auto-wait has limits, and they show up as real failures. In the lab, a test added
two tasks back to back. The page clears its input when the first POST returns, so
the title of the second task, typed too early, was erased, and the test failed with
"expected count 2, was 1". The fix is a synchronization point the user would also
have: wait for the first task to appear before typing the second. Another trap is
an assertion that passes for the wrong reason: the list is hidden until it loads,
so `ToHaveCountAsync(0)` is true before anything arrived; wait for "0 open" first.

### Page Object: the DOM in one class

When ten tests repeat `GetByRole(AriaRole.Button, new() { Name = "Add task" })`,
renaming that button breaks ten tests. A Page Object owns the locators and the
user-level actions, and tests state what a person does:

```csharp
public sealed class TasksPage(IPage page)
{
    public ILocator Items => page.GetByRole(AriaRole.List, new() { Name = "Task list" }).GetByRole(AriaRole.Listitem);
    public ILocator OpenCount => page.GetByTestId("open-count");

    public async Task OpenAsync() => await page.GotoAsync("/");

    public async Task AddAsync(string title)
    {
        await page.GetByLabel("New task", new() { Exact = true }).FillAsync(title);
        await page.GetByRole(AriaRole.Button, new() { Name = "Add task" }).ClickAsync();
    }
}
```

```csharp
await Tasks.OpenAsync();
await Tasks.AddAsync("Write the report");
await Expect(Tasks.Items).ToHaveCountAsync(1);
```

Keep assertions in the test, not in the Page Object: the object exposes locators
and actions, and the test decides what to check. The suite in the lab has six
tests and runs in about 6 seconds.

## Trade-offs

- **E2E is the slowest and least precise layer.** A failure says "something in this flow
  broke", not which line. Keep E2E for a few critical flows; test rules in unit tests, the
  HTTP contract with `WebApplicationFactory` and components with bUnit.
- **bUnit vs Playwright.** bUnit renders a component in milliseconds with no browser
  and cannot see CSS, real navigation or JavaScript interop. Playwright sees all of
  it and costs a browser. Use both for Blazor.
- **A shared host and browser are fast and need discipline.** Resetting server state per
  test and using one context per test gives isolation. Running the E2E tests in parallel
  needs per-test data (unique titles) because the store is shared.
- **Selectors tie tests to markup.** Role and label locators tie them to what a user
  perceives, which changes less, but a button renamed in the UI still breaks them. The
  Page Object keeps that to one file.
- **Browsers are a dependency.** The install step, the cache and the version pinned
  by the package (1.64.1 matches a specific Chromium build) must be handled on every
  developer machine and CI. The package and the browser move together.
- **`Microsoft.Playwright.MSTest` is built for the old MSTest assembly identity.** With MSTest 3.11.1,
  `PageTest` works (verified). On MSTest 4, use the core package and your own base class, and check
  the release notes of the Playwright package before dropping the base class.
- **Selenium still exists.** Playwright's auto-wait, tracing and per-test contexts are
  the reasons teams move to it from Selenium; see the Selenium concept for the older model.

## Lab

The tasks app is already implemented: a minimal API and one static page that lists, adds, completes and deletes tasks, with a list that answers after 300 ms. Your job is to write the Playwright tests that drive it in headless Chromium.

**What you will practice**

- A Page Object with role, label and test id locators.
- Web-first assertions that wait, with no sleep.
- A real Kestrel host from `WebApplicationFactory.UseKestrel(0)` and a trace saved on failure.
- Finding the typing race and the assertion that passes for the wrong reason.

**Prerequisites:** the WebApplicationFactory concept, the MSTest lifecycle, .NET 10 SDK, and Chromium installed once (see the README).

**How it works:** the host, the browser and the base class are given. `TasksPage` and the six tests are for you; each fails with `TODO-NN: write this test` until you write it. The README explains why the lab uses `Microsoft.Playwright` and not `Microsoft.Playwright.MSTest`.

## Documentation Links

- [Playwright for .NET: Getting started](https://playwright.dev/dotnet/docs/intro) (doc)
- [Playwright for .NET: Test runners](https://playwright.dev/dotnet/docs/test-runners) (doc)
- [Playwright: Locators](https://playwright.dev/dotnet/docs/locators) (doc)
- [Playwright: Auto-waiting](https://playwright.dev/dotnet/docs/actionability) (doc)
- [Playwright: Trace viewer](https://playwright.dev/dotnet/docs/trace-viewer) (doc)
- [Playwright: Page object models](https://playwright.dev/dotnet/docs/pom) (doc)
- [WebApplicationFactory<TEntryPoint>.UseKestrel method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.mvc.testing.webapplicationfactory-1.usekestrel) (doc)
- [MSTEST0082 analyzer, Microsoft Learn](https://learn.microsoft.com/dotnet/core/testing/mstest-analyzers/mstest0082) (doc)
