---
version: 1.0
updatedAt: 2026-10-28
title: "Analyzers, .editorconfig e quality gates no build"
summary: Como fazer o build do .NET 10 barrar problemas de qualidade: regras CA e IDE e quando cada uma roda, AnalysisMode e AnalysisLevel com contagens medidas, severidade e precedência em .editorconfig e .globalconfig, TreatWarningsAsErrors e companhia (incluindo o efeito no NuGet audit), supressões e o rastro que deixam, nullable, analyzers de terceiros com PrivateAssets e dotnet format no CI.
---
## Objective

O compilador C# faz muito mais do que checar sintaxe: o .NET SDK traz analyzers do Roslyn que apontam bugs de cultura, stack traces perdidos, cancellation tokens ignorados e centenas de outros problemas, e o compilador pode transformar qualquer um deles em falha de build. O difícil não é ligá-los, e sim saber qual botão faz o quê. `AnalysisMode` e `AnalysisLevel` escolhem quais regras de qualidade de código (CAxxxx) ficam ativas, `EnforceCodeStyleInBuild` decide se as regras de estilo de código (IDExxxx) rodam na linha de comando, `.editorconfig` e `.globalconfig` definem a severidade por regra ou por categoria com regras de precedência próprias, e `TreatWarningsAsErrors`, `WarningsAsErrors`, `WarningsNotAsErrors` e `NoWarn` decidem o que quebra o build, incluindo avisos do NuGet audit que você talvez não espere. Este conceito compila os mesmos arquivos pequenos em cada configuração e mostra as linhas exatas de warning e error, as contagens de warnings e os exit codes, depois coloca o gate no `Directory.Build.props` e adiciona `dotnet format` para o CI. Versões usadas: SDK 10.0.100 (`Microsoft.CodeAnalysis.NetAnalyzers` embutido, file version 10.1.25.52411, e `dotnet format` 10.0.100), `Meziantou.Analyzer` 3.0.317.

## Use Cases

- Fazer uma solution inteira falhar no CI por bugs reais (stack traces perdidos, parsing dependente de cultura, dereference de null) enquanto os desenvolvedores continuam compilando localmente com warnings.
- Subir o conjunto de regras de um serviço novo para `Recommended` ou `All` e silenciar, por pasta, código gerado ou legado que não dá para corrigir agora.
- Impor o estilo de código do time (namespaces file-scoped, modificadores de acesso, chaves) no pull request em vez de em comentários de code review.
- Adicionar um pacote de analyzer de terceiros a uma biblioteca sem vazá-lo para todo projeto e pacote que consome a biblioteca.

## Deep Dive

### Duas famílias de regras, e o que um build simples roda

As regras de qualidade (prefixo CA) ficam em `Microsoft.CodeAnalysis.NetAnalyzers`, que o SDK adiciona como analyzer implícito; as regras de estilo (prefixo IDE) ficam em um analyzer de code style separado. `dotnet msbuild -getProperty` num projeto console `net10.0` recém-criado devolveu `EnableNETAnalyzers` `true`, `AnalysisLevel` `10.0`, `AnalysisMode` vazio, `EnforceCodeStyleInBuild` `false` e `TreatWarningsAsErrors` `false`. Depois compilei este arquivo (caminhos e links de ajuda estão cortados em todas as saídas abaixo):

```csharp
var o = new Orders();
Console.WriteLine(o.Total(new[] { 1, 2, 3 }));
await o.SaveAsync(CancellationToken.None);

public class Orders
{
    private int _unused;
    public int Total(int[] items) => items.Sum();
    public string Format(decimal value) => value.ToString();
    public bool IsAdmin(string role) => role.ToLower() == "admin";
    public async Task SaveAsync(CancellationToken ct)
    {
        await Task.Delay(10);
        try { int.Parse("x"); }
        catch (Exception ex) { throw ex; }
    }
}
```

```text
Program.cs(7,17): warning CS0169: The field 'Orders._unused' is never used
Program.cs(15,32): warning CA2200: Re-throwing caught exception changes stack information
```

