---
version: 1.0
updatedAt: 2026-10-29
title: "Escolhendo um Framework de Testes: MSTest, xUnit, NUnit e TUnit"
summary: Os mesmos oito testes em MSTest 4, xUnit v3 4.0, NUnit 5 e TUnit no .NET 10, com tabela de equivalência tirada do código que compilou, instâncias por teste e por classe, paralelismo padrão medido, mensagens de falha, filtros e exit codes no MTP e no VSTest, tempo com 2.000 testes, analyzers, uma migração de xUnit para MSTest e um guia de decisão.
---
## Objective

O .NET tem quatro frameworks de teste em uso real: MSTest, xUnit.net, NUnit e
TUnit. A escolha parece questão de nomes de atributos, mas o que custa caro está
em outro lugar: quantas instâncias da classe de teste existem, o que roda em
paralelo quando ninguém configurou nada, qual runner cada um exige, como uma
falha aparece e quais asserções mudam de comportamento com o mesmo nome. Esta
lição escreve os mesmos oito testes nos quatro, contra uma class library, e
compara rodando tudo no .NET 10 com MSTest 4.5.2, xunit.v3 4.0.2, NUnit 5.0.0
(NUnit3TestAdapter 6.3.1) e TUnit 1.76.45, as versões estáveis mais recentes no
NuGet em 2026-10-29. Termina com uma migração de xUnit para MSTest e um guia de
decisão, sem declarar vencedor.

## Use Cases

- Escolher o framework de uma solution nova com fatos que o time pode repetir.
- Mover uma suíte entre frameworks sabendo quais linhas mudam de significado.
- Explicar por que uma suíte ficou lenta ou instável depois da troca de framework.
- Escrever filtros de CI e checagens de exit code numa solution mista.

## Deep Dive

### Versões e runners

Cada projeto de teste é um executável do Microsoft.Testing.Platform (MTP), e o
`global.json` seleciona o modo MTP do `dotnet test`:

| Framework | Pacotes | MTP | VSTest no SDK 10 |
| --- | --- | --- | --- |
| MSTest 4.5.2 | `MSTest` | `EnableMSTestRunner` | `-p:EnableMSTestRunner=false` |
| xUnit.net v3 4.0.2 | `xunit.v3`, mais `xunit.runner.visualstudio` 4.0.1 para VSTest | embutido (MTP v2) | `-p:IsTestingPlatformApplication=false` |
| NUnit 5.0.0 | `NUnit`, `NUnit3TestAdapter` 6.3.1 | `EnableNUnitRunner` | `-p:EnableNUnitRunner=false` |
| TUnit 1.76.45 | `TUnit` | sempre | não suportado |

Com o MTP ligado, o modo VSTest do `dotnet test` no SDK 10 recusa os quatro
(`Testing with VSTest target is no longer supported by Microsoft.Testing.Platform
on .NET 10 SDK and later`). Com a propriedade da última coluna, MSTest, xUnit e
NUnit rodaram no VSTest; o build do TUnit então falha com `CS5001: Program does
not contain a static 'Main' method`. Pelas release notes, o xUnit 4.0 (2026-08)
removeu o MTP v1 e trouxe Native AOT e paralelização completa.

### Os mesmos oito testes

Teste simples, de exceção, dados inline (3 linhas), dados de membro (2 linhas),
setup e teardown, assíncrono, ignorado e com categoria: 11 casos, 10 aprovados e
1 ignorado em cada um. A tabela foi copiada dos quatro arquivos que compilaram:

