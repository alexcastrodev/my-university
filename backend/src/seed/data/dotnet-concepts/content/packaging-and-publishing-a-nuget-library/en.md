---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Consuming packages is half of NuGet; the other half is producing one that other
teams can trust. A package is a zip with a manifest: `dotnet pack` builds your
project and writes the `.nuspec` from MSBuild properties, so the project file
is the single source of truth. This concept covers the properties that matter,
the SemVer rules that decide how consumers resolve your versions, symbols and
Source Link, how to test a package from a local feed before publishing, how
package validation catches accidental breaking changes, and what publishing to
nuget.org or a private feed actually means once the push has succeeded.

## Use Cases

- Sharing a domain library between several services without copying projects.
- Publishing an internal SDK to a private feed with prerelease builds from CI.
- Releasing an open source library to nuget.org with symbols and a readme.
- Catching a removed public method before the release, not after a consumer
  breaks.
- Verifying that a package restores and runs in a clean consumer project.

## Deep Dive

### From project file to package

Everything lives in the `.csproj`. This is the library used in all the
examples below, with the metadata a public package normally needs:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <PackageId>Contoso.Greeter</PackageId>
    <Version>1.2.0-beta.1</Version>
    <Authors>Contoso</Authors>
    <Description>Greets people.</Description>
    <PackageLicenseExpression>MIT</PackageLicenseExpression>
    <PackageReadmeFile>README.md</PackageReadmeFile>
    <PublishRepositoryUrl>true</PublishRepositoryUrl>
    <IncludeSymbols>true</IncludeSymbols>
    <SymbolPackageFormat>snupkg</SymbolPackageFormat>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
  </PropertyGroup>
  <ItemGroup>
    <None Include="README.md" Pack="true" PackagePath="\" />
  </ItemGroup>
</Project>
```

Running `dotnet pack -o feed` on this project (SDK 10.0.100) printed two
files, `Contoso.Greeter.1.2.0-beta.1.nupkg` and a `.snupkg`. The `.nupkg`
contained exactly:

```text
Contoso.Greeter.nuspec
lib/net10.0/Greeter.dll
lib/net10.0/Greeter.xml     <- from GenerateDocumentationFile
README.md                   <- only because of the explicit Pack="true" item
```

Two details bite beginners. The readme (and an icon or a license file) must be
declared twice: the property names the path inside the package, and a `None`
item with `Pack="true"` actually puts the file there. Also, `dotnet pack` uses
the `Release` configuration by default for projects targeting `net8.0` or
later, which is why the output above came from `bin/Release`. The `.snupkg`
held only `lib/net10.0/Greeter.pdb`, the portable PDB, because
`SymbolPackageFormat` was `snupkg`; the default format is the legacy
`symbols.nupkg`.

Pack runs an implicit build and restore. Use `--no-build` in CI when a previous
step already compiled the code. Projects that must never produce a package
(tests, tools, demo apps) opt out with `<IsPackable>false</IsPackable>`; in my
run `dotnet pack -p:IsPackable=false` printed nothing and created no file.
Project references are not bundled: if the library references another project,
that project must be packed too, and the `.nuspec` lists it as a dependency.

### Versions and SemVer

NuGet follows SemVer 2.0 for ordering. A stable `1.0.1` sorts above any
`1.0.1-*` prerelease, and dot-separated numeric parts compare numerically, so
`1.0.1-rc.10` is above `1.0.1-rc.2`, while a label like `alpha10` is compared
as text and sorts below `alpha2`. If you want numbers in a label without dots,
pad them (`beta05`). Build metadata after `+` is ignored when versions are
matched, and a zero fourth segment is dropped, so `1.0.0.0` and `1.0.0` are the
same version.

Which property wins is a common source of confusion. `PackageVersion` defaults
to `Version`. For CI, prefer `VersionPrefix` plus `VersionSuffix`, because
`dotnet pack --version-suffix ci-1234` only has an effect when you did not set
`Version`; if `Version` has a value the suffix is ignored.

```text
VersionPrefix 0.1.2 + --version-suffix rc.1  ->  0.1.2-rc.1
Version 1.2.0-beta.1 + --version-suffix rc.1 ->  1.2.0-beta.1 (suffix ignored)
```

A version is a promise: removing a public method is a major change. Once a
version reaches a feed, treat it as immutable. The next section shows how to
enforce this promise mechanically.

### Package validation

Set `EnablePackageValidation` and a baseline, and `pack` compares your new
assembly with the previously released one. I bumped the sample to `1.2.0`,
renamed `Hello` to `Hi`, and pointed the baseline at the beta in a local feed:

```xml
<EnablePackageValidation>true</EnablePackageValidation>
<PackageValidationBaselineVersion>1.2.0-beta.1</PackageValidationBaselineVersion>
```

The pack failed with:

```text
error CP0002: Member 'string Contoso.Greeter.Hello(string)' exists on [Baseline]
lib/net10.0/Greeter.dll but not on lib/net10.0/Greeter.dll
error : API breaking changes found. If those are intentional, the APICompat
suppression file can be updated by rebuilding with '/p:ApiCompatGenerateSuppressionFile=true'
```

The same feature also checks that a multi-targeted package exposes consistent
APIs for each target, which matters for the next concept. For source-level
traceability, set `PublishRepositoryUrl`. In a folder that was a git
repository with an `origin` remote, the `.nuspec` gained
`<repository type="git" url="..." branch="..." commit="..." />` with no extra
package installed. The commit lets a debugger or tool such as NuGet Package
Explorer map the DLL back to the source.

### Test the package before you publish

A library that compiles can still be a broken package: a missing file, a wrong
dependency group, a readme that did not get packed. Test the artifact, not the
project. Pack into a folder and consume it from a throwaway project whose
`nuget.config` clears every other source:

```xml
<configuration>
  <packageSources>
    <clear />
    <add key="local" value="../feed" />
  </packageSources>
