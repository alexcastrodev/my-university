---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Before .NET 8 you picked a Blazor hosting model for the whole app: Blazor Server
or Blazor WebAssembly. A Blazor Web App in .NET 8 and later drops that choice
and asks a smaller, per-component question instead: where does this component
render, and is it interactive? The answer is its render mode. Getting it wrong
produces symptoms that look unrelated: a button that does nothing, data that
loads twice, a flicker on first paint, a service that "cannot be resolved" only
on the first request, or a server that holds state for every open tab. This
concept shows what the server actually sends for each mode, so you can reason
from the output instead of from the names.

## Use Cases

- Deciding between a content page that needs no interactivity (static SSR) and
  a dashboard that reacts to every click (Interactive Server).
- Seeing why a component's `OnInitialized` ran twice and how to stop the second
  run from replacing prerendered data.
- Choosing WebAssembly or Auto for a public site where holding a server circuit
  per visitor is too expensive.
- Reading the HTML comments Blazor emits to debug why a component is not
  interactive.

## Deep Dive

### Four modes, one default

A component has no render mode unless you give it one, and then it is rendered
once, on the server, to HTML. That is static server-side rendering (static SSR).
The other three modes are chosen with the `@rendermode` directive:

| Mode | Where it runs | What the browser keeps |
|---|---|---|
| Static (default) | Server, once per request | Nothing, the page is plain HTML |
| `InteractiveServer` | Server, over a SignalR connection | A circuit on the server |
| `InteractiveWebAssembly` | Browser, on the .NET WebAssembly runtime | The runtime and your assemblies |
| `InteractiveAuto` | Server first, then the browser | A circuit, then a cached download |

Everything below comes from one project created with
`dotnet new blazor -int Auto` (SDK 10.0.100), which gives a server project and a
`.Client` project, plus five probe pages. Each page renders the same component,
which records where and in which renderer `OnInitialized` ran:

```razor
@code {
    protected override void OnInitialized() =>
        Console.WriteLine($"{(OperatingSystem.IsBrowser() ? "BROWSER" : "SERVER")}, " +
                          $"renderer={RendererInfo.Name}, interactive={RendererInfo.IsInteractive}");
}
```

A component that must run in the browser has to live in the `.Client` project,
because that is the assembly the WebAssembly runtime downloads.

### What the server sends

`curl` on the static page returns the finished markup, and the button has no
event wiring:

```text
$ curl -s localhost:5320/m-static
... <section data-probe="m-static"><p id="init">OnInitialized ran on SERVER, renderer=Static, interactive=False</p>
    <button>clicks: 0</button></section> ...
```

For an interactive mode, the same markup arrives wrapped in a pair of comments.
The first one describes how to start the component, the second closes the
region that will be replaced:

```text
<!--Blazor:{"type":"server","prerenderId":"884d...","sequence":0,"descriptor":"CfDJ8..."}-->
  <h1>m-server</h1> ... <button>clicks: 0</button>
<!--Blazor:{"prerenderId":"884d..."}-->
```

The marker for `InteractiveWebAssembly` has `"type":"webassembly"` and carries
the `assembly` and `typeName` to load (`auto.Client`,
`auto.Client.Pages.MWasm`). `InteractiveAuto` has `"type":"auto"` and carries
both a server descriptor and the assembly and type name, because the client
decides later. With prerendering turned off
(`@rendermode @(new InteractiveServerRenderMode(prerender: false))`), only the
opening marker is sent and the region is empty: the user sees nothing until the
circuit is up.

### Prerendering runs your component twice

Interactive modes prerender by default, so the first response already has
content. Watching the server log for the Interactive Server page shows both
renders:

```text
[m-server] OnInitialized ran on SERVER, renderer=Static, interactive=False
[m-server] OnInitialized ran on SERVER, renderer=Server, interactive=True
[m-server] OnAfterRender(first) on SERVER
```

The first line is the prerender, with `RendererInfo.IsInteractive` false. The
second is the new component instance created when the circuit starts. Note that
`OnAfterRender` fired only once, after interactivity: it never runs during
prerendering. For the WebAssembly page the story is the same except that the
second `OnInitialized` prints to the browser console, with `BROWSER` and
`renderer=WebAssembly`. With `prerender: false` the log shows only the
interactive line.

The second instance starts from scratch, so anything generated in
`OnInitialized` changes under the user's eyes. A component that draws a random
number and also marks a property with `[PersistentState]` (confirmed in the
ASP.NET Core 10 release notes) shows the difference. Reading the DOM at
`DOMContentLoaded` and again two seconds later:

```text
first paint : plain: 7185   persisted: 9050
interactive : plain: 7403   persisted: 9050
```

`[PersistentState]` serializes the value during prerendering and restores it in
the interactive instance, so the expensive query or the random id is not redone.
The details of that attribute belong to the data-access side of Blazor.

### What the browser does in each mode

Using a real browser against the same app:

- `InteractiveServer`: the page loads `blazor.web.js`, which posts to
  `/_blazor/negotiate` and opens the SignalR connection. A click sends the event
  to the server and the server sends back a diff. The click counter went from 0
  to 1 through the circuit.
- `InteractiveWebAssembly`: no `/_blazor` request at all. The browser downloads
  the runtime and assemblies and runs the component locally.
- `InteractiveAuto`: on a fresh browser profile the first visit opened a circuit
  (the log shows `renderer=Server`) while the WebAssembly assets downloaded in
  the background. After a reload in the same profile the component ran with
  `renderer=WebAssembly` and no circuit. The documentation adds that Auto never
  moves a component already on the page from one mode to the other, and that it
  prefers a mode that matches interactive components already present.

### Where to put `@rendermode`

The directive can go on a component definition (the page file), on a component
instance (`<Counter @rendermode="InteractiveServer" />`), or on `<Routes>` in
`App.razor` to make the whole app interactive. Render modes propagate down the
tree, so a child inherits its parent's mode, and a prerender setting on a child
is ignored when a parent already chose a mode. A child cannot opt out of an interactive
parent, but a static page can contain interactive components, which is the cheap
way to keep most of a site as plain HTML.

Prerendering a component that lives in `.Client` runs it on the server too, so a
service registered only in the browser project fails to resolve on the first
request. Register it on the server as well, make it optional, or turn
prerendering off for that component.

### What each choice costs

Latency: with Interactive Server every event goes to the server and back, so the
documentation lists higher latency and no offline support. It also states that
each browser screen needs its own circuit and its own component state, and that
a circuit ends when no interactive server component remains on the page.

Download size: a Release publish of the default Auto template on SDK 10.0.100
produced, for the files a client needs (the 32 assemblies, `dotnet.native.wasm`,
the runtime scripts, `blazor.web.js` and one ICU data file), 6.7 MiB uncompressed
and 2.1 MiB with the pre-compressed Brotli copies the publish generates. A static
or Interactive Server page needs only the Blazor script itself, `blazor.web.js`,
47.5 KB with Brotli in the same publish. These are numbers for an empty app: your assemblies add to them.
Memory per circuit depends entirely on what your components hold, so measure it
for your app, the documentation gives no fixed figure.

## Trade-offs

- **Static SSR is the cheapest and the least interactive.** No circuit, no
  download, great for SEO, but buttons do nothing until you add a form post or an
  interactive island.
  ```razor
  <button @onclick="Save">Save</button> @* inert on a static page *@
  ```
- **Interactive Server keeps state on the server for each open screen.** Simple
  to write and gives direct access to the database, but capacity is bounded by
  circuits, and the documentation warns that user state is often lost when a dropped
  connection is re-established, unless you save it.
- **WebAssembly moves work to the client at the cost of the first download.**
  Offline-capable and cheap to host, but the code is visible to users and the
  component cannot reach server resources except through an API.
- **Auto hides the download cost on the first visit and doubles the surface.**
  Components must run correctly on both the server and the browser, so any
  server-only dependency in a `.Client` component is a bug waiting for the
  second visit.
- **Prerendering buys a fast first paint and charges a double run.** Side
  effects in `OnInitialized` (an insert, a counter) happen twice unless you
  guard them.
  ```csharp
  protected override async Task OnInitializedAsync() =>
      items ??= await Service.LoadAsync(); // with [PersistentState] the second run reuses the first
  ```
- **A global `@rendermode` on `<Routes>` is convenient and makes everything
  interactive.** You pay for a circuit or a download on pages that never needed
  one; per-page modes keep the static pages static.

## Documentation Links

- [ASP.NET Core Blazor render modes, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/render-modes) (doc)
- [ASP.NET Core Blazor hosting models, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/hosting-models) (doc)
- [Prerender ASP.NET Core Razor components, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/prerender) (doc)
- [Blazor prerendered state persistence, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/state-management/prerendered-state-persistence) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
