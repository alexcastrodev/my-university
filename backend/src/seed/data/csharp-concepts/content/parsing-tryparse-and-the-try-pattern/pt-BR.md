---
version: 1.0
updatedAt: 2026-10-15
title: "Parsing, TryParse e o Padrão Try"
summary: Parse versus TryParse, o que os NumberStyles padrão aceitam, a cultura do lado da leitura (com saída real do bug), datas com TryParseExact, armadilhas do Enum.TryParse, IParsable e ISpanParsable, como escrever o próprio método Try e o custo medido da exceção.
---
## Objective

Texto é de onde vêm números, datas e enums: formulários, arquivos, query
strings, headers, configuração. Transformar esse texto em valores tipados é o
lugar mais comum em que uma exceção vira evento normal, e o lugar mais comum em
que um bug de cultura vira corrupção silenciosa de dados. Este conceito cobre
as duas famílias de métodos de parsing (`Parse` e `TryParse`), o que os
`NumberStyles` padrão aceitam, as regras de cultura do lado da leitura, o
parsing exato de datas, o `Enum.TryParse` e suas armadilhas, as interfaces
`IParsable<T>` e `ISpanParsable<T>` que unificam tudo isso, e como escrever seu
próprio método `Try` com a semântica certa. O lado da formatação do problema de
cultura está em `formatting-values-and-interpolated-strings`; este conceito
acrescenta o lado da leitura com saída medida.

## Use Cases

- Ler um campo digitado ou um campo de CSV para um número sem um try/catch em
  volta de cada linha.
- Interpretar datas que chegam como `dd/MM/yyyy`, ISO 8601 com offset ou vários
  formatos aceitos.
- Ligar um argumento de linha de comando, uma variável de ambiente ou um valor
  de query string a um enum.
- Escrever um método genérico (`T Read<T>(string s) where T : IParsable<T>`) e
  um tipo de valor que faz parsing como os tipos internos.
- Escolher entre uma API baseada em exceção e uma API `TryX` ao desenhar uma
  biblioteca.

## Deep Dive

A saída é do .NET 10 (SDK 10.0.100) em arm64. Salvo quando uma cultura é
nomeada, os exemplos colocam `CultureInfo.CurrentCulture` na cultura invariante,
para que a saída não dependa da máquina.

### `Parse` lança, `TryParse` responde

`Parse` devolve o valor ou lança exceção. `TryParse` devolve um `bool` e coloca
o valor em um parâmetro `out`, então não há exceção para entrada ruim comum:

```csharp
int.Parse("42")                // 42
int.Parse("4x")                // FormatException
int.Parse("")                  // FormatException
int.Parse(null)                // ArgumentNullException
int.Parse("2147483648")        // OverflowException

if (int.TryParse(text, out var n)) { /* n é válido */ }
int.TryParse((string?)null, out var a)   // False, a = 0
int.TryParse("4x", out var b)            // False, b = 0
int.TryParse("2147483648", out var c)    // False, c = 0  (overflow é só false)
```

