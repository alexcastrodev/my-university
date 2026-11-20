---
version: 1.0
updatedAt: 2026-11-20
title: "Ajuste do GC: Server, Workstation, Concorrente e Regiões Sem GC"
summary: Workstation contra Server, GC em segundo plano, GCSettings.LatencyMode, GC.TryStartNoGCRegion, DATAS, GCConserveMemory, GCHeapCount e limites de heap em container, medidos com um programa de carga no macOS e numa VM Linux do Docker.
---
## Objective

[The Garbage Collector: Generations and the LOH](/csharp-concepts/garbage-collector-generations-and-the-loh)
explica o que o coletor faz. Este concept trata dos botões: Workstation ou
Server, concorrente ou não, `GCSettings.LatencyMode`, `GC.TryStartNoGCRegion`,
os limites de heap que decidem o que acontece dentro de um container,
`GCConserveMemory`, `GCHeapCount` e DATAS. Um programa de carga (8 threads, 100
MB de dados vivos, cerca de 12 GB de lixo por segundo) rodou sob cada
configuração e reportou vazão, pausas e pico de memória. O resumo: os padrões
são bons, uma configuração que parece vitória grátis (`LowLatency`) deixou o
programa 7 vezes mais lento, e um padrão documentado (DATAS) não faz nada na
máquina macOS usada aqui. Todo número pertence a este hardware (Apple M4 Max, 14
núcleos, 36 GB, macOS) ou a uma VM Linux do Docker Desktop (14 CPUs, 8 GB), e
nada disso se generaliza para o seu.

Versões: .NET SDK 10.0.100, TFM `net10.0`, nenhum pacote NuGet (só o shared
framework). Runtime do host Microsoft.NETCore.App 10.0.0 (macOS arm64); os
testes em container usaram `mcr.microsoft.com/dotnet/sdk:10.0` com o runtime
10.0.14 (Linux arm64).

## Use Cases

- Escolher Workstation, não concorrente ou Server para um worker, uma API e um
  sidecar com medição em vez de regra de bolso.
- Ler um orçamento de pausa e conferir o que o runtime leu da configuração.
- Dimensionar um container: que limite de heap o .NET deriva de `--memory`.
- Revisar código com `GCLatencyMode.LowLatency` ou `GC.TryStartNoGCRegion` num serviço.

## Deep Dive

### Onde as configurações vivem, e qual vence

Uma configuração pode vir do `runtimeconfig.json` (`System.GC.Server`), de uma
propriedade do MSBuild (`ServerGarbageCollection`) ou do ambiente
(`DOTNET_gcServer`). O ambiente vence: com `"System.GC.Server": true` no
arquivo, `DOTNET_gcServer=0` rodou Workstation, e `DOTNET_GCConserveMemory=2`
ganhou de `ConserveMemory: 5` no arquivo. Números em variáveis de ambiente são
hexadecimais (`DOTNET_GCHeapCount=0x4`), em JSON são decimais.

O `AppContext` aqui é leitor, não escritor. `AppContext.SetData("System.GC.Server",
true)` no início deixou `GCSettings.IsServerGC` em `False`: o GC lê a configuração
antes do `Main`. Para ver o que o runtime usa, pergunte a ele:

```csharp
foreach (var kv in GC.GetConfigurationVariables().OrderBy(k => k.Key))
    Console.WriteLine($"{kv.Key} = {kv.Value}");   // ServerGC, ConcurrentGC, HeapCount, GCDynamicAdaptationMode, ...
```

### Meça as pausas antes de mudar qualquer coisa

`GC.CollectionCount(gen)` conta coleções, `GC.GetTotalPauseDuration()` é o tempo
total em que as threads gerenciadas ficaram suspensas desde o início (amostre
antes e depois de uma fase), e `GC.GetGCMemoryInfo(kind)` descreve o último GC de
um tipo (`Ephemeral`, `FullBlocking`, `Background`), ou seja, um GC, não uma
média (um gen2 em segundo plano varre, um bloqueante compacta):

```text
collections gen0=7 gen1=6 gen2=6
total pause=0.60 ms, allocated=190 MB
Ephemeral    index=6 gen=0 compacted=False concurrent=False pause=0.03 ms pause%=2.5 heap=101 MB fragmented=27 MB committed=101 MB
FullBlocking index=7 gen=2 compacted=True concurrent=False pause=0.19 ms pause%=3.6 heap=61 MB fragmented=13 MB committed=62 MB
Background   index=5 gen=2 compacted=False concurrent=True pause=0.04 ms pause%=2.4 heap=101 MB fragmented=52 MB committed=101 MB
```

