---
version: 1.0
updatedAt: 2026-11-12
title: "Mutation testing com Stryker.NET"
summary: Rode o Stryker.NET 5 em um projeto MSTest com Microsoft.Testing.Platform (runner mtp), leia o score e os mutantes sobreviventes, escreva os testes que os matam, distinga mutante equivalente de teste faltando e veja o custo de tempo medido no SDK 11 GA.
---
## Objective

A cobertura de linhas diz qual código os testes executam. Ela não diz qual código eles
conferem. Uma ferramenta de mutação deixa essa diferença visível: muda o código de
produção um passo pequeno por vez (`<=` vira `<`, `*` vira `/`, uma mensagem vira uma
string vazia), roda os testes contra cada mudança e conta as mudanças que a suíte não
percebeu. Um mutante que sobrevive é um teste fraco com número de linha. O Stryker.NET
é a ferramenta para .NET. O objetivo: rodá-lo em um projeto MSTest que usa
Microsoft.Testing.Platform, ler o score e os mutantes sobreviventes, escrever os testes
que os matam, e saber quando um sobrevivente não é um teste faltando.
Versões medidas: `dotnet-stryker` 5.1.0 (ferramenta local), `MSTest.Sdk` 4.5.3, no SDK .NET 10.0.100
e no SDK .NET 11.0.100. Sem Docker.

## Use Cases

- Mostrar, com números, que uma suíte com cobertura total é fraca.
- Achar a fronteira e o valor exato que nenhum teste afirma.
- Barrar um pull request pelo score de mutação dos arquivos que ele mudou.
- Revisar uma suíte de testes que você não escreveu.

## Deep Dive

### Uma suíte que cobre tudo e confere pouco

O lab tem um `ShippingCalculator`: faixas de peso (até 1, 5 e 10 kg, depois 0,80 por
quilo iniciado), um multiplicador por zona, um multiplicador de expresso, frete grátis
para pedidos domésticos a partir de 100, e uma etiqueta. A suíte inicial tem seis testes
que passam e que são bem legíveis:

```csharp
[TestMethod]
public void AHeavyParcelCostsMoreThanALightOne()
{
    var light = _calculator.Quote(new Parcel(1m, Zone.Domestic, false, 20m));
    var heavy = _calculator.Quote(new Parcel(20m, Zone.Domestic, false, 20m));

    Assert.IsGreaterThan(light, heavy);
}
```

"Custa mais que" é verdade para cem tarifas erradas. Um peso negativo é rejeitado, mas
0 e 30,01 não são tentados. O teste da etiqueta confere que ela não é vazia. Toda linha
da calculadora executa, então um relatório de cobertura fica satisfeito.

### Rodando o Stryker como ferramenta local

O Stryker é uma ferramenta .NET. Ponha-o no manifesto de ferramentas do repositório,
para que todo mundo que clonar tenha a mesma versão, e nunca o instale globalmente:

```bash
dotnet new tool-manifest
dotnet tool install --local dotnet-stryker --version 5.1.0
dotnet tool restore          # em um clone novo ou em um agente de CI
cd tests/Shipping.Tests
dotnet stryker
```

O `dotnet stryker` lê o `stryker-config.json` do diretório atual. O ponto de partida é
o projeto de testes, e `project` nomeia o projeto a mutar:

```json
{
  "stryker-config": {
    "project": "Shipping.csproj",
    "test-runner": "mtp",
    "reporters": ["html", "json", "cleartext"],
    "thresholds": { "high": 95, "low": 90, "break": 0 }
  }
}
```

### O runner precisa ser o `mtp`

O runner padrão do Stryker é o `vstest`. O projeto de testes do lab usa `MSTest.Sdk` com
o `global.json` escolhendo o Microsoft.Testing.Platform (veja o concept de MTP), e
`dotnet stryker --test-runner vstest` nele falha:

```text
[ERR] TestDiscoverer: Test discovery failed for ...Shipping.Tests.dll:
  ... Could not find testhost for test source '...Shipping.Tests.dll'.
Test discovery was aborted.
```

