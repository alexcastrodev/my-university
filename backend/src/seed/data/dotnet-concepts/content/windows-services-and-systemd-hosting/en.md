---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

A .NET app that must run for months without a terminal needs a supervisor that starts it at boot, restarts it, stops it politely and collects its logs. On Linux that supervisor is usually systemd, on Windows it is the Service Control Manager (SCM). Two small packages teach the generic host to talk to them: `Microsoft.Extensions.Hosting.Systemd` (`AddSystemd`/`UseSystemd`) and `Microsoft.Extensions.Hosting.WindowsServices` (`AddWindowsService`/`UseWindowsService`). I read their source, then ran one ASP.NET Core app under real systemd 257 in a privileged Debian 13 container on Docker Desktop (arm64, cgroup v2) and measured Type=notify, the journal, crash and restart, graceful shutdown against `TimeoutStopSec`, ports below 1024, hardening and the watchdog. Windows cannot run on this macOS machine, so every Windows statement is read from the docs or the source and marked "docs only". Versions: `Microsoft.Extensions.Hosting.Systemd` and `Microsoft.Extensions.Hosting.WindowsServices` 10.0.15, TFM `net10.0`, .NET SDK 10.0.100, published self-contained for `linux-arm64`, systemd 257.13 on Debian 13 (trixie).

## Use Cases

- Running an API or a worker on a VM, an edge box or a bare-metal server that has no orchestrator.
- Hosting an internal Windows tool as a Windows Service next to legacy software that already assumes the SCM.
- Getting `journalctl -p err` to show only the errors of a .NET service.
- Making a restart on failure actually happen, and a deploy stop that does not cut an in-flight drain.

## Deep Dive

### What the two packages do (read from the source)

Both are context aware: `AddSystemd()` and `AddWindowsService()` do nothing unless the process really is a service, so one binary runs the same from your shell. On a `HostApplicationBuilder` use `builder.Services.AddSystemd()`; the older `IHostBuilder.UseSystemd()` is the same.

| | systemd (`SystemdHelpers.IsSystemdService`) | Windows (`WindowsServiceHelpers.IsWindowsService`) |
|---|---|---|
| Detection | Linux only; if PID is 1, `NOTIFY_SOCKET` or `LISTEN_PID` must be set (container as init); otherwise the parent's `/proc/<ppid>/comm` must be `systemd` | Windows only; the parent process must be named `services` |
| Lifetime | `SystemdLifetime` replaces the console lifetime | `WindowsServiceLifetime` (a `ServiceBase`) |
| Start | sends `READY=1` on `ApplicationStarted` | `OnStart` completes the start of `WaitForStartAsync` |
| Stop | sends `STOPPING=1` on `ApplicationStopping` | `OnStop` calls `StopApplication` and waits `ShutdownTimeout` |
| Logging | console formatter switched to `systemd` (`<6>` prefixes) | adds the EventLog provider, source name = application name |

The detection is on the parent process, so starting the same binary from a shell inside the systemd container printed `IsSystemdService=False`, and on macOS both helpers return `False`. The `SystemdLifetime` source sends exactly two states, `Ready` and `Stopping`: there is no watchdog and no `STATUS=` text (see the watchdog section).

