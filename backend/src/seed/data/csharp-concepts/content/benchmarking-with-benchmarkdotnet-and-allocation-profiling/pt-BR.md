---
version: 1.0
updatedAt: 2026-11-12
title: "Benchmarks com BenchmarkDotNet e Perfil de Alocação"
summary: Por que o Stopwatch engana, BenchmarkDotNet com MemoryDiagnoser, baseline, Ratio e parâmetros, como ler o relatório, as armadilhas (dead code elimination, setup, Debug), .NET 10 contra .NET 11, ArrayPool e ObjectPool medidos e dotnet-counters para alocação em um processo em execução, com números de uma máquina só.
---
## Objective

"Esta versão é mais rápida" e "esta versão aloca menos" são afirmações sobre
números, e um número tirado com um cronômetro em volta de uma chamada quase
nunca é o número que você imagina. BenchmarkDotNet é a ferramenta padrão para
medir código .NET: cuida de aquecimento, tiers do JIT, isolamento de processo e
estatística, e com `[MemoryDiagnoser]` relata as alocações por operação, que é
o número que costuma explicar um serviço lento. Este concept mostra por que um
cronômetro engana, como escrever um benchmark com baseline e parâmetros, como
ler o relatório, quais armadilhas fazem um benchmark não medir nada, como o
pooling aparece nos números e como acompanhar a alocação em um processo em
execução. Todos os números abaixo foram medidos em uma máquina só (um Apple M4
Max, macOS, arm64, 14 núcleos, BenchmarkDotNet 0.15.8). Trate-os como uma
ilustração do método, não como dado sobre o seu hardware.

## Use Cases

- Provar, antes de um pull request, que uma reescrita aloca menos e não é mais
  lenta.
- Escolher entre duas implementações (`+=` contra `StringBuilder`, `new` contra
  `ArrayPool`) com evidência em vez de folclore.
- Ler `Gen0` e `Allocated` para descobrir por que um caminho quente dispara
  muitas coletas.
- Conferir que uma atualização de runtime não causou regressão em um método
  crítico.
- Acompanhar a taxa de alocação de um serviço em execução sem anexar um
  depurador.

## Deep Dive

### Por que o cronômetro engana

Um laço com `Stopwatch.StartNew()` em volta de uma chamada parece bom até você
chamar mais de uma vez. Montar uma string separada por ponto e vírgula a partir
de 100 inteiros com `+=`, cronometrada em cinco chamadas seguidas em um build
Release:

```csharp
for (int i = 0; i < 5; i++)
{
    long before = GC.GetAllocatedBytesForCurrentThread();
    var sw = Stopwatch.StartNew();
    var s = Csv.Plus(values);
    sw.Stop();
    Console.WriteLine($"{sw.Elapsed.TotalMicroseconds:F1} us, {GC.GetAllocatedBytesForCurrentThread() - before} B");
}
```

| Chamada | Tempo (duas execuções) | Alocado |
|---|---|---|
| 0 | 149 us, 283 us | 41.640 B, 39.736 B |
| 1 | 11 us, 9 us | 30.944 B |
| 2 a 4 | cerca de 4 a 6 us | 30.944 B |

A primeira chamada foi de 25 a 60 vezes mais lenta que o regime estável, porque
inclui compilação JIT e custos de primeiro uso. O regime estável precisa de
várias chamadas para aparecer, a compilação em tiers ainda pode mudar o código
depois, e um número isolado não tem dispersão. O BenchmarkDotNet existe para
eliminar exatamente esses problemas: roda o método em outro processo, calibra
quantas operações executar por medição, descarta o aquecimento, repete e
relata a média com um intervalo de erro. Repare que
`GC.GetAllocatedBytesForCurrentThread` já deu o número estável (30.944 bytes)
depois da primeira chamada. Bytes são muito mais repetíveis que tempo, e por
isso o lab deste concept faz asserções sobre eles.

### Um primeiro benchmark