### O programa de carga

Cada uma das 8 threads executa 2 milhões de "requisições" sobre um conjunto vivo
compartilhado de 100.000 arrays de 1 KB (100 MB). Uma requisição monta 30 strings
e 20 arrays pequenos, troca um array vivo em cada quatro e aloca um array de
200.000 bytes (heap de objetos grandes) uma vez em 256. A latência de cada
requisição é registrada, então uma pausa de GC aparece como a pior requisição. A
carga é extrema de propósito (o Workstation ficou pausado 45 a 70% do tempo).

### Workstation, Server, concorrente: medido no macOS

Mediana de 3 execuções cada, 16 milhões de requisições por execução:

| Modo | Req/s | gen0 / gen1 / gen2 | Pausa total | Pior requisição | RSS de pico |
|---|---|---|---|---|---|
| Workstation, não concorrente | 2,40 M | 624 / 233 / 154 | 4,6 s | 31 ms | 313 MB |
| Workstation, concorrente (padrão) | 2,05 M | 8.356 / 2.199 / 151 | 3,4 s | 18 ms | 223 MB |
| Workstation, concorrente, `GCConserveMemory=7` | 1,58 M | 8.625 / 2.453 / 427 | 3,7 s | 15 ms | 237 MB |
| Server (DATAS padrão) | 4,81 M | 60 / 41 / 36 | 1,1 s | 89 ms | 3.477 MB |
| Server, DATAS desligado | 4,93 M | 56 / 40 / 32 | 1,0 s | 83 ms | 3.455 MB |
| Server, `GCConserveMemory=7` | 4,40 M | 85 / 76 / 76 | 1,4 s | 66 ms | 2.576 MB |

- **Concorrente contra não concorrente.** O padrão concorrente teve as
  piores pausas menores (percentil 99,99 da latência de 2 ms contra 11 ms; pior caso 18
  contra 31 ms) com 15 por cento menos vazão, e rodou 13 vezes mais coleções
  gen0 (eu medi isso, e o Linux mostrou proporção parecida; a documentação que li
  não explica). O GC em segundo plano só encurta pausas de gen2, então o preço na
  vazão veio das coleções gen0 extras.
- **Server contra Workstation.** Cerca do dobro da vazão e um terço da pausa
  total, mas a pior requisição foi 5 vezes maior (menos coleções, maiores) e o
  pico de memória 15 vezes maior: o Server GC trata o processo como o dominante
  da máquina.
- **`GCConserveMemory=7`.** No Server cortou 26 por cento do pico de memória por 9
  por cento menos vazão e o dobro de coleções gen2; no Workstation custou 23 por
  cento da vazão e quase triplicou o gen2, sem ganho de RSS. A documentação
  sugere testar de 5 a 7: meça, não é de graça.

### DATAS: padrão só onde existem regions

O DATAS (dynamic adaptation to application sizes) vem ligado por padrão no Server
GC desde o .NET 9: `GCDynamicAdaptationMode` leu `1` sem que eu configurasse. Na
VM Linux (mesmo programa, 2 execuções cada):

| Linux, Server | Req/s | gen0 / gen1 / gen2 | Pausa total | RSS de pico |
|---|---|---|---|---|
| DATAS padrão | 2,78 M | 438 / 155 / 82 | 2,9 s | 712 MB |
| DATAS desligado | 4,11 M | 100 / 67 / 60 | 1,2 s | 2.002 MB |

É a troca documentada: um heap proporcional aos dados vivos, com custo de vazão
(a doc reporta 2 a 3 por cento no benchmark dela; aqui foram 32 por cento, numa
carga hostil). No macOS as mesmas duas linhas ficaram idênticas (4,81 M contra
4,93 M req/s, 3,5 GB nas duas). O `GetConfigurationVariables` mostra o motivo:
`GCRegionRange = 0` no macOS e `16637952000` no Linux. As regions (4 MB para
objetos pequenos, 32 MB para os heaps grandes e fixados) substituíram os
segmentos no .NET 7 apenas no Windows e no Linux de 64 bits. Minha inferência é
que o DATAS precisa de regions (a doc não diz; a medição sim), então no macOS
trate o DATAS como ausente e teste no SO em que vai rodar.

No Linux, definir `GCHeapCount` fez o runtime reportar
`GCDynamicAdaptationMode = 0` e a contagem foi respeitada: 2 heaps, 2,27 M req/s
e 823 MB; 4 heaps, 3,15 M e 1.299 MB; 14 heaps, 4,11 M e 2.002 MB.
`GCHeapAffinitizeMask=0xF` não mudou nada (só docs).