| | MSTest | xUnit v3 | NUnit | TUnit |
| --- | --- | --- | --- | --- |
| Teste | `[TestMethod]` em `[TestClass]` | `[Fact]` | `[Test]` | `[Test]` |
| Dados inline | `[DataRow(1, 2, 3)]` | `[Theory]` + `[InlineData]` | `[TestCase(1, 2, 3)]` | `[Arguments(1, 2, 3)]` |
| Dados de membro | `[DynamicData(nameof(Cases))]` | `[MemberData]` + `TheoryData<int, int, int>` | `[TestCaseSource]` | `[MethodDataSource]` |
| Por teste | ctor ou `[TestInitialize]`, `[TestCleanup]` | ctor, `Dispose` | `[SetUp]`, `[TearDown]` | `[Before(Test)]`, `[After(Test)]` |
| Por classe | static `[ClassInitialize]`, `[ClassCleanup]` | `IClassFixture<T>` | `[OneTimeSetUp]`, `[OneTimeTearDown]` | static `[Before(Class)]`, `[After(Class)]` |
| Ignorar | `[Ignore("...")]` | `[Fact(Skip = "...")]` | `[Ignore("...")]` | `[Skip("...")]` |
| Categoria | `[TestCategory("Fast")]` | `[Trait("Category", "Fast")]` | `[Category("Fast")]` | `[Category("Fast")]` |
| Igualdade | `Assert.AreEqual(5, x)` | `Assert.Equal(5, x)` | `Assert.That(x, Is.EqualTo(5))` | `await Assert.That(x).IsEqualTo(5)` |
| Tipo exato da exceção | `Assert.ThrowsExactly<T>` | `Assert.Throws<T>` | `Assert.Throws<T>` | `.ThrowsExactly<T>()` |
| Aceita subclasse | `Assert.Throws<T>` | `Assert.ThrowsAny<T>` | `Assert.Catch<T>` | `.Throws<T>()` |

As linhas de exceção foram conferidas lançando `ArgumentNullException` onde o
teste espera `ArgumentException`: a segunda forma passou e a primeira falhou nos
quatro. `Throws<T>` é exato no xUnit e no NUnit e tolerante no MSTest e no TUnit.

### Ciclo de vida e isolamento

Cada classe grava num log a partir de um inicializador de campo (contador de
instâncias), do construtor e dos hooks. Para os 11 casos de uma classe:

```text
MSTest  class init, 10 x (ctor #n, setup on #n, teardown on #n, dispose #n), class cleanup
xUnit   class fixture ctor, 10 x (ctor = setup #n, dispose = teardown on #n), fixture dispose
NUnit   ctor #1, one-time setup, 10 x (setup on #1, teardown on #1), one-time teardown
TUnit   before class, ctor #1..#10 on 10 threads, before/after test, dispose, after class
```

MSTest, xUnit e TUnit criam uma instância por teste (10: o teste ignorado nunca
é construído). O NUnit cria uma por fixture, então um campo alterado por um
teste é visto pelo próximo; com `[assembly: Parallelizable(ParallelScope.All)]`
o log mostrou `setup on #1` vindo de 10 threads, todas escrevendo no mesmo campo
`_ledger`. `[FixtureLifeCycle(LifeCycle.InstancePerTestCase)]` gera 10
instâncias, e aí um `[OneTimeSetUp]` de instância derruba todos os testes, sem
aviso no build: `Only static OneTimeSetUp and OneTimeTearDown are allowed for
InstancePerTestCase mode.`

### Paralelismo padrão

Duas classes com quatro testes cada, todos com `Thread.Sleep(300)`; o intervalo
vai do primeiro início ao último fim no log (sem a inicialização):

| | Nada configurado | Classes em paralelo | Todos os testes em paralelo |
| --- | --- | --- | --- |
| MSTest | 2.45 s, 1 thread | 1.23 s: `[assembly: Parallelize(Workers = 0, Scope = ExecutionScope.ClassLevel)]` | 0.30 s: `Scope = ExecutionScope.MethodLevel` |
| xUnit | 1.23 s, 2 threads (uma por classe) | o padrão | 0.30 s: `"parallelMode": "all"` ou `--parallel all` (novo no 4.0) |
| NUnit | 2.44 s, 1 thread | 1.21 s: `[assembly: Parallelizable(ParallelScope.Fixtures)]` | 0.30 s: `ParallelScope.All` |
| TUnit | 0.30 s, 8 threads | | o padrão |

Para desligar: no xUnit, `"parallelizeTestCollections": false` ou `--parallel
none` deram 2.44 s, e no TUnit `[assembly: NotInParallel]` deu 2.43 s. Só o
padrão muda: no TUnit os testes se sobrepõem; do xUnit para MSTest ou NUnit, não.

### Estilo de asserção e mensagens de falha

