---
version: 1.0
updatedAt: 2026-10-18
title: "Testes data-driven no MSTest: DataRow, DynamicData e fontes customizadas"
summary: Linhas nas bordas e não no meio, o que cabe num DataRow (e por que decimal não cabe), DynamicData com TestDataRow, um ITestDataSource customizado, CombinatorialData e nomes que mudam a cada execução, no MSTest 4.
---
## Objective

Uma tabela de preços, uma regra de validação ou um parser é uma função com
muitas entradas e poucas interessantes. Um teste data-driven escreve a checagem
uma vez e a alimenta com linhas, e o MSTest reporta cada linha como um teste
próprio. A parte difícil não são os atributos: é escolher linhas que pegariam um
bug (as bordas, não o meio), manter cada linha honesta sobre o motivo pelo qual
passa, e não deixar o número de linhas explodir. O objetivo é conhecer cada
fonte de dados que o MSTest 4 oferece (`[DataRow]`, `[DynamicData]`,
`TestDataRow<T>`, um `ITestDataSource` customizado, `[CombinatorialData]`), o que
cada uma consegue ou não carregar, e como escolher linhas que façam a suíte
falhar quando a regra quebra.

## Use Cases

- Fixar uma tabela de preços, taxas ou limites dos dois lados de cada borda.
- Testar validação de entrada com um teste e uma linha por valor inválido, cada
  uma com nome no relatório.
- Dividir um conjunto de casos entre várias classes de teste.
- Gerar linhas a partir de uma definição (cada faixa, cada valor de enum) para
  que uma entrada nova seja testada sem um teste novo.
- Trocar um `foreach` dentro de um teste, que para na primeira falha, por linhas
  que são todas reportadas.

## Deep Dive

### DataRow: o que cabe num atributo

O `[DataRow]` coloca os valores no próprio atributo. A quantidade e os tipos dos
argumentos precisam bater com os parâmetros, e cada linha roda o ciclo de vida
inteiro do teste (uma nova instância, `[TestInitialize]`, o teste,
`[TestCleanup]`):

```csharp
[TestMethod]
[DataRow(0, DisplayName = "zero grams")]
[DataRow(-1, DisplayName = "a negative weight")]
[DataRow(30_001, DisplayName = "one gram over the limit")]
[DataRow(int.MaxValue)]
public void AWeightOutsideTheLimitsIsRejected(int grams)
{
    var error = Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ShippingCalculator.Quote(grams, Zone.Domestic));

    Assert.AreEqual("weightGrams", error.ParamName);
}
```

Uma linha sem `DisplayName` recebe o nome dos seus valores, como em
`AWeightOutsideTheLimitsIsRejected (2147483647)`. Os argumentos de atributo são
limitados pelo C#, não pelo MSTest: constantes, `typeof`, enums e arrays de uma
dimensão. Isso cobre mais do que parece:

```csharp
[DataRow(null)]                       // um parâmetro string?
[DataRow((Zone)99)]                   // um valor de enum, até um não definido
[DataRow(new[] { 500, 0 })]           // um parâmetro int[]
[DataRow(1_450, 500, 1_500)]          // (int expectedCents, params int[] parcelGrams)
[DataRow(2, IgnoreMessage = "bug #123")] // esta linha é reportada como skipped
```

O `decimal` é a lacuna, e dinheiro costuma ser `decimal`: a especificação do C#
não o lista entre os tipos de parâmetro de atributo. `[DataRow(1_000, 5.00)]`
passa um `double`. O build avisa (MSTEST0014, "DataRow should be valid": o
argumento é um `double` onde o parâmetro é um `decimal`), e a linha falha em
tempo de execução com "Test data doesn't match method parameters", porque o
MSTest não faz a conversão. Uma string como `"5.00"` falha do mesmo jeito. Ou
você carrega o valor como `int` em centavos (como acima), ou leva as linhas para
um `[DynamicData]`.

### As bordas, não o meio

Este teste passa, e parece caprichado:

```csharp
// Quebrado: um teste, quatro valores, todos no meio de uma faixa.
foreach (var (grams, expected) in new[] { (500, 5.00m), (3_000, 9.50m), (12_000, 18.00m), (25_000, 32.00m) })
{
    Assert.AreEqual(expected, ShippingCalculator.Quote(grams, Zone.Domestic));
}
```

Ele tem dois problemas. Trocar `weightGrams <= band.UpToGrams` por `<` na busca
da faixa, o clássico erro de um a mais ou a menos, o deixa verde, porque nenhum
valor está numa borda. E quando um valor está errado, o primeiro `Assert` que
falha encerra o teste: trocar o preço de duas faixas produziu uma mensagem
(`expected: 9.50, actual: 18.000`), e o segundo valor errado nunca apareceu. A
análise de valor limite diz onde olhar: o último valor dentro de cada faixa e o
primeiro fora dela, mais a menor e a maior entrada válidas. As faixas de peso
terminam em 1, 5, 20 e 30 kg, o que dá estas linhas:

