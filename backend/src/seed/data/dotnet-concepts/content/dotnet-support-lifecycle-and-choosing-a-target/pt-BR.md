---
version: 1.0
updatedAt: 2026-10-14
title: "O Ciclo de Suporte do .NET e a Escolha do Target"
summary: LTS e STS, fases ativa e de manutenção, SDK versus runtime, global.json com rollForward, como o host escolhe o runtime e qual target usar no fim de 2026.
---
## Objective

Toda versão do .NET tem data de validade, e essa data faz parte da decisão de
engenharia, não é nota de rodapé. Escolher o target framework define por quanto
tempo você recebe patches de segurança, quando vai ser obrigado a atualizar e de
quais SDKs e imagens de container o seu build depende. Este conceito explica a
política de suporte (LTS, STS, fases ativa e de manutenção), a diferença entre o
SDK que compila o código e o runtime que o executa, como o `global.json` fixa o
SDK, como o host escolhe um runtime na inicialização e como escolher o target no
fim de 2026.

## Use Cases

- Decidir se um serviço novo mira `net10.0` ou fica na versão que o resto da
  empresa usa.
- Fixar o SDK num repositório para que todo desenvolvedor e o agente de CI
  compilem com a mesma feature band.
- Explicar por que uma aplicação compilada para `net8.0` ainda sobe numa máquina
  que só tem runtimes mais novos, ou por que ela se recusa a subir.
- Escolher uma tag de container que recebe patches sozinha, ou uma que seja
  reproduzível byte a byte.
- Planejar a migração de serviços `net8.0` e `net9.0` antes do fim do suporte.

## Deep Dive

### LTS, STS e as duas fases de suporte

Uma versão major nova sai todo mês de novembro. As versões alternam entre dois
trilhos, e a única diferença entre eles é por quanto tempo a Microsoft lança
patches, não a qualidade:

- **LTS (Long Term Support)**: três anos de suporte e patches gratuitos.
- **STS (Standard Term Support)**: dois anos (24 meses).

Cada versão passa por uma fase **ativa**, com correções funcionais e de
segurança, e depois por uma fase de **manutenção**, que são os 6 meses finais e
recebem só correções de segurança. Depois vem o fim do suporte: a aplicação
continua rodando, mas nenhuma correção chega mais.

O suporte também tem condição: você precisa estar no patch mais recente. Os
patches são cumulativos, saem mais ou menos todo mês (os de segurança na Patch
Tuesday, a segunda terça-feira do mês), e uma máquina em `10.0.0` enquanto
existe `10.0.13` não está num estado suportado.

Estado da página oficial de política de suporte em outubro de 2026:

| Versão | Tipo | Lançamento | Fase | Fim do suporte |
|---|---|---|---|---|
| .NET 10 | LTS | 11 de novembro de 2025 | Ativa | 14 de novembro de 2028 |
| .NET 9 | STS | 12 de novembro de 2024 | Manutenção | 10 de novembro de 2026 |
| .NET 8 | LTS | 14 de novembro de 2023 | Manutenção | 10 de novembro de 2026 |

Repare que o .NET 8 (LTS) e o .NET 9 (STS) terminam no mesmo dia. A janela de
24 meses faz a STS expirar junto com a LTS anterior, então escolher uma STS não
significa mais uma vida muito mais curta que a da LTS anterior. As datas mudam
quando a política muda, então leia a página da política antes de um
planejamento, não esta tabela.

### SDK versus runtime

O **runtime** (`Microsoft.NETCore.App`, mais shared frameworks como
`Microsoft.AspNetCore.App`) executa aplicações. O **SDK** traz os compiladores,
o MSBuild, o NuGet e os comandos da CLI `dotnet`, e vem acompanhado de um
runtime. Os dois versionam de jeitos diferentes. O runtime usa
`major.minor.patch`. O SDK usa `major.minor.Fnn`, onde `F` é a **feature band**
(100, 200, 300...) e `nn` é o patch dentro da band. Uma band nova pode trazer um
MSBuild ou um NuGet mais novo; um patch dentro da band não.

As duas listas saem da CLI. Saída desta máquina:

```bash
$ dotnet --list-sdks
9.0.307 [/usr/local/share/dotnet/sdk]
10.0.100 [/usr/local/share/dotnet/sdk]

$ dotnet --list-runtimes
Microsoft.AspNetCore.App 9.0.11 [/usr/local/share/dotnet/shared/Microsoft.AspNetCore.App]
Microsoft.AspNetCore.App 10.0.0 [/usr/local/share/dotnet/shared/Microsoft.AspNetCore.App]
Microsoft.NETCore.App 8.0.22 [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
Microsoft.NETCore.App 9.0.11 [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
Microsoft.NETCore.App 10.0.0 [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
```

O `dotnet sdk check` compara essa lista com as versões publicadas e aponta o que
está defasado:

```text
.NET SDKs:
9.0.307       .NET 9.0 is going out of support soon.
10.0.100      Patch 10.0.113 is available.
```

Um SDK compila todo target framework mais antigo que ele conhece, então o SDK
mais novo compila projetos `net8.0` também. Mirar um framework que já saiu do
suporte ainda compila, com um aviso:

```text
warning NETSDK1138: The target framework 'net7.0' is out of support and will not
receive security updates in the future.
```

### Fixando o SDK com global.json

Sem `global.json`, todo comando `dotnet` usa o SDK mais alto instalado. Para ter
builds reproduzíveis, coloque um `global.json` na raiz do repositório. A CLI
procura o arquivo a partir do diretório atual subindo pelas pastas, então as
subpastas herdam a configuração.

```json
{
  "sdk": {
    "version": "9.0.300",
    "rollForward": "latestPatch"
  }
}
```

