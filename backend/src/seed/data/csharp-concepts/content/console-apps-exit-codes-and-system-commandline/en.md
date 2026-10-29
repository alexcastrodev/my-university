---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

A command-line program talks to its caller through arguments, the exit code,
stdout (data) and stderr (everything else). Scripts, CI and orchestrators read
only those, so a tool that exits 0 after a failure breaks them silently. This
concept shows, on .NET 10 / C# 14 under macOS, how `Main` returns codes, what
Unix does to codes outside 0..255, what a crash exits with, how to keep stdout
clean, how to handle Ctrl+C and SIGTERM, and how to build a CLI with
`System.CommandLine`. That package was beta for six years: NuGet shows 2.0.0
stable since 2025-11-11, 2.0.14 as current stable (2026-10-25) and 3.0.0 still
in prerelease (rc.3). The examples use 2.0.14, whose API differs from the beta4
one most blog posts show. The Spectre.Console.Cli README calls it "a modern
library for parsing command line arguments", and Cocona's README describes a
micro-framework where public methods become commands (neither tested here).

## Use Cases

- Tools that a script, a CI step or `make` can trust: right codes, clean stdout.
- A console worker in a container, where SIGTERM is the shutdown request.
- Replacing hand-written `args` parsing with typed options and `--help`.
- Diagnosing "the pipeline says success but nothing happened" (a lost code).

## Deep Dive

### Entry points, args and the `--` separator

`Main` returns `void`, `int`, `Task` or `Task<int>`, with or without
`string[] args`; a top-level program gets the `int` form once it contains
`return n;`. `args` never holds the program name, while
`Environment.GetCommandLineArgs()[0]` is the assembly path. Under `dotnet run`,
everything after `--` goes to the program; without it the SDK keeps the options
it recognizes:

```text
$ dotnet run -- args --verbose -c x
4: [args] [--verbose] [-c] [x]
$ dotnet run args -c Release
1: [args]                         // -c Release was taken by dotnet run
```

### Exit codes: Unix keeps one byte

Each case was run and read with `echo $?` in zsh:

```text
return 3     -> 3
return 256   -> 0       return -1  -> 255
return 300   -> 44      void Main with Environment.ExitCode = 1000 -> 232
Environment.ExitCode = 7, then return 0   -> 0   (the return value wins)
Environment.ExitCode = 7, then Exit(3)    -> 3
Environment.Exit(4) inside try/finally    -> 4, and the finally did not run
throw new InvalidOperationException(...)  -> 134  "Unhandled exception. System..."
Environment.FailFast("state corrupted")   -> 134  "Process terminated." + stack
```

The status is taken modulo 256, so a tool that returns "256 errors found"
reports success. Shells report death by signal n as 128 + n: a crash is SIGABRT
(6), hence 134, and 130 and 143 appear below. Keep your own codes under 128.
Crash messages go to stderr; `FailFast` (for state too damaged to run cleanup)
also skipped its `finally`. 134 is the macOS value; for Windows, Azure Service
Fabric's exit-code docs list `0xE0434352` for an unhandled .NET exception.

### stdout for data, stderr for people

```csharp
Console.Out.WriteLine("data line");
Console.Error.WriteLine("progress: 50%");
Console.Error.WriteLine($"out={Console.IsOutputRedirected} in={Console.IsInputRedirected} err={Console.IsErrorRedirected}");
```

```text
terminal (a pty):        out=False in=False err=False
./basics | cat           out=True  in=False err=False   (cat got only "data line")
echo hi | ./basics       out=False in=True  err=False
./basics 2>/dev/null     data line
```

Use `IsOutputRedirected` to drop colors, spinners and prompts when output is
piped. `head` shows a difference from native tools: `yes | head -1` gives `yes`
status 141 (killed by SIGPIPE), while a .NET program writing 1,000,000 lines
into `| head -2` kept running, printed "wrote all" to stderr and exited 0; the
writes after the pipe closed were silently dropped.

