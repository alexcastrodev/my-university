---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

Calling `git`, `ffmpeg`, `docker` or a shell script from C# looks like one line, `Process.Start`, and goes wrong in four predictable ways: arguments that a string concatenation mangled or let an attacker rewrite, a child that blocks forever because nobody read its stderr, a timeout that kills the program but leaves its children running, and an exit code that nobody interpreted. This concept covers `Process` and `ProcessStartInfo` as you use them in .NET 8 and 10 (the pattern that works everywhere), the deadlock and its fix, timeout with `Kill(entireProcessTree: true)`, exit codes and signals, and the shortcuts .NET 11 adds (`Process.Run`, `RunAndCaptureText`, `ReadAllLines`, `ProcessExitStatus`), including a behavior of their timeout that surprised me. Console exit codes of your own program are in the console apps concept.

## Use Cases

- Running `git`, `ffmpeg` or a linter from a build tool or a worker and returning what it printed.
- Calling a legacy command-line program where the parameters come from user input.
- Running a script with a deadline in a CI step and cleaning up everything it started.
- Telling "the tool failed" from "the tool was killed" in a retry policy.

## Deep Dive

### Start without a shell, one argument per item

Every number and message below was run on .NET 11.0.0 (SDK 11.0.100), macOS, with `sh` as the child.

```csharp
var psi = new ProcessStartInfo("printf") { RedirectStandardOutput = true };
psi.ArgumentList.Add("[%s]\n");
psi.ArgumentList.Add("hello world");
psi.ArgumentList.Add("a \"quoted\" $HOME");
using var p = Process.Start(psi)!;
Console.WriteLine(p.StandardOutput.ReadToEnd());
// [hello world]
// [a "quoted" $HOME]
```

`ArgumentList` hands each item to the child as one argument. The same call with
the string property, `Arguments = "[%s]\\n hello world"`, printed `[hello]` and
`[world]`: the string is split on spaces, and you are the one who has to quote
and escape. `UseShellExecute` is `false` by default in .NET, so no shell is
involved and `$HOME` or `; rm -rf` stay plain characters. Never build an
argument string from user input. Setting both properties fails at start with
`InvalidOperationException: Only one of Arguments or ArgumentList may be used.`

A program that does not exist throws at `Start`, not later:
`Win32Exception: An error occurred trying to start process 'definitely-not-a-program' with working directory '...'. No such file or directory`.
Catch it where you start the process, it is the "tool not installed" case.
`WorkingDirectory` and `psi.Environment["FOO"] = "bar"` set the child's folder
and variables (the child printed `bar` and `/private/tmp`).

### Redirecting output, and the deadlock

`RedirectStandardOutput` and `RedirectStandardError` give you the pipes as
`StreamReader`s. A pipe has a fixed buffer. When the child fills it and you are
not reading that pipe, the child blocks on `write`, and if you are blocked
waiting for the other pipe you wait forever. The classic code does exactly that:

```csharp
// child writes 200 KB to stderr, then "done" to stdout
var o = p.StandardOutput.ReadToEnd();   // waits for stdout to close...
var e = p.StandardError.ReadToEnd();    // ...but the child is stuck writing stderr
```

I ran it with a 3 second guard: it had not finished, `HasExited` was `False`.
Nothing throws, the program just stops. The fix is to drain both pipes at the
same time and only then wait:

```csharp
var o = p.StandardOutput.ReadToEndAsync();
var e = p.StandardError.ReadToEndAsync();
await Task.WhenAll(o, e);
await p.WaitForExitAsync();
// out=done err=200000 exit=0
```

Start both reads before awaiting either. Redirecting only one stream, or none,
is not a problem: with none, the child writes straight to your console.
Reading a stream you did not redirect throws
`InvalidOperationException: StandardOut has not been redirected or the process hasn't started yet.`

The older alternative is `BeginOutputReadLine` with `OutputDataReceived`. It
works, with one trap: `WaitForExit()` with no argument also waits for the event
streams to reach end of file. With a shell that exited at once but left a
`sleep 2` holding the pipe, `WaitForExit()` returned after 2012 ms, while
`WaitForExit(5000)` returned after 3 ms with `HasExited` true. That is a common
reason for a "stuck" build step: a grandchild still owns the pipe.

