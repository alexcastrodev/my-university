---
version: 1.0
updatedAt: 2026-10-15
---
## Objective

Almost everything in the .NET toolchain is reachable from one executable,
`dotnet`. Most developers know five commands and copy the rest from blog posts.
This concept explains the shape of the CLI (driver, command, arguments,
options), the noun-first commands that .NET 10 added (`dotnet package add`,
`dotnet reference add`) including a bug seen on SDK 10.0.100, how `-p:` passes
MSBuild properties and where that breaks, how tools are installed, pinned in a
manifest and run without installing (`dotnet tool exec`, `dnx`), and what
`dotnet watch` hot reload really does. Everything was run on SDK 10.0.100 on
macOS; version claims come from the official SDK pages.

## Use Cases

- Writing CI scripts that stay readable and survive the next SDK.
- Pinning developer tools (`dotnet-ef`, formatters) per repository so every
  machine runs the same version.
- Running a one-off tool in a pipeline without leaving it installed.
- Iterating on code with `dotnet watch` instead of stop, build, run.

## Deep Dive

### Anatomy: driver, command, arguments, options

`dotnet` is a driver with two jobs: run a framework-dependent app
(`dotnet app.dll`) or execute an SDK command (`dotnet build`). Before running a
command the driver picks the SDK: the latest installed one, or the one that
`global.json` selects (see the support lifecycle concept). So `dotnet build`
behaves differently in two folders on the same machine. Everything after the
command is an argument (`dotnet publish app.csproj`) or an option
(`--output`). `dotnet <command> -h` always prints the real syntax for the
installed SDK, which is more reliable than a web page for a different version.

### Noun-first commands

.NET 10 added aliases so that package and reference commands start with the
noun: `dotnet package add|list|remove` for `dotnet add|list|remove package`,
and `dotnet reference add|list|remove` for the `reference` forms. The
documentation says the verb-first forms keep working and recommends the new
ones in scripts. On SDK 10.0.100 the help also lists `dotnet package search` and
`dotnet package update`; `package update` is documented as new in the .NET 10
SDK, and `package download` as 10.0.2xx and later, which is why it is absent
from the 10.0.100 help here:

```text
$ dotnet package add Humanizer.Core --version 2.14.1
$ dotnet package add Newtonsoft.Json              # resolves the latest: 13.0.4
$ dotnet package update
    Updating Humanizer.Core 2.14.1 to 3.0.10.     # a major version jump
$ dotnet package list --outdated
   > Newtonsoft.Json      13.0.3      13.0.3     13.0.4
```

Note that a bare `dotnet package update` moved a package from 2.x to 3.x. The
documentation says that without a version it finds "the highest version
available", so review the diff like any dependency change. `--vulnerable`
restricts it to packages with known advisories.

One thing did not work as documented. On SDK 10.0.100, `dotnet reference add
../lib/lib.csproj` failed with `Could not find project or directory ``.` (the
same for `dotnet reference remove`), while the verb-first `dotnet add reference`
and the noun-first form with an explicit project both worked:

```text
$ dotnet reference add ../lib/lib.csproj
Could not find project or directory ``.
$ dotnet reference add --project app.csproj ../lib/lib.csproj
Reference `..\lib\lib.csproj` added to the project.
$ dotnet reference list        # no --project needed here
../lib/lib.csproj
```

`dotnet package add` found the project in the current folder without
`--project`. I only reproduced this on 10.0.100; check a newer SDK before
assuming it still happens. It is a good reason to keep CI scripts on one pinned
SDK version.

For file-based apps the same commands take `--file`: `dotnet package add
Humanizer.Core@2.14.1 --file s.cs` inserted `#:package Humanizer.Core@2.14.1`
at the top of `s.cs`. It also wrote a UTF-8 BOM (bytes `ef bb bf`), which is
worth knowing because the documentation asks for no BOM in files that carry a
shebang.

### Setting properties with -p:

`-p:Name=Value` passes an MSBuild property to `build`, `run`, `publish`,
`test`. `dotnet build -p:Configuration=Release -p:Version=1.2.3
-getProperty:Version` printed `1.2.3`: the command line overrides the project
file, and `-getProperty` is the cheap way to check what MSBuild actually
evaluated. The book's example of overriding the target framework is where it
bites. `dotnet build -p:TargetFramework=net9.0` failed with `NETSDK1005: Assets
file ... doesn't have a target for 'net9.0'`, and so did `dotnet build -f
net9.0` on a project that only declares `net10.0`. The implicit restore did not
restore for `net9.0`; the working sequence was:

```text
$ dotnet restore -p:TargetFramework=net9.0
$ dotnet build --no-restore -p:TargetFramework=net9.0    # app -> bin/Debug/net9.0/app.dll
```

Treat a property override that changes the dependency graph as a two-step
operation, and put permanent choices in the project file or
`Directory.Build.props`.

### Tools: manifest, run, exec, dnx

A local tool lives in a manifest. `dotnet new tool-manifest` creates
`.config/dotnet-tools.json`; `dotnet tool install dotnetsay` adds an entry with
the resolved version (3.0.3 here), and `dotnet tool run dotnetsay` or
`dotnet dotnetsay` runs it. Commit the manifest and `dotnet tool restore`
reproduces the set on another machine; a global install (`-g`) is per user and
invisible to the repository.

.NET 10 added one-shot execution: `dotnet tool exec <package>[@version] --
<args>` downloads the package into the NuGet cache and runs it without
installing anything. After running it, `dotnet tool list` was empty. It prompts
before downloading, and in a non-interactive shell it refuses:

```text
$ echo y | dotnet tool exec dotnetsay@2.1.7 -- hello
Tool package download needs confirmation. Run in interactive mode or use the "--yes" command-line option to confirm.
$ dotnet tool exec --yes dotnetsay@2.1.7 -- hello      # runs
```

The reference page says `--yes` is available starting with .NET 11, yet it
worked and showed in the help of SDK 10.0.100; trust your installed help over
the page. `dnx` is a shell script next to `dotnet` that only runs
`dotnet dnx "$@"`, an alias for `tool exec`, so `dnx dotnetsay@2.1.7 --yes --
hi` is the short form. If a tool manifest is near the current folder, its pinned
version wins: with `dotnetsay` pinned to 2.1.7 in a manifest, `dotnet tool exec
--yes dotnetsay` produced the byte-identical output of `dotnetsay@2.1.7`
(and different output from the unpinned latest in a folder without a manifest).

### dotnet watch and hot reload

`dotnet watch` rebuilds and restarts when files change, and for supported edits
it applies the change to the running process instead. On a console app printing
`tick v1` every second, changing the literal to `"v2"` produced:

```text
dotnet watch ⌚ Files updated: ./Program.cs
dotnet watch 🔥 [watch (net10.0)] Hot reload succeeded.
tick v2
```

The loop never restarted. Edits the runtime cannot apply (the documentation
refers to "supported edits") fall back to a restart, which I did not exercise.

### Introspection and shells

`--cli-schema` prints a command's definition as JSON. `dotnet build
--cli-schema` listed 34 options, and `dotnet package add --cli-schema` showed
the `--file` option described above. On the bare `dotnet --cli-schema` this SDK
printed an unrelated "shell application 'zsh' is not supported" error, so use it
on a command. `dotnet completions script zsh` emits a native completion script
(bash, fish, nushell, powershell and zsh are documented). The documentation also
says commands are interactive by default in interactive terminals; pass
`--interactive false` in pipelines.

## Trade-offs

- **Noun-first reads better, verb-first is safer today.** Both work, but the
  10.0.100 `reference add` failure shows new surface area has new bugs.
  ```text
  dotnet add reference ../lib/lib.csproj    # worked where dotnet reference add failed
  ```
- **`-p:` is quick and easy to misuse.** It overrides the file silently, and
  anything that changes restore needs its own restore step.
- **`tool exec` trades reproducibility for convenience.** Without a manifest it
  takes the latest version at that moment; pin a version (`pkg@1.2.3`) or use a
  manifest in CI.
- **Hot reload hides restarts.** State changes that need a restart look fine
  until you restart; keep a fresh run in your test loop.
- **The CLI is the contract, the page is a copy.** Pages lag SDK bands (`--yes`,
  `package download`); `dotnet <command> -h` on the pinned SDK is the truth.

## Documentation Links

- [.NET CLI overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/) (doc)
- [What's new in the SDK and tooling for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/sdk) (doc)
- [dotnet tool exec, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-exec) (doc)
- [dotnet package update, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-update) (doc)
- [dotnet package download, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-package-download) (doc)
- [dotnet watch, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-watch) (doc)
- [.NET tools overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/global-tools) (doc)
