---
version: 1.0
updatedAt: 2026-11-20
title: "MSBuild: targets e tasks próprias, e binlogs"
summary: Avaliação e execução no MSBuild (por que uma propriedade lida no lugar errado vem vazia), targets com BeforeTargets, AfterTargets e DependsOnTargets, Inputs e Outputs com tempos medidos, itens com batching e transformações, Exec, Warning e Error, Directory.Build.targets, tasks inline e compiladas (PrivateAssets, TaskHostFactory) e diagnóstico com binlog lido por código, PerformanceSummary e -check, com o que mudou no SDK 11.
---
## Objective

Todo `dotnet build` é um programa que o MSBuild executa em duas fases, e a lógica de build que você pode acrescentar é pequena: um `Target` com ganchos e regras incrementais, algumas tasks embutidas (`Exec`, `Message`, `Warning`, `Error`, `WriteLinesToFile`), itens com metadados e, quando isso não basta, uma task sua. Este concept cobre o que o concept de projetos SDK-style não cobre: por que uma propriedade lida no lugar errado vem vazia, como se pendurar em `CoreCompile` ou `Publish`, as regras exatas de `Inputs` e `Outputs` (com números), batching e transformações, tasks inline e compiladas e a forma como são carregadas, e como descobrir o que um build fez lendo o binary log por um programa de console em vez do visualizador gráfico. A ordem de importação e o `-getProperty`/`-pp` não se repetem aqui, veja [SDK-Style Projects, MSBuild and Directory.Build.props](/dotnet-concepts/sdk-style-projects-msbuild-and-directory-build-props).

Versões: SDK 10.0.100 (MSBuild 18.0.2.52411, `net10.0`) e SDK 11.0.100 GA (MSBuild 18.12.2.53018, `net11.0`), `Microsoft.Build.Utilities.Core` 17.14.28, `Humanizer.Core` 2.14.1, `MSBuild.StructuredLogger` 2.3.269. Tudo rodou em macOS arm64 (Apple M4 Max); os tempos são dessa máquina.

## Use Cases

- Gerar um arquivo-fonte (informações de build, um manifesto) antes do `CoreCompile` e recompilar só quando as entradas mudam.
- Colocar um target compartilhado em `Directory.Build.targets` para que todo projeto do repositório o receba.
- Escrever uma task de build grande demais para um fragmento inline, e distribuí-la sem quebrar o build que a edita.

## Deep Dive

### Duas fases: avaliação, depois execução

O MSBuild primeiro avalia o projeto (todas as propriedades, depois todos os itens, com os imports) e só então executa os targets. Uma propriedade fora de um target é calculada na avaliação, na ordem do arquivo, então enxerga só o que foi definido acima dela, e uma lista de itens fora de um target ainda não é conhecida quando as propriedades são calculadas:

```xml
<PropertyGroup>
  <Early>$(Late)</Early>   <Late>set-in-body</Late>   <Files>@(Compile)</Files>
</PropertyGroup>
<Target Name="Show">
  <Message Importance="high" Text="Early=[$(Early)] Late=[$(Late)] Files=[$(Files)]" />
  <PropertyGroup><Late>changed-by-target</Late></PropertyGroup>
</Target>
```

```text
$ dotnet msbuild -getProperty:Early -getProperty:Late -getProperty:Files   (em uma linha aqui)
{"Early":"","Late":"set-in-body","Files":"@(Compile)"}
$ dotnet msbuild -t:Show
  Early=[] Late=[set-in-body] Files=[Program.cs]
```

`Early` vem vazia porque `Late` ainda não existia. `Files` é o texto literal `@(Compile)` depois da avaliação e só vira a lista quando uma task a lê, na execução. Propriedades definidas dentro de um target mudam o valor para os targets seguintes, e `-getProperty:Late` combinado com `-t:Show` imprimiu `changed-by-target`, o valor depois da execução dos targets, que o `-getProperty` sozinho não tem como saber.