### `GCSettings.LatencyMode`: o que cada valor faz de verdade

Padrões lidos de volta: Workstation concorrente `Interactive`, Workstation não
concorrente `Batch`, Server `Interactive`. Atribuir cada valor em sequência no
Workstation concorrente aceitou os quatro; o Workstation não concorrente ignorou
`SustainedLowLatency` (o valor ficou em `LowLatency`) e o Server ignorou
`LowLatency` (ficou em `Interactive`). Os dois casos batem com a doc:
`LowLatency` é só Workstation e `SustainedLowLatency` exige GC em segundo plano.
Sob o programa de carga (Workstation concorrente, 2 execuções cada, modo
definido no início):

| Modo | Req/s | gen0 / gen2 | Pausa total | RSS de pico | Commit de pico |
|---|---|---|---|---|---|
| `Interactive` | 2,2 M | 8.356 / 151 | 3,3 s | 225 MB | 244 MB |
| `Batch` | 1,9 a 2,3 M | 8.265 / 149 | 4,2 a 4,6 s | 209 MB | 231 MB |
| `SustainedLowLatency` | 2,2 a 2,3 M | 8.355 / 150 | 3,3 a 3,4 s | 224 MB | 245 MB |
| `LowLatency` | 0,3 M | 295.086 / 0 | 36 a 37 s | 1,8 a 2,4 GB | 16,1 GB |

O `Batch` tirou o gen2 em segundo plano (pausas maiores, pior requisição de 27 a
39 ms contra 15 a 17 ms). O `SustainedLowLatency` não mudou nada porque o padrão
já coleta gen2 em segundo plano. O `LowLatency` fez o que a doc descreve, nenhum
gen2, e o heap nunca foi limpo: 295 mil coleções gen0 e gen1, 16 GB de commit
numa máquina de 36 GB, 53 segundos em vez de 7. Serve para uma janela curta, com pouca alocação, numa UI
ou laço de aquisição, nunca para um serviço.

### `GC.TryStartNoGCRegion`: um orçamento, não um interruptor

```csharp
if (GC.TryStartNoGCRegion(200L << 20))     // commit up front, no GC until 200 MB is allocated
{
    try { /* critical section */ }
    finally { if (GCSettings.LatencyMode == GCLatencyMode.NoGCRegion) GC.EndNoGCRegion(); }
}
```

- A chamada roda um GC completo bloqueante para abrir espaço (cada contador de
  geração subiu uma unidade; 6,6 a 7,1 ms com 97 MB vivos).
- Dentro de uma região de 64 MB, 40 MB de arrays de 1 MB causaram 0 coleções e o
  modo continuou `NoGCRegion`. Aos 80 MB o GC rodou (1 coleção no macOS, 6 no
  Linux), o modo voltou em silêncio para `Interactive`, e o `EndNoGCRegion`
  lançou `InvalidOperationException: NoGCRegion mode must be set.`, por isso o
  teste do modo no `finally`.
- Um `TryStartNoGCRegion` aninhado lança `InvalidOperationException` e também
  encerrou a região externa (o `EndNoGCRegion` seguinte lançou). Encerrar duas
  vezes lança.
- Os limites de tamanho dependem da plataforma. O Workstation no macOS aceitou
  até 243 MB e lançou `ArgumentOutOfRangeException` a partir de 244 MB; o Server
  no macOS aceitou até 13.653 MB. Na VM Linux 4.096 MB foi aceito e 16 GB
  devolveu `false`, sem exceção. Com `--memory=1g`, 100 MB foi aceito e 500 MB
  devolveu `false`: a região faz commit da memória de antemão, então o limite do
  container a encolhe. `TryStartNoGCRegion(total, lohSize)` divide o orçamento
  (1 GB com 900 MB para o heap de objetos grandes devolveu `true`).

Agora a parte contraintuitiva. Alocar 100 MB de arrays de 1 KB com 97 MB vivos
levou de 2,4 a 2,5 ms normalmente (13 coleções, 0,4 ms de pausa) e de 6,2 a 6,5
ms dentro de uma região sem GC (0 coleções), depois de 6,6 ms de entrada. As
coleções custaram 0,4 ms no total, e nunca reaproveitar memória significou tocar
páginas novas. Use a região só quando até uma pausa curta num trecho
limitado for inaceitável, e você souber o volume de alocação e puder pagar a entrada.

### Containers: o limite do heap vem do cgroup

