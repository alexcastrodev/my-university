---
version: 1.0
updatedAt: 2026-11-19
title: "Empacotando e Publicando um Servidor MCP"
summary: O template dotnet new mcpserver e o que ele gera, dotnet pack com um pacote ponteiro e um pacote por RID, execução a partir de uma pasta local com dnx e dotnet tool, mcp.json do VS Code e claude mcp add, o server.json validado contra o schema do MCP Registry, segredos e variáveis de ambiente, e a medição de tamanho e tempo de partida de framework-dependent, single-file, trimmed e Native AOT, mais a compatibilidade entre versões do SDK.
---
## Objective

Escrever um servidor MCP é metade do trabalho; a outra metade é fazê-lo chegar
às máquinas de outras pessoas, para que um host (VS Code, Claude Code) o inicie
com uma linha de configuração. Esta lição pega o template `dotnet new mcpserver`,
lê o que ele gera, empacota como pacote NuGet, roda a partir de uma pasta local
com `dnx` e `dotnet tool`, registra no `mcp.json`, valida o `server.json`
contra o schema do registry e mede framework-dependent contra single-file contra
trimmed contra Native AOT (tamanho e tempo de partida). Nada foi enviado ao
nuget.org nem ao registry. O empacotamento básico está em "Packaging and
Publishing a NuGet Library" (dotnet-concepts); aqui só entra a parte de MCP.
Versões: pacote de templates `Microsoft.McpServer.ProjectTemplates` 1.2.1
(preview), que fixa `ModelContextProtocol` 1.2.0; cliente `ModelContextProtocol`
2.3.0; servidor atualizado para 2.4.0 no teste de compatibilidade; `net10.0`,
SDK 10.0.100, macOS arm64 (`osx-arm64`).

## Use Cases

- Entregar um servidor MCP interno como um pacote que o `dnx` roda sem clonar nada.
- Publicar um servidor open source para que um host o ofereça a partir de uma busca no NuGet.
- Decidir quando atualizar o SDK de um servidor que outras pessoas executam.

## Deep Dive

### O template e o que ele gera

```text
$ dotnet new install Microsoft.McpServer.ProjectTemplates      # 1.2.1: MCP Server App, mcpserver [C#]
$ dotnet new mcpserver -n SampleMcpServer -o gen
```

Opções (do `--help`): `-t local|remote` (stdio ou HTTP, padrão `local`), `--aot`
(padrão false), `--self-contained` (padrão true), `-f net10.0|net9.0|net8.0`. O
modo `local` gera cinco arquivos: `Program.cs`, `Tools/RandomNumberTools.cs`,
`README.md`, `SampleMcpServer.csproj` e `.mcp/server.json`. Todo o empacotamento
está no csproj:

```xml
<RuntimeIdentifiers>win-x64;win-arm64;osx-arm64;linux-x64;linux-arm64;linux-musl-x64</RuntimeIdentifiers>
<PackAsTool>true</PackAsTool>  <PackageType>McpServer</PackageType>
<SelfContained>true</SelfContained>  <PublishSingleFile>true</PublishSingleFile>
<PackageId>SampleMcpServer</PackageId>  <PackageVersion>0.1.0-beta</PackageVersion>
<!-- mais <None Include=".mcp\server.json" Pack="true" PackagePath="/.mcp/" /> -->
```

O `Program.cs` é o servidor da lição "MCP Servers and Clients with the C# SDK"
(`.WithStdioServerTransport().WithTools<RandomNumberTools>()`). Com `-t remote`
o projeto usa `Microsoft.NET.Sdk.Web`, `.WithHttpTransport(o => o.Stateless =
true)` e `app.MapMcp()`, mas não há `.mcp/server.json` nem `PackageType`: não é
um servidor NuGet empacotável. O template fixa `Microsoft.Extensions.Hosting`
8.0.1 e `ModelContextProtocol` 1.2.0, mais antigos que a linha 2.x da trilha.

