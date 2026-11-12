---
version: 1.0
updatedAt: 2026-11-12
title: "O Que Há de Novo no .NET 11: Um Mapa da Plataforma"
summary: Hub da release .NET 11 (STS) rodado no SDK 11.0.100: runtime, SDK e CLI, bibliotecas e um parágrafo para cada mapa de C# 15, ASP.NET Core 11 e EF Core 11, com o que ainda é preview e o que ficou só na documentação.
---
## Objective

O .NET 11 chegou em disponibilidade geral em 10 de novembro de 2026. É uma release de
suporte padrão (STS), então não substitui o .NET 10 LTS como padrão seguro, e mesmo assim
importa no dia em que sai: todo projeto que mira `net11.0` ganha o C# 15, e todo app que
roda no runtime 11 recebe as mudanças de comportamento, até um app que ainda diz `net10.0`.

Este concept é o hub da release, não um tutorial. Cobre o runtime, o SDK e a CLI e a
biblioteca base (BCL), e aponta para os concepts de C#, ASP.NET Core e EF Core, que têm
mapas próprios. O que está nesta página foi rodado no SDK 11.0.100 (runtime 11.0.0, macOS
arm64) e comparado com o SDK 10.0.100 quando a diferença era o ponto. Itens tirados só das
páginas da Microsoft estão marcados como "só doc", e o que as páginas ainda chamam de
preview está marcado como preview. O lado do upgrade, o que quebra e como encontrar, está em
`upgrading-to-dotnet-11-and-reading-breaking-changes`.

## Use Cases

- Decidir se vale mover um serviço do .NET 10 para o .NET 11 agora ou esperar.
- Achar o concept profundo por trás de uma manchete da release sem ler as release notes.
- Revisar um pull request que troca para `net11.0` e saber o que mais mudou junto.
- Separar o que é automático (comportamento de runtime e SDK), o que precisa de chave e o que ainda é preview.

## Deep Dive

### Suporte e versões

O .NET 11 é uma release STS. O índice de releases no dia do GA o lista como ativo até 14 de
novembro de 2028, o mesmo fim do .NET 10 LTS, então a diferença prática é acompanhar patches
numa base mais nova pelo mesmo período. O .NET 8 e o .NET 9 saíram de suporte em 10 de
novembro de 2026. O calendário e a escolha do alvo estão em
`dotnet-support-lifecycle-and-choosing-a-target`. As páginas usadas aqui não dizem qual
release é a próxima LTS, então este concept também não diz.

### O runtime decide, não o target framework

O fato mais útil para uma migração é também o menos visível. O comportamento da biblioteca
base vem do runtime que executa o programa, e o `TargetFramework` só escolhe qual é esse
runtime. O mesmo código rodou em três combinações: SDK 10 com `net10.0` no runtime 10, SDK 11
com `net11.0` no runtime 11, e SDK 11 com `net10.0` mas executado no runtime 11 (com
`DOTNET_ROLL_FORWARD=Major`, porque não havia runtime 10 para usar):

```csharp
byte b = (byte)double.Parse("300.0");               // runtime 10: 44   runtime 11: 255
decimal d = (decimal)(0.1 + double.Parse("0.2"));   // 0.3              0.3000000000000000444089209850
double r = Math.Round(double.Parse("2.675"), 2);    // 2.68             2.67
```

O app `net10.0` no runtime 11 imprimiu os valores do 11. Por padrão um app `net10.0` não faz
roll forward para um runtime de major mais novo, mas uma imagem de contêiner, um host com
`RollForward` configurado ou uma publicação self-contained decidem por você. O concept de
upgrade tem a tabela completa e as outras mudanças desse tipo.

### Runtime

- **Runtime async.** No .NET 11 o próprio runtime pode suspender e retomar métodos `async`,
  então o compilador não gera máquina de estados para eles. As bibliotecas da plataforma são
  construídas assim, então todo app no 11 já roda sobre isso. O seu código entra com
  `<Features>runtime-async=on</Features>`, e a documentação ainda classifica o recurso como
  preview. Stack traces e perfis ficam diferentes. A mecânica está em
  `task-and-async-await-internals`.
