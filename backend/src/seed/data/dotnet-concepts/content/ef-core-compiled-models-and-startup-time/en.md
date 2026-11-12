---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Every `DbContext` type has a model: the entity types, properties, keys and relationships EF Core
builds by running `OnModelCreating`, the conventions and the data annotations. EF Core builds that
model once per context type and per process, at the first operation on the context, and caches it.
On a model with hundreds of entity types that first build is visible as startup time. A compiled
model moves that work to build time: `dotnet ef dbcontext optimize` writes C# code that creates the
model directly, and at runtime EF Core loads it instead of building it.

This lesson shows the command, what it generates and how EF Core finds it, what changed in EF Core
11, and a measurement I made with and without a compiled model on a 60-entity and a 300-entity
model. The measurement is the main point: the gain is real but limited to one phase of startup, so
you should measure your own application before you adopt it. Everything ran on SDK 11.0.100 with
`Microsoft.EntityFrameworkCore.Sqlite` 11.0.0 and the `dotnet-ef` 11.0.0 tool. Precompiled queries
are a separate, still experimental feature, and the lesson ends with what I saw when I tried them.

## Use Cases

- Cutting the first-use cost of a large model in a service that restarts often: serverless
  functions, scale-to-zero containers, short-lived CLI tools.
- Checking whether a slow application startup is caused by model building at all, before changing
  anything.
- Keeping a generated model in sync with the source: a test or a build step that fails when the
  model changed and the generated code did not.
- Preparing a context for Native AOT, which does not allow building the model at runtime.

## Deep Dive

### Generating the model

The tool needs to create your context at design time. I used an `IDesignTimeDbContextFactory<T>`.
The command needs the project to be restored, and the tool version must match the EF Core version:

```bash
dotnet ef dbcontext optimize --output-dir CompiledModels --namespace CompiledModelLab.CompiledModels
```

For a context with 60 small entities (each with an `Id`, three scalar properties and an optional
reference to the previous entity) it wrote 62 files: one `...EntityType.cs` per entity, plus
`LabContextModel.cs`, `LabContextModelBuilder.cs` and `LabContextAssemblyAttributes.cs`. With 300
entities it wrote 302. The command also accepts `--no-scaffold` (do not generate the model),
`--precompile-queries` and `--nativeaot`, both marked experimental in the tool output.

The generated `LabContextModel` is a `RuntimeModel` with a static `Instance` property. You can hand
it to EF Core explicitly:

```csharp
var options = new DbContextOptionsBuilder<LabContext>()
    .UseSqlite("Data Source=app.db")
    .UseModel(LabContextModel.Instance)
    .Options;
```

But there is a second path that surprised me. `LabContextAssemblyAttributes.cs` contains
`[assembly: DbContextModel(typeof(LabContext), typeof(LabContextModel), ProviderName = "Microsoft.EntityFrameworkCore.Sqlite")]`.
With that file in the project, EF Core used the compiled model even though I never called
`UseModel`: in my test the "plain" context loaded the model in about 1 ms and `OnModelCreating`
never ran. The tool message agrees: "it will be discovered automatically, but you can also call
`options.UseModel(...)`". When I deleted that one file, `OnModelCreating` ran again. This matters
in two ways. If you generate a model and forget about it, you are using it. And if you want a
"without compiled model" case to compare against, you have to remove the attribute file or measure
a build without it.

### What is measured: two phases, not one

The documentation defines startup time here as the time of the first operation on a `DbContext` type,
because creating the instance does not build the model. I split that first operation in two and
timed each phase with a `Stopwatch`: `db.Model` (builds or loads the model) and then the first
query (`db.Set<Entity01>().Count()`). Each run was a new process, Release build, SQLite file
database, Apple M4 Max, seven runs per mode, sorted. The first number of each pair is the plain
model, the second the compiled one (milliseconds):

```text
 60 entities   model  192-204  vs  23-26      first query 104-115  vs 118-129   sum 299-312  vs 141-153
300 entities   model  400-449  vs  25-38      first query 128-190  vs 149-169   sum 528-591  vs 175-200
```

Reading it:

- The model phase shrinks a lot and almost stops depending on size: 23 to 26 ms for 60 entities
  and 25 to 38 ms for 300, against 192 to 204 ms and 400 to 449 ms built at runtime. The build cost
  grew with the number of entity types, the load cost barely did.
- The first-query phase did not improve. It was about the same or slightly worse with the compiled
  model (118 to 129 ms against 104 to 115 ms at 60 entities). That phase is query compilation,
  opening the connection and JIT, and the model does not remove any of those.
- The sum still favors the compiled model here: about 150 ms against about 305 ms at 60 entities,
  and about 190 ms against about 560 ms at 300.

An earlier measurement on the release candidate, in a Debug build with the 60-entity model, showed the model
phase improving (107 to 123 ms against 269 to 289 ms) but the time to the first query not improving
(498 to 511 ms against 446 to 461 ms; I did not repeat it on the final release). So the result depends on the build configuration and on what
you count. That is the reason to measure the thing your users wait for, in the configuration you
ship, instead of trusting a number from a blog or from this page. These are one machine and seven
runs each, enough to show the direction, not a benchmark.

### What changed in EF Core 11

