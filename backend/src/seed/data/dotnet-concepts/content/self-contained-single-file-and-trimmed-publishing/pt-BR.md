---
version: 1.0
updatedAt: 2026-10-15
title: "Publicação Self-Contained, Single-File e com Trimming"
summary: Framework-dependent contra self-contained, RIDs, single file (IL3000, bibliotecas nativas extraídas, compressão), trimming com avisos IL2026/IL2057/IL2070 reais e DynamicallyAccessedMembers, feature switches (HTTP/3 desligado no .NET 10) e a surpresa de startup entre trimming e ReadyToRun, com tamanhos e tempos medidos.
---
## Objective

`dotnet publish` não é uma operação só, e sim um conjunto de chaves
independentes: quem fornece o runtime (a máquina ou a sua pasta), quantos
arquivos você entrega (uma pasta ou um executável), quanto do framework fica
(tudo ou só o que a análise estática diz que você usa) e se o código vai
pré-compilado (ReadyToRun). Cada chave mexe em tamanho, em startup e no que pode
quebrar. Este conceito publica os mesmos apps em todas as combinações e mostra
tamanhos, tempos e avisos de trim reais, para a escolha sair de dado, não de
hábito.

Ambiente de todos os números: SDK 10.0.100, runtime 10.0.0, Release,
`osx-arm64`, Apple M4 Max, macOS 27. A máquina estava dividida com outros
builds, então os tempos são medianas de execuções repetidas e só entram
diferenças que se mantiveram entre as rodadas.

## Use Cases

- Entregar uma ferramenta de linha de comando para máquinas onde não dá para
  instalar o .NET.
- Escolher o modo de publicação de uma imagem de container ou de uma função
  serverless, em que tamanho de imagem e cold start viram custo.
- Distribuir um executável em vez de uma pasta com 190 arquivos.
- Entender por que um build com trimming passa nos testes em Debug e falha em
  produção com um `null` vindo de reflection.

## Deep Dive

### Framework-dependent ou self-contained

Uma publicação **framework-dependent** leva os seus assemblies e espera um
runtime compartilhado compatível no destino; é o padrão. Por padrão ela também
gera um **apphost** (um lançador nativo pequeno com o nome do app) ao lado da
DLL portável, então `./Hello` e `dotnet Hello.dll` funcionam; `-p:UseAppHost=false`
remove o apphost. Uma publicação **self-contained** copia o runtime e o
framework inteiro para a pasta e precisa de um **runtime identifier** (RID)
como `linux-x64`, `win-arm64` ou `osx-arm64`: o runtime é código nativo, então
cada publicação roda em um SO e uma arquitetura.

```bash
dotnet publish -c Release                                   # framework-dependent
dotnet publish -c Release -r osx-arm64 --self-contained     # self-contained
```

A troca é de manutenção. Um app framework-dependent faz roll forward para o
patch mais novo do runtime da mesma major instalado na máquina, então um
`apt upgrade` corrige uma CVE em todos os apps de uma vez. Um app
self-contained fica com o runtime da publicação até você publicar de novo.

Um app de console que imprime o runtime e o RID, publicado dos dois jeitos:

| Modo | Arquivos | Tamanho |
|---|---|---|
| framework-dependent | 5 | 0,14 MB (apphost 124 KB, `Hello.dll` 5,5 KB) |
| self-contained | 191 | 82,8 MB |

### Single file: um executável, com exceções

`-p:PublishSingleFile=true` anexa os assemblies gerenciados, o `deps.json` e o
`runtimeconfig.json` ao apphost. Funciona nos dois modos:

| Modo | Arquivos | Tamanho |
|---|---|---|
| framework-dependent, single file | 2 (`Hello`, `Hello.pdb`) | 0,13 MB |
| self-contained, single file | 2 | 76,4 MB |

Os assemblies gerenciados são carregados de dentro do bundle, sem extração.
Isso quebra código que supõe assembly em disco, e o analisador avisa já no
build:

```text
Program.cs(6,33): warning IL3000: 'System.Reflection.Assembly.Location.get' always returns
an empty string for assemblies embedded in a single-file app. If the path to the app
directory is needed, consider calling 'System.AppContext.BaseDirectory'.
```

A execução confirmou: `Location: ''`, enquanto `AppContext.BaseDirectory`
imprimiu a pasta de publicação.

Bibliotecas nativas são a exceção. Um app com `Microsoft.Data.Sqlite` publicado
como single file ainda gerou **três** arquivos: `Pkg`, `Pkg.pdb` e
`libe_sqlite3.dylib` (1,5 MB) ao lado. Com
`-p:IncludeNativeLibrariesForSelfExtract=true` a biblioteca entra no bundle,
mas o host precisa **extraí-la** para o disco antes de carregar. Rodando com
`DOTNET_BUNDLE_EXTRACT_BASE_DIR` apontando para uma pasta de rascunho,
apareceu `extract/Pkg/0UcDQXFeJ4aL/libe_sqlite3.dylib`. Sem essa variável, a
documentação diz que os arquivos vão para `$HOME/.net` no Linux e no macOS e
para `%TEMP%\.net` no Windows, o que falha em units do `systemd` sem `$HOME`.
(O código nativo do próprio runtime já estava dentro do bundle no macOS; a
documentação descreve arquivos de runtime separados no Windows.)

`-p:EnableCompressionInSingleFile=true` comprime os assemblies embutidos: o
`Hello` self-contained caiu de 76,4 MB para 34,8 MB, e o startup subiu de cerca
de 40 ms para cerca de 75 ms, porque tudo é descomprimido em memória no início
(pico de RSS de 37 MB para 50 MB).

### Trimming: a análise estática apaga o framework não usado

`-p:PublishTrimmed=true` roda o **ILLink** sobre a saída self-contained. Ele
parte do `Main`, segue toda referência estática e remove assemblies, tipos e
membros que nunca são alcançados. Trimming só existe para apps self-contained
(o framework compartilhado de um app framework-dependent não pode ser cortado
por app).

| Modo | Arquivos | Tamanho |
|---|---|---|
| self-contained, trimmed | 29 | 20,2 MB |
| self-contained, single file, trimmed | 2 | 13,0 MB |

A análise não enxerga reflection guiada por dado. Este programa tem os três
padrões clássicos:

```csharp
using System.Diagnostics.CodeAnalysis;
using System.Reflection;
using System.Text.Json;

// 1. A type chosen at run time from a string
var name = args.Length > 0 ? args[0] : "Plugin";
Console.WriteLine($"GetType(\"{name}\"): {Type.GetType(name)?.Name ?? "null"}");

// 2. Reflecting over a Type parameter, without and with annotation
Console.WriteLine($"Plain:     {string.Join(", ", Methods(typeof(InvoiceA)))}");
Console.WriteLine($"Annotated: {string.Join(", ", AnnotatedMethods(typeof(InvoiceB)))}");

// 3. Reflection-based JSON
try { Console.WriteLine(JsonSerializer.Serialize(new InvoiceA())); }
catch (Exception ex) { Console.WriteLine($"{ex.GetType().Name}: {ex.Message}"); }

static IEnumerable<string> Methods(Type t) =>
    t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Select(m => m.Name);

static IEnumerable<string> AnnotatedMethods(
    [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicMethods)] Type t) =>
    t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly).Select(m => m.Name);

class Plugin { }
class Exporter { }
class InvoiceA { public decimal Total { get; set; } = 10m; public void Print() { } }
class InvoiceB { public decimal Total { get; set; } = 10m; public void Print() { } }
```

A publicação com trimming imprimiu cada aviso duas vezes: uma pelo analisador
Roslyn (`warning IL2057`) e outra pelo ILLink (`Trim analysis warning IL2057`):

