---
version: 1.0
updatedAt: 2026-11-12
title: "xUnit v3 para quem vem do MSTest"
summary: Porte uma suíte MSTest 4.5.3 para o xUnit v3 4.0.3 mantendo os nomes dos testes, com tabela de equivalência, ciclo de vida provado por log, fixtures de classe e de coleção, paralelismo por coleção, o Assert.Throws que exige o tipo exato e o MTP, tudo com saídas reais do SDK 11 GA.
---
## Objective

Esta trilha é escrita em MSTest, e a maioria dos repositórios em que você vai
entrar não é. O xUnit é o framework que você encontra primeiro em código aberto e
em muitas empresas, e o concept Choosing a Test Framework já compara os quatro
frameworks em paralelismo, runners e asserções. O que ele não ensina é como uma
suíte xUnit é montada: como o construtor substitui o `[TestInitialize]`, o que é
uma fixture, como duas classes compartilham um objeto e por que o mesmo nome
`Assert.Throws` significa outra coisa. Esta lição porta uma suíte MSTest 4.5.3
para o xUnit v3 4.0.3, mantém os nomes dos testes e mede o que muda. A suíte tem
14 testes nos dois frameworks, 13 passando e um pulado, e rodou no SDK .NET
11.0.100 GA (projetos `net10.0`, com roll forward) sobre o
Microsoft.Testing.Platform. Ela não repete as tabelas de comparação de Choosing a
Test Framework, nem o ciclo de vida do MSTest em MSTest Fundamentals.

## Use Cases

- Ler e corrigir testes em uma base xUnit quando seus hábitos são do MSTest.
- Portar uma suíte em qualquer direção sem uma renomeação que muda o significado.
- Compartilhar um objeto caro (um catálogo, um container, uma carga de banco)
  entre testes, e entre classes, do jeito xUnit.
- Entender por que uma coleção de classes roda em série enquanto o resto roda em
  paralelo.

## Deep Dive

### O projeto

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <OutputType>Exe</OutputType>
    <UseMicrosoftTestingPlatformRunner>true</UseMicrosoftTestingPlatformRunner>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="xunit.v3" Version="4.0.3" />
  </ItemGroup>
  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>
</Project>
```

Um projeto de teste v3 é um executável. O pacote `xunit.v3` depende do
`xunit.v3.mtp-v2` 4.0.3, então o MTP v2 é o padrão, e o `xunit.v3.mtp-off` o
desliga. Segundo a documentação do xUnit, o `UseMicrosoftTestingPlatformRunner` é
opcional: ele troca a linha de comando própria do xUnit (o "In-Process Runner")
pela do MTP. Sem a propriedade, rodar o executável imprimiu o cabeçalho
`xUnit.net v3 In-Process Runner v4.0.3`; com ela, a ajuda do MTP (`--filter-uid`,
`--diagnostic` e assim por diante). E no SDK 10 e posteriores, o `dotnet test`
usa o MTP quando o `global.json` manda, que é o mesmo arquivo dos projetos MSTest:

```json
{ "test": { "runner": "Microsoft.Testing.Platform" } }
```

Com ele, os projetos MSTest e xUnit rodaram num só `dotnet test` da solution, e o
projeto xUnit também rodou sozinho com `dotnet test --project tests/Shop.XTests`.

### A tabela de equivalência

Cada linha foi exercitada por um teste do lab, nos dois frameworks:

| Assunto | MSTest 4.5.3 | xUnit v3 4.0.3 |
| --- | --- | --- |
| Um teste | `[TestClass]` + `[TestMethod]` | `[Fact]`, sem atributo na classe |
| Setup por teste | construtor ou `[TestInitialize]` | construtor, ou `IAsyncLifetime.InitializeAsync` |
| Limpeza por teste | `[TestCleanup]`, `IDisposable` | `IDisposable`, ou `IAsyncLifetime.DisposeAsync` |
| Uma vez por classe | `[ClassInitialize]` estático | `IClassFixture<T>` |
| Compartilhado entre classes | `[AssemblyInitialize]` ou um campo estático | `[CollectionDefinition]` + `ICollectionFixture<T>` + `[Collection]` |
| Linhas de dados | `[DataRow(0)]` | `[Theory]` + `[InlineData(0)]` |
| Dados de um membro | `[DynamicData(nameof(X))]` | `[MemberData(nameof(X))]` sobre `TheoryData<...>` |
| Tipo exato da exceção | `Assert.ThrowsExactly<T>` | `Assert.Throws<T>` |
| Exceção ou subclasse | `Assert.Throws<T>` | `Assert.ThrowsAny<T>` |
| Pular | `[Ignore("motivo")]` | `[Fact(Skip = "motivo")]` |
| Categoria | `[TestCategory("Fast")]` | `[Trait("Category", "Fast")]` |
| Saída do teste | `TestContext.WriteLine` | `ITestOutputHelper.WriteLine` |
| Token e nome | `TestContext.CancellationToken`, `.TestName` | `TestContext.Current.CancellationToken`, `.Test` |
| Unidade paralela | o que o `[Parallelize]` disser | a coleção de testes, uma classe por padrão |
| Filtro por categoria | `--filter "TestCategory=Fast"` | `--filter-trait "Category=Fast"` |

### Uma classe, portada

A classe MSTest mantém uma propriedade `TestContext` e monta o catálogo num
`[ClassInitialize]` estático. A classe xUnit pede o que precisa no construtor, e
uma classe pequena carrega o objeto compartilhado:

```csharp
public sealed class CatalogFixture
{
    public PriceCatalog Catalog { get; } = new();
}

