---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

`dotnet restore` turns the `PackageReference` lines in your project into a
flat, resolved graph of exact package versions, and writes the result to
`obj/project.assets.json`. Most "it worked yesterday" build breaks, surprise
upgrades and ignored security warnings come from not knowing how that graph is
decided. This concept covers the version notation, the resolution rules
(lowest applicable version, direct dependency wins, cousin dependencies),
floating versions and lock files for repeatable restores, and the tools that
tell you what is outdated, vulnerable or simply why a package is there.

## Use Cases

- Reading a `NU1605` downgrade error and knowing which direct reference fixes it.
- Deciding whether a dependency should be pinned, a range, or floating.
- Making CI restore exactly the same packages as a developer machine.
- Finding which package drags in a vulnerable transitive dependency.
- Understanding what changed in restore performance and audit defaults in .NET 9 and .NET 10.

## Deep Dive

### Version notation

A bare `Version="9.0.0"` is not an exact pin. It means "9.0.0 or higher", and
restore picks the lowest version that satisfies every constraint in the graph.
Brackets make it exact, and `*` floats:

```xml
<PackageReference Include="A" Version="6.1" />        <!-- >= 6.1, resolves to the lowest available -->
<PackageReference Include="A" Version="[6.1.0]" />    <!-- exactly 6.1.0 -->
<PackageReference Include="A" Version="[1.3.2,1.5)" /> <!-- 1.3.2 up to, not including, 1.5 -->
<PackageReference Include="A" Version="6.*" />        <!-- highest stable 6.x.y -->
```

Pre-release versions are only considered when the project or something in the
graph asks for one. Avoid upper bounds on packages you do not own: they block
consumers from taking fixes.

### The resolution rules

Restore applies four rules, in this spirit. The lowest applicable version wins
when nothing else says otherwise, so a package that asks for `>= 2.1` gets 2.2
if 2.1 is not on the feed. A floating version resolves to the highest match.
Cousin dependencies (the same package requested in different branches) resolve
to the lowest version that satisfies all requests. And the direct dependency
wins: a package you reference in your own project beats whatever the
transitive graph asked for, even if that means going down.

The last rule is where `NU1605` comes from. I referenced
`Microsoft.Extensions.Logging` 9.0.0, which needs
`Microsoft.Extensions.DependencyInjection.Abstractions >= 9.0.0`, and also
asked for 8.0.0 of the abstractions directly:

```text
error NU1605: Warning As Error: Detected package downgrade:
  Microsoft.Extensions.DependencyInjection.Abstractions from 9.0.0 to 8.0.0.
  a -> Microsoft.Extensions.Logging 9.0.0 -> Microsoft.Extensions.DependencyInjection 9.0.0
    -> Microsoft.Extensions.DependencyInjection.Abstractions (>= 9.0.0)
  a -> Microsoft.Extensions.DependencyInjection.Abstractions (>= 8.0.0)
Failed to restore a.csproj
```

Raising the direct reference to `10.0.0` fixes it, and the direct version is
the one that lands in the graph. Fixing it by raising, not by suppressing the
warning, matters: a downgrade means a package runs against a dependency older
than it was built for.

### Seeing the graph

Three commands answer most questions:

```text
$ dotnet list package --include-transitive
   Top-level Package                                         Requested   Resolved
   > Microsoft.Extensions.DependencyInjection.Abstractions   10.0.0      10.0.0
   > Microsoft.Extensions.Logging                            9.0.0       9.0.0
   Transitive Package                                        Resolved
   > Microsoft.Extensions.Logging.Abstractions               9.0.0
   > Microsoft.Extensions.Options                            9.0.0

$ dotnet nuget why a.csproj Microsoft.Extensions.Primitives
   └─ Microsoft.Extensions.Logging (v9.0.0)
      └─ Microsoft.Extensions.Options (v9.0.0)
         └─ Microsoft.Extensions.Primitives (v9.0.0)

$ dotnet list package --outdated
   > Newtonsoft.Json   12.0.1   12.0.1   13.0.4
```