```text
Program.cs(7,43): warning IL2057: Unrecognized value passed to the parameter 'typeName'
  of method 'System.Type.GetType(String)'. It's not possible to guarantee the availability of the target type.
Program.cs(18,5): warning IL2070: 'this' argument does not satisfy
  'DynamicallyAccessedMemberTypes.PublicMethods' in call to 'System.Type.GetMethods(BindingFlags)'.
Program.cs(14,25): warning IL2026: Using member 'System.Text.Json.JsonSerializer.Serialize<TValue>(...)'
  which has 'RequiresUnreferencedCodeAttribute' can break functionality when trimming application code.
```

Sem e com trimming, passando `Exporter` como argumento:

```text
// dotnet run -c Release -- Exporter
GetType("Exporter"): Exporter
Plain:     get_Total, set_Total, Print
Annotated: get_Total, set_Total, Print
{"Total":10}

// ./out/trim/Trim Exporter
GetType("Exporter"): null
Plain:
Annotated: get_Total, set_Total, Print
InvalidOperationException: Reflection-based serialization has been disabled for this application. ...
```

Cada aviso virou falha de verdade. `Exporter` nunca foi referenciado, então foi
apagado (o `Plugin` padrão sobreviveu, aparentemente porque o ILLink conseguiu
ver aquele literal). `InvoiceA` perdeu todos os métodos. O parâmetro anotado é
a correção: `[DynamicallyAccessedMembers]` diz ao ILLink que qualquer `Type` que
chegue ali precisa manter os métodos públicos, e o analisador passa a conferir
cada chamador. `[RequiresUnreferencedCode]` é a outra ferramenta: marca uma API
como incompatível, e o aviso sobe para quem a chama, como faz o
`JsonSerializer`. O JSON não foi apagado; foi **desligado** por um feature
switch.

### Feature switches: trimming muda comportamento, não só tamanho

`PublishTrimmed` grava switches no `runtimeconfig.json`. Alguns, do app acima:

```json
"System.Net.SocketsHttpHandler.Http3Support": false,
"System.StartupHookProvider.IsSupported": false,
"System.Text.Json.JsonSerializer.IsReflectionEnabledByDefault": false,
"System.Reflection.Metadata.MetadataUpdater.IsSupported": false,
"System.Runtime.Serialization.EnableUnsafeBinaryFormatterSerialization": false
```

`Http3Support` é novidade do .NET 10: com `PublishTrimmed` ou `PublishAot`, o
`HttpClient` deixa de carregar HTTP/3, a menos que você defina
`<Http3Support>true</Http3Support>`. `StartupHookProvider` desligado significa
que `DOTNET_STARTUP_HOOKS` é ignorado, e é assim que alguns agentes de APM se
acoplam. Cada switch também tem uma propriedade MSBuild (`EventSourceSupport`,
`InvariantGlobalization`, `UseSystemResourceKeys`) para cortar mais.

Pacotes recebem outro tratamento. Com `Newtonsoft.Json` 13.0.4, as chamadas no
seu código aparecem uma a uma, mas os avisos de dentro do pacote viram um só:

```text
Newtonsoft.Json.dll : warning IL2104: Assembly 'Newtonsoft.Json' produced trim warnings.
```

`<TrimmerSingleWarn>false</TrimmerSingleWarn>` abre a lista. Esse app ainda
funcionou com trimming, por sorte: o construtor e os getters do record eram
referenciados pelo próprio código.

### Trimming e ReadyToRun: a surpresa no startup

ReadyToRun (R2R) guarda código nativo ao lado do IL para o JIT trabalhar menos
no startup (veja o conceito sobre o JIT). O framework já vem em R2R. O mesmo app
com SQLite e Newtonsoft, com um `Stopwatch` em volta do `Main` (mediana de 11
execuções) e a contagem de métodos compilados pelo JIT
(`DOTNET_JitStdOutFile=/dev/stdout DOTNET_JitDisasmSummary=1`):

