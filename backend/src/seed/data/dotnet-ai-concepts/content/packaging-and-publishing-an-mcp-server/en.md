---
version: 1.0
updatedAt: 2026-11-19
---
## Objective

Writing an MCP server is half the job; the other half is getting it onto other
people's machines so a host (VS Code, Claude Code) can launch it with one line
of config. This lesson takes the `dotnet new mcpserver` template, reads what it
generates, packs it as a NuGet package, runs it from a local folder feed with
`dnx` and `dotnet tool`, wires it into `mcp.json`, validates its `server.json`
against the registry schema, and measures framework-dependent against
single-file against trimmed against Native AOT (size and start time). Nothing
was pushed to nuget.org or the registry. Basic packing is in "Packaging and
Publishing a NuGet Library" (dotnet-concepts); only MCP parts are here. Versions: template package
`Microsoft.McpServer.ProjectTemplates` 1.2.1 (preview), which pins
`ModelContextProtocol` 1.2.0; client `ModelContextProtocol` 2.3.0; server
upgraded to 2.4.0 for the compatibility test; `net10.0`, SDK 10.0.100, macOS
arm64 (`osx-arm64`).

## Use Cases

- Handing a team an internal MCP server as one package `dnx` runs without cloning.
- Publishing an open source server so a host can offer it from a NuGet search.
- Deciding when to upgrade the SDK under a server that other people run.

## Deep Dive

### The template and what it generates

```text
$ dotnet new install Microsoft.McpServer.ProjectTemplates      # 1.2.1: MCP Server App, mcpserver [C#]
$ dotnet new mcpserver -n SampleMcpServer -o gen
```

Options (from `--help`): `-t local|remote` (stdio or HTTP, default `local`),
`--aot` (default false), `--self-contained` (default true), `-f net10.0|net9.0|net8.0`.
`local` generates five files: `Program.cs`, `Tools/RandomNumberTools.cs`,
`README.md`, `SampleMcpServer.csproj` and `.mcp/server.json`. The packaging is
all in the csproj:

```xml
<RuntimeIdentifiers>win-x64;win-arm64;osx-arm64;linux-x64;linux-arm64;linux-musl-x64</RuntimeIdentifiers>
<PackAsTool>true</PackAsTool>  <PackageType>McpServer</PackageType>
<SelfContained>true</SelfContained>  <PublishSingleFile>true</PublishSingleFile>
<PackageId>SampleMcpServer</PackageId>  <PackageVersion>0.1.0-beta</PackageVersion>
<!-- plus <None Include=".mcp\server.json" Pack="true" PackagePath="/.mcp/" /> -->
```

`Program.cs` is the generic-host server of "MCP Servers and Clients with the C#
SDK" (`.WithStdioServerTransport().WithTools<RandomNumberTools>()`). With `-t remote` the project uses `Microsoft.NET.Sdk.Web`,
`.WithHttpTransport(o => o.Stateless = true)` and `app.MapMcp()`, but there is
no `.mcp/server.json` and no `PackageType`: the remote template is not a
packable NuGet server. The template pins `Microsoft.Extensions.Hosting` 8.0.1
and `ModelContextProtocol` 1.2.0, older than the 2.x line used elsewhere in
this track.

### dotnet pack: one pointer package plus one per RID

`dotnet pack -c Release -o feed` took 10 seconds (runtime packs were already
cached) and produced 7 packages:

```text
   4,441  SampleMcpServer.0.1.0-beta.nupkg
32,239,203  SampleMcpServer.osx-arm64.0.1.0-beta.nupkg
34,140,190  SampleMcpServer.linux-x64.0.1.0-beta.nupkg
34,260,430  SampleMcpServer.win-x64.0.1.0-beta.nupkg   (+ linux-arm64, linux-musl-x64, win-arm64)
total 199,854,031 bytes (190.6 MiB)
```

The 4 KB main package has no code: `tools/net10.0/any/DotnetToolSettings.xml`,
`.mcp/server.json`, `README.md` and a nuspec with `<packageType name="DotnetTool" />`
and `<packageType name="McpServer" />`.

