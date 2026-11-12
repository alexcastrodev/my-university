---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

CQRS (Command Query Responsibility Segregation) means that the code that changes state (commands) and the code that reads it (queries) are separate types with separate rules. It does not require event sourcing, two databases, or a message bus: in most .NET applications it is just two kinds of request class and one handler per request. A mediator is the small piece that takes a request, finds its handler, and runs it through a pipeline of cross-cutting steps (validation, logging, a transaction). Vertical slices organize the code by feature instead of by technical layer, so everything one use case needs sits in one folder. The goal is to know what a library like MediatR actually does by writing the core yourself, how to put validation and transactions in a pipeline, how this combines with Minimal APIs, what the library situation is today after MediatR's license change, and when a mediator is the wrong tool.

## Use Cases

- A handler per use case, so a controller or route is three lines and the business logic is testable without HTTP.
- Cross-cutting rules applied to every command in one place: validate input, open a transaction, log timing.
- Reads that skip the domain model (a query returns a flat DTO straight from the database) while writes go through aggregates and invariants.
- A codebase where a new feature is a new folder, not an edit in four projects (see the layered layout in Clean Architecture in Four Projects).

## Deep Dive

### Commands and queries, with no event sourcing

A command expresses an intent that changes state and returns little (an id, a status). A query returns data and changes nothing. Keeping them as different types makes the rule visible and lets infrastructure treat them differently:

```csharp
public interface IRequest<TResponse>;
public interface ICommand<TResponse> : IRequest<TResponse>;
public interface IQuery<TResponse> : IRequest<TResponse>;

public sealed record PlaceOrder(string Sku, int Quantity) : ICommand<Guid>;
public sealed record GetOrder(Guid Id) : IQuery<OrderDto?>;
```

This is the whole of CQRS at the level most applications need. The same database, the same `DbContext` and the same transaction serve both sides. The expensive variants (a separate read store, projections built from events, eventual consistency between the two) are separate decisions with separate costs, and they are not implied by the pattern. Start with the cheap version and split the stores only when a measured read problem demands it.

### A mediator in about 40 lines

A mediator exposes one method, `Send`, and hides which class handles each request:

```csharp
public interface IRequestHandler<TRequest, TResponse> where TRequest : IRequest<TResponse>
{
    Task<TResponse> Handle(TRequest request, CancellationToken ct);
}

public interface IMediator
{
    Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken ct = default);
}
```

The only hard part is that `Send` receives the request as `IRequest<TResponse>`, but the container needs the closed type `IRequestHandler<PlaceOrder, Guid>`. The usual solution is a small generic wrapper created by reflection once per request type and cached:

```csharp
public sealed class Mediator(IServiceProvider services) : IMediator
{
    private static readonly ConcurrentDictionary<Type, object> Wrappers = new();

    public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken ct = default)
    {
        var wrapper = (RequestWrapper<TResponse>)Wrappers.GetOrAdd(request.GetType(), static t =>
            Activator.CreateInstance(typeof(RequestWrapper<,>).MakeGenericType(t, typeof(TResponse)))!);
        return wrapper.Handle(request, services, ct);
    }
}
```

`RequestWrapper<TRequest, TResponse>` then does `services.GetService<IRequestHandler<TRequest, TResponse>>()`, throws a clear `InvalidOperationException` when there is none, and calls it. Handlers are registered by scanning the assembly for types that implement `IRequestHandler<,>` and calling `AddScoped`. That is the entire dispatch mechanism. Everything else a library adds (notifications, streaming requests, generic requests, a license key check) sits on top of this idea.

### The pipeline: behaviors wrap the handler

A behavior receives the request and a `next` delegate that stands for "the rest of the pipeline", and decides whether and how to call it:

```csharp
public delegate Task<TResponse> RequestHandlerDelegate<TResponse>();

public interface IPipelineBehavior<TRequest, TResponse> where TRequest : IRequest<TResponse>
{
    Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken ct);
}
```