```csharp
public static IEnumerable<(int Grams, decimal Expected)> BandEdges =>
[
    (1, 5.00m),
    (1_000, 5.00m),
    (1_001, 9.50m),
    (5_000, 9.50m),
    (5_001, 18.00m),
    (20_000, 18.00m),
    (20_001, 32.00m),
    (30_000, 32.00m),
];

[TestMethod]
[DynamicData(nameof(BandEdges))]
public void ADomesticParcelIsPricedByItsWeightBand(int grams, decimal expected) =>
    Assert.AreEqual(expected, ShippingCalculator.Quote(grams, Zone.Domestic));
```

Com `<` no lugar de `<=`, quatro dessas linhas falham, cada uma com o nome do seu
peso. O lado inválido das bordas (0 g, 30 001 g) fica no teste de validação
acima.

### DynamicData: propriedades, métodos, campos e outras classes

O `[DynamicData]` lê as linhas de um membro `public static` que devolve um
`IEnumerable` de tuplas, de `TestDataRow<T>` ou de `object[]`. Desde o MSTest 3.8
ele detecta se o membro é uma propriedade, um método ou (3.11+) um campo. O
`DynamicDataSourceType` ainda compila, mas o analyzer MSTEST0052 manda removê-lo.
Uma fonte em outra classe recebe o tipo como segundo argumento, e é assim que
várias classes de teste dividem um conjunto de casos:

```csharp
[TestMethod]
[DynamicData(nameof(ShippingCases.Thresholds), typeof(ShippingCases))]
public void FreeShippingStartsAtTheThresholdForDomesticOrdersOnly(decimal orderTotal, Zone zone, decimal expected) =>
    Assert.AreEqual(expected, ShippingCalculator.Quote(500, zone, orderTotal));
```

A documentação recomenda value tuples para linhas simples (tipos conferidos na
compilação, cada elemento vira um parâmetro) e desaconselha `object[]`, em que
um tipo errado só aparece na execução. As fontes de dados são avaliadas durante
a descoberta, antes de `[AssemblyInitialize]` ou `[ClassInitialize]` rodarem,
então uma fonte não pode depender de estado que esses hooks criam.

### Tuplas, records e TestDataRow<T>

Uma tupla se espalha nos parâmetros. Um record chega como um parâmetro só, e a
linha recebe o nome do seu `ToString()`, como em `RecordSource (Case { In = 1,
Out = 2 })`: legível para records pequenos, poluído para os grandes. Quando uma
linha precisa de um nome próprio, embrulhe-a num `TestDataRow<T>` (MSTest 3.8+),
que também carrega `TestCategories` e um `IgnoreMessage` por linha:

```csharp
public static class ShippingCases
{
    public static IEnumerable<TestDataRow<(decimal OrderTotal, Zone Zone, decimal Expected)>> Thresholds =>
    [
        new((99.99m, Zone.Domestic, 5.00m)) { DisplayName = "one cent below the threshold pays" },
        new((100.00m, Zone.Domestic, 0m)) { DisplayName = "exactly the threshold ships free" },
        new((100.00m, Zone.Neighbor, 7.50m)) { DisplayName = "the threshold does not apply to neighbors" },
        new((250.00m, Zone.International, 12.50m)) { DisplayName = "nor to international orders" },
    ];
}
```

O relatório então diz "exactly the threshold ships free" em vez de
`(100,00, Domestic, 0)`, e uma falha se explica sozinha. O
`DynamicDataDisplayName` (um método static que monta o nome a partir da linha) é
a forma mais antiga de fazer o mesmo; o concept Testing Clean Architecture o usa.

### Um ITestDataSource customizado

Quando as linhas vêm de uma definição, um atributo que implementa
`ITestDataSource` as gera. Este lê a tabela de faixas do código sob teste e
devolve uma linha por borda e zona:

```csharp
[AttributeUsage(AttributeTargets.Method)]
public sealed class BandEdgesAttribute : Attribute, ITestDataSource
{
    public IEnumerable<object?[]> GetData(MethodInfo methodInfo) =>
        from band in ShippingCalculator.Bands
        where band.UpToGrams < ShippingCalculator.MaxWeightGrams
        from zone in Enum.GetValues<Zone>()
        select new object?[] { band.UpToGrams, zone };

    public string? GetDisplayName(MethodInfo methodInfo, object?[]? data) =>
        data is null ? null : $"{data[0]} g to {(int)data[0]! + 1} g, {data[1]}";
}

[TestMethod]
[BandEdges]
public void OneGramPastABandEdgeCostsMore(int lastGramOfBand, Zone zone) =>
    Assert.IsGreaterThan(
        ShippingCalculator.Quote(lastGramOfBand, zone),
        ShippingCalculator.Quote(lastGramOfBand + 1, zone));
```

