---
version: 1.0
updatedAt: 2026-10-15
title: "Projetos SDK-Style, MSBuild e Directory.Build.props"
summary: O que o atributo Sdk importa, o globbing implícito de arquivos, como perguntar ao MSBuild o que ele avaliou (-getProperty, -getItem, -pp, binlog), Directory.Build.props e .targets com suas pegadinhas de ordem, .slnx e ArtifactsPath, tudo medido no SDK 10.0.100.
---
## Objective

Um `.csproj` moderno costuma ter seis linhas, e mesmo assim o `dotnet build`
compila todo `.cs` embaixo dele, adiciona `System.Linq` a todo arquivo,
referencia o framework `Microsoft.NETCore.App` inteiro e escreve código gerado
em `obj/`. Tudo isso vem do SDK nomeado na primeira linha, não do arquivo.
Este conceito abre a caixa: o que `Sdk="Microsoft.NET.Sdk"` importa, como o
globbing implícito decide quais arquivos são compilados, como perguntar ao
MSBuild o que ele realmente avaliou (`-getProperty`, `-getItem`, `-pp` e logs
binários), como `Directory.Build.props` e `.targets` compartilham configuração
numa solução, por que a ordem de avaliação faz algumas dessas configurações não
terem efeito nenhum, e onde entram o arquivo de solução e a pasta `artifacts`.
Tudo abaixo foi executado no SDK 10.0.100 (MSBuild 18.0.2) em projetos
descartáveis.

## Use Cases

- Colocar `Nullable`, `TreatWarningsAsErrors` e o target framework em um só
  lugar, em vez de repetir em doze arquivos de projeto.
- Descobrir por que um `.cs` perdido quebrou o build, ou por que um arquivo que
  você queria excluir continua sendo compilado.
- Depurar "por que esta propriedade tem este valor" sem chutar.
- Escolher entre `Microsoft.NET.Sdk`, `.Web` e `.Worker` num projeto novo.
- Tirar toda a saída de build da árvore de código para que ferramentas e CI
  saibam onde olhar.

## Deep Dive

### O que o atributo SDK faz

`<Project Sdk="Microsoft.NET.Sdk">` é atalho para dois imports: `Sdk.props` no
topo absoluto do arquivo e `Sdk.targets` no final, ambos em
`dotnet/sdk/10.0.100/Sdks/Microsoft.NET.Sdk/`. O arquivo de propriedades define
os padrões, o corpo do seu projeto sobrescreve, e o arquivo de targets define a
lógica de build usando os valores finais. Pedir ao MSBuild o projeto totalmente
expandido mostra quanta coisa se esconde atrás de seis linhas:

```text
$ dotnet msbuild -pp:full.xml      # preprocess: inline de todos os imports
$ wc -l full.xml
   17147 full.xml
```

Cada arquivo importado aparece em `full.xml` entre faixas de comentário com o
caminho completo, então o arquivo também responde "de onde vem este valor?".
Perguntar é mais barato com `-getProperty` e `-getItem`, que imprimem o
resultado avaliado em JSON sem compilar:

```text
$ dotnet msbuild -getProperty:AssemblyName -getProperty:RootNamespace -getProperty:Version
{"Properties":{"AssemblyName":"c","RootNamespace":"c","Version":"1.0.0"}}
```

Os nomes do assembly e do namespace vêm do nome do arquivo de projeto, e
`Version` começa em `1.0.0`. Os três SDKs mais comuns diferem no que somam a
isso:

| SDK | Referências de framework | Usings implícitos extras | Itens padrão extras |
|---|---|---|---|
| `Microsoft.NET.Sdk` | `Microsoft.NETCore.App` | `System`, `System.IO`, `System.Linq`, `System.Net.Http`, `System.Threading`... | nenhum |
| `Microsoft.NET.Sdk.Web` | `Microsoft.NETCore.App` e `Microsoft.AspNetCore.App` | `Microsoft.AspNetCore.*`, `Microsoft.Extensions.*`, `System.Net.Http.Json` | `appsettings*.json` como `Content` |
| `Microsoft.NET.Sdk.Worker` | `Microsoft.NETCore.App` | `Microsoft.Extensions.Hosting`, `Logging`, `Configuration`, `DependencyInjection` | nenhum (o template adiciona um package reference a `Microsoft.Extensions.Hosting`) |