[Trait("Category", "Fast")]
public sealed class BasketTests : IClassFixture<CatalogFixture>
{
    private readonly PriceCatalog _catalog;
    private readonly Basket _basket;
    private readonly ITestOutputHelper _output;

    public BasketTests(CatalogFixture fixture, ITestOutputHelper output)
    {
        _catalog = fixture.Catalog;
        _basket = new Basket(_catalog);
        _output = output;
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void QuantitiesBelowOneAreRejected(int quantity) =>
        Assert.Throws<ArgumentOutOfRangeException>(() => _basket.Add("apple", quantity));
}
```

O construtor é o setup por teste porque cada teste recebe a própria instância,
como no MSTest. Um `TheoryData<string, decimal>` substituiu a fonte de tuplas e é
tipado em tempo de compilação. A listagem dos testes mostra os nomes das linhas:

```text
Shop.XTests.BasketTests.QuantitiesBelowOneAreRejected(quantity: 0)
Shop.XTests.BasketTests.QuantitiesBelowOneAreRejected(quantity: -1)
MSTest: QuantitiesBelowOneAreRejected (0)
```

O xUnit imprime o nome totalmente qualificado com os nomes dos parâmetros; o
MSTest imprime o nome do método e os valores.

### Ciclo de vida, provado por um log

Uma sonda registrou cada gancho de uma classe que implementa `IClassFixture`,
`IAsyncLifetime` e `IDisposable`, com uma fixture de coleção, e dois testes. O log
de uma execução:

```text
collection fixture: constructor
collection fixture: InitializeAsync
class fixture: constructor
class fixture: InitializeAsync
  test class: constructor
  test class: InitializeAsync
  test: First
  test class: DisposeAsync
  test class: constructor
  test class: InitializeAsync
  test: Second
  test class: DisposeAsync
class fixture: DisposeAsync
collection fixture: DisposeAsync
```

Três fatos para levar. A classe de teste é construída uma vez por teste (duas aqui).
A fixture de classe vive entre os testes da classe, e a fixture de coleção entre as
classes da coleção, e as duas são descartadas depois do último teste. E o
`Dispose` nunca foi registrado: com `DisposeAsync` presente na mesma classe, só o
`DisposeAsync` rodou, então implemente um dos dois. No xUnit v3, `InitializeAsync`
e `DisposeAsync` retornam `ValueTask`, não `Task`.

### Compartilhando entre classes: a coleção

O MSTest compartilhou um `ReportStore` de um só escritor por um campo estático e
manteve duas classes separadas com `[DoNotParallelize]`. No xUnit, a classe que
possui o recurso é uma fixture, e a coleção liga as classes a ela:

```csharp
public sealed class ReportStoreFixture { public ReportStore Store { get; } = new(); }

[CollectionDefinition("report-store")]
public sealed class ReportStoreCollection : ICollectionFixture<ReportStoreFixture>;

[Collection("report-store")]
public sealed class ReportTests(ReportStoreFixture fixture) { /* ... */ }

[Collection("report-store")]
public sealed class ArchiveTests(ReportStoreFixture fixture) { /* ... */ }
```

Cada teste de relatório segura o store por 100 ms, e o store lança exceção se dois
chamadores se sobrepõem. Com as duas classes numa coleção, os três testes rodaram
um depois do outro, numa thread:

```text
ReportTests.A          thread  4      0 ms ->   100 ms
ReportTests.Another    thread  4    101 ms ->   202 ms
ArchiveTests.Read      thread  4    204 ms ->   305 ms
```

Quando cada classe tinha o próprio `IClassFixture` e nenhuma coleção, as duas
classes se sobrepuseram (cada uma com o seu store) e a execução levou 202 ms. Nas
duas execuções, os dois testes dentro de `ReportTests` rodaram em sequência: a
unidade padrão de paralelismo no xUnit é a coleção, e uma classe sem atributo é
uma coleção própria. Choosing a Test Framework mediu os padrões e o `parallelMode`
na 4.x.

O que acontece quando o atributo é esquecido é diferente nos dois frameworks.
Remover o `[DoNotParallelize]` das classes MSTest falhou em tempo de execução, uma
corrida que depende de timing:

```text
System.InvalidOperationException: The report store is busy.
```

Remover o `[Collection]` no xUnit avisou em tempo de build e falhou todos os testes
das duas classes na execução:

```text
warning xUnit1041: Fixture argument 'fixture' does not have a fixture source (if it comes from a
  collection definition, ensure the definition is in the same assembly as the test)
warning xUnit1073: Collection definition 'report-store' is never used. Fix a misspelled collection name in a ...
Xunit.MicrosoftTestingPlatform.XunitException: The following constructor parameters did not have matching fixture data: ReportStoreFixture fixture
```

Esse é um ponto forte do modelo de fixtures: uma coleção esquecida não vira uma
corrida silenciosa, desde que o objeto compartilhado venha da fixture e não de um
campo estático.

### `Assert.Throws<T>` significa exato

A linha `Assert.Throws<ArgumentException>(...)` era a linha correta no MSTest para
`UnknownProductException`, que deriva de `ArgumentException`. Digitada igual no
xUnit, falha:

```text
Assert.Throws() Failure: Exception type was not an exact match
Expected: typeof(System.ArgumentException)
Actual:   typeof(Shop.UnknownProductException)
---- Shop.UnknownProductException : Unknown product 'plum'. (Parameter 'sku')
```

O `Assert.ThrowsAny<ArgumentException>` aceita a subclasse. A falha é barulhenta
aqui, mas o caminho inverso é silencioso: o `Throws<T>` do xUnit vira `Throws<T>`
no MSTest por renomeação, e então aceita subclasses, e o teste pode passar pelo
motivo errado. A regra do outro concept vale: porte para `ThrowsExactly`.

### Saída e o contexto do teste

O `ITestOutputHelper` é injetado pelo construtor. No modo MTP, seu texto apareceu
para o teste que falhou, sob `Standard output`, e não para o que passou, até usar
`--output Detailed`:

```text
failed Shop.XTests.Out.Fails (2ms)
  boom
  Standard output
    hello from a failing test
```

O `TestContext.WriteLine` do MSTest apareceu do mesmo jeito, sob `Standard output`
e `TestContext Messages:`, com `--output Detailed`. O contexto por teste é um
estático no xUnit v3: `TestContext.Current.CancellationToken` e
`TestContext.Current.Test?.TestDisplayName`, que imprimiu
`Shop.XTests.BasketTests.TheTestKnowsItsOwnNameAndItsCancellationToken` na
execução, o mesmo nome de exibição da listagem acima. O pacote de analyzers tem
uma regra que depende disso: `await Task.Delay(1)` num teste gerou `xUnit1051:
Calls to methods which accept CancellationToken should use
TestContext.Current.CancellationToken to allow test cancellation to be more
responsive`.

### Filtros, skips e códigos de saída

```bash
dotnet test --project tests/Shop.XTests --filter-trait "Category=Fast"
```

imprimiu `total: 11` e `skipped: 1`, a classe com suas linhas de theory e seu
único teste pulado. Um trait que não casou com nada (`Category=Slow`) terminou com
`Test run completed with non-success exit code: 8. No tests ran.`, o mesmo código
de saída que o MSTest e os outros frameworks devolvem para um filtro vazio. Um
teste que falhou deu código de saída 2 nos dois.

## Trade-offs

- **Setup no construtor vs atributos.** Menos atributos, e o setup é C# simples no
  construtor. O `[TestInitialize]` do MSTest é explícito e mais fácil de achar pelo
  nome quando a classe tem muitos membros.
- **Fixtures são um tipo por objeto compartilhado.** Mais arquivos, mas uma coleção
  esquecida quebra o build ou todos os testes da classe, em vez de virar corrida.
  Um campo estático compartilhado por `[DoNotParallelize]` é mais curto e falha por
  sorte.
- **Coleções serializam mais do que parece.** Toda classe numa coleção roda depois
  da outra. Três testes de 100 ms foram de 202 ms para 305 ms aqui. Coloque na
  coleção só as classes que de fato compartilham o recurso.
- **Mesmos nomes, significados diferentes.** O `Throws<T>` é exato no xUnit e
  permissivo no MSTest. Um port mecânico em qualquer direção muda o que o teste
  aceita.
- **Dois vocabulários no mesmo repositório custam.** Se a suíte já é MSTest, trocar
  por gosto é reescrever todo atributo, asserção e fixture; aprenda xUnit para
  trabalhar num repositório xUnit, e deixe o repositório decidir.

## Lab

A loja já está implementada, com uma suíte MSTest pronta ao lado de um projeto xUnit vazio. Sua tarefa é portar a suíte para o xUnit v3 e descobrir onde renomear não basta.

**O que você vai praticar**

- Mapear `[TestMethod]`, `[DataRow]`, `[DynamicData]`, `[Ignore]` e `[TestCategory]` para o xUnit.
- Transformar um `[ClassInitialize]` estático em um `IClassFixture<T>`.
- Compartilhar um recurso de um só escritor entre duas classes com uma fixture de coleção, e ler o que acontece sem ela.
- Trocar `Assert.ThrowsExactly` e `Assert.Throws` pelo par certo do xUnit, usar `ITestOutputHelper` e `TestContext.Current`.

**Pré-requisitos:** MSTest Fundamentals: Lifecycle and TestContext, Choosing a Test Framework: MSTest, xUnit, NUnit and TUnit, SDK .NET 10.

**Como funciona:** o projeto MSTest passa (13 testes e um pulado). No projeto xUnit, todo teste é um stub com uma asserção `TODO-NN` que falha e dicas, e o `dotnet test` roda os dois projetos pelo modo Microsoft.Testing.Platform escolhido no `global.json`.

## Documentation Links

- [Getting started with xUnit.net v3, xunit.net](https://xunit.net/docs/getting-started/v3/getting-started) (doc)
- [xUnit.net v3 and Microsoft.Testing.Platform, xunit.net](https://xunit.net/docs/getting-started/v3/microsoft-testing-platform) (doc)
- [Shared context between tests, xunit.net](https://xunit.net/docs/shared-context) (doc)
- [Running tests in parallel, xunit.net](https://xunit.net/docs/running-tests-in-parallel) (doc)
- [xUnit.net v3 4.0.0 release notes, xunit.net](https://xunit.net/releases/v3/4.0.0) (doc)
- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