Um warning CA e exit code 0. As outras regras que se aplicam aqui (membros estáticos, cultura, o `ct` ignorado) estão habilitadas como sugestão ou desabilitadas, e sugestões nunca chegam ao `dotnet build`. A documentação lista as regras habilitadas como warning no .NET 10; `CA2024` (`EndOfStream` em método async) não está nessa tabela, mas disparou como warning por padrão no meu build.

### AnalysisMode: o mesmo código em cinco modos

```xml
<AnalysisMode>Recommended</AnalysisMode>  <!-- None, Default, Minimum, Recommended, All -->
```

```text
None:        0 CA warnings
Default:     1  CA2200
Minimum:     9  CA1050 CA1822x4 CA1861 CA1862 CA2016 CA2200
Recommended: 13 + CA1304 CA1305x2 CA1311
All:         18 + CA1062 CA1515 CA1823 CA2007x2
```

`Recommended` adicionou as regras de cultura (`CA1305: The behavior of 'int.Parse(string)' could vary based on the current user's locale settings`) e `CA2016: Forward the 'ct' parameter to the 'Delay' method`. `All` adicionou regras que são ruído numa aplicação: `CA2007: Consider calling ConfigureAwait` e `CA1515` (tornar tipos públicos internal). Cada categoria tem sua propriedade: `AnalysisModeGlobalization=Recommended` sozinho deu os 4 warnings de cultura mais CA2200, e `AnalysisMode=Recommended` com `AnalysisModeGlobalization=None` deu 9. Um `AnalysisLevel=10.0-recommended` composto junto com `AnalysisMode=All` deu 13: o valor composto vence, como diz a documentação. `EnableNETAnalyzers=false` deu 0 mesmo com `AnalysisMode=All`. Por baixo, cada modo é um `.globalconfig` que vem no SDK (`analyzers/build/config/analysislevel_10_recommended.globalconfig`, com `global_level = -100`) e que os targets adicionam à compilação. Esse nível importa para a precedência mais abaixo.

### AnalysisLevel e a armadilha do "latest"

`AnalysisLevel` fixa o conjunto de regras de uma versão do .NET, para que um upgrade de SDK não traga warnings novos de surpresa. A documentação diz que o padrão é `latest`. No SDK 10.0.100 com `net10.0` o padrão foi `10.0`, e `latest` era mais antigo. Compilei um loop async sobre `reader.EndOfStream`:

```text
AnalysisLevel (unset):  Program.cs(2,9): warning CA2024: Do not use 'reader.EndOfStream' in an async method
AnalysisLevel=10.0 or preview:  same warning
AnalysisLevel=latest:   (no warning)   EffectiveAnalysisLevel=9.0
AnalysisLevel=latest-all: (no warning)
```

`Microsoft.NET.Sdk.Analyzers.targets` no 10.0.100 fixa `_LatestAnalysisLevel` em `9.0`, então `latest` desliga as cinco regras novas do .NET 10 (CA1873, CA1874, CA1875, CA2023, CA2024). Escreva `10.0-recommended`, não `latest-recommended`.

### Regras IDE não são impostas no build por padrão

Configurei três regras de estilo no `.editorconfig` com a forma `option = value:severity` (`dotnet_diagnostic.IDE0040.severity = warning` se comportou igual):

```ini
[*.cs]
dotnet_style_require_accessibility_modifiers = always:warning
csharp_style_namespace_declarations = file_scoped:warning
csharp_prefer_braces = true:suggestion
```

O código tinha um namespace em bloco, um `class Program` sem `internal` e um `if` sem chaves. A documentação diz que a IDE mostra isso enquanto você digita. O `dotnet build` ficou em silêncio (exit 0, nenhum diagnóstico); com `-p:EnforceCodeStyleInBuild=true` eles apareceram:

```text
Program.cs(1,11): warning IDE0161: Convert to file-scoped namespace
Program.cs(3,11): warning IDE0040: Accessibility modifiers required
Program.cs(5,21): warning IDE0040: Accessibility modifiers required
```

