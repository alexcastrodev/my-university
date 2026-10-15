---
version: 1.0
updatedAt: 2026-10-15
title: "Expressões Regulares em Profundidade"
summary: Os dois motores de regex do .NET (backtracking e NonBacktracking), opções que mudam o significado do padrão, grupos nomeados, lookaround, quantificadores gananciosos e preguiçosos, EnumerateMatches e timeouts.
---
## Objective

Uma expressão regular é um pequeno programa que a classe `Regex` executa sobre
um texto, e no .NET há mais de um jeito de executá-lo. O motor padrão tenta as
alternativas uma de cada vez e volta atrás quando uma escolha falha
(backtracking), o que torna possíveis lookarounds e backreferences e também
torna alguns padrões lentos. Um motor opcional, `RegexOptions.NonBacktracking`,
roda em tempo proporcional à entrada, mas suporta menos construções. Este
conceito cobre os dois motores, as opções que mudam o que um padrão significa
(`IgnoreCase`, `CultureInvariant`, `ECMAScript`, `ExplicitCapture`), grupos
nomeados, lookaround, quantificadores gananciosos versus preguiçosos, o
`EnumerateMatches` sem alocação e os timeouts de match.

## Use Cases

- Validar e extrair partes estruturadas de texto, como datas, linhas de log e
  identificadores, com grupos nomeados em vez de índices numéricos.
- Reformatar texto com `Regex.Replace` e referências a grupos, por exemplo
  transformando `2025-11-11` em `11/11/2025`.
- Contar ou varrer entradas grandes sem alocar um objeto `Match` por ocorrência.
- Escolher entre o motor com backtracking e o sem backtracking quando o padrão
  vai rodar sobre uma entrada controlada por outra pessoa.

## Deep Dive

### Grupos, capturas nomeadas e Replace

Parênteses criam grupos de captura numerados. Um nome, `(?<name>...)`, faz o
código sobreviver a mudanças no padrão, porque os números se deslocam quando um
grupo é adicionado e os nomes não. A string de substituição pode referenciar
grupos como `${name}`.

```csharp
var date = new Regex(@"(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})");
var m = date.Match("Released on 2025-11-11, patched 2025-12-09.");
Console.WriteLine($"{m.Value} year={m.Groups["year"].Value} idx={m.Index} len={m.Length}");
// 2025-11-11 year=2025 idx=12 len=10
Console.WriteLine(m.NextMatch().Value);                                   // 2025-12-09
Console.WriteLine(date.Replace("2025-11-11", "${day}/${month}/${year}")); // 11/11/2025
Console.WriteLine(date.Count("a 2025-11-11 b 2025-12-09"));               // 2
```

A numeração tem uma surpresa: grupos sem nome são numerados primeiro, da
esquerda para a direita, e os nomeados vêm depois. `new Regex(@"(?<a>\d)(\d)")`
tem os nomes de grupo `0,1,a`, então o `(\d)` sem nome é o grupo 1 e `a` é o
grupo 2. Quando você não precisa de capturas, `RegexOptions.ExplicitCapture`
transforma parênteses comuns em grupos que não capturam
(`new Regex(@"(\d)(\d)", RegexOptions.ExplicitCapture)` dá `Groups.Count` igual
a 1, só o grupo 0), o que poupa trabalho de controle ao motor.

### Ganancioso versus preguiçoso, e âncoras

Um quantificador é ganancioso por padrão: pega o máximo que consegue e devolve
quando falha. Acrescentar `?` o torna preguiçoso. A ordem de busca do motor com
backtracking é o que explica a diferença:

```csharp
string html = "<b>one</b><b>two</b>";
Console.WriteLine(Regex.Match(html, "<b>.*</b>").Value);   // <b>one</b><b>two</b>
Console.WriteLine(Regex.Match(html, "<b>.*?</b>").Value);  // <b>one</b>

Console.WriteLine(Regex.IsMatch("abc\n", @"^abc$"));   // True: $ também casa antes de uma quebra de linha final
Console.WriteLine(Regex.IsMatch("abc\n", @"^abc\z"));  // False: \z é o fim real da entrada
```

