---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

An OpenAPI document is the machine-readable contract of an HTTP API: paths,
parameters, request and response bodies, status codes, schemas. Clients,
documentation UIs, contract tests and code generators all read it. Since .NET 9
ASP.NET Core generates this document itself with the
`Microsoft.AspNetCore.OpenApi` package, and since .NET 10 it targets OpenAPI 3.1
by default, reads XML documentation comments, and lets response attributes carry
a description. The goal is to know what the generator produces from your code,
which parts of that output you control and how (attributes, XML comments,
transformers), and what changes between 3.0 and 3.1, using real output instead
of assumptions.

## Use Cases

- Publishing `/openapi/v1.json` from a minimal API so a front end team can
  generate a typed client instead of reading your source.
- Splitting one application into a public and an admin document, each with only
  its own endpoints.
- Committing the generated document to source control at build time, to diff
  contract changes in a pull request or feed a contract test.
- Adding information the framework cannot infer (API title, a deprecation flag,
  an extension field) without touching every endpoint.

## Deep Dive

### The minimum setup

Two calls: register the services, map the endpoint. Everything below was run
against `Microsoft.AspNetCore.OpenApi` 10.0.12 on the 10.0.100 SDK.

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddOpenApi();          // document name "v1" by default
var app = builder.Build();

app.MapOpenApi();                       // GET /openapi/{documentName}.json
app.MapOpenApi("/openapi/{documentName}.yaml"); // optional: YAML at another route
```

`curl localhost:5300/openapi/v1.json` returns a document that starts with:

```json
{ "openapi": "3.1.1", "info": { "title": "api | v1", "version": "1.0.0" }, ... }
```

The title comes from the assembly name and the document name. The YAML route
serves the same content with `openapi: '3.1.1'` as the first line. Note that
`MapOpenApi` has no environment check of its own: in a process with no
`ASPNETCORE_ENVIRONMENT` (so, Production) the endpoint answered `200`. The
templates wrap it in `if (app.Environment.IsDevelopment())`, and that guard is
your decision, not the framework's.

### What the generator reads from your code

The document is built from endpoint metadata, so the more your handlers say, the
less you annotate. With a handler that returns `Results<Ok<GameDto>, NotFound>`,
the generator emitted both responses without a single attribute:

```csharp
public static Results<Ok<GameDto>, NotFound> GetGame(int id) => ...;
```

```json
"responses": {
  "200": { "description": "OK", "content": { "application/json": { "schema": { "$ref": "#/components/schemas/GameDto" } } } },
  "404": { "description": "Not Found" }
}
```

A handler that returns `IResult` hides all of this, which is the practical case
for `TypedResults` in the previous concepts. For things the types cannot say,
use `WithSummary`, `WithDescription`, `WithTags`, `WithName` (it becomes the
`operationId`) and `Produces<T>`/`ProducesProblem`. In .NET 10
`[ProducesResponseType]`, `[Produces]` and `[ProducesDefaultResponseType]` also
accept a `Description`, which replaces the generic "OK":

```csharp
[ProducesResponseType<string>(StatusCodes.Status200OK, Description = "A plain text greeting.")]
```

```json
"200": { "description": "A plain text greeting.", "content": { "text/plain": ... } }
```

The release notes present this for controllers; it also worked on a minimal API
handler in this run.

### XML comments become documentation

With `<GenerateDocumentationFile>true</GenerateDocumentationFile>` in the project
file, the package uses a source generator at build time to pick up XML comments
and feed them into the document. The mapping, observed in the output:

```csharp
/// <summary>Gets a game by id.</summary>
/// <remarks>Returns 404 when the id is unknown.</remarks>
/// <param name="id">The game identifier.</param>
public static Results<Ok<GameDto>, NotFound> GetGame(int id) => ...;

/// <summary>A game in the catalog.</summary>
/// <param name="Price">Price in euros.</param>
public record GameDto(int Id, string Name, decimal Price);
```

```json
"summary": "Gets a game by id.",
"description": "Returns 404 when the id is unknown.",
"parameters": [ { "name": "id", "in": "path", "description": "The game identifier.", ... } ]
...
"GameDto": { "description": "A game in the catalog.", "properties": { "price": { "description": "Price in euros.", ... } } }
```

`<summary>` becomes the operation summary, `<remarks>` its description, `<param>`
the parameter description, and the type and member comments become schema
descriptions (for a positional record the `<param>` tags document the
properties). The catch the docs state: the compiler does not keep XML comments
placed on lambdas, so an inline `MapGet("/x", () => ...)` gets nothing. Move the
handler to a named method and reference it, as `GamesApi.GetGame` above. A
lambda still gets `WithSummary` and `WithDescription`.

### Schemas: what is copied and what is not

Data annotations on DTOs flow into the schema, with one trap for records. In a
positional record an attribute written on the parameter targets the constructor
parameter, not the property, and the generator reads properties. The first run
with `[Required, StringLength(50)] string Name` produced a schema with no
`maxLength`. Writing `[property: StringLength(50)]` fixed it:

```csharp
public record CreateGameDto(
    [property: Required, StringLength(50)] string Name,
    [property: Range(0, 1000)] decimal Price,
    string? Genre);
