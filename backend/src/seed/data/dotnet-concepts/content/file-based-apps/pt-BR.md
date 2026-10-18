---
version: 1.0
updatedAt: 2026-10-15
title: "File-Based Apps: Rodando um Único Arquivo .cs (.NET 10)"
summary: dotnet run app.cs com as diretivas #:package, #:sdk e #:property, o projeto virtual e o cache, o padrão Native AOT que quebra Dapper e EF Core no dotnet run, shebang, publish e dotnet project convert.
---
## Objective

O SDK do .NET 10 consegue compilar e rodar um único arquivo `.cs`, sem
`.csproj`: `dotnet run app.cs`. A configuração que antes ficava no arquivo de
projeto passa para diretivas `#:` no topo do arquivo, e o SDK gera um projeto em
memória para compilar. Isso torna o C# usável para scripts e ferramentas
pequenas, mas o projeto gerado não é neutro: ele mira Native AOT por padrão, e
esse padrão muda o comportamento da aplicação até no `dotnet run`. Este conceito
mostra o que o SDK gera, quais diretivas existem, a armadilha do AOT e quando
converter o arquivo num projeto de verdade. Tudo abaixo foi executado no SDK
10.0.100.

## Use Cases

- Trocar um script Bash ou Python num repositório .NET por C#, usando as mesmas
  bibliotecas que a aplicação usa.
- Experimentar um pacote NuGet ou uma API em segundos, sem criar projeto.
- Distribuir uma ferramenta de linha de comando pequena como um único executável
  nativo.
- Começar um protótipo num arquivo e convertê-lo em projeto quando ele crescer.

## Deep Dive

### Rodando um arquivo, com pacotes e propriedades

```csharp
#:package Humanizer@2.14.1
#:property PublishAot=false
using Humanizer;

Console.WriteLine($"Args: {string.Join(", ", args)}");
Console.WriteLine(TimeSpan.FromMinutes(90).Humanize(precision: 2));
Console.WriteLine("file based app".Pascalize());
```

```text
$ dotnet run hello.cs -- one two
Args: one, two
1 hour, 30 minutes
FileBasedApp
```

Os argumentos da aplicação vão depois do `--`. `dotnet hello.cs a b` é uma forma
mais curta, e `echo 'Console.WriteLine("hello from stdin");' | dotnet run -` lê
o programa da entrada padrão. As diretivas são:

- `#:package Nome@Versão` adiciona um `PackageReference`.
- `#:property Nome=Valor` define uma propriedade do MSBuild.
- `#:sdk Nome` troca o `Microsoft.NET.Sdk` padrão.
- `#:project caminho` referencia um projeto (documentado; não exercitado aqui).

As diretivas precisam vir antes de qualquer código; uma colocada depois de um
statement falha com `CS9297: '#:' directives cannot be after first token in
file`. `#:sdk Microsoft.NET.Sdk.Web` basta para uma minimal API:

```csharp
#:sdk Microsoft.NET.Sdk.Web
#:property PublishAot=false

var app = WebApplication.Create(args);
app.MapGet("/ping", () => new { pong = true, at = "file-based app" });
app.Run("http://localhost:5240");
// curl http://localhost:5240/ping -> {"pong":true,"at":"file-based app"}
```

### O projeto virtual e o cache de build

O SDK sintetiza um projeto a partir do arquivo e o compila como qualquer outro.
O jeito mais fácil de ver esse projeto é pedir por ele: `dotnet project convert
hello.cs` grava uma pasta `hello/` com uma cópia do código, sem as diretivas, e
este `.csproj` (o arquivo original fica intacto):

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <PackAsTool>true</PackAsTool>
    <UserSecretsId>hello-fc9e4937...</UserSecretsId>
    <PublishAot>false</PublishAot>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Humanizer" Version="2.14.1" />
  </ItemGroup>
</Project>
```

O mesmo comando num arquivo sem `#:property PublishAot=false` gera
`<PublishAot>true</PublishAot>`: esse é o padrão. `PackAsTool` e um
`UserSecretsId` derivado do arquivo também são padrões.

A saída do build não fica ao lado do arquivo. Nesta máquina macOS ela foi para
`~/Library/Application Support/dotnet/runfile/hello-<hash>/bin/debug/` (a
documentação descreve uma pasta dentro do diretório temporário do sistema, então
o local varia por plataforma). O SDK pula o build quando nada mudou: a primeira
execução depois de uma edição levou 0,79 s aqui e a seguinte, 0,15 s.

### O padrão AOT chega ao dotnet run

O `dotnet run app.cs` continua usando o JIT; ele não compila para nativo. Mas
com `PublishAot=true` o build grava os feature switches do Native AOT no
`runtimeconfig.json` gerado, entre eles:

```json
"System.Runtime.CompilerServices.RuntimeFeature.IsDynamicCodeSupported": false,
"System.Text.Json.JsonSerializer.IsReflectionEnabledByDefault": false,
"System.Diagnostics.Tracing.EventSource.IsSupported": false,
"System.Reflection.Metadata.MetadataUpdater.IsSupported": false
```

Então código que gera código em tempo de execução falha durante o
desenvolvimento, exatamente como falharia num binário nativo. Três execuções no
SDK 10.0.100 sem `PublishAot=false`:

```text
// Dapper 2.1.66, db.Query<Row>("select 1 as Id, 'dapper' as Name")
IsDynamicCodeSupported: False
Unhandled exception. System.PlatformNotSupportedException: Dynamic code generation is not supported on this platform.
   at System.Reflection.Emit.DynamicMethod..ctor(...)

// EF Core 10.0.0 com SQLite, primeiro uso do DbContext
Unhandled exception. System.InvalidOperationException: Model building is not supported when publishing with NativeAOT. Use a compiled model.

// JsonSerializer.Serialize(new Point(1, 2))
warning IL3050: Using member 'System.Text.Json.JsonSerializer.Serialize<TValue>(...)' which has 'RequiresDynamicCodeAttribute' can break functionality when AOT compiling.
Unhandled exception. System.InvalidOperationException: Reflection-based serialization has been disabled for this application.
```

Com `#:property PublishAot=false` (ou `dotnet run app.cs -p:PublishAot=false`)
os mesmos três programas imprimem `Dapper: 1 dapper`, `EF Core: 1 product(s)` e
`{"X":1,"Y":2}`. Os avisos de build `IL2026` e `IL3050` são o sinal antecipado:
quando aparecem numa file-based app, a execução provavelmente vai bater num
feature switch.

### Shebang: um arquivo C# como executável

No Unix, uma linha de shebang e o bit de execução transformam o arquivo num
comando:

```csharp
#!/usr/bin/env -S dotnet --
// Counts non-empty lines of each file passed as argument.
foreach (var path in args)
{
    var lines = File.ReadLines(path).Count(l => l.Trim().Length > 0);
    Console.WriteLine($"{lines,6}  {path}");
}
```

```text
$ chmod +x count-lines.cs
$ ./count-lines.cs count-lines.cs ../fba/hello.cs
     8  count-lines.cs
     6  ../fba/hello.cs
```

O `--` no shebang importa: ele faz o `dotnet` repassar todos os argumentos para a
aplicação. Rodar `./count-lines.cs --help` entregou `--help` ao programa (que
tentou abrir um arquivo com esse nome) em vez de imprimir a ajuda da CLI. A
documentação pede finais de linha LF e nenhum BOM nesses arquivos.

### Publicando e convertendo

O `dotnet publish count-lines.cs` respeita o padrão AOT e gera um executável
nativo em `artifacts/count-lines/` ao lado do arquivo: aqui, um binário Mach-O
arm64 de 1,4 MB que roda sem `dotnet`, gerado em menos de 5 segundos.

O `dotnet project convert` é a porta de saída. Use quando o script precisar de
um segundo arquivo de código, de testes ou de um lugar numa solution.

### Um arquivo só, e fora de pastas de projeto

No SDK 10.0.100 a aplicação é exatamente um arquivo. Uma classe num `greeter.cs`
vizinho não é compilada:

```text
app.cs(1,19): error CS0103: The name 'Greeter' does not exist in the current context
```

e `#:include greeter.cs` falha com `error: Unrecognized directive 'include'`. A
documentação atual descreve o `#:include` para o SDK 10.0.300 em diante, que não
estava disponível para teste aqui.

O arquivo também herda o que está em volta: a documentação lista
`Directory.Build.props`, `Directory.Packages.props`, `nuget.config` e
`global.json` das pastas acima. Um arquivo colocado numa pasta que tem um
`.csproj` é pior: `dotnet run side.cs` compilou o projeto, que incluiu o
`side.cs` pelo globbing e falhou com `CS8802: Only one compilation unit can have
top-level statements`. Mantenha scripts numa pasta própria.

## Trade-offs

- **Sem arquivo de projeto há menos cerimônia e menos visibilidade.** Padrões
  como `PublishAot=true` e `PackAsTool=true` ficam invisíveis até você converter
  o arquivo ou ler o `runtimeconfig.json` gerado.
- **O padrão AOT protege o publish e surpreende o script.** Ele mantém a
  file-based app publicável como binário nativo, mas bibliotecas que dependem de
  reflection falham no simples `dotnet run`.
  ```csharp
  #:property PublishAot=false   // primeira linha a adicionar antes de usar Dapper, EF Core ou JSON por reflection
  ```
