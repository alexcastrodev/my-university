---
version: 1.0
updatedAt: 2026-10-05
---
## Objective

A DTO (data transfer object) is a type that exists only to describe what crosses
the HTTP boundary. It is the contract between the API and its clients: the front
end is written against these shapes, so they must stay stable while the
database model changes freely underneath. The goal is to know why a REST API
should never serialize its entities directly, how to model one DTO per use case
with C# records, and where the mapping between entity and DTO should live.

## Use Cases

- Returning a game to a React front end with the genre as a display string in a
  list, but as an id in an edit form, from the same entity.
- Accepting a create request that cannot contain an `Id`, because the database
  generates it.
- Renaming a database column or splitting a table without a single change on the
  client side.
- Keeping sensitive or internal fields (a password hash, a soft-delete flag, a
  navigation collection) out of every response by construction.

## Deep Dive

### Why not return the entity

With EF Core, the entity is the persistence model: it has navigation properties,
a change-tracking state, and columns the client should not know about.
Returning it directly causes three problems at once:

- **The client is coupled to the table.** Adding a column adds a JSON property;
  renaming one breaks the front end.
- **Cycles and over-fetching.** `Game.Genre.Games.Genre...` serializes forever
  or loads far more than the screen needs.
- **Mass assignment.** If the same type is accepted on `POST`, a client can set
  `Id` or any other property you did not mean to expose.

### Records fit the job

A DTO is data with no behavior and no identity, which is exactly what a `record`
is. A positional record is one line and immutable:

```csharp
public record GameSummaryDto(
    int Id, string Name, string Genre, decimal Price, DateOnly ReleaseDate);
```

The compiler generates the constructor, the properties, value equality, and
`ToString`. `System.Text.Json` serializes positional records and can
deserialize them through the primary constructor, so the same type works for
requests and responses.

### One DTO per use case

The same entity usually needs several shapes. In a game store, these three are
different on purpose:

```csharp
// List screen: genre as text, enough to render a row
public record GameSummaryDto(int Id, string Name, string Genre, decimal Price, DateOnly ReleaseDate);

// Detail and edit form: genre as the id the form posts back
public record GameDetailsDto(int Id, string Name, int GenreId, decimal Price, DateOnly ReleaseDate);

// Create: no Id, the database owns it
public record CreateGameDto(
    [Required][StringLength(50)] string Name,
    [Range(1, 50)] int GenreId,
    [Range(1, 100)] decimal Price,
    DateOnly ReleaseDate);
```

Do not merge them to save typing. `GameSummaryDto.Genre` is a `string` and
`GameDetailsDto.GenreId` is an `int` because the screens need different things.
A single "universal" DTO ends up with nullable properties whose meaning depends
on which endpoint returned it. `UpdateGameDto` is a fourth type that often looks
identical to `CreateGameDto`; keep it separate anyway, because the two diverge
the day an update must not change one of the fields.

### Where the mapping lives

The mapping is repetitive, so it deserves one home. The smallest option is a set
of extension methods next to the DTOs:

```csharp
public static class GameMappingExtensions
{
    public static Game ToEntity(this CreateGameDto dto) => new()
    {
        Name = dto.Name,
        GenreId = dto.GenreId,
        Price = dto.Price,
        ReleaseDate = dto.ReleaseDate,
    };

    public static GameDetailsDto ToDetailsDto(this Game game) =>
        new(game.Id, game.Name, game.GenreId, game.Price, game.ReleaseDate);

    public static GameSummaryDto ToSummaryDto(this Game game) =>
        new(game.Id, game.Name, game.Genre!.Name, game.Price, game.ReleaseDate);
}
```

Handlers then read as intent: `db.Games.Add(dto.ToEntity())` and
`return game.ToDetailsDto()`. There is one subtlety: `ToSummaryDto` touches
`game.Genre`, which is `null` unless the query loaded it. For lists, project in
the query instead and let the database fetch only what the DTO needs:

```csharp
var games = await db.Games
    .Select(g => new GameSummaryDto(g.Id, g.Name, g.Genre!.Name, g.Price, g.ReleaseDate))
    .AsNoTracking()
    .ToListAsync();
```

With a projection, EF Core translates the join and selects only these columns,
and `Include` is not needed. A mapping library such as Mapperly (source
generated) or AutoMapper is an option once the number of types makes the manual
version tedious, not a starting point.

### The entity never leaves the handler

A useful rule: an entity may appear inside the handler and inside the data
access code, and nowhere in a signature that the outside world sees. After
`SaveChangesAsync`, the entity has its generated `Id`, so build the response DTO
from it right there:

```csharp
var game = dto.ToEntity();
db.Games.Add(game);
await db.SaveChangesAsync();                 // game.Id is now filled in
return Results.CreatedAtRoute(GetGameEndpointName, new { id = game.Id }, game.ToDetailsDto());
```

## Trade-offs

- **More types and more mapping code.** A CRUD with four DTOs per resource looks
  like boilerplate, and for a throwaway prototype it is. The cost pays back the
  first time the table changes and the client does not.
- **Mapping hides mistakes silently.** Add a `Description` column and forget to
  copy it in `ToEntity`: nothing fails, the value is just never saved. A test
  that round-trips a fully populated DTO catches this class of bug.
  ```csharp
  // fails if a property is added to the DTO but not to the mapping
  Assert.Equal(dto, dto.ToEntity().ToDetailsDto());
  ```
- **Contracts that mirror the entity defeat the purpose.** A DTO with the same
  twenty properties as the entity couples the client to the table just as
  tightly; design the DTO from the screen, not from the class.
- **Mapping libraries trade clarity for brevity.** Reflection-based mappers move
  errors from compile time to runtime (a renamed property breaks at the first
  request). Source-generated mappers keep most of the compile-time safety.
- **Positional records have a validation wrinkle.** Attributes on positional
  parameters need to land on the properties to be read by some validators. The
  validation concept covers how ASP.NET Core handles it.

## Documentation Links

- [Records, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [Create responses in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses) (doc)
- [How to serialize and deserialize JSON, System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/how-to) (doc)
- [Efficient querying, projections, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying) (doc)
- [Mapperly, source-generated object mapper](https://mapperly.riok.app/) (doc)