Uma faixa nova ganha suas linhas sem um teste novo. A armadilha é tirar os
preços esperados da mesma tabela: um teste que pergunta ao código sob teste qual
é a sua própria expectativa concorda com qualquer bug dele. Tire da definição só
as entradas, e confira uma propriedade que não dependa dela (aqui, um grama a
mais nunca custa menos). Repare na ordem de `Assert.IsGreaterThan(lowerBound,
value)`: o limite vem primeiro.

### Confira qual regra disparou

Testes de validação têm o seu próprio jeito de passar pelo motivo errado. Toda
checagem de `Quote` lança `ArgumentOutOfRangeException`, e elas rodam em ordem:

```csharp
// Quebrado: o peso 0 é rejeitado primeiro. Verde mesmo com a checagem do total apagada.
Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => ShippingCalculator.Quote(0, Zone.Domestic, -1m));

// Corrigido: só o total é inválido, e o ParamName diz qual checagem disparou.
var error = Assert.ThrowsExactly<ArgumentOutOfRangeException>(
    () => ShippingCalculator.Quote(500, Zone.Domestic, orderTotal: -0.01m));
Assert.AreEqual("orderTotal", error.ParamName);
```

Um valor inválido por linha, todo o resto válido, e uma assertion sobre o que
identifica a regra (`ParamName`, um código de erro, a chave da mensagem).

### Explosão combinatória

As linhas se multiplicam. Três zonas vezes oito pesos vezes três totais vezes
quatro códigos promocionais dão 288 casos, e a maioria testa a mesma coisa. O
MSTest 4.4 trouxe o `[CombinatorialData]`, que gera o produto cartesiano: ele
infere todos os valores de um enum (e `true`/`false` para um `bool`), e recebe
valores explícitos para o resto:

```csharp
using Microsoft.VisualStudio.TestTools.UnitTesting.Combinatorial;

[TestMethod]
[CombinatorialData]
public void EveryValidParcelPaysSomethingBelowTheThreshold(
    Zone zone,
    [CombinatorialValues(1, 1_000, 1_001, 30_000)] int grams) =>
    Assert.IsPositive(ShippingCalculator.Quote(grams, zone));
```

São 3 x 4 = 12 casos. A documentação deixa claro que ele só é exaustivo: não
gera pares (pairwise) nem aceita exclusões entre valores. Use-o para uma
propriedade que precisa valer em todo lugar, mantenha cada parâmetro nos valores
que importam, e teste as interações que importam (frete grátis só para pedidos
nacionais) como linhas explícitas. Antes da 4.4, o pacote da comunidade
Combinatorial.MSTest cobria essa lacuna.

### Dados não determinísticos quebram os nomes

O nome de uma linha vem dos seus valores, e o `dotnet test --list-tests` avalia a
fonte. Uma fonte com `Guid.NewGuid()` ou `DateTime.Now` produziu nomes
diferentes a cada listagem:

```text
NonDeterministic (fa4aa7e0-2358-4a8d-979a-a5846d42a067,18/10/2026 23:12:08)
NonDeterministic (3e1343f3-04b0-4e21-ae9e-cbc826a92c4f,18/10/2026 23:12:09)
```

Um teste cujo nome muda não pode ser rodado de novo pelo nome, filtrado, nem
acompanhado entre execuções no Test Explorer ou no histórico do CI. Deixe os
dados fixos (um `Guid` constante, um `FakeTimeProvider` com um instante conhecido)
e gere o que for aleatório dentro do teste. Quando uma fonte não tem como ser
estável, a documentação recomenda
`[TestMethod(UnfoldingStrategy = TestDataSourceUnfoldingStrategy.Fold)]`, que
reporta todas as linhas sob um único nó de teste.

### DataSource no MSTest 4

O `[DataSource]` (linhas de CSV, XML ou de um banco por connection string) é só
para .NET Framework, segundo a documentação de testes data-driven. No .NET 10 com
MSTest 4.5.1 um teste com `[DataSource]` ainda compila, e a execução o reporta
como skipped: ele nunca roda. Para manter casos num arquivo, leia o arquivo num
método de `[DynamicData]`, que mantém as linhas tipadas.

### Os testes protegem as regras?

Quebre o código de produção de propósito, uma mudança por vez, e veja o que fica
vermelho. Estes são os resultados para a solução do lab (53 testes de 13
métodos):

