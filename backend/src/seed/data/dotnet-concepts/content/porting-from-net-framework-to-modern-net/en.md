---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

A large share of the .NET code running in production is still .NET Framework 4.x:
Windows-only, project files in the old format, packages in `packages.config`.
Porting it to modern .NET is mostly mechanical for libraries and console apps,
and expensive only where the app depends on something that no longer exists.
This concept lists what is gone and, more usefully, how loudly each gap fails:
at compile time, as a warning, or only at run time. It then covers the bridge
(`netstandard2.0`, multi-targeting, the NU1701 fallback), the order in which to
port, and the current status of the official tooling. The experiments ran on SDK
10.0.100 on macOS, building `net48` against reference assemblies; `net48` code
itself cannot run on this machine, so every runtime result below is from .NET 10.

## Use Cases

- Estimating a legacy port by finding the dependencies that will hurt first.
- Moving shared libraries to a target that both the old and the new app can use.
- Deciding between an in-place port and an incremental (strangler) migration.
- Reviewing a port that "builds on my machine" for gaps that only fail at run
  time on Linux or in a container.

## Deep Dive

### What is gone, and how loudly it fails

The official list of unavailable technologies is short: creating app domains,
Remoting, code access security, security transparency, `System.EnterpriseServices`
and Windows Workflow Foundation. WCF server is the notable exception with an
answer, the CoreWCF packages. One library multi-targeted to both worlds shows
how differently these gaps surface:

```xml
<TargetFrameworks>net48;net10.0</TargetFrameworks>
<!-- net48 only: <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" /> -->
```

```csharp
#if NETFRAMEWORK
    var d = AppDomain.CreateDomain("sandbox");   // fine on net48
#else
    AppDomain.CreateDomain("sandbox");           // same call on net10.0
#endif
```

```text
warning SYSLIB0024: 'AppDomain.CreateDomain(string)' is obsolete: 'Creating and unloading AppDomains is not supported and throws an exception.'   (net10.0 only)
PlatformNotSupportedException: Secondary AppDomains are not supported on this platform.   (at run time)
```

The API still exists on .NET 10 so the code compiles; the signal is a warning.
Delegate `BeginInvoke` is quieter: `f.BeginInvoke(null, null)` compiled without a
warning and threw `PlatformNotSupportedException: Operation is not supported on
this platform.` Remoting is the loud case, because its types are really absent:
`using System.Runtime.Remoting.Channels;` fails with `error CS0234: The type or
namespace name 'Channels' does not exist`. The documented replacements are
separate processes or containers for isolation, `AssemblyLoadContext` for
loading assemblies dynamically (see the host resolver concept), pipes or gRPC
and HTTP for communication.

### Quiet differences: present, but opt-in

Some things are not gone, they just moved out of the shared framework:

```csharp
Encoding.GetEncoding(1252);   // NotSupportedException: No data is available for encoding 1252.
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
Encoding.GetEncoding(1252);   // ok
```

`ConfigurationManager` and `app.config` work after adding the
`System.Configuration.ConfigurationManager` package: with a plain `app.config`
next to the project, the build copied it to `cfg.dll.config` and
`ConfigurationManager.AppSettings["Region"]` returned `eu-west`. Without the
package the compile fails with `CS0103` on the name. Both fixes are cheap, but
nothing tells you in advance, which is why a port needs a checklist and tests,
not only a green build.

### Platform APIs: a warning is not a guarantee

Platform-specific APIs are meant to be flagged by the platform compatibility
analyzer, CA1416, which is on by default for projects targeting `net5.0` or
later. It reads `[SupportedOSPlatform]` annotations: a method I annotated with
`windows` produced `warning CA1416: This call site is reachable on all
platforms`. But the analyzer is only as good as the annotations of what you
call. On macOS with the project targeting `net10.0`:

```text
new Bitmap(10, 10)                       // System.Drawing.Common 10.0.13, no CA1416 warning
  -> TypeInitializationException, inner DllNotFoundException: Unable to load shared library 'gdiplus.dll'
Registry.CurrentUser                     // no CA1416 warning either
  -> null, so OpenSubKey(...) throws NullReferenceException
Console.SetWindowSize(80, 25)
  -> PlatformNotSupportedException
```