`DotnetToolSettings.xml` lists the `RuntimeIdentifierPackage` for each RID; the
`osx-arm64` package (`packageType DotnetToolRidPackage`) holds
`tools/any/osx-arm64/SampleMcpServer`, an 83,363,760 byte self-contained
single file that compresses to 32 MB, plus the `.pdb`. The tool resolver picks
the package matching the machine's RID, so every package must be pushed (the
Learn quickstart says so) and a RID missing from the list has no server for
that platform. `McpServer` as a second `PackageType` is what lets NuGet.org
show an "MCP Server" tab built from `.mcp/server.json`.

### dnx and dotnet tool, from a folder feed

`dnx` (SDK 10) runs a tool package without installing it; `--source` replaces
all package sources, which keeps the test off nuget.org. The command is also what
an MCP host would launch. A real client (the `McpClient` from the earlier
lesson, with `StdioClientTransport { Command = "dnx", Arguments = [...] }`)
started it, listed the tools and called both, with `WEATHER_CHOICES` passed
through `EnvironmentVariables`:

```text
dnx SampleMcpServer@0.1.0-beta --yes --source /…/feed          (package cache emptied first)
handshake ms: 1178                      <- cold: restore pointer + RID package, extract
negotiated: 2025-11-25, server: SampleMcpServer 1.0.0.0
tool get_random_number: Generates a random number between the specified minimum and maximum values.
tool get_city_weather: Describes random weather in the provided city.
get_random_number: 5
get_city_weather: The weather in Redmond is humid.      <- env was "sunny,humid,freezing"
```

Warm runs: 355, 335, 341 ms. The binary launched directly: 207, 197, 222 ms.
After `dotnet tool install SampleMcpServer --version 0.1.0-beta --add-source feed
--tool-path tool` (a symlink to the extracted binary): 208, 193, 200 ms warm.
So `dnx` costs about 130 ms per launch over an installed copy, paid at every
host start. The client negotiated `2025-11-25` because the template's SDK 1.2.0
does not know `server/discover` (see the compatibility section).

### Registering the server in a client

