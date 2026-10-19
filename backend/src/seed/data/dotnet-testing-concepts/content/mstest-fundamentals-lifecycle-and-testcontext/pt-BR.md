---
version: 1.0
updatedAt: 2026-10-18
title: "Fundamentos do MSTest 4: ciclo de vida, TestContext e paralelismo"
summary: Uma instância por teste, a ordem exata dos hooks provada por um teste, TestContext pelo construtor, Throws contra ThrowsExactly, e o que estado static faz com testes em paralelo, no MSTest 4 com .NET 10.
---
## Objective

O MSTest parece simples: uma classe com `[TestClass]`, métodos com
`[TestMethod]` e chamadas a `Assert`. A maioria das surpresas vem do que o
framework faz em volta desses métodos: ele cria uma nova instância da classe para
cada teste, roda uma sequência fixa de hooks, entrega a cada teste um
`TestContext` e, quando o assembly opta por isso, roda testes de várias classes
ao mesmo tempo. O objetivo é conhecer essa engrenagem bem o bastante para
prevê-la: qual hook roda quando, onde o estado de cada teste deve morar, qual
assertion diz exatamente o que você quer dizer, e por que um campo `static`
transforma uma suíte verde numa suíte instável. Tudo aqui mira o MSTest 4 no
.NET 10.

## Use Cases

- Escolher onde fica uma fixture: um campo `readonly` definido no construtor, um
  `[TestInitialize]` assíncrono, ou um recurso `static` criado uma vez no
  `[ClassInitialize]`.
- Escrever testes de exceção que falham quando o código lança a coisa errada, e
  não só quando não lança nada.
- Ligar a execução em paralelo numa suíte existente e achar os testes que
  dividem estado.
- Atualizar um projeto do MSTest 3 sabendo quais APIs sumiram.
- Ler uma suíte em xUnit ou migrá-la para o MSTest: o isolamento funciona igual,
  o setup compartilhado não.

## Deep Dive

### O projeto, e o que o MSTest 4 removeu

Um projeto de teste é uma referência de pacote. `MSTest` é um metapacote: o
framework, o adapter que o `dotnet test` usa para achar os testes, o test SDK e
os analyzers. A versão estável atual no NuGet é a 4.5.1:

```xml
<ItemGroup>
  <PackageReference Include="MSTest" Version="4.5.1" />
</ItemGroup>
<ItemGroup>
  <Using Include="Microsoft.VisualStudio.TestTools.UnitTesting" />
</ItemGroup>
```

O MSTest 4 não é compatível em binário com o MSTest 3, e o guia de migração
lista as mudanças que quebram a compilação. As que atingem código de teste
comum:

| Removido no MSTest 4 | Use no lugar |
| --- | --- |
| `[ExpectedException]` | `Assert.Throws` / `Assert.ThrowsExactly` (e as versões `Async`) |
| `Assert.ThrowsException` | `Assert.ThrowsExactly` |
| `ClassCleanupBehavior` (cleanup no fim do assembly) | `[ClassCleanup]` agora sempre roda no fim da sua classe; cleanup do assembly inteiro vai em `[AssemblyCleanup]` |
| `TestTimeout.Infinite` | `[Timeout(int.MaxValue)]` |
| `TestContext.ManagedType` | `TestContext.FullyQualifiedTestClassName` |
| Overloads de `Assert` com `message` mais `object[]` | uma `message` interpolada |
| `Assert.IsInstanceOfType<T>(x, out var t)` | `var t = Assert.IsInstanceOfType<T>(x)` |

A versão mínima do .NET agora é o .NET 8 (o .NET Framework 4.6.2 continua
suportado), e ler `TestContext.TestName` dentro de `[ClassInitialize]` ou
`[AssemblyInitialize]` agora lança exceção em vez de devolver nada.

### Uma instância por teste

