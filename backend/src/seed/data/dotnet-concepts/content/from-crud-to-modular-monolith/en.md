---
version: 1.0
updatedAt: 2026-10-05
---
## Objective

Almost no modular monolith starts as one. It starts as a small CRUD API with one
project, one `DbContext`, and every endpoint free to touch every table, and that
is the right way to start. The skill is knowing when that shape stops paying,
and how to move to modules in small steps that keep the application running at
every commit, rather than in a rewrite. The goal is a concrete path from a
single-project CRUD (a game catalog) to two modules (Catalog and Orders) with
separate projects, separate schemas, and a contract between them, ending where
the module-boundaries concept begins.

## Use Cases

- A catalog CRUD that now needs orders, and the first question is whether an
  order may join the games table directly.
- A growing `Program.cs` and a single `DbContext` where a change in one feature
  keeps breaking another.
- A second team about to join the repository, which needs ownership lines the
  compiler can enforce.
- A prototype that proved its value and must now be structured for a longer
  life, without a big-bang rewrite.

## Deep Dive

### Start as a CRUD, on purpose

A single project with `Models/`, `Data/`, `Dtos/`, and `Endpoints/` is the right
shape for one resource. Splitting it into projects before a second business
area exists freezes guesses about boundaries into the folder structure. Move
only when a real signal appears:

- A **second area with its own data and rules** arrives (orders, payments,
  inventory), and its tables start to reference the first area's.
- A change to one feature regularly **breaks an unrelated one**, because every
  endpoint can query every `DbSet`.
- **Two teams** need to work in parallel and keep stepping on each other.
- A part of the system needs to **change or scale independently**, and you want
  that to be cheap later.

With one resource and one developer, none of these apply, and the folders are
enough.

### Step 0: name the modules and who owns what

Before touching code, decide the owner of every table. In the game store:

- **Catalog** owns `Games` and `Genres`.
- **Orders** owns `Orders` and `OrderLines`.

If a table seems to have two owners, the boundary is drawn wrong. A product
referenced by an order line is still owned by Catalog; Orders keeps only its id
(and a copy of whatever it must remember, such as the price at purchase time).

### Step 1: group by feature inside the one project

The cheapest first move changes no project structure: turn the technical folders
into feature folders, so each area's files sit together. `Games/` contains its
entities, DTOs, endpoints, and mapping; `Genres/` likewise. This step proves the
areas are separable before any `.csproj` is created, and it is easy to undo.

### Step 2: one project per module, plus a host

Now create the real structure:

```text
src/
  Host/                    -> Program.cs only, composes the modules
  Modules/
    Catalog/
      Catalog.Contracts/   -> public DTOs and ICatalogModule
      Catalog.Core/        -> entities, DbContext, endpoints (internal)
  Shared/
    Shared.Kernel/         -> tiny, no business meaning
```

Move the existing CRUD into `Catalog.Core` as it is. The `GameStoreContext`
becomes `CatalogDbContext`; the app still behaves the same. Then make types
`internal` by default and let the compiler complain. Every complaint is a place
where something outside the module was reaching in. Fix each by moving the code
or by publishing a deliberate type in `Catalog.Contracts`.

### Step 3: each module registers itself

Replace the host's knowledge of Catalog's insides with two calls the module
exposes:

```csharp
// Program.cs in Host
builder.Services.AddCatalogModule(builder.Configuration);
var app = builder.Build();
app.MapCatalogEndpoints();
```

`AddCatalogModule` registers the `DbContext`, the services, and the contract
implementation; `MapCatalogEndpoints` maps the route group. The host now lists
modules and nothing else. Registration is also where the module picks its own
schema (next step).

### Step 4: separate schemas, separate migration histories

Give each module its own database schema and its own migration history table, in
the same database:

```csharp
modelBuilder.HasDefaultSchema("catalog");

options.UseNpgsql(connectionString,
    npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "catalog"));
```

Schemas are the reason to move from SQLite to PostgreSQL at this point: the
SQLite provider has no notion of a schema, so there is nothing equivalent to a
`catalog` namespace for tables. Regenerate the initial migration for the new
provider. From now on Catalog and Orders can evolve their tables, and apply
their migrations, without knowing about each other.

### Step 5: the second module, behind a contract

Now add Orders. It gets its own `Orders.Contracts` and `Orders.Core`, and its
project references allow only `Catalog.Contracts`, never `Catalog.Core`:

```xml
<!-- Orders.Core.csproj -->
<ProjectReference Include="..\Orders.Contracts\Orders.Contracts.csproj" />
<ProjectReference Include="..\..\Catalog\Catalog.Contracts\Catalog.Contracts.csproj" />
```

Orders needs a game's name and price. It asks through the contract:

```csharp
// Catalog.Contracts
public interface ICatalogModule
{
    Task<IReadOnlyDictionary<int, GameInfoDto>> GetGamesAsync(int[] ids, CancellationToken ct);
}
```

Two rules keep this honest. First, `OrderLine.GameId` is a plain `int`, with no
foreign key to `catalog.Games`, because a constraint across schemas is a
dependency the compiler and the module graph cannot see. Second, when Orders
creates a line, it copies the price into `UnitPrice`, so a later price change in
Catalog does not rewrite history. Reading an order with game names becomes two
queries: the order's lines from `orders`, then `GetGamesAsync` for their ids.

### Step 6: lock the boundary

Project references stop the obvious violations, and nothing stops the rest: a new
reference added "temporarily", an `InternalsVisibleTo` for a report, an
`AppDbContext` that maps both schemas. Add architecture tests that fail the build
when `Orders.Core` depends on `Catalog.Core` or when an entity type is public.
That is the topic of the architecture-tests concept, and it is what turns the
layout from a convention into a rule.