- **JIT e GC** (só doc). A página do runtime lista mais eliminação de bounds check, novos casos
  de devirtualização e comparadores padrão especializados. Nada disso foi medido aqui, então
  trate como motivo para fazer benchmark da sua carga, não como número.
- **Piso de hardware** (só doc). As páginas elevam o conjunto mínimo de instruções da CPU, então
  uma máquina muito antiga ou um emulador pode recusar iniciar o runtime. Confira isso antes de
  mover uma frota de contêineres, não depois.

### SDK e CLI

- **File-based apps** podem ter vários arquivos. `#:include greeter.cs` puxou um segundo
  arquivo para o build no SDK 11, e a mesma linha falha com `Unrecognized directive 'include'`
  no SDK 10.0.100. `dotnet run -e FOO=bar app.cs` passou a variável para o programa. Deep dive:
  `file-based-apps`.
- **Soluções.** `dotnet new sln` criou `demo.slnx` no SDK 11 e `demo.sln` no 10.0.100. Os
  arquivos de projeto estão em `sdk-style-projects-msbuild-and-directory-build-props`.
- **Ferramentas de uma execução.** `dotnet tool exec` não pede mais confirmação antes de rodar
  uma ferramenta baixada, e a documentação diz o mesmo do `dnx`. Em CI isso significa executar
  código sem nenhuma barreira, então fixe a versão. Veja `dotnet-cli-and-noun-first-commands`.
- **Publish Native AOT.** O SDK tem um publish otimizado que pula o build completo e seus hooks
  `AfterBuild` e `PostBuildEvent`. No SDK GA ele é opt-in com `UseOptimizedPublish=true`; o
  publish padrão ainda roda esses hooks. Os builds RC se comportavam de outro jeito, então uma
  nota escrita antes do GA pode dizer o contrário. Os detalhes estão no concept de upgrade e em
  `native-aot-and-its-limits`.
- **Também listados pelas páginas** (só doc): a própria CLI compilada com Native AOT, um servidor
  de MSBuild ligado por padrão, novas opções de contêiner e as mudanças de NuGet (uma idade mínima
  de pacote no restore, um restore que deixa de usar a pasta global de pacotes para escolher a
  próxima melhor versão).

### Bibliotecas

Cada linha abaixo foi rodada no 11.0.100:

```csharp
var r = Process.RunAndCaptureText("sh", ["-c", "echo out; echo err 1>&2; exit 3"]);
// exit=3 stdout=out stderr=err

a.FullJoin(b, l => l.Item1, r => r.Item1, (l, r) => $"{l.Item1}:{l.Item2}/{r.Item1}:{r.Item2}");
// 1:a/0: | 2:b/2:x | 0:/3:y          (o lado ausente chega como default)

using var z = new ZstandardStream(ms, CompressionMode.Compress, leaveOpen: true);
// 1000 bytes de 'a' -> 18 bytes, ida e volta com 1000

JsonSerializer.SerializeAsyncEnumerable(stream, Numbers(), topLevelValues: true);
// 0\n1\n                              (JSON Lines)

int.TryParsePartial("123abc", NumberStyles.Integer, CultureInfo.InvariantCulture, out v, out consumed);
// True 123 consumed=3

"a\U0001F600b".Contains(new Rune(0x1F600));   // True, IndexOf dá 1
new Regex("^b$", RegexOptions.Multiline | RegexOptions.AnyNewLine).IsMatch("a\u0085b\u0085c");
// True com AnyNewLine, False sem
```

