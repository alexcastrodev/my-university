---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Two NuGet features turn dependency handling from a per-project habit into a
repository policy. Central Package Management (CPM) moves every package version
into one `Directory.Packages.props`, so ten projects cannot drift to ten
versions of the same library. Package Source Mapping (PSM) declares, in
`nuget.config`, which feed is allowed to supply which package IDs, which closes
the door on dependency confusion attacks where a public package with the same
name as your internal one wins the restore. This concept shows how both work,
the exact errors you will meet, and where each one stops protecting you.

## Use Cases

- A solution with many projects where `Newtonsoft.Json` or `Serilog` keeps
  ending up at different versions.
- Patching a vulnerable transitive package once for the whole repository.
- Adding a build-only analyzer or versioning package to every project.
- Using a private feed for `Contoso.*` packages next to nuget.org without
  letting nuget.org answer for them.
- Auditing which feed each package in a solution may come from.

## Deep Dive

### Central Package Management

Create `Directory.Packages.props` at the repository root, turn the feature on,
and declare versions as `PackageVersion` items. Projects then use
`PackageReference` without a `Version`:

```xml
<!-- Directory.Packages.props -->
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Microsoft.Extensions.Logging" Version="9.0.0" />
    <PackageVersion Include="Newtonsoft.Json" Version="13.0.3" />
  </ItemGroup>
</Project>

<!-- app.csproj -->
<PackageReference Include="Newtonsoft.Json" />
```

MSBuild imports only the nearest `Directory.Packages.props` for a project, so a
nested one must import its parent explicitly with `GetPathOfFileAbove`. The two
mistakes people make first are caught at restore. Writing a version in the
project:

```text
error NU1008: The following PackageReference items cannot define a value for Version:
Newtonsoft.Json. Projects using Central Package Management must define a Version
value on a PackageVersion item.
```

And referencing a package nobody declared:

```text
error NU1010: The following PackageReference items do not define a corresponding
PackageVersion item: Serilog.
```

Both came from a real restore of a throwaway repository on SDK 10.0.100. The
escape hatch for a deliberate exception is `VersionOverride` on the reference,
which wins over the central version:

```xml
<PackageReference Include="Newtonsoft.Json" VersionOverride="12.0.3" />
```

My restore with that override worked, and still printed the `NU1903` audit
warning for 12.0.3, so overrides do not escape NuGetAudit. Setting
`CentralPackageVersionOverrideEnabled` to `false` makes overrides an error.

`GlobalPackageReference` items in the same file add a package to every project
as a development dependency (assets limited to build-time, `PrivateAssets=All`),
which suits versioning tools and analyzers.

### Transitive pinning

The restore rule from the previous concept says the closest reference wins.
CPM can promote a transitive package to a top-level one for you: set
`CentralPackageTransitivePinningEnabled` and declare a `PackageVersion` for the
transitive package, without any project referencing it. In my test,
`Microsoft.Extensions.Logging` 9.0.0 normally brings `Primitives` 9.0.0:

```xml
<PackageVersion Include="Microsoft.Extensions.Logging" Version="9.0.0" />
<PackageVersion Include="Microsoft.Extensions.Primitives" Version="10.0.0" />
```

```text
$ dotnet package list --project app/app.csproj --include-transitive
   > Microsoft.Extensions.Logging    9.0.0   9.0.0
   > Microsoft.Extensions.Primitives         10.0.0   <- pinned, transitive
```

Pinning can only go up: pinning below what a dependency asks for raises
`NU1109`. And if the project is itself packed, the pinned packages become
explicit dependencies in the `.nuspec`, so a library author may ship
dependencies nobody expected. That is the main reason to be careful with this
switch in libraries.

### Package Source Mapping

By default NuGet searches every configured source, and when the same ID exists
on two feeds the winner is not something you chose. Dependency confusion
exploits exactly that: an attacker publishes your internal package name with a
higher version on the public feed. I reproduced it with two local folder feeds
(one standing for the internal feed, one standing for the public one, so nothing
public was involved). `Contoso.Internal` 1.0.0 in the first, 9.9.9 in the
second, and a floating reference:

```xml
<PackageReference Include="Contoso.Internal" Version="*" />
```

```text
> Contoso.Internal      *           9.9.9      <- came from the "public" feed
```

Adding a mapping to `nuget.config` fixes the source per ID:

```xml
<packageSourceMapping>
  <packageSource key="internal">
    <package pattern="Contoso.*" />
  </packageSource>
  <packageSource key="public-sim">
    <package pattern="*" />
  </packageSource>
</packageSourceMapping>
```

```text
> Contoso.Internal      *           1.0.0
```

Patterns are either an exact ID or a prefix ending in `*`. When several match,
the exact ID beats a prefix, a longer prefix beats a shorter one, and `*` is the
weakest, which makes it a convenient default source. The key point: once any
mapping exists, every package, transitive ones included, must match a pattern,
or restore refuses to look anywhere:

```text
error NU1100: Unable to resolve 'Newtonsoft.Json (>= 13.0.3)' for 'net10.0'.
PackageSourceMapping is enabled, the following source(s) were not considered:
internal, nuget.org.
```

### Where the protection stops

Mappings are applied when NuGet downloads. If the package is already in the
global packages folder, no source lookup happens and the mapping is ignored. My
first run of the unmapped `Newtonsoft.Json` project restored fine because that
version was already in my packages folder; the `NU1100` above appeared only
after I pointed `NUGET_PACKAGES` at an empty folder. The NuGet docs recommend a
repository-local global packages folder when you want the full guarantee. Also
note that the docs say mapping does not yet filter metadata commands such as
`dotnet list package --outdated`, which still query every configured source.

