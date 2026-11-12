---
version: 1.0
updatedAt: 2026-11-12
title: "Testes de snapshot com Verify"
summary: Grave a saída inteira em arquivos .verified com Verify.MSTest, aprove os .received lendo-os de verdade, limpe datas, Guids e números com scrubbers, saiba onde um snapshot esconde uma regressão, e entenda a licença do Verify 33 (erro SC021 e como declarar), tudo medido no SDK 11 GA.
---
## Objective

Algumas saídas são grandes demais para afirmar uma propriedade de cada vez: uma
fatura com uma dúzia de campos, uma página HTML, um erro com tipo, mensagem e nome
de parâmetro. Um teste de snapshot grava a saída inteira em um arquivo, e a próxima
execução compara a saída com o arquivo. O Verify é a biblioteca de uso geral para
isso no .NET. A ideia é antiga e simples; o trabalho está em três detalhes: limpar o
que muda a cada execução, ler o arquivo antes de aprovar, e saber em quais regras um
snapshot nunca deve ser a única garantia. Este concept também cobre a licença do
Verify 33, porque um projeto que o referencia não compila até declarar alguma coisa.
Versões medidas: `Verify.MSTest` 32.0.0 e 33.3.4, `MSTest` 4.5.3, no SDK .NET 10.0.100 e no
SDK .NET 11.0.100. Sem Docker.

## Use Cases

- Conferir um payload com muitos campos: uma fatura, uma resposta de API, um SQL gerado.
- Conferir texto renderizado, como o HTML de uma view ou de um componente Blazor, em um arquivo que o editor mostra.
- Conferir o tipo, a mensagem e o nome do parâmetro exatos de uma exceção em um lugar só.
- Pôr uma rede de segurança em volta de código que ninguém testou antes de mexer nele.

## Deep Dive

### O que é um teste de snapshot

O lab tem um `InvoiceService` que transforma um pedido em uma `Invoice` com um
`Guid` novo, a hora atual, um número montado com os dois, as linhas e o imposto. O
teste:

```csharp
[TestClass]
[UsesVerify]
public partial class InvoiceSnapshotTests
{
    [TestMethod]
    public Task TheInvoiceObjectIsTheSnapshot()
    {
        var invoice = new InvoiceService().Create(Orders.Coffee());

        return Verify(invoice);
    }
}
```

O `[UsesVerify]` entrega ao Verify o `TestContext` do MSTest (as classes do lab são
`partial`, como mostra a documentação do Verify). Sem ele, a primeira chamada falha com
`TestContext is null. Ensure test class has a [UsesVerify] attribute (or inherits from VerifyBase)`.

Não há valor esperado no teste. A primeira execução falha e grava
`InvoiceSnapshotTests.TheInvoiceObjectIsTheSnapshot.received.txt` ao lado do arquivo
de código. Esse arquivo é o pedido de aprovação:

```text
{
  Id: Guid_1,
  Number: INV-20261112-b4ec4736,
  IssuedAt: DateTimeOffset_1,
  Customer: Ada Lovelace,
  Lines: [
    { Product: Coffee, Quantity: 3, UnitPrice: 0.50, Total: 1.50 },
    ...
  ],
  Subtotal: 5.50,
  Tax: 1.05,
  Total: 6.55,
  Note: Deliver to the back door
}
```

(O arquivo real põe cada propriedade em sua própria linha.) Quando você concordar
com ele, renomeie `.received.txt` para `.verified.txt`. A partir daí o teste fica
verde enquanto a saída for idêntica, e vermelho, com um `.received` novo, quando não
for. Faça commit dos `.verified`. Ignore `*.received.*`. Segundo a documentação do
Verify, uma ferramenta de diff instalada na máquina abre quando o teste falha;
`DiffEngine_Disabled=true` desliga isso no CI.

### Scrubbers: o que muda a cada execução

Olhe o arquivo acima. `Id` é `Guid_1` e `IssuedAt` é `DateTimeOffset_1` sem nenhum
código no teste: o Verify troca valores `Guid` e `DateTimeOffset` por padrão.
`Number` é `INV-20261112-b4ec4736`. É uma string, montada com a data e 8 caracteres do
Guid, e o Verify não tem como saber isso. Rode o teste duas vezes e o `.received` é
diferente nas duas.

Um scrubber reescreve o texto antes da comparação. Uma regex, registrada uma vez para
todo o assembly de testes:

```csharp
public static class VerifySetup
{
    [ModuleInitializer]
    public static void Initialize() =>
        VerifierSettings.ScrubLinesWithReplace(line =>
            Regex.Replace(line, @"INV-\d{8}-[0-9a-f]{8}", "INV-{date}-{id}"));
}
```