For input, set `RedirectStandardInput`, write, and close the writer. `cat`
echoed `hello` only after `StandardInput.Close()`, because closing is what
tells the child there is no more input.

### Timeout and killing the tree

`Process` has no timeout of its own. Cancel the wait and kill:

```csharp
using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
try { await p.WaitForExitAsync(cts.Token); }
catch (OperationCanceledException)
{
    p.Kill(entireProcessTree: true);
    await p.WaitForExitAsync();
}
```

`Kill()` kills one process. With `sh -c "sleep 310 & echo $!; wait"` as the
child, after `Kill(false)` the parent was dead and the `sleep` grandchild was
**still alive**; after `Kill(true)` both were gone. A surviving grandchild also
keeps your stdout pipe open, so a reader awaiting end of file hangs after the
"successful" kill. Use `Kill(true)` by default, then await the exit before you
read `ExitCode`: reading it earlier throws
`InvalidOperationException: Process must exit before requested information can be determined.`

### Exit codes and signals

A normal exit gives the program's own code (`exit 3` gave `ExitCode=3`). On
Unix a process killed by a signal has no exit code, and .NET reports
`128 + signal`: a child that sent itself SIGTERM gave `143`, and one killed by
`Kill()` gave `137` (SIGKILL is 9). So `code > 128` is "killed by a signal" in
practice, with the caveat that a program may also exit with 130 on its own. On
Windows there are no signals and the code is whatever the program returned.

On .NET 11 you can send a signal and read the signal back: `Process.Signal(PosixSignal.SIGTERM)` returned `True` and `WaitForExitStatusAsync()` gave a `ProcessExitStatus` with `ExitCode=143` and `Signal=SIGTERM`. A polite SIGTERM first, then a kill after a grace period, is the graceful way to stop a server child.

### What .NET 11 adds

