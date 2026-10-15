---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

An OpenAPI document is only useful when something consumes it. This concept covers the three consumers you meet first: a browsable reference UI (Scalar), a plain text file of requests you can replay and commit (`.http` files), and a generated typed client (Kiota). The thread running through all three is that the document is the contract, so a vague document gives you a vague UI and a vague client. Everything here was run on the 10.0.100 SDK against a small minimal API with `Microsoft.AspNetCore.OpenApi` 10.0.0, `Scalar.AspNetCore` 2.18.0 and the Kiota tool 1.36.1.

## Use Cases

- Giving a front-end or partner team a page where they can read and try the API without installing anything.
- Keeping a set of example requests in the repository, per environment, that every developer can replay.
- Generating a strongly typed client for a service you own, so that callers stop hand-writing URLs and DTOs.
- Spotting under-documented endpoints, because the generated client exposes them as untyped streams.

## Deep Dive

### Scalar as the reference UI

`Microsoft.AspNetCore.OpenApi` produces the document but ships no viewer. The docs show Swagger UI and Scalar as two options, and the Scalar setup is two lines next to `MapOpenApi`:

```csharp
builder.Services.AddOpenApi();
var app = builder.Build();
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();            // /openapi/v1.json
    app.MapScalarApiReference(); // /scalar
}
```

What the running app did:

```text
GET /scalar            -> 302, Location: scalar/
GET /scalar/           -> 200 text/html
GET /scalar/scalar.js  -> 200, 4571209 bytes
```

The page's inline script initializes Scalar with a source of `{"title":"v1","url":"openapi/v1.json"}`, so with one document it finds the document by itself. The bundle is served by your own app (a relative `scalar.js`), not from a CDN, which matters for networks without internet access. The docs are explicit about where this belongs: OpenAPI user interfaces (Swagger UI, ReDoc, Scalar) should only be enabled in development, to limit information disclosure. The `IsDevelopment()` guard above is that advice, and it covers `MapOpenApi` too if the document should not be public.

### .http files: requests as text

An `.http` file is a list of requests in a plain text file. Visual Studio 2022 (17.8 or later per the docs) edits and sends them; the docs say the format was inspired by the VS Code REST Client extension and that the Visual Studio editor lacks some of that extension's features (request history, cURL import, prompt variables and others), so check the editor you actually use. The syntax from the docs, applied to the test API:

```http
@host = http://localhost:5400

### list
GET {{host}}/games
Accept: application/json

### create
POST {{host}}/games
Content-Type: application/json

{ "name": "Shogi", "players": 2 }

### missing game
GET {{host}}/games/99
```

The rules worth remembering, all from the docs: `###` separates requests; a line starting with `@` defines a variable used as `{{name}}`; headers go directly under the request line with no blank line between them; the body starts after a blank line; `#` and `//` start comments.

Environments come from a file named `http-client.env.json`, found in the `.http` file's folder or a parent:

```json
{
  "$shared": { "HostAddress": "http://localhost:5400" },
  "dev":     { "token": "dev-only" },
  "staging": { "HostAddress": "https://staging.example.com" }
}
```

`$shared` supplies defaults, and an environment overrides it (`staging` replaces `HostAddress`). A variable defined inside the `.http` file wins over the environment file. Secrets do not belong in the checked-in file: the docs put user-specific values in `http-client.env.json.user` and also support ASP.NET Core user secrets, Azure Key Vault and DPAPI providers. A request can be named with `# @name login` and its response used later, for example `{{login.response.body.$.token}}`, but only after you have sent the named request once.

I replayed the three requests above with `curl` against the running API to check what the file describes, since I could not run the Visual Studio editor here:

```text
POST /games     -> 201 Created, Location: /games/4
GET /games/99   -> 404, Content-Type: application/problem+json
```

### Generating a client with Kiota

Kiota is a command line tool that generates a client from an OpenAPI description. C# is one of its languages, along with Go, Java, PHP, Python, Ruby and TypeScript. Installed as a tool (in a scratch folder here, not globally):