A ordem aparece com uma propriedade de rastro acrescentada em cada arquivo (`|DBprops|csproj-body|DBtargets`) e nos números de linha do `-pp` no SDK 10.0.100: `Sdk.props` (linha 9), `Microsoft.Common.props` (57), `Directory.Build.props` (92), o corpo do projeto (2095), `Microsoft.Common.targets` (4885), `Directory.Build.targets` (10977), depois `Microsoft.NET.Sdk.targets` (11139) e `Microsoft.NET.Publish.targets` (14714). Consequência, medida: quando dois arquivos definem um target com o mesmo nome, vale a última definição, em silêncio. `BeforeBuild`, um gancho vazio do `Microsoft.Common.targets`, foi substituído pelo meu `Directory.Build.targets`. `PrepareForPublish`, definido no csproj e no `Directory.Build.targets`, foi substituído pelo do próprio SDK (definido depois dos dois): nenhuma das minhas mensagens rodou e nenhum aviso apareceu. Para mudar um target do SDK, pendure-se nele em vez de redefini-lo.

### Targets: ganchos, ordem e condições

`BeforeTargets` e `AfterTargets` penduram um target em outro existente sem tocar nele (os ganchos se empilham, ao contrário do antigo override de `BeforeBuild`), `DependsOnTargets` puxa outros antes, e `Condition` pode desligar o target:

```xml
<Target Name="Before" BeforeTargets="CoreCompile"><Message Importance="high" Text="[Before]" /></Target>
<Target Name="After" AfterTargets="CoreCompile" DependsOnTargets="Prepare"><Message Importance="high" Text="[After] produced @(IntermediateAssembly)" /></Target>
<Target Name="Prepare"><Message Importance="high" Text="[Prepare] runs first" /></Target>
<Target Name="OnlyRelease" BeforeTargets="CoreCompile" Condition="'$(Configuration)' == 'Release'"> ... </Target>
```

```text
Debug:   [Before]  [Prepare] runs first  [After] produced obj/Debug/net10.0/Targets.dll
Release: [Before]  [OnlyRelease] only in Release  [Prepare] runs first  [After] produced obj/Release/net10.0/Targets.dll
```

Um gancho `AfterTargets` não roda quando o target dele falha: com um erro de compilação no projeto, só `[Before]` foi impresso. Para pendurar-se no publish, `BeforeTargets="Publish"` rodou depois da linha `App -> .../bin/Release/net10.0/App.dll` do build e antes da cópia para `publish/` (`publishing to bin/Release/net10.0/publish/`), e `$(PublishDir)` já estava definido ali porque a avaliação tinha terminado.

### Build incremental: Inputs e Outputs

Um target com `Inputs` e `Outputs` é pulado quando toda saída é mais nova que toda entrada. A linha de log aparece na verbosidade normal (`-v:n`):

```xml
<Target Name="WithIO" BeforeTargets="CoreCompile" Inputs="@(Schema)" Outputs="$(IntermediateOutputPath)schemas.manifest">
  <WriteLinesToFile File="$(IntermediateOutputPath)schemas.manifest" Lines="@(Schema->'%(Filename)')" Overwrite="true" />
</Target>
```

| Situação (SDK 10.0.100; as linhas 1, 2, 6 e 7 se repetiram no 11.0.100 com o mesmo resultado) | Resultado |
|---|---|
| primeiro build | o target roda |
| segundo build | `Skipping target "WithIO" because all output files are up-to-date with respect to the input files.` |
| `touch` numa entrada, ou arquivo novo | roda de novo |
| apagar um arquivo de entrada | pulado: o manifesto ainda lista o arquivo apagado |
| `Inputs` sem `Outputs` | `error MSB4058: The "InputsOnly" target is missing its output specification. If a target declares inputs, it must also declare outputs.` |
| `Outputs` sem `Inputs`, ou um target que nunca cria a saída declarada | roda em todo build |
| `Inputs` é uma lista vazia | `Skipping target "EmptyInputs" because it has no inputs.` |