```csharp
[MemoryDiagnoser]
public class ConcatBench
{
    [Params(10, 1000)] public int N;
    private int[] _values = [];

    [GlobalSetup] public void Setup() => _values = Enumerable.Range(0, N).ToArray();

    [Benchmark(Baseline = true)] public string Plus() => Csv.Plus(_values);
    [Benchmark] public string Builder() => Csv.Builder(_values);
}
```

Rode a partir de um projeto console que referencia o pacote `BenchmarkDotNet`,
em Release, fora do depurador:

```csharp
BenchmarkSwitcher.FromAssembly(typeof(Program).Assembly).Run(args);
```

```bash
dotnet run -c Release -- --filter "*ConcatBench*" --job short
```

`--job short` roda menos iterações (três aqui), e por isso a coluna de erro
abaixo é larga. Use o job padrão para uma conclusão que você vai defender.

| Método | N | Média | Ratio | Gen0 | Alocado | Alloc Ratio |
|---|---|---|---|---|---|---|
| Plus | 10 | 72,9 ns | 1,00 | 0,0573 | 480 B | 1,00 |
| Builder | 10 | 49,1 ns | 0,67 | 0,0325 | 272 B | 0,57 |
| Plus | 1000 | 145.528 ns | 1,00 | 459,2 | 3.844.104 B | 1,000 |
| Builder | 1000 | 3.005 ns | 0,02 | 1,99 | 16.680 B | 0,004 |

### Lendo o relatório

- **Baseline e Ratio.** `[Benchmark(Baseline = true)]` marca o método de
  referência; `Ratio` é a média de cada método dividida pela média do baseline
  (a legenda do relatório diz "[Current]/[Baseline]"), então 0,02 significa
  cerca de cinquenta vezes mais rápido. Um ratio só faz sentido dentro de um
  mesmo relatório.
- **`[Params]`** roda cada benchmark uma vez por valor e imprime um bloco por
  valor, separado por uma linha vazia. A tabela acima mostra o motivo: com N =
  10 o builder é 33 por cento mais rápido, com N = 1000 é quase cinquenta vezes
  mais rápido e aloca 230 vezes menos bytes, porque `+=` copia a string inteira
  a cada passo e o custo cresce com o quadrado da entrada. Um tamanho de
  entrada só teria escondido a história.
- **`Gen0`, `Gen1`, `Gen2`** são coletas por 1000 operações: 459 coletas gen0 a
  cada 1000 chamadas de `Plus(1000)`. É o custo que a média não mostra, porque
  recai sobre o processo inteiro.
- **`Allocated`** é a memória gerenciada por operação, incluindo o que o método
  chama; memória nativa não conta.
- **`Error` e `StdDev`** dizem o quanto confiar na `Mean`. Se o erro é uma
  fração grande da média (a linha N = 10 acima, de uma execução curta), não
  conclua nada dessa linha.

### Armadilhas que fazem um benchmark não medir nada

Quatro métodos que parecem benchmarks, em uma classe com `[MemoryDiagnoser]`:

```csharp
[Benchmark] public void Dead()     { var a = new byte[1000]; }
[Benchmark] public int  Kept()     { var a = new byte[1000]; return a.Length + _x; }
[Benchmark] public byte[] Returned() { var a = new byte[1000]; return a; }
[Benchmark] public double Constant() => Math.Sqrt(2.0);
```

| Método | Média | Alocado |
|---|---|---|
| Dead | 0,04 ns | nada |
| Kept | 0,04 ns | nada |
| Returned | 28,5 ns | 1.024 B |
| Constant | cerca de 0 ns | nada |

O BenchmarkDotNet imprimiu um aviso `ZeroMeasurement` para o primeiro, o
segundo e o quarto: "the method duration is indistinguishable from the empty
method duration". O JIT removeu o array que ninguém usava, mesmo em `Kept`,
onde só o tamanho foi lido (a análise de escape descrita em Value Types,
Reference Types and Boxing), e dobrou `Math.Sqrt(2.0)` em uma constante. Só a
versão que devolve o array mediu uma alocação. As regras que decorrem disso:

- **Devolva o resultado** (ou entregue a um `Consumer`/`Blackhole`) para que o
  trabalho não possa ser removido. Isso é dead code elimination.