</configuration>
```

With `<PackageReference Include="Contoso.Greeter" Version="1.2.0-beta.1" />` in
a console app, `dotnet run` printed `Hello, NuGet!`. A folder feed is a legal
NuGet source, and it keeps the experiment away from nuget.org. One side effect:
restore copies the package to the global packages folder, so if you republish
the same version locally while testing, restore may keep using the cached copy.
Bump the version or restore with `RestorePackagesPath` set to a scratch folder.

### Publishing

`dotnet nuget push file.nupkg --source <feed> --api-key <key>` works against
any feed that implements the protocol. For a folder it simply copies the file;
my run printed `Your package was pushed.`, and a second push of the same version
did the same, with `--skip-duplicate` reporting that it is not supported for
this type of push. A real feed behaves differently, so never rely on
overwriting.

For nuget.org, you need an API key. The docs recommend scoping it: a push-only
scope, restricted to a package glob, with an expiration date. Starting with
NuGet 7.6 (.NET SDK 10.0.300), the `NUGET_API_KEY` environment variable can replace
`--api-key`, which keeps the secret out of the command line in CI. After the
push the package is validated and indexed, usually in under 15 minutes, and
meanwhile it appears as unlisted. Ownership belongs to the account behind the
API key, not to the `Authors` field. Package signing is separate and optional
until you register a certificate on nuget.org; from that moment every
submission from that account must be signed, and self-issued certificates are
rejected.

## Trade-offs

- **Everything in the project file** keeps metadata next to the code, but
  repeated metadata across ten libraries belongs in `Directory.Build.props`
  (see the SDK-style project concept), not copied into ten projects.
- **Prerelease labels on every CI build** let consumers test early, but they
  also pollute the feed. Give them a retention policy, because consumers using
  floating prerelease ranges will pick them up.
- **Package validation** blocks accidental breaking changes, but it needs a
  baseline version published somewhere reachable and fails builds when you
  rename something on purpose; you then suppress with a file you must review.
- **Symbols as `snupkg`** give consumers step-into debugging, but nuget.org
  the feed has to host the symbol package too, and not every private feed does.
  Check before relying on it.
- **Immutable versions** protect consumers, but a bad release can only be
  fixed by a new version.

## Lab

In this lab you turn a library into a NuGet package by editing only the project file. You receive the `PackagingFiles` class with methods that throw `NotImplementedException`, and each one must return the text of a `.csproj` (and of a props file). The tests run `dotnet pack`, open the `.nupkg` as a zip and check the `.nuspec` and the file list. The core idea is to see that a package is just a zip with a manifest, and that every decision about metadata, version, `lib/`, `buildTransitive/` or dependencies shows up visibly inside it.

**The scenario**

The problem is packaging a `Contoso.Greeter` library with everything a consumer expects, without leaving the `.csproj`.

- `src/PackagingLab/PackagingFiles.cs`: the methods to implement. `ReadmeMarkdown` and `CoreProject()` (a second library, `Contoso.Core` 2.0.0, used by TODO-05) are already provided.
- `PackagingTests.cs` and `PackSandbox.cs`: write your text into a throwaway folder, run `dotnet pack -c Release -o out` and inspect the zip.

Everything is offline: the projects have no `PackageReference`, nothing is pushed to any feed, and the targets are `net10.0` and `netstandard2.1`, covered by the SDK reference packs. Notice that `PackageId` and `AssemblyName` differ on purpose: one names the package, the other names the DLL inside it.

**What you will do, step by step**

1. **Metadata and version (TODO-00).** In `LibraryProject`, fill in id, authors, description, license, URLs, tags and repository, and build `1.2.3-beta.4` from `VersionPrefix` and `VersionSuffix` (do not use `Version`). The `PackageId` must be `Contoso.Greeter` and the `AssemblyName` `Greeter`.
2. **Readme and symbols (TODO-01).** In `LibraryProjectWithReadmeAndSymbols`, declare the readme twice (the `PackageReadmeFile` property plus a `None` item with `Pack="true"`) and ask for a `.snupkg` with `IncludeSymbols` and `SymbolPackageFormat`.
3. **Do not pack (TODO-02).** In `NotPackableProject`, use `IsPackable` false and confirm that no package comes out.
4. **Multiple frameworks (TODO-03).** In `MultiTargetProject`, use `TargetFrameworks` (plural, semicolon separated) for `net10.0` and `netstandard2.1` and see two folders under `lib/`.
5. **buildTransitive (TODO-04).** Write `BuildTransitiveProps` (a `<Project>` without `Sdk` that sets `GreeterEnabled`) and `ProjectWithBuildTransitive`, which packs the file with `Pack="true"` and a `PackagePath` so it lands at `buildTransitive\Contoso.Greeter.props`.
6. **Dependency, not a bundled DLL (TODO-05).** In `DependentProject`, reference `Contoso.Core` through a `ProjectReference`. In the `.nuspec` it must become a dependency, and `Contoso.Core.dll` must not be copied into `lib/`.

**How you know you are done**

`dotnet test` is green (it takes 20 to 40 seconds, one `dotnet pack` per test). You should be able to explain what is inside your package by looking at `unzip -l out/*.nupkg` and `unzip -p out/*.nupkg '*.nuspec'`.

**Optional challenges**

- **TODO-06:** `ReproducibleProject` turns on `Deterministic`, `ContinuousIntegrationBuild`, `PublishRepositoryUrl` and `EmbedUntrackedSources`.
- **TODO-07:** `PackOnBuildProject` uses `GeneratePackageOnBuild` so a plain `dotnet build` also writes the `.nupkg`.

**Prerequisites:** basic `.csproj` structure (`PropertyGroup`, `ItemGroup`), the concept text on packaging and publishing a NuGet library, and the .NET 10 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. Each method starts by throwing `NotImplementedException` with a `TODO-NN` comment saying what the file must contain, so the red tests show what is left. Actually publishing (`dotnet nuget push`) is a manual follow-up and is never part of the tests.

## Documentation Links

- [dotnet pack command](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-pack)
- [NuGet pack and restore as MSBuild targets](https://learn.microsoft.com/en-us/nuget/reference/msbuild-targets)
- [NuGet package versioning](https://learn.microsoft.com/en-us/nuget/concepts/package-versioning)
- [Package validation overview](https://learn.microsoft.com/en-us/dotnet/fundamentals/apicompat/package-validation/overview)
- [Publish NuGet packages](https://learn.microsoft.com/en-us/nuget/nuget-org/publish-a-package)
- [Signing NuGet packages](https://learn.microsoft.com/en-us/nuget/create-packages/sign-a-package)
