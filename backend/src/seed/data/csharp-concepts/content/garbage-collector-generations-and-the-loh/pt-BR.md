---
version: 1.0
updatedAt: 2026-10-15
title: "O Garbage Collector: Gerações e o LOH"
summary: Gerações 0, 1 e 2 e a promoção, o large object heap e o pinned object heap, GC workstation versus server, background GC e DATAS, limites em container, o que mudou no .NET 10, os mitos do GC.Collect e as ferramentas para medir, com números do .NET 10.
---
## Objective

O garbage collector do .NET é geracional, compactador e configurável, e a
maioria das aplicações nunca precisa mexer nele. Quando precisa (um serviço
cuja memória não para de subir num container, picos de latência, um job em
lote fazendo milhares de coletas completas), as perguntas são sempre as mesmas:
qual geração está sendo coletada e por quê, o que vai parar no large object
heap, qual sabor de GC está rodando e que limite ele enxerga. Este conceito
responde a elas com medições no .NET 10 e aponta as configurações e
ferramentas que importam. Liberar recursos que não são memória é assunto de
IDisposable, Finalizers e Limpeza Determinística.

## Use Cases

- Ler o `dotnet-counters` durante um incidente e distinguir atividade normal
  de gen0 de uma tempestade de gen2.
- Descobrir por que um serviço que aloca buffers de 1 MB passa o tempo em GCs
  completos.
- Escolher GC workstation ou server para um worker, uma API web ou um sidecar
  pequeno.
- Dimensionar o limite de memória de um container e saber que limite de heap o
  .NET deriva dele.
- Decidir se uma chamada a `GC.Collect()` num código antigo deve ficar.

## Deep Dive

### Gerações e promoção

Objetos pequenos novos começam na geração 0. Coletar uma geração também coleta
as mais novas, e todo sobrevivente sobe uma geração, até a 2; uma coleta de
gen2 é uma coleta completa.

```csharp
var o = new object();
GC.GetGeneration(o);   // 0
GC.Collect(0);         // o sobrevive: geração 1
GC.Collect(1);         // geração 2
GC.Collect();          // continua na 2
```

Um objeto recém-criado e vivo que passou por um único `GC.Collect()` completo
ficou na geração 1: a promoção é um degrau por coleta sobrevivida, não direto
para a 2. A razão das gerações é que a maioria dos objetos morre cedo, então
coletar a gen0 é barato. O custo acompanha o que sobrevive, não o que é
alocado. Alocar um milhão de arrays de 1 KB com GC workstation mediu:

| Carga (1 GB alocado) | gen0 | gen1 | gen2 | Pausa total |
|---|---|---|---|---|
| todo array morre na hora | 125 | 0 | 0 | 3,1 a 3,7 ms |
| um array em cada dez guardado numa lista (100 MB vivos) | 128 | 34 | 4 | 20 a 27 ms |

Mesmo volume de alocação, várias vezes a pausa, porque os sobreviventes
precisam ser marcados, copiados e promovidos.

### O large object heap e o pinned object heap

Objetos de 85.000 bytes ou mais vão para o large object heap (LOH), que
logicamente faz parte da geração 2 e só é coletado em coletas de gen2. O
tamanho inclui o cabeçalho do objeto (24 bytes num `byte[]` de 64 bits), então
a fronteira não fica onde você imaginaria:

```csharp
GC.GetGeneration(new byte[84_975]);    // 0
GC.GetGeneration(new byte[84_976]);    // 2: 84.976 + 24 = 85.000 bytes
GC.GetGeneration(new double[10_620]);  // 0
GC.GetGeneration(new double[10_622]);  // 2
```

O LOH é varrido para uma lista de espaços livres em vez de compactado, para
não copiar blocos grandes. Dá para pedir compactação com
`GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce`,
e o runtime o compacta sozinho quando há um limite rígido de heap. A parte cara
é a rotatividade: alocar objetos no LOH consome o orçamento do LOH, e esgotá-lo
dispara uma coleta de gen2.

| 2.000 buffers temporários de 1 MB | Tempo | Alocado | Coletas de gen2 |
|---|---|---|---|
| `new byte[1 << 20]` (workstation) | 45 a 62 ms | 2.000 MB | 666 |
| `new byte[1 << 20]` (server, com ou sem DATAS) | 84 a 103 ms | 2.000 MB | 68 |
| `ArrayPool<byte>.Shared.Rent`/`Return` | 0 ms | 1 MB | 0 |

Usar pool para buffers grandes é a correção documentada. Um terceiro heap
físico, o pinned object heap (POH), guarda arrays alocados com
`GC.AllocateArray<T>(length, pinned: true)` (.NET 5 em diante); eles nunca se
movem, o que serve para buffers entregues a código nativo por muito tempo.
`GC.GetGeneration` informou um array desses como geração 2. Desde o .NET 7, em
Windows e Linux de 64 bits, o GC organiza a memória em regiões (4 MB para
objetos pequenos por padrão, oito vezes isso para LOH e POH) em vez de
segmentos grandes.

### Workstation, server, background e DATAS

GC workstation é o padrão de aplicações standalone; um host pode mudar isso, e
o Web SDK (`Microsoft.NET.Sdk.Web` no SDK 10.0.100) define
`ServerGarbageCollection` como `true` a menos que o projeto diga outra coisa.

- **Workstation** coleta na thread que disparou o GC, com um heap só. É sempre
  usado numa máquina com uma única CPU lógica.
- **Server** cria um heap e uma thread de GC dedicada por CPU lógica
  (`HeapCount=14` nesta máquina de 14 núcleos, lido de
  `GC.GetConfigurationVariables()`). O orçamento de gen0 é muito maior: a carga
  de 1 GB de vida curta acima rodou 7 coletas de gen0 em vez de 125. Vários
  processos com server GC numa máquina pequena disputam os mesmos núcleos.