Então a especificação ausente é um erro, não um aviso, e a falha silenciosa é a linha da exclusão: se remoções importam, ponha o arquivo de projeto ou um arquivo de lista em `Inputs`. Segundo a documentação de builds incrementais, um target pulado ainda avalia seus `ItemGroup` e `PropertyGroup` como se tivesse rodado (o arquivo-fonte gerado mais abaixo continua em `Compile` no segundo build, que compilou), mas as tasks não rodam, então uma propriedade definida pelo `Output` de uma task não é definida.

O ganho, medido com um target que faz `Exec sleep 1` antes do `CoreCompile`:

```text
                          SDK 10.0.100                 SDK 11.0.100
incremental, 1o build     BundleAssets 1047 ms         1020 ms
incremental, 2o build     0 ms, Elapsed 00:00:00.23    0 ms, Elapsed 00:00:00.03
sem Inputs/Outputs        1036 a 1047 ms               1018 ms
relógio, 3 execuções      0.31 a 0.32 s contra 1.35 a 1.40 s    0.18 s contra 1.18 a 1.21 s
```

### Itens: Include, Remove, Update, batching e transformações

```xml
<ItemGroup>
  <Doc Include="docs/guide.md;docs/api.md;docs/old.md;notes/todo.md" />
  <Doc Remove="docs/old.md" />
  <Doc Update="docs/*.md" Kind="manual" />
  <Doc Update="notes/todo.md" Kind="note" Owner="ana" />
</ItemGroup>
<Target Name="Show">   <!-- cada Message tem Importance="high", omitido por largura -->
  <Message Text="per file: %(Doc.Identity) kind=%(Doc.Kind) owner=[%(Doc.Owner)]" />
  <Message Text="batch: %(Doc.Kind) has @(Doc)" />
</Target>
```

```text
per file: docs/guide.md kind=manual owner=[]   (depois api.md, depois todo.md kind=note owner=[ana])
batch: manual has docs/guide.md;docs/api.md    (depois: batch: note has notes/todo.md)
```

`@(Doc->'%(Filename)')` é uma transformação (uma saída por item, `guide;api;todo` aqui), e `%(Doc.Kind)` num parâmetro de task faz o MSBuild rodar a task uma vez por valor distinto (batching). A mesma notação de metadados funciona na `Condition` de um item, `Update` define metadados em itens que já estão na lista (os globs casam com as especificações deles) e `-getItem:Doc` imprime o resultado em JSON sem compilar.

### Tasks que já vêm prontas: Exec, Message, Warning, Error

```text
Exec "echo hello from the shell; uname -s" ConsoleToMSBuild=true -> <Output ConsoleOutput> lines=[hello from the shell] [Darwin]
Exec "echo about to fail; exit 3"   -> error MSB3073: The command "echo about to fail; exit 3" exited with code 3.   (exit code 1, a task seguinte não rodou)
Exec "exit 3" IgnoreExitCode="true" -> continued, exit=3
<Warning Code="DEMO001" Text="a custom warning" />        -> Tasks.proj(23,5): warning DEMO001: a custom warning
<Error Code="DEMO002" Condition="'$(Strict)' == 'true'" /> -> error DEMO002: a custom error   (exit code 1, tasks seguintes puladas)
```

`Message` tem `Importance` `low`, `normal` (padrão) e `high`. Em `-v:m` só `high` apareceu; em `-v:n` apareceram normal e high, e `low` ficou escondida. Use `high` enquanto depura e `normal` para o que você quer no log do CI. O `Exec` passa por `/bin/sh` aqui, então um target multiplataforma precisa de `Condition="$([MSBuild]::IsOSPlatform('Windows'))"` (nesta máquina avaliou `IsMac=True`, `IsWin=False`) ou de uma task no lugar da linha de shell.

### Directory.Build.targets, um arquivo-fonte gerado e o clean

A lógica compartilhada por todos os projetos fica em `Directory.Build.targets`, que é importado depois do corpo do projeto (veja a ordem acima):

