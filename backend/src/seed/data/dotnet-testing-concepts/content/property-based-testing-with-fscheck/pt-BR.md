---
version: 1.0
updatedAt: 2026-11-12
title: "Property-based testing com FsCheck no MSTest 4"
summary: Escreva propriedades em vez de exemplos, construa geradores e shrinkers com Arbitrary, leia o contraexemplo reduzido de um bug real, reproduza falhas por seed, rode o FsCheck 3.6.0 dentro de um TestMethod do MSTest 4 e saiba quando não vale a pena.
---
## Objective

Um teste baseado em exemplos diz "para esta entrada, esta saída". Ele vale o que valem as
entradas que o autor imaginou, e os bugs que importam moram nas entradas em que ninguém
pensou. Um teste baseado em propriedades diz algo que precisa ser verdade para toda
entrada de um tipo ("as parcelas sempre somam o valor"), e uma biblioteca gera as entradas:
centenas delas, inclusive as esquisitas. Quando a propriedade falha, a biblioteca reduz
(shrink) a entrada que falhou até uma pequena e imprime a seed que a reproduz. FsCheck é a
biblioteca para .NET. O objetivo: escrever propriedades para um método, construir geradores e
shrinkers com `Arbitrary`, ler uma falha e reproduzi-la por seed, rodar o FsCheck de um
`[TestMethod]` do MSTest 4 e saber quando uma propriedade não vale a pena.
Versões medidas: `FsCheck` 3.6.0, `MSTest` 4.5.3, no SDK .NET 10.0.100 e no alvo `net10.0`.

## Use Cases

- Código com uma regra que vale para uma faixa inteira de entradas: dividir dinheiro,
  arredondar, ordenar, fazer parse e formatar, mesclar, normalizar.
- Um método em que todos os exemplos passam e você não confia neles.
- Um relato de bug que "só acontece às vezes", com entradas que você não consegue adivinhar.
- Código que precisa manter uma relação entre duas operações (codificar e decodificar,
  adicionar e remover, uma versão rápida e uma lenta e óbvia).

## Deep Dive

### Quatro exemplos verdes e um bug

O lab tem `MoneySplitter.Split(long cents, int parts)`: divide uma fatura, ou um estorno,
em parcelas. A regra é simples: as parcelas somam o valor, e duas parcelas nunca diferem em
mais de um centavo. A primeira versão:

```csharp
public static long[] Split(long cents, int parts)
{
    ArgumentOutOfRangeException.ThrowIfLessThan(parts, 1);

    var share = cents / parts;
    var remainder = cents % parts;

    var result = new long[parts];
    for (var i = 0; i < parts; i++)
    {
        result[i] = share + (i < remainder ? 1 : 0);
    }
    return result;
}
```

E os testes que uma pessoa escreve primeiro, com as técnicas do concept de testes
orientados a dados:

```csharp
[TestMethod]
[DataRow(100L, 3, new long[] { 34, 33, 33 })]
[DataRow(100L, 4, new long[] { 25, 25, 25, 25 })]
[DataRow(1L, 3, new long[] { 1, 0, 0 })]
[DataRow(0L, 5, new long[] { 0, 0, 0, 0, 0 })]
public void AnInvoiceIsSplitInShares(long cents, int parts, long[] expected)
{
    CollectionAssert.AreEqual(expected, MoneySplitter.Split(cents, parts));
}
```

Os quatro passam, e o código parece certo. Os exemplos escolheram suas entradas do jeito que
o autor pensa em uma fatura: positiva. Nada aqui é erro dos testes. É um ponto cego de quem
os escreveu, e uma propriedade não tem esse ponto cego, porque a pessoa não escolhe as
entradas.

### Uma propriedade é um bool para toda entrada

Uma propriedade é uma função de entradas para `bool`. O FsCheck a chama 100 vezes por padrão
com valores gerados. Em C# (namespace `FsCheck.Fluent`) ela se escreve com `Prop.ForAll`,
dentro de um método de teste normal:

```csharp
[TestMethod]
public void SharesAddUpToTheAmount()
{
    Prop.ForAll(Amounts, Parts, (cents, parts) =>
            MoneySplitter.Split(cents, parts).Sum() == cents)
        .QuickCheckThrowOnFailure();
}
```