A coluna de usings foi lida do `obj/Debug/net10.0/*.GlobalUsings.g.cs` gerado
por projetos `dotnet new console`, `web` e `worker`. `ImplicitUsings` é só a
chave que liga esse arquivo, e `Nullable` é o contexto de nulabilidade do
compilador para o projeto inteiro.

### Globbing implícito: o sistema de arquivos é o projeto

Os projetos antigos listavam cada arquivo-fonte. Os projetos SDK-style declaram
um glob: a saída do preprocess contém

```xml
<Compile Include="**/*$(DefaultLanguageSourceExtension)"
         Exclude="$(DefaultItemExcludes);$(DefaultExcludesInProjectFolder)"
         Condition=" '$(EnableDefaultCompileItems)' == 'true' " />
```

ou seja, todo `.cs` abaixo da pasta do projeto é compilado, em qualquer
subpasta, e `DefaultItemExcludes` tira só `bin/`, `obj/`, `*.user`, arquivos de
projeto e de solução e alguns arquivos de editor. Um arquivo `Old.cs.bak` ou
`Skip.txt` não casa; um `.cs` em qualquer pasta casa. O experimento: uma
biblioteca com `A.cs`, `sub/B.cs` e um `obj_ignored/Broken.cs` esquecido.

```text
$ dotnet build
obj_ignored/Broken.cs(1,14): error CS1040: Preprocessor directives must appear as the first non-whitespace character on a line
```

`dotnet msbuild -getItem:Compile` lista exatamente o que o glob pegou, e é a
primeira coisa a rodar quando um build compila algo inesperado. A correção é um
`Remove` explícito:

```xml
<ItemGroup>
  <Compile Remove="obj_ignored/**" />
</ItemGroup>
```

Depois disso `-getItem:Compile` mostra só `A.cs` e `sub/B.cs`. Incluir pelo
nome um arquivo que o glob já inclui é erro, não um no-op:

```text
error NETSDK1022: Duplicate 'Compile' items were included. The .NET SDK includes 'Compile' items from your project directory by default. You can either remove these items from your project file, or set the 'EnableDefaultCompileItems' property to 'false' ...
```

`EnableDefaultCompileItems=false` esvazia a lista (verificado: `Compile` vira
`[]`), e `EnableDefaultItems=false` desliga os globs de todos os tipos de item.
O SDK `Web` soma um glob parecido para `Content`, e é assim que o
`appsettings.json` aparece na lista de itens de um projeto web e não na de um
console.

### Condições, labels e quem vence

Um `PropertyGroup` aceita `Condition`, e `Label` é uma etiqueta livre para
ferramentas:

```xml
<PropertyGroup Condition="'$(Configuration)' == 'Release'" Label="Release only">
  <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
</PropertyGroup>
```

```text
$ dotnet msbuild -getProperty:TreatWarningsAsErrors                          -> false
$ dotnet msbuild -p:Configuration=Release -getProperty:TreatWarningsAsErrors -> true
```

Propriedades de linha de comando (`-p:`) são propriedades globais e vencem
qualquer coisa nos arquivos: com `<Greeting>from-file</Greeting>` no projeto,
`-p:Greeting=from-cli` avalia para `from-cli`. Entre arquivos, vence a última
atribuição, e por isso a ordem de import da próxima seção importa.

### Directory.Build.props e Directory.Build.targets

Ao avaliar um projeto, o MSBuild procura `Directory.Build.props` na pasta do
projeto e depois em cada pasta pai, e importa o primeiro que encontrar.
`Directory.Build.targets` é achado do mesmo jeito e importado no fim. Um
arquivo típico na raiz do repositório:

```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
  </PropertyGroup>
</Project>
```

Com esse arquivo, o `Core.csproj` pode ser só `<Project Sdk="Microsoft.NET.Sdk" />`.
As regras passam a valer: um método com `name.ToUpper()` sobre um `string?`
quebra o build com `error CS8602: Dereference of a possibly null reference`,
que sem o arquivo seria apenas um warning. Um log binário confirma que o
arquivo foi importado em cada projeto (`Importing project
".../Directory.Build.props" into project ".../Microsoft.Common.props"`), e o
`-pp` mostra as propriedades dele inline, logo antes do corpo do projeto.

Dois comportamentos surpreendem, ambos medidos aqui.

**Só o arquivo mais próximo é importado.** Um segundo
`tests/Directory.Build.props` esconde o da raiz; o projeto de testes passa a
avaliar com `TargetFramework` vazio e `TreatWarningsAsErrors=false`:

```text
{"Nullable":"","TargetFramework":"","IsTestProject":"true","TreatWarningsAsErrors":"false"}
```

O encadeamento é explícito, no arquivo aninhado:

```xml
<Project>
  <Import Project="$([MSBuild]::GetPathOfFileAbove('Directory.Build.props', '$(MSBuildThisFileDirectory)../'))" />
  <PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup>
</Project>
```

e a mesma consulta passa a devolver `Nullable=enable`,
`TargetFramework=net10.0` e `TreatWarningsAsErrors=true`. O
`dotnet new buildprops --inherit` gera essa linha de import.

**Um arquivo `.props` não enxerga o que o projeto define.** Ele é avaliado
antes do corpo do projeto. Com a mesma condição nos dois arquivos, só a versão
em `.targets` dispara:

```text
<PropertyGroup Condition="'$(OutputType)' == 'Exe'"><FromProps>...    -> FromProps: ""
(o mesmo grupo no Directory.Build.targets)                            -> FromTargets: "exe-in-targets"
```

A regra da documentação do MSBuild: padrões vão em `.props`, tudo que deriva do
que o projeto escolheu vai em `.targets`, e itens em `.props` permitem que o
projeto os remova depois com `Remove`.

O `Directory.Packages.props` é achado do mesmo jeito e guarda as versões de
pacotes; esse é outro assunto, coberto no conceito "Central Package Management
and Package Source Mapping".

### Soluções, pastas geradas e ArtifactsPath

Uma solução só lista projetos para IDEs e para o `dotnet build` na raiz. O
formato XML `.slnx` é menor que o antigo `.sln` baseado em GUIDs:

```text
$ dotnet new sln -n Demo --format slnx && dotnet sln add src/Core src/App
<Solution>
  <Folder Name="/src/">
    <Project Path="src/Core/Core.csproj" />
    <Project Path="src/App/App.csproj" />
  </Folder>
</Solution>
```

A documentação diz que "a partir do .NET 10" o formato padrão do `dotnet new
sln` é `slnx`. No SDK 10.0.100 desta máquina não foi: `dotnet new sln` gerou
`Demo.sln`, o help mostra `Default: sln` e foi preciso `--format slnx`. Trate
o padrão como dependente da versão e passe `--format` em scripts. O
`dotnet sln migrate` converte uma `.sln` existente e gerou um `Demo.slnx` ao
lado dela.

Ao lado de cada projeto, um build escreve `bin/Debug/net10.0/` (o `.dll`, o
`.pdb`, o `.deps.json`, o `.runtimeconfig.json` e o apphost) e `obj/`, que
guarda o `project.assets.json` do NuGet, o `AssemblyInfo.cs` e o
`GlobalUsings.g.cs` gerados, e um assembly de referência em `obj/.../ref/`. O
item `InternalsVisibleTo` do conceito de monólito modular vai parar nesse
arquivo gerado:

```csharp
[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("Core.Tests")]
```

