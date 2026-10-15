---
version: 1.0
updatedAt: 2026-10-15
title: "Formatando Valores: Strings Interpoladas, Especificadores e Culturas"
summary: A sintaxe {valor,largura:formato}, o que o compilador faz com uma string interpolada (handler), a armadilha da cultura ao gravar e ler números, IFormattable, ISpanFormattable e CompositeFormat.
---
## Objective

Transformar um valor em texto parece trivial e esconde três assuntos reais: a
sintaxe dos especificadores de formato e do alinhamento, o que o compilador faz
com uma string interpolada e qual cultura a conversão usa. O primeiro é uma
tabela de consulta. O segundo explica por que `$"{x}"` costuma ser mais barato
que `string.Format` e como um interpolated string handler pode pular o trabalho
inteiro. O terceiro é um bug clássico de produção: um número escrito com a
cultura da máquina e depois lido em outro lugar com outra cultura. Este conceito
cobre a sintaxe de buraco `{valor,largura:formato}`, as format strings padrão e
customizadas, o padrão de handler, `IFormattable` e `ISpanFormattable`,
`CompositeFormat` e as regras de cultura.

## Use Cases

- Imprimir tabelas alinhadas em uma ferramenta de console ou em uma linha de log
  com `{name,-12}{price,10:N2}`.
- Gravar números e datas em um arquivo, um header ou uma query string que outro
  sistema precisa ler de volta.
- Construir uma API de logging que não formata a mensagem quando o nível está
  desligado.
- Fazer seu próprio tipo funcionar com `$"{money:long}"` e com spans.

## Deep Dive

### A sintaxe do buraco e os especificadores comuns

Um buraco em uma string interpolada é `{expressão[,largura][:formato]}`. Uma
largura positiva alinha à direita em pelo menos esse número de caracteres, uma
largura negativa alinha à esquerda, e a format string é repassada à formatação
do valor. Dois-pontos dentro da expressão exigem parênteses, então escreva
`{(n > 40 ? "big" : "small")}`; `{{` e `}}` produzem chaves literais. Saída com
`CultureInfo.InvariantCulture`:

```csharp
double d = 1234567.891; int n = 42; var when = new DateTime(2026, 10, 15, 9, 5, 7, DateTimeKind.Utc);
$"{d:N2}"   // 1,234,567.89   número com separador de milhar
$"{d:F1}"   // 1234567.9      ponto fixo
$"{d:E2}"   // 1.23E+006      científico
$"{d:C}"    // ¤1,234,567.89  moeda (a cultura invariante só tem um símbolo genérico)
$"{0.256:P1}" // 25.6 %       percentual, multiplica por 100
$"{n:D5}"   // 00042          inteiro preenchido com zeros
$"{255:X4}" // 00FF           hexadecimal, minúsculo com x
$"[{n,8}] [{n,-8}] [{"ab",5}]"  // [      42] [42      ] [   ab]
$"{when:yyyy-MM-dd HH:mm:ss}"   // 2026-10-15 09:05:07
$"{when:O}"                     // 2026-10-15T09:05:07.0000000Z  round trip, ordenável
```

Formatos numéricos customizados usam placeholders: `0` força um dígito, `#`
mostra um dígito só se existir, `,` agrupa e `;` separa até três seções para
valores positivos, negativos e zero:

```csharp
$"{d:0.00}"             // 1234567.89
$"{d:#,##0.0}"          // 1,234,567.9
$"{0:+0;-0;zero}"       // zero
$"{1234:00-00}"         // 12-34   outros caracteres são copiados entre os dígitos
$"{0.5:#.##}"           // .5
$"{0.0:#.##}"           // (string vazia)
```

Os dois últimos são as surpresas de sempre: `#` nunca inventa um zero à
esquerda ou à direita, então um zero pode virar string vazia.

### Em que a string interpolada se transforma

Se o tipo de destino de uma string interpolada é `string`, o compilador usa o
`DefaultInterpolatedStringHandler` (o assembly compilado do experimento
referencia esse tipo e o método `ToStringAndClear`), um `ref struct` que formata
direto em um buffer do pool. A página do Microsoft Learn acrescenta que o
compilador pode usar `string.Concat` quando for equivalente. Se o destino é
`IFormattable` ou `FormattableString`, ele chama
`FormattableStringFactory.Create`, que mantém o formato e os argumentos
separados.