Agora `Number` é `INV-{date}-{id}` em todo snapshot. Para um teste só, chame o mesmo
método no resultado de `Verify(...)`. Outros scrubbers vistos no lab:
`ScrubInlineDateTimeOffsets("yyyy-MM-dd HH:mm:ss")` para uma data dentro de texto (o
HTML diz `Issued 2026-11-12 09:20:11 UTC`, que é texto, não um `DateTimeOffset`), e
`IgnoreStackTrace()` para exceções.

A outra forma de ter uma saída estável é controlar a entrada: o serviço recebe um
`TimeProvider`, então o teste pode passar um relógio falso (veja o concept sobre
controlar o tempo com `TimeProvider`). Isso fixa a data, mas não o `Guid`, então aqui
o scrubber continua necessário.

### Arquivos de texto com extensão própria

```csharp
return Verify(InvoiceHtml.Render(invoice), "html")
    .ScrubInlineDateTimeOffsets("yyyy-MM-dd HH:mm:ss");
```

O segundo argumento é a extensão, então os arquivos são `.received.html` e
`.verified.html`, que o editor mostra como HTML e uma ferramenta de diff compara
linha a linha. O segundo teste de HTML usa um cliente chamado
`<b>Acme & Sons</b>` e o arquivo aprovado tem `&lt;b&gt;Acme &amp; Sons&lt;/b&gt;`: o
motivo para ler o arquivo é exatamente que ninguém escreveu uma asserção sobre
escape.

### Exceções

```csharp
return Throws(() => new InvoiceService().Create(new Order("Ada Lovelace", [])))
    .IgnoreStackTrace();
```

O snapshot é `Type: ArgumentException`, `Message: ...`, `ParamName: order`. Sem
`IgnoreStackTrace()` o arquivo também tem a pilha, inclusive o nome gerado pelo
compilador para a lambda (`<>c.<AnEmptyOrderIsRejected>b__0_0`), que muda quando o
código em volta muda.

### Duas coisas que quebram um snapshot em outra máquina

O primeiro `.received.html` do lab tinha `9,90` onde a saída deveria ter `9.90`. A
máquina que o escreveu usa uma cultura com vírgula decimal, e `{value:0.00}` formata
com a cultura atual. Um snapshot aprovado ali falha em um agente de CI com outra
cultura. A correção fica no código de produção (`CultureInfo.InvariantCulture`), e a
mesma cultura fez `decimal.Parse("0.50")` lançar exceção na primeira versão de um
teste. A segunda é codificação e fim de linha: o Verify grava os arquivos em UTF-8 com
BOM. A documentação do Verify recomenda um `.gitattributes` com
`*.verified.txt text eol=lf working-tree-encoding=UTF-8` (e o mesmo para `.html`) para
o Git não reescrever os arquivos entre sistemas operacionais.

### Onde um snapshot mente

Um snapshot grava o que o código fez, não o que ele deveria fazer. A solution do lab
tem uma regra escrita como asserções comuns ao lado dos snapshots: para o pedido de
café, o subtotal é 5,50 e o imposto é 1,05 (19% de 5,50 é 1,045, arredondado para
longe do zero), um literal calculado à mão. Depois, o teste do hábito que arruína
suítes de snapshot. Troque a alíquota para 0,21 no `InvoiceService`:

- 4 testes falham: os três snapshots com imposto e a asserção escrita à mão.
- Renomeie todo `.received` para `.verified`, que é o que alguém com pressa faz, e
  rode de novo: 1 teste falha, a asserção escrita à mão.

Sem essa asserção, a alíquota errada teria ido para produção com a suíte verde.
Mutar o código de produção uma mudança por vez (a tabela está na solution do lab)
mostra os dois lados: remover o `HtmlEncode` do nome do cliente só é pego pelo
snapshot de HTML, porque ninguém escreveu uma asserção sobre escape, e a alíquota
0,21 é pega pelos dois. Então use snapshot para o formato, e asserções para as regras
que precisam valer: o total é o subtotal mais o imposto para qualquer entrada, um
número que você mesmo calculou, um limite.

A visão por mutação disso está no próximo concept, sobre mutation testing com
Stryker.NET.

### A licença do Verify 33

O Verify 33 e posteriores checam, na compilação, se o projeto declara a sua situação
quanto à Open Source Maintenance Fee. Sem declarar nada, nos dois SDKs:

```text
Verify.targets(172,5): SponsorCheck error SC021: No license specified. Package 'Verify' requires a SponsorCheck license property.
```

A mensagem lista as opções. São propriedades MSBuild, definidas uma vez em um
`Directory.Build.props` ou no projeto de testes. Segundo a página oficial, a taxa
cobre o uso dos pacotes oficiais do NuGet lançados depois de 1º de setembro de 2026,
por organizações que geram receita com eles (receita bruta anual de pelo menos
US$ 10 mil) e por órgãos de governo. Pessoas físicas, projetos open source sem receita
e organizações abaixo do limite são isentos. A taxa é um tier do GitHub Sponsors por
porte da organização, de US$ 5 por mês (menos de 40 funcionários) a US$ 100 por mês
(mais de 1000). O que medi no Verify 33.3.4:

| Declaração | Resultado |
| --- | --- |
| nada | `SC021`, o build falha |
| `Verify_GitHubSponsorAccount` com a conta que patrocina | compila (segundo a página; não rodei, precisa de um patrocínio real) |
| `Verify_SponsorshipExemption=OpenSource` mais `Verify_SponsorshipExemptionUntil=2027-10` | compila, os testes passam (`SmallRevenue` funciona igual, segundo a página) |
| o mesmo com `...Until=2028-10` | `SC046: Exemption end date too far in the future (maximum 2027-11)` |
| `Verify_SponsorshipLicenseIgnored=true` | compila com o aviso `SC023`: "in breach of the package license" |

```xml
<PropertyGroup>
  <Verify_SponsorshipExemption>OpenSource</Verify_SponsorshipExemption>
  <Verify_SponsorshipExemptionUntil>2027-10</Verify_SponsorshipExemptionUntil>
</PropertyGroup>
```

Uma isenção precisa ser renovada no máximo a cada 12 meses, e é uma declaração sobre
quem usa o código. Nada é enviado para lugar nenhum: a checagem roda dentro do build.
Leia a página oficial antes de escolher, porque ela é a fonte (e isto não é
aconselhamento jurídico):
[maintenance-fee.md](https://github.com/VerifyTests/Verify/blob/main/docs/maintenance-fee.md).

O lab fixa `Verify.MSTest` 32.0.0, publicado em 2026-08-26, antes da data da taxa, sem
SponsorCheck. O motivo não é o dinheiro: um lab público não pode declarar uma isenção
em nome de quem o copia, e uma que expira quebraria o lab em um ano. Tudo o que ele
ensina vale igual no 33. No seu projeto a escolha é sua: declarar, patrocinar, ou
ficar na 32.x e aceitar que ela não recebe mais correções.

## Trade-offs

- **Aprovar está a um rename de não ler.** A técnica inteira depende de abrir o
  `.received`. Exemplo: a alíquota 0,21 acima ficou verde com três renames. Mantenha
  as regras que importam como asserções.
- **Um snapshot grande tem muitos motivos para mudar.** Acrescente um campo em
  `Invoice` e todo snapshot de fatura muda, então uma regressão de verdade se esconde
  em um diff de cem linhas. Faça snapshot da parte que importa, não do objeto inteiro.
- **Um scrubber também é código.** Monte o número com 6 caracteres do Guid em vez de 8
  e a regex deixa de casar: os três snapshots falham, por um motivo que não tem nada
  a ver com faturas.
- **A saída depende da máquina.** Cultura, fuso, codificação e fim de linha aparecem
  em um arquivo de texto. Fixe-os no código sob teste ou no setup.
- **A versão é uma decisão.** O Verify 33 exige declaração; a 32.0.0 compila sem ela e
  não recebe mais correções.
- **Snapshot é um mau encaixe para regras.** "O total é o subtotal mais o imposto"
  vale para toda entrada; um snapshot vale para uma.

## Lab

O serviço de faturas e o renderizador de HTML já estão implementados. Seu trabalho é escrever os testes de snapshot, seguir o fluxo received e verified à mão, e depois escrever os testes que nenhum snapshot substitui.

**O que você vai praticar**

- Escrever um teste com Verify, ler o arquivo `.received` e aprová-lo.
- Limpar o número da fatura com um scrubber para o assembly inteiro, e a data dentro do texto do HTML.
- Fazer snapshot de HTML como `.verified.html` e de uma exceção sem a pilha.
- Escrever as invariantes como asserções comuns, e aprovar de propósito uma alíquota errada para ver o que sobra vermelho.

**Pré-requisitos:** MSTest Fundamentals: Lifecycle and TestContext, SDK .NET 10.

**Como funciona:** o starter tem 7 testes que falham com `TODO-NN` e nenhum arquivo `.verified`. A solution tem os arquivos e 10 testes passando. O README do lab explica a versão do Verify que ele fixa.

## Documentation Links

- [Verify, GitHub](https://github.com/VerifyTests/Verify) (doc)
- [Open Source Maintenance Fee for Verify](https://github.com/VerifyTests/Verify/blob/main/docs/maintenance-fee.md) (doc)
- [SponsorCheck diagnostic codes (SC021, SC023, SC046)](https://github.com/SimonCropp/SponsorCheck/blob/main/docs/VerifierDiagnosticCodes.md) (doc)
- [Verify.MSTest on NuGet](https://www.nuget.org/packages/Verify.MSTest) (doc)
- [Open Source Maintenance Fee, FAQ for consumers](https://opensourcemaintenancefee.org/consumers/faq/) (doc)