```text
dotnet tool install Microsoft.OpenApi.Kiota --tool-path ./tools
./tools/kiota generate -l CSharp -d v1.json -o Client -c GamesClient -n Games.Client
```

For three operations it wrote five files (431 lines in the first run): `GamesClient`, two request builders and two models. The generated code needs runtime packages; `kiota info -l CSharp` listed `Microsoft.Kiota.Bundle` at 2.1.2, which pulls in abstractions, serialization and the HTTP adapter. The consumer is then:

```csharp
var adapter = new HttpClientRequestAdapter(new AnonymousAuthenticationProvider())
    { BaseUrl = "http://localhost:5400" };
var client = new GamesClient(adapter);

var all = await client.Games.GetAsync();           // List<Game>
var one = await client.Games[2].GetAsync();        // Game
var created = await client.Games.PostAsync(new NewGame { Name = "Hex", Players = 2 });
```

```text
list: 1:Chess, 2:Go
one: Go players=2
created: 3 Hex
```

The URL structure becomes a fluent path (`Games[2]`), so the endpoint tree is discoverable by autocomplete.

### The client is only as good as the document

My first version of `GET /games/{id}` returned `Results.Ok(game)` or `Results.NotFound()`. The document then declared only `200 OK` with no content, and Kiota generated `GetAsync` returning a raw `Stream`. Adding two lines of metadata changed the document and the client:

```csharp
.Produces<Game>()
.ProducesProblem(404);
```

The 200 now referenced the `Game` schema and the 404 referenced `ProblemDetails` as `application/problem+json`. After regeneration `GetAsync` returned `Game`, and Kiota put a `404` entry in the error mapping. Calling a missing id:

```text
404 -> ProblemDetails status=404
```

The generated `ProblemDetails` class is an `ApiException`, so the problem body from the earlier ProblemDetails concept arrives as a typed exception. One more observation: the schema listed `id`, `name` and `players` as `required`, yet the generated model exposes `int? Id`, `string? Name`. Treat generated properties as nullable and validate what you depend on.

### Other generators

The docs for NSwag state that from .NET 9 on, ASP.NET Core has built-in OpenAPI support and NSwag is not included, but can be added as a community package; it offers client generation through NSwagStudio, the `NSwag.CodeGeneration.CSharp` package, a command line and an MSBuild package. I did not run NSwag or Refit here, so I make no claim about their output. The practical point carries over: any generator reads the same document, so fix gaps in the document, not in the generated files.

## Trade-offs

- **A UI in production is attack surface.** It lists every route and parameter. Keep it behind `IsDevelopment()` or behind authentication.
  ```csharp
  if (app.Environment.IsDevelopment()) { app.MapScalarApiReference(); }
  ```
- **`.http` files are portable text but editor-specific.** The syntax is shared between editors only in part, and variables, environments and secrets providers differ. Do not commit tokens; use the `.user` file or a secrets provider.
- **Generated clients drift.** Regenerate in CI from the committed document, or the client and the server will disagree silently. Do not edit generated files by hand.
- **Generation amplifies a thin contract.** Untyped `Results.Ok(...)` produced a `Stream`. Declare `Produces<T>` and `ProducesProblem`, or use `TypedResults`, so the document says what the endpoint returns.
- **A generated client is another dependency.** Kiota needs its runtime packages and adds many files. For two calls to a third-party API, a typed `HttpClient` from the earlier HttpClient concept may be less code.

## Documentation Links

- [Use the generated OpenAPI documents, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/using-openapi-documents) (doc)
- [Use .http files in Visual Studio 2022, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/test/http-files) (doc)
- [Welcome to Kiota, Microsoft Learn](https://learn.microsoft.com/en-us/openapi/kiota/overview) (doc)
- [Install Kiota, Microsoft Learn](https://learn.microsoft.com/en-us/openapi/kiota/install) (doc)
- [Tutorial: Create a Minimal API with ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/tutorials/min-web-api) (doc)
- [Get started with NSwag and ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/tutorials/getting-started-with-nswag) (doc)