| Publicação | Tamanho | Métodos no JIT | Tempo no `Main` | Pico de RSS |
|---|---|---|---|---|
| framework-dependent | 0,96 MB de DLLs | 693 | 46 ms | 72,5 MB |
| framework-dependent, R2R | 2,7 MB de DLLs | 56 | 27 ms | 74,8 MB |
| self-contained single file | 77,3 MB | 693 | 46 ms | 68,7 MB |
| single file, trimmed | 19,3 MB | 3.021 | 101 ms | 29,1 MB |
| single file, trimmed, R2R | 44,0 MB | 153 | 19 ms | 53,0 MB |

`Newtonsoft.Json.dll` cresceu de 723 KB para 2,0 MB com R2R (2,9 vezes). A
linha com trimming é a armadilha: o JIT compilou 3.021 métodos em vez de 693,
sinal de que as cópias aparadas dos assemblies do framework perderam o código
pré-compilado, e o app passou o dobro do tempo no `Main`. Somar
`PublishReadyToRun` recompila o conjunto aparado e ganha em tudo, menos em
tamanho.

## Trade-offs

- **Framework-dependent é pequeno e recebe patch pelo SO; self-contained fica
  congelado.** Um app self-contained carrega as CVEs do seu runtime até ser
  republicado.
  ```bash
  dotnet publish -r linux-x64 --self-contained   # republicar a cada patch do runtime
  ```
- **Single file simplifica a cópia, não a lógica de caminhos.**
  `Assembly.Location` vem vazio, e bibliotecas nativas de pacotes ficam ao lado
  do arquivo ou são extraídas para uma pasta que precisa ser gravável e
  confiável.
- **Compressão corta o arquivo pela metade e dobra o startup.** Meça antes de
  ligar; serve para ferramenta rodada de vez em quando, não para CLI chamada em
  loop.
- **Trimming levou 82,8 MB para 20,2 MB, mas transforma bug de reflection em
  bug de produção.** Trate `IL2xxx` como erro e teste o binário publicado, não
  o `dotnet run`. Com a linha abaixo, a publicação do programa acima parou com
  `error IL2026`, `error IL2057` e `error IL2070`.
  ```xml
  <PublishTrimmed>true</PublishTrimmed>
  <WarningsAsErrors>$(WarningsAsErrors);IL2026;IL2057;IL2070;IL2104</WarningsAsErrors>
  ```
- **Trimming sem R2R pode iniciar mais devagar que sem trimming.** Aqui, 101 ms
  contra 46 ms no `Main`; trimming com R2R foi o mais rápido, com 19 ms.
- **R2R troca disco por startup.** Assemblies 2 a 3 vezes maiores; pouco ganho
  quando o código do próprio app é pequeno, já que o framework já é R2R.
- **Feature switches mudam o comportamento em runtime.** HTTP/3, startup hooks
  e JSON por reflection ficam desligados em apps .NET 10 com trimming até você
  religar.

## Lab

Neste lab você descreve em MSBuild as chaves de publicação (dependente de framework, self-contained com `RuntimeIdentifier`, single file, trimming, feature switches, ReadyToRun) e vê os analisadores de trim e de single-file apontarem o código que quebraria num app publicado, para depois corrigi-lo. Você recebe a estrutura pronta, com `ProjectFiles` e `AnalyzerFiles` lançando `NotImplementedException`, e o seu trabalho é devolver o texto de `.csproj` e de um pequeno programa C#. A ideia central é sentir que publicar é uma decisão de projeto que o SDK infere em parte (por exemplo, `PublishSingleFile` liga o analisador sozinho), e que o código com reflection só mostra o problema depois de publicado.

**O cenário**

O problema é publicar um executável enxuto sem quebrar o que depende de reflection.

- `ProjectFiles.cs`: métodos que devolvem `.csproj` (`FrameworkDependentProject`, `SelfContainedSingleFileProject`, `TrimmedProject`, `SlimRuntimeProject`).
- `AnalyzerFiles.cs`: `AnalyzerProject` (projeto com os analisadores ligados) e `FixedProgram` (a versão corrigida do programa).
- `SampleCode.cs`: o `RiskyProgram`, que já vem pronto e tem quatro problemas clássicos: tipo escolhido por string (IL2057), reflection sobre um `Type` sem anotação (IL2070), JSON por reflection (IL2026) e `Assembly.Location` (IL3000).