A declaração `out var` (C# 7) mantém o valor no escopo depois do `if`. Na
falha o valor de saída é `default` (a documentação diz zero), e ele é
sobrescrito mesmo que tivesse algo antes, então nunca leia sem checar o
resultado.

Uma exceção continua existindo no `TryParse`, porque o "Try" cobre só a falha
bem definida do texto. Uma combinação inválida de `NumberStyles` é erro de
programação, e continua lançando `ArgumentException`:

```csharp
int.TryParse("1", NumberStyles.HexNumber | NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out _);
// ArgumentException: With the AllowHexSpecifier or AllowBinarySpecifier bit set ...
int.TryParse("1", (NumberStyles)0x10000000, CultureInfo.InvariantCulture, out _);
// ArgumentException: An undefined NumberStyles value is being used.
```

### O que o texto pode conter: `NumberStyles`

Cada tipo numérico tem um estilo padrão, e ele é mais estrito para inteiros do
que para ponto flutuante. O padrão de inteiros (`NumberStyles.Integer`) permite
espaço em branco no início e no fim e um sinal no início. O padrão de ponto
flutuante (`Float | AllowThousands`) também permite ponto decimal, expoente e
separadores de grupo:

```csharp
// int.TryParse (estilo padrão)
" 42 " -> 42     "+42" -> 42     "-42" -> -42
"(42)" "1,234" "1_000" "1e3" "42.0" "0x2A"   -> false

// double.TryParse(s, InvariantCulture, out ...)
"1.5" -> 1.5    "1,234.5" -> 1234.5   "1e3" -> 1000   "1E-2" -> 0.01
".5" -> 0.5     "5." -> 5             " 3.14 " -> 3.14
"NaN" -> NaN    "Infinity" -> Infinity    "-Infinity" -> -Infinity
"1e400" -> Infinity    (true, e o valor é infinito)
"1,5" -> 15            (a vírgula é separador de grupo, sem erro)
"0x10" "1 234.5" "∞"  -> false
```

A linha do `1e400` importa: um texto que estoura o `double` ainda devolve `true`
com `Infinity`. `int`, `decimal` e os outros tipos inteiros devolvem `false`
em overflow. Valide com `double.IsFinite` depois de fazer parsing de entrada
externa.

Você escolhe o estilo explicitamente quando o padrão está errado:

```csharp
int.TryParse("1,234", NumberStyles.Integer | NumberStyles.AllowThousands, inv, out v)  // True 1234
int.TryParse("FF", NumberStyles.HexNumber, inv, out v)           // True 255
int.TryParse("0xFF", NumberStyles.HexNumber, inv, out v)         // False (prefixo não é permitido)
int.TryParse("FFFFFFFF", NumberStyles.HexNumber, inv, out v)     // True -1 (complemento de dois)
decimal.TryParse("$1,234.50", NumberStyles.Currency, en-US, out d)    // True 1234.50
decimal.TryParse("1.234,50 €", NumberStyles.Currency, de-DE, out d)   // True 1234.50
int.TryParse(" 42", NumberStyles.None, inv, out v)               // False (só dígitos)
uint.TryParse("-0", out u)  // True 0     uint.TryParse("-1", out u)  // False
```

`decimal.Parse` mantém a escala do texto (`"1.10"` dá `1.10`, `"1.100"` tem
`Scale` 3) e `NumberStyles.Float` aceita `"1e2"` como `100`. Um valor fora da
faixa do decimal, como `"1e29"`, é `false`.

### A cultura do lado da leitura

`Parse` e `TryParse` sem provider usam `CultureInfo.CurrentCulture`. O mesmo
texto dá números diferentes em lugares diferentes, e muitas vezes não dá erro.
Saída de `double.TryParse(text, Float | AllowThousands, culture, ...)`:

```csharp
cultura   texto        valor
invariant "1,234.56"   1234.56
en-US     "1,234.56"   1234.56
pt-BR     "1.234,56"   1234.56
de-DE     "1.234,56"   1234.56
invariant "1.234,56"   false
pt-BR     "1,234.56"   false
pt-BR     "1.5"        15        <- o ponto é separador de grupo, em silêncio
invariant "1,5"        15        <- a vírgula é separador de grupo, em silêncio
pt-BR     "1,5"        1.5
pt-BR     "1.234"      1234      <- mil, não 1.234
invariant "1.234"      1.234
```

As linhas perigosas são as sem erro. Um valor escrito por uma máquina pt-BR e
lido por um parser invariante fica errado por um fator de 10:

```csharp
CultureInfo.CurrentCulture = new CultureInfo("pt-BR");
string written = 1234.5.ToString();                  // "1234,5"
double.Parse(written, CultureInfo.InvariantCulture)  // 12345
double.Parse(written, new CultureInfo("pt-BR"))      // 1234.5
1234.5.ToString(CultureInfo.InvariantCulture)        // "1234.5"  (seguro para guardar)
```

A regra é simétrica à da formatação: dado que um programa guarda ou troca usa
`CultureInfo.InvariantCulture` nas duas pontas, e o texto que uma pessoa digita
é lido com a cultura dessa pessoa. Separadores de grupo também são dado de
cultura: `de-CH` usa `'` e `fr-FR` usa U+202F (espaço estreito sem quebra), e
nesta execução `"1 234,5"` com espaço normal e com U+202F foram lidos como
`1234.5` em `fr-FR`, então testes com texto copiado de uma planilha merecem um
caso real.

### Datas e horas

`DateTime.TryParse` depende da cultura tanto quanto os números, e uma data tem
duas interpretações que parecem ambas válidas:

```csharp
cultura   texto         data
invariant "03/04/2026"  2026-03-04
en-US     "03/04/2026"  2026-03-04
pt-BR     "03/04/2026"  2026-04-03
de-DE     "03.04.2026"  2026-04-03
invariant "2026-04-03"  2026-04-03   (a ordem ISO não é ambígua)
en-US     "13/04/2026"  false
invariant "2026-02-30"  false
```

Quando o formato faz parte de um contrato, use `TryParseExact` com o formato e
`InvariantCulture`. Ele é estrito quanto à forma:

```csharp
DateTime.TryParseExact("03/04/2026", "dd/MM/yyyy", inv, DateTimeStyles.None, out d)   // 2026-04-03
DateTime.TryParseExact("03/04/2026", "MM/dd/yyyy", inv, DateTimeStyles.None, out d)   // 2026-03-04
DateTime.TryParseExact("3/4/2026", "dd/MM/yyyy", inv, DateTimeStyles.None, out d)     // False
DateTime.TryParseExact("3/4/2026", "d/M/yyyy", inv, DateTimeStyles.None, out d)       // True
DateTime.TryParseExact("03/04/2026 ", "dd/MM/yyyy", inv, DateTimeStyles.AllowWhiteSpaces, out d) // True
DateTime.TryParseExact("2026-04-03", new[] { "yyyy-MM-dd", "dd/MM/yyyy" }, inv, DateTimeStyles.None, out d) // True
```

`DateOnly.TryParseExact` e `TimeOnly.TryParse` existem para valores que não são
instantes. Para um instante com offset, prefira `DateTimeOffset`, porque o
`DateTime` perde o offset: `DateTime.Parse("2026-10-15T09:05:07Z")` devolveu um
`DateTime` com `Kind=Local`, já convertido para o fuso da máquina
(`10:05:07+01:00` aqui), enquanto `DateTimeStyles.RoundtripKind` manteve
`Kind=Utc` e `09:05:07Z`. Uma string sem fuso dá `Kind=Unspecified`.
`DateTimeOffset.TryParse("2026-10-15T09:05:07+02:00")` mantém o `+02:00`.

`TimeSpan.TryParse("90")` é `90.00:00:00`, noventa dias, porque um número solto
é dias. Para horas de relógio use `TryParseExact` com um formato como
`"hh\\:mm"`.

### `Enum.TryParse` e suas armadilhas

```csharp
enum Color { Red, Green, Blue }
Enum.TryParse<Color>("Green", out c)          // True Green
Enum.TryParse<Color>("green", out c)          // False  (diferencia maiúsculas por padrão)
Enum.TryParse<Color>("green", true, out c)    // True Green
Enum.TryParse<Color>(" Green ", out c)        // True Green (espaços são removidos)
Enum.TryParse<Color>("1", out c)              // True Green  (um número é aceito)
Enum.TryParse<Color>("99", out c)             // True 99     (não é um membro definido)
Enum.IsDefined(c)                             // False
Enum.TryParse<Color>("-1", out c)             // True -1
Enum.TryParse<Color>("Red, Blue", out c)      // True Blue   (combinado, mesmo sem [Flags])
Enum.Parse<Color>("Purple")                   // ArgumentException
```

Um enum é um inteiro com nomes, então o parser aceita qualquer texto de
inteiro, e `true` não significa que o valor é um membro declarado. Quando o
texto vem de fora, siga o parse com `Enum.IsDefined`, ou rejeite textos que
começam com dígito ou sinal de menos. Em enums `[Flags]` o separador é a
vírgula: `"Read, Write"` dá `Read, Write` (3) e `"Read|Write"` é `false`.

### `IParsable<T>` e `ISpanParsable<T>`

O .NET 7 transformou a convenção em interfaces. `IParsable<TSelf>` declara dois
membros estáticos, e `ISpanParsable<TSelf>` acrescenta os overloads com
`ReadOnlySpan<char>`:

```csharp
public interface IParsable<TSelf> where TSelf : IParsable<TSelf>
{
    static abstract TSelf Parse(string s, IFormatProvider? provider);
    static abstract bool TryParse([NotNullWhen(true)] string? s, IFormatProvider? provider, out TSelf result);
}
```

`int`, `double`, `decimal`, `DateTime`, `DateOnly`, `TimeSpan`, `Guid`,
`IPAddress` e os outros tipos numéricos a implementam (a página do Microsoft
Learn lista todos), e os tipos numéricos também implementam
`IUtf8SpanParsable<T>`, então `int.TryParse("12345"u8, out v)` faz parsing
direto de bytes UTF-8. Como os membros são `static abstract`, um método
genérico faz parsing sem reflection:

```csharp
static IEnumerable<T> ParseAll<T>(string text, IFormatProvider? p) where T : IParsable<T>
{
    foreach (var part in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        yield return T.Parse(part, p);
}

ParseAll<int>("1 2 3", inv)                        // 1,2,3
ParseAll<double>("1.5 2.5", inv)                   // 1.5,2.5
ParseAll<DateOnly>("2026-10-15 2026-10-16", inv)   // 10/15/2026,10/16/2026 (impresso pelo DateOnly.ToString)
static T TryParseOrDefault<T>(string s, T fallback, IFormatProvider? p) where T : IParsable<T>
    => T.TryParse(s, p, out var r) ? r : fallback;
```

Seu próprio tipo entra na família implementando a interface. Os overloads de
span guardam a lógica, e os de string delegam para eles:

```csharp
readonly record struct Point(double X, double Y) : ISpanParsable<Point>
{
    public static Point Parse(string s, IFormatProvider? provider)
    {
        ArgumentNullException.ThrowIfNull(s);
        return Parse(s.AsSpan(), provider);
    }
    public static Point Parse(ReadOnlySpan<char> s, IFormatProvider? provider)
        => TryParse(s, provider, out var r) ? r : throw new FormatException($"'{s}' is not a Point (expected X;Y).");
    public static bool TryParse([NotNullWhen(true)] string? s, IFormatProvider? provider, out Point result)
        => TryParse(s.AsSpan(), provider, out result);
    public static bool TryParse(ReadOnlySpan<char> s, IFormatProvider? provider, out Point result)
    {
        result = default;
        int semi = s.IndexOf(';');
        if (semi < 0) return false;
        if (!double.TryParse(s[..semi], NumberStyles.Float, provider, out var x)) return false;
        if (!double.TryParse(s[(semi + 1)..], NumberStyles.Float, provider, out var y)) return false;
        result = new Point(x, y);
        return true;
    }
}

Point.Parse("3.5;-2", inv)        // Point { X = 3.5, Y = -2 }
Point.Parse("3,5;-2", pt-BR)      // Point { X = 3.5, Y = -2 }
Point.TryParse("3.5", inv, out p)       // False
Point.TryParse((string?)null, inv, out p)  // False
Point.Parse("a;b", inv)           // FormatException: 'a;b' is not a Point (expected X;Y).
Point.Parse(null!, inv)           // ArgumentNullException
```

O `provider` é repassado às chamadas internas, então o tipo não decide a cultura
por conta própria. Fazer parsing a partir de um span também evita alocações.
Este laço soma os campos válidos de uma linha sem criar nenhuma substring:

```csharp
ReadOnlySpan<char> line = "10,20,x,40";
int total = 0, bad = 0;
foreach (var range in line.Split(','))
    if (int.TryParse(line[range], inv, out var v)) total += v; else bad++;
// total 70, bad 1
```

### Escrevendo seu próprio método `Try`

As Framework Design Guidelines (a página do Microsoft Learn é uma reimpressão
da edição de 2008 e avisa que partes podem estar desatualizadas, mas o padrão é
o que a BCL ainda segue) definem a forma: o nome começa com `Try`, o tipo de
retorno é `bool`, o resultado vai em um parâmetro `out`, e você também fornece
a contraparte que lança exceção. O `Try` cobre uma falha bem definida; qualquer
outra coisa (um argumento nulo que é bug, uma opção inválida) continua
lançando.

```csharp
readonly record struct Percent(int Value)
{
    public static bool TryParse(string? s, out Percent result)
    {
        result = default;
        if (s is null || !s.EndsWith('%')) return false;
        if (!int.TryParse(s.AsSpan(0, s.Length - 1), NumberStyles.None, CultureInfo.InvariantCulture, out var v) || v > 100)
            return false;
        result = new Percent(v);
        return true;
    }
}
// "45%" -> True 45    "145%" -> False    "abc" -> False

record Customer(int Id, string Name)
{
    public static bool TryFind(int id, [NotNullWhen(true)] out Customer? customer)
        => Db.TryGetValue(id, out customer);
}
```

Atribua `result` primeiro (o compilador obriga) e use `[NotNullWhen(true)]` em
um parâmetro out de tipo por referência para que os chamadores tenham análise
de nulidade: depois de `if (TryFind(1, out var c))`, `c` é conhecido como não
nulo. A mesma forma está por toda a BCL: `Dictionary.TryGetValue`,
`Queue.TryDequeue`, `Guid.TryParse`, `Uri.TryCreate`. A alternativa mais antiga
é o padrão tester-doer (`if (dict.ContainsKey(k)) use(dict[k])`), que faz duas
buscas e tem uma janela de corrida em código concorrente; o método Try faz o
teste e o trabalho em uma chamada.

### O custo da exceção, medido

Build Release, sem debugger anexado, 200.000 parses de `int` em que 6 de 8
entradas são inválidas:

```csharp
Parse + catch (FormatException)   427 ms
TryParse                            1 ms

um Parse + catch com falha          2.7 us
um TryParse com falha               5.5 ns
um Parse com sucesso                5.0 ns
```

Um throw custa aqui cerca de 500 vezes mais que um `TryParse` que falha, e um
`Parse` com sucesso é tão barato quanto um `TryParse`. Por isso a guideline diz
que um método `Try` serve para o caso que falha na operação normal.

## Trade-offs

- **`TryParse` para entrada não confiável, `Parse` para entrada confiável.** Um
  `Parse` em uma constante, em um valor de configuração que você escreveu ou em
  um arquivo que você gerou dá uma exceção clara com stack trace quando a
  premissa quebra. Use `TryParse` onde texto inválido é um caso normal e
  reporte um bom erro ao usuário.
- **`TryParse` esconde por que falhou.** O `false` não diz se o texto estava
  vazio, malformado ou grande demais. Se o chamador precisa do motivo (um
  formulário com mensagens por campo), faça o parsing em etapas ou devolva um
  tipo de resultado com um código de erro, um custo de design que a assinatura
  com `bool` não carrega.
- **Os estilos padrão são permissivos de formas que você pode não querer.**
  `double` aceita separadores de grupo e `Infinity`; `Enum` aceita qualquer
  número. Passe `NumberStyles.None` ou `NumberStyles.AllowLeadingSign` para
  identificadores e contagens, e cheque `double.IsFinite` e `Enum.IsDefined`
  depois.
- **Um valor errado em silêncio é pior que uma exceção.** `"1.5"` lido como
  `15` e `03/04/2026` lido como março ou abril não falham. Qualquer parser que
  lê dados guardados ou trocados precisa nomear a cultura e, para datas, o
  formato exato.
- **`IParsable<T>` compra código genérico e um contrato estável, ao preço de
  implementar quatro métodos.** Para um tipo usado por um único chamador, um
  único método `Parse` basta. Implemente a interface quando o tipo for um value
  object que o código genérico (binding, serializadores, leitores genéricos)
  deva tratar.
- **Implementar `ISpanParsable<T>` empurra o trabalho real para spans.** O
  código não aloca e fica um pouco mais difícil de ler (fatiamento, `IndexOf`).
  Compensa em laços sobre entradas grandes, e não em uma tela de configurações.
- **Um método `Try` precisa manter um significado estreito.** Se ele também
  engole erros não relacionados (uma referência nula, uma opção inválida), os
  bugs desaparecem dentro do `false`. Devolva `false` para a entrada ruim
  documentada e deixe os erros de programação lançarem.

## Documentation Links

- [Parse numeric strings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/parsing-numeric) (doc)
- [Parse date and time strings, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/parsing-datetime) (doc)
- [Int32.TryParse method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.int32.tryparse) (doc)
- [NumberStyles enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.globalization.numberstyles) (doc)
- [IParsable<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iparsable-1) (doc)
- [Enum.TryParse method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.enum.tryparse) (doc)
- [Exceptions and Performance, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/exceptions-and-performance) (doc)
