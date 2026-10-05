---
version: 1.0
updatedAt: 2026-10-05
---
## Objective

EF Core replaces hand-written SQL with C# objects: you describe your tables as
classes, and a `DbContext` turns what you do to those objects into `INSERT`,
`SELECT`, `UPDATE`, and `DELETE`. The goal is to wire a context to a database
(SQLite here, the same shape for PostgreSQL), to write the four CRUD operations
the way EF Core expects, to know which calls hit the database and which only
record intent, and to seed the reference data a foreign key needs before the
first row can be inserted.

## Use Cases

- Replacing an in-memory `List<T>` behind a prototype API with a real database,
  without changing the endpoints' contract.
- Creating a game that references a genre by foreign key, which only works if
  the genres already exist.
- Returning a list screen without loading entities the screen does not show.
- Deleting or updating one row by id with a single statement, without loading it
  first.

## Deep Dive

### Model, context, registration

The model is plain classes. Each table is a class; a foreign key is an id
property plus an optional navigation property:

```csharp
public class Genre
{
    public int Id { get; set; }
    public required string Name { get; set; }
}

public class Game
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public int GenreId { get; set; }       // the foreign key column
    public Genre? Genre { get; set; }      // navigation, null unless loaded
    public decimal Price { get; set; }
    public DateOnly ReleaseDate { get; set; }
}
```

`required` makes the compiler insist on a value at construction, which fits a
name that must never be empty. `GenreId` is not nullable, so every game must
have a genre: the relationship is mandatory. Keeping both `GenreId` and `Genre`
is a good habit: you can set the id without loading the related row.

The context lists the tables as `DbSet<T>` properties and receives its
configuration through `DbContextOptions`:

```csharp
public class GameStoreContext(DbContextOptions<GameStoreContext> options) : DbContext(options)
{
    public DbSet<Game> Games => Set<Game>();
    public DbSet<Genre> Genres => Set<Genre>();
}
```

Register it against SQLite with one call. It registers the context as scoped
(see the DI concept):

```csharp
var connString = builder.Configuration.GetConnectionString("GameStore");
builder.Services.AddSqlite<GameStoreContext>(connString);
```

Packages: `Microsoft.EntityFrameworkCore.Sqlite` for the provider and
`Microsoft.EntityFrameworkCore.Design` for the `dotnet ef` tooling. To target
PostgreSQL later, the model stays and only the provider package and the
`UseNpgsql` call change.

### Create: `Add` records intent, `SaveChangesAsync` writes

```csharp
var game = new Game { Name = dto.Name, GenreId = dto.GenreId, Price = dto.Price, ReleaseDate = dto.ReleaseDate };
db.Games.Add(game);          // tracked as Added; nothing sent to the database yet
await db.SaveChangesAsync(); // INSERT; game.Id is now the generated value
```

`Add` only registers the entity with the change tracker. The database is touched
at `SaveChangesAsync`, which translates all pending changes into SQL, in one
transaction. Forgetting it is a classic bug: the endpoint answers `201` and
nothing was stored. After the call the entity holds the id the database
generated, which is what you put in the `Location` header.

### Read: `FindAsync`, queries, and projection

`FindAsync(id)` looks up by primary key, checking the change tracker first and
the database second, and returns `null` when there is no row:

```csharp
var game = await db.Games.FindAsync(id);
```

For lists, write a LINQ query and project into the shape you will return. EF
Core translates the join and selects only the columns used, so no `Include` is
needed, and `AsNoTracking` skips change tracking because nothing will be
modified:

```csharp
var games = await db.Games
    .Select(g => new GameSummaryDto(g.Id, g.Name, g.Genre!.Name, g.Price, g.ReleaseDate))
    .AsNoTracking()
    .ToListAsync();
```

The `!` after `Genre` tells the compiler the navigation is not null inside this
query; EF Core handles it in SQL. The query only runs at `ToListAsync`; until
then it is a description. If you load entities instead of projecting and then
read `game.Genre.Name`, you need `.Include(g => g.Genre)` or `Genre` is `null`.

### Update: load, change, save