```

```json
"name":  { "maxLength": 50, "minLength": 0, "type": "string" },
"price": { "maximum": 1000, "minimum": 0, "type": ["number", "string"], "pattern": "^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?$", "format": "double" },
"genre": { "type": ["null", "string"] }
```

Two details worth reading closely. Numbers are `["number", "string"]` with a
`pattern` because ASP.NET Core's JSON defaults accept numbers written as strings,
and the schema describes what the server accepts, not only what it emits.
`genre` appears under `required` as well, even though it is nullable: for a
positional record the constructor parameter has no default, so "required" and
"nullable" are separate facts.

### 3.0 versus 3.1

OpenAPI 3.1 aligns with JSON Schema draft 2020-12, and that shows in the
nullable and union cases. The same `genre` and `price` under
`options.OpenApiVersion = OpenApiSpecVersion.OpenApi3_0`:

```json
"genre": { "type": "string", "nullable": true },
"price": { "anyOf": [ { "type": "number" }, { "type": "string" } ], ... }
```

The document header became `3.0.4`. Keep 3.0 only when a consumer in your chain cannot read
3.1. The
upgrade is also visible in transformer code: the generator moved to
`Microsoft.OpenApi` 2.x, where `OpenApiAny` is gone and extension values are
`JsonNode`. The docs say these changes apply even when you stay on 3.0. As a
note for later, the same page says .NET 11 changes the default to 3.2, so pin
`OpenApiVersion` if a consumer depends on one.

### Transformers

When attributes are not enough, a transformer edits the document. There are
three kinds, each with a delegate form, an instance form and a DI-activated
class form:

```csharp
builder.Services.AddOpenApi(options =>
{
    options.AddDocumentTransformer((document, context, ct) =>
    {
        document.Info.Title = "Game Store API";
        return Task.CompletedTask;
    });
    options.AddOperationTransformer((operation, context, ct) => { /* per operation */ return Task.CompletedTask; });
    options.AddSchemaTransformer((schema, context, ct) =>
    {
        if (context.JsonTypeInfo.Type == typeof(decimal))
            schema.Description = "Money, two decimal places.";   // every decimal in the document
        return Task.CompletedTask;
    });
});
```

Per the docs, schema transformers run first (as each schema is registered),
operation transformers next, and document transformers last, each group in the
order you added them, once per document. For a change to one endpoint,
`AddOpenApiOperationTransformer` attaches the transformer to that endpoint only:

```csharp
games.MapGet("/ping", () => "pong")
     .AddOpenApiOperationTransformer((op, ctx, ct) => { op.Deprecated = true; return Task.CompletedTask; });
// output: "deprecated": true
```

The usual real uses are the API title and servers, a security scheme (such as
`Bearer`) registered once with a requirement per operation, and a shared error
response. In .NET 10 the transformer context offers `GetOrCreateSchemaAsync` to
build a schema for a C# type and add it to the document's components.

### Several documents and build-time generation

`AddOpenApi("admin")` registers a second document, served at
`/openapi/admin.json`. Which endpoint lands in which document is decided by
`ShouldInclude`, whose default compares the endpoint's group name with the
document name. An endpoint with `.WithGroupName("admin")` appeared only in the
`admin` document; the endpoints with no group name appeared in both:

```text
v1:    /games/{id}  /games  /games/ping  /games/legacy
admin: /admin/games/{id}  /games/{id}  /games  /games/ping  /games/legacy
```

To write the files during `dotnet build`, add
`Microsoft.Extensions.ApiDescription.Server` (10.0.12 restored here) and, if you
like, choose the folder:

```xml
<PackageReference Include="Microsoft.Extensions.ApiDescription.Server" Version="10.0.12">
  <PrivateAssets>all</PrivateAssets>
</PackageReference>
<PropertyGroup>
  <OpenApiDocumentsDirectory>$(MSBuildProjectDirectory)/spec</OpenApiDocumentsDirectory>