Para validação, prefira `\z` (ou `\A` e `\z`) quando uma quebra de linha final
precisa ser rejeitada.

### Lookaround

Lookahead `(?=...)`, `(?!...)` e lookbehind `(?<=...)`, `(?<!...)` verificam o
texto ao redor da posição atual sem consumi-lo. Permitem que um padrão só
expresse "seguido de" e "precedido de" sem pôr o contexto no match:

```csharp
Console.WriteLine(Regex.Replace("1234567", @"(?<=\d)(?=(\d{3})+$)", ","));   // 1,234,567
Console.WriteLine(Regex.Match("price: $15, cost: 20", @"(?<=\$)\d+").Value); // 15 (o $ não faz parte do match)
Console.WriteLine(Regex.IsMatch("password1", @"^(?=.*\d)(?=.*[a-z]).{8,}$")); // True: duas condições independentes numa mesma posição
```

O .NET aceita lookbehind de tamanho variável, o que muitos outros sabores não
aceitam. Essas construções exigem o motor com backtracking (veja abaixo).

### Opções que mudam o significado

`IgnoreCase` usa as regras de caixa da cultura atual, a menos que você também
passe `CultureInvariant`, o que reproduz o problema do i turco da comparação de
strings. `\d` casa qualquer dígito decimal Unicode, não só `0-9`, a menos que
você use `[0-9]` ou `RegexOptions.ECMAScript`:

```csharp
CultureInfo.CurrentCulture = new CultureInfo("tr-TR");
Regex.IsMatch("I", "i", RegexOptions.IgnoreCase);                                    // False
Regex.IsMatch("I", "i", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);    // True

string arabic = "١٢٣"; // dígitos arábico-índicos
Regex.IsMatch(arabic, @"^\d+$");                              // True
Regex.IsMatch(arabic, @"^[0-9]+$");                           // False
Regex.IsMatch(arabic, @"^\d+$", RegexOptions.ECMAScript);     // False
```

Um padrão que valida "um número" com `\d` aceita dígitos que `int.Parse` com a
cultura invariante pode recusar, então valide com `[0-9]` quando o passo
seguinte é fazer parse. `RegexOptions.ECMAScript` só pode ser combinada com
poucas outras opções e proíbe algumas construções, então comece por `[0-9]`.

### Dois motores, e o que o NonBacktracking abre mão

O motor padrão é o de backtracking: mantém uma pilha de escolhas e volta a elas.
`RegexOptions.Compiled` faz o motor emitir IL para o padrão; isso muda a
velocidade, não o significado. `RegexOptions.NonBacktracking` troca por um motor
baseado em autômatos que nunca volta sobre a entrada, então o tempo de match
cresce com o tamanho da entrada. Em troca, construções que dependem de estado
lembrado são rejeitadas quando o `Regex` é construído. Resultados reais no
.NET 10:

```csharp
new Regex(@"[a-z]+\d+", RegexOptions.NonBacktracking).IsMatch("abc123");  // True
new Regex(@"(?=a)a", RegexOptions.NonBacktracking);   // NotSupportedException: lookahead ou lookbehind positivo
new Regex(@"(a)\1", RegexOptions.NonBacktracking);    // NotSupportedException: backreference
new Regex(@"(?>a+)b", RegexOptions.NonBacktracking);  // NotSupportedException: subexpressão atômica
new Regex("a", RegexOptions.NonBacktracking | RegexOptions.RightToLeft); // ArgumentOutOfRangeException ('options')
new Regex(@"(?<n>\d+)", RegexOptions.NonBacktracking).Match("x42").Groups["n"].Value; // 42, capturas funcionam
```

Como a falha acontece na construção, você descobre assim que o código roda, e
não quando uma entrada rara chega.