`QuickCheckThrowOnFailure()` roda a propriedade e lança uma exceção quando ela é falseada. O
MSTest reporta a exceção como a falha do teste, com a mensagem do FsCheck como texto. Não há
atributo nem nada para registrar. Contra o `Split` acima, o teste falha em 1 a 12 casos
gerados:

```text
Falsifiable, after 6 tests (5 shrinks) (10200620173344671379,2271238073153152867).
Last step was invoked with size of 7 and seed of (6505255636827669415,5266466383858147523).
Replay directly at failing step with (6505255636827669415,5266466383858147523,7).
Original:
-7L
4
Shrunk:
-1L
2
with exception:
System.Exception: Expected true, got false.
```

`Original` é a primeira entrada que quebrou a propriedade. `Shrunk` é a menor que o FsCheck
achou e que ainda a quebra: `Split(-1, 2)`. O C# trunca a divisão em direção a zero e o `%`
leva o sinal do dividendo, então, para um valor negativo, o resto é negativo, o laço
`i < remainder` nunca roda e `Split(-1, 2)` devolve `[0, 0]`: o estorno perdeu um centavo.
Execuções diferentes do mesmo teste deram `(-7, 4)`, `(-5, 8)`, `(-1, 3)` e `(-1, 2)` como
entrada original, e `(-1, 2)` como entrada reduzida todas as vezes. O valor reduzido é estável
mesmo quando o aleatório não é, e é por isso que uma falha de propriedade é fácil de agir.

A correção usa o resto com piso, e os centavos extras continuam indo para as primeiras
parcelas:

```csharp
var remainder = ((cents % parts) + parts) % parts;
var share = (cents - remainder) / parts;
```

O mesmo teste passa, e as propriedades abaixo também (a solution do lab tem 13 testes, 5
exemplos e 8 da classe de propriedades, e roda em cerca de 80 ms).

### De onde vêm as propriedades

Escrever "o resultado é igual ao que o código calcula" não é uma propriedade: repete a
implementação. As úteis seguem algumas formas recorrentes:

| Forma | No lab | Em outros lugares |
| --- | --- | --- |
| Invariante do resultado | as parcelas somam o valor; há `parts` delas; nenhuma difere de outra em mais de um centavo; as maiores vêm primeiro | uma lista ordenada tem os mesmos elementos da entrada |
| Ida e volta | nenhuma | decode(encode(x)) é igual a x; parse(format(x)) é igual a x |
| Oráculo | nenhuma | um algoritmo rápido dá a mesma resposta que um lento e óbvio |
| Idempotência | nenhuma | normalizar duas vezes é o mesmo que normalizar uma |
| Contrato de falha | menos de 1 parte sempre lança `ArgumentOutOfRangeException` | entrada inválida é sempre rejeitada, nunca tratada pela metade |

O lab escreve cinco delas. Só a primeira acha o bug. As outras quatro passam antes e depois, e
não estão ali para achá-lo: dizem o que `Split` promete, de modo que uma mudança futura não
quebre essa promessa em silêncio, e cada uma cobre entradas que ninguém listou.

### Geradores e Arbitrary

Um `Arbitrary<T>` é um gerador (`Gen<T>`) mais um shrinker. O FsCheck tem os padrões para
`int`, `long`, `string`, arrays, listas, records e mais, obtidos com `ArbMap.Default.ArbFor<T>()`,
e a sobrecarga que infere os tipos, `Prop.ForAll<long, int>((cents, parts) => ...)`, usa esses
padrões. Os padrões raramente são o domínio que você quer: `int` inclui 0 e negativos, e
`Split` os rejeita. Há dois jeitos de estreitar:

```csharp
// 1. filtrar o padrão: mantém o shrinker padrão
private static readonly Arbitrary<int> Parts =
    ArbMap.Default.ArbFor<int>().Filter(parts => parts is >= 1 and <= 20);

// 2. construir um gerador e dar a ele um shrinker
private static readonly Arbitrary<int> Parts =
    Arb.From(Gen.Choose(1, 20), parts => Enumerable.Range(1, parts - 1));
```

O shrinker importa. `Gen.Choose(1, 20).ToArbitrary()`, sem shrinker, dá um gerador que não
reduz, e a mesma propriedade que falhava reportou isto em vez de `-1L, 2`:

```text
Falsifiable, after 1 test (0 shrinks) ...
Original:
-40509L
4
```

