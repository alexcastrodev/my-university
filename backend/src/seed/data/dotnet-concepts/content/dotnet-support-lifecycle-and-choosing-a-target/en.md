---
version: 1.0
updatedAt: 2026-10-14
---
## Objective

Every .NET version has an expiry date, and the date is part of the engineering
decision, not a footnote. Picking a target framework decides how long you get
security patches, when you are forced to upgrade, and which SDK and container
images your build depends on. This concept explains the support policy (LTS,
STS, active and maintenance phases), the difference between the SDK that builds
your code and the runtime that runs it, how `global.json` pins the SDK, how the
host picks a runtime at startup, and how to choose a target in late 2026.

## Use Cases

- Deciding whether a new service should target `net10.0` or stay on the version
  the rest of the company uses.
- Pinning the SDK in a repository so every developer and the CI agent build with
  the same feature band.
- Explaining why an app compiled for `net8.0` still starts on a machine that has
  only newer runtimes, or why it refuses to.
- Choosing a container tag that receives patches automatically, or one that is
  reproducible byte for byte.
- Planning the migration of `net8.0` and `net9.0` services before their support
  ends.

## Deep Dive

### LTS, STS and the two support phases

A new major version ships every November. Releases alternate between two
tracks, and the only difference between them is how long Microsoft patches
them, not their quality:

- **LTS (Long Term Support)**: three years of free support and patches.
- **STS (Standard Term Support)**: two years (24 months).

Each release goes through an **active** phase, with functional and security
fixes, and then a **maintenance** phase, which is the final 6 months and
receives security fixes only. After that comes end of support: the app keeps
running, but no more fixes arrive.

Support also has a condition: you must be on the latest patch. Patches are
cumulative, ship roughly monthly (security ones on Patch Tuesday, the second
Tuesday of the month), and a machine on `10.0.0` while `10.0.13` exists is not
in a supported state.

State of the official support policy page in October 2026:

| Version | Type | Released | Phase | End of support |
|---|---|---|---|---|
| .NET 10 | LTS | November 11, 2025 | Active | November 14, 2028 |
| .NET 9 | STS | November 12, 2024 | Maintenance | November 10, 2026 |
| .NET 8 | LTS | November 14, 2023 | Maintenance | November 10, 2026 |

Notice that .NET 8 (LTS) and .NET 9 (STS) end on the same day. The 24 month
STS window makes the STS release expire together with the LTS before it, so
choosing an STS no longer means a much shorter life than the previous LTS. Dates
move when the policy changes, so read the policy page before a plan, not this
table.

### SDK versus runtime

The **runtime** (`Microsoft.NETCore.App`, plus shared frameworks such as
`Microsoft.AspNetCore.App`) runs applications. The **SDK** contains the
compilers, MSBuild, NuGet and the `dotnet` CLI commands, and it ships with a
runtime. They have different version schemes. The runtime uses
`major.minor.patch`. The SDK uses `major.minor.Fnn`, where `F` is the
**feature band** (100, 200, 300...) and `nn` the patch inside the band. A new
band can bring a newer MSBuild or NuGet; a patch inside the band cannot.

Both lists come from the CLI. Output from this machine:

```bash
$ dotnet --list-sdks
9.0.307 [/usr/local/share/dotnet/sdk]
10.0.100 [/usr/local/share/dotnet/sdk]

$ dotnet --list-runtimes
Microsoft.AspNetCore.App 9.0.11 [/usr/local/share/dotnet/shared/Microsoft.AspNetCore.App]
Microsoft.AspNetCore.App 10.0.0 [/usr/local/share/dotnet/shared/Microsoft.AspNetCore.App]
Microsoft.NETCore.App 8.0.22 [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
Microsoft.NETCore.App 9.0.11 [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
Microsoft.NETCore.App 10.0.0 [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
```

`dotnet sdk check` compares that list with the published releases and tells you
what is stale:

```text
.NET SDKs:
9.0.307       .NET 9.0 is going out of support soon.
10.0.100      Patch 10.0.113 is available.
```

An SDK can build every older target framework it knows, so the newest SDK
builds `net8.0` projects too. Targeting a framework that is already out of
support still compiles, with a warning:

```text
warning NETSDK1138: The target framework 'net7.0' is out of support and will not
receive security updates in the future.
```

### Pinning the SDK with global.json

Without `global.json`, every `dotnet` command uses the highest SDK installed. To
make builds reproducible, put a `global.json` at the repository root. The CLI
searches for it from the current directory upward, so subfolders inherit it.

```json
{
  "sdk": {
    "version": "9.0.300",
    "rollForward": "latestPatch"
  }
}
```

`rollForward` defines the acceptable range. These results were produced with
SDKs 9.0.307 and 10.0.100 installed:

| `version` | `rollForward` | `dotnet --version` |
|---|---|---|
| (no global.json) | | `10.0.100` |
| `9.0.300` | (none, default is `patch`) | `9.0.307` |
| `9.0.300` | `latestPatch` | `9.0.307` |
| `9.0.100` | `latestFeature` | `9.0.307` |
| `9.0.400` | `latestFeature` | fails, no 9.0.4xx or higher installed |
| `8.0.100` | `latestPatch` | fails, no 8.0.1xx installed |
| `8.0.100` | `latestMajor` | `10.0.100` |

A failure is loud and stops every SDK command with exit code 155. The .NET 10
SDK added an `errorMessage` property so the failure can say how to fix it:

```json
{
  "sdk": {
    "version": "9.0.400",
    "rollForward": "latestFeature",
    "errorMessage": "This repo needs a .NET 9 SDK from the 9.0.400 band or later. Run ./eng/install-sdk.sh."
  }
}
```

```text
  * You intended to execute a .NET SDK command:
      This repo needs a .NET 9 SDK from the 9.0.400 band or later. Run ./eng/install-sdk.sh.
```

`latestFeature` is a sensible default for teams: it guarantees a minimum band
and still accepts patches and newer bands of the same major version.

### How the host picks a runtime

`global.json` only chooses the SDK. At startup, the host reads the target in
`*.runtimeconfig.json` and applies a different roll-forward policy. The default
is `Minor`: use the latest patch of the requested `major.minor`, or a higher
minor if that one is missing, but never another major. Measured here with a
file-based app built for `net8.0`:

```csharp
#:property TargetFramework=net8.0
using System.Runtime.InteropServices;

Console.WriteLine("Built for:  net8.0");
Console.WriteLine($"Running on: {RuntimeInformation.FrameworkDescription}");
// dotnet run which-runtime.cs                           -> Running on: .NET 8.0.22
// DOTNET_ROLL_FORWARD=LatestMajor dotnet run which-runtime.cs -> Running on: .NET 10.0.0
```

The same program built for `net7.0` compiles (with `NETSDK1138`) but refuses to
start on this machine, because no 7.x runtime is installed and the default
policy does not cross majors:

```text
You must install or update .NET to run this application.
Framework: 'Microsoft.NETCore.App', version '7.0.0' (arm64)
The following frameworks were found:
  8.0.22 at [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
```

The policy can be set in the project (`<RollForward>`), in
`runtimeconfig.json`, with `DOTNET_ROLL_FORWARD` or with `--roll-forward`, the
last one winning. Crossing a major is a deliberate decision, because major
versions may contain breaking changes.

### Container images follow the same versions

The official images live at `mcr.microsoft.com/dotnet/{sdk,aspnet,runtime,runtime-deps}`.
The tag encodes the version and the variant: `aspnet:10.0` floats to the newest
10.0 patch, `aspnet:10.0.13` is fixed at one patch, and suffixes select the
distribution or a smaller variant (`10.0-noble`, `10.0-noble-chiseled`,
`10.0-alpine`). Build with `sdk:10.0` and run with `aspnet:10.0` or
`runtime:10.0`. A floating tag picks up security patches on rebuild; a fixed
tag or a digest is reproducible but only gets patches when someone bumps it.

### What to target in late 2026

- **New services and apps**: `net10.0`. It is the only version in active
  support and stays supported until November 2028.
- **Existing `net8.0` and `net9.0` code**: both leave support on November 10,
  2026. Move to `net10.0` now; staying means running without security fixes.
- **Libraries**: target the lowest version your consumers still run, or
  multi-target, and build them with the newest SDK.

## Trade-offs

- **LTS gives a long window but ages the platform.** You skip a year of
  runtime and library improvements to upgrade every two years instead of every
  year.
- **STS no longer costs much support time, but it forces a yearly rhythm.** With
  24 months, .NET 9 ended together with .NET 8; whoever adopted 9 still had to
  move to 10 on the same date.
- **`global.json` with `disable` or `latestPatch` makes builds reproducible and
  fragile.** A new teammate with a different band gets exit code 155 before
  anything compiles.
  ```json
  { "sdk": { "version": "10.0.100", "rollForward": "disable" } }
  ```
- **Forcing `LatestMajor` keeps an old app running on a new runtime, without
  testing.** It hides the need to retarget and can expose behavior changes of the
  new major in production.
- **Floating image tags patch automatically but change under you.** A rebuild on
  Monday can run a different patch than Friday's. Pinning a digest fixes that and
  moves the patching work to your pipeline (Dependabot or Renovate).

## Documentation Links

- [.NET and .NET Core official support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) (doc)
- [.NET releases, patches, and support, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/releases-and-support) (doc)
- [Select which .NET version to use, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/versions/selection) (doc)
- [global.json overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json) (doc)
- [.NET container images, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/docker/container-images) (doc)
