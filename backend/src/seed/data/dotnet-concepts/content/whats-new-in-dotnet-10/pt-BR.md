---
version: 1.0
updatedAt: 2026-10-15
title: "O Que Há de Novo no .NET 10: Um Mapa da Plataforma"
summary: Mapa das novidades de runtime, SDK e bibliotecas do .NET 10 (LTS) conforme as páginas oficiais, cada uma em poucas linhas e ligada ao conceito que explica o mecanismo.
---
## Objective

O .NET 10 é o sucessor do .NET 9 e uma versão de suporte de longo prazo (LTS),
com três anos de suporte. Este conceito é um mapa, não um tutorial: lista o que
as páginas "What's new in .NET 10" da Microsoft dizem que mudou no runtime, no
SDK e nas bibliotecas, em poucas linhas cada, e aponta o conceito desta trilha
ou de C# Concepts que explica o mecanismo. Use para decidir o que estudar em
seguida. ASP.NET Core, EF Core e C# 14 têm páginas próprias de novidades e aqui
só são apontados. Cada item abaixo foi conferido nas páginas oficiais de
runtime, SDK e bibliotecas.

## Use Cases

- Planejar a migração do .NET 8 ou 9 e saber quais mudanças afetam o seu código.
- Achar o conceito profundo por trás de uma novidade sem ler release notes.
- Separar o que já vem ligado por padrão (comportamento do SDK) do que exige opt-in.
- Atualizar um time que parou no .NET Framework ou em um LTS antigo.

## Deep Dive

### Suporte e versões

O .NET 10 é LTS, com três anos de suporte. Qual alvo escolher num projeto novo e
como funciona o calendário de suporte está em "The .NET Support Lifecycle and
Choosing a Target" (`dotnet-support-lifecycle-and-choosing-a-target`). A
linguagem que acompanha é o C# 14: propriedades com campo de apoio, blocos
`extension`, atribuição condicional nula e mais. A mecânica de versões e
preview está em `csharp-language-versions-and-preview-features`, e duas das
novidades principais têm conceito próprio:
`properties-init-accessors-and-the-field-keyword` e
`extension-members-and-extension-blocks`.

### Runtime e JIT

A página de runtime lista trabalho do JIT em argumentos struct (membros
promovidos podem dividir um registrador), inversão de loop baseada em análise de
grafo, devirtualização de métodos de interface de array, uma nova heurística de
layout de blocos e inlining melhor. A alocação na pilha passa a cobrir arrays
pequenos de tipos valor e de tipos referência, e a análise de escape agora
considera campos de structs locais e delegates. No Arm64, o novo padrão de
write barrier melhora as pausas do GC; a página cita de 8% a mais de 20%. Os
intrinsics AVX10.2 existem, mas o suporte do JIT vem desligado por padrão, porque
ainda não havia hardware compatível. O NativeAOT também recebe pequenas
melhorias no preinitializer. Para ver como o código-fonte vira código de máquina,
leia `roslyn-il-and-the-jit`. Para entender por que "struct na pilha, classe no
heap" é só uma regra prática, leia `value-types-reference-types-and-boxing`.

### SDK e CLI

- **File-based apps** ganham suporte a publish, a diretiva `#:project`, acesso
  a caminhos em runtime e shebang melhorado. Miram Native AOT por padrão, e
  `#:property PublishAot=false` desliga isso. Aprofundamento: `file-based-apps`;
  o lado AOT está em `native-aot-and-its-limits`.
- **Ferramentas one-shot.** `dotnet tool exec` roda uma ferramenta sem
  instalá-la, e `dnx` é um script que repassa para ele. Ferramentas também podem
  trazer pacotes por RID, inclusive o RID `any` como alternativa portátil.
- **Comandos substantivo primeiro.** `dotnet package add` e
  `dotnet reference add` se juntam às formas antigas, que continuam funcionando.
