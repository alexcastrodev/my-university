---
version: 1.0
updatedAt: 2026-11-19
title: "Windows Services e Hospedagem com systemd"
summary: UseSystemd e UseWindowsService lidos no código-fonte, um app real sob systemd 257 (Type=notify, journal com prioridades, crash e restart, shutdown gracioso contra TimeoutStopSec, porta 80 sem root, hardening, watchdog) e o lado Windows (sc.exe, contas, recuperação, Event Log) só pela documentação.
---
## Objective

Um app .NET que precisa rodar por meses sem terminal precisa de um supervisor que o inicie no boot, reinicie, pare com educação e junte os logs. No Linux esse supervisor costuma ser o systemd, no Windows é o Service Control Manager (SCM). Dois pacotes pequenos ensinam o generic host a conversar com eles: `Microsoft.Extensions.Hosting.Systemd` (`AddSystemd`/`UseSystemd`) e `Microsoft.Extensions.Hosting.WindowsServices` (`AddWindowsService`/`UseWindowsService`). Li o código-fonte deles e depois rodei um app ASP.NET Core sob o systemd 257 de verdade, num contêiner Debian 13 privilegiado no Docker Desktop (arm64, cgroup v2), medindo Type=notify, o journal, crash e restart, shutdown gracioso contra `TimeoutStopSec`, portas abaixo de 1024, hardening e o watchdog. O Windows não roda neste macOS, então tudo sobre Windows vem da documentação ou do código-fonte e está marcado "docs only". Versions: `Microsoft.Extensions.Hosting.Systemd` e `Microsoft.Extensions.Hosting.WindowsServices` 10.0.15, TFM `net10.0`, .NET SDK 10.0.100, publicado self-contained para `linux-arm64`, systemd 257.13 no Debian 13 (trixie).

## Use Cases

- Rodar uma API ou um worker numa VM, num equipamento de borda (edge) ou num servidor físico sem orquestrador.
- Hospedar uma ferramenta interna como Windows Service ao lado de software legado que já presume o SCM.
- Fazer `journalctl -p err` mostrar só os erros de um serviço .NET.
- Garantir que o restart em falha realmente aconteça e que o stop de um deploy não corte um drain em andamento.

## Deep Dive

### O que os dois pacotes fazem (lido no código-fonte)

Os dois são sensíveis ao contexto: `AddSystemd()` e `AddWindowsService()` não fazem nada se o processo não for mesmo um serviço, então o mesmo binário roda igual no seu terminal. Num `HostApplicationBuilder` use `builder.Services.AddSystemd()`; o `IHostBuilder.UseSystemd()` antigo é equivalente.

| | systemd (`SystemdHelpers.IsSystemdService`) | Windows (`WindowsServiceHelpers.IsWindowsService`) |
|---|---|---|
| Detecção | só Linux; se o PID é 1, `NOTIFY_SOCKET` ou `LISTEN_PID` precisa existir (contêiner como init); senão o `/proc/<ppid>/comm` do pai precisa ser `systemd` | só Windows; o processo pai precisa se chamar `services` |
| Lifetime | `SystemdLifetime` substitui o lifetime de console | `WindowsServiceLifetime` (um `ServiceBase`) |
| Início | envia `READY=1` em `ApplicationStarted` | `OnStart` completa o início de `WaitForStartAsync` |
| Parada | envia `STOPPING=1` em `ApplicationStopping` | `OnStop` chama `StopApplication` e espera `ShutdownTimeout` |
| Log | formatador de console trocado para `systemd` (prefixos `<6>`) | adiciona o provider EventLog, nome da fonte = nome da aplicação |

A detecção olha o processo pai: iniciar o mesmo binário a partir de um shell dentro do contêiner systemd imprimiu `IsSystemdService=False`, e no macOS os dois helpers devolvem `False`. O código do `SystemdLifetime` envia exatamente dois estados, `Ready` e `Stopping`: não existe watchdog nem texto `STATUS=` (veja a seção do watchdog).

