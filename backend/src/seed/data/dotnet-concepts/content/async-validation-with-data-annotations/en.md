---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

"This email is already registered" is the validation rule people ask for first, and until .NET 11 it could not be written as a data annotation, because a `ValidationAttribute` is synchronous and a database call is not. You either blocked a thread on the query, or you moved the rule out of the attribute and into the handler. ASP.NET Core 11 adds two types that fix this: `AsyncValidationAttribute` for a rule on one property, and `IAsyncValidatableObject` for a rule on a whole object. The Minimal API validation you already turned on with `AddValidation()` runs them, waits for them, hands them the request's cancellation token and turns their failures into the same `400 application/problem+json` as any other rule.

This concept shows what those two types look like, what order the rules run in, what the response looks like and what happens when the client leaves. Every behavior below was run on the 11.0.100 SDK with a `WebApplicationFactory` test.

## Use Cases

- Rejecting a registration whose email already exists, with a message on the `Email` field.
- Checking that a referenced row exists (a genre, a coupon code, a tenant) and answering `400` with a field error instead of a `500` from a foreign key.
- A rule across fields that needs data from a service: a booking whose dates must not overlap another booking.
- A rule that calls an external service, where the call should stop if the client gives up.

## Deep Dive

### What was missing

The existing input validation concept ends with a list of things annotations cannot express: existence in the database and uniqueness. The sync `ValidationAttribute.IsValid` has no `async`, so a rule that has to `await` had two bad options. Calling `.Result` blocks a thread pool thread for the whole query. Checking in the handler splits the rules in two places, and the handler's answer is usually a hand-built `400` that does not look like the framework's.

### A rule on one property: `AsyncValidationAttribute`

Derive from `AsyncValidationAttribute` and override `IsValidAsync`. It receives the value, the `ValidationContext` and a `CancellationToken`:

```csharp
public sealed class UniqueEmailAttribute : AsyncValidationAttribute
{
    // abstract in the base class, so it has to exist
    protected override ValidationResult? IsValid(object? value, ValidationContext validationContext) =>
        throw new NotSupportedException("The async path is the one that runs.");

    protected override async Task<ValidationResult?> IsValidAsync(
        object? value, ValidationContext validationContext, CancellationToken cancellationToken)
    {
        var repository = validationContext.GetRequiredService<IUserRepository>();
        var exists = await repository.EmailExistsAsync((string)value!, cancellationToken);
        return exists
            ? new ValidationResult("Email already registered.", [validationContext.MemberName ?? "Email"])
            : ValidationResult.Success;
    }
}
```

Three things in that code are worth noticing.

**The sync method is mandatory.** `IsValid` is abstract in `AsyncValidationAttribute`, so the class does not compile without it. In the test project here it threw `NotSupportedException` and was never called by the Minimal API, not for a valid request and not for an invalid one. Throwing is a way to find out if you are ever wrong about that. If the same attribute will also be used by code that calls `Validator.TryValidateObject` (plain data annotations validation outside the Minimal API), a throwing `IsValid` becomes a runtime failure there, so implement it for real in that case.

**Services come from the context.** An attribute is created by the compiler from the attribute syntax, so it has no constructor injection. `validationContext.GetRequiredService<T>()` resolves from the request's service provider. The repository is a normal service, so a scoped `DbContext` behind it works too.

**Name the member.** The second argument of `ValidationResult` is the list of member names, and it decides the key under `errors`. Without it the message is not attached to a field. `validationContext.MemberName` is the property the attribute sits on.

Using it is the same as any other annotation:

```csharp
public record Registration(
    [property: Required] string Name,
    [property: EmailAddress, UniqueEmail] string Email);

builder.Services.AddValidation();
builder.Services.AddSingleton<IUserRepository, InMemoryUserRepository>();

app.MapPost("/users", (Registration registration) =>
    TypedResults.Created("/users/1", registration));
```

The same attribute also works on a handler parameter. `([UniqueEmail] string email)` on a `MapGet` rejected `?email=taken@x.com` with the key `email` in lowercase, because for parameters the key is the parameter name and for properties it is the property name.

### A rule on the whole object: `IAsyncValidatableObject`

When the rule involves several fields, implement `IAsyncValidatableObject` on the type. Its `ValidateAsync` returns an `IAsyncEnumerable<ValidationResult>`, so you can `yield return` each problem as you find it:

```csharp
public record Order(DateOnly Start, DateOnly End, [property: Range(1, 10)] int Quantity)
    : IAsyncValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext) =>
        throw new NotSupportedException("The async path is the one that runs.");

    public async IAsyncEnumerable<ValidationResult> ValidateAsync(
        ValidationContext validationContext,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        // await a service here: an overlap check, a calendar lookup
        if (End < Start)
        {
            yield return new ValidationResult("End must be after Start.", [nameof(End)]);
        }
    }
}
```

