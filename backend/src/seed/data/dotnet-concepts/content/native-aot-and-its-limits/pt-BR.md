---
version: 1.0
updatedAt: 2026-10-15
title: "Native AOT e Seus Limites"
summary: O que o PublishAot faz (ILC, linker nativo, sem cross-OS), quanto rende em startup, memória e tamanho medidos num console e numa minimal API, o que quebra e por quê (Reflection.Emit, dynamic, generics sobre structs, LoadFrom, expressões interpretadas), a falha de JSON sem aviso, e onde ASP.NET Core e EF Core estão no .NET 10.
---
## Objective

O Native AOT compila a aplicação inteira, o código do framework que ela alcança
e um runtime enxuto em um único executável nativo, na hora da publicação. Não
existe IL para interpretar nem JIT em runtime, então o processo sobe em
milissegundos e usa uma fração da memória. O preço é um **mundo fechado**: tudo
o que o programa vai executar precisa estar visível para o compilador quando
você publica. Este conceito mede o que o Native AOT entrega, mostra exatamente o
que quebra e por quê, e mapeia onde ASP.NET Core e EF Core estão no .NET 10. Ele
parte do conceito de trimming, porque o Native AOT sempre faz trimming.

Ambiente: SDK 10.0.100, runtime 10.0.0, Release, `osx-arm64`, Apple M4 Max,
macOS 27, Xcode instalado (`xcode-select -p` apontando para
`/Applications/Xcode.app/Contents/Developer`). Os tempos são medianas de
execuções repetidas numa máquina dividida com outros builds.

## Use Cases

- Ferramentas de linha de comando chamadas milhares de vezes, em que 40 ms de
  startup do runtime por chamada pesam.
- Funções serverless e containers que escalam a zero, em que cold start e
  memória viram custo.
- Hospedagem densa: muitos serviços pequenos por nó, cada um com working set
  menor.
- Ambientes que proíbem gerar memória executável em runtime, onde um JIT nem
  consegue rodar.

## Deep Dive

### O que o PublishAot faz

```xml
<PropertyGroup>
  <PublishAot>true</PublishAot>
</PropertyGroup>
```

```bash
dotnet publish -c Release -r osx-arm64
```

A propriedade faz duas coisas. No **build**, liga os analisadores de trim, AOT
e single file, então o `dotnet build` já reporta `IL2026` e `IL3050`. Na
**publicação**, faz o trimming do app e entrega o resultado ao **ILC**, o
compilador AOT, que gera código objeto que o linker da plataforma transforma em
executável. O linker é o motivo de o Native AOT exigir toolchain nativa: Xcode
Command Line Tools no macOS, `clang` e headers da zlib no Linux, o workload de
C++ do Visual Studio no Windows.

`dotnet run` e o debugger continuam usando o JIT, mas já com os feature switches
de AOT aplicados (`IsDynamicCodeSupported` vale `False`). É assim que um
file-based app, em que `PublishAot` é o padrão, falha no `dotnet run` com Dapper
ou EF Core (veja o conceito de file-based apps). A emulação é parcial: com o
programa mostrado em "O que quebra", o `dotnet run` já falhou no
`Reflection.Emit` e já interpretou as expression trees, mas a instanciação
genérica em runtime e o `dynamic` ainda funcionaram. Só o binário publicado
conta a verdade inteira.

Cross-compilation esbarra no mesmo linker. Deste Mac, `-r osx-x64` gerou um
`Mach-O 64-bit executable x86_64` funcional (1,28 MB), mas `-r linux-x64`
compilou o código e falhou na etapa nativa:

```text
Microsoft.NETCore.Native.Unix.targets(342,5): error : Symbol stripping tool
('llvm-objcopy' or 'objcopy') not found in PATH.
```

A documentação é explícita: Native AOT não suporta compilação entre sistemas
operacionais. Gere binários Linux no Linux, normalmente num container.

### O que ele entrega, medido

Um app de console que imprime quatro linhas:

| Publicação | Entrega | Do launch ao exit | Pico de RSS |
|---|---|---|---|
| framework-dependent (JIT) | 0,14 MB + runtime compartilhado | 39 ms | 40,3 MB |
| self-contained single file (JIT) | 76,4 MB | 40 ms | 36,7 MB |
| Native AOT | 1,2 MB | 4,9 ms | 7,3 MB |

O template `webapiaot` (minimal API, `CreateSlimBuilder`, um endpoint de
`Todo`), medido do início do processo até o primeiro `200 OK` em
`GET /todos/`, e o RSS depois de 200 requisições:

| Publicação | Entrega | Primeiro 200 OK | RSS | Tempo de publish |
|---|---|---|---|---|
| framework-dependent (JIT) | 0,8 MB + runtime compartilhado | 169 ms | 92 MB | cerca de 1 s |
| Native AOT | executável de 10,2 MB | 68 ms | 30 MB | cerca de 9 s |

Ao lado de cada executável fica uma pasta `.dSYM` (6 MB no console, 42 MB na
API): são os símbolos de debug nativos, mantidos fora do binário porque
`StripSymbols` vem ligado por padrão. Guarde-os a cada release, senão crash dumps
de produção não podem ser simbolizados.

### O que quebra, e por quê

Cada chamada abaixo é um `try` separado num mesmo programa, rodado primeiro no
JIT e depois como binário Native AOT:

```csharp
using System.Diagnostics;
using System.Linq.Expressions;
using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.CompilerServices;

Console.WriteLine($"IsDynamicCodeSupported: {RuntimeFeature.IsDynamicCodeSupported}");

Try("Reflection.Emit", () =>
    AssemblyBuilder.DefineDynamicAssembly(new AssemblyName("Gen"), AssemblyBuilderAccess.Run).GetName().Name!);

Try("MakeGenericType(known)", () => typeof(List<>).MakeGenericType(typeof(Money)).Name);

object[] values = [new Money(1m), new Celsius(20), new Note("hi")];
Try("MakeGenericType(runtime)", () => NewList(values[1]));
Try("MakeGenericType(class)", () => NewList(values[2]));

Try("dynamic", () => { dynamic d = 41; return (d + 1).ToString(); });
Try("Assembly.LoadFrom", () => Assembly.LoadFrom("Plugin.dll").FullName!);
Try("Expression.Compile", () =>
{
    Expression<Func<int, int>> square = x => x * x;
    var f = square.Compile();
    var sw = Stopwatch.StartNew();
    long sum = 0;
    for (int i = 0; i < 10_000_000; i++) sum += f(i & 1023);
    return $"{f(7)}, 10M calls in {sw.ElapsedMilliseconds} ms";
});

static string NewList(object item)
{
    var listType = typeof(List<>).MakeGenericType(item.GetType());
    var list = (System.Collections.IList)Activator.CreateInstance(listType)!;
    list.Add(item);
    return $"{listType.Name}[{item.GetType().Name}] with {list.Count} item";
}

static void Try(string label, Func<string> action)
{
    try { Console.WriteLine($"{label,-24} ok: {action()}"); }
    catch (Exception ex) { Console.WriteLine($"{label,-24} {ex.GetType().Name}: {ex.Message.Split('\n')[0]}"); }
}

readonly record struct Money(decimal Amount);
readonly record struct Celsius(int Degrees);
record Note(string Text);
```

```text
// JIT (dotnet run -c Release -p:PublishAot=false)
IsDynamicCodeSupported: True
Reflection.Emit          ok: Gen
MakeGenericType(known)   ok: List`1
MakeGenericType(runtime) ok: List`1[Celsius] with 1 item
MakeGenericType(class)   ok: List`1[Note] with 1 item
dynamic                  ok: 42
Assembly.LoadFrom        FileNotFoundException: Could not load file or assembly '.../Plugin.dll'. ...
Expression.Compile       ok: 49, 10M calls in 19 ms