```xml
<Project>
  <Target Name="GenerateBuildInfo" BeforeTargets="CoreCompile" Inputs="$(MSBuildProjectFile)" Outputs="$(IntermediateOutputPath)BuildInfo.g.cs">
    <ItemGroup>
      <_Line Include="namespace Gen%3B" />
      <_Line Include="internal static class BuildInfo { public const string Project = &quot;$(MSBuildProjectName)&quot;%3B }" />
    </ItemGroup>
    <WriteLinesToFile File="$(IntermediateOutputPath)BuildInfo.g.cs" Lines="@(_Line)" Overwrite="true" />
    <ItemGroup>
      <Compile Include="$(IntermediateOutputPath)BuildInfo.g.cs" />
      <FileWrites Include="$(IntermediateOutputPath)BuildInfo.g.cs" />
    </ItemGroup>
  </Target>
</Project>
```

`%3B` é um `;` escapado (um sem escape quebra a linha em dois itens). A classe é `internal` porque o target roda em `App` e em `Lib`: com `public` o build imprimiu `warning CS0436: The type 'BuildInfo' in '.../App/obj/.../BuildInfo.g.cs' conflicts with the imported type 'BuildInfo' in 'Lib'`. `FileWrites` é o que o `dotnet clean` apaga: com a linha, o `dotnet clean` removeu `obj/Debug/net10.0/BuildInfo.g.cs`; sem ela, o arquivo ficou. Todo target desse arquivo roda em todo projeto que o herda, então dê uma condição ao target (`'$(GenerateBuildInfo)' == 'true'`) quando só alguns projetos o querem. Os gates por analyzers no mesmo arquivo estão em [Analyzers, EditorConfig and Build Quality Gates](/dotnet-concepts/analyzers-editorconfig-and-build-quality-gates).

### Tasks inline com RoslynCodeTaskFactory

```xml
<UsingTask TaskName="Slugify" TaskFactory="RoslynCodeTaskFactory" AssemblyFile="$(MSBuildToolsPath)/Microsoft.Build.Tasks.Core.dll">
  <ParameterGroup><Text ParameterType="System.String" Required="true" /><Slug ParameterType="System.String" Output="true" /></ParameterGroup>
  <Task>
    <Using Namespace="System.Text.RegularExpressions" />
    <Code Type="Fragment" Language="cs"><![CDATA[ Slug = Regex.Replace(Text.Trim().ToLowerInvariant(), "[^a-z0-9]+", "-").Trim('-'); ]]></Code>
  </Task>
</UsingTask>
<Slugify Text="  Custom Targets, Tasks &amp; Binlogs!  "><Output TaskParameter="Slug" PropertyName="Result" /></Slugify>
```

Imprimiu `slug = custom-targets-tasks-binlogs`. `Type="Fragment"` é o corpo do `Execute`, `Type="Class"` recebe uma subclasse inteira de `Task` com `[Required]` e `[Output]`, e `Log` está disponível. Limites medidos: LINQ, `Regex` e sintaxe do C# 13 (`is > 0 and < 5`, `[1, 2, 3]`) compilaram; `System.Text.Json` não (`Reference Include="System.Text.Json"` deu `MSB3755: Could not find reference`, e um caminho para a DLL do runtime ou para a de referência deu `CS0012: The type 'Object' is defined in an assembly that is not referenced`), e pacotes NuGet não podem ser referenciados de jeito nenhum. Uma task inline custou 0.41 a 0.43 s por execução no SDK 10 (0.12 s para o mesmo projeto sem ela) e 0.40 s contra 0.16 s no SDK 11. A documentação diz que o suporte a depuração é limitado e que o `CodeTaskFactory` só chega ao C# 4.0, então use `RoslynCodeTaskFactory`. O que tem dependências ou testes é task compilada.

### Uma task compilada: netstandard2.0, dependências e como é carregada

```xml
<TargetFramework>netstandard2.0</TargetFramework>
<CopyLocalLockFileAssemblies>true</CopyLocalLockFileAssemblies>
<PackageReference Include="Microsoft.Build.Utilities.Core" Version="17.14.28" PrivateAssets="all" ExcludeAssets="runtime" />
```

