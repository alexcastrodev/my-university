---
version: 1.0
updatedAt: 2026-10-05
---
## Objective

A connection string typed into a C# file works on your machine and fails
everywhere else. ASP.NET Core separates *what the code needs* from *where the
value comes from*: configuration is a single key-value view assembled from
several sources, and the code reads from that view without knowing which source
supplied each value. The goal is to know the sources and their precedence, to
override a value per environment without touching code, to bind a section to a
typed class with the options pattern, and to keep secrets out of the repository.

## Use Cases

- Moving the database connection string out of the code so the same build runs
  against SQLite locally and PostgreSQL in production.
- Overriding one setting in a container with an environment variable, with no
  rebuild and no edited file.
- Failing at startup when a required setting is missing, instead of at the first
  request that needs it.
- Keeping an API key out of source control during local development.

## Deep Dive

### One view, many providers

`WebApplication.CreateBuilder` builds an `IConfiguration` from these sources,
in this order. A later source overrides an earlier one for the same key:

1. `appsettings.json`
2. `appsettings.{Environment}.json` (for example `appsettings.Development.json`)
3. User secrets (only in the `Development` environment)
4. Environment variables
5. Command-line arguments

The environment name comes from `ASPNETCORE_ENVIRONMENT` (default
`Production`). The `launchSettings.json` profile sets it to `Development` for
`dotnet run` and the IDE, but that file is only for local development and is not
used when the app is deployed.

### Reading a value

Keys are hierarchical. This JSON:

```json
{
  "ConnectionStrings": { "GameStore": "Data Source=GameStore.db" }
}
```

is read with a helper made for the `ConnectionStrings` section:

```csharp
var connString = builder.Configuration.GetConnectionString("GameStore");
builder.Services.AddSqlite<GameStoreContext>(connString);
```

The same value is addressable as `ConnectionStrings:GameStore`, with a colon as
the separator. That separator is the reason environment variables use a
different one.

### Overriding per environment

Environment variables cannot contain a colon in every shell, so the separator
there is a double underscore:

```bash
export ConnectionStrings__GameStore="Data Source=GameStoreProd.db"
dotnet run
```

With that variable set, the app opens `GameStoreProd.db` and the C# code is
identical. That is the whole point: the configuration code does not know, and
should not know, where a value came from. In a container or on a cloud host you
set the same variable in the deployment, with no file to edit. The variable
lives only in the current shell session, so closing the terminal restores the
JSON value.

### Typed settings: the options pattern

Reading strings by key scatters magic names through the code. Bind a section to
a class instead, and ask for it by type:

```csharp
public sealed class StoreOptions
{
    [Required] public string? Name { get; set; }
    [Range(1, 100)] public int PageSize { get; set; } = 20;
}

builder.Services.AddOptions<StoreOptions>()
    .BindConfiguration("Store")
    .ValidateDataAnnotations()
    .ValidateOnStart();

app.MapGet("/info", (IOptions<StoreOptions> options) => options.Value);
```

Two details make this better than `Configuration["Store:PageSize"]`. The value is
a typed `int` with a default. And `ValidateOnStart` runs the data annotations
when the app starts: with `Name` missing, the host refuses to boot with
`OptionsValidationException: DataAnnotation validation failed for 'StoreOptions'
members: 'Name' with the error: 'The Name field is required.'`, instead of
failing at the first request that reads it.

### Three interfaces, three lifetimes

- `IOptions<T>` is a singleton: read once, never refreshed. The default choice.
- `IOptionsSnapshot<T>` is scoped: recomputed per request, so a changed file is
  seen on the next request. It cannot be injected into a singleton.
- `IOptionsMonitor<T>` is a singleton that always returns the current value and
  can notify on change. Use it in singletons and background services that must
  react to reloads.

### Secrets

Anything that is a credential does not belong in `appsettings.json`, because that
file is committed. For local development use the Secret Manager:

```bash
dotnet user-secrets init
dotnet user-secrets set "Payments:ApiKey" "sk_test_..."
```

The value is stored in your user profile, outside the repository, and is loaded
automatically in `Development`. In production, use environment variables or a
secret store (Azure Key Vault, AWS Secrets Manager, Kubernetes Secrets). A
SQLite connection string can live in `appsettings.json` only because it carries
no credentials; a PostgreSQL one with a password cannot.

## Trade-offs

- **Precedence surprises.** A leftover environment variable on your machine can
  silently win over the JSON file, and the app seems to ignore your edit. When a
  setting "does not take", print `builder.Configuration.GetDebugView()` to see
  every key with the provider that supplied it.
- **Everything is a string until bound.** `Configuration["Store:PageSize"]`
  returns a string and `null` for a missing key, with no error. Binding to an
  options class gives you types and `ValidateOnStart`.
  ```csharp
  var size = builder.Configuration.GetValue<int>("Store:PageSize"); // 0 if missing, no warning
  ```
- **`IOptions<T>` never reloads.** If you edit `appsettings.json` while the app
  runs, `IOptions<T>` keeps the old value. Pick `IOptionsMonitor<T>` when
  reloading matters, and accept that a half-applied change is now possible.
- **Environment-specific files multiply.** `appsettings.Staging.json`,
  `appsettings.Production.json`, and per-customer variants turn into a matrix.
  Keep the JSON files to defaults and move anything that differs per
  deployment into environment variables set by the platform.
- **Environment variables are visible to the process tree.** They are better
  than a committed file but weaker than a mounted secret file or a vault for
  high-value credentials, since they show up in process listings and crash
  dumps on some platforms.

## Documentation Links

- [Configuration in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/) (doc)
- [Options pattern in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/configuration/options) (doc)
- [Use multiple environments in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/environments) (doc)
- [Safe storage of app secrets in development, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/security/app-secrets) (doc)
- [Options pattern in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/options) (doc)