O padrão de handler é público, então dá para enxergá-lo escrevendo o seu. O
compilador chama um construtor com o tamanho total dos literais e o número de
buracos, depois `AppendLiteral` e `AppendFormatted<T>` em ordem. Um parâmetro de
construtor `out bool shouldAppend` deixa o handler dizer "nem se dê ao
trabalho":

```csharp
log.Debug($"hello {who} id={n,5:D3} done");   // logger ligado
//   ctor literalLength=15 formattedCount=2 enabled=True
//   AppendLiteral(hello )
//   AppendFormatted<String>(Ana)
//   AppendLiteral( id=)
//   AppendFormatted<Int32>(42, 5, D3)
//   AppendLiteral( done)

log.Enabled = false;
log.Debug($"skipped {Expensive()}");
//   ctor literalLength=8 formattedCount=1 enabled=False
// Expensive() nunca foi chamada: 0 chamadas
```

A primeira chamada mostra que o tipo de cada buraco é conhecido em tempo de
compilação (sem boxing, `AppendFormatted<Int32>`) e que largura e formato chegam
como argumentos separados. A segunda mostra o truque principal: com
`shouldAppend` falso o compilador pula as chamadas restantes, e isso inclui
avaliar as expressões dos buracos. A mesma página de documentação avisa sobre o
outro lado da moeda, já que efeitos colaterais em um buraco podem não rodar.
`Debug.Assert(true, $"v={E()}")` é um exemplo do próprio framework: quando a
asserção vale, `E()` nunca é chamada (0 chamadas no experimento).

O custo aparece nas alocações. Medido com `GC.GetAllocatedBytesForCurrentThread`
em build Release no .NET 10.0.0, bytes por chamada, incluindo a string de
resultado:

| Expressão | Bytes |
|---|---|
| `$"{v}-{s}"` (int, string) | 48 |
| `string.Format("{0}-{1}", v, s)` | 72 |
| `v.ToString() + "-" + s` | 88 |
| `$"{dd}"` (double) | 32 |
| `string.Format("{0}", dd)` | 56 |
| `string.Format("{0}{1}{2}{3}", v, v, v, v)` (4 ints) | 168 |
| `$"{v}{v}{v}{v}"` | 72 |

A diferença é o boxing: `string.Format` recebe `params object?[]`, então cada
int ou double vira um objeto e os argumentos precisam de um array, enquanto o
handler continua genérico. Os números são desta execução, mas a ordem é estável.

### Cultura: o bug silencioso

Por padrão todo buraco é formatado com `CultureInfo.CurrentCulture`. O mesmo
código dá textos diferentes por máquina:

```csharp
foreach (var name in new[] { "en-US", "pt-BR", "de-DE" })
{
    CultureInfo.CurrentCulture = new CultureInfo(name);
    Console.WriteLine($"{name}: {1234567.891} | {1234567.891:N2} | {when:d} | {1.5}");
}
// en-US: 1234567.891 | 1,234,567.89 | 10/15/2026 | 1.5
// pt-BR: 1234567,891 | 1.234.567,89 | 15/10/2026 | 1,5
// de-DE: 1234567,891 | 1.234.567,89 | 15.10.2026 | 1,5
```

Isso é correto para texto mostrado a uma pessoa e errado para dado. Um
`price=1,5` escrito em uma máquina pt-BR vira bug em um serviço que espera ponto.
Na leitura é pior: com a cultura invariante, a vírgula é separador de milhar,
então

```csharp
double.Parse("1,5", CultureInfo.InvariantCulture)   // 15, sem exceção
```

devolve 15 e não 1.5. Para texto legível por máquina, passe a cultura
explicitamente. As opções documentadas são
`string.Create(CultureInfo.InvariantCulture, $"...")` (.NET 6+),
`FormattableString.Invariant($"...")` e
`value.ToString(CultureInfo.InvariantCulture)`; as três deram `price=1.5` no
experimento. Um `FormattableString` também expõe o que o handler esconde:

```csharp
FormattableString fs = $"x={1.5:N2} y={n}";
fs.Format          // x={0:N2} y={1}
fs.ArgumentCount   // 2
fs.ToString(CultureInfo.InvariantCulture)   // x=1.50 y=42
```

