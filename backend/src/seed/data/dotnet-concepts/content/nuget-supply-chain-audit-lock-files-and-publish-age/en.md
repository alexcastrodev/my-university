---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Every `PackageReference` is code from a stranger that runs on your build agent
and in production. NuGet has several defenses against that, and each one answers
a different question: is this version known to be vulnerable (`NuGetAudit`), is
this the same content I restored last time (the lock file and its hashes), did it
come from the feed I intended (Package Source Mapping), and is it brand new, so
nobody has had time to notice a malicious release (the minimum publish age that
arrived with the .NET 11 SDK). This concept puts them side by side: what each
one stops, what it does not, the exact warnings and errors I got from the .NET
11.0.100 SDK, and how to combine them without breaking every build. Restore
basics and lock file mechanics are in the restore concept, and Central Package
Management and source mapping have their own concept; this one is the
defense-in-depth view and the new age setting.

## Use Cases

- Failing a CI job when a package in the graph, direct or transitive, has a known high or critical advisory.
- Making a restore on a build agent fail if a package's content differs from what a developer restored.
- Waiting a few days before the automatic tools adopt a freshly published version.
- Deciding which defense answers which incident: a CVE, a hijacked version, a name collision, a poisoned release.

## Deep Dive

### What each defense stops

| Defense | Stops | Does not stop |
|---|---|---|
| `NuGetAudit` | adopting or keeping a version with a published advisory | a malicious version nobody has reported yet |
| Lock file, `--locked-mode` | a version or content that changed since the last restore | the first restore, before the file exists |
| Package Source Mapping | a package ID coming from the wrong feed | a bad package on the right feed |
| Minimum publish age | automatic selection of a version that is too new | a package you pinned by hand, or one already in the graph |

No row covers the whole risk, which is why you layer them. The same table is a
reading guide for the sections below.

### NuGetAudit: modes, levels and where the data comes from

Audit runs during restore and downloads the vulnerability data from nuget.org
(the restore log shows requests to `api.nuget.org/v3/vulnerabilities/index.json`).
Everything below is .NET SDK 11.0.100 with a `net11.0` project referencing
`Microsoft.EntityFrameworkCore` 8.0.0, which depends on
`Microsoft.Extensions.Caching.Memory` 8.0.0. With no audit settings at all:

```text
warning NU1903: Package 'Microsoft.Extensions.Caching.Memory' 8.0.0 has a known high severity vulnerability,
https://github.com/advisories/GHSA-qj66-m88j-hmgj
```

The package is transitive, and the warning appeared by default: for a project
that targets a recent framework `NuGetAuditMode` is `all`. Changing it:

| Setting | Result on this project |
|---|---|
| none | `NU1903` |
| `<NuGetAuditMode>direct</NuGetAuditMode>` | no warning (the package is transitive) |
| `<NuGetAuditLevel>critical</NuGetAuditLevel>` | no warning (the advisory is high) |
| `<NuGetAudit>false</NuGetAudit>` | no warning |
| `WarningsAsErrors` with `NU1901;NU1902;NU1903;NU1904` | `error NU1903: Warning As Error: ...` and the restore fails |

The four codes follow severity: `NU1901` low, `NU1902` moderate, `NU1903` high,
`NU1904` critical. `direct` is a blind spot by design, so use `all` in CI. To
see the whole picture, `dotnet list package --vulnerable --include-transitive`
printed `Transitive Package ... Microsoft.Extensions.Caching.Memory 8.0.0 High`
with the advisory URL, and `dotnet nuget why app.csproj Microsoft.Extensions.Caching.Memory`
printed the path `Microsoft.EntityFrameworkCore@8.0.0 > Microsoft.Extensions.Caching.Memory@8.0.0`,
which tells you who to upgrade.

To accept an advisory you cannot fix yet, suppress that one URL. It is an
**item**: `<NuGetAuditSuppress Include="https://github.com/advisories/GHSA-qj66-m88j-hmgj" />`
silenced the warning, while the same URL written as a property
(`<NuGetAuditSuppress>...</NuGetAuditSuppress>`) did nothing and the warning
stayed. A suppression is a debt: add a comment with the reason and a date.

### Fixing a vulnerable transitive package

Upgrading the parent is best, but it is not always possible. Central Package
Management can raise the transitive package for you (the previous concept covers
the mechanics). With `CentralPackageTransitivePinningEnabled` and
`<PackageVersion Include="Microsoft.Extensions.Caching.Memory" Version="8.0.1" />`
in `Directory.Packages.props`, the restore was clean and `dotnet package list --include-transitive`
showed `Microsoft.Extensions.Caching.Memory 8.0.1`. In the lock file the entry
became `"type": "CentralTransitive"` with `"requested": "[8.0.1, )"`, so the pin is
visible in review.

### The lock file and locked mode