The documented fix is a guard such as `OperatingSystem.IsWindows()` around the
call, or marking your own method `[SupportedOSPlatform("windows")]` so the
requirement propagates to callers. If the app stays on Windows, the Windows
Compatibility Pack (`Microsoft.Windows.Compatibility`) brings back registry,
WMI, event log, services and more; the documentation counts about 20,000 APIs.
For anything that must run on Linux, test on Linux.

### Dependencies and the bridge

A package that only ships a `net48` assembly can still be consumed through the
.NET Framework compatibility mode, at a price. I packed a `net48`-only library
and referenced it from a `net10.0` app:

```text
warn : NU1701: Package 'OldLib 1.0.0' was restored using '.NETFramework,Version=v4.6.1, ... v4.8.1' instead of the project target framework 'net10.0'. This package may not be fully compatible with your project.
hello from a net48 package        <- trivial code ran fine
```

The warning is the point: it repeats on every build so someone tests that path,
and it can be suppressed per package with `NoWarn="NU1701"` once verified. The
bridge for your own libraries is `netstandard2.0`, the last .NET Standard
version that .NET Framework supports, or multi-targeting as above. Be aware that
the bridge hides gaps: a `netstandard2.0` library calling
`AppDomain.CreateDomain` built with zero warnings and failed with the same
`PlatformNotSupportedException` when a `net10.0` app called it. Targeting the
standard guarantees that the API exists, not that it works.

### Order, phases and tooling

The documented preparation is all doable while still on .NET Framework: target
at least 4.7.2, move `packages.config` to `PackageReference`, convert projects
to the SDK style and update dependencies. Then port bottom up. For a dependency
tree the ASP.NET guide says to upgrade libraries in postorder depth-first
order, so leaf libraries move first and multi-target until every consumer has
moved. Pick the final target from the support lifecycle concept; the porting
page I read still suggests targeting .NET 8, so check dates before copying a
recommended version.

For ASP.NET apps with heavy `System.Web` use, the guide recommends incremental
migration, an implementation of the Strangler Fig pattern, over an in-place
rewrite. Windows Forms and WPF are available on modern .NET but stay Windows-only.

On tooling, check the status before you plan around it. As of the pages
fetched for this concept, .NET Upgrade Assistant is officially deprecated in
favor of the GitHub Copilot modernization agent, and `try-convert` is not
recommended for projects with custom build tasks, targets or imports. I did not
run any of these tools here, so treat them as options to evaluate, not as
verified steps.

## Trade-offs

- **`netstandard2.0` maximizes reach and hides gaps.** One assembly serves both
  runtimes, but APIs present in the standard can throw on .NET 10.
  ```csharp
  AppDomain.CreateDomain("x");   // compiles for netstandard2.0, throws on net10.0
  ```
- **Compatibility mode unblocks, then bites later.** `NU1701` packages run until
  they touch something Windows-only or removed; suppress the warning only after
  a test exercised the package.
- **The Windows Compatibility Pack keeps you on Windows.** It removes the
  porting hurdle, but the code you keep is not portable to Linux containers.
- **Incremental migration costs duplicated infrastructure.** Sessions,
  authentication and logging must work in both apps for a while; in exchange
  production never stops.
- **A clean build proves little.** Compile-time signals are partial (a warning,
  no warning, or an error); budget for run-time tests on the target OS.

## Documentation Links

- [Upgrade .NET apps overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/) (doc)
- [Port from .NET Framework to .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/framework-overview) (doc)
- [.NET Framework technologies unavailable on .NET 6+, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/net-framework-tech-unavailable) (doc)
- [Analyze dependencies to port code, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/third-party-deps) (doc)
- [Platform compatibility analyzer, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/analyzers/platform-compat-analyzer) (doc)
- [Use the Windows Compatibility Pack to port code, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/windows-compat-pack) (doc)
- [Migrate from ASP.NET Framework to ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/migration/fx-to-core/) (doc)
