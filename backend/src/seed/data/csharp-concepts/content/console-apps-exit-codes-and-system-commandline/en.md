---
version: 1.0
updatedAt: 2026-10-28
---
## Objective

A command-line program talks to its caller through four channels: the
arguments it receives, the exit code it returns, standard output for data and
standard error for everything else. Scripts, CI pipelines and container
orchestrators read those channels and nothing more, so a tool that prints
errors to stdout or exits 0 after a failure breaks them silently. This concept
shows, on .NET 10 / C# 14 under macOS, how `Main` and top-level programs return
codes, what Unix does to codes outside 0..255, what a crash exits with, how to
keep stdout clean for pipes, how to react to Ctrl+C and SIGTERM, and then how to
build a real CLI with `System.CommandLine`. Its status was unclear for years:
NuGet shows 2.0.0 published as stable on 2025-11-11 after six years of betas,
2.0.14 as the current stable (2026-10-25), and a 3.0.0 line still in
prerelease (3.0.0-rc.3). The examples use 2.0.14, whose API differs from the
2.0.0-beta4 one that most blog posts show.

## Use Cases

- Writing a tool that a shell script, a CI step or `make` can call and trust:
  correct exit codes, data on stdout, diagnostics on stderr.
- Running a console worker in a container, where SIGTERM is the shutdown
  request and must lead to a clean exit.
- Replacing hand-written `args` parsing with subcommands, typed options,
  validation and generated `--help`.
- Diagnosing "the pipeline says success but nothing happened" (an exit code
  lost or truncated).

## Deep Dive

### Entry points, args and the `--` separator

`Main` returns `void`, `int`, `Task` or `Task<int>`, with or without
`string[] args`; a top-level program gets the `int` form as soon as it contains
`return n;`. `args` never contains the program name (the docs say it is never
null either), while `Environment.GetCommandLineArgs()[0]` holds the path of the
assembly. Under `dotnet run`, everything after `--` goes to the program; without
it, the SDK keeps the options it recognizes:

```text
$ dotnet run -- args --verbose -c x
4: [args] [--verbose] [-c] [x]
$ dotnet run args -c Release
1: [args]                         // -c Release was taken by dotnet run (Release build)
```

### Exit codes, and Unix keeps only the low byte

```csharp
return int.Parse(args[1]);              // ret N
Environment.Exit(4);                    // ends the process now
Environment.ExitCode = 7;               // used when Main returns void
```

Running each and reading `echo $?` in zsh:

```text
return 3     -> 3
return 256   -> 0       return -1  -> 255
return 300   -> 44      void Main with ExitCode = 1000 -> 232
ExitCode = 7, then return 0        -> 0   (the return value wins)
ExitCode = 7, then Exit(3)         -> 3
Exit(4) inside try { } finally { } -> 4, and the finally block did not run
```