`dotnet nuget why` shows the path from your project to a transitive package,
which is the first thing you need when a vulnerability is reported on
something you never referenced.

### Floating versions and lock files

A floating version such as `9.0.*` moves whenever a new patch ships, so two
restores on different days can differ. Setting `RestorePackagesWithLockFile` to
`true` writes `packages.lock.json` next to the project with every resolved
version and a content hash. My `9.0.*` reference pinned itself like this:

```json
"Microsoft.Extensions.Logging.Abstractions": {
  "type": "Direct",
  "requested": "[9.0.*, )",
  "resolved": "9.0.21",
  "contentHash": "y1yIJYal...",
  "dependencies": { "Microsoft.Extensions.DependencyInjection.Abstractions": "9.0.21" }
}
```

Commit the file. Subsequent restores reuse it, so floating becomes
reproducible. In CI, add `--locked-mode` (or `RestoreLockedMode`): restore then
fails if the lock file no longer matches the project, instead of rewriting it.
After I added another `PackageReference` without updating the lock file:

```text
error NU1004: The package references have changed for net10.0. ...
The packages lock file is inconsistent with the project dependencies so restore
can't be run in locked mode.
```

### Audit: vulnerabilities at restore time

`NuGetAudit` runs during restore and reports known advisories as warnings
`NU1901` to `NU1904` (low to critical severity). Restoring `Newtonsoft.Json`
12.0.1 produces:

```text
warning NU1903: Package 'Newtonsoft.Json' 12.0.1 has a known high severity vulnerability,
https://github.com/advisories/GHSA-5crp-9r3c-p9vr
```

`dotnet list package --vulnerable` prints the same findings as a report. Per
the NuGet auditing docs, `NuGetAuditMode` defaults to `all` (direct and
transitive packages) for projects targeting `net10.0` or higher, and to
`direct` otherwise. `NuGetAuditLevel` sets the minimum severity, and
`NuGetAuditSuppress` silences one advisory URL. Treating `NU1903;NU1904` as
errors in a dedicated pipeline is a common compromise, because a new advisory
should not break every build on a Friday.

### What changed in .NET 9 and .NET 10

NuGet 6.12, shipped in the .NET 9.0.100 SDK, replaced the dependency resolver
with a new algorithm for large graphs. The Microsoft write-up reports large
speedups on big repositories, and `RestoreUseLegacyDependencyResolver` reverts
to the old one. The same release added audit sources, so restore can read
vulnerability data from nuget.org without nuget.org being a package source.
The .NET 10 SDK (NuGet 7.0) changes the `NuGetAuditMode` default as described
above. If something regresses after an SDK upgrade, compare against the legacy
resolver before blaming your own graph.

## Trade-offs

- **Floating versions trade repeatability for freshness.** Without a lock file,
  `9.0.*` can produce a different build tomorrow.
  ```xml
  <PackageReference Include="A" Version="9.0.*" /> <!-- pair with RestorePackagesWithLockFile -->
  ```
- **Lock files add merge conflicts and a review step.** Every dependency bump
  now touches two files, and `--locked-mode` fails the build until someone
  regenerates the lock.
- **The direct dependency wins rule can hide an incompatibility.** Forcing a
  transitive package up is usually safe; forcing it down is what `NU1605`
  warns about.
- **Pinning a transitive package in your project is a debt.** Adding a direct
  reference to patch a vulnerability works today, and silently stays behind
  when the parent package later ships a newer version.
- **Audit as errors blocks releases for advisories you cannot fix yet.** Keep
  warnings visible locally and fail only in a dedicated audit job, with
  `NuGetAuditSuppress` as a last resort and a note on why.

## Documentation Links

- [NuGet package dependency resolution, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/dependency-resolution) (doc)
- [NuGet package version reference, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/package-versioning) (doc)
- [Auditing package dependencies for security vulnerabilities, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages) (doc)
- [Package references in project files, locking dependencies, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/package-references-in-project-files) (doc)
- [Rewriting NuGet Restore in .NET 9, .NET Blog](https://devblogs.microsoft.com/dotnet/rewriting-nuget-restore-in-dotnet-9/) (doc)