O código de saída é 1. Com `-t mtp` (ou `"test-runner": "mtp"` no config) ele roda, e
imprime um aviso: `The Microsoft Test Platform testrunner is currently in preview.
Results should be verified since this feature is still being tested.` Então trate o
runner MTP como preview, e compare a primeira execução com o que você espera.

### Lendo o resultado

Na suíte inicial:

```text
40 mutants created
1 mutants got status CompileError.   Reason: Mutant caused compile errors
2 mutants got status NoCoverage.     Reason: Not covered by any test.
3 mutants got status Ignored.        Reason: Removed by block already covered filter
34 total mutants will be tested
The final mutation score is 38.89 %
```

O relatório json detalha: 14 mortos, 20 sobreviventes, 2 `NoCoverage`. O score é o total
de mortos sobre mortos, sobreviventes e não cobertos: 14 de 36, ou seja, 38,89%.
Mutantes `CompileError` e `Ignored` não entram na conta. A execução levou de 5 a 6
segundos. É barata aqui porque o Stryker registra quais testes alcançam cada mutante e
roda só esses, e porque o projeto é minúsculo.

O relatório `html` mostra o código com cada mutante no lugar. Os sobreviventes, com o
que fazer com cada um:

| Mutante sobrevivente | Por que a suíte o deixou viver |
| --- | --- |
| `WeightKg <= 0` para `< 0` | o único peso rejeitado é -1 |
| `WeightKg > MaxWeightKg` para `>=` | nada tenta exatamente 30 kg |
| a mensagem da exceção para `""` | nenhum teste lê a mensagem |
| `OrderValue >= 100` para `> 100` | o pedido grátis é de 150, não de 100 |
| `if (parcel.Express)` negado | não há nenhum pacote expresso |
| `weightKg <= 5` para `< 5` ou `> 5` | "pesado custa mais que leve" |
| `Math.Ceiling(weightKg - 10) * 0.80m` para `/` ou `weightKg + 10` | só 20 kg, só "mais que" |
| o condicional `"EXP"`/`"STD"` | "a etiqueta não é vazia" |

Cada linha é um teste a escrever: o preço exato de cada borda de faixa e um passo
depois dela, 0 e 30,01 kg com o `ParamName` e a mensagem, frete grátis em 100 e em
99,99, expresso em cada zona, o texto inteiro da etiqueta. Um teste orientado a dados
com 16 linhas cuida da maior parte da tabela:

```csharp
(1m, Zone.Domestic, false, 4.90m),
(1.01m, Zone.Domestic, false, 7.90m),
(10m, Zone.Domestic, false, 12.90m),
(10.01m, Zone.Domestic, false, 13.70m),
(1m, Zone.Europe, true, 11.03m), // 4.90 x 1.5 x 1.5 = 11.025, arredondado para longe do zero
```

Com os testes novos (25 contando as linhas de dados) a mesma execução diz 40 mutantes,
35 mortos, 1 sobrevivente, score 97,22%, 5 a 6 segundos. Os 2 mutantes `NoCoverage`,
que nenhum teste alcançava, somem porque os testes de expresso e de etiqueta os
alcançam.

### O sobrevivente que não é teste faltando

`weightKg <= 10` para `weightKg < 10` ainda sobrevive. Em exatamente 10 kg a terceira
faixa dá 12,90, e o caminho de fallback `12.90m + Math.Ceiling(10 - 10) * 0.80m` também
dá 12,90. Nenhuma entrada distingue as duas versões: é um mutante equivalente. Não
escreva um teste para ele. Opções:

- Deixá-lo e aceitar 97,22% (o limite `high` do lab é 95).
- Reescrever o código para o ramo redundante sumir, por exemplo com uma fórmula só usando
  `Math.Max(0, Math.Ceiling(weightKg - 10))` (não rodei essa variante).
- Silenciá-lo com `// Stryker disable once Equality : motivo`. Cuidado: o "once" cobre o
  próximo statement, e `BasePrice` é um membro de corpo de expressão só. Pôr o comentário
  acima dele subiu `Ignored` de 3 para 9 e o score para 100%, porque desligou também 5
  mutantes de igualdade que os testes matam. Um 100% que esconde mutantes de verdade é
  pior que 97%.

### Fazendo do score um portão