- **Leia as entradas de campos** preenchidos em `[GlobalSetup]`, nunca de
  constantes, para o JIT não poder dobrar a conta.
- **Deixe o setup fora do método.** Montar a entrada dentro do benchmark mede o
  setup junto; `[GlobalSetup]` roda uma vez e `[IterationSetup]` é último
  recurso, porque distorce benchmarks curtos.
- **Só Release.** Rodando o mesmo projeto em Debug, o BenchmarkDotNet para
  antes de medir: "Assembly Demo which defines benchmarks is non-optimized".
  Rode também fora do depurador e, de preferência, com outros programas pesados
  fechados.
- **Atenção a tiering e aquecimento.** O job padrão roda iterações de
  aquecimento até o método estabilizar; se você reduzir isso, confira que a
  `Mean` não continua caindo.

### Comparando .NET 10 e .NET 11

O BenchmarkDotNet pode rodar o mesmo benchmark em vários runtimes com um job
por runtime. Na 0.15.8, a versão estável na época em que isto foi escrito, isso
é um problema para o .NET 11: o `CoreRuntime` dela tem `Core10_0` e não tem
`Core11_0`, a linha de comando `--runtimes net11.0` é rejeitada ("The provided
runtime "net11.0" is invalid", e a lista termina em `net10_0`), e um projeto
compilado para `net11.0` falha com `NotImplementedException:
GetRuntimeVersion not implemented for NotRecognized` no toolchain padrão. O que
funcionou aqui foi compilar o projeto para os dois target frameworks e rodar
cada build no próprio processo com `--inProcess`, que mede no runtime
hospedeiro sem a checagem de SDK:

```bash
dotnet run -c Release -f net10.0 -- --filter "*VersionBench*" --inProcess
dotnet run -c Release -f net11.0 -- --filter "*VersionBench*" --inProcess
```

| Método | .NET 10.0.0 | .NET 11.0.0 | Alocado (os dois) |
|---|---|---|---|
| `LinqSum` sobre 1000 inteiros | 1,234 us | 1,218 us | 104 B |
| laço com `StringBuilder`, 1000 inteiros | 2,883 us | 2,770 us | 16.680 B |

Diferenças de 1 a 4 por cento com erros de até 2 por cento: nenhuma conclusão
além de "sem regressão aqui". `--inProcess` abre mão do isolamento de processo
que protege um benchmark do estado do próprio hospedeiro, então é um
contorno, não um padrão; veja as notas de versão do BenchmarkDotNet para
suporte de primeira classe ao .NET 11 antes de depender disso.

### Pooling como correção medida

`ArrayPool<T>.Shared` e `ObjectPool<T>` (pacote
`Microsoft.Extensions.ObjectPool`) trocam alocação por reutilização. Se
compensa é uma pergunta para o relatório:

| Método (ShortRun) | Média | Ratio | Gen0/Gen1/Gen2 | Alocado |
|---|---|---|---|---|
| `new byte[100_000]` | 3.401 ns | 1,000 | 31 / 31 / 31 | 100.045 B |
| `ArrayPool<byte>.Shared.Rent` / `Return` | 3,96 ns | 0,001 | nenhuma | nada |
| `new StringBuilder()` mais `ToString()` | 13,2 ns | 0,004 | 0,017 gen0 | 144 B |
| pool de `StringBuilder` `Get` / `Return` | 10,2 ns | 0,003 | 0,005 gen0 | 40 B |

O array acima de 85.000 bytes vive no large object heap, então toda chamada
alimenta coletas gen2 (os 31 da coluna `Gen2`); o pool elimina a alocação por
completo. O caso do builder pequeno é um ganho modesto, e a versão com pool
ainda aloca 40 bytes para a string de resultado. O pooling também tem um custo
de configuração que dá para medir. A política padrão do pool de `StringBuilder`
descarta builders que passaram de 4.096 caracteres, então com um resultado de
3.890 caracteres você paga o pool mais um builder novo a cada chamada:

| Bytes por chamada (1000 chamadas, uma thread) | 100 valores | 1000 valores |
|---|---|---|
| `StringBuilder` do pool | 609 B | 21.176 B |
| `new StringBuilder()` | 2.064 B | 16.680 B |
| `new StringBuilder(capacity)` | 1.880 B | 19.880 B |

Com 100 valores o pool aloca só o resultado (602 B para uma string de 290
caracteres). Com 1000 valores a versão com pool alocou mais que um builder
simples, porque o builder nunca sobrevivia ao limite de tamanho do pool (o
`InitialCapacity` da política é 100 e o `MaximumRetainedCapacity` é 4.096, lidos
de `StringBuilderPooledObjectPolicy`). Um pool é uma troca, não um ganho de
graça: meça com os seus tamanhos reais. O mesmo vale para o `ArrayPool` (limpe
dados sensíveis no `Return` com `clearArray: true` e nunca toque em um buffer
depois de devolvê-lo).

### Alocação em um processo em execução

Quando não dá para anexar um benchmark, o `dotnet-counters` lê os contadores do
runtime pelo EventPipe. Instalado com `dotnet tool install dotnet-counters
--tool-path <dir>` (versão 10.0.750501 aqui) e apontado para um processo que
chamou o método com `+=` em laço por 25 segundos:

```bash
dotnet-counters collect -p <pid> --counters System.Runtime \
    --format csv -o counters --refresh-interval 1 --duration 00:00:08
```

O CSV teve uma linha por contador por segundo, com os nomes no estilo
OpenTelemetry dos runtimes recentes. Os que respondem a uma pergunta de
alocação:

| Contador | Valor em 8 segundos |
|---|---|
| `dotnet.gc.collections` de gen0 | 2.459 a 3.053 por segundo |
| `dotnet.gc.collections` de gen1 / gen2 | 0 a 2 por segundo / 0 |
| `dotnet.gc.heap.total_allocated` | 20,6 a 25,5 GB por segundo |
| `dotnet.gc.last_collection.heap.size` do LOH | 24 B |

É uma tempestade só de gen0: tudo morre jovem, nada chega ao LOH, e o processo
passa o tempo alocando e coletando. É a forma do laço com `+=` e 1000 valores
do benchmark acima. Os contadores dizem que um processo aloca demais e em qual
geração; para achar quais métodos e tipos são os responsáveis, use um perfil de
alocação ou um dump com as ferramentas de Diagnosing Production with
dotnet-trace, dump and gcdump, e depois confirme a correção com um benchmark.

## Trade-offs

- **Stopwatch contra BenchmarkDotNet.** Um cronômetro basta para ver uma ordem
  de grandeza (uma diferença de 50x não é ruído); o BenchmarkDotNet é para
  decisões, ao preço de minutos por execução e de um projeto separado.
- **Job short contra job padrão.** `--job short` dá um ciclo de feedback rápido
  mas produz barras de erro largas, como a linha N = 10 mostra; use o job
  padrão para números que vão para um pull request.
- **Tempo contra alocações.** Bytes por operação são estáveis entre máquinas e
  execuções, tempo não. Para testes de regressão, faça asserções sobre alocação
  em faixas (como o lab faz com `GC.GetAllocatedBytesForCurrentThread`) e deixe
  o tempo para benchmarks que você lê.
  ```csharp
  var before = GC.GetAllocatedBytesForCurrentThread();
  Work();
  Assert.InRange(GC.GetAllocatedBytesForCurrentThread() - before, 0, 1_000);
  ```
- **Microbenchmark contra produção.** Um benchmark em uma máquina, com um
  tamanho de entrada e cache quente, diz pouco sobre contenção, um heap do GC
  carregado ou outra CPU. Use-o para comparar duas versões e confirme em
  produção com contadores.
- **Pooling contra alocação simples.** Um pool tira pressão do GC em buffers
  grandes ou quentes, e acrescenta regras de tempo de vida (devolva, não toque
  depois) e políticas de tamanho. Para objetos pequenos e de vida curta, o GC
  geracional costuma sair mais barato que a disciplina.

## Lab

Neste lab você constrói um medidor de alocação, corrige métodos que alocam demais e escreve um benchmark BenchmarkDotNet. Os testes nunca olham tempo: leem `GC.GetAllocatedBytesForCurrentThread` e fazem asserções sobre faixas, e leem por reflexão os atributos da sua classe de benchmark.

**O cenário**

Uma pequena biblioteca de relatórios que renderiza listas de inteiros e calcula checksum de frames de rede.

- `Measure.cs`: `BytesPerCall` e `AllocRatio`, a escrever.
- `ReportRenderer.cs`: `RenderSlow` (pronto, usa `+=`), `RenderFast` e `RenderPooled`.
- `Frames.cs`: `ChecksumCopy` (pronto, copia o frame) e `ChecksumPooled`.
- `RenderBenchmarks.cs`: a classe de benchmark, ainda sem atributos.
- `BenchLab.Runner`: um projeto console que roda os benchmarks de verdade, em Release.

**O que você vai fazer, passo a passo**

1. **Medir a alocação (TODO-00).** `BytesPerCall` chama o trabalho uma vez como aquecimento, depois o executa `iterations` vezes entre duas leituras de `GC.GetAllocatedBytesForCurrentThread()` e devolve a média. Guarde todo resultado em `Sink` para o trabalho não virar código morto, e lance `ArgumentOutOfRangeException` para iterações zero ou negativas.
2. **Comparar (TODO-01).** `AllocRatio` devolve os bytes do candidato divididos pelos do baseline, como a coluna `Alloc Ratio`, e recusa um baseline que não aloca nada.
3. **Corrigir o laço com `+=` (TODO-02).** `RenderFast` devolve o mesmo texto de `RenderSlow` usando um único `StringBuilder`. O teste aceita algumas vezes o tamanho do resultado e exige que a versão lenta aloque mais de cinquenta vezes o resultado.
4. **Parar de copiar frames (TODO-03).** `ChecksumPooled` pega um buffer de `ArrayPool<byte>.Shared`, soma só os primeiros `frame.Length` bytes (o buffer alugado pode ser maior e sujo) e o devolve em um `finally`. O teste usa um frame de 100.000 bytes, acima do limite do LOH, e exige menos de 1.000 bytes por chamada.
5. **Escrever o benchmark (TODO-04).** Acrescente `[MemoryDiagnoser]`, um campo `[Params]` com pelo menos dois tamanhos, um método `[GlobalSetup]` e dois métodos `[Benchmark]` que devolvem os resultados, um deles com `Baseline = true`. Depois rode com o runner e leia `Ratio` e `Alloc Ratio`.

**Como você sabe que terminou**

`dotnet test` (e depois `dotnet test -c Release`) está todo verde, e o runner imprime uma tabela em que a versão rápida tem `Alloc Ratio` bem abaixo de 1 para 1000 valores. Você deve conseguir explicar por que o resultado de `Dead` na tabela de armadilhas não é uma medição.

**Desafio opcional**

- **TODO-05:** `RenderPooled` pega um builder de um `ObjectPool<StringBuilder>` e aloca só a string de resultado. Experimente com 1000 valores e explique por que deixa de ajudar.

**Pré-requisitos:** alocações e `ArrayPool<T>`, reflexão básica e o SDK do .NET 10.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`, e depois `dotnet test -c Release`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` é um comentário com a dica, então os testes vermelhos são o seu checklist.

## Documentation Links

- [BenchmarkDotNet overview](https://benchmarkdotnet.org/articles/overview.html) (doc)
- [BenchmarkDotNet good practices](https://benchmarkdotnet.org/articles/guides/good-practices.html) (doc)
- [BenchmarkDotNet baselines](https://benchmarkdotnet.org/articles/features/baselines.html) (doc)
- [BenchmarkDotNet diagnosers, incluindo o MemoryDiagnoser](https://benchmarkdotnet.org/articles/configs/diagnosers.html) (doc)
- [GC.GetAllocatedBytesForCurrentThread, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.gc.getallocatedbytesforcurrentthread) (doc)
- [ArrayPool<T>, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.buffers.arraypool-1) (doc)
- [Object reuse with ObjectPool in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/objectpool) (doc)
- [dotnet-counters, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/diagnostics/dotnet-counters) (doc)
