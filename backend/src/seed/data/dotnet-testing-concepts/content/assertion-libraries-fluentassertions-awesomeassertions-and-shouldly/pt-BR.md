---
version: 1.0
updatedAt: 2026-11-12
title: "Bibliotecas de asserção: FluentAssertions, AwesomeAssertions e Shouldly"
summary: As asserções nativas do MSTest 4.5.3 contra AwesomeAssertions 9.6.0 e Shouldly 4.3.0, com mensagens de falha reais lado a lado, o que mudou na licença do FluentAssertions 8 (uso não comercial, conferido no pacote) e as armadilhas de cultura e de case que custam uma sessão de depuração, tudo medido no SDK 11 GA.
---
## Objective

A maioria das suítes de teste .NET com alguns anos de vida tem uma linha como
`total.Should().Be(25.50m)`. Desde 2025, deixar essa linha lá é uma questão de
licença, e decidir se uma suíte nova precisa dela é outra questão: o MSTest 4
imprime a expressão que foi verificada, que era o principal motivo para buscar
uma biblioteca. Esta lição escreve as mesmas seis verificações com as asserções
que vêm no MSTest 4.5.3, com o AwesomeAssertions 9.6.0 e com o Shouldly 4.3.0,
faz cada uma falhar de propósito e coloca as mensagens lado a lado. Também
inspeciona o pacote FluentAssertions 8.11.0 para dizer a licença exatamente como
o pacote a declara. Tudo rodou no SDK .NET 11.0.100 GA (projetos `net10.0`, com
roll forward), sobre o Microsoft.Testing.Platform. Para o lado do MSTest com mais
profundidade, veja o concept MSTest Fundamentals, e para a escolha do framework
de testes veja Choosing a Test Framework.

## Use Cases

- Ler uma suíte legada cheia de `.Should().Be(...)` e saber qual pacote ela usa e
  sob qual licença.
- Decidir, numa suíte nova, se a classe `Assert` do MSTest 4 basta.
- Sair do FluentAssertions para um fork ou para as asserções nativas sem perder as
  mensagens de falha a que o time está acostumado.
- Escolher asserções para verificações sem boa forma nativa: equivalência de
  objetos, várias falhas reportadas de uma vez, uma cadeia sobre um mesmo sujeito.

## Deep Dive

### Quatro pacotes, quatro licenças

| Pacote | Versão | Licença no pacote | Notas |
| --- | --- | --- | --- |
| MSTest (`Assert`) | 4.5.3 | parte do framework de testes | sem pacote extra |
| FluentAssertions | 7.2.2 | `Apache-2.0` (expressão) | última linha 7.x no NuGet |
| FluentAssertions | 8.11.0 | arquivo `LICENSE`, "XCEED SOFTWARE INC. COMMUNITY LICENSE AGREEMENT ... (for Non-Commercial Use)" | `requireLicenseAcceptance` é `true` |
| AwesomeAssertions | 9.6.0 | `Apache-2.0` | "A fork of FluentAssertions" |
| Shouldly | 4.3.0 | `BSD-3-Clause` | a 5.0 existe só como preview |