então o `Core.csproj` não precisa de `AssemblyInfo.cs` (veja o conceito
"Modular Monolith Module Boundaries").

Para manter a saída fora das pastas de código, defina `ArtifactsPath` no
`Directory.Build.props` (ou `UseArtifactsOutput=true` para o local padrão).
Depois de adicionar `<ArtifactsPath>$(MSBuildThisFileDirectory)artifacts</ArtifactsPath>`,
o layout ficou `artifacts/bin/App/debug/`, `artifacts/obj/Core/debug/` e assim
por diante, e `src/Core` passou a conter só `Core.csproj` e o código. `publish`
e `package` ganham pastas irmãs segundo a documentação, e `dotnet new
buildprops --use-artifacts` gera o arquivo.

### Logs binários

`dotnet build -bl:build.binlog` escreve um log de 470 KB com tudo que o MSBuild
fez. Ele pode ser reproduzido pelos loggers normais sem compilar de novo:

```text
$ dotnet msbuild build.binlog -v:diag > replay.txt     # 154.666 linhas
```

e pesquisado por imports, valores de propriedades e parâmetros de tasks (aqui,
o parâmetro `TreatWarningsAsErrors=true` passado ao compilador). O MSBuild
Structured Log Viewer lê o mesmo arquivo numa árvore navegável; é uma
ferramenta à parte e não foi usada aqui.

## Trade-offs

- **O globbing implícito tira cerimônia e esconde o conjunto de arquivos.**
  Nada no projeto diz quais arquivos compilam, então um arquivo perdido em
  qualquer subpasta entra no build. `-getItem:Compile` e `Compile Remove` são a
  saída, e `EnableDefaultCompileItems=false` é a opção nuclear que volta a
  exigir a lista completa.
- **Padrões compartilhados versus autonomia do projeto.** Um
  `Directory.Build.props` na raiz dá regras uniformes, mas uma biblioteca que
  precisa de `Nullable` desligado tem de sobrescrever no próprio projeto, e um
  projeto de terceiros copiado para a árvore herda suas configurações sem aviso.
  ```xml
  <PropertyGroup><Nullable>disable</Nullable></PropertyGroup>  <!-- o corpo do projeto vence o Directory.Build.props -->
  ```
- **Vence um arquivo, não todos.** Arquivos `Directory.Build.props` aninhados se
  substituem em vez de empilhar. Encadeie com `GetPathOfFileAbove` ou mantenha
  exatamente um por árvore.
- **A ordem de avaliação é a principal fonte de "minha configuração não faz
  nada".** Coloque padrões em `.props` e o que depende da escolha do projeto em
  `.targets`; confirme com `-getProperty` em vez de ler arquivos.
- **`TreatWarningsAsErrors` em tudo é rígido.** Transforma upgrade de analyzer
  em build quebrado. Uma opção mais estreita é listar códigos em
  `WarningsAsErrors`.
- **`.slnx` é menor e dá diffs melhores, mas nem toda ferramenta o lê ainda.** O
  padrão muda entre versões do SDK, então fixe o formato explicitamente.
- **`ArtifactsPath` ajuda ferramentas e quebra caminhos fixos.** Scripts que
  procuram `bin/Release` ao lado do projeto param de funcionar.

## Lab

Neste lab você escreve os arquivos MSBuild que fazem um projeto moderno funcionar. Você recebe a classe `MsBuildFiles` com métodos que lançam `NotImplementedException`, e cada um deve devolver o texto de um arquivo MSBuild. Os testes gravam seu texto numa árvore de pastas descartável e perguntam ao `dotnet msbuild` o que ele avaliou de verdade. A ideia central é ver o MSBuild confirmar (ou contradizer) o que você escreveu, e entender a ordem: `Directory.Build.props` roda antes do corpo do projeto, `Directory.Build.targets` roda depois.

**O cenário**

O problema é configurar vários projetos sem repetir propriedades em cada `.csproj`.