// Native AOT (./out/aot/Limits)
IsDynamicCodeSupported: False
Reflection.Emit          PlatformNotSupportedException: Dynamic code generation is not supported on this platform.
MakeGenericType(known)   ok: List`1
MakeGenericType(runtime) NotSupportedException: 'System.Collections.Generic.List`1[Celsius]' is missing
                         native code or metadata. This can happen for code that is not compatible with trimming or AOT. ...
MakeGenericType(class)   ok: List`1[Note] with 1 item
dynamic                  ArgumentNullException: Value cannot be null. (Parameter 'key')
Assembly.LoadFrom        PlatformNotSupportedException: Operation is not supported on this platform.
Expression.Compile       ok: 49, 10M calls in 411 ms
```

Toda falha foi anunciada no build: `IL3050` (`RequiresDynamicCode`) em
`DefineDynamicAssembly`, em `MakeGenericType` e no binder do `dynamic`, e
`IL2026` em `LoadFrom` e no binder. Os motivos:

- **Sem geração de código.** `Reflection.Emit` não tem onde rodar. O binder do
  `dynamic` do C# também gera código, e falhou com uma mensagem que não ajuda.
- **Generics sobre structs são compilados por instanciação.** O JIT cria
  `List<Celsius>` sob demanda; o ILC precisa gerar antes, e não consegue para
  uma struct que só aparece em runtime. Com `typeof(Money)` escrito no código, o
  analisador enxergou o argumento e não avisou nada. Sobre tipos de referência,
  as instanciações compartilham código, e por isso `List<Note>` funcionou mesmo
  com `Note` escolhido em runtime.
- **Sem carga de assemblies.** O binário não carrega IL novo, então plugins
  precisam ser compilados dentro dele.
- **Expression trees são interpretadas.** `Compile()` continua funcionando, mas
  o delegate roda no interpretador do LINQ: 411 ms contra 19 ms aqui (443 ms
  numa execução anterior), mais de 20 vezes mais lento. Bibliotecas que compilam
  expressões por desempenho (mappers, ORMs mais antigos, validação) degradam em
  silêncio em vez de falhar.

### A falha que não tem aviso

Tirar uma linha do template `webapiaot` (o registro do contexto JSON gerado
pelo source generator) publicou com **zero** avisos de trim ou AOT e rodou
normalmente até a primeira requisição:

```csharp
builder.Services.ConfigureHttpJsonOptions(options =>
{
    // options.SerializerOptions.TypeInfoResolverChain.Insert(0, AppJsonSerializerContext.Default);
});
```

```text
GET /todos/  -> HTTP/1.1 500 Internal Server Error
System.NotSupportedException: JsonTypeInfo metadata for type 'Todo[]' was not provided by
TypeInfoResolver of type '[Microsoft.AspNetCore.OpenApi.OpenApiJsonSchemaContext]'.
```

O serializer estava configurado; só não tinha metadados para `Todo[]`. Os
analisadores enxergam chamadas a APIs de reflection, não registros que faltam,
então um app AOT precisa de testes que batam em todos os endpoints do binário
publicado.

### ASP.NET Core e EF Core no .NET 10

`WebApplication.CreateSlimBuilder` é o host amigável ao AOT: mantém a
configuração de `appsettings`, user secrets e logging no console, e deixa de
fora hosting startup assemblies, `UseStartup`, os providers de logging
EventLog, Debug e EventSource, a integração com IIS, endpoints HTTPS, HTTP/3
(QUIC) e as constraints de rota regex e alpha. HTTPS e HTTP/3 voltam com
`UseKestrelHttpsConfiguration` e `UseQuic`. Por outro lado, o .NET 10 tira o
HTTP/3 do `HttpClient` em qualquer app com trimming ou AOT, a menos que
`Http3Support` esteja definido.

A tabela oficial de compatibilidade do ASP.NET Core 10 lista como
**suportados**: gRPC, CORS, health checks, autenticação JWT, output e response
caching, rate limiting, arquivos estáticos e WebSockets, entre outros.
**Parcial**: minimal APIs (o request delegate generator substitui a reflection,
e todo tipo de corpo precisa de um `JsonSerializerContext`) e SignalR. **Sem
suporte**: controllers MVC, Blazor Server, outros esquemas de autenticação,
session, SPA e OData.