The process status on Unix is one byte, so the value is taken modulo 256: a
tool that returns "256 errors found" reports success. Keep codes in 0..125
(above that, shells use 126 to 255 for "not executable" and "killed by a
signal"). The `ExitCode` docs warn against values at or above `0x80000000` on
the Windows side, where the full 32 bits survive. `Environment.Exit` skips
`finally` blocks, as its docs state, so prefer returning from `Main`.

### Crashes: unhandled exceptions and FailFast

```text
$ ./basics throw ; echo $?
Unhandled exception. System.InvalidOperationException: config file missing
   at Program.<Main>$(String[] args) in .../Program.cs:line 25
134
$ ./basics failfast ; echo $?
Process terminated.
state corrupted
   at System.Environment.FailFast(System.String) ...
134
```

Both write to stderr and end in SIGABRT, which the shell reports as 134
(128 + 6, bash prints "Abort trap: 6"). `FailFast` also skipped the `finally`
block around it: it is meant for state so damaged that running cleanup code
would make things worse. The 134 is the macOS value measured here. On Windows
the code is different: Azure Service Fabric's exit-code table documents
`0xE0434352` as the code of a process ended by an unhandled .NET exception.

### stdout for data, stderr for people

```csharp
Console.Out.WriteLine("data line");
Console.Error.WriteLine("progress: 50%");
Console.Error.WriteLine($"out={Console.IsOutputRedirected} in={Console.IsInputRedirected} err={Console.IsErrorRedirected}");
```

```text
terminal (a pty):        out=False in=False err=False
./basics | cat           out=True  in=False err=False   (cat received only "data line")
echo hi | ./basics       out=False in=True  err=False
./basics 2>/dev/null     data line                      (the progress text is gone)
```

Use `IsOutputRedirected` to drop colors, spinners and prompts when someone
pipes your output. One difference from native tools appears with `head`:
`yes | head -1` gives `yes` the exit status 141 (killed by SIGPIPE), while a
.NET program writing 1,000,000 lines into `| head -2` kept running, printed
"wrote all" to stderr and exited 0. The writes after `head` closed the pipe
were silently discarded, so a .NET producer does all its work even when nobody
reads it.

### stdin, ReadKey and encodings

`Console.ReadLine()` returns `null` at end of input, which is the loop
condition for filters:

```csharp
while ((line = Console.ReadLine()) is not null) n++;
// printf 'a\nb\nc' | ./basics lines  ->  read 3 lines, then ReadLine returned null
```

`Console.ReadKey()` needs a real console. With stdin redirected (a pipe,
`< /dev/null`, or CI with no terminal) it throws:

```text
InvalidOperationException: Cannot read keys when either application does not
have a console or when console input has been redirected. Try Console.Read.
```

Guard "press any key" prompts with `if (!Console.IsInputRedirected)`. On macOS
the console encoding follows the locale: `Console.OutputEncoding.WebName` was
`utf-8` under `LANG=en_US.UTF-8`, `LANG=C` and no locale variables, and
`iso-8859-1` under `LANG=en_US.ISO8859-1`, where `"café ✓"` came out as
`caf\xe9 ?`. Setting `Console.OutputEncoding = Encoding.UTF8` restored UTF-8,
and no BOM was written even though that encoding has a 3-byte preamble.

### Ctrl+C and SIGTERM

```csharp
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;      // do not die, we shut down ourselves
    cts.Cancel();
};
using var reg = PosixSignalRegistration.Create(PosixSignal.SIGTERM, ctx =>
{
    ctx.Cancel = true;    // suppress the default termination
    cts.Cancel();
});
await Task.Delay(30_000, cts.Token);   // the "work", cancelled by either signal
```

The signals were sent with `kill -INT` and `kill -TERM` to the running process:

```text
SIGINT,  handler sets e.Cancel = true -> handler ran, cleanup ran, exit 0
SIGINT,  handler leaves Cancel false  -> handler ran, exit 130
SIGINT,  no handler                   -> exit 130
SIGTERM, registration sets ctx.Cancel -> "drained, exiting", exit 0
SIGTERM, registration without Cancel  -> handler ran, exit 143
SIGTERM, nothing registered           -> exit 143, ProcessExit NOT raised
```

So after a handled SIGINT the exit code is whatever your code returns; return
130 if callers should still see "interrupted". The last line is a .NET 10
breaking change: the docs say the runtime no longer installs a default SIGTERM
handler, so `AppDomain.ProcessExit` is not raised. The same program on the
.NET 9 runtime printed "ProcessExit" before exiting 143. A console worker in a
container therefore needs its own registration (or the Generic Host, which the
docs say registers one). One trap when testing from a script: a job started
with `&` in a non-interactive shell inherits SIGINT as ignored, and
`kill -INT` on it did nothing.

### System.CommandLine 2.0: commands, options, arguments

```csharp
Option<bool> verbose = new("--verbose", "-v") { Description = "Print extra diagnostics to stderr", Recursive = true };
Argument<string> title = new("title") { Description = "Task title" };
Option<int> priority = new("--priority", "-p") { Description = "1 (high) to 5 (low)", DefaultValueFactory = _ => 3 };
Option<string> list = new("--list", "-l") { Description = "Target list", Required = true };
Option<DateOnly?> due = new("--due") { Description = "Due date (yyyy-MM-dd)" };

Command add = new("add", "Add a task") { title, priority, list, due };
add.SetAction((ParseResult r, CancellationToken ct) =>
{
    Console.WriteLine($"added '{r.GetValue(title)}' to {r.GetValue(list)} priority={r.GetValue(priority)}");
    return Task.FromResult(0);
});
RootCommand root = new("todo: a tiny task tracker") { verbose, add, done, sync };
return await root.Parse(args).InvokeAsync();
```

The constructor takes the name then aliases; the description is a property.
That is the main change from beta4, where the second string was the
description. Old code fails in two ways on 2.0.14: `root.SetHandler(...)` and
`root.AddOption(o)` stop compiling with `CS1061: 'RootCommand' does not contain
a definition for 'SetHandler'`, and `new Option<int>("--count", "How many
items")` compiles but throws `ArgumentException: Names and aliases cannot
contain whitespace: "How many items" (Parameter 'alias')`. `SetHandler` became
`SetAction`, `InvocationContext` disappeared (the action receives
`ParseResult`), and `Command.Parse(args)` returns a result you `Invoke` or
`InvokeAsync`. The docs ask you not to mix sync and async actions in one app.

### Help, version, errors and suggestions

`RootCommand` adds `-?, -h, --help` and `--version` by itself:

```text
$ todo add --help
Usage:
  todo add <title> [options]
Options:
  -p, --priority <priority>     1 (high) to 5 (low) [default: 3]
  -l, --list <list> (REQUIRED)  Target list
  -v, --verbose                 Print extra diagnostics to stderr
$ todo --version
1.0.0
```

A parse error never reaches your action. The errors go to stderr, the help to
stdout, and the exit code is 1:

```text
$ todo add                       (exit 1)
stderr: Option '--list' is required.
        Required argument missing for command: 'add'.
$ todo ad "Buy milk"             (exit 1)
stdout: 'ad' was not matched. Did you mean one of the following?
        add
stderr: Unrecognized command or argument 'ad'.
$ todo done 7                    (exit 2, returned by the action)
```

Typo suggestions are on by default, and they land on stdout. Option bundling
works too: `todo add x -l home -vp 2` ran with verbose on and priority 2. An
exception thrown inside an action is caught by the default handler, printed as
`Unhandled exception: System.IO.IOException: disk full` and turned into exit 1,
not the 134 of a bare crash.

### Validators, response files and directives

```csharp
priority.Validators.Add(result =>
{
    // GetValue here throws if the token is not an int, so read the token
    if (int.TryParse(result.Tokens.SingleOrDefault()?.Value, out int value)
        && value is < 1 or > 5)
        result.AddError("--priority must be between 1 and 5.");
});
```

`-p 9` printed `--priority must be between 1 and 5.` with exit 1. The comment
matters: the docs' sample validator calls `result.GetValue(option)`, and with
`-p abc` that crashed the process with exit 134 and `InvalidOperationException:
Cannot parse argument 'abc' for option '--priority' as expected type
'System.Int32'.`, because validators run inside `Parse`, outside the exception
handler. Reading the token lets the library report that same message as a
normal parse error (exit 1).

Response files are on by default: `todo @add.rsp --due 2026-12-24`, with one
token per line in the file, ran `add` with the file's arguments plus the extra
option. Of the directives, `[suggest]` is registered by default
(`todo [suggest] sy` printed `sync`), but `[diagram]` is not, although the
syntax page calls it a default feature: it failed with `Unrecognized command or
argument '[diagram]'` until `root.Directives.Add(new DiagramDirective())`:

```text
$ todo [diagram] add "Buy milk" -l home -p abc extra
[ todo ![ add <Buy milk> [ -l <home> ] ![ -p <abc> ] ] *[ --verbose ] ]   ???--> extra
```

### Cancellation in actions, and dotnet run versus a published tool

An async action receives a `CancellationToken` that the library cancels on
Ctrl+C, SIGINT or SIGTERM. Sending signals to the `sync` command (a 30 s
`Task.Delay(…, ct)`):

```text
token honored, catch returns 130          -> exit 130 right after the signal
token honored, OperationCanceledException -> exit 1
token ignored                             -> killed 2 s after the signal, exit 130
ProcessTerminationTimeout = 5 s, ignored  -> killed after 5 s, exit 130
ProcessTerminationTimeout = null          -> exit 130 at once, no cleanup ran
```

`dotnet run` builds and launches through the SDK. The published apphost
(`dotnet publish -c Release -o out`, then `./out/todo`) printed the same help
with `todo` as the program name, and started in about 35 ms against about
670 ms for `dotnet run` and about 290 ms for `dotnet run --no-build` (medians
of five runs). Use `dotnet run --` while developing, and ship and test the
executable.

## Trade-offs

- **Exit codes are a byte on Unix.** Anything outside 0..255 wraps without
  warning. Define a small set of codes (0 success, 1 failure, 2 usage, your
  own up to 125) and document them.
- **`Environment.Exit` is convenient, and skips `finally`.** It ends the
  process even from deep inside a call stack, which hides the exit path and
  skips cleanup. Prefer returning a code from `Main` or the action.
- **System.CommandLine is stable, and its history is noisy.** Most samples on
  the web are beta4 code that no longer compiles. Pin a 2.0.x version and
  ignore samples with `SetHandler` or `InvocationContext`.
- **The library writes to the console for you.** Errors to stderr, but help and
  typo suggestions to stdout, so a script reading stdout after a usage error
  gets help text. Check the exit code before reading the output. Its messages
  are localized from the satellite assemblies it ships: under
  `LANG=pt_BR.UTF-8` "Required argument missing" became "Argumento
  obrigatório ausente".
- **Signals need explicit code since .NET 10.** A bare console app dies on
  SIGTERM without `ProcessExit`. Use `PosixSignalRegistration`, a
  System.CommandLine async action, or the Generic Host for long-running work.
- **Alternatives exist.** The Spectre.Console.Cli README calls it "a modern
  library for parsing command line arguments", and Cocona's README describes a
  micro-framework built on `Microsoft.Extensions.*` where public methods
  become commands. Neither was tested here.

## Documentation Links

- [System.CommandLine overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/commandline/) (doc)
- [Tutorial: Build a command-line app with System.CommandLine, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/system-command-line) (doc)
- [Main() and command-line arguments, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/main-command-line) (doc)
- [Environment.Exit method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.environment.exit?view=net-10.0) (doc)
- [PosixSignalRegistration class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.posixsignalregistration?view=net-10.0) (doc)
- [.NET runtime no longer provides default termination signal handlers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/10.0/sigterm-signal-handler) (doc)
