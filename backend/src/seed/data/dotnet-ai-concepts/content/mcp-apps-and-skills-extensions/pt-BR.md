---
version: 1.0
updatedAt: 2026-11-21
title: "Extensões MCP Apps e Skills"
summary: As extensões oficiais MCP Apps (UI em iframe via recursos ui:// e _meta.ui) e Skills (Agent Skills servidas por skills/list e skills/get), medidas sem host com o SDK C# 2.4.0 e conferidas na fonte. O estado real (protocolo Apps estável, pacote com API [Experimental] MCPEXP003; Skills em Beta com MCPEXP005), a negociação no fio, o que um cliente sem a extensão vê, onde o CSP trafega e duas armadilhas dos helpers tipados, os nomes de propriedade agora sensíveis a maiúsculas (2.3.0 contra 2.4.0), a verificação de digest dos Skills e quem implementa hoje. Renderização no host é só documentação.
---
## Objective

Duas extensões oficiais do MCP colocam mais do que texto na frente do usuário. O MCP Apps (`io.modelcontextprotocol/ui`)
deixa uma tool apontar para uma página HTML (recurso `ui://`) que o host renderiza num iframe com sandbox ao lado da
conversa. O Skills (`io.modelcontextprotocol/skills`) deixa um servidor publicar Agent Skills (um `SKILL.md` mais
arquivos) que um host pode descobrir e carregar. O backlog dizia "só quando estabilizar", então esta lição confere o
estado de hoje na fonte e mede os pacotes C# sem host: servidor, cliente, o JSON-RPC no fio, a negociação, por onde
viaja o CSP, os nomes de propriedade agora sensíveis a maiúsculas e as verificações de integridade dos Skills. O que
precisa de um host de verdade (iframe, `postMessage`, os métodos `ui/`) é só documentação. Versões:
`ModelContextProtocol`, `ModelContextProtocol.AspNetCore`, `ModelContextProtocol.Extensions.Apps` e
`ModelContextProtocol.Extensions.Skills` 2.4.0 (a mais nova no NuGet em 2026-11-21; 2.3.0 na comparação de maiúsculas),
spec 2026-07-28, spec do ext-apps 2026-01-26, TFM `net10.0` com SDK 10.0.100 e `net11.0` com SDK 11.0.100 (runtime
11.0.0), Apple M4 Max (nenhum tempo medido).

## Use Cases

- Uma tool cuja resposta fica melhor como painel, formulário ou gráfico do que como texto, em hosts que renderizam MCP Apps.
- Entregar as instruções de um fluxo (uma política de reposição, um checklist de revisão) junto do servidor dono dos dados.
- Decidir se vale construir sobre esses pacotes agora, dadas as marcas de estabilidade deles.
- Atender hosts que suportam e que não suportam a extensão com um único servidor.

## Deep Dive

### O estado real hoje (o que o backlog errou)

| Peça | Estado na fonte em 2026-11-21 |
| --- | --- |
| Protocolo MCP Apps | Estável: a spec 2026-01-26 do ext-apps diz `Status: Stable` e a visão geral de extensões lista "MCP Apps: Stable" |
| `ModelContextProtocol.Extensions.Apps` | Versão 2.4.0, versão normal (não prerelease) desde a 2.0.0 (2026-07-28), mas todo tipo público é `[Experimental("MCPEXP003")]` |
| Protocolo Skills | Beta ("Beta, destination not yet stated"); a SEP-2640 está Final, a especificação da extensão fica em `specification/beta/skills.mdx` |
| `ModelContextProtocol.Extensions.Skills` | Existe só a 2.4.0 (2026-11-07), toda API pública `[Experimental("MCPEXP005")]`, depende de `ModelContextProtocol [2.4.0]` (exata) |

Correções: o "Apps v2.0.0" do backlog é só a primeira versão não-preview (a 2.0.0-preview.1, de 2026-06-26, já o tinha, e
a 2.0.0 saiu em 2026-07-28); a atual é a 2.4.0. As notas da 2.0.0 tiraram o `[Experimental]` de Tasks e MRTR, mas não
do Apps. Então "estável" vale para o protocolo e não para a API C#: usar qualquer um dos pacotes sem suprimir o
diagnóstico não compila.

```text
Program.cs(4,16): error MCPEXP003: 'ModelContextProtocol.Extensions.Apps.McpUiToolMeta' is for evaluation purposes only and is subject to change or removal in future updates. Suppress this diagnostic to proceed. (https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/list-of-diagnostics.md#mcpexp003)
Program.cs(6,11): error MCPEXP005: 'ModelContextProtocol.Extensions.Skills.McpServerSkillPackage' is for evaluation purposes only ...
```

Os dois são erros, não avisos. Suprima só no projeto que usa (`<NoWarn>$(NoWarn);MCPEXP003;MCPEXP005</NoWarn>`). A
página do SDK diz que o diagnóstico existe para você "avoid accidentally depending on experimental features" e
desaconselha usar essas APIs "in production scenarios". Pelo ciclo de vida das extensões (SEP-3392), uma extensão Beta
pode mudar, com quebras "expected to be rare"; uma Stable só muda com uma nova revisão do protocolo. Extensões são
"always disabled by default". A negociação e as outras extensões estão em
[Extensões de Autorização do MCP](/dotnet-ai-concepts/mcp-authorization-extensions) e em
[Extensão Tasks do MCP](/dotnet-ai-concepts/mcp-tasks-extension-for-long-running-tools); o básico em
[Servidores e Clientes MCP com o SDK C#](/dotnet-ai-concepts/mcp-servers-and-clients-with-the-csharp-sdk).

### O laboratório: um servidor, tools com `_meta.ui`, um recurso `ui://`

```csharp
builder.Services.AddMcpServer(o => o.ServerInfo = new() { Name = "inventory-app", Version = "1.0.0" })
    .WithHttpTransport()                              // stateless por padrão
    .WithTools<InventoryTools>().WithResources<InventoryResources>()
    .WithMcpApps()                                    // anuncia a extensão e aplica [McpAppUi]
    .WithSkillsFromSubdirectories(Path.Combine(AppContext.BaseDirectory, "Skills"));

[McpServerTool(Name = "show_stock"), McpAppUi(ResourceUri = "ui://inventory/dashboard.html")]
public static string ShowStock(McpServer server, string sku)
{
    var ui = McpApps.GetUiCapability(server.ClientCapabilities);   // null quando o cliente não declarou
    return ui is null ? $"{sku}: 12 units (text only)" : $"{sku}: 12 units (UI, mimeTypes=[{string.Join(",", ui.MimeTypes ?? [])}])";
}
// refresh_stock:  [McpAppUi(ResourceUri = ..., Visibility = [McpUiToolVisibility.App])]    (handler do botão)
// stock_summary:  [McpAppUi(ResourceUri = ..., Visibility = [McpUiToolVisibility.Model])]
```

O recurso usa o MIME type `McpApps.HtmlMimeType` (`text/html;profile=mcp-app`). O cliente declara a extensão como um
`JsonObject` em `McpClientOptions.Capabilities.Extensions`; passar um `McpUiClientCapabilities` tipado ali lançou
`NotSupportedException: JsonTypeInfo metadata for type 'McpUiClientCapabilities' was not provided`, então serialize-o
antes com `McpApps.SerializerOptions`.

### No fio: o servidor anuncia, o cliente declara a cada requisição

No protocolo 2026-07-28 não há handshake. O servidor anuncia a extensão em `server/discover` e o cliente a declara no
`_meta` de cada requisição (abreviado):

```text
--> server/discover  {"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{"extensions":{"io.modelcontextprotocol/ui":{"mimeTypes":["text/html;profile=mcp-app"]}}}}}
<-- {"capabilities":{"resources":{},"tools":{},"extensions":{"io.modelcontextprotocol/skills":{},"io.modelcontextprotocol/ui":{}}},"ttlMs":0,"cacheScope":"private","resultType":"complete",...}
<-- tools/list: {"name":"show_stock",...,"_meta":{"ui":{"resourceUri":"ui://inventory/dashboard.html"}}},
                {"name":"refresh_stock",...,"_meta":{"ui":{"resourceUri":"ui://inventory/dashboard.html","visibility":["app"]}}},
                {"name":"plain_tool",...}      (sem _meta)
<-- resources/list: {"name":"inventory_dashboard","uri":"ui://inventory/dashboard.html","mimeType":"text/html;profile=mcp-app","_meta":{"ui":{"prefersBorder":true}}}
```

O que um cliente sem a extensão vê, medido:

| Caso | Resultado |
| --- | --- |
| Cliente padrão, sem declaração | `server/discover` ainda lista `io.modelcontextprotocol/ui`; `tools/list` e `resources/list` trazem o mesmo `_meta.ui`; `show_stock` devolve `12 units (client did not declare MCP Apps, text only)` |
| Cliente declara a extensão | mesmas listagens; `show_stock` devolve `... mimeTypes=[text/html;profile=mcp-app]` |
| Servidor sem `.WithMcpApps()` | nenhuma extensão em `capabilities`, nenhum `_meta` em nenhuma tool: o `[McpAppUi]` é ignorado em silêncio |
| Cliente fixado em 2025-11-25, servidor stateless | o `initialize` levou a declaração, mas `show_stock` respondeu só texto: cada POST stateless é isolado |
| Mesmo cliente fixado, `SessionMode = StatefulForInitializeClients` | `show_stock` enxerga `mimeTypes=[text/html;profile=mcp-app]` |

Ou seja, o servidor não esconde nada de um cliente que não declarou a extensão; só o seu código decide
(`GetUiCapability`), e a visão geral de extensões dá o mesmo conselho: "a server offering UI-enhanced tools should still
return meaningful text content". A forma baseada em `initialize`, para versões antigas do protocolo, só funciona onde o
servidor mantém a sessão. Modos de sessão: [Servidores e Clientes MCP com o SDK C#](/dotnet-ai-concepts/mcp-servers-and-clients-with-the-csharp-sdk).

### Por onde viaja o CSP, e duas armadilhas dos helpers da 2.4.0

A spec coloca o CSP, as permissões e o `prefersBorder` no `_meta.ui` do conteúdo devolvido por `resources/read`
(`contents[0]._meta.ui`). Três fatos medidos:

```text
read ui://inventory/dashboard.html  -> contents[0]._meta = {"ui":{"csp":{"connectDomains":["https://api.example.com"],"baseUris":["https://cdn.example.com"]},"permissions":{"allow":["camera"]},"prefersBorder":true}}
list ui://inventory/sample-style.html -> _meta = {"ui":"{"csp":{"connectDomains":[...]},"prefersBorder":true}"}
read ui://inventory/sample-style.html -> nenhum _meta
```

1. `[McpMeta("ui", """{...}""")]`, a forma usada pelo sample `WeatherAppServer` do repositório 2.4.0, guarda o JSON como
   string (note o `"`), e o `[McpMeta]` não é copiado para o `resources/read` (a própria doc dele avisa). A forma
   de objeto é `[McpMeta("ui", JsonValue = """{...}""")]` para a listagem, e o CSP precisa ser montado no
   `TextResourceContents.Meta` devolvido, como a primeira linha faz com `McpUiResourceMeta` e `McpApps.SerializerOptions`.
2. As classes tipadas não batem com as chaves da spec 2026-01-26: `McpUiResourceCsp.BaseUris` serializa como `baseUris`
   (spec: `baseUriDomains`) e `McpUiResourcePermissions.Allow` como `{"allow":["camera"]}` (spec: `{"camera":{}}`). Um
   host que segue a spec ignora as duas. Escreva essas duas chaves como JSON cru até o SDK alcançar a spec.

### Visibilidade é trabalho do host, e os nomes sensíveis a maiúsculas

`visibility: ["app"]` esconde uma tool do modelo, mas o servidor C# ainda devolve `refresh_stock` no `tools/list` para
todo cliente (fio acima). A spec põe a filtragem no host ("MUST NOT include tools in the agent's tool list") e no
`tools/call` vindo do app ("MUST reject" tools sem `app`). Um cliente sem Apps que chame uma tool só de app não é
bloqueado pelo SDK, então mantenha essas tools inofensivas e autorizadas como qualquer outra (veja
[Segurança do MCP](/dotnet-ai-concepts/mcp-security-tool-poisoning-confused-deputy-and-least-privilege)).

A 2.4.0 ("Match protocol property names case-sensitively", #1934) mudou o `McpApps.SerializerOptions`. O mesmo programa
contra a 2.3.0 e a 2.4.0:

| Entrada | 2.3.0 | 2.4.0 |
| --- | --- | --- |
| `McpUiToolMeta` `{"ResourceUri":"ui://x/y.html"}` | `ResourceUri = ui://x/y.html` | `(null)` |
| `McpUiToolMeta` `{"RESOURCEURI":...}` | ligou | `(null)` |
| as duas grafias, a errada primeiro ou por último | a última vence | a canônica `resourceUri` vence |
| `McpUiClientCapabilities` `{"MimeTypes":[...]}` | ligou | `MimeTypes = (null)` |
| `GetUiCapability` com `{"MimeTypes":[...]}` | capability, `MimeTypes=(null)` | igual (já era sensível a maiúsculas) |
| `Tool` do núcleo `{"Name":...}` com `McpJsonUtilities.DefaultOptions` | ligou | ligou (inalterado) |

No fio, uma requisição crua declarando `"MimeTypes"` fez o `show_stock` informar `client declared MCP Apps,
mimeTypes=[]`: a capability existe, a lista está vazia, e um servidor que exija `text/html;profile=mcp-app` cairia no
texto. Impacto: código que desserializava JSON com caixa errada ou PascalCase pelo `McpApps.SerializerOptions` passa a
receber nulos em silêncio, sem exceção. Quem serializa e lê em camelCase correto não percebe nada.

### Skills: list, get e leituras verificadas

`WithSkillsFromSubdirectories` transforma cada pasta com um `SKILL.md` num skill (o layout de exemplo da spec dos Agent
Skills). O lado do cliente:

```csharp
if (!client.ServerCapabilities.SupportsSkills()) return;            // declarado em server/discover
foreach (var s in await client.ListSkillsAsync()) { /* s.Uri, s.Frontmatter, s.Resources.Entries */ }
Skill skill = await client.GetSkillAsync("skill://inventory-restock/SKILL.md");
ReadResourceResult md = await client.ReadSkillResourceAsync(skill, skill.Uri);   // confere tamanho e SHA-256
```

```text
skill skill://inventory-restock/SKILL.md frontmatter={"name":"inventory-restock","description":"Plan a restock for a SKU using the warehouse policy."} files=SKILL.md:194B,references/policy.md:82B
skill skill://stock-report/SKILL.md ... files=SKILL.md:160B
<-- skills/list  {"skills":[{"uri":"skill://inventory-restock/SKILL.md","frontmatter":{...},"resources":[{"uri":"skill://inventory-restock/SKILL.md","digest":"sha256:d62178b3...2593","size":194},{"uri":".../references/policy.md","digest":"sha256:09540...3791","size":82}]}],"resultType":"complete","ttlMs":0,"cacheScope":"private"}
<-- skills/get   {"error":{"code":-32602,"message":"No skill is served at 'skill://nope/SKILL.md'."}}
unlisted file: InvalidDataException: 'skill://inventory-restock/not-in-manifest.md' is not listed in the manifest ... refresh the entry with skills/get before reading it.
```

Os arquivos são recursos comuns: o `resources/list` também mostrou os três arquivos `skill://` ao lado dos `ui://`,
então um cliente que lista recursos os vê sem a extensão. A regra de integridade fica no host: ele precisa verificar
cada arquivo contra o manifesto. Um servidor cuja entrada prometeu um digest e serviu outros bytes (mesmo tamanho,
`# Harmless` virou `# Harmful!`):

```text
plain resources/read, bytes served: 64 (no check at all)
verified read: InvalidDataException: The content of 'skill://tampered/SKILL.md' has digest 'sha256:d519...18b3', but its manifest entry declares 'sha256:3c1b...667d'.
```

Com tamanho diferente a mensagem é `is 99 bytes, but its manifest entry declares 64 bytes`. A checagem só existe se o
host chamar `ReadSkillResourceAsync` (ou o `SkillVerifier`); o `ReadResourceAsync` lê os bytes adulterados. A spec e a
doc do SDK acrescentam que os digests não são assinados e vêm do mesmo servidor (consistência, não confiança), que a
aprovação persistida deve ficar presa ao manifesto, que campos de frontmatter como `allowed-tools` não podem ampliar
permissões de um skill de origem MCP sem aprovação, e que o texto de um skill é superfície de prompt injection (veja a
lição de poisoning linkada acima). Não implementado no pacote: `resources/directory/read`.

### Só documentação: o que um host faz

Nada disso rodou com um host. A spec descreve o fluxo: o host pré-carrega o recurso `ui://` citado em
`_meta.ui.resourceUri`, renderiza num iframe com sandbox (o desenho web recomendado é um iframe duplo com um proxy de
sandbox), monta o CSP a partir dos domínios declarados (padrão `connect-src 'none'` e `default-src 'none'`, script e
estilo inline permitidos, sem `unsafe-eval`) e conversa com o app por `postMessage` num dialeto JSON-RPC (`ui/initialize`
e outros métodos `ui/`; o app pode chamar as tools que o host permitir). O `domain` pede uma origem de sandbox estável e
o formato dele depende do host. Não medido aqui: renderização, `postMessage`, aplicação do CSP, modos de exibição e
variáveis de tema do host.

### Quem usa (fontes, 2026-11-21)

- Hosts de Apps: o site do MCP lista Claude (web e Desktop), VS Code GitHub Copilot, Microsoft 365 Copilot, Goose,
  Postman e MCPJam; a matriz de clientes, mantida pela comunidade, acrescenta ChatGPT, Cursor, Archestra.AI, PostHog
  Code, Kiro Crew e Glean, e o MCP Inspector como parcial. A própria página do VS Code ainda rotula como "Interactive
  results (Experimental)". A spec cita o MCP-UI e o Apps SDK da OpenAI (lançado em novembro de 2025) como origem, então
  os widgets no estilo ChatGPT eram a prática antes do padrão (livro contra hoje: textos antigos descrevem o `ui://`
  por `_meta["ui/resourceUri"]`, que a spec chama de depreciado; use `_meta.ui.resourceUri`).
- Skills: a matriz marca MCPJam, Glean e a CLI `mcpc` como suportando, e ChatGPT, fast-agent e MCP Inspector como
  parcial; o Claude Code não está marcado. A visão geral diz "SDK and host support is still being implemented". Totais
  do NuGet em 2026-11-21 (restaurações de CI incluídas): 144.868 downloads para Apps, 1.940 para Skills.
- Servidores: o repositório traz `WeatherAppServer`, `SkillsServer` e `SkillsClient`; o ext-apps traz exemplos em
  TypeScript (mapas, visualizador de PDF, painéis). Nenhum servidor Apps .NET de terceiros foi conferido.

### net10.0 contra net11.0

As execuções `apps`, `apps ui`, a requisição crua e `skills` foram repetidas em `net11.0` (SDK 11.0.100, runtime
11.0.0): a saída foi idêntica byte a byte à do `net10.0`, e os pacotes restauram a partir dos assets `net10.0`.

## Trade-offs

- **Protocolo estável, pacote experimental.** Construa sobre o Apps só se você absorve quebras de API e mantém a
  supressão do diagnóstico local; trate o JSON cru (`_meta.ui`) como o contrato, é o que os hosts leem. O Skills é Beta
  nos dois lugares e o pacote tem uma única versão, presa exatamente a `ModelContextProtocol 2.4.0`.
- **Sempre tenha uma resposta em texto.** A maioria dos clientes não tem iframe; `GetUiCapability` mais conteúdo de
  texto é todo o fallback.
- **Não confie cegamente nos helpers tipados de CSP.** Confira `baseUriDomains` e `permissions` contra a spec e ponha o
  CSP no conteúdo do `resources/read`.
- **Uma UI é código rodando ao lado do usuário.** O sandbox e o CSP protegem o host, não os seus dados: declare o mínimo
  de `connectDomains` e autorize tools só de app como se qualquer um pudesse chamá-las.
- **Skills são instruções, não código, mas conduzem um modelo.** Verifique com `ReadSkillResourceAsync`, prenda a
  aprovação ao manifesto, marque o servidor de origem e pule skills com recursos `"dynamic"` quando não der para verificar.
- **Maiúsculas importam agora.** Subir para a 2.4.0 pode transformar entrada PascalCase em nulos em silêncio; ponha um
  teste que faça ida e volta do seu JSON de `_meta.ui`.

## Documentation Links

- [MCP Apps overview, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/apps/overview) (doc)
- [MCP Apps specification 2026-01-26 (SEP-1865), GitHub](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) (doc)
- [Skills over MCP overview, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/skills/overview) (doc)
- [Skills extension specification (beta), GitHub](https://github.com/modelcontextprotocol/ext-skills/blob/main/specification/beta/skills.mdx) (doc)
- [Extensions overview and stages, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/overview) (doc)
- [Extension support matrix, modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/client-matrix) (doc)
- [SEP-3392: Extension Lifecycle, modelcontextprotocol.io](https://modelcontextprotocol.io/seps/3392-extension-lifecycle) (doc)
- [List of diagnostics (MCPEXP003, MCPEXP005), MCP C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/list-of-diagnostics.md) (doc)
- [MCP Apps in the C# SDK, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/apps/apps.md) (doc)
- [MCP C# SDK 2.4.0 release notes, GitHub](https://github.com/modelcontextprotocol/csharp-sdk/releases/tag/v2.4.0) (doc)
- [Use MCP servers in VS Code, Visual Studio Code](https://code.visualstudio.com/docs/copilot/customization/mcp-servers) (doc)