O MSTest cria uma nova instância da classe de teste para cada método de teste, e
para cada linha de dados de um teste data-driven. Um campo de instância é,
portanto, privado de um teste. Um teste que espera que um campo guarde o que um
teste anterior colocou ali falha, e isso é o framework protegendo você:

```csharp
[TestClass]
public sealed class InventoryTests
{
    private readonly Inventory _inventory = new(); // um estoque novo para cada teste

    public InventoryTests() => _inventory.Restock("apple", 10, 0.50m);

    [TestMethod]
    public void ReservingTakesUnitsOutOfStock()
    {
        _inventory.Reserve("apple", 4);

        Assert.AreEqual(6, _inventory.Available("apple"));
    }
}
```

Um construtor pode atribuir campos `readonly`, e é por isso que o guia de ciclo
de vida da Microsoft o prefere. `[TestInitialize]` é o outro lugar para setup por
teste: roda depois do construtor e pode ser `async` e levar `[Timeout]`, o que um
construtor não pode. Há mais uma diferença que importa quando o setup falha: se
o construtor lança, não existe instância, então `[TestCleanup]` e `Dispose` não
rodam; se o `[TestInitialize]` lança, eles rodam mesmo assim. Os analyzers
MSTEST0019 e MSTEST0020 podem impor um estilo por projeto.

O xUnit faz a mesma promessa (uma nova instância por teste, setup no construtor,
limpeza no `Dispose`), então o hábito vale nos dois. O que muda é o setup
compartilhado: o MSTest usa métodos static `[ClassInitialize]` e
`[AssemblyInitialize]`, o xUnit injeta um `IClassFixture<T>` ou, na v3, uma
assembly fixture.

### O ciclo de vida, provado por um teste

Esta é a sequência inteira para um teste, numa classe que escreve cada hook num
log. O teste confere o que rodou antes dele, e o `[AssemblyCleanup]`, o último
hook, confere tudo:

```csharp
[TestClass]
public sealed class LifecycleOrderTests : IDisposable
{
    private static readonly List<string> Log = [];
    private readonly TestContext _testContext;

    public LifecycleOrderTests(TestContext testContext)
    {
        _testContext = testContext;
        Log.Add("Constructor");
    }

    [AssemblyInitialize]
    public static void AssemblyInitialize(TestContext context) => Log.Add("AssemblyInitialize");

    [ClassInitialize]
    public static void ClassInitialize(TestContext context) => Log.Add("ClassInitialize");

    [TestInitialize]
    public void TestInitialize() => Log.Add("TestInitialize");

    [TestMethod]
    public void TheTestRunsAfterEverySetupStep()
    {
        Log.Add("Test");
        Assert.AreSequenceEqual(ExpectedOrder[..5], Log);
    }

    [TestCleanup]
    public void TestCleanup() => Log.Add("TestCleanup");

    public void Dispose() => Log.Add("Dispose");

    [ClassCleanup]
    public static void ClassCleanup() => Log.Add("ClassCleanup");

    [AssemblyCleanup]
    public static void AssemblyCleanup()
    {
        Log.Add("AssemblyCleanup");
        if (!Log.Contains("Test")) return; // um filtro deixou esta classe de fora
        Assert.AreSequenceEqual(ExpectedOrder, Log);
    }
}
```

A ordem que essa execução produz é `AssemblyInitialize > ClassInitialize >
Constructor > TestInitialize > Test > TestCleanup > Dispose > ClassCleanup >
AssemblyCleanup`. Trocar `Dispose` e `ClassCleanup` de lugar em `ExpectedOrder`
deixa a execução vermelha: uma falha no `[AssemblyCleanup]` aparece como um
resultado com falha a mais. No `dotnet test` com VSTest esse resultado leva o
nome do teste que terminou por último, então leia a mensagem, não o nome.

