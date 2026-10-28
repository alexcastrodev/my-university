---
version: 1.0
updatedAt: 2026-10-28
title: "Diagnosticando produção com dotnet-trace, dotnet-dump e dotnet-gcdump"
summary: As ferramentas de diagnóstico do .NET usadas num processo vivo sem mudar o código (dotnet-counters, dotnet-trace, dotnet-gcdump, dotnet-dump com SOS e dotnet-stack), aplicadas a um app com CPU alta, vazamento de memória, starvation do thread pool e deadlock, com a saída real e o que funcionou ou não no macOS.
---
## Objective

Quando um processo .NET em produção fica lento, consome memória ou para de responder, em geral você não consegue anexar o Visual Studio, publicar de novo com mais logs nem reproduzir o problema no seu notebook. As ferramentas de diagnóstico de linha de comando do .NET trabalham no processo vivo como ele está, sem mudar código e sem reiniciar: `dotnet-counters` mostra métricas do runtime, `dotnet-trace` amostra pilhas e grava eventos do runtime, `dotnet-gcdump` tira um retrato do heap gerenciado, `dotnet-dump` grava um dump completo do processo que você analisa com comandos SOS, e `dotnet-stack` imprime a pilha gerenciada de cada thread. Este conceito escreve um app ASP.NET Core quebrado de propósito (um endpoint que queima CPU, um vazamento por event handler, bloqueio sync-over-async e um deadlock por ordem de locks), diagnostica cada sintoma com a ferramenta certa no macOS, mostra a saída real e diz exatamente o que funcionou aqui, o que precisou de contorno e o que só o Linux oferece. Versões usadas: SDK 10.0.100 (runtime 10.0.0), `dotnet-counters`, `dotnet-trace`, `dotnet-dump`, `dotnet-gcdump` e `dotnet-stack` 10.0.750501.

## Use Cases

- Achar o método que queima CPU por trás de um endpoint lento, com poucos segundos de trace do processo vivo.
- Provar que a memória cresce porque objetos continuam enraizados (e por quem), e não porque o GC está preguiçoso.
- Explicar por que as requisições fazem fila enquanto a CPU está ociosa: threads bloqueadas em `.Result` ou num lock.
- Acompanhar métricas de GC, thread pool e CPU de um container durante um incidente sem tocar no código.

## Deep Dive

### Instalando as ferramentas e achando o processo

Instalei as cinco ferramentas numa pasta em vez de globalmente (`dotnet tool install --tool-path ./tools dotnet-counters`, e assim por diante); todas vieram na versão `10.0.750501`. Cada ferramenta tem um comando `ps`. Com o app de exemplo rodando:

```text
$ dotnet-trace ps
  2166  BrokenShop    .../BrokenShop/bin/Release/net10.0/BrokenShop
$ ls $TMPDIR | grep dotnet-diagnostic
dotnet-diagnostic-2166-1793201850-socket
```

Esse Unix domain socket é a porta de diagnóstico. A documentação explica que todo processo .NET abre uma por padrão (um named pipe no Windows) e as ferramentas se conectam a ela pelo pid. Ela é criada com permissões `srw-------`, e por isso a ferramenta precisa rodar com o mesmo usuário do app (ou como root). A documentação avisa que ela expõe tudo o que está na memória, segredos inclusive. Subi o mesmo app com `DOTNET_EnableDiagnostics=0`: nenhum socket apareceu, `dotnet-trace ps` deixou de listá-lo e `dotnet-stack report -p <pid>` falhou com:

```text
[ERROR] Microsoft.Diagnostics.NETCore.Client.ServerNotAvailableException: Unable to connect to Process 89451. Please verify that /var/folders/.../T/ is writable by the current user. If the target process has environment variable TMPDIR set, please set TMPDIR to the same directory.
```

A mensagem aponta uma armadilha comum: ferramenta e app precisam enxergar o mesmo `TMPDIR`. `DOTNET_DiagnosticPorts` faz o contrário: o runtime se conecta a um socket em que uma ferramenta escuta. A documentação diz que isso permite a uma ferramenta de monitoramento esperar pelos apps em vez de procurá-los, e a documentação do counters usa isso para observar um app desde a inicialização.

### EventPipe: a base da maioria dessas ferramentas