`.vscode/mcp.json` (the format of VS Code's Local harness, now deprecated: see the multi-server concept) for the packaged stdio server and a local HTTP one (parsed as JSON; VS Code was not run, docs only):

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

Learn says a package from a non-default feed needs `"--add-source", "<url>"` at
the end of `args`, and that VS Code runs servers from the workspace root (the
`dotnet run --project <relative csproj>` form is for development). For Claude
Code: `claude mcp add sample -e WEATHER_CHOICES=sunny -- dnx
SampleMcpServer@0.1.0-beta --yes` (stdio) and `claude mcp add --transport http
sample http://localhost:6200/mcp`; the syntax matches `claude mcp add --help`,
but the commands were not run so the real config stayed untouched. The host
spawns whatever the config says, so its trust prompt is the only gate: a
project `mcp.json` can make a teammate's machine run an arbitrary package.

### server.json and the registry schema

The template's `.mcp/server.json` points at schema `2025-10-17`; the registry
repository's current examples use `2025-12-11`. Both schemas exist at
`static.modelcontextprotocol.io/schemas/<date>/server.schema.json` and were
downloaded and used with `ajv` (draft-07, validating against
`#/definitions/ServerDetail`, because the root `$ref` is ignored next to
`$id`). Results:

```text
template as generated (placeholders)   INVALID  name must match ^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$ ; repository.url not a uri
my server.json, schema 2025-10-17 / 2025-12-11   VALID (both)
without "version", or name "no-slash"            INVALID (required property, name pattern)
registryType "bogus"                             VALID (a free string in the schema)
```

The block that makes VS Code prompt for the value (docs only):

```json
"environmentVariables": [{ "name": "WEATHER_CHOICES", "value": "{weather_choices}",
  "variables": { "weather_choices": { "description": "…", "isRequired": true, "isSecret": false } } }]
```

Learn says NuGet.org uses only the first `packages` item with `registryType:
"nuget"`; the rest is for the MCP Registry. The registry docs add: NuGet
packages must come from `api.nuget.org`, the `name` follows `io.github.<user>/<repo>`
for GitHub login, and ownership is proved by an `mcp-name: <server name>` string
in the package README (a comment works). Mark secrets `isSecret: true` so a
client can mask the prompt. Registry publication itself was not run.

### Secrets, configuration and arguments

A stdio server has no OAuth (the spec's authorization section does not apply to
stdio): credentials arrive as environment variables or arguments set in
`mcp.json`. So read them at call time or through `IOptions`, never echo them in
a tool result or a log line (stderr is relayed to the host), use a
`${input:...}` with `"password": true` instead of a literal key, and do not
commit real values. `packageArguments` in `server.json` declares CLI arguments.

### Self-contained, trimmed and Native AOT, measured

The same server (two tools) published for `osx-arm64`, client-measured time
from process spawn to initialized session, three runs each (first run in
brackets when it differed):

| Variant | Size on disk | Handshake ms |
| --- | --- | --- |
| Framework-dependent, `dotnet X.dll` | 3.3 MB (37 files) | 203, 215, 235 |
| Self-contained single file (template default) | 83.4 MB | 207, 215 (1125 cold) |
| + `PublishTrimmed` | 17.2 MB | 327, 333 (688 cold) |
| Native AOT (`PublishAot`) | 11.1 MB (+ 45 MB `.dSYM`) | 85, 89 (418 cold) |

Trimming made starts slower here (cause not investigated), so measure before
assuming it helps; AOT handshook 2.4 times faster and is the smallest
self-contained option. Framework-dependent needs a .NET 10 runtime on the
user's machine, hence the template's self-contained default. AOT with the
template code published cleanly (only an `NU1903` warning about the ILCompiler
package). Two traps appeared once the tools changed:

```text
.WithToolsFromAssembly()   warning IL2026 at publish (RequiresUnreferencedCode); at runtime:
  System.PlatformNotSupportedException: Operation is not supported on this platform.
    at System.Reflection.Assembly.GetCallingAssembly()
tool parameter of type Place (a record), WithTools<T>():  no publish warning, crash at start:
  System.NotSupportedException: JsonTypeInfo metadata for type 'Place' was not provided by TypeInfoResolver ...
```

The fix for the second is a `JsonSerializerContext` listing every parameter
and return type (`Place`, and also `int` and `string`, which a first attempt
missed), passed as `WithTools<T>(ToolJson.Default.Options)`; the AOT binary then
served three tools (11,111,056 bytes). Use the generic `WithTools<T>()`, never
the assembly scan, and treat the runtime crash as the test, not the build.
`dotnet new mcpserver --aot` only adds `PublishAot` and `InvariantGlobalization`.

### Versioning and compatibility for consumers

A published server fixes what protocol versions and SDK behavior its users get
until they update. Measured with the same sample built twice and the same
2.3.0 client:

| Server SDK | Client option | Result |
| --- | --- | --- |
| 1.2.0 (template) | default | `server/discover` fails with "is not available", client falls back, `2025-11-25` |
| 2.4.0 | default | `2026-07-28`, no initialize |
| 2.4.0 | `ProtocolVersion = "2025-11-25"` | `2025-11-25` |
| 1.2.0 | `ProtocolVersion = "2026-07-28"` | `McpException: The server does not support the requested protocol version '2026-07-28'` |

So upgrading the server SDK is not invisible: hosts that only speak the older
revision need the server to still answer `initialize`. Bump the package version
for every SDK change, keep `server.json` `version` equal to it, and list changed
tool names or schemas in the README, because a model sees tool names and
descriptions as the contract. The 2.x API breaks (`IMcpClient` removed, for one)
get their own lesson.

## Trade-offs

- **Self-contained vs framework-dependent.** Self-contained runs without .NET
  but is 6 RID packages and 190 MB; framework-dependent is 3.3 MB and needs a
  runtime. Trim only if you measure a win.
- **`dnx` vs installed tool.** `dnx` needs no install and pins versions
  (`@0.1.0-beta`), at about 130 ms extra per launch here.
- **AOT.** Fastest start and smallest binary, but reflection-based discovery and
  serialization fail at runtime unless a source-generated context covers every
  tool type; some tools (reflection-heavy libraries) cannot be AOT at all.
- **Stdio vs HTTP packaging.** A stdio server is a NuGet tool you distribute; a
  remote one is a service you operate, and the `remote` template does not pack.
- **Preview template.** Its pinned SDK 1.2.0 and the 2025-10-17 schema already
  lag; check the generated versions before publishing.

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