### O laboratório: um app, um contêiner com systemd

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddSystemd();                                    // no-op se o pai não for o systemd
builder.Services.AddWindowsService(o => o.ServiceName = "DotnetSvc");  // no-op se o pai não for o services.exe
builder.Services.AddHostedService<Worker>();   // loga cada nível, pode quebrar, drenar ou pingar, via env Demo__*
var app = builder.Build();
app.Run();
```

`dotnet publish -r linux-arm64 --self-contained` (114 MB), montado em `/opt/svc` num contêiner `debian:trixie` com `systemd` instalado, iniciado com `--privileged --cgroupns=host`, `/sys/fs/cgroup` montado como leitura e escrita e o systemd como PID 1. Isso funciona no Docker Desktop (`is-system-running` respondeu `degraded` porque `systemd-modules-load` falha em contêiner, o que não importa aqui). Tudo abaixo rodou assim.

### O arquivo de unit e o Type=notify

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

Com `Type=notify`, `systemctl start` só retorna depois do `READY=1`, que o app envia quando todos os hosted services terminaram o `StartAsync`. Dei 3 s de atraso ao `StartAsync`: o `start` voltou em 3,16 s com `Type=notify` e em 0,007 s com `Type=simple`, então o `notify` faz o `systemctl start` (e quem tem `After=`) esperar um "pronto" de verdade. O erro inverso custa caro: `Type=notify` com o `AddSystemd` removido (o app nunca envia `READY=1`) e `TimeoutStartSec=8`:

```text
Job for dotnetsvc.service failed because a timeout was exceeded.
Result=timeout   ActiveState=activating      (o app tinha logado "Application started")
```

O processo rodava, mas o systemd nunca o viu pronto, matou e, com `Restart=on-failure`, agendou um restart (contador 1). `Type=notify` e `AddSystemd` andam em par.

### Logs: as prioridades chegam ao journal

O `AddSystemd` troca o formatador do console, que prefixa cada linha com um nível de syslog (`<6>`) que o journald transforma em `PRIORITY`. Os campos do journal para as quatro linhas que o app logou:

```text
PRIORITY=6 Worker[0] IsSystemdService=True ... ContentRoot=/opt/svc ... User=svc Notifier=True
PRIORITY=4 Worker[0] a warning line
PRIORITY=3 Worker[0] an error line
PRIORITY=2 Worker[0] a critical line
```

O mesmo app, com `Type=simple` e sem o `AddSystemd` (o formatador padrão imprime `fail: Worker[0]` em duas linhas e tudo fica guardado com prioridade 6):

```text
journalctl -u dotnetsvc -p err      com AddSystemd:      2 linhas (error, critical)
journalctl -u dotnetsvc -p err      sem AddSystemd:      0 linhas
journalctl -u dotnetsvc -p warning  com / sem:           3 / 0 linhas
```

O formatador também dobra uma exceção e sua pilha numa única entrada do journal, o que mantém o `journalctl` e o alerta em um evento por falha. Use `journalctl -fu dotnetsvc` para acompanhar e `-o json` para ver `PRIORITY` e `_SYSTEMD_UNIT`. Não grave log em arquivo num serviço systemd sem necessidade: o stdout já vai para o journal, com rotação.

### Diretório de trabalho e content root

Sem `WorkingDirectory`, o systemd inicia um serviço de sistema em `/`. O generic host usa o diretório atual como `ContentRootPath`, então:

```text
sem WorkingDirectory:        ContentRoot=/          GET /  ->  (no Greeting: appsettings.json not found)
WorkingDirectory=/opt/svc:   ContentRoot=/opt/svc
```

O `appsettings.json` é carregado a partir do content root, então um `WorkingDirectory` esquecido parece configuração faltando, não problema de caminho. Valores do `EnvironmentFile` (`Greeting=...`) sobrescrevem o `appsettings.json`, como qualquer variável de ambiente. No Windows a mesma armadilha é o diretório de trabalho documentado como `C:\Windows\System32`. O código-fonte (release/10.0) mostra quem resolve isso hoje: `Host.CreateDefaultBuilder` e `CreateApplicationBuilder` ignoram o diretório atual quando ele é o diretório do sistema e caem para `AppContext.BaseDirectory`. A página do ASP.NET Core ainda diz que o `UseWindowsService` faz isso (era verdade do 3.x ao 5.0), então a doc está uma versão atrás (docs only para o Windows).

### Um worker que quebra sai com 0: Restart=on-failure não faz nada

O worker lança `InvalidOperationException` após 5 s. No .NET 10, `BackgroundServiceExceptionBehavior.StopHost` loga a falha e para o host de forma limpa, então o processo sai com código 0:

```text
Microsoft.Extensions.Hosting.Internal.Host[9] BackgroundService failed System.InvalidOperationException: simulated crash ...
dotnetsvc.service: Deactivated successfully.
Result=success   ExecMainStatus=0   NRestarts=0   ActiveState=inactive     (Restart=on-failure)
```

O serviço ficou morto. A doc do Windows diz o mesmo (o host "para de forma limpa, o que significa que o gerenciador de serviços do Windows não vai reiniciar o serviço") e manda chamar `Environment.Exit(1)`. Três saídas, todas medidas ou documentadas:

```csharp
catch (Exception) { Environment.ExitCode = 1; throw; }   // medido: status=1/FAILURE, contador de restart 1, de volta em 2 s
// ou Restart=always na unit (medido: 6 restarts em cerca de 50 s, 8 s por ciclo)
// ou no .NET 11, o RunAsync relança e o código de saída é diferente de zero (veja a lição de hosted services)
```

O `Restart=always` também reinicia um worker que termina por design, o que esconde a diferença entre concluído e morto. `StartLimitIntervalSec` e `StartLimitBurst` pertencem a `[Unit]`: com eles em `[Service]`, o `systemctl show` mostrou `StartLimitBurst=3` mas o serviço reiniciou 6 vezes; movidos para `[Unit]`, terminou em `Result=start-limit-hit` após 3 restarts.

### Shutdown gracioso: dois relógios, vale o menor

O `systemctl stop` envia SIGTERM (o `KillSignal` padrão), o host cancela o `stoppingToken`, executa `ApplicationStopping` (e envia `STOPPING=1`) e espera os hosted services até `HostOptions.ShutdownTimeout` (30 s). O systemd espera `TimeoutStopSec` (90 s por padrão; ajustei a cada execução) e então envia SIGKILL. Um worker que ignora o token e precisa de 45 s:

```text
caso   StopDelay  ShutdownTimeout  TimeoutStopSec  stop levou  Result    drain terminou?
A         5 s        30 s            30 s            5,04 s    success   sim
B        45 s        30 s (padrão)   90 s           30,05 s    success   NÃO (processo saiu, trabalho perdido)
C        45 s        60 s            10 s           10,25 s    timeout   NÃO (SIGKILL, status=9/KILL)
D        45 s        60 s            90 s           45,05 s    success   sim
```

O B é o perigoso: o host desistiu aos 30 s e saiu com 0, então o systemd registrou `Deactivated successfully` enquanto o drain era cortado, e nada no journal avisa. O C mostra a outra ordem: `State 'stop-sigterm' timed out. Killing.` e `Failed with result 'timeout'`. Regra: `TimeoutStopSec` maior que `ShutdownTimeout`, maior que o drain mais longo, e torne o trabalho durável de qualquer forma. Uma lição anterior mediu o mesmo corte de 30 s em contêiner (uma chamada de 40 s cortada aos 31,7 s mesmo com `docker stop -t 60`); no systemd o botão é o `TimeoutStopSec`. Windows (docs only, pelo código-fonte): o `OnStop` bloqueia por `ShutdownTimeout` esperando o host, e o próprio SCM limita quanto uma parada pode demorar (o padrão de 30 s para requisições de controle de serviço é o valor comumente citado, não verificado aqui), então um drain longo exige subir os dois.

### Portas abaixo de 1024 e hardening

Kestrel na porta 80 com o usuário sem privilégio `svc`:

```text
SocketException (13): Permission denied   ->   Main process exited, code=killed, status=6/ABRT   (rc=1, Result=signal)
```

Duas saídas: um reverse proxy que fica com 80/443 (o Kestrel fica em 8080), ou dar uma capability à unit:

```ini
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
```

O `/proc/<pid>/status` passou a mostrar `CapEff: 0000000000000400` (bit 10, `CAP_NET_BIND_SERVICE`) e o `curl localhost:80` respondeu. Um `CapabilityBoundingSet=` vazio remove a capability, então o conjunto limite precisa mantê-la. Detalhe do laboratório: o Docker define `net.ipv4.ip_unprivileged_port_start=0` em contêineres, então a porta 80 funcionaria sem capability nenhuma; coloquei 1024 dentro do contêiner privilegiado para reproduzir um host normal. O `systemd-analyze security` deu `9.0 UNSAFE` para a unit mínima (sem linhas de hardening) e `4.7 OK` para a unit acima; o `ProtectSystem=strict` deixa o sistema de arquivos somente leitura para o serviço, então dê `StateDirectory=` ou `ReadWritePaths=` para o que ele escreve.

### O watchdog é você quem envia

`WatchdogSec=6` faz o systemd definir `WATCHDOG_USEC=6000000` no ambiente e matar o serviço se o `WATCHDOG=1` não chegar a tempo. O código do `SystemdLifetime` envia só `READY` e `STOPPING`, e a medição concorda: com `WatchdogSec=6` e o app sem fazer nada, o systemd o matou 6,15 s após o início (`Watchdog timeout (limit 6s)!`, `Result=watchdog`) e o reiniciou. `ISystemdNotifier` e `ServiceState` são públicos, então o app pode enviar:

```csharp
var every = TimeSpan.FromMicroseconds(long.Parse(Environment.GetEnvironmentVariable("WATCHDOG_USEC")!) / 2);
while (!stop.IsCancellationRequested && await IsHealthyAsync())      // sua própria condição
{
    notifier.Notify(new ServiceState("WATCHDOG=1"));
    await Task.Delay(every, stop);
}
```

Com pings a cada meio intervalo o serviço ficou de pé; quando parei de pingar após 12 s, o systemd registrou `Watchdog timeout (limit 6s)!` 3,2 s depois de o app imprimir a linha de travamento (cerca de 6 s após o último ping), matou com SIGABRT e reiniciou. Um ping de um timer simples só prova que o processo agenda threads. Amarre-o a algo com sentido: por exemplo chame `HealthCheckService.CheckHealthAsync()` com um predicado de liveness e só pingue quando estiver saudável (veja a lição de health checks). Um watchdog que reinicia por causa de um banco fora do ar transforma uma indisponibilidade de dependência em loop de restart, então deixe os checks de readiness fora dele.

### Windows Services (docs only)

Não rodei aqui. Pelas páginas oficiais: instale `Microsoft.Extensions.Hosting.WindowsServices`, chame `AddWindowsService` e publique (a doc recomenda self-contained e single file, o que evita arquivos soltos numa pasta que a conta do serviço pode não conseguir ler):

```powershell
sc.exe create ".NET Joke Service" binpath= "C:\Path\To\App.exe --contentRoot C:\Other\Path"
sc.exe failure ".NET Joke Service" reset= 0 actions= restart/60000/restart/60000/run/1000
New-Service -Name Svc -BinaryPathName "C:\app\App.exe" -Credential "DOMAIN\user" -StartupType Automatic
```

Fatos para guardar: `binpath=` exige o espaço depois do sinal de igual; segundo a doc, as ações de recuperação exigem saída diferente de zero (então a correção com `Environment.Exit(1)` acima vale igual nas duas plataformas); o provider EventLog registra Warning ou acima por padrão, então linhas informativas precisam de um filtro; a URL padrão é `http://localhost:5000` a menos que `ASPNETCORE_URLS` ou os endpoints do Kestrel digam outra coisa, e o certificado de desenvolvimento do ASP.NET Core não é suportado num serviço. Para a conta, prefira o menor privilégio que funcione: uma virtual account (`NT SERVICE\<nome>`) ou uma managed service account (de grupo, gMSA) para recursos de rede, não `LocalSystem`. Instaladores (MSI, WiX) são o caminho para clientes; para seus próprios servidores, `sc.exe` ou `New-Service` num script bastam. O publish framework-dependent exige o runtime na máquina e mantém o serviço pequeno; self-contained mais single file é mais fácil de implantar (veja a lição de publish).

