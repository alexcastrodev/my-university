---
version: 1.0
updatedAt: 2026-10-18
title: "Microsoft.Testing.Platform, dotnet test e Code Coverage no CI"
summary: Migre uma suíte MSTest do VSTest para o Microsoft.Testing.Platform com MSTest.Sdk e global.json, entenda os novos comandos e exit codes do dotnet test no .NET 10, colete cobertura com um gate no CI e veja, por mutação, por que cobertura alta não prova nada.
---
## Objective

Durante anos `dotnet test` significou VSTest: um processo host chamado `testhost`
carregava o assembly de teste, e toda opção (`--logger`, `--collect`, um caminho
de projeto posicional) era uma opção do VSTest. O Microsoft.Testing.Platform (MTP)
substitui esse modelo. O projeto de teste vira um executável que roda os próprios
testes, e o SDK do .NET 10 traz um modo do `dotnet test` feito para ele. O
objetivo é migrar uma suíte MSTest para o MTP de propósito, saber quais comandos
e exit codes mudam, coletar cobertura no CI com um gate que quebra o build, e
lembrar que um gate de cobertura verde diz qual código rodou, não qual código foi
conferido.

## Use Cases

- Migrar uma solution do `dotnet test` sobre VSTest para o modo MTP do SDK do
  .NET 10, e consertar os scripts de CI que quebram no caminho.
- Rodar um projeto de teste diretamente (`dotnet run`, ou o executável gerado)
  para depurar um filtro ou um crash sem a orquestração do `dotnet test`.
- Fazer o CI falhar quando um erro de digitação no filtro ou uma descoberta
  quebrada roda zero testes, em vez de reportar um sucesso silencioso.
- Coletar cobertura com Microsoft Code Coverage ou coverlet, transformá-la em um
  relatório HTML e num resumo do job com o ReportGenerator, e barrar abaixo de um
  mínimo.
- Explicar para o time por que 100% de cobertura de branches não pegou um bug de
  limite.

## Deep Dive

### Quem roda os testes

| | VSTest | Microsoft.Testing.Platform |
| --- | --- | --- |
| Processo que roda os testes | `testhost`, iniciado pelo `vstest.console` | o próprio projeto de teste (um executável) |
| Como o MSTest se conecta | adapter mais `Microsoft.NET.Test.Sdk` | o runner do MSTest (MSTest 3.2+) |
| Opções | opções fixas do VSTest (`--logger`, `--collect`, `--settings`) | as opções da plataforma mais as que cada extensão registrada adiciona |
| Filtro com erro de digitação que não casa nada | aviso, exit code 0 | exit code 8 |

Dá para ver a diferença de dentro de um teste. No VSTest o entry assembly é o
host; no MTP é o projeto de teste. O lab usa isso como guarda de que a troca de
runner aconteceu de verdade:

```csharp
[TestMethod]
public void TheSuiteRunsOnMicrosoftTestingPlatform() =>
    Assert.AreEqual(
        "Checkout.Tests",
        Assembly.GetEntryAssembly()?.GetName().Name,
        "TODO-00: the tests still run inside VSTest's testhost. Select the MTP runner (see the README).");
```

No VSTest a asserção reporta `Actual:<testhost>`.

### Optando pelo MTP: MSTest.Sdk e global.json

Há duas chaves, e elas são independentes. O projeto decide se é uma aplicação
MTP. O `global.json` decide qual modo o `dotnet test` usa.

O lado do projeto fica mais simples com o `MSTest.Sdk`, um MSBuild SDK que
substitui o `Microsoft.NET.Sdk` e liga o MTP por padrão:

```xml
<Project Sdk="MSTest.Sdk/4.5.1">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\..\src\Checkout\Checkout.csproj" />
  </ItemGroup>

</Project>
```