### IFormattable, ISpanFormattable e CompositeFormat

Um tipo decide o que suas format strings significam implementando
`IFormattable`: `ToString(string? format, IFormatProvider? provider)`.
`ISpanFormattable` acrescenta `TryFormat(Span<char>, out int, ReadOnlySpan<char>,
IFormatProvider?)` para que o handler escreva direto no seu buffer sem criar
uma string intermediária. Um tipo pequeno que suporta os dois:

```csharp
readonly record struct Money(decimal Amount, string Currency) : IFormattable, ISpanFormattable
{
    public string ToString(string? format, IFormatProvider? provider)
    {
        var p = provider ?? CultureInfo.CurrentCulture;
        return format == "long" ? $"{Amount.ToString("N2", p)} {Currency}"
                                : $"{Amount.ToString("0.##", p)}{Currency[0]}";
    }
    public bool TryFormat(Span<char> dest, out int written, ReadOnlySpan<char> format, IFormatProvider? provider)
    {
        var s = ToString(format.ToString(), provider);
        written = 0;
        if (s.Length > dest.Length) return false;
        s.CopyTo(dest); written = s.Length; return true;
    }
}

var m = new Money(12.5m, "EUR");
$"{m} | {m:short} | {m:long} | {m,14:long}|"   // 12.5E | 12.5E | 12.50 EUR |      12.50 EUR|
Span<char> buf = stackalloc char[64];
buf.TryWrite($"{m:short} {n}", out int w);     // true, w = 8, "12.5E 42"
```

O `TryFormat` do exemplo ainda cria uma string internamente para ficar curto; um
de verdade formata as partes direto em `dest`. `TryWrite` (sobre um
`Span<char>`) e `Utf8.TryWrite` (sobre um `Span<byte>`) escrevem uma string
interpolada direto em um buffer fornecido pelo chamador, sem construir a string
de resultado.

Quando o template é uma constante reutilizada muitas vezes (uma mensagem de log,
uma string de recurso), `CompositeFormat.Parse("{0}-{1}")` (.NET 8+) o analisa
uma vez, e `string.Format(null, compositeFormat, v, s)` o reaproveita. No
experimento essa chamada alocou 48 bytes, o mesmo da versão interpolada, contra
72 do `string.Format` comum.

## Trade-offs

- **Interpolação é o padrão legível, nem sempre o mais rápido.** Ela ganha do
  `string.Format` em alocação, mas em um laço que monta uma string grande um
  `StringBuilder` ou um writer baseado em span evita as strings intermediárias.
- **A cultura atual é correta para pessoas e errada para dados.** Tudo que vai
  para um arquivo, um header, uma chave de cache ou uma query string deve usar a
  cultura invariante de forma explícita, porque `ToString()` segue a máquina.
  ```csharp
  var key = string.Create(CultureInfo.InvariantCulture, $"price:{price}");
  ```
- **Handlers pulam a avaliação, o que é recurso e armadilha.** Um buraco com
  efeito colateral (`$"{queue.Dequeue()}"`) dentro de uma chamada de log
  desligada nunca roda. Mantenha os buracos puros.
- **Format strings são strings comuns, verificadas em tempo de execução.** Um
  especificador errado falha ou formata mal só quando aquela linha executa, e um
  formato desconhecido no seu próprio tipo `IFormattable` exige uma
  `FormatException` deliberada. Cubra os especificadores suportados em testes.
- **`ISpanFormattable` é código extra com ganho mensurável só em caminhos
  quentes.** Para um tipo formatado poucas vezes por requisição, só
  `IFormattable` basta.
- **`CompositeFormat` compensa só para templates reutilizados.** Analisar uma vez
  é custo para um template usado uma única vez, e você precisa guardar o objeto
  analisado em algum lugar (um campo `static readonly`).

## Documentation Links

- [String interpolation using $, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/interpolated) (doc)
- [Composite formatting, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/composite-formatting) (doc)
- [Standard numeric format strings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/standard-numeric-format-strings) (doc)
- [Custom numeric format strings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/custom-numeric-format-strings) (doc)
- [Write a custom string interpolation handler, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/performance/interpolated-string-handler) (doc)
- [Formatting types in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/formatting-types) (doc)
- [CompositeFormat class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.compositeformat) (doc)