### The lab: one app, a systemd container

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSystemd();                                    // no-op unless systemd is the parent
builder.Services.AddWindowsService(o => o.ServiceName = "DotnetSvc");  // no-op unless the parent is services.exe
builder.Services.AddHostedService<Worker>();   // logs each level, can crash, drain or ping, via Demo__* env vars
var app = builder.Build();
app.Run();
```

`dotnet publish -r linux-arm64 --self-contained` (114 MB), bind-mounted at `/opt/svc` into a `debian:trixie` container with `systemd` installed, started with `--privileged --cgroupns=host`, `/sys/fs/cgroup` mounted read-write and systemd as PID 1. That works on Docker Desktop (`is-system-running` said `degraded` because `systemd-modules-load` fails in a container, which is irrelevant here). Everything below ran there.

### The unit file and Type=notify

```ini
[Unit]
Description=Demo .NET service
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=notify
User=svc
WorkingDirectory=/opt/svc
ExecStart=/opt/svc/Svc
EnvironmentFile=/etc/dotnetsvc.env
Restart=on-failure
RestartSec=2
KillSignal=SIGTERM
TimeoutStopSec=30
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
```

With `Type=notify`, `systemctl start` returns only after `READY=1`, which the app sends after every hosted service finished `StartAsync`. I gave `StartAsync` a 3 s delay: `start` returned after 3.16 s with `Type=notify` and after 0.007 s with `Type=simple`, so `notify` makes `systemctl start` (and `After=` dependents) wait for a real ready. The reverse mistake is costly: `Type=notify` with `AddSystemd` removed (the app never sends `READY=1`) and `TimeoutStartSec=8`:

```text
Job for dotnetsvc.service failed because a timeout was exceeded.
Result=timeout   ActiveState=activating      (the app had logged "Application started")
```

The process ran, but systemd never saw it ready, killed it and, with `Restart=on-failure`, scheduled a restart (counter 1). `Type=notify` and `AddSystemd` are a pair.

### Logs: priorities reach the journal

`AddSystemd` switches the console formatter, which prefixes each line with a syslog level (`<6>`) that journald turns into `PRIORITY`. The journal fields for the four lines the app logged:

```text
PRIORITY=6 Worker[0] IsSystemdService=True ... ContentRoot=/opt/svc ... User=svc Notifier=True
PRIORITY=4 Worker[0] a warning line
PRIORITY=3 Worker[0] an error line
PRIORITY=2 Worker[0] a critical line
```

Same app, `Type=simple` and `AddSystemd` removed (the default console formatter prints `fail: Worker[0]` over two lines, everything stored as priority 6):

```text
journalctl -u dotnetsvc -p err      with AddSystemd:      2 lines (error, critical)
journalctl -u dotnetsvc -p err      without AddSystemd:   0 lines
journalctl -u dotnetsvc -p warning  with / without:       3 / 0 lines
```

The formatter also folds an exception and its stack into one journal entry, which keeps `journalctl` and alerting on one event per failure. Use `journalctl -fu dotnetsvc` to follow, and `-o json` to see `PRIORITY` and `_SYSTEMD_UNIT`. Do not log to a file from a systemd service unless you must: stdout already lands in the journal with rotation.

### Working directory and content root

Without `WorkingDirectory`, systemd starts a system service in `/`. The generic host takes the current directory as `ContentRootPath`, so:

```text
no WorkingDirectory:        ContentRoot=/          GET /  ->  (no Greeting: appsettings.json not found)
WorkingDirectory=/opt/svc:  ContentRoot=/opt/svc
```

`appsettings.json` loads from the content root, so a missing `WorkingDirectory` looks like missing configuration, not a path problem. Values from `EnvironmentFile` (`Greeting=...`) override `appsettings.json`, as any environment variable does. On Windows the same trap is the documented `C:\Windows\System32` working directory. The source (release/10.0) shows who fixes it today: `Host.CreateDefaultBuilder` and `CreateApplicationBuilder` skip the current directory when it equals the system directory and fall back to `AppContext.BaseDirectory`. The ASP.NET Core page still says `UseWindowsService` does this (true in 3.x to 5.0), so the doc is a version behind (docs only for Windows).

### A crashed worker exits with 0: Restart=on-failure does nothing

The worker throws `InvalidOperationException` after 5 s. On .NET 10 `BackgroundServiceExceptionBehavior.StopHost` logs the failure and stops the host cleanly, so the process exits with code 0:

```text
Microsoft.Extensions.Hosting.Internal.Host[9] BackgroundService failed System.InvalidOperationException: simulated crash ...
dotnetsvc.service: Deactivated successfully.
Result=success   ExecMainStatus=0   NRestarts=0   ActiveState=inactive     (Restart=on-failure)
```

The service stayed dead. The Windows doc says the same (the host "stops cleanly, meaning that the Windows Service management system won't restart the service") and tells you to call `Environment.Exit(1)`. Three fixes, all measured or documented:

```csharp
catch (Exception) { Environment.ExitCode = 1; throw; }   // measured: status=1/FAILURE, restart counter 1, back up in 2 s
// or Restart=always in the unit (measured: 6 restarts in about 50 s, 8 s per cycle)
// or on .NET 11, RunAsync rethrows and the exit code is non-zero (see the hosted-services lesson)
```

`Restart=always` also restarts a worker that finishes by design, which hides the difference between done and dead. `StartLimitIntervalSec` and `StartLimitBurst` belong in `[Unit]`: with them in `[Service]`, `systemctl show` reported `StartLimitBurst=3` yet the service restarted 6 times; moved to `[Unit]`, it ended in `Result=start-limit-hit` after 3 restarts.

### Graceful shutdown: two clocks, the smaller one wins

`systemctl stop` sends SIGTERM (`KillSignal` default), the host cancels `stoppingToken`, runs `ApplicationStopping` (and sends `STOPPING=1`), and waits for hosted services up to `HostOptions.ShutdownTimeout` (30 s). systemd waits `TimeoutStopSec` (90 s by default; I set it per run) and then sends SIGKILL. A worker that ignores its token and needs 45 s:

```text
case   StopDelay  ShutdownTimeout  TimeoutStopSec  stop took  Result    drain finished?
A         5 s        30 s            30 s            5.04 s    success   yes
B        45 s        30 s (default)  90 s           30.05 s    success   NO (process left, work lost)
C        45 s        60 s            10 s           10.25 s    timeout   NO (SIGKILL, status=9/KILL)
D        45 s        60 s            90 s           45.05 s    success   yes
```

B is the dangerous one: the host gave up at 30 s and exited with 0, so systemd reported `Deactivated successfully` while the drain was cut, and nothing in the journal says so. C shows the other ordering: `State 'stop-sigterm' timed out. Killing.` and `Failed with result 'timeout'`. Rule: `TimeoutStopSec` greater than `ShutdownTimeout` greater than the longest drain, and make the work durable anyway. An earlier lesson measured the same 30 s cut in a container (a 40 s call cut at 31.7 s even with `docker stop -t 60`); on systemd the knob is `TimeoutStopSec`. Windows (docs only, from the source): `OnStop` blocks `ShutdownTimeout` waiting for the host, and the SCM itself bounds how long a stop may take (the commonly cited 30 s default for service control requests, not verified here), so a long drain needs both raised.

### Ports below 1024 and hardening

Kestrel on port 80 as the unprivileged `svc` user:

```text
SocketException (13): Permission denied   ->   Main process exited, code=killed, status=6/ABRT   (rc=1, Result=signal)
```

Two ways out: a reverse proxy that owns 80/443 (Kestrel stays on 8080), or give the unit one capability:

```ini
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
```

`/proc/<pid>/status` then showed `CapEff: 0000000000000400` (bit 10, `CAP_NET_BIND_SERVICE`) and `curl localhost:80` answered. An empty `CapabilityBoundingSet=` removes the capability, so the bounding set must keep it. A lab detail: Docker sets `net.ipv4.ip_unprivileged_port_start=0` in containers, so port 80 would have worked without any capability; I set it to 1024 inside the privileged container to reproduce a normal host. `systemd-analyze security` scored the minimal unit (no hardening lines) `9.0 UNSAFE` and the unit above `4.7 OK`; `ProtectSystem=strict` makes the file system read-only for the service, so give it `StateDirectory=` or `ReadWritePaths=` for anything it writes.

### The watchdog is yours to send

`WatchdogSec=6` makes systemd set `WATCHDOG_USEC=6000000` in the environment and kill the service when `WATCHDOG=1` does not arrive in time. The `SystemdLifetime` source sends only `READY` and `STOPPING`, and the measurement agrees: with `WatchdogSec=6` and the app doing nothing, systemd killed it 6.15 s after start (`Watchdog timeout (limit 6s)!`, `Result=watchdog`) and restarted it. `ISystemdNotifier` and `ServiceState` are public, so the app can send it:

```csharp
var every = TimeSpan.FromMicroseconds(long.Parse(Environment.GetEnvironmentVariable("WATCHDOG_USEC")!) / 2);
while (!stop.IsCancellationRequested && await IsHealthyAsync())      // your own condition
{
    notifier.Notify(new ServiceState("WATCHDOG=1"));
    await Task.Delay(every, stop);
}
```

With pings every half interval the service stayed up; when I stopped pinging after 12 s, systemd logged `Watchdog timeout (limit 6s)!` 3.2 s after the app printed its hang line (about 6 s after the last ping), killed it with SIGABRT and restarted it. A ping from a plain timer only proves the process is scheduling threads. Tie it to something meaningful: for example call `HealthCheckService.CheckHealthAsync()` with a liveness predicate and ping only when it is healthy (see the health checks lesson). A watchdog that restarts on a failing database turns a dependency outage into a restart loop, so keep readiness checks out of it.

### Windows Services (docs only)

Not run here. From the official pages: install `Microsoft.Extensions.Hosting.WindowsServices`, call `AddWindowsService`, and publish (the docs recommend self-contained and single file, which avoids loose files in a folder the service account may not read):

```powershell
sc.exe create ".NET Joke Service" binpath= "C:\Path\To\App.exe --contentRoot C:\Other\Path"
sc.exe failure ".NET Joke Service" reset= 0 actions= restart/60000/restart/60000/run/1000
New-Service -Name Svc -BinaryPathName "C:\app\App.exe" -Credential "DOMAIN\user" -StartupType Automatic
```

Facts to keep: `binpath=` needs the space after the equals sign; per the docs the recovery actions need a non-zero exit (so the `Environment.Exit(1)` fix above is the same on both platforms); the EventLog provider logs Warning and above by default, so informational lines need a filter; the default URL is `http://localhost:5000` unless `ASPNETCORE_URLS` or Kestrel endpoints say otherwise, and the ASP.NET Core development certificate is not supported for a service. For the account, prefer the least privilege that works: a virtual account (`NT SERVICE\<name>`) or a (group) managed service account for network resources, not `LocalSystem`. Installers (MSI, WiX) are the route for customers; for your own servers `sc.exe` or `New-Service` in a script is enough. Framework-dependent publish needs the runtime on the box and keeps the service small; self-contained plus single file is easier to deploy (see the publishing lesson).