A documentação descreve o EventPipe como um componente do runtime que coleta eventos do próprio runtime (GC, JIT, thread pool, um amostrador de pilhas) e de qualquer `EventSource`, serializa tudo no formato `.nettrace` e transmite pela porta de diagnóstico. `dotnet-counters`, `dotnet-trace`, `dotnet-gcdump` e `dotnet-stack` são clientes do EventPipe, e por isso não precisam de privilégio de administrador e funcionam igual no Windows, Linux e macOS. O preço, segundo a mesma página: as pilhas têm só frames gerenciados, e não há eventos do kernel nem nativos. O `dotnet-dump` é diferente: ele pede ao runtime que execute o `createdump`, que lê a memória do processo.

### Sintoma 1: um endpoint lento (dotnet-trace)

O bug: `GET /report` conta primos com divisão por tentativa que nunca para na raiz quadrada.

```csharp
[MethodImpl(MethodImplOptions.NoInlining)]
static bool IsPrime(int n)
{
    for (int d = 2; d < n; d++) if (n % d == 0) return false; // sem limite na raiz: o bug
    return true;
}
```

Uma requisição levou `6.6 s`. Com requisições em andamento, coletei 8 segundos com os dois perfis que `dotnet-trace list-profiles` oferece para isso (`collect-linux` adiciona amostragem de CPU do kernel, só no Linux):

```bash
dotnet-trace collect -p 2166 --profile dotnet-common,dotnet-sampled-thread-time --duration 00:00:00:08 -o report.nettrace
```

```text
Provider Name                           Keywords            Level               Enabled By
Microsoft-Windows-DotNETRuntime         0x000000100003801D  Informational(4)    --profile
Microsoft-DotNETCore-SampleProfiler     0x0000F00000000000  Informational(4)    --profile
```

O resultado foi um arquivo `.nettrace` de 3.2 MB. `dotnet-trace report <arquivo> topN` lê esse arquivo no terminal:

```text
Top 10 Functions (Exclusive)                              Inclusive    Exclusive
1.  Monitor.Wait(class System.Object,int32)               25.81%       25.81%
2.  LowLevelLifoSemaphore.WaitNative(...)                 22.58%       22.58%
3.  Missing Symbol                                        17.21%       17.21%
4.  ... three more wait frames at 8.6% each ...
7.  BrokenShop!ReportBuilder.IsPrime(int32)               8.58%        8.58%
```

O culpado ficou só em sétimo. O amostrador tira cerca de 100 pilhas por segundo de cada thread gerenciada, rodando ou não, então isso é tempo de relógio, e as threads ociosas que esperam dominam. Cada linha de cerca de 8.6% é mais ou menos uma thread pela janela inteira. Passe pelos frames de `Wait`: `IsPrime` é o único frame da aplicação. `dotnet-trace convert report.nettrace --format speedscope` gerou `report.speedscope.json` (abra em speedscope.app). Um script Python curto que percorre os eventos de abertura e fechamento e soma o tempo por pilha folha (últimos três frames, em ms) imprimiu:

```text
total sampled thread time: 85094 ms (12 threads)
21026 System.Threading.LowLevelLifoSemaphore.WaitForSignal > System.Threading.LowLevelLifoSemaphore.WaitNative > UNMANAGED_CODE_TIME
16020 System.Threading.ManualResetEventSlim.Wait > System.Threading.Monitor.Wait > UNMANAGED_CODE_TIME
16020 System.Net.Sockets.SocketAsyncEngine.EventLoop > ? > UNMANAGED_CODE_TIME
 7986 dynamicClass.lambda_method1 > ReportBuilder.IsPrime > UNMANAGED_CODE_TIME
```

`IsPrime` esteve numa pilha por 7986 ms da janela de 8000 ms, abaixo do delegate do endpoint. No macOS, toda pilha terminou em `UNMANAGED_CODE_TIME`, até o laço puramente gerenciado, então aqui o conversor não conseguiu separar tempo rodando de tempo bloqueado. A documentação indica um profiler que enxerga o kernel para pilhas reais de CPU: `dotnet-trace collect-linux` (.NET 10, root, kernel 6.4+) ou `perf` no Linux, ETW no Windows.

### Métricas ao vivo com dotnet-counters

`dotnet-counters monitor -p <pid>` redesenha uma tabela no lugar com códigos de escape ANSI, bom para um humano mas impossível de capturar. `collect` grava CSV ou JSON. Rodei `dotnet-counters collect -p 2166 --counters System.Runtime --format json -o c1.json --duration 00:00:00:05` com duas requisições de `/report` em andamento:

```text
dotnet.process.cpu.time (s / 1 sec)        cpu.mode=user   2.0097
dotnet.process.cpu.time (s / 1 sec)        cpu.mode=system 0.0039
dotnet.thread_pool.work_item.count ({work_item} / 1 sec)    28
dotnet.gc.last_collection.heap.size (By)   gc.heap.generation=gen0  0
```

Dois segundos de CPU por segundo significam dois cores ocupados. O tamanho do heap é 0 porque descreve a última coleta, e nenhuma tinha acontecido ainda. `dotnet-counters list` não lista mais os nomes nesta versão; ele imprime um link para a página de métricas embutidas. Misturar o meter `System.Runtime` e o antigo `EventCounters\System.Runtime` numa mesma lista de `--counters` é recusado ("Using the same provider name with and without the EventCounters\ prefix in the counter list is not supported").

### Sintoma 2: memória que só cresce (dotnet-gcdump)

O bug é um clássico: um objeto de vida curta assina um evento estático e nunca cancela a assinatura, então o evento o mantém vivo para sempre:

```csharp
class OrderSession
{
    readonly byte[] _lines = new byte[10_000];
    public OrderSession(int id) => PriceFeed.PriceChanged += OnPriceChanged;   // nunca -=
    void OnPriceChanged(object? s, EventArgs e) => _lines[0]++;
}
```

Rodei `dotnet-gcdump collect -p 8218 -o snap1.gcdump` depois de 2001 requisições, de novo depois de 5002, e `dotnet-gcdump report` em cada arquivo:

```text
Warning: the target runtime does not support non-lossy (Block) buffering, which requires .NET 11+. Falling back to the default lossy buffering; the gcdump may be incomplete on large heaps.
	Finished writing 760370 bytes.

snap1:  21,437,578  GC Heap bytes      19,720  GC Heap objects
snap2:  52,068,624  GC Heap bytes      31,659  GC Heap objects

   Object Bytes     Count  Type                                      (snap1 -> snap2 count)
         10,024     2,001  System.Byte[] (Bytes > 10K)               -> 5,002
             64     2,002  System.EventHandler                       -> 5,003
             32     2,001  OrderSession  [BrokenShop.dll]            -> 5,002
```

Leia as colunas com cuidado: "Object Bytes" é o tamanho de uma instância, não o total, então os 2,001 arrays de 10,024 bytes somam 20 MB. Um tipo cuja contagem acompanha o número de requisições entre dois retratos é o vazamento. A documentação diz que um gcdump é montado a partir dos eventos de uma coleta gen 2 induzida, então o que ele mostra sobreviveu a um GC completo (está enraizado). Os arquivos são pequenos (menos de 1 MB) porque guardam o grafo de objetos, não a memória. O que um gcdump não diz em texto é o caminho até a raiz: o report só tem a visão heapstat. Para isso você precisa de um dump.

### Sintoma 2 de novo: dotnet-dump e SOS

Meu primeiro `dotnet-dump collect` no macOS falhou na hora:

```text
Problem launching createdump (may not have execute permissions): execve(/usr/local/share/dotnet/shared/Microsoft.NETCore.App/10.0.0/createdump) FAILED Permission denied (13)
```

Nesta máquina, o `createdump` do runtime 10.0.0 estava sem bit de execução (`-rw-r--r--`), enquanto os do 8.0.22 e do 9.0.11 tinham. Não alterei a instalação do sistema: copiei o runtime para uma pasta privada, rodei `chmod +x` nessa cópia e subi o app com `DOTNET_ROOT` apontando para ela. A tentativa seguinte falhou uma vez depois de 20 s com "This failure may be because createdump or the application is not properly signed and entitled"; as três tentativas depois dela funcionaram. Tamanhos: um dump Full padrão teve 7,621,153,320 bytes (7.6 GB, inclui todas as páginas mapeadas), `--type Heap` teve 702 MB. A análise de um dump do macOS no macOS funcionou:

```bash
dotnet-dump analyze leak.dmp -c "dumpheap -stat" -c "dumpheap -stat -live" -c "eeheap -gc" -c exit
```

```text
dumpheap -stat (tail):
00010b69c400  6,291 30,427,784 System.Byte[]
00010e5e4880  3,001 36,108,032 System.Delegate[]
Total 488,036 objects, 108,234,738 bytes

dumpheap -stat -live (tail):
00010e410108 3,001     96,032 OrderSession
00010e5e33d0 3,002    192,128 System.EventHandler
00010b69c400 3,134 30,090,718 System.Byte[]
Total 19,987 objects, 31,409,510 bytes
eeheap -gc:  Number of GC Heaps: 14 ... GC Allocated Heap Size: Size: 0x6781870 (108533872) bytes.
```