Rodar o teste revelou mais dois fatos. Os hooks de assembly rodam mesmo quando um
`--filter` exclui a classe que os declara, e é por isso que o cleanup retorna
cedo quando o teste da classe não rodou. E as assinaturas são rígidas: hooks de
assembly e de classe são `public static`, os dois initializers recebem um
`TestContext`, e os cleanups podem receber um ou nenhum.

### TestContext pelo construtor

O MSTest passa o `TestContext` do teste em execução para um construtor que o
pede. Essa é a forma recomendada: ele está disponível no construtor, pode morar
num campo `readonly` e nunca é null. Três membros fazem a maior parte do
trabalho:

```csharp
[TestMethod]
public async Task AnApprovedPaymentProducesAReceiptAndEmptiesTheCart()
{
    var payments = new ApprovingGateway();
    _cart.Add("apple", 3);

    var receipt = await _cart.CheckoutAsync(payments, _testContext.CancellationToken);
    _testContext.WriteLine($"{_testContext.TestName}: {receipt}");

    Assert.AreEqual(1.50m, receipt.Total);
    Assert.AreEqual(1.50m, Assert.ContainsSingle(payments.Charged));
}
```

O `CancellationToken` é sinalizado quando o teste estoura o tempo ou a execução é
abortada. Passá-lo para o código sob teste, em vez de `CancellationToken.None`,
deixa esse código parar; o analyzer MSTEST0049 aponta chamadas que poderiam
recebê-lo. `WriteLine` anexa texto ao resultado do teste (rode `dotnet test
--logger "console;verbosity=detailed"` para vê-lo), e `TestName` é o nome do
método.

### Throws, ThrowsExactly, e o motivo pelo qual um teste passa

`Assert.ThrowsExactly<T>` só passa para `T`. `Assert.Throws<T>` também passa para
qualquer tipo derivado de `T`. Os dois devolvem a exceção, então o teste pode
conferir as propriedades dela. A diferença decide se um teste pode passar pelo
motivo errado. No lab, `UnknownProductException` deriva de `ArgumentException`,
e os SKUs diferenciam maiúsculas de minúsculas:

```csharp
// Quebrado: "Apple" não é "apple", então isto captura UnknownProductException.
// Continua verde com a checagem de quantidade apagada.
Assert.Throws<ArgumentException>(() => _cart.Add("Apple", 0));

// Corrigido: o tipo exato, e um SKU que o estoque conhece.
Assert.ThrowsExactly<ArgumentOutOfRangeException>(() => _cart.Add("apple", 0));
```

O padrão deveria ser `ThrowsExactly`. `Throws` é o certo quando o contrato é de
fato uma família de tipos. Cancelamento é o caso comum: `Task.Delay` lança
`TaskCanceledException`, uma subclasse de `OperationCanceledException`, então
`ThrowsExactlyAsync<OperationCanceledException>` falha com "caught
TaskCanceledException" com o código correto:

```csharp
[TestMethod]
[Timeout(5000, CooperativeCancellation = true)]
public async Task ACancelledCheckoutGivesTheStockBack()
{
    _cart.Add("apple", 3);
    using var cancellation = CancellationTokenSource.CreateLinkedTokenSource(_testContext.CancellationToken);
    cancellation.CancelAfter(TimeSpan.FromMilliseconds(50));

    await Assert.ThrowsAsync<OperationCanceledException>(
        () => _cart.CheckoutAsync(new HangingGateway(), cancellation.Token));

    Assert.AreEqual(10, _inventory.Available("apple"));
}
```

`CooperativeCancellation = true` faz o timeout sinalizar o token em vez de
abandonar o teste numa task em segundo plano, que segundo a documentação pode
continuar mudando estado depois que o teste já foi reportado.

### Agora está tudo em Assert

O MSTest 4 captura a expressão do argumento de toda chamada a `Assert` e a
imprime na mensagem de falha. As checagens de coleção, string e comparação que
moravam em `CollectionAssert` e `StringAssert` agora têm versões em `Assert`:

```csharp
Assert.Contains("pear", skus);
Assert.DoesNotContain("plum", skus);
Assert.HasCount(2, skus);
Assert.AreSequenceEqual(["apple", "pear"], skus);   // MSTest 4.3+
Assert.IsExactInstanceOfType<ArgumentOutOfRangeException>(error); // MSTest 4.1+
```

A documentação diz que `StringAssert` e `CollectionAssert` são mantidas por
compatibilidade, provavelmente serão descontinuadas, e espalham as assertions
por três tipos, o que atrapalha a descoberta (o MSTEST0046 migra o
`StringAssert`).

### Timeout, Retry, Ignore e categorias

```csharp
[TestMethod]
[Ignore("Waiting for the new payment provider")] // reportado como skipped
public void IgnoredTest() { }

[TestMethod]
[Retry(3)] // repete um teste que falhou ou estourou o tempo até 3 vezes
public void PassesOnTheSecondAttempt() { }

[TestClass]
[TestCategory("Checkout")]
public sealed class CheckoutTests { }
```

Nesta execução o teste com `[Retry]` falhou uma vez e foi reportado como
aprovado. É isso que o retry faz, e é por isso que a documentação manda corrigir
a causa de um teste instável em vez de se apoiar nele. As categorias alimentam o
filtro: `dotnet test --filter "TestCategory=Checkout"` roda 4 testes do lab e
`--filter "TestCategory!=Checkout"` os outros 15.

### Paralelismo e estado static

O MSTest roda os testes de um assembly um de cada vez até o assembly optar pelo
paralelismo. O `dotnet new mstest` opta com esta linha:

```csharp
// MSTestSettings.cs
[assembly: Parallelize(Scope = ExecutionScope.MethodLevel)]
```

`MethodLevel` deixa quaisquer dois métodos de teste rodarem ao mesmo tempo;
`ClassLevel` roda classes em paralelo e os métodos de uma classe um depois do
outro. `Workers = 0` (o padrão) significa um worker por processador lógico.
Campos de instância são seguros nos dois, porque cada teste tem sua instância.
Um campo `static` é dividido por todos os testes que rodam ao mesmo tempo:

```csharp
// Quebrado: um estoque para a classe inteira, abastecido uma vez.
private static readonly Inventory SharedInventory = new();

[ClassInitialize]
public static void StockTheShelves(TestContext context) => SharedInventory.Restock("apple", 10, 0.50m);
```

Dois testes que compram 6 dessas 10 maçãs não podem passar os dois. Em quatro
execuções, o que falhou foi `AnotherCustomerCanAlsoBuySixApples` três vezes e
`ACustomerCanBuySixApples` uma vez: o resultado depende do escalonamento, que é
a definição de teste instável. A correção é o campo de instância do começo desta
página. Para o teste que realmente mexe em estado do processo (uma variável de
ambiente, o diretório atual), `[DoNotParallelize]` no método ou na classe o roda
sozinho (hoje, depois dos paralelos; a documentação chama essa ordem de detalhe
de implementação).

### Os testes protegem as regras?

Uma suíte verde diz que os testes concordam com o código, não que perceberiam um
bug. Quebre o código de produção de propósito, uma mudança por vez. Estes são os
resultados para a solução do lab:

| Mudança no código de produção | Testes que falham |
| --- | --- |
| `Inventory.Reserve` pula a checagem de estoque | o teste de falta de estoque e "uma reserva que falha deixa o estoque igual" |
| `Inventory.Reserve` pula a checagem de quantidade | as duas linhas `[DataRow]` do teste de quantidade, e `AddingZeroUnitsIsRejected` |
| `Inventory.Reserve` subtrai antes de checar | "uma reserva que falha deixa o estoque igual" |
| `Cart.Add` sobrescreve em vez de somar | "adicionar o mesmo produto duas vezes" |
| `Cart.Remove` não devolve o estoque | "remover uma linha devolve o estoque" |
| `CheckoutAsync` só devolve o estoque num pagamento recusado | o teste do checkout cancelado |
| `CheckoutAsync` mantém as linhas depois de pagar | o teste do pagamento aprovado |