### Containers and other supervisors

A container image runs one process as PID 1 and lets the platform restart it, so `Type=notify`, `WorkingDirectory` and `EnvironmentFile` have no equivalent: the orchestrator reads a probe instead (`/healthz`), sends SIGTERM on a rolling deploy and waits `terminationGracePeriodSeconds` (Kubernetes) before SIGKILL, the same two-clock rule as above. Supervisors such as supervisord and PM2 exist (cited, not tried): they restart a process and tail logs, but give no READY handshake, no cgroup limits and no hardening.

| Target | How the app knows | Shutdown | Logs | Hardening |
|---|---|---|---|---|
| systemd | parent is `systemd` (or PID 1 with `NOTIFY_SOCKET`) | SIGTERM, then SIGKILL after `TimeoutStopSec` | stdout to the journal, `PRIORITY` from `<n>` | `NoNewPrivileges`, `ProtectSystem`, capabilities, `User=` (measured) |
| Windows Service | parent is `services.exe` | `OnStop` waits `ShutdownTimeout`, SCM time limit | Event Log, Warning+ by default | service account, `sc.exe` ACLs (docs only) |
| Container | no detection, PID 1 | SIGTERM, grace period, SIGKILL | stdout to the runtime | non-root user, read-only root, orchestrator policy |