`Console.ReadLine()` returns `null` at end of input. `Console.ReadKey()` with
stdin redirected, as in CI, throws `InvalidOperationException: Cannot read keys
when either application does not have a console or when console input has been
redirected. Try Console.Read.`, so guard it with `!Console.IsInputRedirected`.
The encoding follows the locale: `Console.OutputEncoding.WebName` was `utf-8`
under `LANG=en_US.UTF-8`, `LANG=C` and no locale variables, but `iso-8859-1`
under `LANG=en_US.ISO8859-1`, where `"café ✓"` came out as `caf\xe9 ?`. Setting
`Console.OutputEncoding = Encoding.UTF8` restored UTF-8, with no BOM written.

### Ctrl+C and SIGTERM

```csharp
// e.Cancel / ctx.Cancel = true: do not die, we shut down ourselves
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
using var reg = PosixSignalRegistration.Create(PosixSignal.SIGTERM,
    ctx => { ctx.Cancel = true; cts.Cancel(); });
await Task.Delay(30_000, cts.Token);   // the work, cancelled by either signal
```

Signals sent with `kill -INT` and `kill -TERM` to the running process:

```text
SIGINT,  handler sets e.Cancel = true -> cleanup ran, exit 0
SIGINT,  handler leaves Cancel false  -> handler ran, exit 130
SIGINT,  no handler                   -> exit 130
SIGTERM, registration sets ctx.Cancel -> "drained, exiting", exit 0
SIGTERM, registration without Cancel  -> handler ran, exit 143
SIGTERM, nothing registered           -> exit 143, ProcessExit NOT raised
```

After a handled SIGINT the exit code is whatever your code returns (return 130
to still signal "interrupted"). The last line is a .NET 10 breaking change: the
docs say the runtime no longer installs a SIGTERM handler, so `ProcessExit` is
not raised; on the .NET 9 runtime the same program printed "ProcessExit". A
container worker needs its own registration or the Generic Host. Testing trap:
a job started with `&` in a non-interactive shell ignores SIGINT.

### System.CommandLine 2.0: commands, options, arguments

```csharp
Option<bool> verbose = new("--verbose", "-v") { Description = "Print extra diagnostics to stderr", Recursive = true };
Argument<string> title = new("title") { Description = "Task title" };
Option<int> priority = new("--priority", "-p") { Description = "1 (high) to 5 (low)", DefaultValueFactory = _ => 3 };
Option<string> list = new("--list", "-l") { Description = "Target list", Required = true };

Command add = new("add", "Add a task") { title, priority, list };   // and --due
add.SetAction((ParseResult r, CancellationToken ct) =>
{
    Console.WriteLine($"added '{r.GetValue(title)}' to {r.GetValue(list)} priority={r.GetValue(priority)}");
    return Task.FromResult(0);
});
RootCommand root = new("todo: a tiny task tracker") { verbose, add, done, sync };
return await root.Parse(args).InvokeAsync();
```

Constructors take the name then aliases; the description is a property. Beta4
code fails on 2.0.14: `root.SetHandler(...)` gives `CS1061: 'RootCommand' does
not contain a definition for 'SetHandler'` (it became `SetAction`, which
receives `ParseResult`), `InvocationContext` gives `CS0234`, and
`new Option<int>("--count", "How many items")` throws `ArgumentException: Names
and aliases cannot contain whitespace: "How many items" (Parameter 'alias')`.

### Help, errors, validators, response files and directives

`RootCommand` adds `-?, -h, --help` and `--version` (which printed `1.0.0`);
`todo add --help` showed `[default: 3]`, `(REQUIRED)` and the recursive
`-v, --verbose`. A parse error never reaches your action: errors go to stderr,
help to stdout, exit code 1.

```text
$ todo add                       (exit 1)
stderr: Option '--list' is required.
        Required argument missing for command: 'add'.
$ todo ad "Buy milk"             (exit 1, more stderr lines omitted)
stdout: 'ad' was not matched. Did you mean one of the following?
        add
stderr: Unrecognized command or argument 'ad'.
$ todo done 7                    (exit 2, returned by the action)
```