Isso foi com os valores e as partes construídos com `Gen.Choose`. A falha é verdadeira, e
quase inútil: agora você depura 40509 centavos em 4 partes. Filtrar um arbitrary padrão ou
passar um shrinker para `Arb.From` mantém a redução. Use `Gen.Choose`, `Gen.Elements`,
`Select` e `SelectMany` para montar valores de domínio (um pedido com 1 a 5 linhas, um
intervalo de datas cujo fim é depois do início), e, quando o valor é um tipo composto, reduza
em direção ao vazio ou ao menor.

Um filtro descarta valores gerados até um passar. Quando a maioria dos valores padrão seria
rejeitada, prefira um gerador que produza só valores válidos.

### O gerador chega ao caso?

Uma propriedade que passa por entradas que nunca chegam ao ramo arriscado prova pouco. O
`Classify` rotula as execuções, para você olhar a distribuição:

```csharp
Prop.ForAll(Amounts, Parts, (cents, parts) =>
        (MoneySplitter.Split(cents, parts).Length == parts)
        .Classify(cents < 0, "refund")
        .Classify(cents % parts == 0, "divides evenly"))
    .Check(Config.Quick.WithMaxTest(100));
```

```text
Ok, passed 100 tests.
39% refund.
9% divides evenly, refund.
9% divides evenly.
```

Duas execuções imprimiram 39% e 38% de estornos. O gerador padrão de `long` dá negativos
quase tantas vezes quanto positivos, e por isso o bug apareceu em poucas execuções. Um gerador
que só produzisse valores de 0 a 10 000 teria passado, para sempre.

### Seeds: reproduzindo uma falha

Cada execução usa uma seed nova, então uma propriedade que falhou no CI pode passar na sua
máquina. A mensagem de falha traz o caminho de volta: `Replay directly at failing step with
(seed1, seed2, size)`. Passe os três valores para a configuração:

```csharp
var config = Config.QuickThrowOnFailure.WithReplay(6505255636827669415UL, 5266466383858147523UL, 7);
prop.Check(config);
```

Com os mesmos geradores a propriedade vê os mesmos valores (no lab, o teste que grava os pares
gerados duas vezes com uma seed obtém duas listas iguais). Quando reexecutei os valores de
uma falha no código inicial, a execução reproduziu o `Original` e o `Shrunk` daquela falha.
Um replay depende dos geradores e da versão do FsCheck: mude um dos dois e a mesma seed dá
outros valores. Trate a seed como um jeito de depurar agora, e transforme o contraexemplo
reduzido em um exemplo comum na suíte:

```csharp
[TestMethod]
[DataRow(-1L, 2, new long[] { 0, -1 })]
[DataRow(-7L, 3, new long[] { -2, -2, -3 })]
public void ARefundIsSplitToo(long cents, int parts, long[] expected)
{
    CollectionAssert.AreEqual(expected, MoneySplitter.Split(cents, parts));
}
```

Esse exemplo falha com uma mensagem de uma linha, roda num instante e não precisa de gerador.
A propriedade continua procurando o próximo.

### FsCheck com MSTest 4

Os pacotes de integração do próprio FsCheck são para xUnit (`FsCheck.Xunit`,
`FsCheck.Xunit.v3`) e NUnit (`FsCheck.NUnit`), todos 3.6.0. Não existe `FsCheck.MSTest` do
projeto FsCheck. Existe um pacote da comunidade, `AndreasDorfer.FsCheck.MSTest` 3.0.0 (MIT,
publicado em 2026-01), que dá um atributo `[Property]`. Ele depende de `MSTest.TestFramework`
4.0.2 e do FsCheck 3.3.2. Referenciei o pacote junto de `MSTest` 4.5.3 e `FsCheck` 3.6.0 e
escrevi dois métodos `[Property]` com argumentos e resultado `bool`. A descoberta falhou:

```text
UTA007: Method Reverse defined in class M.T does not have correct signature.
Test method marked with the [TestMethod] attribute must be non-static, public,
return-type as void and should not take any parameter.
```

O adapter do MSTest trata `[Property]` como método de teste e rejeita a assinatura, e o método
de propriedade recebe parâmetros. Não procurei uma configuração que mude isso, então confira o
changelog do pacote antes de tentar com um MSTest mais novo. O que funciona, e é o que o lab
faz, é usar a API direto em um `[TestMethod]` sem parâmetros:
`Prop.ForAll(...).QuickCheckThrowOnFailure()`. Precisa só do pacote `FsCheck`, e a falha é uma
falha normal do MSTest. Rodei com `dotnet test` no modo VSTest; o teste é um método comum, mas
não rodei no Microsoft.Testing.Platform. O custo é que cada propriedade é um teste, não um por
caso gerado, e o número de execuções se configura por chamada:
`Config.QuickThrowOnFailure.WithMaxTest(1000)`, depois `Check.One(config, prop)`.