[The Garbage Collector](/csharp-concepts/garbage-collector-generations-and-the-loh)
afirma o padrão de 75 por cento; aqui ele foi medido com `docker run --memory`,
alocando arrays de 64 KB até falhar:

| Container | `TotalAvailableMemoryBytes` | Resultado |
|---|---|---|
| `--memory=256m` | 192 MB | `OutOfMemoryException` com 186 MB retidos, RSS 219 MB |
| mais `GCHeapHardLimitPercent=50` | 128 MB | com 123 MB, RSS 155 MB |
| mais `GCHeapHardLimit=64 MB` | 64 MB | com 60 MB, RSS 91 MB |

O runtime lança uma `OutOfMemoryException` capturável no limite dele em vez de o
kernel dar `OOMKill` no processo, que é o objetivo do padrão. O limite cobre só o
heap gerenciado: threads, código JIT e bibliotecas nativas saem dos 25 por cento
restantes. O lado do Kubernetes está em
[Managed Runtime Memory in Containers](/kubernetes-concepts/managed-runtime-memory-in-containers),
que listava o padrão do .NET como "documentado" e agora está medido. `--cpus=2`
fez `Environment.ProcessorCount` valer 2 e o Server GC criou 2 heaps (pedir
`GCHeapCount=4` continuou dando 2). O programa de carga com `--memory=512m`:
Workstation 1,85 M req/s, gen2 133, RSS de pico 332 MB; Server 2,14 M, gen2 242,
pico 364 MB (DATAS ligado ou desligado deu o mesmo, 2,06 M e 341 MB desligado).
O Server encolheu de 3,5 GB sem limite para 364 MB e o DATAS deixou de importar,
porque o limite rígido já limita o heap; a vantagem caiu de 2 vezes para 16 por
cento. Com `--cpus=2`: Server 1,15 M (6,2 s de pausa), Workstation 0,97 M (9,1 s).

### Livro vs hoje

- Artigos antigos recomendam `GC.Collect()` para "liberar memória antes de um
  trabalho grande" e `GCLatencyMode.LowLatency` para responsividade. O
  `LowLatency` acima transformou uma execução de 7 s em 53 s com 16 GB de commit,
  e o concept anterior mostra por que um `GC.Collect()` manual promove dados
  vivos. Nenhum dos dois pertence a um serviço hoje.
- O conselho do .NET Framework (`gcServer` e `gcConcurrent` no `app.config`,
  "Server GC para qualquer servidor web") é anterior aos containers. Hoje as
  flags vivem no `runtimeconfig.json`, o Web SDK usa Server GC por padrão, e num
  container pequeno o usual é começar com Workstation. A doc sugere Workstation
  sem GC concorrente para centenas de instâncias.
- Continua valendo: meça primeiro, mude uma coisa por vez, aloque menos antes.

## Trade-offs

- **Workstation contra Server.** O Server ganhou em vazão (cerca de 2 vezes) e
  pagou 15 vezes a memória e 5 vezes a pior pausa. Para um container pequeno,
  comece com Workstation; num host dedicado com muitos núcleos, meça o Server.
- **Concorrente.** Encurtou a pior requisição (18 contra 31 ms) por 15 por cento
  menos vazão. Desligue-o em lote ou com muitas instâncias pequenas.
- **DATAS.** Heap pequeno no Linux (712 contra 2.002 MB), 32 por cento menos
  vazão numa carga hostil, nenhum efeito no macOS. Se um serviço sensível a
  latência regredir, use `DOTNET_GCDynamicAdaptationMode=0`.
- **Região sem GC.** Nenhuma pausa dentro de um trecho limitado, paga por um GC de
  entrada (cerca de 7 ms aqui) e alocação mais lenta em memória nova; estourar o
  orçamento a encerra em silêncio.
- **`GCConserveMemory`.** Um heap menor (Server com DATAS no Linux: 526 MB contra
  712) por mais coleções e menos vazão. Teste de 5 a 7 e meça.

## Documentation Links

- [Workstation and server garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/workstation-server-gc) (doc)
- [Background garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/background-gc) (doc)
- [Latency modes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/latency) (doc)
- [Dynamic adaptation to application sizes (DATAS), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/datas) (doc)
- [Garbage collector config settings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector) (doc)
- [GC.TryStartNoGCRegion, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.gc.trystartnogcregion) (doc)
- [GCLatencyMode, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.gclatencymode) (doc)
- [GC.GetGCMemoryInfo, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.gc.getgcmemoryinfo) (doc)
- [GC.GetTotalPauseDuration, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.gc.gettotalpauseduration) (doc)
