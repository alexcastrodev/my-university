---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A `.razor` file looks like a template, but the build treats it as source code:
the Razor compiler turns it into a C# class before the C# compiler ever runs.
Knowing what that class looks like explains most of the "why" questions in
Blazor: why `@code` members behave like ordinary class members, why a component
cannot be a lowercase tag, why a stray `@` breaks the build, and why `@rendermode`
and `@typeparam` sometimes collide. This concept turns on
`EmitCompilerGeneratedFiles` in a Blazor Web App on SDK 10.0.100, reads the
generated code for a small page, and then probes the edges of the syntax by
rendering it. It also separates the three things people call "Razor": the
syntax, Razor Pages and MVC views (`.cshtml`), and Blazor components (`.razor`).
The routing, lifecycle and render mode behavior of components are covered in the
other Blazor concepts; this one stays on how the file becomes code.

## Use Cases

- Debugging a compile error that points at generated code instead of your file.
- Understanding what a directive such as `@inject`, `@inherits` or `@typeparam`
  does to the class.
- Deciding between markup in the `.razor` file and a code-behind partial class.
- Explaining to a team the difference between a Razor Page and a Razor component.

## Deep Dive

### Look at the generated class

By default the generated files stay inside the compiler. Setting
`<EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>` in the project
writes them to disk; the Razor SDK documentation lists it as a property and says
`UseRazorSourceGenerator` defaults to `true`, so compilation uses source
generation and the result lands in the app's own assembly. After a build the
files were under
`obj/Debug/net10.0/generated/Microsoft.CodeAnalysis.Razor.Compiler/.../`, one
`*_razor.g.cs` per component (`Components_Pages_Probe_razor.g.cs`). For this page:

```razor
@page "/probe/{Id:int}"
@attribute [StreamRendering]
@implements IDisposable
@inject ILogger<Probe> Log

<h1>Order @Id</h1>
<button @onclick="Add">Add</button>

@code {
    [Parameter] public int Id { get; set; }
    List<string> Items = ["a", "b"];
    void Add() => Items.Add("c");
    public void Dispose() => Log.LogInformation("disposed");
}
```

the generated class, with the `#line` directives removed, was:

```csharp
[StreamRendering]
[RouteAttribute("/probe/{Id:int}")]
public partial class Probe : ComponentBase, IDisposable
{
    protected override void BuildRenderTree(RenderTreeBuilder __builder) { /* ... */ }

    [Parameter] public int Id { get; set; }          // the @code block, pasted
    List<string> Items = ["a", "b"];
    void Add() => Items.Add("c");
    public void Dispose() => Log.LogInformation("disposed");

    [InjectAttribute] private ILogger<Probe> Log { get; set; } = default!;
}
```

Each directive has a literal translation. `@page` became a `[Route]` attribute
(so a routable component is just a class with an attribute), `@attribute` copied
its argument onto the class, `@implements` added an interface, `@inject` became a
property with `[Inject]` initialized with `default!`, and `@code` was pasted into
the class body unchanged. The class name is the file name, and the namespace
came from the root namespace plus the folder (`app.Components.Pages`), unless
`@namespace` overrides it; the components documentation gives that priority
order. A class that is `partial` can be completed by another file: a
`Cb.razor.cs` with `public partial class Cb { string Build() => "..."; }` was
called from the markup of `Cb.razor` and rendered `from code-behind`. The
documentation notes that `@using` lines in `_Imports.razor` apply only to
`.razor` files, so the `.cs` half needs its own `using`.

### What `BuildRenderTree` does with the markup

The markup becomes calls on a `RenderTreeBuilder`, each tagged with a sequence
number that is just a position in the source. The relevant lines for the page
above and a few more constructs (`@key`, `@bind`, a child component):

```csharp
__builder.OpenElement(0, "h1");
__builder.AddContent(1, "Order ");
__builder.AddContent(2, Id);
__builder.CloseElement();
// ...
foreach (var item in Items) {
    __builder.OpenElement(10, "li");
    __builder.SetKey(item);
    __builder.AddContent(11, item.ToUpper());
    __builder.CloseElement();
}
// ...
__builder.AddAttribute(19, "value", BindConverter.FormatValue(Name));
__builder.AddAttribute(20, "onchange", EventCallback.Factory.CreateBinder(this, __value => Name = __value, Name));
__builder.SetUpdatesAttributeName("value");
// ...
__builder.OpenComponent<Badge>(22);
__builder.AddComponentParameter(23, nameof(Badge.Text), TypeCheck<string>(Name));
__builder.AddAttribute(24, "ChildContent", (RenderFragment)((__builder2) => {
    __builder2.AddMarkupContent(25, "<strong>inside</strong>");
}));
__builder.CloseComponent();
```

Four things are visible. The C# control flow (`@if`, `@foreach`) is copied
verbatim around the builder calls, so Razor "loops" are real C# loops, and the
numbers inside the loop body are the same on every iteration because they
identify a place in the source, not an item. `@key` is a call (`SetKey`) and
`@bind` expands into a `value` attribute plus an `onchange` callback created by
`CreateBinder`, which is why a bound field is read and written through the same
expression. A child component is a typed `OpenComponent<Badge>`, and its
parameter name goes through `nameof`, so a typo in a parameter is a compile
error rather than a runtime surprise. Content between component tags becomes a
`RenderFragment` lambda assigned to `ChildContent`. The documentation on
rendering explains when the framework re-runs this method; the point here is
that `BuildRenderTree` is ordinary code that runs on every render.