### dotnet pack: um pacote ponteiro mais um por RID

`dotnet pack -c Release -o feed` levou 10 s (runtime packs já em cache) e gerou 7 pacotes:

```text
   4,441  SampleMcpServer.0.1.0-beta.nupkg
32,239,203  SampleMcpServer.osx-arm64.0.1.0-beta.nupkg
34,140,190  SampleMcpServer.linux-x64.0.1.0-beta.nupkg
34,260,430  SampleMcpServer.win-x64.0.1.0-beta.nupkg   (+ linux-arm64, linux-musl-x64, win-arm64)
total 199,854,031 bytes (190.6 MiB)
```

O pacote principal, de 4 KB, não tem código: `tools/net10.0/any/DotnetToolSettings.xml`,
`.mcp/server.json`, `README.md` e um nuspec com `<packageType name="DotnetTool" />`
e `<packageType name="McpServer" />`.

O `DotnetToolSettings.xml` lista o `RuntimeIdentifierPackage` de cada RID; o
pacote `osx-arm64` (`DotnetToolRidPackage`) contém `tools/any/osx-arm64/SampleMcpServer`,
um single file self-contained de 83.363.760 bytes (32 MB comprimido) e o `.pdb`.
O resolvedor escolhe o pacote do RID da máquina, então todos precisam ser
enviados e um RID fora da lista fica sem servidor. O `McpServer` como segundo
`PackageType` permite ao NuGet.org mostrar uma aba "MCP Server" a partir do
`.mcp/server.json`.

### dnx e dotnet tool, a partir de uma pasta

O `dnx` (SDK 10) roda um pacote de tool sem instalá-lo; `--source` substitui
todas as fontes, o que mantém o teste longe do nuget.org. É o comando que um host
MCP lançaria. Um cliente real (o `McpClient` da lição
anterior, com `StdioClientTransport { Command = "dnx", Arguments = [...] }`)
iniciou o servidor, listou as tools e chamou as duas, com `WEATHER_CHOICES`
repassada por `EnvironmentVariables`:

```text
dnx SampleMcpServer@0.1.0-beta --yes --source /…/feed          (cache de pacotes esvaziado antes)
handshake ms: 1178                      <- a frio: restore do ponteiro e do pacote do RID, extração
negotiated: 2025-11-25, server: SampleMcpServer 1.0.0.0
tool get_random_number: Generates a random number between the specified minimum and maximum values.
tool get_city_weather: Describes random weather in the provided city.
get_random_number: 5
get_city_weather: The weather in Redmond is humid.      <- o env era "sunny,humid,freezing"
```

A quente: 355, 335, 341 ms. O binário direto: 207, 197, 222 ms. Depois de
`dotnet tool install SampleMcpServer --version 0.1.0-beta --add-source feed
--tool-path tool` (symlink para o binário extraído): 208, 193, 200 ms. O `dnx`
custa cerca de 130 ms a mais por lançamento, pagos em cada partida do host. O
cliente negociou `2025-11-25` porque o SDK 1.2.0 do template não conhece
`server/discover` (veja a compatibilidade).

### Registrando o servidor no cliente

`.vscode/mcp.json` (formato do harness Local do VS Code, hoje depreciado: veja o concept de vários servidores) para o servidor stdio empacotado e para um HTTP local (lido como JSON; o VS Code não foi executado, só documentação):

```json
{
  "inputs": [
    { "type": "promptString", "id": "weather_choices", "description": "Comma separated weather words", "password": false }
  ],
  "servers": {
    "sample-stdio": {
      "type": "stdio", "command": "dnx",
      "args": ["SampleMcpServer@0.1.0-beta", "--yes"],
      "env": { "WEATHER_CHOICES": "${input:weather_choices}" }
    },
    "sample-http": { "type": "http", "url": "http://localhost:6200/mcp" }
  }
}
```