Market: new services mostly ship as containers, but systemd and Windows Services remain the answer on VMs, edge devices, appliances and the large installed base of legacy .NET Framework and Windows servers.

## Trade-offs

- **systemd and Windows Services need no orchestrator, but you own the host.** Patching, disk, the unit file and the account are yours; a cluster hides that and costs more to run for one small service.
- **`Restart=on-failure` is not a crash handler by default.** On .NET 10 a dead `BackgroundService` exits with 0.
  ```csharp
  catch (Exception) { Environment.ExitCode = 1; throw; }   // otherwise on-failure and sc.exe failure never fire
  ```
- **Type=notify gives a real ready, at the price of coupling.** Forgetting `AddSystemd` turns a healthy app into a start timeout; `Type=simple` is looser but `systemctl start` returns before the app listens.
- **Shutdown has two clocks.** Keep `TimeoutStopSec` above `HostOptions.ShutdownTimeout` above the drain, otherwise work is cut silently (case B) or killed (case C).
- **Hardening costs debugging time.** `ProtectSystem=strict` and an empty capability set break writes and low ports until you add `StateDirectory=` and `CAP_NET_BIND_SERVICE`; run `systemd-analyze security` and tighten step by step.
- **A watchdog can amplify an outage.** Ping from a liveness check that depends on the process only, not on the database.
- **`LocalSystem` is easy and over-privileged.** A virtual or managed account limits what a compromised service can touch (docs only).
- **The Windows docs lag the source.** The content root text still credits `UseWindowsService`; test the behavior on a Windows machine before relying on either.

## Documentation Links

- [Create a Windows Service using BackgroundService, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/windows-service) (doc)
- [Host ASP.NET Core in a Windows Service, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/windows-service) (doc)
- [Host ASP.NET Core on Linux with Nginx (systemd unit), Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/host-and-deploy/linux-nginx) (doc)
- [SystemdHostBuilderExtensions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.hosting.systemdhostbuilderextensions) (doc)
- [WindowsServiceLifetimeHostBuilderExtensions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.extensions.hosting.windowsservicelifetimehostbuilderextensions) (doc)
- [systemd.service, freedesktop.org](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) (doc)
- [sd_notify, freedesktop.org](https://www.freedesktop.org/software/systemd/man/latest/sd_notify.html) (doc)
- [systemd.exec (sandboxing options), freedesktop.org](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) (doc)
- [systemd-analyze security, freedesktop.org](https://www.freedesktop.org/software/systemd/man/latest/systemd-analyze.html) (doc)
- [sc create, Microsoft Learn](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/sc-create) (doc)
- [New-Service, Microsoft Learn](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/new-service) (doc)
- [Service user accounts, Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/services/service-user-accounts) (doc)
- [.NET Generic Host (ShutdownTimeout), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/generic-host) (doc)