- **Background GC** vem ligado por padrão nos dois sabores. Ele vale só para a
  gen2: a coleta completa roda em threads dedicadas enquanto coletas de gen0 e
  gen1 (foreground) continuam acontecendo, pausando as threads gerenciadas por
  pouco tempo.
- **DATAS** (adaptação dinâmica ao tamanho da aplicação) era opt-in no .NET 8 e
  vem ligado por padrão desde o .NET 9. Ele começa com um heap e aumenta ou
  diminui a quantidade de heaps, buscando um heap proporcional aos dados vivos
  e não à máquina. A documentação relata uma grande redução de working set por
  um custo de 2 a 3 por cento de throughput no benchmark dela;
  `<GarbageCollectionAdaptationMode>0</GarbageCollectionAdaptationMode>`
  desliga.

### Containers e limites

Dentro de um container com limite de memória, o limite rígido padrão do heap é
o maior entre 20 MB e 75 por cento desse limite (`GCHeapHardLimitPercent` muda
a porcentagem, `GCHeapHardLimit` fixa em bytes). Rodar o exemplo com
`DOTNET_GCHeapHardLimit=0x10000000` fez
`GC.GetGCMemoryInfo().TotalAvailableMemoryBytes` informar 256 MB em vez dos
36.864 MB da máquina. O limite cobre só o heap do GC, então o resto do limite
do container é o que sobra para stacks de threads, código do JIT e memória
nativa. `GCConserveMemory` (0 a 9) troca coletas mais frequentes por um heap
menor, e `GCHeapCount` limita os heaps do server GC.

### O que mudou no .NET 10

As notas do runtime do .NET 10 trazem uma mudança específica de GC: no Arm64 o
runtime agora pode alternar entre implementações de write barrier, como já
fazia no x64, e o novo padrão do Arm64 acompanha as regiões do GC com mais
precisão; os benchmarks da Microsoft mostram melhoras de pausa de 8 por cento a
mais de 20 por cento. A página de configuração do GC também lista ajustes do
.NET 10: nomes de `runtimeconfig.json` para `RegionRange` e `RegionSize`, e
três controles do orçamento de gen0 do DATAS (`DGen0GrowthPercent`,
`DGen0GrowthMaxFactor`, `DGen0GrowthMinFactor`). À parte, a análise de escape
mais ampla do JIT coloca alguns arrays pequenos e delegates na stack, e o GC
nem chega a vê-los; Value Types, Reference Types e Boxing mede isso.

### `GC.Collect` e medição

`GC.Collect()` força uma coleta completa e bloqueante. Além da pausa, ela
promove tudo o que ainda está vivo, e dados de vida curta viram dados de gen2
que só outro GC completo libera. A documentação reserva a chamada para pontos
raros em que muita memória acabou de virar lixo, e oferece
`GCCollectionMode.Optimized` para deixar o GC recusar. Para olhar antes de
ajustar:

```csharp
GC.CollectionCount(0);              // coletas por geração
GC.GetTotalPauseDuration();         // .NET 7+
GC.GetTotalAllocatedBytes();
GC.GetGCMemoryInfo();               // tamanho do heap, fragmentação, tamanho por geração, % de pausa
```

Para um processo rodando, `dotnet-counters monitor` mostra ao vivo contagem de
GCs, tamanho do heap e taxa de alocação, e `dotnet-gcdump collect` captura
quais tipos ocupam o heap sem um dump completo de memória. Ele faz isso
induzindo uma coleta de gen2, o que pode pausar por bastante tempo um processo
com heap grande.

## Trade-offs

- **GC workstation versus server.** Server GC dá mais throughput num host
  multinúcleo dedicado, mas usa uma thread de GC por núcleo e pode deixar o
  heap crescer muito mais; para muitos containers ou sidecars pequenos,
  workstation (ou server com DATAS) mantém a pegada baixa.
- **DATAS ligado versus desligado.** O DATAS mantém o heap perto dos dados
  vivos e devolve memória quando a carga cai, com um custo pequeno de
  throughput e mais coletas de gen0; um serviço crítico em latência numa
  máquina dedicada pode preferir desligá-lo.
  ```xml
  <GarbageCollectionAdaptationMode>0</GarbageCollectionAdaptationMode>
  ```
- **Alocar buffers grandes versus usar pool.** `new byte[1 MB]` é simples e
  cada um empurra o orçamento do LOH rumo a uma coleta de gen2; `ArrayPool`
  elimina esse custo mas exige devolver todo buffer e nunca mais usá-lo depois.
- **Pinning.** O POH evita que buffers nativos travem a compactação, mas
  memória pinada nunca é compactada; use só para buffers de vida longa, e
  `fixed` para chamadas nativas curtas.
- **`GC.Collect` versus confiar no GC.** Uma coleta forçada pode deixar o
  gráfico de memória bonito numa demo e pior em produção, promovendo dados
  vivos e somando pausas. Meça com counters antes de manter uma.

## Documentation Links

- [Fundamentals of garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/fundamentals) (doc)
- [Workstation vs. server garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/workstation-server-gc) (doc)
- [Background garbage collection, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/background-gc) (doc)
- [Dynamic adaptation to application sizes (DATAS), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/datas) (doc)
- [Garbage collector config settings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/garbage-collector) (doc)
- [Large object heap, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/large-object-heap) (doc)
- [What's new in .NET 10 runtime: Arm64 write-barrier improvements, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/runtime#arm64-write-barrier-improvements) (doc)
- [dotnet-counters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) (doc)