`RestorePackagesWithLockFile` writes `packages.lock.json` with the resolved
version and a `contentHash` for every package, direct and transitive. In locked
mode (`dotnet restore --locked-mode`, or the property `RestoreLockedMode`; the
property form restored fine in my run) NuGet compares the lock file with what
the project asks for and what it downloads. I broke it two ways:

```text
# edited one contentHash and removed that package from the local cache
error NU1403: Package content hash validation failed for Microsoft.Extensions.Logging.8.0.0.
The package is different than the last restore.

# raised a central version without regenerating the lock file
error NU1004: Mistmatch between the requestedVersion of a lock file dependency marked as CentralTransitive
and the the version specified in the central package management file. ...
The packages lock file is inconsistent with the project dependencies so restore can't be run in locked mode.
```

The two errors mean different things. `NU1004` is drift: the project and the
lock disagree, usually a forgotten regenerate. `NU1403` is the one that matters
for supply chain: same ID and version, different bytes. I removed the package
from my local cache so that restore had to download it again and compare; I did
not test what happens when the package is already in the cache. (The typos in `NU1004` are in the real message.) Commit the lock
file, review its diff like source, and let only a deliberate `dotnet restore`
without `--locked-mode` rewrite it.

### Signatures

nuget.org signs packages. `dotnet nuget verify <file.nupkg> --all` on
`Newtonsoft.Json` 13.0.3 printed two signatures: `Signature type: Author`
(subject `Json.NET (.NET Foundation)`) and `Signature type: Repository`
(subject `NuGet.org Repository by Microsoft`), each with its certificate hash.
That tells you who signed and that the bytes were not altered after signing. It does
not tell you the code is safe. Enforcing signatures on restore is a separate
trust configuration that I did not test; see the security best practices page.

### Minimum publish age, new in the .NET 11 SDK

The newest idea is borrowed from other ecosystems: do not adopt a version
until it has been public for a while, so the community has time to spot a
malicious release. It needs NuGet 8.0 and the .NET SDK 11.0.100 (or Visual Studio
18.12), and it is opt-in. The setting is `minPublishAgeHours`, per source, in
`nuget.config`:

```xml
<packageSources>
  <clear />
  <add key="nuget.org" value="https://api.nuget.org/v3/index.json" minPublishAgeHours="72" />
</packageSources>
<minPublishAgeExceptions>
  <package pattern="Contoso.*" />
</minPublishAgeExceptions>
```

`dotnet nuget update source nuget.org --min-publish-age-hours 72` writes the
attribute (and `add source` takes the same option). Exceptions use the Package
Source Mapping pattern syntax and apply to every version and every source; an
empty `<minPublishAgeExceptions />` stops exceptions inherited from outer config
files.

To see it work on a real feed without waiting for a fresh release, I set a long
age, 15000 hours (about 625 days). On nuget.org `Newtonsoft.Json` 13.0.3 was
published on 2023-03-08 and 13.0.4 on 2025-09-16, so only 13.0.3 is old enough:

```text
$ dotnet package add Newtonsoft.Json
... PackageReference for package 'Newtonsoft.Json' version '13.0.3' added ...

$ dotnet package add Newtonsoft.Json --version 13.0.4      # explicit request
... version '13.0.4' added ...                              # bypasses the age

$ dotnet package update Newtonsoft.Json                    # from 12.0.1
Packages with newer versions that have not reached the configured minimum publish age: Newtonsoft.Json.
    Updating Newtonsoft.Json 12.0.1 to 13.0.3.
```

The newest stable version on nuget.org is 13.0.4, so the age changed the choice.
With `minPublishAgeExceptions` for `Newtonsoft.*`, the same update went to 13.0.4.
`dotnet package update --vulnerable` from 12.0.1 chose 13.0.1, the lowest
version without a known advisory. Per the NuGet docs the age still applies on
that path, so a brand new fix is not adopted automatically and you decide
whether to wait or ask for the version by name.

Three limits matter more than the feature:

- **Restore does not enforce it.** With the 13.0.4 reference above in the project, `dotnet restore` succeeded. The docs say the same for transitive packages and for a version you typed by hand: the age filters automatic choices only.
- **Floating versions are rejected.** A `Version="13.0.*"` reference with an age on the source failed restore: `error NU1020: The following PackageReference items cannot specify a floating version because package source cooldown is enabled: Newtonsoft.Json.` The exception for `Newtonsoft.*` made the same reference restore. The docs add that with Package Source Mapping only the sources mapped to the package are considered; I did not test that.
- **It depends on the publish date.** The docs say a source that does not return dates makes the command fail rather than guess, and that mirrors may report the copy date instead of the original date. Check your internal feed.

The docs also say each source is evaluated independently (a version that is old
enough on one source can be chosen even if another source holds it too young),
so pair this with source mapping.

### A restore change in .NET 11