Não há `PackageReference` para o MSTest nem item `Using`: o SDK traz o
framework, o adapter, os analyzers e o using global. O profile de extensões
`Default` também adiciona as extensões de Code Coverage e de relatório TRX, e é
por isso que `--coverage` e `--report-trx` funcionam nos comandos abaixo.
`<TestingExtensionsProfile>None</TestingExtensionsProfile>` as remove, e
`<UseVSTest>true</UseVSTest>` devolve o projeto ao VSTest. Se um projeto precisa
de outro SDK de topo (por exemplo `Microsoft.NET.Sdk.Web`), mantenha-o com o
pacote `MSTest` e adicione `<EnableMSTestRunner>true</EnableMSTestRunner>` e
`<OutputType>Exe</OutputType>`; desde o MSTest 3.8 o metapackage já referencia
as extensões de cobertura e de TRX.

O lado do `dotnet test` é um arquivo ao lado da solution:

```json
{
  "test": {
    "runner": "Microsoft.Testing.Platform"
  }
}
```

`dotnet new mstest --sdk --test-runner Microsoft.Testing.Platform` gera os dois.
O modo é tudo ou nada. Com o `global.json` e um projeto ainda no VSTest, o
`dotnet test` se recusa a começar:

```text
global.json defines test runner to be Microsoft.Testing.Platform. All projects must use that test runner.
The following test projects are using VSTest test runner:
Checkout.Tests.csproj
```

Antes do .NET 10, projetos MTP rodavam no modo VSTest por meio de
`<TestingPlatformDotnetTestSupport>true</TestingPlatformDotnetTestSupport>`, com
as opções do MTP depois de um `--` extra. A documentação marca esse caminho como
legado; no modo MTP nem a propriedade nem o `--` são obrigatórios.

### O que muda na linha de comando

| Hábito do VSTest | Modo MTP (SDK do .NET 10) |
| --- | --- |
| `dotnet test path/To.Tests.csproj` | `dotnet test --project path/To.Tests.csproj` |
| `dotnet test My.sln` | `dotnet test --solution My.sln` |
| `dotnet test path/To.Tests.dll` | `dotnet test --test-modules "**/bin/**/To.Tests.dll"` |
| `--logger trx` | `--report-trx` (extensão TRX) |
| `--collect "XPlat Code Coverage"` | `--coverage` (Microsoft) ou `--coverlet` (coverlet.MTP) |
| `--filter "TestCategory=Shipping"` | igual no MSTest |

O caminho de projeto posicional falha rápido com `Specifying a project for
'dotnet test' should be via '--project'.` Uma opção do VSTest falha de outro
jeito: `dotnet test --logger trx` compila, o módulo sai com o código 5 (linha de
comando inválida), e a execução reporta `Zero tests ran` com exit code 1. Opções
que o próprio `dotnet test` não conhece são repassadas para cada aplicação de
teste. Coloque-as depois de um `--` literal quando quiser deixar isso explícito:

```bash
dotnet test --results-directory TestResults -- --report-trx --maximum-failed-tests 1
```

`--maximum-failed-tests` para a execução depois desse número de falhas e sai com
o código 13. `--minimum-expected-tests` antes do `--` vale para a execução
inteira (desde o SDK 10.0.100); depois do `--` vale para cada módulo de teste.

### O projeto de teste é um executável

Como o projeto é o runner, você não precisa do `dotnet test` para rodá-lo. Todas
as opções acima funcionam igual:

```bash
dotnet run --project tests/Checkout.Tests -- --filter "TestCategory=Discounts"
./tests/Checkout.Tests/bin/Debug/net10.0/Checkout.Tests --list-tests
```

`--help` lista as opções das extensões que este projeto registrou, que é o jeito
mais rápido de entender por que uma opção foi rejeitada.

### Filtros, categorias e exit codes

O MSTest mantém a sintaxe de filtro no MTP. Uma categoria na classe marca todos
os testes dela:

```csharp
[TestClass]
[TestCategory("Shipping")]
public sealed class ShippingTests
```

```bash
dotnet test --filter "TestCategory=Shipping"                          # 4 testes
dotnet test --filter "FullyQualifiedName~Discount"                    # 10 testes
dotnet test --filter "TestCategory!=Shipping&TestCategory!=Theater"   # 15 testes
```

O exit code é o que o CI lê, e o MTP é rigoroso com ele:

| Exit code | Significado |
| --- | --- |
| 0 | todo teste selecionado rodou e passou |
| 2 | pelo menos um teste falhou |
| 5 | argumentos de linha de comando inválidos (muitas vezes uma opção de uma extensão que o projeto não tem) |
| 8 | zero testes rodaram |
| 9 | rodaram menos testes do que `--minimum-expected-tests` |
| 13 | parado por `--maximum-failed-tests` |

O mesmo erro de digitação se comporta diferente nas duas plataformas:

```bash
dotnet test --filter "TestCategory=Shiping"; echo $?
# VSTest: "No test matches the given testcase filter", exit code 0
# MTP:    total: 0, exit code 8
```

Um job verde que não rodou nada é pior que um vermelho. `--minimum-expected-tests`
vai além e pega também uma suíte que perdeu testes. No lab, pedir 21 testes
quando existem 20 sai com o código 9. Se uma execução com zero testes é legítima
(uma fatia vazia numa matriz), diga isso com `--ignore-exit-code 8`.

### Coletando cobertura

| | Microsoft Code Coverage | coverlet |
| --- | --- | --- |
| VSTest | `--collect "Code Coverage"` | `coverlet.collector`, `--collect "XPlat Code Coverage"` |
| MTP | `Microsoft.Testing.Extensions.CodeCoverage`, `--coverage` | `coverlet.MTP`, `--coverlet` |
| Formatos | `coverage` (padrão), `xml`, `cobertura` | `json`, `lcov`, `opencover`, `cobertura`, `teamcity` |

O `coverlet.collector` é um data collector do VSTest; no MTP o equivalente é o
pacote `coverlet.MTP`. Com o MSTest.Sdk a extensão da Microsoft já está lá:

```bash
dotnet test --results-directory TestResults \
  --coverage --coverage-output-format cobertura --coverage-output coverage.cobertura.xml
```

O arquivo vai para `TestResults/coverage.cobertura.xml`. Dois padrões
surpreendem. O assembly de teste fica de fora (`IncludeTestAssembly` é `false` na
extensão do MTP; era `true` no VSTest), então uma execução num projeto de teste
sem referência a código de produção reporta um `<packages />` vazio. E algumas
linhas nunca podem ser cobertas: no lab, as duas linhas de `const decimal`
aparecem como não cobertas porque um `const decimal` é compilado como um campo
`static readonly` com `DecimalConstantAttribute`, preenchido por um construtor
estático, enquanto todo uso é inlined. Esse construtor nunca roda, por isso o lab
exige 90% de linhas e 100% de branches, em vez de perseguir um número que nenhum
teste alcança.

### De um arquivo Cobertura a um gate

O ReportGenerator transforma o arquivo Cobertura em HTML, num resumo em texto ou
num resumo de job do GitHub, e as configurações `minimumCoverageThresholds` o
fazem sair com código diferente de zero abaixo de um limite. Instale-o como
ferramenta local para que o CI e cada desenvolvedor usem a mesma versão:

```bash
dotnet new tool-manifest
dotnet tool install dotnet-reportgenerator-globaltool --version 5.5.11
dotnet reportgenerator -reports:TestResults/coverage.cobertura.xml -targetdir:coverage-report \
  "-reporttypes:TextSummary;Html" \
  minimumCoverageThresholds:lineCoverage=90 minimumCoverageThresholds:branchCoverage=100
```

Barre por branches, não só por linhas. A regra de frete do lab tem duas condições
numa linha:

```csharp
var shipping = discounted >= FreeShippingThreshold || tier == Tier.Gold ? 0m : ShippingFee;
```

Um teste executa a linha; a cobertura de branches conta cada saída de cada
condição. Só com os testes de desconto, a linha fica coberta e dois de 30
branches não (93,3%), e o gate falha.

### Um workflow do GitHub Actions

Todos os comandos deste job foram rodados localmente contra a solution do lab:

```yaml
name: tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-dotnet@v6
        with:
          dotnet-version: 10.0.x
      - run: dotnet restore
      - run: dotnet build --no-restore -c Release
      - run: >
          dotnet test --no-build -c Release --results-directory TestResults
          --minimum-expected-tests 20 --report-trx
          --coverage --coverage-output-format cobertura --coverage-output coverage.cobertura.xml
      - run: dotnet tool restore
      - run: >
          dotnet reportgenerator -reports:TestResults/coverage.cobertura.xml -targetdir:coverage-report
          "-reporttypes:MarkdownSummaryGithub;Html"
          minimumCoverageThresholds:lineCoverage=90 minimumCoverageThresholds:branchCoverage=100
      - if: always()
        run: cat coverage-report/SummaryGithub.md >> "$GITHUB_STEP_SUMMARY"
      - if: always()
        uses: actions/upload-artifact@v7
        with:
          name: test-results
          path: |
            TestResults/*.trx
            coverage-report/
```

`--no-build` implica `--no-restore`, então o `dotnet test` precisa da pasta `obj`
do passo de restore no mesmo job; quando só os binários compilados chegam ao
estágio de teste, rode-os com `--test-modules`. O `global.json` está no
repositório, então o CI escolhe o modo MTP sem flag extra.

### Cobertura não é veredito

A solution do lab chega a 93,9% das linhas e 100% dos branches no `coverage.sh`, que
compila em Debug. O build Release que o workflow usa conta 27 linhas cobríveis em vez
de 33 e mostra 92,5% das linhas, com os mesmos 100% dos branches, então os dois passam
no gate. Este teste, que não confere nada, chega aos mesmos números no `coverage.sh`:

```csharp
[TestMethod]
public void ExecutesEverythingAndChecksNothing()
{
    string?[] coupons = [null, "", "WELCOME10", "FLAT20", "NOPE"];
    decimal[] amounts = [10m, 49m, 60m, 120m];

    foreach (var tier in Enum.GetValues<Tier>())
    foreach (var coupon in coupons)
    foreach (var amount in amounts)
    {
        Try(() => PriceCalculator.Calculate([new("ITEM", 1, amount)], tier, coupon));
    }

    Try(() => PriceCalculator.Calculate([], Tier.Regular));
    Try(() => PriceCalculator.Calculate([new("ITEM", 0, 1m)], Tier.Regular));
}
```

`./coverage.sh --filter "TestCategory=Theater"` imprime os mesmos números e
`PASSED`, e um time cobrado por um percentual consegue escrevê-lo. Para saber o
que uma suíte confere, quebre o código de propósito, uma mudança por vez, e veja
o que fica vermelho:

| Mudança no código de produção | Suíte real | Teste teatro |
| --- | --- | --- |
| Frete grátis `>=` vira `>` | `AnOrderOfExactlyTheThresholdShipsFree` falha | verde |
| `\|\| tier == Tier.Gold` apagado | `GoldShipsFreeEvenBelowTheThreshold` falha | verde |
| Teto `Math.Min` do desconto removido | `TheDiscountNeverExceedsTheSubtotal` falha | verde |
| `.ToUpperInvariant()` removido do cupom | `ACouponIgnoresCaseAndSurroundingSpaces` falha | verde |
| Limite do `WELCOME10` `>= 50m` vira `> 50m` | a linha 50 de `Welcome10NeedsASubtotalOfAtLeast50` falha | verde |
| Taxa Silver `0.05m` vira `0.10m` | a linha Silver e `TheTierDiscountAndTheCouponAddUp` falham | verde |
| Checagem de quantidade `<= 0` vira `< 0` | a linha 0 de `ALineWithoutAPositiveQuantityIsRejected` falha | verde |

O meio-termo é o perigoso. Sem a classe `Shipping`, a suíte real ainda passa no
gate (15 testes, 100% dos branches), porque os testes de desconto executam os
dois branches do frete, e as duas primeiras mutações sobrevivem. A cobertura
encontra código que nenhum teste roda; só as asserções, e mutações contra elas,
mostram código que nenhum teste confere. O Stryker.NET (`dotnet-stryker`)
automatiza a tabela acima, ao custo de uma execução da suíte por mutante.

## Trade-offs