- `src/SdkStyleLab/MsBuildFiles.cs`: os métodos a implementar (`ClassLibraryProject`, `ProjectWithExcludedFile`, `DirectoryBuildProps`, `ProjectOverridingNullable`, `DirectoryBuildTargets`, `NestedDirectoryBuildProps`, `CustomTargetProject`).
- `MsBuildSandbox.cs`: cria a árvore temporária e roda `dotnet msbuild -getProperty:... -getItem:Compile`.
- `MsBuildTests.cs`: um teste por TODO.

Nada é restaurado nem compilado, e não há rede. Os testes só falham se o MSBuild realmente avaliar algo diferente do que o TODO pede.

**O que você vai fazer, passo a passo**

1. **Projeto SDK mínimo (TODO-00).** Em `ClassLibraryProject`, devolva `<Project Sdk="Microsoft.NET.Sdk">` com um `PropertyGroup` só com `TargetFramework` `net10.0`. O SDK cuida do resto, inclusive do glob implícito de `Compile`.
2. **Excluir do glob (TODO-01).** Em `ProjectWithExcludedFile`, acrescente um `ItemGroup` com `Compile Remove="Legacy/**"` para tirar a pasta `Legacy`.
3. **Props compartilhado (TODO-02).** Em `DirectoryBuildProps` (raiz `<Project>` sem `Sdk`), defina `TargetFramework`, `Nullable`, `LangVersion` 14.0 e `TreatWarningsAsErrors`. Em `ProjectOverridingNullable`, sobrescreva `Nullable` para `disable` no corpo: o corpo vem depois do props, então ganha.
4. **Targets enxerga o projeto (TODO-03).** Em `DirectoryBuildTargets`, defina `ProjectKind` como `library` por padrão e `app` quando `OutputType` for `Exe`. Isso só funciona porque o `.targets` é importado depois do corpo do projeto.
5. **Encadear arquivos (TODO-04).** Em `NestedDirectoryBuildProps`, importe o pai com `GetPathOfFileAbove` e só então defina `IsTestProject` como `true`. Sem o import, o arquivo da raiz fica escondido.
6. **Target customizado (TODO-05).** Em `CustomTargetProject`, crie o target `WriteStamp` que usa `WriteLinesToFile` (com `Overwrite="true"`) para gravar `$(AssemblyName)|$(TargetFramework)` em `stamp.txt` dentro de `$(MSBuildProjectDirectory)`.

**Como saber que terminou**

`dotnet test` fica verde. Você deve conseguir explicar por que `Nullable` do projeto vence o do props, por que o `.targets` consegue ler o `OutputType`, e rodar `dotnet msbuild MyProject.csproj -getProperty:Nullable -getItem:Compile` em um projeto seu para ver o mesmo que os testes veem.

**Desafios opcionais**

- **TODO-06:** `ReleaseStrictProject` liga `TreatWarningsAsErrors` só quando `Configuration` é `Release`.
- **TODO-07:** `ExplicitCompileProject` desliga os itens de compilação padrão e lista `Program.cs` à mão.

**Pré-requisitos:** estrutura básica de `.csproj` (`PropertyGroup`, `ItemGroup`), o texto do concept sobre projetos SDK-style e `Directory.Build.props`, e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Cada método começa lançando `NotImplementedException` com um comentário `TODO-NN` dizendo o que o arquivo deve conter, então os testes vermelhos mostram o que falta.

## Documentation Links

- [Customize your build, Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/msbuild/customize-your-build) (doc)
- [.NET project SDKs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/overview) (doc)
- [MSBuild properties for .NET SDK projects, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/project-sdk/msbuild-props) (doc)
- [Artifacts output layout, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/sdk/artifacts-output) (doc)
- [dotnet new sln and the default templates, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-new-sdk-templates) (doc)
- [MSBuild binary log, MSBuild wiki](https://github.com/dotnet/msbuild/blob/main/documentation/wiki/Binary-Log.md) (doc)
