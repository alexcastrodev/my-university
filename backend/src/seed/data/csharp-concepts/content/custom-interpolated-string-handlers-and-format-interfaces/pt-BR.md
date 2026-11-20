---
version: 1.0
updatedAt: 2026-11-20
title: "Interpolated String Handlers Próprios, ISpanFormattable e Format Providers"
summary: O que o compilador gera para $"...", como escrever um handler próprio com shouldAppend e InterpolatedStringHandlerArgument (log e SQL parametrizado), resolução de overload, ISpanFormattable e IUtf8SpanFormattable sem alocar, IFormatProvider, ICustomFormatter e quem consome IParsable, tudo medido com BenchmarkDotNet e IL.
---
## Objective

`$"..."` parece um recurso só e na verdade são quatro: uma constante, um `string.Concat`, um `DefaultInterpolatedStringHandler` e um `FormattableString`, escolhidos pelo compilador conforme a forma da string e o tipo para o qual ela é convertida. Este conceito abre essa caixa com o IL e depois constrói em cima: um handler seu (log que pula o trabalho quando o nível está desligado, e SQL que transforma os buracos em parâmetros), as interfaces de formatação que deixam um valor se escrever num `Span<char>` ou `Span<byte>` sem alocar (`ISpanFormattable`, `IUtf8SpanFormattable`), providers e `ICustomFormatter`, e quem consome `IParsable<T>`. A sintaxe do buraco, os especificadores, o básico de cultura, `CompositeFormat` e a primeira olhada em handlers estão em `formatting-values-and-interpolated-strings`, e o parsing em `parsing-tryparse-and-the-try-pattern`; este conceito não repete nada disso.

Versions: .NET SDK 10.0.100 (runtime 10.0.0, Roslyn do SDK), TFM `net10.0`, BenchmarkDotNet 0.15.8 (ShortRun, `[MemoryDiagnoser]`), `ilspycmd` 11.2.0 para o IL, shared framework ASP.NET Core 10.0.0, macOS arm64 (Apple M4 Max, 14 núcleos). O ShortRun tem barras de erro largas: leia as razões e a coluna de alocação, não o último dígito.

## Use Cases

- Uma API de log ou tracing sua, em que um nível desligado precisa custar zero.
- Um construtor de queries que nunca pode concatenar entrada do usuário: `Sql.Query($"... {name}")`.
- Escrever números, GUIDs e datas num buffer de rede ou arquivo (bytes UTF-8) sem criar strings.
- Um tipo-valor (`Money`, `Point`) que formata e faz parse como `int` e `Guid`.
- Descobrir o que o compilador fez quando um caminho quente aloca mais do que o esperado.

## Deep Dive

### O que o compilador emite