The wrapper builds the chain by folding the registered behaviors from the last to the first, so the first registered is the outermost:

```csharp
RequestHandlerDelegate<TResponse> pipeline = () => handler.Handle(typed, ct);
var behaviors = services.GetServices<IPipelineBehavior<TRequest, TResponse>>().ToArray();
for (var i = behaviors.Length - 1; i >= 0; i--)
{
    var behavior = behaviors[i];
    var next = pipeline;
    pipeline = () => behavior.Handle(typed, next, ct);
}
return pipeline();
```

Copying `pipeline` into `next` inside the loop matters: the lambda must capture a value that does not change on the next iteration. The container returns open-generic registrations in registration order, which is why `Program.cs` lists behaviors explicitly instead of scanning for them. Order is behavior.

### Three behaviors that earn their place

**Logging** wraps everything and is the simplest: log before, call `next()`, log after. **Validation** runs every `IValidator<TRequest>` registered for the request, collects all the errors (not just the first), and throws before the handler runs:

```csharp
var errors = validators.SelectMany(v => v.Validate(request)).ToList();
if (errors.Count > 0) throw new ValidationException(errors);
return next();
```

**Transaction** opens a unit of work, runs the rest, commits on success and rolls back on any exception, rethrowing the original one:

```csharp
public sealed class TransactionBehavior<TRequest, TResponse>(IUnitOfWork uow)
    : IPipelineBehavior<TRequest, TResponse> where TRequest : ICommand<TResponse>
```

The `where TRequest : ICommand<TResponse>` constraint is the whole trick for "commands only". When the open generic `TransactionBehavior<,>` is registered for `IPipelineBehavior<,>`, the container only produces it for closed types that satisfy the constraint, so a query never opens a transaction. This was run in the lab: a query through the same pipeline leaves the unit of work with no calls. Putting validation before the transaction means an invalid request never opens one. With EF Core, the unit of work is usually `SaveChangesAsync` plus an explicit transaction only when a use case needs more than one save (see Transactions and Optimistic Concurrency in EF Core).

Validation here throws an exception because a behavior cannot return a different `TResponse` without knowing it. The alternative is a result type, which the behavior can build only when `TResponse` is itself a result (see Result Types versus Exceptions). The route (or one exception handler, see ProblemDetails and Global Exception Handling) translates the exception to a `400`.

### Vertical slices with Minimal APIs

A slice groups what one use case needs: the request, its validator, its handler, and its route.

```text
Features/
  Orders/
    PlaceOrder.cs       -> record, validator, handler
    GetOrder.cs         -> record, DTO, handler
    OrdersEndpoints.cs  -> MapGroup("/orders") and the routes
```

The route does only HTTP: bind the body, send the request, translate the outcome:

```csharp
group.MapPost("/", async (PlaceOrderRequest body, IMediator mediator, CancellationToken ct) =>
{
    try
    {
        var id = await mediator.Send(new PlaceOrder(body.Sku, body.Quantity), ct);
        return Results.Created($"/orders/{id}", new OrderDto(id, body.Sku.Trim(), body.Quantity));
    }
    catch (ValidationException e)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["order"] = [.. e.Errors] });
    }
});
```

The HTTP request record (`PlaceOrderRequest`) is separate from the command on purpose, so the wire contract and the internal use case can change independently (see DTOs and the API Contract). Slices do not forbid shared code: a slice that needs the `Order` entity uses it from a shared place. What changes is the default direction. Features own their code and extract shared pieces when two of them really need the same thing, instead of starting from layers that every feature must cross. A slice may use EF Core directly in its handler, without a repository, because the slice is the boundary. That is a real simplification for CRUD-heavy features and a real risk when business rules start repeating across handlers: at that point the rule moves into the domain model.

