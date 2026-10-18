---
version: 1.0
updatedAt: 2026-10-05
---
## Objective

Anything that arrives over HTTP is untrusted input. Without a check, a client
can create a game with no name, a negative price, or a title of ten thousand
characters, and the bad data sits in your database until something else breaks
on it. The goal is to declare validation rules once, on the request type, and
have ASP.NET Core reject invalid requests with a `400` before your handler runs.
Starting with .NET 10 minimal APIs have built-in support for that, and it comes
with a few traps worth knowing before you rely on it.

## Use Cases

- Rejecting a `POST /games` with a missing name, a name over 50 characters, or a
  price outside the allowed range, with a message per field.
- Validating a query or route parameter (`?page=0`) without writing an `if` in
  every handler.
- Giving the front end a machine-readable list of which fields failed, so a form
  can highlight them.
- Keeping handlers free of validation noise so they only deal with valid input.

## Deep Dive

### The bug that motivates it

Minimal APIs do not validate anything by default. This request is accepted and
stored:

```text
POST /games
{ "genreId": 1, "price": 59.99, "releaseDate": "2023-10-20" }   // no name

HTTP/1.1 201 Created
```

You could check each property by hand in the handler, but that repeats for every
endpoint and every field, and it hides the actual logic.

### Declare rules with data annotations

Put the rules on the type that models the request. The attributes live in
`System.ComponentModel.DataAnnotations`:

```csharp
public record CreateGameDto(
    [Required][StringLength(50)] string Name,
    [Range(1, 50)] int GenreId,
    [Range(1, 100)] decimal Price,
    DateOnly ReleaseDate);
```

The common ones are `[Required]`, `[StringLength(max)]`, `[Range(min, max)]`,
`[RegularExpression]`, `[EmailAddress]`, and `[MinLength]`/`[MaxLength]` for
collections. `UpdateGameDto` repeats the same attributes: sharing one type for
create and update is tempting, but the two diverge as soon as a field becomes
read-only after creation.

### Turn it on: `AddValidation`

Attributes on a type do nothing until validation is registered. In .NET 10 that
is one line:

```csharp
builder.Services.AddValidation();
```

From then on, the framework validates every parameter of every minimal API
handler that has validation attributes, before calling the handler. A failure
short-circuits with `400 Bad Request` and a validation problem body that lists
each failing field:

```json
{
  "title": "One or more validation errors occurred.",
  "errors": {
    "Name": ["The Name field is required."],
    "Price": ["The field Price must be between 1 and 100."]
  }
}
```

Note that the keys are the C# property names (`Name`), not camelCase, and that
all failures come back together, so a form can mark every bad field at once.
Parameters validate too: `([Range(1, 100)] int page)` rejects `?page=0` with the
same shape. The handler is never invoked, so it can assume its input is valid.

### A silent trap: types that are not discovered

In .NET 10 the validation setup finds the types to validate at compile time. In
a test project a `CreateDto` declared as an **internal** type (a `record` with no
`public` modifier, at the bottom of `Program.cs`) was never validated. A request
with an empty name and a price of 500 came back `200 OK` while the same record
made `public` returned `400` with both errors. Parameters like
`[Range] int page` still worked, which makes the failure easy to miss.

The rule of thumb: keep request DTOs `public`, and write one test per DTO that
posts an invalid body and expects `400`. If a type must stay internal, check the
current docs for `[ValidatableType]` and for how discovery works in your
version.

### What annotations cannot express

Data annotations check the shape of one value. They do not know about the
database:

- `[Range(1, 50)]` on `GenreId` does not prove genre 17 exists. If it does not,
  `SaveChangesAsync` throws a `DbUpdateException` from the foreign key and the
  client sees a `500`. Check existence in the handler and answer `400` or `422`
  yourself.
- Rules that compare two fields (end date after start date) need
  `IValidatableObject` or a custom `ValidationAttribute`.
- Uniqueness ("a game with this name already exists") belongs to the database,
  as a unique index, with the violation translated to `409 Conflict`.

### Custom messages and rules

Every attribute takes an `ErrorMessage`, and a custom rule is a small subclass:

```csharp
public sealed class NotFutureAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context) =>
        value is DateOnly d && d > DateOnly.FromDateTime(DateTime.UtcNow)
            ? new ValidationResult("Release date cannot be in the future.")
            : ValidationResult.Success;
}
```

## Trade-offs

- **Attributes mix rules into the contract type.** It is compact and the rules
  are visible next to the field, but the DTO now knows about validation. A
  library like FluentValidation keeps rules in a separate class and handles
  conditional or cross-field rules better, at the cost of an extra dependency
  and wiring.
- **A passing validator is not a safe request.** Validation checks the shape and
  ranges you listed. It says nothing about authorization, existence of related
  rows, or business invariants, which still belong in the handler or the domain.
- **Silent skips are worse than loud failures.** The internal-type case above
  returns `200` on bad data and nothing in the logs. Tests that assert `400` for
  an invalid body are the only reliable safety net.
- **Duplicated rules drift.** Copying `[StringLength(50)]` from the create DTO
  to the update DTO means two places to change. If the two truly share rules,
  extract a shared base or a constant:
  ```csharp
  public const int NameMaxLength = 50;   // used by both DTOs and the EF configuration
  ```
- **Decimal ranges are easy to get wrong.** `[Range(1, 100)]` on a `decimal`
  compares through a conversion; for fractional bounds use
  `[Range(typeof(decimal), "0.01", "100")]`. And match the database column
  size to the attribute (`[StringLength(50)]` and `HasMaxLength(50)`), or one
  of them is a lie.

## Lab

In this lab you get a games API that accepts anything: `POST /games` stores the DTO with no checks, so a game with no name or a price of 500 is created happily, and `GET /games?page=` accepts any page number. Your job is to declare the rules, turn on ASP.NET Core's built-in validation and discover one trap that makes the rules silently do nothing. The core idea is that invalid requests get rejected with `400 Bad Request` before the handler runs.

**The scenario**

The tests start the API in memory with `WebApplicationFactory<Program>` and check the status, the keys inside `errors` and that an invalid game is not stored.

- `Program.cs`: registers `GameStore` and calls `MapGamesEndpoints`.
- `GamesEndpoints.cs`: the `/games` group with `GET /` (`page` parameter, default 1) and `POST /`.
- `CreateGameDto.cs`: the input record (`Name`, `GenreId`, `Price`, `ReleaseDate`).
- `GameStore.cs`: the in-memory store, with `Add` and `Count`.

**What you will do, step by step**

1. **Turn validation on (TODO-00).** In `Program.cs`, register the ASP.NET Core validation services, so that data annotations are checked before the handler runs.
2. **Declare the rules (TODO-01).** In `CreateGameDto`, annotate the positional parameters: `Name` required with at most 50 characters, `GenreId` from 1 to 50 and `Price` from 1 to 100.
3. **Find the trap (TODO-02).** Run the tests after the first two steps: some POST tests should pass now but do not. Find out why this type is never validated (look closely at its declaration) and fix it. That is the point of the lab: the annotations can be right and still do nothing, with no error at all.
4. **Validate a simple parameter (TODO-03).** In `GamesEndpoints`, reject `page` values outside 1 to 100 by annotating the parameter.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why the handler does not even run with an invalid body, why every invalid field shows up in the same response and what was keeping the annotations from taking effect in TODO-02.

**Optional challenges**

- **TODO-04:** add a `NotFutureAttribute` (a custom `ValidationAttribute`) and apply it to `ReleaseDate` so a release date in the future is rejected.
- **TODO-05:** send an invalid body with `curl` and read the response carefully. Note the casing of the keys under `errors`.

**Prerequisites:** basic Minimal APIs (`MapGet`, `MapPost`, route groups), C# records and attributes, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The app compiles in the starter state, and the validation tests fail until you complete the TODOs marked in comments in `Program.cs`, `CreateGameDto.cs` and `GamesEndpoints.cs`.

## Documentation Links

- [Validation in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#validation-support-in-minimal-apis) (doc)
- [What's new in ASP.NET Core 10, validation support](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0#validation-support-in-minimal-apis) (doc)
- [System.ComponentModel.DataAnnotations namespace, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.dataannotations) (doc)
- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
- [FluentValidation documentation](https://docs.fluentvalidation.net/) (doc)
