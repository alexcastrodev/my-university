---
version: 1.0
updatedAt: 2026-10-15
title: "Do Código-Fonte ao Código de Máquina: Roslyn, IL e o JIT"
summary: O que o Roslyn grava num assembly (IL e metadados), como ler IL com ILSpy, JIT em camadas com PGO dinâmico e OSR medidos no .NET 10, e o que o ReadyToRun muda.
---
## Objective

C# nunca roda como C#. O Roslyn compila o código para IL (intermediate language)
mais metadados dentro de um assembly, e em tempo de execução o JIT transforma
cada método em código de máquina na primeira vez que ele é chamado, e muitas
vezes de novo depois. Entender as duas etapas explica coisas que de outro jeito
parecem mágica: por que um benchmark é lento no primeiro segundo, por que uma
lambda ou um programa top-level vira um método gerado pelo compilador, do que o
ReadyToRun e o Native AOT abrem mão, e como olhar o que o compilador e o JIT
realmente produziram em vez de adivinhar.

## Use Cases

- Ler o IL de um método para ver o que o compilador gerou para um recurso
  (top-level statements, `foreach`, closures, `async`).
- Entender por que as primeiras requisições depois de um deploy são mais lentas
  que as demais, e o que o warm-up de fato aquece.
- Decidir se o `PublishReadyToRun` compensa os arquivos maiores num serviço com
  startup lento.
- Diagnosticar um microbenchmark que mediu código Tier0 em vez de código
  otimizado.
- Explicar para alguém que vem do Java como o pipeline do CLR corresponde a
  `javac`, bytecode e HotSpot.

## Deep Dive

### Etapa um: o Roslyn emite IL e metadados

O `dotnet build` roda o Roslyn, o compilador de C#, que grava um assembly
(`.dll`). O assembly guarda duas coisas. Os **metadados** descrevem cada tipo,
método, campo e os assemblies referenciados. O **IL** é o corpo de cada método,
escrito para uma máquina de pilha que não depende da CPU. São os metadados que
tornam possíveis a reflection, o debugger e os decompiladores.

Pegue este programa:

```csharp
long total = 0;
for (int round = 0; round < 20; round++)
{
    for (int i = 0; i < 1_000; i++)
        total += Calc.Add(i, 1);
    Thread.Sleep(20);
}
Console.WriteLine(total);                     // 10010000
Console.WriteLine(Calc.LongLoop(100_000_000)); // 299999995

static class Calc
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int Add(int a, int b) => a + b;

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static long LongLoop(int n)
    {
        long sum = 0;
        for (int i = 0; i < n; i++)
            sum += i % 7;
        return sum;
    }
}
```

Para ler o IL sem instalar nada globalmente, instale a ferramenta de linha de
comando do ILSpy numa pasta local:

```bash
dotnet tool install ilspycmd --tool-path ./tools
./tools/ilspycmd -il bin/Release/net10.0/IlJit.dll
```

A parte que interessa da saída, resumida:

```text
.method public hidebysig static int32 Add (int32 a, int32 b) cil managed noinlining
{
    // Code size: 4 (0x4)
    .maxstack 8
    IL_0000: ldarg.0
    IL_0001: ldarg.1
    IL_0002: add
    IL_0003: ret
}

.class private auto ansi beforefieldinit Program
    .method private hidebysig static void '<Main>$' (string[] args) cil managed
        .entrypoint
        ...
        IL_000a: call int32 Calc::Add(int32, int32)
        ...
        IL_0029: call void [System.Console]System.Console::WriteLine(int64)
```

Três coisas aparecem. O IL empilha argumentos numa pilha de avaliação, opera
sobre eles e retorna, sem registradores. Os top-level statements viraram uma
classe `Program` gerada pelo compilador, com um ponto de entrada chamado
`<Main>$`. E as chamadas ao framework nomeiam o assembly que define o tipo
(`[System.Console]`), que é como o runtime sabe o que carregar.

### Etapa dois: o JIT compila métodos na primeira chamada

O runtime não compila o assembly quando o carrega. Cada método começa apontando
para um stub, e a primeira chamada dispara o JIT só daquele método. Desde o .NET
Core 3.0 isso é **em camadas** (tiered): o método é compilado primeiro rápido,
com poucas otimizações (Tier0), e se ele se mostrar quente é compilado de novo,
totalmente otimizado, em segundo plano (Tier1). As chamadas passam para o código
novo quando ele fica pronto.

O runtime distribuído consegue imprimir o que o JIT fez.
`DOTNET_JitDisasmSummary=1` lista cada método compilado, com a camada. No .NET
10.0.0, macOS arm64, o programa acima produziu:

```text
JIT compiled Program:<Main>$(System.String[]) [Instrumented Tier0, IL size=72, code size=368]
JIT compiled Calc:Add(int,int) [Tier0, IL size=4, code size=36]
JIT compiled Calc:Add(int,int) [Instrumented Tier0, IL size=4, code size=36]
JIT compiled Calc:Add(int,int) [Tier1, IL size=4, code size=20]
JIT compiled Program:<Main>$(System.String[]) [Tier1-OSR @0x1a with Synthesized PGO, IL size=72, code size=204]
JIT compiled Calc:LongLoop(int) [Instrumented Tier0, IL size=24, code size=192]
JIT compiled Calc:LongLoop(int) [Tier1-OSR @0x12 with Synthesized PGO, IL size=24, code size=100]
```

O `Add` foi compilado três vezes. O `DOTNET_JitDisasm=Add` mostra por que valeu
a pena: a versão Tier0 copia os dois argumentos para o stack frame e os carrega
de volta, enquanto a versão Tier1 é uma única instrução em volta do setup do
frame.