Compilei um método por caso em Release e li o IL com `ilspycmd -il` (a visão C# padrão do ILSpy transforma o IL de volta em `$"..."`, então ela esconde a resposta).

```csharp
const string A = "alpha", B = "beta";
const string Joined = $"{A}-{B}";          // ldstr "alpha-beta"       (constante do C# 10)
$"{a}-{b}"            // a, b strings    -> string.Concat(a, "-", b)
$"id={i}"             // buraco int      -> DefaultInterpolatedStringHandler
$"{d:F2}"             // formato         -> AppendFormatted<double>(d, "F2")
$"[{s,8}]"            // alinhamento     -> AppendFormatted<string>(s, 8)
string.Create(p, $"n={i}")  // provider  -> handler criado com (2, 1, p), depois string.Create(p, ref handler)
FormattableString fs = $"n={i}";  // -> FormattableStringFactory.Create("n={0}", new object[] { (object)i })
string.Format("{0}:{1}", i, s)    // -> box de i, depois String.Format(string, object, object)
i + ":" + s           //               -> i.ToString(), depois String.Concat(string, string, string)
```

O caso do handler, `$"id={i}"`, é este IL (resumido):

```
ldloca.s 0 ; ldc.i4.3 ; ldc.i4.1 ; newobj DefaultInterpolatedStringHandler::.ctor(int32, int32)
ldloca.s 0 ; ldstr "id=" ; call AppendLiteral(string)
ldloca.s 0 ; ldarg.0       ; call AppendFormatted<int32>(!!0)
ldloca.s 0                 ; call ToStringAndClear()
```

Os dois argumentos do construtor são o tamanho total das partes literais (3) e o número de buracos (1), a dica de pré-dimensionamento. Um buraco do tipo `string` liga no `AppendFormatted(string)` não genérico, e um buraco `string` com alinhamento liga no genérico; `$"{o}"` sobre um `object` é `AppendFormatted<object>`. O caso do `FormattableString` é o caro: um valor encaixotado mais um `object[]` antes de qualquer formatação. Um `const` aceita só constantes string: com `const int N = 5`, `const string Bad = $"{S}-{N}"` falha com `CS0133` (o conceito de literais também cobre constantes).

### Escrevendo um handler: pule o trabalho quando ninguém lê

Um handler é um tipo marcado com `[InterpolatedStringHandler]`, com um construtor `(int literalLength, int formattedCount, ...)`, um `AppendLiteral(string)` e um ou mais overloads de `AppendFormatted` (`<T>(T)`, `<T>(T, string?)`, `<T>(T, int, string? = null)`). Um parâmetro de construtor `out bool shouldAppend` deixa o handler recusar, e `[InterpolatedStringHandlerArgument("")]` no parâmetro da API diz ao compilador para passar o receptor (`this`) ao construtor:

```csharp
public sealed class Logger
{
    public bool DebugEnabled;
    public void Debug(string message) { if (DebugEnabled) Write(message); }
    public void Debug([InterpolatedStringHandlerArgument("")] ref DebugHandler h)
    { if (DebugEnabled) Write(h.Text()); }
}

[InterpolatedStringHandler]
public ref struct DebugHandler
{
    private DefaultInterpolatedStringHandler _inner;   // reaproveita o buffer em pool
    private readonly bool _on;
    public DebugHandler(int literalLength, int formattedCount, Logger logger, out bool shouldAppend)
    {
        _on = shouldAppend = logger.DebugEnabled;
        _inner = _on ? new DefaultInterpolatedStringHandler(literalLength, formattedCount) : default;
    }
    public void AppendLiteral(string s) => _inner.AppendLiteral(s);
    public void AppendFormatted<T>(T value) => _inner.AppendFormatted(value);
    public void AppendFormatted<T>(T value, string? format) => _inner.AppendFormatted(value, format);
    public void AppendFormatted<T>(T value, int alignment, string? format = null) => _inner.AppendFormatted(value, alignment, format);
    public string Text() => _on ? _inner.ToStringAndClear() : "";
}
```

Medido com `log.Debug($"user {id} did {action} for {price:F2}")`; as linhas `String` convertem a interpolação para `string` para escolher o overload antigo:

```
| Method      | Mean      | Ratio | Allocated |
| Off_String  | 62.291 ns |  1.00 |      88 B |
| Off_Handler |  3.866 ns |  0.06 |         - |
| On_String   | 62.533 ns |  1.00 |      88 B |
| On_Handler  | 64.675 ns |  1.04 |      88 B |
```

Com o nível desligado, o handler pula a formatação, a alocação e a avaliação dos buracos (o conceito de formatação já mostra um método de buraco chamado 0 vezes). Ligado, o wrapper custa o mesmo que a interpolação comum. Dois limites importam. O `Microsoft.Extensions.Logging.Abstractions` 10.0.0 tem zero métodos que recebem um handler (conferi por reflection no assembly), então `ILogger.LogDebug($"...")` ainda monta a string: para o `ILogger` a resposta é `[LoggerMessage]` (veja o conceito de ILogger). O padrão serve para APIs suas, e é assim que o BCL o usa: a reflection no CoreLib lista `Debug.Assert`, `Debug.WriteIf`, `StringBuilder.Append`, `MemoryExtensions.TryWrite`, `Utf8.TryWrite` e `DefaultInterpolatedStringHandler`. Só na documentação (não executado aqui): se todo `Append*` retorna `bool` em vez de `void`, um `false` interrompe os appends restantes, que é como um handler desiste no meio (um limite de tamanho, por exemplo); misturar os dois tipos de retorno é erro de compilação.

### Um handler que não é sobre strings

Como o compilador entrega ao handler os literais e os valores separados, os valores nunca precisam virar texto. Um handler pode transformar cada buraco em parâmetro:

```csharp
[InterpolatedStringHandler]
public ref struct SqlHandler
{
    private readonly StringBuilder _sb; private readonly List<object?> _params;
    public SqlHandler(int literalLength, int formattedCount)
    { _sb = new(literalLength + formattedCount * 3); _params = new(formattedCount); }
    public void AppendLiteral(string s) => _sb.Append(s);
    public void AppendFormatted<T>(T value) { _sb.Append("@p").Append(_params.Count); _params.Add(value); }
    public SqlQuery Build() => new() { Text = _sb.ToString(), Parameters = _params };
}
public static class Sql { public static SqlQuery Query(SqlHandler h) => h.Build(); }

Sql.Query($"select * from users where name = {"Robert'); drop table users;--"} and age > {30}")
// select * from users where name = @p0 and age > @p1 | params: Robert'); drop table users;--, 30
```

A API não tem overload de `string`, então `Sql.Query(someString)` não compila (`CS1503: cannot convert from 'string' to 'SqlHandler'`) e o chamador não consegue concatenar por acidente. O `FromSql(FormattableString)` do EF Core é a mesma ideia sobre o caminho do `FormattableString` visto acima, que encaixota cada valor e aloca um array.

### O overload resolution decide qual roda

Quatro pares de overloads, chamados com `$"n={1}"`:

```
Which(string)          vs Which(FormattableString)  -> string
W2(string)             vs W2(SqlHandler)            -> handler
W3(FormattableString)  vs W3(IFormattable)          -> FormattableString
W4(FormattableString)  vs W4(SqlHandler)            -> SqlHandler
```

O handler vence `string` e `FormattableString`, e `string` vence `FormattableString`. A consequência é de comportamento: adicionar um overload com handler ao lado de um de `string` já existente recompila todo ponto de chamada interpolado para o caminho novo sem mudar o código-fonte. Para log isso é o objetivo, e é uma surpresa quando o handler formata diferente (veja a seção de cultura). Uma chamada com uma variável `string` continua no overload de `string`.

### Formatar sem alocar: ISpanFormattable e IUtf8SpanFormattable

`ISpanFormattable.TryFormat(Span<char>, out int, ReadOnlySpan<char>, IFormatProvider?)` escreve no buffer do chamador e devolve `false` quando não cabe. `IUtf8SpanFormattable` (.NET 8) é o mesmo com `Span<byte>`, produzindo UTF-8 direto. A página do Learn lista `Int32`, `Guid`, `DateTime`, `DateTimeOffset`, `Decimal`, `Double` e os demais tipos numéricos, e confirmei com `is`: `int`, `Guid` e `DateTime` são `IUtf8SpanFormattable`, `string` não é. Medido com `n = 1234567`, um `Guid`, `DateTime` com `"O"`, tudo na cultura invariante:

```
| Method                  | Mean      | Allocated |
| Int_ToString            |  4.423 ns |      40 B |
| Int_TryFormat_Char      |  1.825 ns |         - |
| Int_TryFormat_Utf8      |  2.183 ns |         - |
| Guid_ToString           |  5.963 ns |      96 B |
| Guid_TryFormat_Char     |  1.207 ns |         - |
| Guid_TryFormat_Utf8     |  1.041 ns |         - |
| DateTime_ToString       | 13.072 ns |      80 B |
| DateTime_TryFormat_Char |  6.979 ns |         - |
| DateTime_TryFormat_Utf8 |  6.756 ns |         - |
```

O seu tipo implementa as interfaces do mesmo jeito. Escreva as versões de span como a implementação de verdade e deixe o `ToString` usá-las, para a lógica morar num lugar só. O `Money` abaixo formata o decimal direto no destino e falha limpo quando o buffer é curto (o overload UTF-8 copia códigos de moeda como ASCII, o que basta para códigos ISO e não para texto arbitrário):

```csharp
public readonly record struct Money(decimal Amount, string Currency) : IFormattable, ISpanFormattable, IUtf8SpanFormattable
{
    public string ToString(string? format, IFormatProvider? provider)
        => string.Create(provider, $"{Amount.ToString("N2", provider)} {Currency}");
    public bool TryFormat(Span<char> destination, out int charsWritten, ReadOnlySpan<char> format, IFormatProvider? provider)
    {
        charsWritten = 0;
        if (!Amount.TryFormat(destination, out int n, "N2", provider)) return false;
        if (destination.Length < n + 1 + Currency.Length) return false;
        destination[n] = ' '; Currency.CopyTo(destination[(n + 1)..]);
        charsWritten = n + 1 + Currency.Length; return true;
    }
    public bool TryFormat(Span<byte> utf8Destination, out int bytesWritten, ReadOnlySpan<char> format, IFormatProvider? provider)
    { /* mesma forma: decimal.TryFormat nos bytes, depois a moeda em ASCII */ }
}
// de-DE: ok=True w=16 text=1.234.567,89 EUR      buffer de 8 chars: ok=False w=0
```

```
| Money_ToString        | 40.107 ns | 104 B |
| Money_TryFormat_Char  | 26.770 ns |     - |
| Money_TryFormat_Utf8  | 24.244 ns |     - |
| Interp_Money          | 39.985 ns |  72 B |   string.Create(invariant, $"total={m}")
| Utf8_GetBytes_Interp  | 24.408 ns | 120 B |   Encoding.UTF8.GetBytes(string.Create(inv, $"n={n} g={g}"))
| Utf8_TryWrite         |  7.866 ns |     - |   Utf8.TryWrite(buf, inv, $"n={n} g={g}", out w)
```

O `Interp_Money` aloca 72 bytes, o tamanho só da string de resultado: o handler achou `ISpanFormattable` no struct e escreveu no próprio buffer. O `Utf8.TryWrite` é a mesma ideia de handler mirando bytes, três vezes mais rápido que formatar para string e codificar, sem alocar nada. Uma armadilha de medição: um laço caseiro com `GC.GetAllocatedBytesForCurrentThread` imprimiu 24 bytes por chamada para um buraco `int` e 40 para `Money` enquanto o código ainda estava no tier 0 (coerente com o valor ser encaixotado ali); com `DOTNET_TieredCompilation=0` o mesmo laço imprimiu 0 para `int`, `Guid`, `DateTime`, um struct simples e `Money`. Use o BenchmarkDotNet, que faz o aquecimento.

### Providers e ICustomFormatter

Todo `ToString(format, provider)` e `TryFormat` recebe um `IFormatProvider`. O único método dele, `GetFormat(Type)`, devolve um objeto que descreve a cultura (`NumberFormatInfo`, `DateTimeFormatInfo`) ou um `ICustomFormatter`. Devolva um formatador customizado e ele é consultado a cada buraco:

```csharp
public sealed class BytesFormatter : IFormatProvider, ICustomFormatter
{
    public object? GetFormat(Type? t) => t == typeof(ICustomFormatter) ? this : null;
    public string Format(string? format, object? arg, IFormatProvider? provider)
    {
        if (format == "bytes" && arg is long b) { /* escala para KB, MB, GB */ }
        return arg is IFormattable f ? f.ToString(format, CultureInfo.InvariantCulture) : arg?.ToString() ?? "";
    }
}
string.Create(bf, $"{123456789L:bytes} {1536L:bytes} {1.5:F2}")   // 117.7 MB 1.5 KB 1.50
string.Format(bf, "{0:bytes} {1:bytes}", 123456789L, 5L)          // 117.7 MB 5 B
$"{123456789L:bytes}"                                             // bytes
```

A última linha é a falha silenciosa: sem provider, `bytes` não é um formato conhecido, e num formato numérico customizado as letras são literais, então a saída é a palavra `bytes` sem exceção. Um formatador customizado recebe cada buraco como `object` encaixotado e precisa repassar sozinho todos os outros formatos, então reserve-o para formatos que são seus.

O provider também é onde um handler seu vaza a cultura. O `DebugHandler` acima cria o handler interno sem provider, então segue a máquina, enquanto `string.Create(CultureInfo.InvariantCulture, ...)` não. Com `CurrentCulture` em pt-BR:

```
handler wrapper, current pt-BR:   price=1,5 when=20/11/2026
string.Create(Invariant):         price=1.5 when=11/20/2026
```

Para log lido por pessoas, isso está certo. Para qualquer coisa que será lida de volta por um parser, dê ao construtor do handler um `IFormatProvider` (ou fixe o invariante) e passe-o para `new DefaultInterpolatedStringHandler(l, c, provider)`.

### Quem consome IParsable

Uma minimal API do ASP.NET Core 10 liga valores de rota, query e header a um tipo de parâmetro que tenha `TryParse(string, out T)` ou `TryParse(string, IFormatProvider, out T)` (a página do Learn lista as duas, e o `BindAsync` para binding customizado). Mapeei `Point : IParsable<Point>` e alguns tipos nativos no Kestrel com `CurrentCulture` em pt-BR e chamei cada URL:

```
GET /point?p=3.5;-2      200  X=3.5 Y=-2 provider=CultureInfo/invariant currentCulture=pt-BR
GET /point?p=3,5;-2      400
GET /ratio/1,5           200  r=15            (double: a vírgula é separador de grupo)
GET /ratio/1.5           200  r=1.5
GET /when?d=2026-11-20   200  d=2026-11-20    GET /when?d=20/11/2026   400   (DateOnly)
GET /color?d=Friday      200                  GET /color?d=friday      400   (enum, diferencia maiúsculas)
GET /color?d=99          200  d=99            (um valor de enum não definido passa)
GET /opt?n=x             400                  GET /opt                 200  n=null   (int?)
```

O binder passou a cultura invariante, não a da máquina: o cliente manda `1.5` e a cultura do servidor não importa, o que é correto para uma API. `1,5` não é erro para um `double`, é 15, a mesma armadilha que o conceito de parsing mede com `double.Parse`. Na família de interfaces, `IUtf8SpanParsable<T>` é a irmã UTF-8 (os tipos numéricos a implementam). Só na documentação: as páginas do System.CommandLine no Learn não mencionam `IParsable<T>`; tipos de argumento customizados usam um delegate `CustomParser` no `Argument<T>` (um `CustomParser` aparece no tutorial de primeiros passos).

### Book vs today

Livros mais antigos ensinam `string.Format("{0}:{1}", i, s)` e `+` como as duas formas de montar texto, e `IFormattable.ToString(format, provider)` como o único gancho para tipos seus. No IL acima, o `string.Format` encaixota cada tipo-valor e o `i + ":" + s` cria uma string temporária para `i` antes do `Concat`, enquanto uma interpolação cujos buracos são todos string compila para `Concat` sem temporário. Para qualquer buraco que não seja string o compilador usa o handler, que formata num buffer em pool, e o conceito de formatação mediu 48 bytes para ele contra 72 do `string.Format` e 88 do `+`. O gancho que importa em caminhos quentes agora é o `TryFormat` (.NET 6 para chars, .NET 8 para UTF-8), e o `ToString` vira uma conveniência por cima dele.

## Trade-offs

- **Um handler é um `ref struct`.** Ele não pode ser campo de classe, atravessar um `await` nem ser capturado por lambda, por isso a API o recebe como parâmetro e o consome dentro da chamada. Mantenha a materialização estilo `Text()` dentro do método que o recebeu.
- **Um novo overload com handler muda qual método é ligado.** Os chamadores recompilam para ele em silêncio, então a semântica precisa bater com a do overload de `string` (mesma cultura, mesma saída), ou a mudança é uma quebra de comportamento disfarçada de otimização.
  ```csharp
  void Log(string m); void Log([InterpolatedStringHandlerArgument("")] ref Handler h);   // log.Log($"{x}") agora chama o segundo
  ```
- **Pular a avaliação é o recurso e a armadilha.** Com `shouldAppend` falso as expressões dos buracos nunca rodam, então um buraco com efeito colateral (`{queue.Dequeue()}`) é um bug no caminho desligado. Mantenha os buracos puros.
- **`ISpanFormattable` duplica o caminho de formatação a menos que o `ToString` delegue a ele.** Duas implementações divergem. Numa tela de configurações é código desperdiçado, e num serializador ou pipeline de log é a diferença entre 0 e 104 bytes por valor (a tabela do `Money`).
- **Formatar em UTF-8 não é um encode de graça.** Números, GUIDs e datas ISO são ASCII, então `IUtf8SpanFormattable` é simples para eles. Um tipo com texto dependente de cultura (um símbolo de moeda, um nome de mês) precisa codificar de verdade, e o exemplo trapaceia com códigos ASCII.
- **`ICustomFormatter` é comportamento global atrás de um provider.** Ele encaixota cada buraco e, se esquecer de repassar um formato, esconde bugs (`bytes` impresso como literal). Prefira um tipo com seu próprio `IFormattable` e uma letra de formato quando o tipo é seu.
- **ShortRun serve para razões.** As colunas de erro chegam a cerca de 40 por cento da média em algumas linhas; as afirmações deste conceito se apoiam na coluna de alocação e em razões de ordem de grandeza (0,06 para o handler desligado, 0 bytes para `TryFormat`).

## Documentation Links

- [String interpolation using $, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/interpolated) (doc)
- [Write a custom string interpolation handler, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/performance/interpolated-string-handler) (doc)
- [Improved interpolated strings, C# 10 feature specification, csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/csharp-10.0/improved-interpolated-strings.md) (doc)
- [DefaultInterpolatedStringHandler class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.defaultinterpolatedstringhandler) (doc)
- [InterpolatedStringHandlerArgumentAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.interpolatedstringhandlerargumentattribute) (doc)
- [ISpanFormattable interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.ispanformattable) (doc)
- [IUtf8SpanFormattable interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iutf8spanformattable) (doc)
- [Utf8.TryWrite method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.unicode.utf8.trywrite) (doc)
- [ICustomFormatter interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.icustomformatter) (doc)
- [IFormatProvider interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iformatprovider) (doc)
- [IParsable<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iparsable-1) (doc)
- [IUtf8SpanParsable<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iutf8spanparsable-1) (doc)
- [Parameter binding in Minimal APIs, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/parameter-binding) (doc)
- [Get started with System.CommandLine, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/commandline/get-started-tutorial) (doc)
- [Compile-time logging source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator) (doc)
- [BenchmarkDotNet](https://benchmarkdotnet.org/) (doc)