A segunda linha é a que vale lembrar: a versão do teste de quantidade zero com
`Assert.Throws<ArgumentException>` continua verde com essa mudança.

## Trade-offs

- **Construtor ou `[TestInitialize]`.** O construtor dá campos `readonly` e é a
  preferência documentada; o `[TestInitialize]` dá `async`, `[Timeout]`, e
  limpeza que roda mesmo quando o setup lança. Misturar os dois numa classe deixa
  a ordem mais difícil de ler.
- **`[ClassInitialize]` economiza tempo e divide estado.** Um container ou um host
  HTTP iniciado uma vez por classe é uma economia real, mas tudo o que ele guarda
  é dividido por testes que podem rodar ao mesmo tempo. Mantenha fixtures
  compartilhadas somente leitura, ou dê a cada teste os próprios dados dentro
  delas (uma chave única por teste).
  ```csharp
  var sku = $"sku-{Guid.NewGuid():N}"; // único por teste dentro de um estoque compartilhado
  ```
- **`ThrowsExactly` é mais rígido, e às vezes rígido demais.** Pega o teste que
  passa pelo motivo errado, mas também falha quando o código lança um subtipo
  legítimo, como `TaskCanceledException`. Escolha conforme o contrato.
- **Paralelismo opcional é rápido até algo ser compartilhado.** O paralelismo por
  método revela acoplamento escondido cedo, e esse é o objetivo.
  `[DoNotParallelize]` é a saída para estado do processo, e faz esses testes
  esperarem o resto terminar.
- **`[Retry]` transforma vermelho em verde, não instável em estável.** É razoável
  em volta de uma dependência de fato pouco confiável num teste de integração, e
  nocivo num teste unitário, onde a instabilidade é um bug no teste ou no código.
- **Assertions no `[AssemblyCleanup]` são possíveis, e desajeitadas.** Elas veem o
  que nenhum teste vê, mas a falha aparece com o nome de um teste que não tem
  nada a ver e elas rodam com qualquer filtro. Guarde-as para checagens como a
  prova do ciclo de vida.

## Lab

Uma pequena loja já está implementada: um `Inventory` que reserva estoque e um `Cart` que fecha a compra por um gateway de pagamento. Sua tarefa é escrever os testes MSTest que provam que ela funciona, e descobrir como o MSTest realmente os executa.

**O que você vai praticar**

- Provar a ordem do ciclo de vida com um log, incluindo os hooks que rodam depois do teste.
- Fixtures por teste em campos `readonly`, e o que uma fixture `static` faz com paralelismo.
- `Assert.ThrowsExactly` contra `Assert.Throws`, num teste que passa pelo motivo errado e num cancelamento que pede o mais permissivo.
- `TestContext` pelo construtor, seu `CancellationToken`, `[Timeout]` e filtros por `[TestCategory]`.

**Pré-requisitos:** C# básico com `async`/`await`, .NET 10 SDK.

**Como funciona:** cada método de teste já está declarado com uma dica e falha com uma mensagem `TODO-NN` até você escrevê-lo. Uma classe de teste está quebrada de propósito (ela divide um estoque `static`), e um teste já passa pelo motivo errado. Os TODOs opcionais pedem para filtrar por categoria e para quebrar o código de produção de propósito e ver se a sua suíte percebe.

## Documentation Links

- [MSTest test lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-lifecycle) (doc)
- [MSTest TestContext, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-testcontext) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [Test execution and control in MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-controlling-execution) (doc)
- [MSTest migration from v3 to v4, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-migration-v3-v4) (doc)
- [Shared context between tests, xUnit.net](https://xunit.net/docs/shared-context) (doc)
