---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A .NET program is a folder of assemblies plus two small JSON files, and an
installed runtime elsewhere on the machine. When it starts, a native host reads
those files, picks a runtime, builds a list of trusted assemblies, and only then
does your `Main` run. Most "could not load file or assembly" errors, most
version-mismatch surprises and every plugin system come down to that chain. This
concept follows it with real files and real traces on SDK 10.0.100: the
assembly identity, the reference assembly the compiler saw versus the
implementation assembly the runtime loads, what `*.deps.json` and
`*.runtimeconfig.json` say, how the host finds the runtime, how type forwarding
lets a type move between assemblies, and how `AssemblyLoadContext` isolates
copies of the same assembly.

## Use Cases

- Diagnosing `FileNotFoundException: Could not load file or assembly 'X'` when
  `X.dll` is sitting in the output folder.
- Understanding why a library can keep compiling against `netstandard2.0` and
  still run on .NET 10.
- Moving a public type to another assembly without breaking consumers that were
  compiled against the old one.
- Loading plugins with their own dependency versions, and unloading them.
- Making a build machine or container find a runtime that is not in the default
  location.

## Deep Dive

### What an assembly is, and what it records

An assembly is a `.dll` (or `.exe`) holding IL plus metadata. Its identity is
four parts: simple name, version, culture and public key token (`App,
Version=1.0.0.0, Culture=neutral, PublicKeyToken=null`). The metadata also
lists every assembly it needs. A small console app that uses Humanizer, a
`netstandard2.0` library and LINQ recorded this (read with
`Assembly.GetReferencedAssemblies()`):

```text
-- what App.dll asks for:
   Humanizer 2.14.0.0
   Legacy 1.0.0.0
   System.Collections 10.0.0.0
   System.Console 10.0.0.0
   System.Linq 10.0.0.0
   System.Runtime 10.0.0.0
-- what Legacy.dll asks for:
   netstandard 2.0.0.0
```

Two things stand out. The compiler records only the assemblies whose types the
code actually used (a referenced project that is never touched does not appear).
And `object` is requested from `System.Runtime`, yet at run time
`typeof(object).Assembly.GetName().Name` printed `System.Private.CoreLib`.
Those two names are the next section.

### Reference assemblies versus implementation assemblies

The compiler does not compile against the runtime's files. It compiles against
the reference pack, `packs/Microsoft.NETCore.App.Ref/10.0.0/ref/net10.0/`, which
holds the public surface only. The runtime directory
`shared/Microsoft.NETCore.App/10.0.0/` holds the implementation. Sizes on this
machine:

| File | Reference pack | Runtime directory |
|---|---|---|
| `System.Runtime.dll` | 862,992 bytes (all the type definitions) | 45,328 bytes (forwarders) |
| `System.Collections.dll` | 55,600 bytes | 328,976 bytes |
| `System.Private.CoreLib.dll` | not present | 17,065,232 bytes |

`System.Runtime.dll` in the runtime directory is nearly empty: it forwards its
types to `System.Private.CoreLib`, where they really live. That indirection is
what lets the public contract stay stable while implementation assemblies are
rearranged between releases.

Your own projects get the same treatment. Building a project produces
`obj/Debug/net10.0/ref/Contracts.dll` next to the real one (the compiler is
invoked with `/out:` and `/refout:`), and a `ProjectReference` is compiled
against the reference copy. It carries `ReferenceAssemblyAttribute`, and private
members are stripped. Inspecting both files with `System.Reflection.Metadata`:

```text
net10.0/Contracts.dll   public Defaults: public Prefix; assembly Hidden; private Helper
ref/Contracts.dll       public Defaults: public Prefix
(with <InternalsVisibleTo Include="Contracts.Tests" />)
ref/Contracts.dll       public Defaults: public Prefix; assembly Hidden
```

`assembly` is the metadata name for `internal`. Internal members are kept in
the reference assembly only when `InternalsVisibleTo` exists, because someone
must be able to compile against them (Roslyn's reference assembly documentation
states the same rule). That is the mechanism behind the `internal` plus
`InternalsVisibleTo` pattern of the concept "Modular Monolith Module
Boundaries".

A practical consequence is incremental builds. Changing only a method body in
`Contracts` rebuilt `Contracts.dll`, but the reference assembly was identical,
and `App`'s `obj/.../App.dll` kept its timestamp. Changing a public signature
recompiled `App`. Reference assemblies are what make that decision cheap.