.NET 11 puts the whole pattern above behind static methods on `Process`
(documented in What's new in .NET 11 libraries). On the GA runtime I called each
one:

```csharp
var r = Process.RunAndCaptureText("sh", ["-c", "echo out; echo err >&2; exit 3"]);
// r.StandardOutput = "out", r.StandardError = "err", r.ExitStatus.ExitCode = 3, r.ProcessId > 0

var st = Process.Run("sleep", ["30"], silent: false, timeout: TimeSpan.FromMilliseconds(300));
// st.ExitCode = 137, st.Signal = SIGKILL, st.Canceled = True
```

- `Run`, `RunAsync`: start, wait, return a `ProcessExitStatus` (`ExitCode`, `Signal`, `Canceled`). `silent: true` discards the child's output (nothing was printed), `false` lets it through to your console.
- `RunAndCaptureText`, `RunAndCaptureTextAsync`: the redirect and read pattern from this concept, with the two streams kept apart. 2 MB on each stream finished without deadlock.
- `ReadAllLines`, `ReadAllText`, `ReadAllBytes` (and async versions) on a started `Process` you already own. `ReadAllLines` yields `ProcessOutputLine` with `Content` and a `StandardError` flag. The order is not the order the child wrote: for three interleaved lines on each stream I got the stderr lines first, then the stdout lines, so use the flag, not the position.
- `StartAndForget` returns the process id and does not track the child.
- `ProcessStartInfo` also gained `StartSuspended` (documented for Windows and macOS), `KillOnParentExit` (Linux, Android and Windows, the compiler warned me on macOS), `CreateNewProcessGroup` (Windows) and `InheritedHandles`. I did not run these.

The timeout is where the shortcuts differ from each other and from the manual
pattern. `Run` with a timeout and `RunAsync` with a canceled token **do not
throw**: they return `Canceled=True`, `ExitCode=137`, `Signal=SIGKILL`.
`RunAndCaptureText` with a timeout **throws** `TimeoutException: The operation has timed out.`, and
`RunAndCaptureTextAsync` with a canceled token throws `OperationCanceledException`.
And in both `Run` and `RunAndCaptureText` the grandchild from the earlier
experiment was **still alive** after the timeout. So the shortcut kills the
process it started, not the tree. If your child starts children, keep the
manual `Kill(entireProcessTree: true)` version, or put them in a script that
cleans up. I observed this on macOS only; check the docs for your platform.

## Trade-offs

- **The shortcut is shorter, the manual version is the one you can adjust.**
  `RunAndCaptureText` removes the deadlock class of bugs. It does not stream
  output while the child runs, does not feed input and does not kill the tree.
  ```csharp
  var r = Process.RunAndCaptureText("git", ["rev-parse", "HEAD"], TimeSpan.FromSeconds(10));
  ```
- **Capturing text keeps everything in memory.** A child that prints gigabytes
  fills your heap. For big output, read line by line (`ReadAllLines`) or copy
  the stream to a file.
- **`ArgumentList` is safe from the shell, not from the program.** A value
  starting with `-` is still an option to `git` or `tar`. Put `--` before user
  values when the program supports it, and validate the value.
- **Exit code 0 is a convention, not a law.** `grep` returns 1 for "no match",
  `diff` returns 1 for "different". Map codes per tool instead of treating every
  non-zero as an error.
- **`128 + n` is a Unix reading.** Portable code checks `ExitStatus.Signal` on
  .NET 11 or the platform before it assumes a signal.
- **Do not wrap this in a thread per call.** The async reads and
  `WaitForExitAsync` do not block a thread while the child works.

## Lab

In this lab you get `ShellRunner` with **empty methods** (`NotImplementedException`). Your job is to build the `ProcessStartInfo`, run a child and capture both streams without deadlock, enforce a timeout that kills the whole tree, and read an exit code as success, failure or signal. The core idea is that the child and your program share two small pipes, and any time one side waits for the other without draining them, both stop.

**The scenario**

The tests use small shell scripts (`sh`, `head`, `tr`, `sleep`, `printf`) as the external program, so they need macOS or Linux and no network. The deadlock tests have a guard that fails after 10 seconds instead of hanging.

- `Build`: the `ProcessStartInfo`.
- `RunAsync`: run, capture and time out.
- `Classify` and `SignalNumber`: exit code interpretation.

**What you will do, step by step**

1. **Build the start info (TODO-00).** Add every argument to `ArgumentList`, redirect stdout and stderr, turn `UseShellExecute` off, apply the working directory and environment. A test passes `$HOME; echo injected` as an argument and expects it back literally.
2. **Run and capture (TODO-01).** Start both `ReadToEndAsync` calls before awaiting, then wait for exit. A child that writes 300 KB to stderr first must not hang you, and a missing program must throw `Win32Exception`.
3. **Time out and kill the tree (TODO-02).** Wait with a `CancellationToken`. On cancellation call `Kill(entireProcessTree: true)`, await the exit and return `TimedOut = true`. A test starts a grandchild, writes its pid to a file and checks that it is dead afterwards.
4. **Read the exit code (TODO-03).** `0` is success, `1` to `128` is failure, above `128` is a signal and `code - 128` is its number.

**How you know you are done**

`dotnet test` is all green. You should be able to explain why reading stdout to the end before stderr hangs, why `Kill()` alone leaves a grandchild and why `143` means SIGTERM.

**Optional challenges**

- **TODO-04:** read stdout to the end first and then stderr, and find the amount of stderr where the guard starts to fail.
- **TODO-05:** in a separate `net11.0` console project, repeat the scripts with `Process.RunAndCaptureText` and `Process.Run` and compare the timeout behavior and the surviving grandchild with your version.

**Prerequisites:** `async` and `await`, `CancellationToken` and the .NET 10 SDK. The optional challenge needs the .NET 11 SDK.

**How to run it:** clone the repository, go into the lab folder and run `dotnet test`. The methods throw `NotImplementedException` and each `TODO-NN` is a comment, so the red tests are your checklist.

## Documentation Links

- [Process Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process) (doc)
- [ProcessStartInfo.ArgumentList, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.argumentlist) (doc)
- [What's new in .NET libraries for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [Process.Kill(Boolean), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.kill) (doc)
- [ProcessStartInfo.RedirectStandardOutput, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.redirectstandardoutput) (doc)