- **O cache de build é rápido, mas indexado pelo arquivo.** Mudanças em arquivos
  de build herdados podem passar despercebidas; a documentação recomenda
  `dotnet clean app.cs` quando um build parece desatualizado.
- **Um arquivo só é um limite rígido no SDK 10.0.100.** Helpers compartilhados
  significam copiar código ou converter para projeto; dividir exige um SDK mais
  novo.
- **Um shebang amarra o script a um SDK instalado.** A máquina de destino precisa
  do .NET 10 no `PATH`; para máquinas sem ele, publique o binário nativo.

## Lab

Neste lab você aprende a escrever programas C# que vivem em um único arquivo `.cs` e rodam com `dotnet run app.cs`, sem arquivo de projeto. Você recebe a classe `Apps` com cinco métodos que lançam `NotImplementedException`; cada um deve devolver o texto de um programa de arquivo único. Os testes salvam esse texto como `app.cs` numa pasta temporária e rodam o SDK de verdade. A ideia central é sentir o que o SDK faz por você (gera um projeto implícito) e o que ele esconde por padrão (por exemplo, que esse projeto mira Native AOT).

**O cenário**

O problema é escrever scripts C# pequenos sem cerimônia de projeto.

- `src/FileBasedAppsLab/Apps.cs`: cinco métodos (`HelloApp`, `AppWithArgs`, `AppWithProperty`, `ShebangApp`, `AppWithCompileError`) que retornam código-fonte como string. Raw string literals (`"""`) deixam o texto legível.
- `FileBasedAppTests.cs`: salva o texto como `app.cs`, executa `dotnet run app.cs` como processo filho e confere saída e código de saída.

Cada teste inicia o SDK, então leva alguns segundos (a suíte toda leva de 5 a 60 segundos, e a primeira execução na máquina é a mais lenta). O lab nunca usa `#:package`, porque isso exigiria NuGet.

**O que você vai fazer, passo a passo**

1. **Hello sem projeto (TODO-00).** Em `HelloApp`, devolva um programa só de top-level statements que imprime exatamente `hello from a file-based app`. Sem `Main`, sem `.csproj`.
2. **Argumentos e código de saída (TODO-01).** Em `AppWithArgs`, use a variável implícita `args`: imprima os argumentos separados por `,` e retorne `args.Length` como exit code. O teste passa os argumentos depois de `--`.
3. **Diretiva de propriedade (TODO-02).** Em `AppWithProperty`, comece com `#:property PublishAot=false` e imprima `RuntimeFeature.IsDynamicCodeSupported`. O teste espera `True`. Repare que o quarto teste roda a mesma sonda sem a diretiva e espera `False`: é o padrão Native AOT do projeto gerado.
4. **Shebang (TODO-03).** Em `ShebangApp`, a primeira linha precisa ser `#!/usr/bin/env dotnet`, seguida de um programa que imprime `shebang ok`. O compilador aceita isso como primeira linha (o teste é ignorado no Windows).
5. **Erro de compilação (TODO-04).** Em `AppWithCompileError`, devolva um programa que não compila (por exemplo, usando um nome inexistente). A execução deve sair com código diferente de zero e imprimir um erro `CSxxxx`.

**Como saber que terminou**

`dotnet test` fica verde. Você deve conseguir explicar por que a mesma linha imprime `False` sem a diretiva e `True` com ela, e o que o SDK fez para o programa rodar sem projeto.

**Desafios opcionais**

- **TODO-05:** o último teste roda `dotnet project convert app.cs` no seu `AppWithProperty`. Abra o `app.csproj` gerado e ache `PackAsTool`, `UserSecretsId` e `PublishAot`: quais você escreveu e quais o SDK adicionou?
- **TODO-06:** numa pasta de rascunho, coloque uma classe `Greeter` em `greeter.cs` e use em `app.cs`. No SDK 10.0.100 o build falha com `CS0103`, porque o app é exatamente um arquivo. Verifique se o seu SDK suporta `#:include` antes de depender dele.

**Pré-requisitos:** top-level statements e raw string literals de C#, e o .NET 10 SDK (10.0.100 ou superior) no `PATH`.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Cada método começa lançando `NotImplementedException` com um comentário `TODO-NN` explicando o programa esperado, então os testes vermelhos são o seu checklist.

## Documentation Links

- [File-based apps, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/sdk/file-based-apps) (doc)
- [What's new in the SDK and tooling for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/sdk) (doc)
- [dotnet run command, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-run) (doc)
- [Native AOT deployment overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) (doc)
- [Compilation config settings (dynamic code), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/compilation) (doc)