In my run, changing `nuget.config` and restoring again reported "up to date"
and kept the old resolution until I used `restore --force`, so force a restore
after editing mappings.

### CPM and mapping together

With CPM, NuGet warns (`NU1507`) when more than one package source is
configured and no mapping is defined, which is the docs' nudge to adopt both
together. The warning text is documented; I did not reproduce it with a
local-folder source, so treat the exact trigger as the docs describe it.

## Trade-offs

- **One central version means one upgrade moves everything.** A bump for one
  project is a bump for all, and a bad release breaks every consumer at once.
  ```xml
  <PackageReference Include="Newtonsoft.Json" VersionOverride="12.0.3" /> <!-- the escape hatch -->
  ```
- **`VersionOverride` quietly rebuilds the drift CPM removed.** Review them, or
  disable them with `CentralPackageVersionOverrideEnabled=false`.
- **Transitive pinning makes libraries carry extra dependencies.** The pinned
  package is written into the `.nuspec` when you pack.
- **Source mapping needs maintenance.** Every new package prefix, including
  transitive ones, needs a pattern, otherwise a developer hits `NU1100` on a
  routine upgrade. A `*` default on the public feed trades some strictness for
  fewer surprises.
- **A warm packages cache bypasses the mapping.** CI should restore into a
  clean, repository-local packages folder to actually test the configuration.
  ```text
  NUGET_PACKAGES=./.nuget/packages dotnet restore
  ```
- **Mapping is not a substitute for reserving your prefix.** If your internal
  prefix is not reserved on the public feed, someone else can still publish it
  there, and a `*` default pointing at that feed would trust it.

## Lab

In this lab you write the files that turn dependency handling into repository policy: a `Directory.Packages.props` that centralizes versions, projects that reference packages without a version, and a `nuget.config` with package source mapping. You receive the `PackageFiles` and `SourceMapping` classes with methods that throw `NotImplementedException`; each one returns the text of a file, and at the end you apply the source mapping resolution rule yourself. The core idea is to see that the version stops living in the `.csproj` and that each package can only come from the source the mapping allows.

**The scenario**

The problem is keeping versions consistent across many projects and preventing an internal package from being pulled from a public feed.

- `src/CentralPackageManagementLab/PackageFiles.cs`: generates `Directory.Packages.props`, the `.csproj`, the nested version, the props with `GlobalPackageReference` and (optionally) the transitive pinning one.
- `src/CentralPackageManagementLab/SourceMapping.cs`: generates the `nuget.config` and applies the pattern matching rule.

The MSBuild files are evaluated with `dotnet msbuild <project> -getItem:... -getProperty:...`, with no restore and no network. Source mapping is only resolved by NuGet at restore time and cannot be evaluated offline, so the tests parse the XML and use your `SourceMapping.Resolve`.

**What you will do, step by step**

1. **Turn CPM on (TODO-00).** In `DirectoryPackagesProps`, set `ManagePackageVersionsCentrally` to `true` and declare one `PackageVersion Include Version` per dictionary entry.
2. **Reference without a version (TODO-01).** In `ProjectFile`, generate a `Microsoft.NET.Sdk` `net10.0` project with one `PackageReference` per id and no `Version` attribute. For the ids in `versionOverrides`, use `VersionOverride`.
3. **Nested props (TODO-02).** In `NestedDirectoryPackagesProps`, import the parent file with `GetPathOfFileAbove` (MSBuild only imports the nearest one) and add your own `PackageVersion` items.
4. **Global packages (TODO-03).** In `GlobalPackagesProps`, add `GlobalPackageReference` on top of what already exists. Those packages reach every project as build-only dependencies.
5. **Write the nuget.config (TODO-04).** In `NuGetConfig`, start with `<clear />`, list `<add key value />` under `packageSources` and generate a `<packageSource key>` with `<package pattern>` for each mapping.
6. **Apply the rule (TODO-05).** In `Resolve`, return the allowed source for an id: an exact id beats a prefix, a longer prefix beats a shorter one, `*` is the weakest, and with no match the result is null. Ids compare case-insensitively.

**How you know you are done**

`dotnet test` is green. You should be able to explain why `Contoso.Core` matches an exact id before `Contoso.Cor*`, and why the `.csproj` no longer holds any version.

**Optional challenges**

- **TODO-06:** `TransitivePinningProps` turns on `CentralPackageTransitivePinningEnabled`, so packages that only appear transitively are pinned too.
- **TODO-07:** `Unmapped` lists the ids that no pattern matches. Think about why, once any mapping exists, restore fails with `NU1100` for them.

**Prerequisites:** `PackageReference` and basic MSBuild items and properties, NuGet sources and `nuget.config`, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The tests only need the .NET 10 SDK, no network. Each method throws `NotImplementedException` with a `TODO-NN` comment explaining the expected text, so the red tests are your checklist.

## Documentation Links

- [Central Package Management, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/central-package-management) (doc)
- [Package Source Mapping, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/package-source-mapping) (doc)
- [Security best practices for NuGet feeds, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/security-best-practices) (doc)
- [nuget.config file reference, packageSourceMapping, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/reference/nuget-config-file) (doc)
- [NU1507 warning reference, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/reference/errors-and-warnings/nu1507) (doc)