Outras adições que foram conferidas e rodam: `EqualityComparer<T>.Create` sobre um seletor
de chave, `Random.Shared.NextInteger<byte>(10, 20)`, os streams sobre memória `StringStream`
(sem seek) e `ReadOnlyMemoryStream`, e os tipos `Decimal32`, `Decimal64` e `Decimal128` em
`System.Numerics`. Os concepts que explicam isso são `linq-sets-joins-grouping-and-lookups`,
`compression-zip-gzip-brotli-and-tar`, `stream-class-hierarchy-and-decorators`,
`parsing-tryparse-and-the-try-pattern`, `unicode-runes-and-text-encodings`,
`regular-expressions-in-depth` e `numeric-types-and-binary-representation`. `Process.Run*` ainda
não tem concept próprio.

As adições de criptografia e rede (novos algoritmos de troca e de embrulho de chave, combinações
pós-quânticas, DNS tipado e TLS dirigido pelo chamador) são listadas pelas páginas e não foram
rodadas aqui. Algumas delas ainda são marcadas como preview lá.

### C#, ASP.NET Core e EF Core

Cada um dos três tem mapa próprio, e este hub só diz o que abrir:

- **C# 15** é a versão de linguagem padrão em `net11.0`: argumentos para collection
  expressions (`with(...)`), union types, closed classes, indexadores em extension members e
  `break` e `continue` com rótulo, enquanto as regras de memory safety ainda são preview.
  Comece em `whats-new-in-csharp-15`. O compilador também rejeita algumas coisas que o
  compilador do 10 aceitava, e isso está no concept de upgrade.
- **ASP.NET Core 11** agrupa as mudanças em automáticas, opt-in, breaking e experimentais.
  `whats-new-in-aspnet-core-11` é o mapa e `migrating-from-aspnet-core-10-to-11` é o checklist,
  com o erro de restore do NuGet vindo do OpenAPI, o padrão OpenAPI 3.2 e o `RunAsync` lançando
  exceção quando um hosted service falha.
- **EF Core 11** traz SQL mais enxuto, novas traduções, índices de caminho JSON e um
  `LastMigrationId` no snapshot, com novidades de SQL Server 2025 e Cosmos DB.
  `whats-new-in-ef-core-11` é o mapa e `upgrading-from-ef-core-10-to-11-breaking-changes` é o
  checklist.

## Trade-offs

- **STS é uma promessa mais curta, não uma release pior.** A data de fim coincide com a da LTS que
  você talvez já rode, então a pergunta é quanta mudança você quer carregar agora. Um serviço com
  testes fracos pode ficar no .NET 10 até a rede de segurança melhorar.
- **Instalar o runtime pode mudar o comportamento antes de você trocar o alvo.** Qualquer coisa
  que rode um app `net10.0` no runtime 11 (um roll forward, uma imagem base que andou) entrega a
  ele a biblioteca base nova.
  ```csharp
  (byte)double.Parse("300.0")  // 44 no runtime 10, 255 no runtime 11, mesmo app net10.0
  ```
- **Padrões e opt-ins mudaram entre o RC e o GA.** O publish Native AOT otimizado foi relatado
  como padrão nos release candidates e é opt-in no SDK GA. Rode suas próprias conferências no
  build GA em vez de confiar em um texto escrito sobre o preview.
  ```xml
  <UseOptimizedPublish>true</UseOptimizedPublish>
  ```
- **Um mapa esconde profundidade.** Cada item é uma manchete. As páginas da Microsoft continuam
  sendo editadas e esta página registra o que era verdade no 11.0.100 em 12 de novembro de 2026.
- **Itens em preview não são um plano.** O runtime async no seu código e as regras de memory
  safety podem mudar antes de ficarem estáveis. Teste numa branch, não numa release.

## Documentation Links

- [What's new in .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/overview) (doc)
- [What's new in the .NET 11 runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/runtime) (doc)
- [What's new in the SDK and tooling for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/sdk) (doc)
- [What's new in the .NET 11 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [.NET 11 release notes, GitHub](https://github.com/dotnet/core/tree/main/release-notes/11.0) (doc)
- [.NET and .NET Core official support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) (doc)