O EF Core é a grande lacuna. A documentação dele marca NativeAOT e queries
pré-compiladas como **experimentais** e desaconselha uso em produção: as
queries viram interceptors C# gerados na publicação, queries LINQ compostas
dinamicamente não são suportadas, e a publicação ainda reporta avisos de trim e
AOT. Sem essa configuração, o contexto falha no primeiro uso com `Model building
is not supported when publishing with NativeAOT`. Na prática, um serviço AOT
fala com o banco por ADO.NET ou por um mapper gerado por source generator.

### Sem JIT também significa sem PGO dinâmico

O JIT recompila métodos quentes usando perfis coletados enquanto o app roda (PGO
dinâmico, ligado por padrão desde o .NET 8). Um binário nativo é final. Isso não
o torna automaticamente mais lento: num microbenchmark dominado por chamadas
(uma chamada de interface sobre 1.000 objetos, 50.000 vezes, com a
implementação escolhida em runtime), as rodadas estáveis levaram cerca de 25 ms
no JIT com PGO, 63 ms com `DOTNET_TieredPGO=0` e de 14 a 24 ms em Native AOT.
Meça os seus caminhos quentes nos dois modos antes de decidir por throughput.

### Bibliotecas

Uma biblioteca se declara pronta com `<IsAotCompatible>true</IsAotCompatible>`,
que liga os analisadores de trim, single file e AOT no build dela. No .NET 10 a
flag também é gravada como metadado do assembly. A documentação descreve uma
verificação opcional para projetos que ligam a análise de AOT,
`<VerifyReferenceAotCompatibility>true</VerifyReferenceAotCompatibility>`, que
avisa com `IL3058` sobre cada assembly referenciado sem esse metadado. Ela é
opcional porque bibliotecas feitas para um .NET anterior nunca o carregam, mesmo
funcionando bem, então espere ruído.

## Trade-offs

- **Startup e memória contra flexibilidade.** 4,9 ms e 7 MB em vez de 40 ms e
  40 MB num app de console, em troca de nada de `Reflection.Emit`, `dynamic`,
  plugins ou instanciações genéricas que só existem em runtime.
- **Os avisos são o contrato.** Sem avisos de AOT, o binário deve se comportar
  como o app no JIT; cada aviso é uma possível exceção em runtime. Transforme em
  erro (com isso, a publicação do programa acima falhou com `error IL3050` e
  `error IL2026`).
  ```xml
  <PublishAot>true</PublishAot>
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  ```
- **Algumas falhas não têm aviso.** Um registro de `JsonSerializerContext`
  faltando publicou limpo e devolveu 500. Teste o binário publicado.
- **Bibliotecas apoiadas em expressões ficam lentas em vez de falhar.**
  Expressões interpretadas rodaram mais de 20 vezes mais devagar aqui.
- **Custo de build e pipelines por SO.** Cerca de 9 s em vez de 1 s na API,
  toolchain nativa em todo agente de build, e uma máquina ou container Linux por
  alvo Linux.
- **Limites do ecossistema.** MVC, Blazor Server e EF Core em produção ficam de
  fora; minimal APIs, gRPC e worker services entram.
- **Os símbolos ficam fora do binário.** Guarde o `.dSYM`, `.dbg` ou `.pdb` de
  cada release, senão os crash dumps de produção ficam ilegíveis.

## Lab

Neste lab você vê o que o Native AOT exige do seu código sem nunca rodar o compilador nativo. Você recebe a estrutura pronta e `Snippets.cs` com trechos de código já escritos, alguns deliberadamente hostis ao AOT. Em `AotFiles`, os métodos lançam `NotImplementedException` e devolvem texto: arquivos de projeto e pequenos arquivos C#. A ideia central é prever qual aviso (`IL2026` ou `IL3050`) cada trecho arriscado gera, trocar o código arriscado por código seguro para AOT e perceber que o analisador é a ferramenta do dia a dia, enquanto o publish real fica como acompanhamento manual.

**O cenário**