```csharp
public sealed class LineCounter : Task
{
    [Required] public ITaskItem[] Files { get; set; } = [];
    public int WarnAbove { get; set; } = int.MaxValue;
    [Output] public int Total { get; set; }
    public override bool Execute()
    {
        foreach (var f in Files) {
            var lines = File.ReadLines(f.ItemSpec).Count(); Total += lines;
            if (lines > WarnAbove) Log.LogWarning(null, "LC001", null, f.ItemSpec, 0, 0, 0, 0, "File has {0} lines (limit {1})", lines, WarnAbove);
        }
        return !Log.HasLoggedErrors;
    }
}
```

O consumidor compila primeiro o projeto da task sem referenciar o assembly dela, carrega a DLL pelo caminho e a chama depois da compilação:

```xml
<ProjectReference Include="../Tasks/BuildTasks.csproj" ReferenceOutputAssembly="false" />
<UsingTask TaskName="BuildTasks.LineCounter" AssemblyFile="$(MSBuildThisFileDirectory)../Tasks/bin/$(Configuration)/netstandard2.0/BuildTasks.dll" />
<Target Name="CountLines" AfterTargets="CoreCompile"><LineCounter Files="@(Compile)" WarnAbove="2" /></Target>
```
```text
  Program.cs: 3 lines
Program.cs : warning LC001: File has 3 lines (limit 2)
  total=38 big=Program(3);Consumer.GlobalUsings.g(8);...AssemblyAttributes(4);Consumer.AssemblyInfo(22)
```

O `@(Compile)` depois do `CoreCompile` já inclui os arquivos gerados em `obj/`, por isso voltaram quatro arquivos. Distribuir a task como pacote NuGet (as pastas `build/` e `buildTransitive`) está em [Packaging and Publishing a NuGet Library](/dotnet-concepts/packaging-and-publishing-a-nuget-library). Três detalhes foram medidos e não são óbvios:

- **`PrivateAssets="all"`** mantém o pacote do próprio MSBuild fora da lista de dependências. O `dotnet pack` escreveu `<dependencies><group targetFramework=".NETStandard2.0" /></dependencies>` com ele e `<dependency id="Microsoft.Build.Utilities.Core" version="17.14.28" exclude="Build,Analyzers" />` sem ele, o que arrastaria o MSBuild para todo consumidor do pacote.
- **As dependências da própria task precisam ficar ao lado da DLL.** Com `Humanizer.Core` a task falhou com `error MSB4018: ... System.IO.FileNotFoundException: Could not load file or assembly 'Humanizer, Version=2.14.0.0 ...'` até `CopyLocalLockFileAssemblies` ser ligado. Só isso também copiou 13 DLLs do fecho de dependências do próprio MSBuild (`System.Collections.Immutable.dll`, `System.Memory.dll`, ...); `ExcludeAssets="runtime"` no pacote do MSBuild deixou apenas `Humanizer.dll`. Uma dependência que o MSBuild já traz pode esconder o erro: `Newtonsoft.Json` carregou sem ser copiado porque a pasta do SDK o contém.
- **A DLL de uma task carregada fica em cache no processo.** Com `TaskFactory="TaskHostFactory"` no `UsingTask`, a task rodou fora do processo (o `Exec` mostrou `MSBuild pid 64841`, a task registrou `task pid 64873`; sem o atributo, os dois foram 64810). Um task host nasce e morre com o build, então a DLL nunca fica presa.

A falha clássica (o rebuild de `BuildTasks.dll` recusado porque um nó ainda o mantém aberto) é um bloqueio de arquivo do Windows e não foi reproduzida no macOS. A mesma causa com um sintoma mais discreto foi, e ela é o padrão no .NET 11 (última seção).

### Diagnosticando um build: verbosidade, binary log, resumo de desempenho

