---
version: 1.0
updatedAt: 2026-10-28
title: "Diretivas de Pré-processador e Compilação Condicional"
summary: #define e #if, os símbolos que o SDK define (RELEASE sim, WINDOWS não), DefineConstants, #pragma warning, #nullable, #line, #error, #region, as diretivas #! e #: de file-based apps e as alternativas ao #if: Conditional, feature switches e static readonly.
---
## Objective

C# não tem um pré-processador de macros como o de C, mas mantém um conjunto
pequeno de diretivas `#` que o compilador trata ao ler o arquivo: compilação
condicional com `#define` e `#if`, controle de diagnósticos com `#pragma
warning` e `#nullable`, mapeamento de fonte com `#line`, diagnósticos próprios
com `#error` e `#warning`, dobra no editor com `#region` e, novidade do .NET 10,
as linhas `#!` e `#:` de file-based apps. Este conceito mostra cada uma no .NET
10 / C# 14, os símbolos que o SDK define (e os que não define), como criar os
seus e quando uma checagem em runtime, um atributo ou um feature switch é
melhor que `#if`.

## Use Cases

- Uma biblioteca para `net8.0` e `net10.0` que só chama APIs novas onde existem.
- Diagnósticos ou ganchos de teste que não podem ir para o build Release.
- Silenciar um warning conhecido em código gerado ou legado, não no projeto todo.
- Geradores de código que querem erros apontando para o template, não o `.cs`.

## Deep Dive

### #define, #undef e #if

Um símbolo está definido ou não; ele não tem valor. `#define` e `#undef` valem
só no próprio arquivo e só no topo dele: depois de um comando, falham com
`CS1032: Cannot define/undefine preprocessor symbols after first token in
file`. Um `#endif` ausente dá `CS1027: #endif directive expected`.

```csharp
#define FEATURE_A
#undef DEBUG                                       // só neste arquivo
#if (FEATURE_A || FEATURE_B) && !DEBUG && NET10_0_OR_GREATER
Console.WriteLine("printed, even in a Debug build");
#endif
```