### Contêineres e outros supervisores

Uma imagem de contêiner roda um processo como PID 1 e deixa a plataforma reiniciá-lo, então `Type=notify`, `WorkingDirectory` e `EnvironmentFile` não têm equivalente: o orquestrador lê uma probe (`/healthz`), envia SIGTERM num rolling deploy e espera `terminationGracePeriodSeconds` (Kubernetes) antes do SIGKILL, a mesma regra dos dois relógios acima. Supervisores como supervisord e PM2 existem (citados, não testados): reiniciam um processo e acompanham logs, mas não dão handshake de READY, limites de cgroup nem hardening.

| Alvo | Como o app sabe | Desligamento | Logs | Hardening |
|---|---|---|---|---|
| systemd | o pai é o `systemd` (ou PID 1 com `NOTIFY_SOCKET`) | SIGTERM, depois SIGKILL após `TimeoutStopSec` | stdout no journal, `PRIORITY` vem do `<n>` | `NoNewPrivileges`, `ProtectSystem`, capabilities, `User=` (medido) |
| Windows Service | o pai é o `services.exe` | `OnStop` espera `ShutdownTimeout`, limite de tempo do SCM | Event Log, Warning+ por padrão | conta de serviço, ACLs do `sc.exe` (docs only) |
| Contêiner | sem detecção, PID 1 | SIGTERM, período de graça, SIGKILL | stdout para o runtime | usuário não root, raiz somente leitura, política do orquestrador |