One more change moves the same way. When the requested version does not exist,
restore used to pick the "next best" version from the sources and also from the
global packages folder. In .NET 11 it looks only at the sources
(NU1603 as a warning, or NU1102 when no source has a higher version), so two
machines with different caches pick the same version. I did not reproduce it; it
is from the breaking change page linked below. The practical advice is the same
as everywhere else here: reference versions that exist on your sources.

## Trade-offs

- **Audit as errors blocks releases you cannot fix yet.** A new advisory then
  breaks every build the same day. Keep warnings visible locally and make
  `NU1901` to `NU1904` errors in one job, with a suppression and a reason as the
  exit.
  ```xml
  <WarningsAsErrors>$(WarningsAsErrors);NU1903;NU1904</WarningsAsErrors>
  ```
- **`NuGetAuditMode` `direct` hides the usual culprit.** Most advisories sit in
  transitive packages, as the `Caching.Memory` example shows.
- **A lock file moves the work to review.** Every bump touches two files and
  `--locked-mode` fails until someone regenerates the lock. That friction is the
  point, but it needs an owner.
- **`NU1403` can also be a legitimate republish.** Treat it as "stop and look",
  not as "retry".
- **A publish age delays fixes too.** A fresh patch for a vulnerability waits
  with the rest. Use an explicit version after reading the release, which does not
  remove the age for other packages, instead of an exception, which does.
- **The age is a speed bump, not a verdict.** It needs the package to be noticed
  within your window, and it does not apply to restore. Do not rely on it for
  packages already in the graph.
- **Floating versions and an age do not mix.** Replace `1.2.*` with a fixed
  version plus a lock file.

## Lab

In this lab you get `SupplyChain` with **empty methods** (`NotImplementedException`). Your job is to write the project properties for audit and lock files, a `nuget.config` with a minimum publish age and source mapping, and the rules behind version choice, audit codes and locked restore. The core idea is that each defense is a small, checkable rule, and that the traps are in the details: an item that looks like a property, an empty section that must still be written, and two different errors for two different kinds of drift.

**The scenario**

Nothing downloads a package. The tests write your project text to a temp folder and let `dotnet msbuild -getProperty -getItem` evaluate it (no restore, no network), parse your `nuget.config` as XML, and run the pure rules on in-memory data.

- `ProjectFile`: audit and lock file settings.
- `NuGetConfig`: sources, age, exceptions and mapping.
- `PickLatest`, `CheckFloating`: the age rules.
- `Audit`: advisories to warning codes.
- `VerifyLock`: locked restore checks.

**What you will do, step by step**

1. **Write the project file (TODO-00).** `NuGetAuditMode`, `NuGetAuditLevel`, the lock file properties and `WarningsAsErrors` for `NU1901` to `NU1904`. The suppression is an item.
2. **Write the nuget.config (TODO-01).** `minPublishAgeHours` only on sources that have an age, the exceptions section always (even empty) and the source mapping.
3. **Choose a version with an age (TODO-02).** The highest stable version that has reached the age, boundary inclusive, compared numerically. Nothing eligible gives `null`.
4. **Reject floating versions (TODO-03).** `NU1020` when an age is set and the package is not excepted.
5. **Audit (TODO-04).** Match by ID and version, honor `direct` versus `all`, the minimum level and suppression, and map severity to `NU1901` to `NU1904`.
6. **Verify the lock (TODO-05).** `NU1004` when the dependency set or a version changed, `NU1403` when only a hash differs.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why `NuGetAuditSuppress` as a property does nothing, why restore does not enforce the age and which of `NU1004` and `NU1403` is the supply chain signal.

**Optional challenges**

- **TODO-06:** with the .NET 11 SDK, set `--min-publish-age-hours 15000` on nuget.org in a scratch folder and run `dotnet package add Newtonsoft.Json`. Which version is chosen, and which would be without the age?
- **TODO-07:** restore `Microsoft.EntityFrameworkCore` 8.0.0 with `NuGetAuditMode` `all` and then `direct`, then pin the vulnerable transitive package with Central Package Management and restore again.

**Prerequisites:** basic C# and LINQ, the idea of `PackageReference`, `nuget.config` and `packages.lock.json`, and the .NET 10 SDK. The optional challenges need the .NET 11 SDK and nuget.org.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The methods throw `NotImplementedException` and each `TODO-NN` is a comment, so the red tests are your checklist.

## Documentation Links

- [Minimum package publish age, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/minimum-package-publish-age) (doc)
- [Auditing packages for security vulnerabilities, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/auditing-packages) (doc)
- [Best practices for a secure software supply chain, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/concepts/security-best-practices) (doc)
- [Restore doesn't search the global packages folder for a higher package version, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/11/restore-global-packages-folder-version-search) (doc)
- [Package Source Mapping, Microsoft Learn](https://learn.microsoft.com/en-us/nuget/consume-packages/package-source-mapping) (doc)
- [dotnet nuget verify, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-nuget-verify) (doc)