Também não existe `Prop.Throws` na API de C#. Um teste de que uma entrada inválida lança
captura a exceção dentro da propriedade e devolve `true` para a esperada e `false` para
nenhuma.

### Propriedades e as outras ferramentas

Testes orientados a dados e propriedades não são rivais. As linhas documentam as regras e as
bordas que você conhece (`ARefundIsSplitToo` acima); uma propriedade procura as que você não
conhece. Mutation testing diz que a suíte é fraca, e uma propriedade costuma ser o jeito mais
barato de fortalecê-la, porque uma só mata muitos mutantes. Um gerador de valores de domínio e
um builder do Bogus ou do AutoFixture fazem trabalhos diferentes: o Bogus cria dados realistas
a partir de uma seed, o FsCheck cria dados hostis e os reduz.

## Trade-offs

- **Uma propriedade vale o que vale o seu gerador.** Um gerador que nunca produz estornos,
  listas vazias ou o valor máximo passa para sempre. Confira a distribuição com `Classify` e
  coloque o caso raro no gerador de propósito.
- **Teste aleatório precisa de um caminho de volta.** Sem os valores de replay da mensagem de
  falha, uma falha do CI some na próxima execução. Guarde a mensagem e promova a entrada
  reduzida a exemplo.
- **Custam mais por teste.** São 100 execuções por padrão, então uma propriedade sobre uma
  chamada lenta (banco, arquivo, rede) multiplica o custo. Use propriedades em código puro, ou
  reduza `WithMaxTest` e diga por quê.
- **Achar a propriedade é a parte difícil.** Se a melhor propriedade que você consegue escrever
  é "o resultado é igual ao que o código calcula", pule. Uma tabela de preços, um mapa de
  status para mensagem ou uma regra que é só uma lista de casos fica melhor com linhas.
- **Os testes não são nomeados por caso.** Uma propriedade é um teste no relatório, então o
  número de testes verdes não diz mais quantas entradas foram tentadas.
- **A integração com o MSTest 4 é por sua conta.** Nenhum pacote do projeto FsCheck, e o da
  comunidade não foi descoberto na minha execução. Serve para a API direta, mas você abre mão de
  um atributo e de configuração por anotação em cada propriedade.

## Lab

`MoneySplitter.Split` já está implementado, com quatro testes de exemplo que passam. Seu trabalho é descrevê-lo com propriedades, fazer o FsCheck achar o bug que todos deixaram passar, ler o contraexemplo reduzido e a seed, corrigir o `Split` e guardar o contraexemplo como exemplo.

**O que você vai praticar**

- Escrever propriedades com `Prop.ForAll` dentro de `[TestMethod]`s: soma, quantidade, diferença e ordem das parcelas.
- Escolher e estreitar geradores, dar um shrinker ao `Arb.From` e ver o que custa deixá-lo de fora.
- Ler `Original`, `Shrunk` e os valores de replay em uma mensagem de falha.
- Conferir que uma seed gera as mesmas entradas e transformar um contraexemplo em um exemplo `[DataRow]`.

**Pré-requisitos:** MSTest Data-Driven Tests: DataRow, DynamicData and Custom Sources, MSTest 4 Fundamentals: Lifecycle and TestContext, .NET 10 SDK.

**Como funciona:** o código de produção tem um bug que só uma propriedade acha, e é o único ponto em `src/` que você pode editar, depois que o TODO-00 falhar. Sete métodos de teste falham com `TODO-NN` até você escrevê-los, cinco exemplos passam desde o início e a solution passa 13 de 13.

## Documentation Links

- [FsCheck documentation](https://fscheck.github.io/FsCheck/) (doc)
- [FsCheck on GitHub](https://github.com/fscheck/FsCheck) (doc)
- [FsCheck 3.6.0 on NuGet](https://www.nuget.org/packages/FsCheck/3.6.0) (doc)
- [AndreasDorfer.FsCheck.MSTest on NuGet](https://www.nuget.org/packages/AndreasDorfer.FsCheck.MSTest) (doc)
- [Data-driven testing with MSTest, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-data-driven) (doc)