### What the parser does with `@`

Rendering the page showed the parser rules at work. `@Id` is an implicit
expression and `@(Quantity * Price)` an explicit one; the page printed
`Total: 3,0` because the expression result is formatted with the current culture
of this machine, which uses a decimal comma. The syntax reference says implicit
expressions cannot contain spaces (except after `await`) and cannot contain
generics, which need the explicit form. In the generated code the sentence
`(contact: help@example.com, literal at: @@home)` is a single
`AddMarkupContent` call holding `... help@example.com, literal at: @home)`: the
email address was left alone, as the reference promises, and `@@` collapsed to a
literal `@` at compile time. A Razor comment `@* ... *@` left nothing in the
output.

Output is HTML-encoded: `@(1 < 2 ? "a<b" : "c")` rendered `a&lt;b`. To emit raw
HTML you must opt in, and the generated code shows it:

```razor
@((MarkupString)"<em>raw</em>")   @* rendered <em>raw</em> as real markup *@
```

That cast is the whole opt-in, so a `MarkupString` built from user input is an
XSS hole. Whitespace is also a compile-time decision. With `@preservewhitespace`
at its default (`false`, per the reference), whitespace around code blocks and
at the edges of elements is removed; the rendered list came out as
`<ul><li>A</li><li>B</li></ul><button>Add (many)</button>` with the line breaks
from the source gone.

### Tags, names and the warning you can miss

A tag is a component only if its name matches one in scope and starts with an
uppercase letter (a documented rule). `<badge>lowercase is html</badge>` rendered
as a literal `<badge>` element, and `<Badge Text="x" />` as the component's
`<span>`. A misspelled component is not an error: `<Bdge Text="x" />` built with
warning `RZ10012` ("Found markup element with unexpected name 'Bdge'"), and the
page rendered `<Bdge Text="x"></Bdge>` as plain markup. Building with `-p:WarningsAsErrors=RZ10012` turned it into an error, which is a
good setting for CI, because otherwise the typo ships.

### Generics, base classes and the edges

`@typeparam TItem` made the generated class `Grid<TItem>`, `@inherits GridBase`
set its base class, and a call site with `Items="@(new[] { 1, 2, 3 })"` compiled
through a generated `TypeInference.CreateGrid_0` helper so `TItem` was inferred
as `int` and `Context="n"` typed the row template. An inline template such as
`RenderFragment Footer => @<p>footer @Items.Count()</p>;` became a lambda. Two
limits came up while testing, both on SDK 10.0.100:

- The same template as a field initializer (`RenderFragment Footer = @<p>@Items...</p>;`)
  failed with `CS0236`, because a field initializer cannot reference an instance
  member. This is C#, not Razor; use a property.
- Adding `@rendermode InteractiveServer` to the generic `Grid<TItem>` failed with
  `CS0305: Using the generic type 'Grid<TItem>' requires 1 type arguments`. The
  generated code attaches a nested `__PrivateComponentRenderModeAttribute` to the
  class and refers to it without the type arguments. I did not find a statement
  about this in the documentation, so check your SDK version before relying on a
  render mode on a generic component.

### Razor, Razor Pages and Blazor

Razor is the syntax. A `.cshtml` file (Razor Pages or an MVC view) compiles to a
class deriving from `RazorPage`, whose `ExecuteAsync` writes literals and values
to the response while the page runs on the server for a request. A `.razor`
file compiles to a `ComponentBase` subclass whose `BuildRenderTree` builds a
tree that the renderer diffs and applies. Some directives exist in only one of
them: the reference marks `@model`, `@section` and the Tag Helper directives
as `.cshtml` only, and `@code`, `@layout`, `@typeparam`, `@rendermode` and the
`@bind`/`@on...` attributes as `.razor` only. Both go through the same Razor SDK.

## Trade-offs

- **Markup and code in one file keep a component together, and a code-behind
  partial class keeps C# out of the markup.** The partial class sees the same
  members; it just needs its own `using`.
  ```csharp
  public partial class Cb { string Build() => "from code-behind"; } // Cb.razor.cs
  ```
- **Compile-time generation gives typed parameters and compile errors, and moves
  some mistakes into generated code.** An error may be reported at a line of a
  `.g.cs` file; `EmitCompilerGeneratedFiles` is how you read it.
- **`MarkupString` is the escape hatch and the hazard.** It bypasses encoding by
  design.
  ```razor
  @((MarkupString)userComment)   @* never with unsanitized input *@
  ```
- **Whitespace removal keeps the DOM small and surprises layouts that depend on
  gaps.** `@preservewhitespace true` at the top of the file restored the line breaks in
  the test page.
- **An unknown component is a warning, not an error.** Without
  warnings-as-errors a typo in a tag renders as an unknown element.
- **Generics and render modes interact with generated attributes.** Verify a
  `@typeparam` plus `@rendermode` component on your SDK instead of assuming it
  works.

## Documentation Links

- [Razor syntax reference for ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/mvc/views/razor) (doc)
- [ASP.NET Core Razor components, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/) (doc)
- [ASP.NET Core Razor component rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/rendering) (doc)
- [ASP.NET Core Razor SDK, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/razor-pages/sdk) (doc)
- [ASP.NET Core Razor component generic type support, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/generic-type-support) (doc)