O `dumpheap -stat` puro conta lixo que ainda não foi coletado: os 36 MB de `Delegate[]` vieram do `GetInvocationList()` na minha própria propriedade de contagem e estavam todos mortos. Com `-live` só restam objetos alcançáveis, e o vazamento salta aos olhos. `eeheap -gc` mostrou 14 heaps porque o ASP.NET Core usa Server GC (um heap por core). Depois, a pergunta que o gcdump não responde, quem segura um `OrderSession`:

```text
> gcroot 7b1c0796e0
HandleTable:
    0000000106bf15e8 (strong handle)
          -> 007f7c007028     System.Object[]
          -> 007c5c837508     System.EventHandler
          -> 007e5c58b0d0     System.Object[]
          -> 007bdc006788     System.EventHandler
          -> 007b1c0796e0     OrderSession
Found 1 unique roots.
```

Um strong handle para o array de campos estáticos, o `EventHandler` multicast guardado em `PriceChanged`, sua lista de invocação, um delegate e o seu alvo. A correção é o `-=` (ou um evento fraco). Um dump guarda todos os segredos que estão na memória, então trate-o como um backup de banco de dados.

### Sintoma 3: starvation do thread pool (dotnet-stack e counters)

O bug: um endpoint bloqueia em trabalho assíncrono.

```csharp
app.MapGet("/quote", () => QuoteService.GetQuoteAsync().Result);   // GetQuoteAsync faz await Task.Delay(100)
```

Sozinha, uma requisição levou `0.16 s`. Com 300 requisições concorrentes o thread pool deu conta (máximo de 0.86 s), então mandei 6000 com 500 em voo. Latência: p50 `2.5 s`, p99 `6.8 s`, máximo `8.6 s`, para 100 ms de trabalho. `dotnet-stack report -p <pid>` 10 segundos depois imprimiu 135 threads, e 125 delas estavam assim:

```text
Thread (0x6C32E):
  [Native Frames]
  System.Private.CoreLib!System.Threading.Tasks.Task.InternalWaitCore(int32,value class System.Threading.CancellationToken)
  Anonymously Hosted DynamicMethods Assembly!dynamicClass.lambda_method3(...)
  Microsoft.AspNetCore.Routing!Microsoft.AspNetCore.Routing.EndpointMiddleware.Invoke(class Microsoft.AspNetCore.Http.HttpContext)
  ...
  System.Private.CoreLib!System.Threading.PortableThreadPool+WorkerThread.WorkerThreadStart()
```

Threads do pool esperando uma `Task` dentro de um endpoint é a assinatura do sync-over-async. Repare que o nome do handler sumiu: a lambda foi inlined no delegate gerado, mais um motivo para colocar handlers em métodos com nome. Na mesma execução coletei `dotnet.thread_pool.thread.count` e `dotnet.thread_pool.queue.length` e achei uma armadilha: o `collect` rotula os dois como `(... / 1 sec)` e imprime a variação por intervalo, com valores negativos, não o nível. A primeira amostra é o nível inicial, então somei:

```text
time      thread.count  queue.length    level: threads / queued items
15:56:19  11            0               11 / 0
15:56:20  39            209             50 / 209
15:56:21  14            171             64 / 380
15:56:24  8             578             91 / 793
...
15:56:41  4             202             173 / 468
```

As threads foram de 11 para 173 em cerca de 22 segundos, poucas por segundo depois da primeira rajada, enquanto centenas de itens esperavam na fila. Essa injeção lenta e constante é o pool tentando salvar uma starvation que ele não consegue resolver: cada thread nova é bloqueada de novo pela próxima requisição.

### Sintoma 3b: um deadlock por ordem de locks (dotnet-stack, depois syncblk)

`GET /transfer` dispara duas tasks: uma faz `lock (AccountA) { Thread.Sleep(100); lock (AccountB) { } }`, a outra pega os mesmos locks na ordem inversa, e o endpoint espera as duas com `Task.WaitAll`. O `curl -m 3` desistiu depois de 3 s. `dotnet-stack report` mostrou a thread da requisição em `Task.WaitAll` abaixo de `BrokenShop!Bank.Transfer()` e duas threads presas em `Monitor.Enter_Slowpath` abaixo de `Bank+<>c.<Transfer>b__2_0()` e `b__2_1()`. As pilhas mostram quem espera, não quem é dono. O `syncblk` do SOS num dump Heap respondeu isso:

```text
Index         SyncBlock MonitorHeld Recursion Owning Thread Info          SyncBlock Owner
    7 0000007C18C79218            3         1 0000007C19351F80 8ea0a  33   00000072bc874638 System.Object
    8 0000007C18C79270            3         1 0000007C19352300 8ea0b  34   00000072bc874650 System.Object
```

Dois locks, cada um com uma thread dona (`MonitorHeld 3` é um dono mais um esperando). Um processo em deadlock também ignorou o `kill` (SIGTERM): parou de escutar a porta, mas continuou vivo até o `kill -9`.

### Containers, permissões e Linux

Não pude rodar Docker aqui, então isto vem da documentação. As ferramentas podem rodar no mesmo container, no host ou num sidecar. Um sidecar precisa de namespace de processos compartilhado e do `/tmp` do alvo montado, porque o socket fica lá; sem isso ele informa que o processo está "not running compatible .NET runtime". `--diagnostic-port <caminho>` aponta uma ferramenta para o caminho do socket mapeado. O `dotnet-dump` precisa de ptrace (`--cap-add=SYS_PTRACE`), e o caminho do dump é resolvido no sistema de arquivos do alvo. O `dotnet-monitor` é a alternativa feita para isso: a documentação o descreve como uma ferramenta para coletar dumps, traces, logs e métricas em produção, sob demanda ou por regras, por uma API HTTP (padrão `https://localhost:52323`). Limites de memória apertados importam: a documentação observa que coletar um dump pode fazer o alvo carregar muita memória.

### Qual ferramenta para qual sintoma

| Sintoma | Primeira ferramenta | Depois |
|---|---|---|
| CPU alta, endpoint lento | `dotnet-counters` (cpu.time) | `dotnet-trace collect`, depois `report topN` ou speedscope |
| Memória sempre crescendo | `dotnet-counters` (tamanho do heap do GC) | dois `dotnet-gcdump`, depois `dotnet-dump` + `gcroot` |
| Requisições em fila, CPU ociosa | `dotnet-counters` (thread_pool) | `dotnet-stack report` |
| Travamento ou deadlock | `dotnet-stack report` | `dotnet-dump` + `syncblk` |
| Crash | `DOTNET_DbgEnableMiniDump=1` (docs: dump no crash) | `dotnet-dump analyze` |

## Trade-offs

- **As ferramentas funcionam em qualquer processo, então qualquer um com o mesmo usuário consegue ler a memória dele.** A porta de diagnóstico e os dumps expõem a memória, inclusive segredos. Desative com `DOTNET_EnableDiagnostics=0` onde isso importa e trate dumps como dados de produção.
- **Amostragem de thread time é tempo de relógio, não de CPU.** Esperas ociosas enchem o topo do `topN`; pule os frames de `Wait` e, no Linux, use `collect-linux` (root, kernel 6.4+) para pilhas reais de CPU.
- **Um gcdump é barato, mas raso.** Menos de 1 MB e sem precisar de ptrace, mas sem caminhos até a raiz em texto e com perdas em runtimes anteriores ao .NET 11. Um dump responde tudo e pesa de centenas de MB a GB.
- **Coletar não é de graça.** Um gcdump induz uma coleta gen 2, um dump Full copiou 7.6 GB aqui (cerca de 24 s com `--diag`) e um trace aloca um buffer no alvo (`--buffersize`, 256 MB por padrão).
- **Leia as unidades dos contadores.** `/ 1 sec` num up-down counter na saída do `collect` significa variação por intervalo, não o valor atual.
  ```text
  dotnet.thread_pool.queue.length ({work_item} / 1 sec)  -72
  ```
- **Sua plataforma local não é produção.** No macOS, uma permissão quebrada do `createdump` e uma falha intermitente de assinatura atrapalharam; ensaie o runbook de incidente no sistema operacional em que você faz deploy.

## Documentation Links

- [dotnet-trace performance analysis utility, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-trace) (doc)
- [Investigate performance counters (dotnet-counters), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) (doc)
- [Dump collection and analysis utility (dotnet-dump), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-dump) (doc)
- [Heap analysis tool (dotnet-gcdump), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-gcdump) (doc)
- [Inspect managed stack traces (dotnet-stack), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-stack) (doc)
- [Collect diagnostics in Linux containers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/diagnostics-in-containers) (doc)