```bash
dotnet stryker --break-at 90
```

Na suíte inicial isso sai com 2; na nova, com 0. O Stryker valida os limites entre si:
com `low` em 80, `--break-at 90` para com
`Threshold low must be more than or equal to threshold break`, então defina `low` e
`break` juntos. O `dotnet stryker --help` também lista `--since[:committish]` ("Only test
changed files", um diff contra um commit ou branch do Git) e uma baseline do dashboard;
nenhum dos dois foi rodado para este concept. São eles que tornam uma execução de
mutação viável em um pull request, porque uma execução completa custa uma rodada de
testes por mutante.

### O que um mutante sobrevivente diz

Três tipos de sobrevivente, três respostas:

1. **Uma asserção fraca** (`IsGreaterThan` onde o valor exato é conhecido): aperte-a.
2. **Uma entrada que falta** (nenhum pacote expresso, nenhum de 30 kg): acrescente o caso.
3. **Um mutante equivalente ou irrelevante** (a faixa de 10 kg, uma mensagem de log):
   ignore-o, com um motivo ao lado do código ou no config (`--mutate` pode excluir
   arquivos e `ignore-mutations` pode excluir um mutador).

Os dois primeiros são a lição. O terceiro é o motivo de a meta não ser 100%.

## Trade-offs

- **É lento onde o código é grande.** O lab leva segundos porque são 36 mutantes. Um
  projeto de verdade tem milhares, e cada um é uma rodada de testes. Rode nos arquivos
  alterados de um pull request, ou à noite no projeto inteiro.
- **Um portão de cobertura e um score de mutação respondem a perguntas diferentes.** A
  suíte inicial tinha toda linha coberta e score de 38,89%. Mantenha o portão de
  cobertura, que é barato, e acrescente o score de mutação para o código que importa.
- **Nem todo sobrevivente é um defeito nos testes.** O mutante de 10 kg é equivalente.
  Um time que persegue 100% escreve testes à toa, ou silencia demais (o `disable once`
  acima escondeu 5 mutantes de verdade).
- **O runner MTP é preview.** Funcionou no lab, e o Stryker avisa isso a cada execução.
  Fixe a versão no manifesto de ferramentas e confira uma primeira execução à mão.
- **Strings e logs fazem ruído.** Um mutante de mensagem de exceção sobrevive até um
  teste ler a mensagem. Vale a pena quando a mensagem é parte de uma API; para uma
  linha de log, exclua-a.

## Lab

A calculadora de frete já está implementada, e a suíte inicial passa e cobre toda linha. Sua tarefa é rodar o Stryker, ler os mutantes sobreviventes e escrever os testes que os matam, e depois decidir o que fazer com o que não pode ser morto.

**O que você vai praticar**

- Instalar o Stryker como ferramenta local pelo manifesto e rodá-lo com o runner `mtp`.
- Ler o score, os mutantes sobreviventes e os `NoCoverage`.
- Escrever um teste orientado a dados com valores exatos para cada borda de faixa, e testes para os limites, a borda do frete grátis e a etiqueta.
- Distinguir um mutante equivalente de um teste faltando, e conferir o que `// Stryker disable once` realmente desliga.

**Pré-requisitos:** Microsoft.Testing.Platform, dotnet test e Code Coverage no CI, MSTest Fundamentals: Lifecycle and TestContext, SDK .NET 10.

**Como funciona:** o starter fica verde de propósito, porque o Stryker precisa de uma suíte passando: quatro casquinhas com `[Ignore]` marcam onde seus testes entram. O score é 38,89% antes e 97,22% na solution, que documenta a tabela de sobreviventes e o mutante equivalente.

## Documentation Links

- [Stryker.NET introduction](https://stryker-mutator.io/docs/stryker-net/introduction/) (doc)
- [Stryker.NET configuration](https://stryker-mutator.io/docs/stryker-net/configuration/) (doc)
- [Stryker.NET mutations](https://stryker-mutator.io/docs/stryker-net/mutations/) (doc)
- [dotnet-stryker on NuGet](https://www.nuget.org/packages/dotnet-stryker) (doc)
- [Microsoft.Testing.Platform overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-intro) (doc)