`IDE0011` (chaves) ficou fora do build porque sua severidade é `suggestion`. Mais uma armadilha: com `dotnet_diagnostic.IDE0005.severity = warning` (usings não usados) o build imprimiu `CSC : warning EnableGenerateDocumentationFile: Set MSBuild property 'GenerateDocumentationFile' to 'true' in project file to enable IDE0005 (Remove unnecessary usings/imports) on build`, e só com essa propriedade apareceu `warning IDE0005: Using directive is unnecessary.`.

### Severidade no .editorconfig e quem vence

A documentação ordena as chaves: uma entrada por ID de regra vence uma entrada de categoria, que vence a entrada de todas as regras:

```ini
dotnet_diagnostic.CA1822.severity = none                       # uma regra
dotnet_analyzer_diagnostic.category-Globalization.severity = none   # uma categoria
dotnet_analyzer_diagnostic.severity = warning                  # toda regra habilitada
```

Só com a última linha e sem `AnalysisMode`, o exemplo produziu 13 warnings CA, porque as sugestões viraram warnings. As chaves em massa têm uma pegadinha que a documentação menciona: com `AnalysisMode=Recommended` ou `All`, `category-Globalization.severity = none` foi ignorado (CA1304, CA1305 e CA1311 continuaram disparando) e `category-Performance.severity = error` também, enquanto `CA1822.severity = none` funcionou. O arquivo de modo do SDK define severidades por ID de regra, e uma entrada por ID vence uma de categoria. Use `AnalysisMode<Category>` ou entradas por ID.

Entre arquivos, combinei um `.editorconfig` na raiz com `CA1822 = warning`, um `Legacy/.editorconfig` com `CA1822 = none` e um `.globalconfig` (`is_global = true`) com `CA1822 = error`. Resultado: `warning CA1822` quatro vezes em `Program.cs` e nada em `Legacy/Old.cs`. Só com o `.globalconfig`: `error CA1822` cinco vezes, também com `AnalysisMode=Recommended`. O `.editorconfig` mais profundo venceu na sua pasta, qualquer `.editorconfig` venceu o `.globalconfig`, e o meu `.globalconfig` (`global_level` padrão 100) venceu o arquivo de modo do SDK (`-100`). Um `.globalconfig` vale para todos os arquivos do projeto independentemente da pasta, o que faz dele o lugar da política do projeto inteiro.

### Transformando warnings em errors

No exemplo com o modo `Default` (CS0169 mais CA2200):

```text
-p:TreatWarningsAsErrors=true                            error CA2200, error CS0169   exit 1
-p:WarningsAsErrors=CA2200                               error CA2200, warning CS0169 exit 1
-p:TreatWarningsAsErrors=true -p:WarningsNotAsErrors=CS0169   error CA2200, warning CS0169 exit 1
-p:NoWarn=CA2200                                         warning CS0169               exit 0
-p:CodeAnalysisTreatWarningsAsErrors=true                error CA2200, warning CS0169 exit 1
-p:TreatWarningsAsErrors=true -p:CodeAnalysisTreatWarningsAsErrors=false   warning CA2200, error CS0169 exit 1
```

`CodeAnalysisTreatWarningsAsErrors` mexe só nas regras CA (o SDK troca para a variante `_warnaserror` do arquivo de modo). Duas interações com o `.editorconfig`: `NoWarn=CA1822` silenciou uma regra que o `.editorconfig` tinha posto como `error`, e `WarningsNotAsErrors=CA1822` não a rebaixou, porque essa propriedade só impede a promoção de warnings e a regra era error pela própria severidade.

### TreatWarningsAsErrors também derruba o restore

Referenciei `Newtonsoft.Json` 12.0.1, que tem um advisory conhecido, e adicionei ao projeto uma task `<Warning Code="DEMO001" ...>` própria:

```text
(defaults)                  warning NU1903: Package 'Newtonsoft.Json' 12.0.1 has a known high severity vulnerability, ...
                            warning DEMO001: A custom MSBuild warning                                exit 0
TreatWarningsAsErrors=true  error NU1903: Warning As Error: Package 'Newtonsoft.Json' 12.0.1 has ...  exit 1
  + WarningsNotAsErrors=NU1903   both back to warnings                                              exit 0
NuGetAudit=false, TreatWarningsAsErrors=true          warning DEMO001                               exit 0
NuGetAudit=false, MSBuildTreatWarningsAsErrors=true   error DEMO001                                 exit 1
NuGetAudit=false, -warnaserror                        error DEMO001                                 exit 1
```