A mesma checagem falhando, `Calculator.Add(2, 2)` com 5 esperado:

```text
MSTest  Assertion failed. Expected values to be equal.
        expected: 5
        actual:   4
        Assert.AreEqual(5, Calculator.Add(2, 2))
xUnit   Assert.Equal() Failure: Values differ
        Expected: 5
        Actual:   4
NUnit   Assert.That(Calculator.Add(2, 2), Is.EqualTo(5))
        Expected: 5
        But was:  4
TUnit   AssertionException: Expected to be 5
        but found 4
        at Assert.That(Calculator.Add(2, 2)).IsEqualTo(5)
```

MSTest, NUnit e TUnit citam a expressão do código. As asserções do TUnit são
aguardáveis, então todo teste que afirma é `async Task`, e esquecer o `await` é
erro de build dos analyzers do pacote TUnit: `error TUnitAssertions0002: Assert
statements must be awaited - all TUnit assertions return Task`.

### Filtros e exit codes

O único teste da categoria `Fast`, pelo `dotnet test` em modo MTP; cada execução
reportou `total: 1`:

```bash
dotnet test --project tests/MsTests --filter "TestCategory=Fast"
dotnet test --project tests/NTests  --filter "TestCategory=Fast"   # "Category=Fast" também funciona
dotnet test --project tests/XTests  --filter-trait "Category=Fast"
dotnet test --project tests/TTests  --treenode-filter "/*/*/*/*[Category=Fast]"
```

O xunit.v3 4.0.2 também aceitou `--filter "Category=Fast"`: o `--help` dele lista
um `--filter` com a sintaxe do VSTest, ao lado de `--filter-query`. O TUnit
rejeita `--filter` (`Unknown option '--filter'`, exit code 5), e o xUnit rejeita
`--treenode-filter` do mesmo jeito. No MTP os quatro retornam 2 quando um teste
falha e 8 quando o filtro não acha nada. No VSTest, `--filter` funcionou no
MSTest e no NUnit (`TestCategory=Fast`) e no xUnit (`Category=Fast`); sem
match, MSTest e NUnit imprimiram `No test matches the given testcase filter` e
saíram com 0.

### Tempo com 2.000 testes

Um projeto por framework, 20 classes com 100 testes triviais, Release,
configuração padrão, mediana de 3 execuções num notebook Apple M4 Max (14
núcleos). `dotnet test --no-build` levou cerca de 0.5 s no MSTest, 0.65 s no
NUnit e 0.7 s no xUnit e no TUnit; o executável sozinho levou cerca de 0.25 s a
0.4 s, e cerca de 0.2 s a 0.25 s com um único teste: quase tudo é inicialização.
A documentação do TUnit publica benchmarks em que ele é mais rápido; com testes
triviais aqui a diferença não apareceu.

### Analyzers

O mesmo erro, uma constante passada como valor real, foi pego pelos quatro:

```text
MSTEST0017: Assertion arguments should be passed in the correct order. 'actual' and 'expected'/'notExpected' arguments have been swapped.
xUnit2000: The literal or constant value 4 should be passed as the 'expected' argument in the call to 'Assert.Equal(expected, actual)'
NUnit2007: The actual value should not be a constant - perhaps the actual value and the expected value have switched places
TUnitAssertions0005: Assert.That(...) should not be used with a constant value
```

MSTest.Analyzers 4.5.2 e xunit.analyzers 2.2.0 vêm com o pacote do framework,
NUnit.Analyzers 4.15.0 é uma referência à parte, e os do TUnit vêm no TUnit.Core
1.76.45 (o pacote avulso `TUnit.Analyzers` parou na 0.1.984).

### Migrando de xUnit para MSTest

Três testes, antes (xUnit) e depois (MSTest); as duas versões passaram:

```csharp
// antes
public static TheoryData<int, int, int> Cases => new() { { 2, 2, 4 }, { 10, -3, 7 } };
[Fact] public void Divide_ByZero_Throws() =>
    Assert.Throws<DivideByZeroException>(() => Calculator.Divide(1, 0));
[Theory, MemberData(nameof(Cases))] public void Add_FromMember(int a, int b, int expected) =>
    Assert.Equal(expected, Calculator.Add(a, b));
[Fact] public void Balance_SumsEntries() { _ledger.Record(5); _ledger.Record(-2); Assert.Equal(3, _ledger.Balance); }

// depois: a classe ganha [TestClass]; o campo _ledger e o Dispose ficam como estão
public static IEnumerable<(int, int, int)> Cases => [(2, 2, 4), (10, -3, 7)];
[TestMethod] public void Divide_ByZero_Throws() =>
    Assert.ThrowsExactly<DivideByZeroException>(() => Calculator.Divide(1, 0));
[TestMethod, DynamicData(nameof(Cases))] public void Add_FromMember(int a, int b, int expected) =>
    Assert.AreEqual(expected, Calculator.Add(a, b));
[TestMethod] public void Balance_SumsEntries() { _ledger.Record(5); _ledger.Record(-2); Assert.AreEqual(3, _ledger.Balance); }
```

O que não tem correspondência direta:

- **Construtor e `IDisposable`** continuam valendo (o MSTest chamou `Dispose`
  depois do `[TestCleanup]`); `IAsyncLifetime` vira um `[TestInitialize]` async.
- **`Assert.Throws<T>`** precisa virar `Assert.ThrowsExactly<T>`; renomear sem
  pensar passa a aceitar subclasses em silêncio. `TheoryData<...>` vira tuplas.
- **Fixtures**: `IClassFixture<T>` vira `[ClassInitialize]` static; o MSTest não
  tem test collections, então uma collection fixture vira `[AssemblyInitialize]`
  mais `[DoNotParallelize]` nas classes envolvidas.
- **Paralelismo**: a suíte roda em série até alguém adicionar `[Parallelize]`.

### Guia de decisão

| Situação | O que as execuções e a documentação dizem |
| --- | --- |
| Time já usa um framework | Os quatro rodaram os oito testes, alcançaram todos os níveis de paralelismo e devolveram os mesmos exit codes no MTP; trocar custa as armadilhas acima, então precisa de um motivo das linhas abaixo |
| Quer paralelismo por padrão | TUnit (todos os testes), xUnit (classes; `parallelMode: all` desde o 4.0); MSTest e NUnit rodam em série até serem configurados |
| Precisa de Native AOT (não publicado aqui) | A documentação: MSTest suporta com recursos limitados; xUnit 4.0+ pelos pacotes `*.aot` (C#, .NET 9+); TUnit pelo modo padrão de source generation; nenhuma página do NUnit encontrada |
| Muitos testes orientados a dados | Os quatro têm fontes inline e de membro; `TheoryData<>` e as fontes de tuplas do MSTest e do TUnit são tipadas |
| Precisa manter o VSTest (outros adapters, ferramentas antigas) | MSTest, xUnit, NUnit; o TUnit não |
| Suporte em IDE | A documentação: Visual Studio, VS Code e Rider para MSTest (Microsoft) e xUnit (xunit.net); o TUnit lista os três, cada um atrás de uma opção de MTP a ser ligada |

## Trade-offs

- **Instância por teste vs por fixture.** Por teste (MSTest, xUnit, TUnit) deixa
  os campos seguros e custa um construtor por teste; a fixture do NUnit
  reaproveita estado criado uma vez e torna todo campo compartilhado.
- **Paralelo por padrão.** O TUnit revela acoplamento entre testes como falhas
  que parecem aleatórias; MSTest e NUnit ficam em série, e lentos, até alguém optar.
- **Mesmos nomes, semânticas diferentes.** `Assert.Throws<T>` e `--filter`
  variam por framework; renomear mecanicamente não é migrar.

## Documentation Links

- [Testing in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/) (doc)
- [Microsoft.Testing.Platform overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-intro) (doc)
- [Getting started with xUnit.net v3, xunit.net](https://xunit.net/docs/getting-started/v3/getting-started) (doc)
- [xUnit.net v3 4.0.0 release notes, xunit.net](https://xunit.net/releases/v3/4.0.0) (doc)
- [NUnit framework release notes, docs.nunit.org](https://docs.nunit.org/articles/nunit/release-notes/framework.html) (doc)
- [TUnit introduction, tunit.dev](https://tunit.dev/docs/intro/) (doc)