### deps.json: the application's manifest

`App.deps.json` lists every assembly the app uses and where each came from:

```json
"Humanizer.Core/2.14.1": {
  "runtime": { "lib/net6.0/Humanizer.dll": { "assemblyVersion": "2.14.0.0", "fileVersion": "2.14.1.48190" } }
},
"Legacy/1.0.0": { "runtime": { "Legacy.dll": { "assemblyVersion": "1.0.0.0" } } }
```

The `libraries` section marks each entry as `project` or `package` and carries
the package hash. The build copies Humanizer's `lib/net6.0/Humanizer.dll` into
the output folder: NuGet chose the best matching target for `net10.0` (the
selection rules are in the concept "NuGet Restore, Versions and Dependency
Resolution"). The host uses this file to decide what is part of the app.

That has a sharp edge. In an experiment, a library `LibA` moved its type into
`LibB`; the new `LibB.dll` was copied into the app folder next to `App.dll`, but
`App.deps.json` did not list it:

```text
Unhandled exception. System.IO.FileNotFoundException: Could not load file or assembly 'LibB, Version=1.0.0.0, ...'. The system cannot find the file specified.
```

The file was right there. Deleting `App.deps.json` made it work, because
without that file the host assumes the application directory contains all the
dependencies and uses its contents (the default-probing documentation describes
both cases). A copy in a subfolder was still not found.

### runtimeconfig.json and the host resolver

`App.runtimeconfig.json` declares the framework the app needs:

```json
{ "runtimeOptions": { "tfm": "net10.0",
    "framework": { "name": "Microsoft.NETCore.App", "version": "10.0.0" } } }
```

A web project built from `Microsoft.NET.Sdk.Web` has a `frameworks` array with
`Microsoft.NETCore.App` and `Microsoft.AspNetCore.App`: that is what the
`FrameworkReference` item in the SDK means (`-getItem:FrameworkReference`
printed one entry for a console app, two for the web app, and the worker
template has only the first). A framework is a named set of assemblies installed
once and shared, with its own `*.deps.json`.

The apphost (`./App`) and `dotnet App.dll` run the same resolver. With
`DOTNET_HOST_TRACE=1` (the older `COREHOST_TRACE=1` also worked here) the
sequence on this machine was:

```text
Looking for architecture-specific install_location file in '/etc/dotnet/install_location_arm64'.
Found registered install location '/usr/local/share/dotnet'.
Reading fx resolver directory=[/usr/local/share/dotnet/host/fxr]
Considering fxr version=[8.0.22]...  [9.0.11]...  [10.0.0]...
Detected latest fxr version=[.../host/fxr/10.0.0]
App runtimeconfig.json from [.../App.dll]
Resolving FX directory, name 'Microsoft.NETCore.App' version '10.0.0'
'Roll forward' enabled with version_compatibility_range [minor]. Looking for the lowest release greater than or equal version to [10.0.0]
Found version [10.0.0]
```

The host picks the newest `hostfxr`, which then reads the runtimeconfig and
applies the roll-forward policy to the installed runtimes (the policies are
covered by "The .NET Support Lifecycle and Choosing a Target"). Where the dotnet
root comes from is the part to remember when a container or a CI image cannot
find .NET. The `You must install .NET` message lists the places searched, and
the experiments showed the order and the failure modes:

- `DOTNET_ROOT` pointing to a directory that does not exist is skipped with
  `Did not find [DOTNET_ROOT] directory [/nonexistent]`, and the registered
  install location is used instead.
- `DOTNET_ROOT` pointing at a directory that exists is used, even if it holds
  no runtime: the app then fails with `You must install .NET to run this
  application`, listing the application directory and `DOTNET_ROOT` as the
  places searched.
- A directory laid out as `host/` and `shared/Microsoft.NETCore.App/10.0.0/`
  (built here from symlinks) was accepted, and the trace printed `Using
  environment variable DOTNET_ROOT=[...] as runtime location`.
- `DOTNET_ROOT_ARM64` (the architecture-suffixed form) was recognized the same
  way.

After resolution the host passes the runtime a `TRUSTED_PLATFORM_ASSEMBLIES`
list built from the app's and the framework's deps files. The app had 177
entries; the four that came from the app folder were `App`, `Contracts`,
`Legacy` and `Humanizer`, and `netstandard.dll` resolved to the facade inside
the shared framework folder. That is how a `netstandard2.0` library runs on .NET
10: its `netstandard` reference is satisfied by a facade that forwards to the
real types.

### Type forwarding

The facade trick is available to your own libraries. A type that moves from
`LibA` to `LibB` can leave a forwarder behind:

```csharp
// LibA v2: no types, only this
[assembly: System.Runtime.CompilerServices.TypeForwardedTo(typeof(Shapes.Greeter))]
```

`App` was compiled once against `LibA` v1, where `Shapes.Greeter` lived. Its
metadata says "type `Greeter` in assembly `LibA`". After replacing `LibA.dll`
with v2 and adding `LibB.dll` (no recompile, no `deps.json`, see above), the
program printed `hi from LibB` and `type lives in: LibB`. If `LibB.dll` is
missing, the failure is the `FileNotFoundException` for `LibB` shown earlier,
not a missing type in `LibA`, because the forwarder points at it by name. This
is exactly how `System.Runtime` and `netstandard` work, and how libraries
refactor assemblies without a breaking change.

### AssemblyLoadContext: several copies in one process

By default every assembly goes into `AssemblyLoadContext.Default`, which
resolves using the trusted list above, so one name means one assembly. A custom
`AssemblyLoadContext` is a separate namespace for loaded assemblies. Loading the
same `Plugin.dll` file into two contexts, measured:

```text
Same Assembly object? False
Same Type object?     False
Contexts: plugin-a, plugin-b
Counter.Value in A = 42, in B = 0
Default context holds a third copy? True
Context A collected after Unload: True
```

Each context has its own static state, and `Plugin.Counter` from context A is
not the same `Type` as the one from B, so casting across them fails. That is
the price and the point: plugins can bring different versions of a dependency.
Collectible contexts (`isCollectible: true`) can be unloaded, but only when
nothing references them. The first try printed `collected: False` in a Debug
build because locals kept the context alive; moving the load and use into a
`[MethodImpl(MethodImplOptions.NoInlining)]` method fixed it. Last, the
`Resolving` event of the Default context fires when an assembly cannot be
found, which is the hook for custom probing. In the test it fired for
`Missing.Thing` before the exception was thrown.

Note that in the Default context the trusted list wins: per the
documentation, calling `LoadFromAssemblyPath` there for a name that is already
in `TRUSTED_PLATFORM_ASSEMBLIES` loads the trusted one, not your path.

## Trade-offs

- **A manifest makes startup exact and makes copying files unsafe.** With
  `deps.json`, only listed assemblies are visible; "just drop the DLL next to
  the exe" fails. Without it, everything in the folder is visible, including a
  stale file you forgot.
- **Reference assemblies make builds fast and hide the real implementation.**
  You compile against a contract, not against what runs. A member present in
  the implementation but missing from the reference does not compile, which is
  deliberate. Debuggers and decompilers need the implementation files.
- **Roll-forward is convenient and means the machine decides.**
  `Microsoft.NETCore.App` 10.0.0 in the runtimeconfig ran on whatever 10.x was
  installed. Self-contained publishing removes the question and the shared
  security patching.
  ```json
  "framework": { "name": "Microsoft.NETCore.App", "version": "10.0.0" }
  ```
- **`DOTNET_ROOT` is accepted as given.** A wrong but existing directory fails
  harder than a wrong missing one, which silently falls back. In containers,
  prefer the image's own layout over setting it.
- **Type forwarders are permanent.** Once consumers depend on the old assembly
  name, the forwarder has to stay, and the assembly it forwards to has to
  ship with it.
- **Custom load contexts isolate and double memory.** Two copies of a type are
  two types. Share only what must cross the boundary (an interface assembly
  loaded in the default context), the same idea as a contracts project.
- **Unloading is cooperative.** A single static reference, thread or event
  handler pointing into the context keeps it alive, and the failure is silent.

## Documentation Links

- [Default probing, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/default-probing) (doc)
- [Understanding System.Runtime.Loader.AssemblyLoadContext, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/understanding-assemblyloadcontext) (doc)
- [Managed assembly loading algorithm, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/dependency-loading/loading-managed) (doc)
- [Type forwarding in the common language runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/assembly/type-forwarding) (doc)
- [Reference assemblies, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/assembly/reference-assemblies) (doc)
- [Troubleshoot app launch failures, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-discovery/troubleshoot-app-launch) (doc)
- [Reference assemblies in Roslyn (refout), dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/features/refout.md) (doc)