</PropertyGroup>
```

The build log said `Writing document named 'admin' to .../spec/bt_admin.json`
and produced `bt.json` for `v1`: the project name, plus `_<document>` when the
name is not `v1`. The generator starts your app's entry point with a mock
server, so startup code that needs a database or a secret runs too. Guard it
(the docs check `Assembly.GetEntryAssembly()?.GetName().Name != "GetDocument.Insider"`).

## Trade-offs

- **The document describes what the code declares, not what it does.** A handler
  that returns `IResult` is documented as a bare `200`: no body schema and no
  `404`, even though the code can return one.
  ```csharp
  app.MapGet("/g/{id}", (int id) => id == 1 ? Results.Ok(new GameDto(1, "Zelda", 1m)) : Results.NotFound());
  // generated: "responses": { "200": { "description": "OK" } }
  ```
- **XML comments cost a build setting and a method per endpoint.** Lambdas stay
  undocumented, so the style pushes you to named handlers. That is usually a
  good structure anyway, but it is a constraint.
- **3.1 is the better spec, and a default can move under you.** A tool in your
  chain may only understand 3.0, and the docs say the default changes again in
  .NET 11. Set `OpenApiVersion` explicitly once a consumer cares.
  ```csharp
  options.OpenApiVersion = OpenApiSpecVersion.OpenApi3_0; // pin to what your consumers parse
  ```
- **Transformers are powerful and tied to a library version.** The move to
  `Microsoft.OpenApi` 2.x broke transformer code written for .NET 9. Keep them
  small and covered by a test that diffs the generated document.
- **The schema mirrors the serializer, not your intent.** Number-from-string
  handling, record constructor rules and `required` follow `System.Text.Json`
  behavior. If a client generator produces `string | number` where you wanted
  `number`, fix the JSON options or add a schema transformer, not the client.
- **Build-time generation runs your startup code.** Without a guard, it can need
  a connection string at build time on a machine that has none.
- **Running the document is not running the contract.** The generator only
  documents. Nothing checks the live API against the file, so add a contract
  test or diff the committed document in CI.

## Lab

In this lab you get a games API with the endpoints already written, but no OpenAPI document served. Your job is to register the `Microsoft.AspNetCore.OpenApi` generator, serve `/openapi/v1.json` and then shape what it contains with endpoint metadata, transformers, exclusion and more than one named document. The core idea is to feel that the OpenAPI document is derived from the code, and that you control its content through metadata and transformers instead of writing the JSON by hand.

**The scenario**

The tests start the API in the `Development` environment, parse the served JSON with `System.Text.Json.Nodes` and check paths and properties, not the whole text (the generator output changes between versions).

- `Program.cs`: everything happens here. A `/games` group with `GET /{id}` (200 with `GameDto` or 404), `GET /` and `GET /legacy`, plus `GET /internal/health` and `GET /admin/stats` outside the group.
- `GameDto.cs`: the `GameDto(Id, Name, Price)` record used in the responses.

**What you will do, step by step**

1. **Serve the document (TODO-00).** Call `AddOpenApi` (document "v1") and `MapOpenApi`, so `/openapi/v1.json` answers. The options lambda is where TODO-02 and TODO-06 go.
2. **Describe an endpoint (TODO-01).** On `GET /games/{id}`, use endpoint metadata to give the summary "Gets a game by id", the operation name (operationId) "GetGame", the tag "Games" and typed responses: 200 with `GameDto` and 404.
3. **Customize the document (TODO-02).** Add a document transformer with title "Game Store API", version "2.0.0" and one server with url "https://api.example.com".
4. **Mark a single endpoint as deprecated (TODO-03).** On `GET /games/legacy`, use an operation transformer attached to the endpoint itself, so only it becomes `deprecated`.
5. **Hide without removing (TODO-04).** Keep `/internal/health` out of the document while the endpoint keeps working.
6. **Create a second document (TODO-05).** Register a document named "admin" and make `/admin/stats` appear only there. Remember that endpoints without a group name appear in every document.

**How you know you are done**

`dotnet test` is all green. You should be able to open `/openapi/v1.json` and `/openapi/admin.json` and explain where each piece of the JSON comes from, and why `/games` shows up in both documents while `/admin/stats` shows up in only one.

**Optional challenges**

- **TODO-06:** add a schema transformer that sets the description of every `decimal` to `Money in euros`. This enables the last test (the one with the `_Bonus` suffix).
- **TODO-07:** set `options.OpenApiVersion` to `OpenApiSpecVersion.OpenApi3_0` and compare how `price` and nullable properties are written in 3.0 and 3.1.

**Prerequisites:** Minimal APIs and route groups, endpoint metadata (the parameter binding lab) and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. All the work is in `src/OpenApiLab/Program.cs`, where each TODO is marked in a comment next to the endpoint it affects; at first the tests fail because no document is served.

## Documentation Links

- [Generate OpenAPI documents, ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/aspnetcore-openapi) (doc)
- [Customize OpenAPI documents, transformers, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/customize-openapi) (doc)
- [What's new in ASP.NET Core 10, OpenAPI, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0#openapi) (doc)
- [Use the generated OpenAPI documents, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/openapi/using-openapi-documents) (doc)
- [OpenAPI Specification v3.1.1](https://spec.openapis.org/oas/v3.1.1.html) (doc)