How this relates to the larger structures: layers (see Clean Architecture in Four Projects) organize by technical role, slices by feature, and modules (see Modular Monolith: Drawing Module Boundaries and From CRUD to Modular Monolith) draw boundaries between business areas. They combine: a module can be organized as slices inside, and a mediator inside a module must not become the way modules call each other, because that hides the contract the module is supposed to publish (see Module Communication and Architecture Tests).

### The library situation today

Checked on 2026-11-12:

- **MediatR** (Jimmy Bogard, now Lucky Penny Software). Version 12.5.0 on NuGet is `Apache-2.0`. From 13.0.0 on, the package ships a `LICENSE.md` file instead of an SPDX expression, and the official site says that versions 13.0.0 and later need a license key, while earlier versions remain under their original open-source licenses. NuGet's latest is 15.0.0. The site describes a free Community tier (self-service registration, unlimited developers) with conditions: under 5 million USD annual gross revenue, no more than 10 million USD of outside capital, not a government entity, and not a university using it for institutional software. Paid tiers (Standard, Professional, Enterprise) are priced by team size. The repository's `LICENSE.md` points to the Reciprocal Public License 1.5, or to a commercial license agreement for those who do not want to release their own source. There is no license server: a missing or invalid key produces warnings or errors in logs, according to the site. Read the current terms before adopting or upgrading, because they are the part that changes.
- **Mediator** by Martin Othamar (`Mediator.SourceGenerator` on NuGet, 3.0.2 stable at the time of writing): the repository states an MIT license and describes a MediatR-like API generated at compile time, with `ValueTask` returns and Native AOT support. Pipeline behaviors use the same `IPipelineBehavior` idea, but they are not registered automatically: you list them in options.
- **Wolverine** (`WolverineFx` on NuGet, 6.64.0 at the time of writing, MIT on its NuGet package and its docs): a larger messaging and web framework that can also act as an in-memory command bus. It is a different scale of commitment, with its own handler conventions and middleware, not a drop-in replacement.
- **Your own mediator**: the 40 lines above, plus the behaviors you actually use. For many applications this is a legitimate answer, and the lab shows how little it takes. What you give up is maintenance of edge cases (notifications, streaming, generic requests) that you may never need.

Moving between libraries is cheap when handlers depend only on `Handle(request, ct)` and the interfaces are the only coupling, which is another argument for keeping handlers free of library types beyond the interface.

### When not to use a mediator

- **A handful of endpoints that call a service.** `IOrderService.PlaceAsync` already is a handler. A mediator adds a request type, a handler type and an indirection for no behavior you use.
- **No cross-cutting behavior.** The strongest reason for a pipeline is applying the same steps to every use case. Without one, `Send` is a more expensive method call.
- **Navigation gets worse.** "Go to definition" on `Send(new PlaceOrder(...))` lands on the interface, not on the handler. Tooling and conventions (one file per slice) soften this but do not remove it.
- **Handlers calling handlers.** If a handler sends another request to reuse logic, you built a hidden call graph. Extract a plain class or a domain method instead.
- **Cross-module calls.** Use an explicit contract between modules, not a shared mediator that lets anyone send anything.
- **Dependencies you can inject.** Behaviors can be done by endpoint filters (see Parameter Binding and Endpoint Filters) for HTTP-only concerns, or by a decorator registered on one interface.

## Trade-offs

- **Indirection for uniformity.** The mediator makes every use case look the same and lets one pipeline serve all of them, but a reader can no longer follow a call by clicking through it. The cost is paid by every maintainer; the benefit only appears if the pipeline is really used.
  ```csharp
  var id = await mediator.Send(new PlaceOrder(sku, qty), ct); // which class runs? search for IRequestHandler<PlaceOrder, Guid>
  ```