Typo suggestions are on by default. `todo add x -l home -vp 2` (bundling) ran
with verbose on and priority 2. An exception thrown in an action is printed as
`Unhandled exception: System.IO.IOException: disk full` and becomes exit 1.

```csharp
priority.Validators.Add(result =>
{
    // GetValue here throws if the token is not an int, so read the token
    if (int.TryParse(result.Tokens.SingleOrDefault()?.Value, out int value)
        && value is < 1 or > 5)
        result.AddError("--priority must be between 1 and 5.");
});
```

`-p 9` printed `--priority must be between 1 and 5.` (exit 1). The docs' sample
validator calls `result.GetValue(option)` instead; with `-p abc` that crashed
the process (exit 134) with `InvalidOperationException: Cannot parse argument
'abc' for option '--priority' as expected type 'System.Int32'.`, because
validators run inside `Parse`, outside the exception handler. Reading the token
turns that into a normal parse error (exit 1).

Response files are on by default: `todo @add.rsp --due 2026-12-24` (one token
per line in the file) ran `add` with the file's tokens plus `--due`. `[suggest]`
is registered by default, but `[diagram]` is not, although the syntax page
calls it a default feature: it failed with `Unrecognized command or argument
'[diagram]'` until `root.Directives.Add(new DiagramDirective())`, after which
`todo [diagram] add "Buy milk" -l home -p abc` printed
`[ todo ![ add <Buy milk> [ -l <home> ] ![ -p <abc> ] ] *[ --verbose ] ]`.

### Cancellation in actions, and dotnet run versus a published tool

An async action receives a `CancellationToken` that the library cancels on
SIGINT (Ctrl+C) or SIGTERM. The `sync` command awaits `Task.Delay(30 s, ct)`:

```text
token honored, catch returns 130          -> exit 130 right after the signal
token honored, OperationCanceledException -> exit 1
token ignored (SIGINT)                    -> killed 2 s later, exit 130
ProcessTerminationTimeout = 5 s, ignored  -> killed 5 s later, exit 130
ProcessTerminationTimeout = null (SIGINT) -> exit 130 at once, no cleanup ran
```

The first two rows were the same for SIGTERM. The published apphost
(`dotnet publish -c Release -o out`) started in about 35 ms, against about
670 ms for `dotnet run` and 290 ms for `dotnet run --no-build` (medians of five
runs). Use `dotnet run --` while developing; ship and test the executable.

## Trade-offs

- **Exit codes are a byte on Unix.** Anything outside 0..255 wraps silently.
  Define a small documented set (0 success, 1 failure, 2 usage, others < 128).
- **System.CommandLine is stable, its history is noisy.** Most samples online
  are beta4 code that no longer compiles. Pin a 2.0.x version and ignore
  samples with `SetHandler` or `InvocationContext`.
- **The library writes to the console for you.** Help and typo suggestions go
  to stdout even after a usage error, so check the exit code first. Messages
  are partly localized: under `LANG=pt_BR.UTF-8` one became "Argumento
  obrigatório ausente", another stayed English.
- **Signals need explicit code since .NET 10.** A bare console app dies on
  SIGTERM without `ProcessExit`. Use `PosixSignalRegistration`, an async
  System.CommandLine action, or the Generic Host.

## Documentation Links

- [System.CommandLine overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/commandline/) (doc)
- [Tutorial: Build a command-line app with System.CommandLine, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/system-command-line) (doc)
- [Main() and command-line arguments, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/main-command-line) (doc)
- [Environment.Exit method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.environment.exit?view=net-10.0) (doc)
- [PosixSignalRegistration class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.posixsignalregistration?view=net-10.0) (doc)
- [.NET runtime no longer provides default termination signal handlers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/10.0/sigterm-signal-handler) (doc)