- **O modo MTP é tudo ou nada por `global.json`.** Uma solution que mistura
  projetos MTP e VSTest não pode usá-lo, e projetos MSTest e xUnit na mesma
  execução rejeitam as opções de filtro um do outro (`--filter` no MSTest,
  `--filter-trait` no xUnit.net), o que termina em exit code 5. Direcione opções
  específicas de framework com `TestingPlatformCommandLineArguments` no
  `Directory.Build.props`, ou migre todos os projetos antes de adicionar o arquivo.
- **Exit codes rigorosos quebram pipelines que dependiam do silêncio.** Uma perna
  da matriz cujo filtro não casa nada agora falha com 8. Deixe a intenção
  explícita em vez de ignorar todos os códigos:
  ```bash
  dotnet test --filter "TestCategory=Slow" -- --ignore-exit-code 8
  ```
- **O MSTest.Sdk é fixado em dois lugares.** A versão fica no atributo `Sdk` (ou
  no `global.json`, em `msbuild-sdks`), e a documentação avisa que ferramentas de
  atualização do NuGet, Dependabot incluído, não atualizam MSBuild SDKs. Alguém
  precisa atualizar à mão.
- **Microsoft Code Coverage ou coverlet.** A extensão da Microsoft vem com o
  MSTest.Sdk e com o metapackage MSTest e também pode cobrir código nativo
  (desligado por padrão), sob uma licença gratuita de código fechado. O coverlet é
  open source e também escreve lcov e opencover. Os dois escrevem Cobertura, que é
  tudo de que o ReportGenerator precisa.
- **Um gate de cobertura é barato; uma rodada de mutação não.** O gate custa
  segundos e pega código não testado. Teste de mutação roda a suíte uma vez por
  mutante, então cabe num job noturno ou na revisão de um módulo crítico, não em
  todo push.
- **xUnit e NUnit usam a mesma plataforma.** O xUnit.net v3 e o NUnit também
  rodam no MTP, então o `global.json`, os exit codes e as extensões de cobertura
  valem igual; só a sintaxe de filtro muda. O concept Testing Modules in Isolation
  mostra o lado do xUnit.

## Lab

O módulo de preço do checkout já está implementado. Sua tarefa é migrar o projeto de teste do VSTest para o Microsoft.Testing.Platform, escrever os testes, marcá-los com categorias e fazer o gate de cobertura passar.

**O que você vai praticar**

- Escolher o runner MTP com `MSTest.Sdk` e `global.json`, e ler o erro quando só metade está feita.
- Filtrar por `TestCategory` e ler o exit code de um filtro que não casa nada.
- Coletar cobertura Cobertura com `dotnet test --coverage` e barrá-la com o ReportGenerator.
- Rodar o projeto de teste como executável.
- Provar com mutações que um gate de cobertura verde não é uma revisão aprovada.

**Pré-requisitos:** MSTest Fundamentals: Lifecycle and TestContext, `dotnet test` básico, .NET 10 SDK.

**Como funciona:** cada método de teste está declarado com uma dica e falha com `TODO-NN: write this test` até você escrevê-lo, e duas checagens de setup falham até o runner e as categorias estarem configurados. O `./coverage.sh` falha até a cobertura chegar ao limite. Os TODOs opcionais pedem para quebrar o código de produção e para escrever um teste sem asserções, e comparar o que o relatório de cobertura diz com o que os testes pegam.

## Documentation Links

- [Testing with dotnet test (VSTest and MTP modes), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-with-dotnet-test) (doc)
- [dotnet test with Microsoft.Testing.Platform, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-test-mtp) (doc)
- [MSTest SDK configuration, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-sdk) (doc)
- [Run tests with MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-running-tests) (doc)
- [MTP CLI options reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-cli-options) (doc)
- [MTP troubleshooting and exit codes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-troubleshooting) (doc)
- [MTP code coverage, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-code-coverage) (doc)
- [Use code coverage for unit testing, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-code-coverage) (doc)
- [ReportGenerator settings (minimum coverage thresholds)](https://github.com/danielpalme/ReportGenerator/wiki/Settings) (doc)