A linha do FluentAssertions 8.11.0 vem do `.nuspec` e do arquivo `LICENSE` dentro
do pacote, lidos depois de baixá-lo. A descrição do pacote diz: "This version is
free for open-source projects and non-commercial use, but commercial use requires
a paid license." O texto da licença define uso não comercial como o uso cujo
objetivo principal não é obter vantagem comercial, e lista como fora dessa
definição o uso "by or for an organisation, group of persons, legal entity, or
company, that charges fees or earns revenues". Leia assim: uma suíte de empresa
que testa um produto que gera receita muito provavelmente precisa da licença paga
da Xceed, que detém o copyright da série 8.x (o pacote diz "Copyright 2024-2026
Xceed Software Inc."). A linha 7.x mantém a licença Apache-2.0, e o
AwesomeAssertions continua o código sob Apache-2.0 com um namespace novo. Não sou
advogado, e a página da licença é a autoridade (links no fim); o ponto para um
time é que a pergunta existe, e que `dotnet list package` e a página do pacote
mostram em qual versão você está.

### Seis verificações em duas bibliotecas

O modelo do lab é uma fatura (`Invoice` com linhas, um total, um desconto
arredondado, um texto de resumo, `Pay()` e um record `Customer`). Três das seis
verificações, primeiro com o MSTest 4, depois com o AwesomeAssertions:

```csharp
// MSTest 4
Assert.AreEqual(22.93m, _invoice.TotalWithDiscount(10m), 0.005m);
Assert.StartsWith("INV-001", summary);
Assert.Contains("Ada Lovelace", summary);
Assert.AreSequenceEqual(["A-100", "B-200"], _invoice.Lines.Select(l => l.Sku));
var paid = Assert.ThrowsExactly<InvalidOperationException>(() => _invoice.Pay());
Assert.AreEqual("Invoice INV-001 is already paid.", paid.Message);

// AwesomeAssertions 9.6.0
_invoice.TotalWithDiscount(10m).Should().BeApproximately(22.93m, 0.005m);
summary.Should().StartWith("INV-001").And.Contain("Ada Lovelace");
_invoice.Lines.Select(l => l.Sku).Should().Equal("A-100", "B-200");
_invoice.Invoking(i => i.Pay()).Should().ThrowExactly<InvalidOperationException>()
    .WithMessage("Invoice INV-001 is already paid.");
```

As seis verificações passaram nas duas, 18 testes contando uma cópia em Shouldly.
Duas verificações mostram onde a classe nativa para. O fim de uma string sem
diferenciar maiúsculas de minúsculas não tem método em `Assert`, então o teste
recorre a `Assert.IsTrue(summary.EndsWith("eur", StringComparison.OrdinalIgnoreCase),
summary)`, e o segundo argumento importa: sem ele a falha diz apenas que o
`IsTrue` falhou. A equivalência de um grafo de objetos não tem método em `Assert`
nenhum. "O cliente confere, ignorando o e-mail" são duas chamadas a `AreEqual` no
MSTest e uma linha no AwesomeAssertions:

```csharp
_invoice.Customer.Should().BeEquivalentTo(expected, o => o.Excluding(c => c.Email));
```

O AwesomeAssertions encontra o MSTest sozinho e lança a própria
`AssertFailedException` do MSTest; nenhuma linha de configuração foi necessária.
As mesmas cinco formas de chamada (`Be`, `Contain`, `Equal`,
`Invoking(...).Should().ThrowExactly`, `BeEquivalentTo` com `Excluding`) também
compilaram sem mudança contra o FluentAssertions 8.11.0 em um projeto de rascunho,
mudando apenas o `using`, o que faz da migração basicamente uma troca de pacote
mais um namespace.

### A mesma falha, quatro mensagens

Cada caso foi uma instrução simples dentro de um teste, executada com a cultura
invariante. O total da fatura é 25.48, e o resumo é `INV-001 | Ada Lovelace |
2 lines | 25.48 EUR`.

Um total errado, com `25.50m` esperado:

```text
MSTest 4.5.3
  Assertion failed. Expected values to be equal.
  expected: 25.50
  actual:   25.48
  Assert.AreEqual(25.50m, invoice.Total)

AwesomeAssertions 9.6.0 (o FluentAssertions 8.11.0 imprimiu a mesma linha)
  Expected invoice.Total to be 25.50M, but found 25.48M (difference of -0.02).

Shouldly 4.3.0
  invoice.Total
      should be
  25.50m
      but was
  25.48m
```

Uma substring ausente, `"Grace Hopper"`:

```text
MSTest    Assertion failed. Expected string to contain the specified substring.
          expected substring: "Grace Hopper"
          actual:             "INV-001 | Ada Lovelace | 2 lines | 25.48 EUR"
          comparison:         Ordinal
          Assert.Contains("Grace Hopper", invoice.Summary())
Awesome   Expected invoice.Summary() "INV-001 | Ada Lovelace | 2 lines | 25.48 EUR" to contain "Grace Hopper".
Shouldly  invoice.Summary()
              should contain (case insensitive comparison)
          "Grace Hopper"
              but was actually
          "INV-001 | Ada Lovelace | 2 lines | 25.48 EUR"
```

Uma sequência que difere no índice 1, com `["A-100", "C-300"]` esperado:

```text
MSTest 4.5.3 (Assert.AreSequenceEqual)
  Assertion failed. Expected sequences to be equal.
  Sequences have 2 element(s). 1 element(s) differ. First difference at index 1.
  expected: ["A-100", "C-300"]
  actual:   ["A-100", "B-200"]
  Assert.AreSequenceEqual(["A-100", "C-300"], skus)

AwesomeAssertions
  Expected skus to be equal to {"A-100", "C-300"}, but {"A-100", "B-200"} differs at index 1.

Shouldly
  skus
      should be
  ["A-100", "C-300"]
      but was (case sensitive comparison)
  ["A-100", "B-200"]
      difference
  ["A-100", *"B-200"*]
```

Uma exceção que não veio:

```text
MSTest    Assertion failed. Expected exception of exact type InvalidOperationException but no exception was thrown.
          Assert.ThrowsExactly<InvalidOperationException>(() => invoice.Total.ToString())
Awesome   Expected System.InvalidOperationException, but no exception was thrown.
Shouldly  `invoice.Total.ToString()`
              should throw
          System.InvalidOperationException
              but did not
```

Dois objetos que diferem em `Country` e `Email`, com o e-mail excluído nas
bibliotecas que sabem excluir:

```text
MSTest (Assert.AreEqual nos records)
  expected: Customer { Name = Ada Lovelace, Email = other@example.com, Country = PT }
  actual:   Customer { Name = Ada Lovelace, Email = ada@example.com, Country = UK }
AwesomeAssertions
  Expected property customer.Country to be the same string, but they differ at index 0:
     (actual) "UK" / "PT" (expected).
  With configuration:
  - Prefer the declared type of the members
  ... (dez linhas de configuração, incluindo "- Exclude member Email")
FluentAssertions 8.11.0
  Expected property customer.Country to be "PT", but "UK" differs near "UK" (index 0).
Shouldly (ShouldBeEquivalentTo)
  Comparing object equivalence, at path: customer [Billing.Customer] / Email [System.String]
  Expected value to be "other@example.com" but was "ada@example.com"
```

O que os cinco casos mostram:

- **O MSTest 4 fechou boa parte da diferença.** Ele imprime esperado, atual e o
  código da chamada, e o `Assert.AreSequenceEqual` informa o tamanho e a primeira
  diferença. Isso é também o que o antigo `CollectionAssert.AreEqual` não fazia:
  para dois arrays de string ele imprimiu `Element at index 0 do not match.
  Expected: C Actual: B`, um índice e dois caracteres, não as coleções.
- **As bibliotecas com Should() nomeiam o sujeito, não a chamada.** `invoice.Total`
  e `skus` vêm da expressão de quem chama, o que só funciona quando `Should()` é
  chamado como método de extensão sobre essa expressão. Chamado como método
  estático, `AssertionExtensions.Should(invoice.Total)`, as mesmas bibliotecas
  imprimiram `Expected AA to be`, então escreva do jeito usual.
- **Só a equivalência falta no MSTest.** O resto é questão de gosto e de quantas
  linhas a intenção ocupa.
- **O Shouldly imprime código como mensagem.** Ele imprime a linha de código da
  chamada que falhou, então a mensagem é tão legível quanto a linha que você
  escreveu.

### Vários erros de uma vez, e um motivo

O AwesomeAssertions tem um `AssertionScope` que faz da primeira falha a última:
todas as falhas dentro dele são reportadas por uma exceção quando o escopo é
descartado.

```csharp
using var scope = new AssertionScope();
invoice.Total.Should().Be(1m);
invoice.Summary().Should().Contain("Grace");
```

```text
Expected invoice.Total to be 1M, but found 25.48M (difference of 24.48).
Expected invoice.Summary() "INV-001 | Ada Lovelace | 2 lines | 25.48 EUR" to contain "Grace".
```

`Be(1m, "the {0} must match", "total")` insere o motivo: `Expected
invoice.Total to be 1M because the total must match, but found 25.48M`. O
`Assert` do MSTest para na primeira falha, então com a classe nativa mantenha uma
verificação lógica por teste, como o lab faz.

### Duas armadilhas que custam uma sessão de depuração

O `ShouldContain` de string do Shouldly ignorou maiúsculas e minúsculas por padrão
na 4.3.0. A mensagem de falha acima avisa, `should contain (case insensitive
comparison)`, e `summary.ShouldContain("ada lovelace")` contra `Ada Lovelace` não
falhou. Com `Case.Sensitive` falhou, e a mensagem perdeu o parêntese. Um padrão
diferente do de `string.Contains` vale ser conhecido antes que esconda um bug de
caixa.

O Shouldly também formata números com a cultura atual. Na máquina usada aqui,
`25.50m` saiu como `25,50m` até o teste fixar a cultura, e o `Summary()` do lab
também formata com a cultura invariante pelo mesmo motivo. Quando um teste fixa
uma mensagem de falha, fixe a cultura também. O Shouldly imprime ainda a linha de
código da chamada que falhou, então uma lambda de uma linha dentro de
`Assert.ThrowsExactly<...>(` imprimiu todo esse prefixo como parte da mensagem.

### Lendo `x.Should().Be(...)` em código legado

Abra o arquivo de projeto. O `FluentAssertions` 7.x é Apache-2.0 e pode ficar. A
8.x exige a licença paga para uso comercial e mostra
`requireLicenseAcceptance`. O `AwesomeAssertions` entra no lugar com o namespace
`AwesomeAssertions`, e o texto da falha é o mesmo nas verificações acima. Trocar
pelo `Assert` nativo é uma reescrita por linha, então faça onde a verificação é
simples: igualdade, substring, sequência, exceção. Mantenha uma biblioteca para
equivalência e escopos.

## Trade-offs

- **Leitura fluente vs uma dependência.** `Should().StartWith(...).And.Contain(...)`
  lê como o requisito e encadeia sobre um sujeito. O custo é um pacote, um segundo
  vocabulário para quem chega e, no FluentAssertions 8, uma licença.
- **As asserções nativas têm o menor atrito.** Vêm com o MSTest, imprimem a
  chamada e não precisam de revisão de licença. Não têm equivalência nem escopo, e
  algumas formas (fim sem diferenciar caixa) pedem um contorno.
- **Um fork é uma aposta num mantenedor.** O AwesomeAssertions tem as mesmas formas
  de código e uma licença aberta, e seu roadmap é só dele. O Shouldly é outro
  vocabulário, então migrar para ele reescreve cada linha.
- **Mensagens são parte do produto.** Uma falha que diz só "Expected True" custa
  minutos no CI. Fixe uma mensagem por biblioteca num teste, como o lab faz, depois
  de ler o que ela imprime.
- **Cultura e padrões vazam para as mensagens.** Regras de caixa e formatos de
  número mudaram o que o Shouldly imprimiu. Fixe os dois nos testes que verificam
  uma mensagem.

## Lab

O modelo de faturamento já está implementado. Sua tarefa é escrever as mesmas seis verificações em duas bibliotecas e ler as mensagens que elas imprimem quando você quebra uma.

**O que você vai praticar**

- Escrever verificações de igualdade, tolerância, string, sequência, exceção e equivalência com o `Assert` do MSTest 4.
- Escrever as mesmas seis com o `Should()` do AwesomeAssertions, usando cadeias e `BeEquivalentTo`.
- Ler e fixar mensagens de falha: captura da expressão, `AssertionScope`, o argumento de motivo.
- Opcionalmente, as mesmas verificações no Shouldly, e seus padrões de caixa e de cultura.

**Pré-requisitos:** MSTest Fundamentals: Lifecycle and TestContext, SDK .NET 10.

**Como funciona:** o starter tem 17 testes falhando, cada um com uma mensagem `TODO-NN` e uma dica. O `MSTest.Sdk` 4.5.3, o AwesomeAssertions 9.6.0 e o Shouldly 4.3.0 já estão referenciados, e o `global.json` seleciona o modo Microsoft.Testing.Platform do `dotnet test`.

## Documentation Links

- [Assertions, MSTest on Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
- [FluentAssertions 8.11.0 package page, NuGet](https://www.nuget.org/packages/FluentAssertions/8.11.0) (doc)
- [FluentAssertions license and pricing, Xceed](https://xceed.com/products/unit-testing/fluent-assertions/) (doc)
- [AwesomeAssertions, GitHub](https://github.com/AwesomeAssertions/AwesomeAssertions) (doc)
- [Shouldly documentation](https://docs.shouldly.org/) (doc)