Este lab não roda `dotnet publish`: isso baixaria runtime packs de dezenas de MB. Os testes avaliam o projeto com `dotnet msbuild -getProperty` e rodam `dotnet build` de um projeto dependente de framework, em que os analisadores já emitem os mesmos avisos `IL`. Tudo offline.

**O que você vai fazer, passo a passo**

1. **Dependente de framework (TODO-00).** Em `FrameworkDependentProject`, faça um console `net10.0` sem RID, com `SelfContained` e `UseAppHost` falsos. O teste passa um RID só na linha de comando para provar que ele não implica self-contained.
2. **Self-contained e single file (TODO-01).** Em `SelfContainedSingleFileProject`, defina o RID, `SelfContained`, `PublishSingleFile` e `IncludeNativeLibrariesForSelfExtract`. Não escreva a propriedade do analisador: `PublishSingleFile` já liga `EnableSingleFileAnalyzer`.
3. **Trimming (TODO-02).** Em `TrimmedProject`, ligue `PublishTrimmed`, defina `TrimMode` e crie um `TrimmerRootAssembly` por assembly que o ILLink nunca deve cortar.
4. **Runtime enxuto (TODO-03).** Em `SlimRuntimeProject`, desligue o que o app não usa (`InvariantGlobalization`, `EventSourceSupport`, `UseSystemResourceKeys`), religue `Http3Support` (o trimming o desliga no .NET 10) e use `TrimmerSingleWarn` falso para ver todos os avisos.
5. **Ver os avisos (TODO-04).** Em `AnalyzerProject`, ligue os analisadores de trim e de single-file (via `PublishTrimmed` e `PublishSingleFile` ou direto) para que o build de `RiskyProgram` emita IL2026, IL2057, IL2070 e IL3000.
6. **Corrigir o código (TODO-05).** Em `FixedProgram`, troque `Type.GetType` por `typeof(Plugin)`, anote o parâmetro com `[DynamicallyAccessedMembers]`, use um `JsonSerializerContext` gerado por source generator e troque `Assembly.Location` por `AppContext.BaseDirectory`. O programa deve imprimir as mesmas quatro linhas, sem nenhum aviso IL. Este passo depende do TODO-04.

**Como saber que terminou**

`dotnet test` fica verde (leva uns 4 a 10 segundos). Você deve conseguir explicar qual aviso vem de qual linha do `RiskyProgram` e por que a versão corrigida continua funcionando depois do trimming.

**Desafios opcionais**

- **TODO-06:** `ReadyToRunCompressedProject` combina `PublishReadyToRun` e `EnableCompressionInSingleFile`.
- **TODO-07:** `StrictAnalyzerProject` põe IL2026, IL2057 e IL2070 em `WarningsAsErrors`, de modo que o build falhe em vez de avisar.

**Pré-requisitos:** o texto do concept sobre publicação self-contained, single-file e trimmed, estrutura básica de `.csproj` (`PropertyGroup`, `ItemGroup`) e o .NET 10 SDK (10.0.100).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Enquanto um TODO não for implementado, o teste dele falha com `NotImplementedException`. Depois, como acompanhamento manual (precisa de rede na primeira vez), rode `dotnet publish -c Release -r linux-x64 --self-contained -p:PublishSingleFile=true -p:PublishTrimmed=true` num projeto de console e compare o tamanho das saídas.

## Documentation Links

- [.NET application publishing overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/) (doc)
- [Create a single file for application deployment, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview) (doc)
- [Trim self-contained applications, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trim-self-contained) (doc)
- [Trimming options, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/trimming-options) (doc)
- [Fixing trim warnings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/trimming/fixing-warnings) (doc)
- [ReadyToRun deployment overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run) (doc)
- [HTTP/3 disabled by default with PublishTrimmed (.NET 10 breaking change), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/networking/10.0/http3-disabled-with-publishtrimmed) (doc)
- [.NET RID catalog, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/rid-catalog) (doc)