`-v:n` imprime as linhas `Skipping target` e os motivos `Building target "X" completely.`, e `-v:d` acrescenta as reatribuições de propriedade e, para cada target, o arquivo do SDK de onde vem e qual target depende dele. O binary log tem tudo isso: `dotnet build -bl:build.binlog` gravou 473.278 bytes aqui (504.221 no SDK 11), `;ProjectImports=None` gravou 182.746 bytes (os arquivos de projeto não são embutidos) e `;ProjectImports=ZipFile` gravou 183.157 bytes mais um zip. `dotnet msbuild build.binlog -v:diag` o reproduz como texto. O Structured Log Viewer é gráfico e não foi usado. Para consultar o log pelo terminal, o pacote `MSBuild.StructuredLogger` o lê como uma árvore de objetos:

```csharp
var build = BinaryLog.ReadBuild(args[0]);
foreach (var t in build.FindChildrenRecursive<Target>().OrderByDescending(t => t.Duration).Take(3)) Console.WriteLine($"{t.Duration.TotalMilliseconds,8:F1} ms  {t.Name}");
foreach (var m in build.FindChildrenRecursive<Message>().Where(m => m.Text.Contains("BundleAssets")).Take(2)) Console.WriteLine(m.Text);
```

```text
primeiro build:  1038.7 ms  BundleAssets (Perf.csproj)   /  Building target "BundleAssets" completely.
segundo build :    18.3 ms  ProcessFrameworkReferences   /  Skipping target "BundleAssets" because all output files are up-to-date with respect to the input files.
```

O mesmo programa também listou `projects=15 targets=488 tasks=250` para um build de dois projetos e achou por que um target rodou: `Output file "obj/Debug/net10.0/BuildInfo.g.cs" does not exist.` Ele leu os logs dos dois SDKs. Sem um log, `-clp:PerformanceSummary;NoSummary` imprime o tempo por target e por task (`1047 ms BundleAssets`, `1046 ms Exec` na medição acima). `-check` roda os analisadores do BuildCheck: com dois projetos forçados no mesmo `OutputPath`, o SDK 10.0.100 imprimiu 8 `BC0101` (`have conflicting output paths`) e 8 `BC0102` (`write the same file`). `-graph` compilou os dois projetos com um grafo de projetos pré-calculado e funcionou (a documentação diz que é experimental). `-getTargetResult:Build` imprime os itens do target em JSON (a DLL de saída e seus metadados). Não existe a opção `-timeline`: nenhuma ocorrência em `dotnet msbuild -h` nos dois SDKs.

### Livro vs hoje, e o que o .NET 11 mudou