O problema é descobrir, em tempo de build, o que quebraria num binário nativo.

- `AotFiles.cs`: os métodos a implementar (projetos e trechos de C#).
- `Snippets.cs` (dado): `MakeGenericType`, `LoadFrom`, `JsonReflection` (hostis ao AOT), `SlowFactory` (anotada com `[RequiresDynamicCode]`) e `Clean` (sem problema).
- `AotTests.cs` e `AotSandbox.cs`: gravam seu texto numa pasta descartável e usam o .NET CLI de duas formas: `dotnet msbuild -getProperty` para avaliar um projeto e `dotnet build` de uma biblioteca com os analisadores ligados, lendo os avisos.

Os testes recusam construir qualquer projeto com `PublishAot`, porque o publish nativo baixaria o ILCompiler e exigiria toolchain nativa.

**O que você vai fazer, passo a passo**

1. **Projeto com PublishAot (TODO-00).** Em `PublishAotProject`, escreva um console `net10.0` com `OutputType` `Exe` e `PublishAot` verdadeiro. Os testes só avaliam: os três analisadores e `PublishTrimmed` devem seguir dele, e `InvariantGlobalization` não.
2. **Biblioteca compatível (TODO-01).** Em `AotCompatibleLibrary`, use `IsAotCompatible` em vez de `PublishAot`: analisadores ligados, sem publicar nada.
3. **Prever os avisos (TODO-02).** Em `WarningIdsForMakeGenericType`, `WarningIdsForLoadFrom` e `WarningIdsForJsonReflection`, devolva os ids que você espera. O teste constrói os três trechos e compara com a saída real.
4. **JSON seguro (TODO-03).** Em `JsonSourceGeneratedSnippet`, escreva um `record Todo`, um `TodoJsonContext` com `[JsonSerializable]` e um `TodoJson` com `ToJson` e `FromJson` usando `TodoJsonContext.Default.Todo`. Sem avisos, e a biblioteca compilada precisa fazer o round-trip.
5. **Genéricos que o compilador vê (TODO-04).** Em `GenericFactorySnippet`, troque `MakeGenericType` e `Array.CreateInstance` por `List<T> Create<T>()` e `T[] NewArray<T>(int)`.
6. **Ser honesto sobre código dinâmico (TODO-05).** Em `DynamicCodeWrapperSnippet`, mantenha o `MakeGenericType` num método com `[RequiresDynamicCode]`. O aviso some do corpo e aparece no chamador que não repete a anotação.

**Como saber que terminou**

`dotnet test` fica verde (cerca de 15 a 30 segundos, sem rede). Você deve conseguir explicar por que o aviso "se mudou" para os chamadores no TODO-05 e por que um analisador limpo não garante que o binário publicado funciona (uma classe de contexto JSON esquecida passa sem aviso).

**Desafios opcionais**

- **TODO-06:** `StrictAotLibrary` transforma `IL2026` e `IL3050` em erros com `WarningsAsErrors`.
- **TODO-07:** `GuardedFactorySnippet` chama um método `[RequiresDynamicCode]` só dentro de `if (RuntimeFeature.IsDynamicCodeSupported)`, uma guarda que o analisador entende.

**Pré-requisitos:** o texto do concept sobre Native AOT, estrutura básica de `.csproj` e de uma biblioteca sem NuGet, e o .NET 10 SDK (10.0.100).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos em `src/NativeAotLab/AotFiles.cs` começam lançando `NotImplementedException` com um comentário `TODO-NN`, então os testes vermelhos são o seu checklist. Para ver os analisadores no seu código, use `dotnet build -p:IsAotCompatible=true`.

## Documentation Links

- [Native AOT deployment overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) (doc)
- [Introduction to AOT warnings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/fixing-warnings) (doc)
- [Native AOT cross-compilation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/cross-compile) (doc)
- [ASP.NET Core support for Native AOT, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/native-aot) (doc)
- [NativeAOT Support and Precompiled Queries (Experimental), EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/nativeaot-and-precompiled-queries) (doc)
- [System.Text.Json source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/source-generation) (doc)