O NuGet respeita `TreatWarningsAsErrors`, então uma vulnerabilidade publicada hoje à noite quebra o build de amanhã de um código que não mudou. Isso pode ser o que você quer; se não for, exclua `NU1901;NU1902;NU1903;NU1904` com `WarningsNotAsErrors` e trate o audit à parte. Warnings puros do MSBuild (`MSBxxxx`, tasks próprias) ignoram `TreatWarningsAsErrors`; eles precisam de `MSBuildTreatWarningsAsErrors` ou da opção de CLI `-warnaserror`, com `MSBuildWarningsNotAsErrors` como lista de exceções.

### Nullable reference types: o maior gate

`<Nullable>enable</Nullable>` mais `<WarningsAsErrors>$(WarningsAsErrors);nullable</WarningsAsErrors>`, nesta classe:

```csharp
public string Name { get; set; }
public string? Email { get; set; }
public int EmailLength() => Email.Length;
public static string NameOf(int id) => Find(id).Name;   // Find devolve Customer?
```

```text
Nullable=disable:  warning CS8632: The annotation for nullable reference types should only be used in code within a '#nullable' annotations context. (x2)
Nullable=enable:   warning CS8618: Non-nullable property 'Name' must contain a non-null value when exiting constructor. ...
                   warning CS8602: Dereference of a possibly null reference. (x2)
+ WarningsAsErrors=nullable:  error CS8618, error CS8602 (x2)   exit 1
```

A palavra-chave `nullable` cobre toda a família de warnings de nulidade sem listar IDs. `dotnet msbuild -getProperty:WarningsAsErrors` mostrou que o SDK também acrescenta `NU1605;SYSLIB0011`, e é por isso que o trecho mantém `$(WarningsAsErrors)`.

### Supressões, e quais deixam rastro

Suprimi CA1822 (com `Recommended`) de quatro formas e gerei um log SARIF com `<ErrorLog>build.sarif,version=2.1</ErrorLog>`:

```csharp
#pragma warning disable CA1822 // sem estado por design
    public int Pragma() => 1;
#pragma warning restore CA1822
    [SuppressMessage("Performance", "CA1822:Mark members as static", Justification = "Mocked in tests")]
    public int Attribute() => 2;
    public int Global() => 3;   // GlobalSuppressions.cs: [assembly: SuppressMessage(..., Scope = "member", Target = "~M:Shop.Prices.Global~System.Int32")]
```

A quarta foi `dotnet_diagnostic.CA1822.severity = none` em `Legacy/.editorconfig`.

```text
console: only "warning CA1822: Member 'Unsuppressed' ..."
SARIF:   CA1822 Prices.cs:8  suppressions=[inSource, justification=None]
         CA1822 Prices.cs:12 suppressions=[inSource, justification='Mocked in tests']
         CA1822 Prices.cs:14 suppressions=[inSource, justification='Public API, cannot change']
         CA1822 Prices.cs:16 (not suppressed)
with -p:NoWarn=CA1822: 0 results in SARIF
```

As supressões no código continuam visíveis para as ferramentas, e o `Justification` viaja junto com o atributo; o comentário do pragma não. `none` no `.editorconfig` e `NoWarn` não deixam rastro no log: o diagnóstico simplesmente não existe.

### Um analyzer de terceiros, privado ao seu projeto

`dotnet add package Meziantou.Analyzer` escreveu a referência com `<PrivateAssets>all</PrivateAssets>` por conta própria. Referenciei a biblioteca a partir de um app console e depois removi o `PrivateAssets`:

```text
PrivateAssets=all:  Lib/Codes.cs: warning MA0006: Use string.Equals instead of Equals operator
                    Lib/Codes.cs: warning MA0011: Use an overload of 'ToString' that has a 'System.IFormatProvider' parameter
no PrivateAssets:   the same 2, plus App/Program.cs(2,19): warning MA0006 and App/Program.cs(4,19): warning MA0011
```

Sem ele o analyzer passou pela project reference para dentro do app, e o `dotnet pack` escreveu `<dependency id="Meziantou.Analyzer" version="3.0.317" exclude="Build,Analyzers" />` no nuspec, uma dependência para todo consumidor (com `PrivateAssets=all` o grupo ficou vazio).

### Um gate para a solution inteira

O conceito de projetos SDK-style explica como o `Directory.Build.props` é importado; este é o gate que coloquei nele:

```xml
<Project>
  <PropertyGroup>
    <Nullable>enable</Nullable>
    <AnalysisMode>Recommended</AnalysisMode>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <WarningsAsErrors>$(WarningsAsErrors);nullable</WarningsAsErrors>
  </PropertyGroup>
  <PropertyGroup Condition="'$(CI)' == 'true'">
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
```

Com um `.editorconfig` na raiz (`CA1822 = suggestion`, namespaces file-scoped como warning) e um projeto `Domain` com `amount.ToString()` num namespace em bloco:

```text
dotnet build Shop.sln          warning IDE0161, warning CA1305   exit 0
CI=true dotnet build Shop.sln  error IDE0161, error CA1305       exit 1
```

Variáveis de ambiente são propriedades do MSBuild. O GitHub Actions define `CI=true` (o Azure Pipelines define `TF_BUILD`, então ajuste a condição), e assim os desenvolvedores veem warnings localmente e o pipeline falha.

### dotnet format como gate de CI

O `dotnet format` roda as correções de estilo e de analyzers fora do build, independentemente do `EnforceCodeStyleInBuild`:

```text
dotnet format style --verify-no-changes                  IDE0040 x2, IDE0161          exit 2
dotnet format style --verify-no-changes --severity info  + info IDE0011, info IDE0130  exit 2
dotnet format analyzers --verify-no-changes              warning CA2200               exit 2
dotnet format analyzers (fix), then verify again         "throw ex;" -> "throw;"      exit 0
```

O `--severity` padrão é `warn`, como documentado, então regras no nível de sugestão passam a menos que você o abaixe.

## Trade-offs

- **`Recommended` é um padrão melhor que `All`.** `All` adicionou `CA2007` e `CA1515` em código de aplicação, regras pensadas para bibliotecas. Comece em `Recommended` e ligue mais por categoria.
- **Fixe o nível com um número.** `latest` era 9.0 no SDK 10.0.100 e escondeu cinco regras do .NET 10; `<AnalysisLevel>10.0-recommended</AnalysisLevel>` é explícito e um upgrade de SDK não o move.
- **`TreatWarningsAsErrors` é amplo.** Ele também promove os warnings do NuGet audit, então código que não mudou pode falhar depois que um advisory é publicado. Prefira ligá-lo só no CI, ou exclua `NU190x` e rode o audit como etapa própria.
- **Code style no build custa tempo.** `EnforceCodeStyleInBuild` adiciona os analyzers de IDE a toda compilação; uma etapa separada de `dotnet format --verify-no-changes` mantém o build local rápido e ainda bloqueia o merge.
- **Prefira supressões que deixam rastro.** `[SuppressMessage]` com `Justification` aparece no SARIF e no code review; `NoWarn` e severidade `none` apagam o diagnóstico em todo o escopo.
- **`.editorconfig` por pasta vence o `.globalconfig`.** Bom para pastas legadas ou geradas, mas um `none` esquecido no fundo da árvore desliga em silêncio uma regra que você acha que está sendo imposta.

## Documentation Links

- [Code analysis in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/overview) (doc)
- [Configure code analysis rules, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/configuration-options) (doc)
- [Configuration files for code analysis rules, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/configuration-files) (doc)
- [Suppress code analysis warnings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/suppress-warnings) (doc)
- [MSBuild properties for Microsoft.NET.Sdk, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) (doc)
- [dotnet format command, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-format) (doc)