O formato antigo de projeto, da era .NET Framework e de muitos livros, tinha um `Compile Include` por arquivo, itens `Reference` com `HintPath` para `packages\`, um `packages.config` e linhas explícitas de `Import Project="$(MSBuildExtensionsPath)\...\Microsoft.Common.props"` e `Microsoft.CSharp.targets`. Um `Old.csproj` de 28 linhas avaliou como `Compile = Program.cs, Properties/AssemblyInfo.cs` (um `Forgot.cs` ao lado não fazia parte do build), `TargetFramework` vazio e `TargetFrameworkVersion = v4.8`; o `dotnet restore` respondeu `Nothing to do. None of the projects specified contain packages to restore.` para o `packages.config`, e o `dotnet build` parou com `error : The BaseOutputPath/OutputPath property is not set for project 'Old.csproj'`. Hoje `Sdk="Microsoft.NET.Sdk"` são esses dois imports, o glob de `Compile` substitui a lista, `PackageReference` substitui o `packages.config`, e os overrides de `BeforeBuild`/`AfterBuild` dos livros antigos dão lugar a `BeforeTargets`/`AfterTargets`.

O que o SDK do .NET 11 mudou neste assunto (conferido em "What's new in the SDK and tooling for .NET 11" e executado no 11.0.100):

- **O MSBuild Server vem ligado por padrão** em `dotnet build` e `dotnet msbuild` (para desligar, `DOTNET_CLI_USE_MSBUILD_SERVER=false` ou `MSBUILDUSESERVER=0`). Um processo quente (`/nodemode:8`, o mesmo pid em todos os builds que rodei) agora hospeda os builds, uma task inline registrou `ran in MSBuild, runtime .NET 11.0.0` em vez de `dotnet`, e a DLL de uma task continua carregada entre builds: editei a task, o `dotnet build` recompilou `BuildTasks.dll` e mesmo assim imprimiu a mensagem antiga; com `MSBUILDUSESERVER=0` o código novo rodou, e com `TaskHostFactory` rodou a cada edição. Use `TaskHostFactory` nas tasks que você está desenvolvendo.
- **`-check` não imprimiu nada com o server ligado** (0 `BC0101` e 0 `BC0102` para os mesmos projetos), e imprimiu 8 e 8 com `MSBUILDUSESERVER=0`. Não está documentado até onde achei, então rode as checagens com o server desligado no CI até isso ser confirmado.
- A busca por curingas na avaliação ficou mais rápida (docs: 10 a 13 por cento no Windows, não medido aqui). `UseOptimizedPublish` continua opt-in, o que importa para targets próprios depois de `Build` (veja [Upgrading to .NET 11 and Reading the Breaking Changes](/dotnet-concepts/upgrading-to-dotnet-11-and-reading-breaking-changes)).
- O filtro de eventos do binary log (`-bl:out.binlog;Exclude=Message,...`) está no wiki do MSBuild na `main`, mas não no 18.12.2 distribuído: `MSB1029: Invalid binary logger parameter(s)` (só docs para o recurso).
- Targets, itens, `Exec`, o pulo incremental e os resultados de avaliação acima foram idênticos no 10.0.100 e no 11.0.100.

## Trade-offs

- **Ganchos são baratos, redefinições são silenciosas.** `BeforeTargets`/`AfterTargets` se empilham com outros ganchos, mas um segundo target com o mesmo nome substitui o primeiro sem aviso, e um target do SDK definido depois vence o seu. Dê um prefixo aos seus targets e pendure-se nos do SDK em vez de redefini-los.
- **Build incremental só é tão bom quanto os `Inputs`.** `Inputs`/`Outputs` fizeram um passo de 1 s custar 0 ms, mas uma entrada apagada não invalida a saída e um target que nunca escreve a saída roda sempre. Liste tudo que muda o resultado, inclusive o arquivo de projeto (`Inputs="@(Schema);$(MSBuildProjectFullPath)"`).
- **Um target do `Directory.Build.targets` roda em todo lugar.** Ótimo para política, perigoso para código gerado (o conflito `CS0436`). Condicione-o a uma propriedade.
- **Tasks inline são rápidas de escrever e lentas de iniciar.** Somam cerca de 0.3 s por chamada aqui, não têm depurador, pacotes nem testes. Uma task compilada custa um projeto e uma história de empacotamento, e é a única forma que pode ter dependências.
- **Binary logs são completos, então são sensíveis.** Registram propriedades e linhas de comando, e o wiki diz que só as variáveis de ambiente que influenciam o MSBuild são registradas, a menos que `MSBUILDLOGALLENVIRONMENTVARIABLES=1`, o que, nas palavras do wiki, "reduces, but does not eliminate, the likelihood of leaking sensitive information". Trate um binlog do CI como segredo antes de anexá-lo a uma issue.

## Documentation Links

- [MSBuild targets, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-targets) (doc)
- [Build incrementally, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/incremental-builds) (doc)
- [MSBuild batching, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-batching) (doc)
- [MSBuild inline tasks, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-inline-tasks) (doc)
- [UsingTask element and task factories, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/usingtask-element-msbuild) (doc)
- [Tutorial: create a custom task, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/tutorial-custom-task-code-generation) (doc)
- [MSBuild binary log, MSBuild wiki](https://github.com/dotnet/msbuild/blob/main/documentation/wiki/Binary-Log.md) (doc)
- [MSBuild Server, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild-server) (doc)
- [What's new in the SDK and tooling for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/sdk) (doc)