```text
; Tier0 code                         ; Tier1 code
str  w0, [fp, #0x1C]                 add  w0, w0, w1
str  w1, [fp, #0x18]
ldr  w0, [fp, #0x1C]
ldr  w1, [fp, #0x18]
add  w0, w0, w1
; Total bytes of code 36             ; Total bytes of code 20
```

### PGO dinâmico e on-stack replacement

A linha `Instrumented Tier0` é o **PGO dinâmico** (profile-guided
optimization): a versão intermediária registra quais branches e tipos são
usados de verdade, e o Tier1 usa esse perfil. O PGO dinâmico vem ligado por
padrão desde o .NET 8; a Microsoft relata ganho médio de cerca de 15% na sua
suíte de benchmarks.

O `LongLoop` é chamado uma única vez, então a contagem de chamadas nunca o
promoveria. É isso que o **OSR** (on-stack replacement, que chegou no .NET 7)
resolve: o loop tem um patchpoint e, depois de iterações suficientes, o runtime
compila uma versão otimizada e salta para ela no meio do método em execução.
`Tier1-OSR @0x12` significa que a troca aconteceu no offset de IL `0x12`, que é o
cabeçalho do loop na listagem de IL.

Desligar as chaves deixa cada mecanismo visível:

| Configuração | O que o resumo mostrou |
|---|---|
| padrão | `Add`: Tier0, Instrumented Tier0, Tier1. Loops: Tier0 e depois Tier1-OSR |
| `DOTNET_TieredPGO=0` | As mesmas camadas, sem a etapa `Instrumented` |
| `DOTNET_TieredCompilation=0` | Cada método compilado uma vez como `FullOpts` |

### ReadyToRun: compilado antes de a aplicação subir

O programa acima causou só 9 compilações de JIT no total, mesmo usando
`Console`, threads e formatação de string. Os assemblies do framework vêm como
**ReadyToRun** (R2R): eles trazem código nativo ao lado do IL, então o runtime
usa esse código em vez de chamar o JIT. Com `DOTNET_ReadyToRun=0` a mesma
execução causou 663 compilações de JIT.

Você pode fazer o mesmo com o seu código usando `PublishReadyToRun`, que exige um
runtime identifier:

```bash
dotnet publish -c Release -r osx-arm64 --self-contained false -p:PublishReadyToRun=true -o r2r
```

O `IlJit.dll` publicado cresceu de 5.120 para 6.144 bytes e o resumo mudou para:

```text
JIT compiled Calc:Add(int,int) [Instrumented Tier1, IL size=4, code size=20]
JIT compiled Calc:Add(int,int) [Tier1, IL size=4, code size=20]
```

O `<Main>$` e o `LongLoop` nunca passaram pelo JIT; rodou o código
pré-compilado deles. O `Add`, por ser quente, ainda foi recompilado pelo
tiering, porque o código R2R é otimizado com menos agressividade que o Tier1.
R2R é um seguro de startup, não um substituto do JIT. O Native AOT vai além e
remove o IL e o JIT por completo, e tem conceito próprio.

### O paralelo com Java

O pipeline espelha a JVM: o Roslyn faz o papel do `javac`, o IL o do bytecode, o
assembly o do `.class`/`.jar`, e o JIT em camadas com PGO o das camadas C1 e C2
do HotSpot. Duas diferenças importam. O HotSpot começa interpretando bytecode,
enquanto a primeira camada do CLR já é código de máquina (a listagem Tier0
acima). E o framework distribuído é pré-compilado (R2R), algo de que a JVM só se
aproxima com CDS e o AOT cache do Project Leyden.

## Trade-offs

- **O tiered compilation privilegia o startup em detrimento do throughput dos
  primeiros segundos.** O código roda sem otimização até ficar quente, então
  benchmarks curtos medem Tier0. Use o BenchmarkDotNet, que faz warm-up, em vez
  de um `Stopwatch` em volta de uma chamada.
- **Desligar o tiering dá código estável na hora e startup mais lento.**
  `TieredCompilation=false` deixa todo método `FullOpts` desde o início e também
  perde o PGO dinâmico, que só aprende com as camadas instrumentadas.
- **O PGO dinâmico faz o desempenho depender da carga vista até ali.** Um
  serviço aquecido com tráfego pouco representativo pode otimizar para os
  branches errados.
- **ReadyToRun troca tamanho por startup.** A Microsoft documenta assemblies duas
  a três vezes maiores; numa aplicação pequena o ganho é pequeno, porque o
  framework já vem pré-compilado.
- **IL é fácil de ler de volta, por qualquer um.** Um decompilador reconstrói C#
  legível a partir dos seus assemblies, inclusive a lógica que você considera
  privada. Ofuscação atrasa isso, mas não impede; segredo nunca deve ir no
  binário.
  ```bash
  ./tools/ilspycmd bin/Release/net10.0/IlJit.dll   # imprime C# reconstruído a partir do IL
  ```
  Até os nomes sobrevivem, menos os de variáveis locais, porque ficam no `.pdb`, não no
  assembly: `long sum` voltou como `long num`.

## Documentation Links

- [Managed execution process, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/managed-execution-process) (doc)
- [Compilation config settings (tiered compilation, quick JIT, ReadyToRun, PGO), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/compilation) (doc)
- [What's new in .NET 8 runtime (dynamic PGO on by default), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-8/runtime) (doc)
- [What's new in .NET 7 (on-stack replacement), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-7) (doc)
- [ReadyToRun deployment overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run) (doc)
- [Viewing JIT dumps (JitDisasm, JitDisasmSummary), dotnet/runtime](https://github.com/dotnet/runtime/blob/main/docs/design/coreclr/jit/viewing-jit-dumps.md) (doc)