### Match, EnumerateMatches, Count e timeouts

`Matches` aloca um `Match` e objetos `Group` por ocorrência. Quando você só
precisa das posições, `Regex.EnumerateMatches` sobre um `ReadOnlySpan<char>`
devolve uma struct `ValueMatch` com `Index` e `Length` e não aloca nada por
match. `Count` e `IsMatch` também pulam as capturas, e `EnumerateSplits` é a
mesma ideia para dividir texto:

```csharp
ReadOnlySpan<char> input = "a1 b22 c333";
foreach (ValueMatch vm in Regex.EnumerateMatches(input, @"\d+"))
    Console.Write($"[{vm.Index},{vm.Length}:{input.Slice(vm.Index, vm.Length)}] ");
// [1,1:1] [4,2:22] [8,3:333]
```

Um timeout de match limita o tempo que uma tentativa pode levar. É argumento do
construtor (`new Regex(pattern, options, TimeSpan)`) e dos métodos estáticos;
estourá-lo lança `RegexMatchTimeoutException`. O padrão é
`Regex.InfiniteMatchTimeout`, que vale `-1 ms`, a menos que o processo defina
`REGEX_DEFAULT_MATCH_TIMEOUT` com `AppDomain.SetData`. Zero, ou um valor negativo
diferente de infinito, lança `ArgumentOutOfRangeException`. O próximo conceito
mostra um timeout salvando um serviço de um padrão catastrófico.

Métodos estáticos como `Regex.IsMatch(input, pattern)` usam um cache de objetos
`Regex` recentes cujo `Regex.CacheSize` padrão é 15. Um padrão em caminho quente
pertence a um campo `static readonly Regex`, ou a um regex gerado.

## Trade-offs

- **Backtracking é expressivo e pode ser exponencial.** Lookaround e
  backreferences vêm junto. Um quantificador aninhado como `^(a+)+$` sobre 22
  caracteres `a` seguidos de `!` levou cerca de 300 ms no motor padrão num Apple
  M4 Max; de 20 a 24 caracteres mediu 75, 150, 282, 560 e 1108 ms, ou seja, cada
  caractere a mais dobra o tempo.
- **NonBacktracking é linear, mas mais restrito.** Na mesma entrada e no mesmo
  padrão levou 4 ms, mas lookahead, lookbehind, backreferences, grupos atômicos e
  `RightToLeft` não estão disponíveis. Meça o custo de inicialização no seu
  padrão antes de adotá-lo em tudo.
- **Grupos nomeados não custam nada no match, mas poluem o padrão.** Em troca,
  `Groups["year"]` continua funcionando quando alguém insere um grupo antes dele.
- **`EnumerateMatches` dá posições, não capturas.** Você perde `Groups`; se
  precisa de uma substring capturada, fatie a entrada com índice e tamanho, ou
  volte para `Match`.
  ```csharp
  foreach (ValueMatch vm in Regex.EnumerateMatches(text, @"\d+")) { /* só vm.Index e vm.Length */ }
  ```
- **`Compiled` paga na construção.** Gasta tempo de inicialização emitindo IL
  para ganhar vazão num padrão executado muitas vezes; para um padrão raro, o
  interpretador sai mais barato no total.
- **Timeout é rede de segurança, não correção.** Um timeout transforma uma
  trava em exceção, mas o padrão continua errado. Trate
  `RegexMatchTimeoutException` como sinal para simplificar o padrão ou trocar de
  motor.

## Documentation Links

- [.NET regular expressions overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expressions) (doc)
- [Regular expression options, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-options) (doc)
- [Backtracking in .NET regular expressions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/backtracking-in-regular-expressions) (doc)
- [Grouping constructs in regular expressions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/grouping-constructs-in-regular-expressions) (doc)
- [Best practices for regular expressions in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/best-practices-regex) (doc)
- [Regex.EnumerateMatches method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.regularexpressions.regex.enumeratematches) (doc)