The interface inherits `IValidatableObject`, so the sync `Validate` has to exist here too, and it was not called either. The `[EnumeratorCancellation]` attribute is what lets the token reach the iterator when the caller supplies it. The request `{"Start":"2026-12-10","End":"2026-12-01","Quantity":1}` returned:

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": { "End": ["End must be after Start."] },
  "traceId": "00-a6f815e56c8d1798e997afc5b2e77992-3fd383f64ca9c04b-02"
}
```

### The order the rules run in

The order is the part that is not obvious, and it is the reason to write the tests. These are the cases measured with a repository that counts its calls:

| Request | What ran | Result |
|---|---|---|
| `Name` empty, `Email` taken | `[Required]` and `UniqueEmail` both ran (different properties) | `errors` has `Name` and `Email` |
| `Email` is `not-an-email` | `[EmailAddress]` failed, `UniqueEmail` did not run, 0 repository calls | `errors` has only the format message |
| `Quantity` 0 and `End` before `Start` | the property rule failed, `ValidateAsync` did not run | `errors` has only `Quantity` |
| `Quantity` 1 and `End` before `Start` | property rules passed, `ValidateAsync` ran | `errors` has `End` |

Two rules come out of it. On one property, the sync attributes run first and a failure stops the async one, so a malformed email never reaches the database. Across properties the rules are independent and every failure is reported together, which is what a form needs. The object-level rule runs only when the property rules passed, the same shape as `IValidatableObject` in the sync world. Put the cheap checks in sync attributes and keep the async ones for what really needs I/O: the order makes the cheap ones a free filter.

### The response is the ProblemDetails you already have

A failed async rule comes back as `400` with `application/problem+json`, with the field names as keys under `errors`, with the C# property name (`Email`, not `email`) for properties. Nothing about the shape changed: a client that already handles the sync `400` handles this one. That requires `AddProblemDetails()` in the project used here, as in the problem details concept; the `type`, `title` and `traceId` in the example above come from it.

The handler does not run. That is the same guarantee as sync validation, and it is why the async rule is a better home for "already exists" than the handler: the handler can assume its input is valid.

### Cancellation: the token is the request's

The token passed to `IsValidAsync` and `ValidateAsync` is cancelled when the client disconnects. In the test a request to a rule that waits 1.5 seconds on its repository call was aborted by the client after 200 ms, and the repository saw `OperationCanceledException` and recorded `canceled` instead of finishing. If the rule passes `CancellationToken.None` (or forgets the parameter and calls an overload without one), the lookup runs to the end for a client that is gone. For a cheap indexed query that does not matter. For a slow call to another service it does, and it is a line to check in every async rule.

### What is not covered

The release notes describe equivalent async APIs for Blazor forms on the `EditContext`. In the audit that backs this page they only compiled, and nothing exercised them in a browser, so this page says nothing about their behavior. The same goes for asynchronous validation of options (`IAsyncValidateOptions<T>`): a test on the 11.0.100 GA did not trigger it, so it is left out here on purpose. Both are features to test in your own project before relying on them. The Blazor forms concept covers the sync `EditForm` side.

## Trade-offs

- **A database call inside validation runs on every request.** A rule that queries on every POST turns each request into a lookup, including the ones that would fail later anyway. The sync attributes on the same property filter malformed values first, but a valid-looking email still pays for a query. Keep the async rule to what is cheap and indexed.
- **It is a check, not a guarantee.** Between the validation query and the `INSERT` another request can take the email. The unique index in the database is still the real rule: keep it, and translate its violation to `409 Conflict`. The async attribute gives the common case a clean `400` with a field message, not the correctness.
- **The sync method is dead code you must write.** `IsValid` and `Validate` have to exist and are never called by the Minimal API. Throwing makes that visible, but it also means the type breaks in code that uses the sync validator. Decide once which code paths validate your types.
- **Hidden I/O in an annotation.** An attribute on a DTO that opens a connection is easy to miss when reading the type. A name like `UniqueEmail` is a hint; a comment is cheap. Keep the I/O behind a service and keep the attribute thin.
- **A new API, still young.** It arrived during the .NET 11 previews and is not in .NET 10. Libraries such as FluentValidation have had async rules for years and keep rules out of the DTO; the built-in version is the smaller step if you already use annotations.
- **Tests carry the contract.** The order of rules and the cancellation behavior are not in the type signatures. One test per rule that posts a bad value and asserts the `400`, plus one for the cancellation, is what keeps them true across upgrades.

## Lab

In this lab you get an API with a `Registration` and an `Order` type and an in-memory repository, but validation is off and both async rules are empty. You turn validation on, write `UniqueEmailAttribute` against the repository and write the object-level rule, and then read the tests that show the order of the rules and the cancellation. The lab targets `net11.0` and needs the .NET 11 SDK. No Docker and no database.

**The scenario**

The tests run the API in memory with `WebApplicationFactory<Program>` and replace the repository with a fake that counts calls and records whether a slow lookup was cancelled.

- `Program.cs`: `POST /users` and `POST /orders`.
- `Models.cs`: `Registration` and `Order` (the `IAsyncValidatableObject`).
- `UniqueEmailAttribute.cs`: the `AsyncValidationAttribute`.
- `IUserRepository.cs`: the interface and the in-memory implementation.

**What you will do, step by step**

1. **Turn validation on (TODO-00).** Register the validation services. Until then every invalid request is accepted.
2. **Write the property rule (TODO-01).** In `IsValidAsync`, get `IUserRepository` from the context, call it with the token and return a `ValidationResult` on the `Email` member.
3. **Write the object rule (TODO-02).** In `Order.ValidateAsync`, yield a result on `End` when it is before `Start`.

**How you know you are done**

`dotnet test` is green, and you can say why a malformed email makes no repository call, why `Quantity = 0` hides the `End` error and why the sync methods that throw are never reached.

**Optional challenges**

- **TODO-03:** pass `CancellationToken.None` in the attribute and see which test fails.
- **TODO-04:** write to the console in `IsValid` and `Validate` and confirm they are never called.

**Prerequisites:** Minimal APIs, data annotations, `async`/`await` and the .NET 11 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The starter compiles and the tests for the TODOs fail until you complete them.

## Documentation Links

- [What's new in ASP.NET Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-11.0) (doc)
- [Validation in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding#validation-support-in-minimal-apis) (doc)
- [AsyncValidationAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.dataannotations.asyncvalidationattribute) (doc)
- [Handle errors in ASP.NET Core APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/error-handling-api) (doc)