The generated code and the commands are the same ones from EF Core 10. The visible change is in
the MSBuild integration, and it comes from the EF Core 11 breaking changes page: the
`EFOptimizeContext` property, which used to switch on compiled model and precompiled query
generation during build or publish, was removed. Generation is now controlled by
`EFScaffoldModelStage` and `EFPrecompileQueriesStage`, each set to `build` or `publish`, and with
`PublishAot` set to `true` generation is enabled at publish without any extra property. I did not
run an MSBuild-integrated build, so this part is from the documentation. A related fix in the same
release: the Cosmos provider's default discriminator is named `Discriminator` in the model again
(it stays `$type` in the JSON document), because `$type` is not a valid C# identifier and produced
code that did not compile in compiled models.

### The model goes stale silently

A compiled model has no `OnModelCreating` to run, so nothing notices when the source changed. I
added a property `Notes` to one entity and ran with the old generated model. No build error, no
startup error: `db.Model` simply did not contain `Notes`, and the query `Where(e => e.Notes == "x")`
failed only when executed, with `InvalidOperationException: The LINQ expression 'DbSet<Entity01>() ...`
could not be translated. A write that sets `Notes` would not store it, since the property is not
mapped. The documentation says the same: the model "must be manually synchronized by regenerating it
any time the model definition or configuration change".

The practical defense is a test that compares the compiled model with the model EF Core would
build now. In the lab for this lesson, `IsStale` builds a sorted list of
`ClrTypeName(property,...)` for each model and compares them; a context that adds one more entity
is reported as stale. It reads the second model through `GetService<IDesignTimeModel>().Model`, so
it needs a context that does not use the compiled model. The other defense is to generate during
the build, with the MSBuild stages above, so the file cannot be older than the source.

### Limitations from the documentation

The documentation lists what a compiled model does not support: global query filters, lazy loading
and change-tracking proxies, value converters that reference private methods, custom
`IModelCacheKeyFactory` implementations, and the manual synchronization above. Because of these
limits it recommends compiled models only when startup is slow, and says compiling a small model is
typically not worth it. If your model uses query filters (soft delete, multi-tenancy), check that
first; I did not test the filter limitation myself.

### Precompiled queries are a different feature, and still experimental

`--precompile-queries` (with `--nativeaot`) analyzes the LINQ queries in your source and generates C#
interceptors that replace them with prebuilt SQL and materializers. The tool prints "Query
precompilation is an experimental feature and should be used with caution", and the Native AOT
documentation still calls it experimental in EF Core 11. What I saw confirms the caution:

- A query `Where(e => e.Amount > 5)` on a `decimal` property made precompilation fail with
  `ArgumentException: Argument types do not match`, because the integer literal does not match the
  decimal property. Writing `5m` fixed it.
- With the entity classes declared `sealed`, the generated interceptor file did not compile:
  `CS0030: Cannot convert type 'Entity01' to 'IInjectableService'`. Removing `sealed` made it build.
- Generated code needs `<InterceptorsNamespaces>$(InterceptorsNamespaces);Microsoft.EntityFrameworkCore.GeneratedInterceptors</InterceptorsNamespaces>`
  in the project, or the compiler rejects the interceptors with `CS9137`.

I built and ran the non-AOT project with that set (it returned `0` rows from an empty table); I did
not run a Native AOT publish. Precompiled queries and compiled models together are what Native AOT
needs, which is covered in the Native AOT lesson; outside AOT, do not adopt precompiled queries for a
startup gain without testing them against your own queries.

### Measuring in the lab

The lab for this lesson has a 60-entity context with the generated model already in the project. You
write the factory that opens the context with or without the model, the two-phase probe, and the
staleness check, and tests count how many times `OnModelCreating` runs. One detail the tests needed:
EF Core keeps the built model in its internal service provider, so a second context with the same
options never builds it again. The lab turns that cache off with `EnableServiceProviderCaching(false)`
so each context builds or loads its own model. Do not do that in production, it also rebuilds the
whole service provider every time.

## Trade-offs

- **The gain is one phase, not all of startup.** It removes the model build, which grows with the
  number of entity types. It does not remove query compilation, connection opening or JIT. A model of
  a few dozen entities may not justify it.
- **Silent staleness.** Forgetting to regenerate after a model change gives no error until a query or
  a write touches the difference. Add a test or generate during the build.
- **Automatic discovery.** The `[DbContextModel]` assembly attribute makes EF Core use the compiled
  model without `UseModel`. A stale file that nobody remembers keeps being used.
- **Feature limits.** Global query filters, lazy loading and proxies, and custom model cache keys do
  not work with it, according to the documentation.
- **Large generated diff.** One file per entity type. Commit it and review it, or generate it in the
  build and keep it out of source control, but then local debugging and the build must both generate it.
- **Precompiled queries are experimental.** Cases that fail to generate or to compile exist in GA 11.0.0,
  so treat them as a Native AOT tool, not as a general performance switch.

## Documentation Links

- [Compiled models, advanced performance topics, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/advanced-performance-topics#compiled-models) (doc)
- [Breaking changes in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/breaking-changes) (doc)
- [NativeAOT support and precompiled queries (experimental), EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/nativeaot-and-precompiled-queries) (doc)
- [dotnet ef dbcontext optimize, EF Core tools reference, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/cli/dotnet#dotnet-ef-dbcontext-optimize) (doc)
- [What's new in EF Core 11, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-11.0/whatsnew) (doc)