O `rollForward` define a faixa aceitável. Estes resultados saíram com os SDKs
9.0.307 e 10.0.100 instalados:

| `version` | `rollForward` | `dotnet --version` |
|---|---|---|
| (sem global.json) | | `10.0.100` |
| `9.0.300` | (nenhum, o padrão é `patch`) | `9.0.307` |
| `9.0.300` | `latestPatch` | `9.0.307` |
| `9.0.100` | `latestFeature` | `9.0.307` |
| `9.0.400` | `latestFeature` | falha, não há 9.0.4xx ou acima instalado |
| `8.0.100` | `latestPatch` | falha, não há 8.0.1xx instalado |
| `8.0.100` | `latestMajor` | `10.0.100` |

A falha é barulhenta e interrompe todo comando do SDK com exit code 155. O SDK
do .NET 10 adicionou a propriedade `errorMessage`, para a falha dizer como
resolver:

```json
{
  "sdk": {
    "version": "9.0.400",
    "rollForward": "latestFeature",
    "errorMessage": "This repo needs a .NET 9 SDK from the 9.0.400 band or later. Run ./eng/install-sdk.sh."
  }
}
```

```text
  * You intended to execute a .NET SDK command:
      This repo needs a .NET 9 SDK from the 9.0.400 band or later. Run ./eng/install-sdk.sh.
```

`latestFeature` é um bom padrão para times: garante uma band mínima e ainda
aceita patches e bands mais novas da mesma versão major.

### Como o host escolhe o runtime

O `global.json` só escolhe o SDK. Na inicialização, o host lê o target no
`*.runtimeconfig.json` e aplica outra política de roll-forward. O padrão é
`Minor`: usa o patch mais recente do `major.minor` pedido, ou uma minor maior se
aquela não existir, mas nunca outra major. Medido aqui com uma file-based app
compilada para `net8.0`:

```csharp
#:property TargetFramework=net8.0
using System.Runtime.InteropServices;

Console.WriteLine("Built for:  net8.0");
Console.WriteLine($"Running on: {RuntimeInformation.FrameworkDescription}");
// dotnet run which-runtime.cs                           -> Running on: .NET 8.0.22
// DOTNET_ROLL_FORWARD=LatestMajor dotnet run which-runtime.cs -> Running on: .NET 10.0.0
```

O mesmo programa compilado para `net7.0` compila (com `NETSDK1138`), mas se
recusa a subir nesta máquina, porque não há runtime 7.x instalado e a política
padrão não cruza majors:

```text
You must install or update .NET to run this application.
Framework: 'Microsoft.NETCore.App', version '7.0.0' (arm64)
The following frameworks were found:
  8.0.22 at [/usr/local/share/dotnet/shared/Microsoft.NETCore.App]
```

A política pode ser definida no projeto (`<RollForward>`), no
`runtimeconfig.json`, com `DOTNET_ROLL_FORWARD` ou com `--roll-forward`, e o
último vence. Cruzar uma major é uma decisão deliberada, porque versões major
podem trazer breaking changes.

### Imagens de container seguem as mesmas versões

As imagens oficiais ficam em `mcr.microsoft.com/dotnet/{sdk,aspnet,runtime,runtime-deps}`.
A tag codifica a versão e a variante: `aspnet:10.0` flutua para o patch 10.0
mais novo, `aspnet:10.0.13` fica preso num patch, e sufixos escolhem a
distribuição ou uma variante menor (`10.0-noble`, `10.0-noble-chiseled`,
`10.0-alpine`). Compile com `sdk:10.0` e rode com `aspnet:10.0` ou
`runtime:10.0`. Uma tag flutuante pega patches de segurança no rebuild; uma tag
fixa ou um digest é reproduzível, mas só recebe patch quando alguém atualiza.

### O que mirar no fim de 2026

- **Serviços e aplicações novos**: `net10.0`. É a única versão em suporte ativo
  e fica suportada até novembro de 2028.
- **Código existente em `net8.0` e `net9.0`**: os dois saem do suporte em 10 de
  novembro de 2026. Migre para `net10.0` agora; ficar significa rodar sem
  correções de segurança.
- **Bibliotecas**: mire a versão mais baixa que seus consumidores ainda usam, ou
  use multi-targeting, e compile com o SDK mais novo.

## Trade-offs

- **LTS dá uma janela longa, mas envelhece a plataforma.** Você abre mão de um
  ano de melhorias de runtime e bibliotecas para atualizar a cada dois anos em
  vez de todo ano.
- **STS não custa mais muito tempo de suporte, mas impõe um ritmo anual.** Com
  24 meses, o .NET 9 acabou junto com o .NET 8; quem adotou o 9 teve que ir para
  o 10 na mesma data.
- **`global.json` com `disable` ou `latestPatch` deixa o build reproduzível e
  frágil.** Um colega novo com outra band recebe exit code 155 antes de qualquer
  coisa compilar.
  ```json
  { "sdk": { "version": "10.0.100", "rollForward": "disable" } }
  ```
- **Forçar `LatestMajor` mantém uma aplicação antiga rodando num runtime novo,
  sem teste.** Isso esconde a necessidade de trocar o target e pode expor em
  produção mudanças de comportamento da major nova.
- **Tags de imagem flutuantes recebem patch sozinhas, mas mudam sem avisar.** Um
  rebuild na segunda pode rodar um patch diferente do de sexta. Fixar um digest
  resolve isso e passa o trabalho de aplicar patches para o seu pipeline
  (Dependabot ou Renovate).

## Documentation Links

- [.NET and .NET Core official support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) (doc)
- [.NET releases, patches, and support, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/releases-and-support) (doc)
- [Select which .NET version to use, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/versions/selection) (doc)
- [global.json overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/global-json) (doc)
- [.NET container images, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/docker/container-images) (doc)