- **Introspecção e shells.** `--cli-schema` imprime a árvore de comandos em JSON,
  e `dotnet completions script` gera scripts nativos de autocompletar para bash,
  fish, nushell, PowerShell e zsh. Os comandos também são interativos por padrão
  em terminais interativos.
- **Poda de pacotes.** O NuGet Audit pode podar referências de pacotes fornecidos
  pelo framework em projetos que miram .NET 10 ou superior, o que reduz o
  trabalho de restore e encolhe o `deps.json`. Veja
  `nuget-restore-versions-and-dependency-resolution` e
  `assemblies-frameworks-and-the-host-resolver`.
- **Containers e testes.** Apps de console criam imagens de container com
  `dotnet publish /t:PublishContainer`, `ContainerImageFormat` escolhe Docker ou
  OCI, e o `dotnet test` suporta o Microsoft.Testing.Platform via `global.json`.
  A trilha de testes começa em `testing-clean-architecture-with-mstest`.
- **Tarefas MSBuild.** O `msbuild.exe` e o Visual Studio 2026 conseguem rodar
  tarefas feitas para .NET. Arquivos de projeto estão em
  `sdk-style-projects-msbuild-and-directory-build-props`.

### Bibliotecas

- **Ordenação numérica de strings.** `CompareOptions.NumericOrdering` faz "2"
  vir antes de "10". Aprofundamento: `strings-comparison-culture-and-ordering`.
- **System.Text.Json.** `AllowDuplicateProperties`, o preset
  `JsonSerializerOptions.Strict`, overloads de `PipeReader` na desserialização e
  `ReferenceHandler` em `JsonSourceGenerationOptions`. Veja
  `system-text-json-serialization-and-options` e
  `system-text-json-source-generation-and-utf8jsonreader`.
- **ZIP assíncrono.** `ZipArchive.CreateAsync`, `ZipFile.OpenReadAsync` e
  métodos relacionados evitam bloquear threads em I/O de arquivos compactados.
  Base sobre streams e pipelines: `async-io-and-system-io-pipelines`.
- **Também listados** pela página de bibliotecas: criptografia pós-quântica
  (ML-DSA, Composite ML-DSA), AES KeyWrap com Padding, `WebSocketStream`, TLS 1.3
  em clientes macOS, novas opções de `ActivitySource` e `Meter`, APIs de Tensor e
  grupos de processo no Windows. Nenhum conceito daqui cobre isso ainda.

### Outras áreas

Aspire, ASP.NET Core, EF Core, Windows Forms, WPF e MAUI têm página própria. A
visão geral cita os named query filters como novidade do EF Core 10; eles são
explicados em `global-and-named-query-filters`, e as colunas JSON em
`json-columns-and-complex-types`.

## Trade-offs

- **LTS é política, não motivo.** Ir do 8 para o 10 dá três anos de suporte, mas
  cada item acima ainda precisa de teste. Meça a sua carga antes de atribuir
  velocidade aos ganhos do JIT.
- **Padrões mudam comportamento.** Um file-based app mira Native AOT, então um
  pacote que depende de reflection pode falhar no `dotnet run`. A correção é uma
  linha `#:property`, mas é preciso saber que o padrão existe.
- **Poda pode surpreender.** `deps.json` menor é bom, mas um script que procurava
  um pacote do framework no arquivo antigo pode passar a não achar nada.
- **Um mapa esconde profundidade.** Cada item é uma manchete. As páginas da
  Microsoft são a fonte de verdade e continuam sendo editadas; esta página
  registra o que elas diziam quando foi escrita.

## Documentation Links

- [What's new in .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/overview) (doc)
- [What's new in the .NET 10 runtime, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/runtime) (doc)
- [What's new in the SDK and tooling for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/sdk) (doc)
- [What's new in the .NET 10 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-10/libraries) (doc)
- [.NET support policy, Microsoft](https://dotnet.microsoft.com/platform/support/policy/dotnet-core) (doc)