O Learn diz que um pacote de feed fora do padrão precisa de `"--add-source",
"<url>"` no fim de `args`, e que o VS Code executa servidores a partir da raiz
do workspace (`dotnet run --project <csproj relativo>` é para desenvolvimento).
No Claude Code: `claude mcp add sample -e WEATHER_CHOICES=sunny -- dnx
SampleMcpServer@0.1.0-beta --yes` (stdio) e `claude mcp add --transport http
sample http://localhost:6200/mcp`; a sintaxe confere com `claude mcp add --help`,
mas não foram executados, para não tocar a configuração real. O host roda o que
a configuração mandar, então o aviso de confiança é a única barreira: um
`mcp.json` de projeto pode fazer a máquina de um colega rodar um pacote qualquer.

### server.json e o schema do registry

O `.mcp/server.json` do template aponta para o schema `2025-10-17`; os exemplos
atuais do registry usam `2025-12-11`. Os dois existem em
`static.modelcontextprotocol.io/schemas/<data>/server.schema.json` e foram usados
com o `ajv` (draft-07, validando contra `#/definitions/ServerDetail`, porque o
`$ref` da raiz é ignorado ao lado do `$id`). Resultados:

```text
template como gerado (placeholders)   INVALID  name deve casar ^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$ ; repository.url não é uri
meu server.json, schema 2025-10-17 / 2025-12-11   VALID (os dois)
sem "version", ou name "no-slash"                 INVALID (propriedade obrigatória, padrão do name)
registryType "bogus"                              VALID (é uma string livre no schema)
```

O bloco que faz o VS Code pedir o valor (só documentação):

```json
"environmentVariables": [{ "name": "WEATHER_CHOICES", "value": "{weather_choices}",
  "variables": { "weather_choices": { "description": "…", "isRequired": true, "isSecret": false } } }]
```

O Learn diz que o NuGet.org usa só o primeiro item de `packages` com
`registryType: "nuget"`; o resto é para o MCP Registry. A documentação do
registry acrescenta: o pacote precisa vir do `api.nuget.org`, o `name` segue
`io.github.<usuário>/<repo>` para login do GitHub, e a posse é provada por uma
string `mcp-name: <nome do servidor>` no README do pacote (pode ser comentário).
Marque segredos com `isSecret: true`. A publicação no registry não foi executada.

### Segredos, configuração e argumentos

Um servidor stdio não tem OAuth (a autorização da spec não vale para stdio): as
credenciais chegam como variáveis de ambiente ou argumentos do `mcp.json`. Leia-as
na hora da chamada ou via `IOptions`, nunca as repita no resultado de uma tool
nem em log (o stderr vai ao host), use `${input:...}` com `"password": true` em
vez de chave literal e não faça commit de valores reais. O `packageArguments` do
`server.json` declara argumentos de linha de comando.

### Self-contained, trimmed e Native AOT, medidos

O mesmo servidor (duas tools) publicado para `osx-arm64`, com o tempo medido pelo
cliente da criação do processo até a sessão inicializada, três execuções cada
(a primeira entre parênteses quando diferiu):

| Variante | Tamanho em disco | Handshake ms |
| --- | --- | --- |
| Framework-dependent, `dotnet X.dll` | 3,3 MB (37 arquivos) | 203, 215, 235 |
| Single file self-contained (padrão do template) | 83,4 MB | 207, 215 (1125 a frio) |
| + `PublishTrimmed` | 17,2 MB | 327, 333 (688 a frio) |
| Native AOT (`PublishAot`) | 11,1 MB (+ 45 MB de `.dSYM`) | 85, 89 (418 a frio) |

O trimming deixou a partida mais lenta aqui (causa não investigada), então meça
antes de assumir que ajuda; o AOT fez o handshake 2,4 vezes mais rápido e é a
menor opção self-contained. O framework-dependent exige runtime .NET 10 no
usuário, daí o padrão self-contained. O AOT com o código do template publicou
limpo (só o aviso `NU1903` do ILCompiler). Duas armadilhas apareceram quando as
tools mudaram:

```text
.WithToolsFromAssembly()   warning IL2026 no publish (RequiresUnreferencedCode); em execução:
  System.PlatformNotSupportedException: Operation is not supported on this platform.
    at System.Reflection.Assembly.GetCallingAssembly()
parâmetro de tool do tipo Place (um record), WithTools<T>():  sem warning no publish, falha na partida:
  System.NotSupportedException: JsonTypeInfo metadata for type 'Place' was not provided by TypeInfoResolver ...
```

A correção da segunda é um `JsonSerializerContext` listando todo tipo de
parâmetro e de retorno (`Place`, e também `int` e `string`, que uma primeira
tentativa esqueceu), passado como `WithTools<T>(ToolJson.Default.Options)`; o
binário AOT então serviu três tools (11.111.056 bytes). Use o `WithTools<T>()`
genérico, nunca a varredura do assembly, e trate a falha em execução como o
teste, não o build. O `dotnet new mcpserver --aot` só adiciona `PublishAot` e
`InvariantGlobalization`.

### Versionamento e compatibilidade para quem consome

Um servidor publicado fixa as versões de protocolo e o comportamento do SDK que
seus usuários recebem até atualizarem. Medido com o mesmo exemplo compilado duas
vezes e o mesmo cliente 2.3.0:

| SDK do servidor | Opção do cliente | Resultado |
| --- | --- | --- |
| 1.2.0 (template) | padrão | `server/discover` falha com "is not available", o cliente recua, `2025-11-25` |
| 2.4.0 | padrão | `2026-07-28`, sem initialize |
| 2.4.0 | `ProtocolVersion = "2025-11-25"` | `2025-11-25` |
| 1.2.0 | `ProtocolVersion = "2026-07-28"` | `McpException: The server does not support the requested protocol version '2026-07-28'` |

Então atualizar o SDK do servidor não é invisível: hosts que só falam a revisão
antiga precisam que o servidor ainda responda `initialize`. Suba a versão do
pacote a cada mudança de SDK, mantenha a `version` do `server.json` igual a ela e
liste no README as tools que mudaram, porque o modelo vê nomes e descrições como
o contrato. As quebras de API do SDK 2.x ficam para uma lição própria.

## Trade-offs

- **Self-contained vs framework-dependent.** O self-contained roda sem .NET, mas
  são 6 pacotes por RID e 190 MB; o framework-dependent tem 3,3 MB e precisa de
  runtime. Só use trim se medir ganho.
- **`dnx` vs tool instalada.** O `dnx` não instala nada e fixa a versão
  (`@0.1.0-beta`), ao custo de cerca de 130 ms a mais por lançamento aqui.
- **AOT.** Partida mais rápida e binário menor, mas reflexão e serialização
  falham em execução se um contexto de source generator não cobrir todo tipo de
  tool; algumas tools (bibliotecas pesadas em reflexão) nem rodam em AOT.
- **Empacotar stdio vs HTTP.** Um servidor stdio é uma tool NuGet que você
  distribui; um remoto é um serviço que você opera, e o template `remote` não
  empacota.
- **Template em preview.** O SDK 1.2.0 fixado e o schema 2025-10-17 já estão
  defasados; confira as versões geradas antes de publicar.

## Documentation Links

- [Create a minimal MCP server using C# and publish to NuGet, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/quickstarts/build-mcp-server) (doc)
- [dotnet tool exec (dnx), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-exec) (doc)
- [dotnet tool install, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-tool-install) (doc)
- [Native AOT deployment, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/deploying/native-aot/) (doc)
- [MCP Registry: package types and ownership verification, GitHub](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx) (doc)
- [MCP Registry: server.json format, GitHub](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md) (doc)
- [Use MCP servers in VS Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) (doc)
- [Connect Claude Code to tools via MCP, Claude Code Docs](https://code.claude.com/docs/en/mcp) (doc)
- [MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk) (doc)
