---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

.NET 10 is the successor to .NET 9 and a long-term support (LTS) release,
supported for three years. This concept is a map, not a tutorial: it lists what
Microsoft's "What's new in .NET 10" pages say changed in the runtime, the SDK
and the libraries, in a few lines each, and points to the concept in this
track or in C# Concepts that explains the mechanism. Read it to decide what to
study next. ASP.NET Core, EF Core and C# 14 have their own "what's new" pages
and are only pointed to here. Every item below was checked against the official
pages for the runtime, the SDK and the libraries.

## Use Cases

- Planning an upgrade from .NET 8 or 9 and deciding which changes affect your code.
- Finding the deep concept behind a headline feature without reading release notes.
- Telling apart what is on by default (SDK behavior) from what you must opt into.
- Onboarding a team that last used .NET Framework or an older LTS.

## Deep Dive

### Support and versions

.NET 10 is an LTS release with three years of support. Which target to choose
for a new project, and how the support calendar works, is in the concept
"The .NET Support Lifecycle and Choosing a Target"
(`dotnet-support-lifecycle-and-choosing-a-target`). The language that ships with
it is C# 14: field-backed properties, `extension` blocks, null-conditional
assignment and more. The versions-and-preview mechanics live in
`csharp-language-versions-and-preview-features`, and two of the headline
features have their own concepts: `properties-init-accessors-and-the-field-keyword`
and `extension-members-and-extension-blocks`.

### Runtime and JIT

The runtime page lists JIT work on struct arguments (promoted members can share
a register), loop inversion based on a graph analysis, array interface method
devirtualization, a new block layout heuristic and better inlining. Stack
allocation grows to small arrays of value types and of reference types, and
escape analysis now covers local struct fields and delegates. On Arm64 the new
write-barrier default improves GC pauses; the page cites 8% to over 20%. AVX10.2
intrinsics exist but JIT support is disabled by default, because capable
hardware was not yet available. NativeAOT also gets small preinitializer
improvements. To read how source becomes machine code, see
`roslyn-il-and-the-jit`. For why "structs on the stack, classes on the heap"
is only a rule of thumb, see `value-types-reference-types-and-boxing`.

### SDK and CLI

- **File-based apps** gain publish support, the `#:project` directive, runtime
  path access and better shebang handling. They target Native AOT by default,
  and `#:property PublishAot=false` turns that off. Deep dive:
  `file-based-apps`; the AOT side is in `native-aot-and-its-limits`.
- **One-shot tools.** `dotnet tool exec` runs a tool without installing it, and
  `dnx` is a script that forwards to it. Tools can also ship per-RID packages,
  including the `any` RID for a portable fallback.
- **Noun-first commands.** `dotnet package add` and `dotnet reference add`
  join the old verb-first forms, which still work.
- **Introspection and shells.** `--cli-schema` prints the command tree as JSON,
  and `dotnet completions script` emits native completion scripts for bash,
  fish, nushell, PowerShell and zsh. CLI commands are also interactive by
  default in interactive terminals.
- **Package pruning.** NuGet Audit can prune framework-provided package
  references for projects targeting .NET 10 or later, which cuts restore work
  and shrinks `deps.json` files. See `nuget-restore-versions-and-dependency-resolution`
  and `assemblies-frameworks-and-the-host-resolver`.
- **Containers and tests.** Console apps can create container images with
  `dotnet publish /t:PublishContainer`, `ContainerImageFormat` selects Docker
  or OCI, and `dotnet test` supports Microsoft.Testing.Platform through
  `global.json`. The testing track starts at `testing-clean-architecture-with-mstest`.
- **MSBuild tasks.** `msbuild.exe` and Visual Studio 2026 can run tasks built
  for .NET. Project files are covered in
  `sdk-style-projects-msbuild-and-directory-build-props`.

### Libraries

- **Numeric string ordering.** `CompareOptions.NumericOrdering` makes "2" sort
  before "10". Deep dive: `strings-comparison-culture-and-ordering`.
- **System.Text.Json.** `AllowDuplicateProperties`, the `JsonSerializerOptions.Strict`
  preset, `PipeReader` overloads for deserialization and `ReferenceHandler` in
  `JsonSourceGenerationOptions`. See `system-text-json-serialization-and-options`
  and `system-text-json-source-generation-and-utf8jsonreader`.
- **Async ZIP.** `ZipArchive.CreateAsync`, `ZipFile.OpenReadAsync` and related
  methods avoid blocking threads on archive I/O. Background on streams and
  pipelines: `async-io-and-system-io-pipelines`.
- **Also listed** by the libraries page: post-quantum cryptography (ML-DSA,
  Composite ML-DSA), AES KeyWrap with Padding, `WebSocketStream`, TLS 1.3 for
  macOS clients, new `ActivitySource` and `Meter` options, Tensor APIs and
  Windows process groups. No concept here covers them yet.

### Other areas

Aspire, ASP.NET Core, EF Core, Windows Forms, WPF and MAUI each have their own
page. The overview names named query filters as an EF Core 10 feature; they are
explained in `global-and-named-query-filters`, and JSON columns in
`json-columns-and-complex-types`.

## Trade-offs

- **LTS is a policy, not a reason.** Moving from 8 to 10 gets you three years
  of support, but each item above still needs a test. Measure your own
  workload before attributing speed to JIT gains.
- **Defaults change behavior.** A file-based app targets Native AOT, so a
  package that needs reflection can fail at `dotnet run`. The fix is one
  `#:property` line, but you must know the default exists.
- **Pruning can surprise.** Smaller `deps.json` files are good, yet a script
  that looked for a framework package in the old file may now find nothing.
- **A map hides depth.** Each bullet here is a headline. The Microsoft pages
  are the source of truth and keep being edited; this page records what they
  said when it was written.

## Documentation Links

- [What's new in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/overview) (doc)
- [What's new in the .NET 10 runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/runtime) (doc)
- [What's new in the SDK and tooling for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/sdk) (doc)
- [What's new in the .NET 10 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
- [.NET support policy, Microsoft](https://dotnet.microsoft.com/platform/support/policy/dotnet-core) (doc)