| Mudança no código de produção | Testes que falham |
| --- | --- |
| A busca da faixa usa `<` em vez de `<=` | 4 linhas de borda, as 9 linhas de `[BandEdges]`, 3 linhas combinatórias |
| O frete grátis usa `>` em vez de `>=` | "exactly the threshold ships free" |
| O código promocional diferencia maiúsculas | "the code is case-insensitive", "surrounding spaces are ignored" |
| Os preços de duas faixas trocados | 4 linhas de borda, 3 linhas de `[BandEdges]`, 2 linhas de volumes |
| A checagem de peso máximo apagada | "one gram over the limit", a linha de `int.MaxValue`, uma linha de volumes |
| Frete grátis aplicado a todas as zonas | o teste do código no exterior e duas linhas de limite |
| A checagem do total apagada | `ANegativeOrderTotalIsRejected` (a versão quebrada acima continua verde) |

O loop no meio das faixas sobrevive à primeira linha desta tabela. As linhas nas
bordas não.

## Trade-offs

- **DataRow é o mais legível, e o mais limitado.** Os dados ficam ao lado do
  teste, mas só constantes cabem, então `decimal`, `DateTime` e objetos pedem
  `[DynamicData]` ou um valor em centavos.
- **Linhas escondem duplicação; linhas demais escondem a intenção.** Oito linhas
  de borda são uma especificação. Oitenta linhas que não diferem em nada que a
  regra considere são ruído que deixa a suíte e a leitura mais lentas. Cada linha
  deveria estar ali por um motivo que você saberia dizer.
- **Linhas com nome custam uma linha cada.** Um `TestDataRow<T>` com
  `DisplayName` faz a falha se explicar, o que compensa em regras de negócio e é
  exagero numa lista de entradas inválidas que os próprios valores já descrevem.
- **Linhas geradas acompanham o código; expectativas geradas acompanham os bugs
  dele.** Uma fonte customizada que lê uma tabela mantém os testes completos
  conforme a tabela cresce, desde que a assertion não leia a mesma tabela.
- **Cobertura combinatória é exaustiva, não esperta.** Ela acha uma combinação em
  que ninguém pensou, ao preço de muitos casos. Linhas explícitas para as
  interações que importam são mais baratas e mais claras.
  ```csharp
  [CombinatorialValues(1, 1_000, 1_001, 30_000)] int grams // as bordas, não todo peso
  ```
- **Um teste com loop é mais rápido de escrever.** Ele também para na primeira
  falha e dá o mesmo nome a todos os casos. Prefira linhas, a não ser que os casos
  sejam passos de um mesmo cenário e não exemplos independentes.
- **A ideia é a mesma em todo framework.** O xUnit tem `[InlineData]`,
  `[MemberData]` e, na v3, `TheoryDataRow<T>`; o JUnit tem testes
  parametrizados. O concept Java sobre fixtures e testes parametrizados cobre a
  teoria.

## Lab

Uma calculadora de frete já está implementada: faixas de peso, três zonas, frete nacional grátis a partir de 100.00 ou com um código promocional, e pedidos com vários volumes. Sua tarefa é escrever testes MSTest data-driven que provam as regras dela, e descobrir onde se escondem os bugs de uma tabela de preços.

**O que você vai praticar**

- Trocar um loop sobre valores no meio das faixas por linhas dos dois lados de cada borda.
- `[DataRow]` com display names, `null`, enums, arrays e `params`, e o que fazer com `decimal`.
- `[DynamicData]` vindo de outra classe, com nomes via `TestDataRow<T>`.
- Um `ITestDataSource` customizado que gera as bordas a partir da tabela de faixas, e um teste que confere uma propriedade em vez de um preço.

**Pré-requisitos:** MSTest 4 Fundamentals (o concept e o lab), .NET 10 SDK.

**Como funciona:** cada método de teste já está declarado com uma dica e falha com uma mensagem `TODO-NN` até você escrevê-lo. Um teste já passa, e continua passando com um bug real na busca da faixa: o primeiro TODO pede para você provar isso e depois corrigi-lo. Os TODOs opcionais acrescentam `[CombinatorialData]` e uma checagem por mutação.

## Documentation Links

- [Data-driven testing in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
- [MSTEST0014: DataRow should be valid, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/mstest-analyzers/mstest0014) (doc)
- [MSTEST0052: Avoid passing an explicit DynamicDataSourceType and use the default auto detect behavior, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/mstest-analyzers/mstest0052) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [MSTest migration from v3 to v4, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-migration-v3-v4) (doc)
- [Attributes (C# language specification), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/language-specification/attributes) (doc)