### What the path deliberately avoids

- **Splitting before there is a second area.** Empty modules for areas that do
  not exist yet are guesses, and wrong guesses are expensive to move.
- **A shared `AppDbContext` as a stepping stone.** It is the fastest way to
  undo the split, and it never gets removed.
- **Cross-module joins "for performance".** One query instead of two is the
  first shortcut that erases the boundary. If it hurts on a hot path, keep a
  small local copy of the data fed by events, not a join.
- **A shared transaction across two modules.** It works while there is one
  database and becomes a distributed transaction the day a module is extracted.

## Trade-offs

- **Every step adds ceremony.** More projects, more registration code, more
  mapping at the edges. For one resource it is pure cost, which is why the
  trigger is a real second area and not a vague wish for "clean architecture".
- **Two queries instead of one.** Reading an order with game names costs an extra
  round trip. The price buys independence; if it is too high, keep a local
  projection of the catalog data inside Orders.
  ```csharp
  var lines = await db.OrderLines.Where(l => l.OrderId == id).ToListAsync(ct);
  var games = await catalog.GetGamesAsync(lines.Select(l => l.GameId).Distinct().ToArray(), ct);
  ```
- **Data migration is the hard part.** Moving tables into schemas on a database
  that already holds production data needs a careful migration (create schema,
  move tables, keep the history table consistent), not a casual rename.
- **The boundary can be wrong.** You will sometimes find that two modules change
  together on every feature. That is a sign they are one module; merging is
  cheaper in a monolith than across services, which is part of the point.
- **The monolith is still one deploy.** A bad migration or a memory leak in one
  module affects all of them. The modular layout lowers the cost of extraction;
  it does not remove the shared runtime.

## Lab

In this lab you get a solution that already has the module layout (a game catalog and an order flow), but with a fake boundary: everything is `public` and the orders module calls the catalog's `GameStore` directly. On top of that, an order stores a price of `0` instead of the price that was paid. Your job is to fix the structure one step at a time and let the compiler tell you what was reaching into the other module. The core idea is to turn two features that reach into each other's internals into two modules that talk only through a contract, with the compiler and a few architecture tests enforcing the boundary.

**The scenario**

- `src/Host` (`GameStore.Host`): only composes the modules, calling `AddCatalogModule`/`AddOrdersModule` and the `Map...Endpoints`.
- `Catalog.Contracts`: `ICatalogModule` and `GameInfoDto`, the catalog's public face.
- `Catalog.Core`: `Game`, `GameStore`, `CatalogModuleApi` and `CatalogModule` (registration and endpoints).
- `Orders.Contracts`: the request and response shapes of orders.
- `Orders.Core`: `Order`, `OrderLine`, `OrderStore` and `OrdersModule`. Today it references `Catalog.Core` in its csproj.

The tests have two fronts: `OrderFlowTests` exercises the API end to end (price paid, `Location`, unknown game, order without lines) and `ModuleBoundaryTests` uses reflection to check the references between assemblies and that each `Core` exports only the module class.

**What you will do, step by step**

1. **Hide the catalog's interior (TODO-00).** Make every type in `Catalog.Core` `internal` except `CatalogModule` (including `Game`, `GameStore` and `CatalogModuleApi`). The solution stops compiling, because `Orders.Core` was using those types. That is the compiler enforcing the boundary, and the next steps fix it.
2. **Expose the catalog through a contract (TODO-01).** In `CatalogModuleApi.GetGamesAsync`, look the ids up in the store and answer a dictionary of `GameInfoDto` keyed by id (ids that do not exist are simply absent). Then register `ICatalogModule` with `CatalogModuleApi` (scoped) in `AddCatalogModule`.
3. **Swap Orders' dependency (TODO-02).** In `Orders.Core`, use `ICatalogModule` instead of `GameStore` in both endpoints and in `ToDto`, and in `Orders.Core.csproj` replace the reference to `Catalog.Core` with `Catalog.Contracts`.
4. **Hide the orders interior (TODO-03).** Make `Order`, `OrderLine` and `OrderStore` `internal`, leaving only `OrdersModule` public.
5. **Keep the price paid (TODO-04).** When the order is placed, copy the game's current price into `OrderLine.UnitPrice`. An order must keep the price that was paid, even if the catalog price changes later.

**How you know you are done**

`dotnet test` is all green. You should be able to explain what the compiler complained about after TODO-00 and why that is good, why `Orders.Core` may reference `Catalog.Contracts` but not `Catalog.Core`, and why an old order's total does not change when the catalog reprices the game.

**Optional challenges**

- **TODO-05:** add an architecture test that fails when any `*.Contracts` assembly exposes a type that is not a record or an interface.
- **TODO-06:** add `Orders.Core` -> `Catalog.Core` back in the csproj "temporarily" and see which test catches it before the code even uses the type.
- **TODO-07:** replace the in-memory stores with one PostgreSQL schema per module (`catalog` and `orders`), each with its own `DbContext` and migrations history table.

**Prerequisites:** C# project references and access modifiers (`public` vs `internal`), Minimal APIs and dependency injection, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. In the starter state the solution compiles, but `GetGamesAsync` throws `NotImplementedException` and the boundary and flow tests fail; the TODOs are in comments in the files mentioned.

## Documentation Links

- [Common web application architectures, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures) (doc)
- [SQLite EF Core provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
- [Migrations history table, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/history-table) (doc)
- [dotnet add reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-add-reference) (doc)
- [Modular Monolith with DDD, kgrzybek (reference implementation)](https://github.com/kgrzybek/modular-monolith-with-ddd) (doc)