- **Behaviors hide control flow.** A transaction or validation applied by registration order is invisible in the handler. Wrong order (transaction outside validation) opens transactions for invalid input. Keep the order in one place and test it.
- **Exceptions or results from a behavior.** Throwing keeps `TResponse` simple but makes expected failures exceptional. Returning a result type keeps them in the signature but forces every response into one shape.
- **One handler per request multiplies files.** Slices keep them together, but a project with hundreds of tiny handlers needs a naming convention and good search. It is also easy to put real rules in handlers instead of the domain model, which leaves slices as transaction scripts.
- **CQRS without a split store is still one consistency model.** That is its strength (no eventual consistency to explain) and its limit (reads are as slow as the write database lets them be). Splitting stores is a larger decision and should follow a measured need.
- **A third-party mediator is a license and upgrade dependency.** The MediatR change shows that a tiny library at the center of every request can carry commercial terms. A hand-written mediator or a source-generated one removes that risk at the cost of owning or choosing the code.
- **Reflection and AOT.** The simple scanning and `MakeGenericType` shown here are fine on the JIT, but trimming and Native AOT need the generated approach (see Source Generators and AOT-Friendly Code).

## Lab

In this lab you get an orders API with the dispatch plumbing already done (finding the right wrapper per request type and scanning handlers), and you write the parts that make a mediator useful: the pipeline composition, a validation behavior, a transaction behavior that applies only to commands, and the route that ties it to HTTP. Everything runs in a single test project with no database; the unit of work is a fake that records calls.

**The scenario**

`PlaceOrder` is a command (`ICommand<Guid>`) with a validator and a handler; `GetOrder` is a query. `Program.cs` registers `LoggingBehavior`, `ValidationBehavior` and `TransactionBehavior` in that order, so logging wraps validation, which wraps the transaction.

**What you will do, step by step**

1. **Compose the pipeline (TODO-00).** In `Mediator.cs`, wrap the handler with every registered `IPipelineBehavior<TRequest, TResponse>`. The first registered behavior must be the outermost, so fold the list from the end. A test registers two behaviors and asserts the order `outer>`, `inner>`, `handler`, `<inner`, `<outer`.
2. **Validate (TODO-01).** In `ValidationBehavior`, run all validators, collect every error, throw `ValidationException` when there is any, and never call the handler in that case.
3. **Commit or roll back (TODO-02).** In `TransactionBehavior`, begin, run `next()`, commit and return; on an exception roll back, never commit, and rethrow the original exception.
4. **Translate to HTTP (TODO-03).** In `OrdersEndpoints`, make `POST /orders` send `PlaceOrder`, answer `201` with a `Location` and an `OrderDto`, or `400` with the validation errors.

**How you know you are done**

`dotnet test` is green. You should be able to explain why `TransactionBehavior` does not run for `GetOrder` even though it is registered for every request, and what changes if you swap validation and transaction in `Program.cs`.

**Optional challenges**

- **TODO-04:** add `CancelOrder` as a second command in its own file. What did you touch outside the slice?
- **TODO-05:** call a handler directly in a test, without the mediator. What did the mediator add and what did it cost?
- **TODO-06:** swap the order of `ValidationBehavior` and `TransactionBehavior`. What changes for an invalid request?

**Prerequisites:** C# generics and interfaces, Minimal APIs, dependency injection with open generic registrations and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. In the starter state the tests fail with `NotImplementedException` carrying the TODO number.

## Documentation Links

- [MediatR license and pricing, MediatR.io](https://mediatr.io/) (doc)
- [MediatR on NuGet](https://www.nuget.org/packages/MediatR) (doc)
- [MediatR source and LICENSE.md, GitHub](https://github.com/jbogard/MediatR) (doc)
- [Mediator (source generator), GitHub](https://github.com/martinothamar/Mediator) (doc)
- [Wolverine documentation](https://wolverinefx.net/) (doc)
- [Dependency injection in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) (doc)
- [Minimal APIs overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview) (doc)
- [CQRS pattern, Microsoft Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) (doc)
- [Vertical Slice Architecture, Jimmy Bogard](https://www.jimmybogard.com/vertical-slice-architecture/) (doc)