The change tracker remembers the original values of what it loaded, so an update
is just assigning properties and saving:

```csharp
var game = await db.Games.FindAsync(id);
if (game is null) return Results.NotFound();

game.Name = dto.Name;
game.Price = dto.Price;
await db.SaveChangesAsync();     // UPDATE only the columns that changed
```

For a one-row change that needs no read first, a set-based update runs one
statement and skips the tracker:

```csharp
await db.Games.Where(g => g.Id == id)
    .ExecuteUpdateAsync(s => s.SetProperty(g => g.Price, newPrice));
```

### Delete: `Remove` or a set-based delete

```csharp
db.Games.Remove(game);
await db.SaveChangesAsync();                       // load, then delete

await db.Games.Where(g => g.Id == id).ExecuteDeleteAsync();  // one statement, no load
```

`ExecuteDeleteAsync` executes immediately and needs no `SaveChanges`. It is
efficient and idempotent (zero rows affected when the id is already gone), which
suits a `DELETE` endpoint.

### Seeding reference data

A game has a mandatory `GenreId`, so inserting a game when the `Genres` table is
empty fails on the foreign key. Reference data has to exist first. EF Core has
two mechanisms:

- **`HasData`** in `OnModelCreating` declares the rows as part of the model, so
  they become part of the migrations. Good for fixed values with explicit ids.
- **`UseSeeding` and `UseAsyncSeeding`** (EF Core 9 and later) run code after the
  database is created or migrated. Good for logic and for data that is not
  worth encoding in a migration.

```csharp
builder.Services.AddSqlite<GameStoreContext>(connString, optionsAction: options => options
    .UseSeeding((context, _) =>
    {
        if (!context.Set<Genre>().Any())
        {
            context.Set<Genre>().AddRange(
                new Genre { Name = "Fighting" }, new Genre { Name = "Roleplaying" });
            context.SaveChanges();
        }
    })
    .UseAsyncSeeding(async (context, _, ct) =>
    {
        if (!await context.Set<Genre>().AnyAsync(ct))
        {
            context.Set<Genre>().AddRange(
                new Genre { Name = "Fighting" }, new Genre { Name = "Roleplaying" });
            await context.SaveChangesAsync(ct);
        }
    }));
```

Both are configured because `Migrate()` runs the synchronous one and
`MigrateAsync()` the asynchronous one. The `Any()` guard makes the seed
idempotent: it runs on every migration, not only the first. In a test with a
fresh SQLite file, calling `Database.Migrate()` at startup created the schema
and inserted the genres in one go.

## Trade-offs

- **`SaveChanges` is easy to forget and easy to overuse.** Add never writes, and
  calling `SaveChanges` after every change turns one unit of work into many
  round trips. Make the changes, then save once.
  ```csharp
  db.Games.Add(game);          // forgot SaveChangesAsync: 201 returned, row never stored
  ```
- **Tracking costs memory and time.** The change tracker is worth it for
  load-modify-save and wasted on read-only endpoints. Use `AsNoTracking` or a
  projection for reads.
- **Set-based `ExecuteUpdate` and `ExecuteDelete` bypass the tracker.** Entities
  already loaded in the same context become stale, and any C# logic hooked to
  `SaveChanges` (interceptors, audit fields) does not run.
- **Seeding logic runs on every migrate.** A seed without an existence check
  inserts duplicates on the second start. Prefer `HasData` for small fixed
  lookups with stable ids, and `UseSeeding` where you need conditional logic.
- **Navigation properties invite lazy assumptions.** `game.Genre` is `null`
  unless the query loaded it, and `Genre!` silences the warning, not the
  `NullReferenceException`. Project into DTOs so the shape of the query and the
  shape of the result are the same thing.

## Documentation Links

- [Getting started with EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/get-started/overview/first-app) (doc)
- [Saving data in EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/) (doc)
- [ExecuteUpdate and ExecuteDelete, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/saving/execute-insert-update-delete) (doc)
- [Data seeding, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/modeling/data-seeding) (doc)
- [Tracking vs no-tracking queries, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/querying/tracking) (doc)