`#if` também aceita `==`, `!=`, `#elif` e `true`/`false` (`#if false` pula
texto que nem é C#). Símbolos diferenciam maiúsculas, e um `#if FEATURE_A` em
outro arquivo do projeto caiu no `#else`: `#define` não vaza entre arquivos.

### Os símbolos que o SDK define

```text
dotnet run              DEBUG TRACE NET NETCOREAPP NET10_0 NET10_0_OR_GREATER ...
dotnet run -c Release   RELEASE TRACE NET NETCOREAPP NET10_0 NET10_0_OR_GREATER ...
dotnet run -c Staging   TRACE NET NETCOREAPP NET10_0 NET10_0_OR_GREATER ...
```

Esses são os blocos `#if` que compilaram num console app `net10.0`. Ou seja,
`RELEASE` existe no Release (a página do pré-processador só cita `DEBUG` e
`TRACE`), e uma configuração própria define o próprio nome: `dotnet msbuild
-getProperty:DefineConstants -p:Configuration=Staging` imprime `TRACE;STAGING`,
então um `#if !DEBUG` pensado como "produção" é verdadeiro em Staging. Um alvo
`netstandard2.0` recebe `NETSTANDARD;NETSTANDARD2_0;NETSTANDARD2_0_OR_GREATER`.

Com `<TargetFrameworks>net8.0;net10.0</TargetFrameworks>`, um `#if
NET10_0_OR_GREATER ... #elif NET8_0` que imprime o ramo imprimiu `NET8_0
branch, runtime 8.0.22` em `bin/Debug/net8.0` e `NET10_0_OR_GREATER branch,
runtime 10.0.0` em `bin/Debug/net10.0`. `dotnet run` sozinho pede "Specify
which framework to run using '--framework'". Prefira checagens `_OR_GREATER`.

### Seus próprios símbolos via MSBuild e linha de comando

```xml
<DefineConstants>$(DefineConstants);FEATURE_X</DefineConstants>
<DefineConstants Condition="'$(Foo)' == 'bar'">$(DefineConstants);FOO_BAR</DefineConstants>
```

```text
dotnet run                                DEBUG TRACE NET10_0 FEATURE_X
dotnet run -p:Foo=bar                     DEBUG TRACE NET10_0 FEATURE_X FOO_BAR
dotnet run -p:DefineConstants=FEATURE_X               NET10_0 FEATURE_X
```

A última linha é a armadilha: `DefineConstants` na linha de comando é uma
propriedade global que substitui o valor do projeto, e `DEBUG` e `TRACE` somem
(o SDK acrescenta os símbolos de framework depois, em
`AddImplicitDefineConstants`). Vários símbolos pedem `-p:DefineConstants=A%3BB`
ou `"A;B"`. Uma propriedade própria mapeada no projeto, como `-p:Foo=bar`, é
mais segura.

### Checagem de plataforma é em runtime

Um build `net10.0` não tem símbolo `WINDOWS`, `LINUX` ou `OSX` (pulados neste
Mac); só o alvo `net10.0-windows` define `WINDOWS`. O mesmo binário roda em
todo lugar, então cheque o SO em runtime e deixe o analisador checar a guarda:

```csharp
Console.WriteLine(OperatingSystem.IsMacOS());                          // True
Console.WriteLine(RuntimeInformation.IsOSPlatform(OSPlatform.Linux));  // False
WinOnly.ReadRegistry();  // CA1416: 'WinOnly.ReadRegistry()' is only supported on: 'windows'.
if (OperatingSystem.IsWindows())
    WinOnly.ReadRegistry();  // sem warning: protegido
static class WinOnly { [SupportedOSPlatform("windows")] public static void ReadRegistry() { } }
```

### O custo das florestas de #if

Código num ramo inativo não é compilado, então nada o verifica:

```csharp
#if NET10_0_OR_GREATER
        return string.GetHashCode(s.AsSpan());
#else
        return s.GetHashCod();   // erro de digitação
#endif
```

`dotnet build -f net10.0` mostra `Build succeeded.`; o build de todos os alvos
falha no `net8.0` com `error CS1061: 'string' does not contain a definition
for 'GetHashCod'`. A CI precisa compilar toda configuração e todo alvo.

### Alternativas ao #if

- `[Conditional("DEBUG")]` remove a chamada e a avaliação dos argumentos (veja
  Atributos: Customizados e Lidos pelo Compilador). `Debug.Assert` usa isso:
  um `Debug.Assert(Probe(), "Probe failed")` que falha imprimiu `Process
  terminated. Assertion failed.` e saiu com 134 em Debug; em Release `Probe()`
  nem rodou.
- Um feature switch muda o comportamento sem recompilar. O item
  `<RuntimeHostConfigurationOption Include="MyApp.UseNewParser" Value="true"
  Trim="true" />` vai para o `runtimeconfig.json`; `AppContext.TryGetSwitch`
  retornou `true`, e `false` depois de editar o JSON. Segundo a documentação,
  `[FeatureSwitchDefinition]` (.NET 9) permite que "IL rewriters and compilers"
  substituam o valor do switch: é assim que trimming e Native AOT cortam código.
- `const bool On = false` faz o compilador C# descartar o ramo (`CS0162:
  Unreachable code detected`). Um `static readonly bool` lido de variável de
  ambiente fica no IL, mas o `DOTNET_JitDisasm` (Release, arm64) mostrou o JIT
  dobrando o valor: 104 bytes com load e desvio no Tier0, 20 bytes no Tier1
  (`mov w0, #2`); com a variável definida, o Tier1 manteve a chamada e tirou o
  teste. Os dois ramos continuam verificados pelo compilador.

### #error e #warning

```csharp
#warning DEBUG build: the fake payment gateway is wired in
#error TODO: pick a serializer before shipping
// Program.cs(1,10): warning CS1030: #warning: 'DEBUG build: the fake payment gateway is wired in'
// Program.cs(2,8): error CS1029: #error: 'TODO: pick a serializer before shipping'
```

Um `#warning` sozinho mantém `Build succeeded.`; `#error` quebra o build
(exit code 1), então `#if !NET10_0_OR_GREATER` com `#error` protege um alvo.
`#error version` também imprime `CS8304` com as versões do compilador e da
linguagem.

### #pragma warning e #nullable

```csharp
int a = 1;                       // linha 1: CS0219
#pragma warning disable CS0219   // "219" sem o prefixo também funciona
int b = 2;
#pragma warning restore CS0219
int c = 3;                       // linha 5: CS0219 de novo
```

Só as linhas 1 e 5 geraram warning. Sem lista, `disable` silencia todos até um
`restore` sem lista, e `restore` significa "voltar à configuração do projeto",
não "ligar": com `-p:NoWarn=CS0219` a linha 5 ficou quieta, com
`-p:WarningsAsErrors=CS0219` virou erro. Ids de analisadores também funcionam
(`CA1416` acima). A documentação diz que um `disable` vale até o fim do
arquivo; `#pragma warning enable` dá `CS1634: Expected 'disable' or 'restore'`.

`#nullable` é o vizinho para a análise de nulos. Num projeto com
`Nullable=enable`, `string a = null;` fica quieto depois de `#nullable disable`
e volta a dar `CS8600` depois de `#nullable restore`. Os flags se separam: com
`#nullable enable annotations`, `string? d` é válido e `d.Length` não avisa;
com `#nullable enable warnings`, `string? f` dá `CS8632` (anotação fora de um
contexto de anotações) e `f.Length` ainda dá `CS8602`.

### #line, #pragma checksum e #region

`#line` muda o arquivo e a linha que o compilador reporta, nos diagnósticos e
no PDB. Duas linhas (`int unused = 0;` e uma chamada que lança exceção) entre
`#line 200 "Template.tt"` e `#line default` deram:

```text
Template.tt(200,13): warning CS0219: The variable 'unused' is assigned but its value is never used
   at Gen.Throw() in Program.cs:line 13
   at Gen.Run() in Template.tt:line 201
```

`#line hidden` esconde linhas do depurador (uma exceção lançada ali apareceu na
`{` do método). A forma de intervalo que o Razor usa, `#line (3, 5) - (3, 30) 7
"Page.razor"`, mapeou um warning para `Page.razor(3,10)`. Segundo a
documentação, `#pragma checksum` grava no PDB o checksum do arquivo original.

`#region`/`#endregion` não mudam nada na saída, só dobram código no editor, e
precisam aninhar com `#if` (cruzar deu `CS1027` e `CS1038`). Uma região
escondendo 300 linhas diz que a classe deveria ser dividida; o StyleCop tem a
regra `SA1124` contra elas.

### #! e #: em file-based apps

No SDK 10, `dotnet run tool.cs` compila um arquivo só; as linhas `#:`
substituem o arquivo de projeto (detalhes em File-Based Apps):

```csharp
#!/usr/bin/env -S dotnet --
#:package Humanizer.Core@2.14.1
#:property DefineConstants=$(DefineConstants);FROM_FILE
using Humanizer;
Console.WriteLine(TimeSpan.FromSeconds(4000).Humanize(2));   // 1 hour, 6 minutes
#if FROM_FILE && DEBUG
Console.WriteLine("FROM_FILE and DEBUG are defined");         // impresso
#endif
```

Com a pasta do NuGet vazia, a primeira execução restaurou `humanizer.core` e os
pacotes do ILCompiler (file-based apps usam `PublishAot` por padrão), compilou
um projeto virtual em `~/Library/Application Support/dotnet/runfile/` em cerca
de 2,7 s; a seguinte reaproveitou o build (cerca de 0,15 s).

A página do pré-processador diz que o compilador ignora `#!` e `#:` e que
builds de projeto avisam. No SDK 10.0.100, num projeto normal, são erros:

```text
error CS9314: '#!' directives can be only used in scripts or file-based programs
error CS9298: '#:' directives can be only used in file-based programs ('-features:FileBasedProgram')
```

## Trade-offs

- **`#if` é de graça em runtime e caro em manutenção.** Ramos mortos nunca são
  verificados, então cada símbolo precisa do próprio build na CI.
- **Checagem em runtime ganha de símbolo de plataforma.**
  `OperatingSystem.IsWindows()` com CA1416 mantém um binário e um caminho
  compilado; `#if WINDOWS` só funciona com alvos específicos de SO.
- **Suprima com precisão.** Um id e um `restore` correspondente documentam uma
  exceção no lugar; um `disable` sem lista ou um `NoWarn` no projeto todo
  escondem problemas futuros.

## Documentation Links

- [C# preprocessor directives, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/preprocessor-directives) (doc)
- [Target frameworks in SDK-style projects (preprocessor symbols), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/frameworks) (doc)
- [C# compiler options for language features (DefineConstants), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language) (doc)
- [File-based apps reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/sdk/file-based-apps) (doc)
- [Platform compatibility analyzer, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/analyzers/platform-compat-analyzer) (doc)
- [FeatureSwitchDefinitionAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.codeanalysis.featureswitchdefinitionattribute) (doc)