Mercado: serviços novos costumam sair como contêineres, mas systemd e Windows Services seguem como a resposta em VMs, dispositivos de borda, appliances e na grande base instalada de .NET Framework e servidores Windows legados.

## Trade-offs

- **systemd e Windows Services dispensam orquestrador, mas o host é seu.** Patches, disco, o arquivo de unit e a conta ficam com você; um cluster esconde isso e custa mais para um serviço pequeno.
- **`Restart=on-failure` não trata crash por padrão.** No .NET 10 um `BackgroundService` morto sai com 0.
  ```csharp
  catch (Exception) { Environment.ExitCode = 1; throw; }   // senão on-failure e sc.exe failure nunca disparam
  ```
- **Type=notify dá um "pronto" de verdade, ao preço do acoplamento.** Esquecer o `AddSystemd` transforma um app saudável em timeout de start; `Type=simple` é mais solto, mas o `systemctl start` volta antes de o app escutar.
- **O shutdown tem dois relógios.** Mantenha `TimeoutStopSec` acima de `HostOptions.ShutdownTimeout`, acima do drain, senão o trabalho é cortado em silêncio (caso B) ou morto (caso C).
- **Hardening custa tempo de depuração.** `ProtectSystem=strict` e um conjunto de capabilities vazio quebram escrita e portas baixas até você adicionar `StateDirectory=` e `CAP_NET_BIND_SERVICE`; rode `systemd-analyze security` e aperte aos poucos.
- **Um watchdog pode ampliar uma indisponibilidade.** Pingue a partir de um check de liveness que dependa só do processo, não do banco.
- **`LocalSystem` é fácil e privilegiado demais.** Uma conta virtual ou gerenciada limita o que um serviço comprometido alcança (docs only).
- **A doc do Windows fica atrás do código-fonte.** O texto sobre content root ainda atribui ao `UseWindowsService`; teste o comportamento numa máquina Windows antes de confiar em qualquer um dos dois.

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
