---
version: 1.0
updatedAt: 2026-11-12
title: "Ponto Flutuante Decimal: Decimal32, Decimal64 e Decimal128"
summary: Os tipos decimais IEEE 754 do .NET 11 contra decimal e double (precisão, faixa, tamanho, bits BID, arredondamento, parsing e formatação, conversões, JSON e desempenho medido), com a escolha honesta entre eles e o aviso de que a adoção ainda é mínima.
---
## Objective

O .NET 11 traz três tipos do padrão IEEE 754-2019 para ponto flutuante decimal: `Decimal32`, `Decimal64` e `Decimal128`, em `System.Numerics`. Eles guardam um significando decimal e uma potência de dez (como `System.Decimal`, ao contrário de `double`), em 4, 8 e 16 bytes, com 7, 16 e 34 dígitos significativos e uma faixa de expoente enorme. Os dois concepts numéricos já dizem que eles existem; este compara com `decimal` e `double` (precisão, faixa, tamanho, layout de bits, arredondamento, parsing e formatação, conversões, JSON, velocidade) e diz quando cada um é a escolha certa. Toda saída abaixo foi executada no SDK 11.0.100. Os tempos vêm de um Mac Apple Silicon em build Release, então leia as proporções, não os dígitos.

A resposta curta: para dinheiro e regras de negócio em código C#, `decimal` continua sendo o tipo. Os decimais IEEE servem para dados que já chegam nesse formato ou para resultados que precisam de mais dígitos ou de um expoente mais largo que o `decimal` oferece. São novos, e quase nada no ecossistema os usa ainda.

## Use Cases

- Ler ou escrever um formato binário, uma coluna de banco ou um protocolo que define decimal32, decimal64 ou decimal128 (o padrão de bits BID).
- Carregar mais de 28 dígitos em um cálculo (`Decimal128` tem 34) ou um valor acima de 7,9E+28 ou abaixo de 1E-28.
- Reproduzir resultados de outra linguagem ou biblioteca que implementa aritmética decimal IEEE.
- Armazenar de forma compacta muitos valores decimais em que 7 dígitos bastam (`Decimal32`, 4 bytes) e o custo da aritmética em software é aceitável.
- Escrever código numérico genérico que precisa aceitar ponto flutuante decimal por meio de `IDecimalFloatingPointIeee754<T>`.

## Deep Dive

### Três tamanhos, uma ideia

Um valor é `sinal x significando x 10^expoente`. O significando é um inteiro com um número fixo de dígitos e o expoente é um inteiro pequeno. É também assim que o `decimal` funciona, então `0.1 + 0.2` é exato (`0.3`) nos quatro tipos decimais e não em `double`.

| Tipo | Bytes | Dígitos significativos | Maior valor finito | Menor passo acima de 0 |
|---|---|---|---|---|
| `Decimal32` | 4 | 7 | 9.999999E+96 | 1E-101 |
| `Decimal64` | 8 | 16 | 9.999999999999999E+384 | 1E-398 |
| `Decimal128` | 16 | 34 | 9.999999999999999999999999999999999E+6144 | 1E-6176 |
| `decimal` | 16 | 28 a 29 | 79228162514264337593543950335 | 1E-28 |
| `double` | 8 | 15 a 17 (binário) | 1.7976931348623157E+308 | cerca de 5E-324 |

Duas coisas chamam a atenção. `Decimal64` tem o mesmo tamanho de `double`, mas troca faixa (E+384 contra E+308) e velocidade por frações decimais exatas. `Decimal128` tem mais dígitos que `decimal` e uma faixa de expoente milhares de vezes maior, nos mesmos 16 bytes. Os valores vêm de `MaxValue` e `Epsilon` em cada tipo; `Unsafe.SizeOf` devolve 4, 8, 16, 16 e 8.

### Para onde vão os bits

O .NET guarda a forma de significando inteiro do IEEE 754, chamada BID (binary integer decimal). O tipo não tem construtores públicos nem campo para ler, mas `MemoryMarshal.Write` e os métodos estáticos `EncodeBinary` e `DecodeBinary` expõem os bits:

```csharp
Decimal64.Parse("1.50", CultureInfo.InvariantCulture); // bits 3180000000000096
Decimal64.Parse("1.0",  CultureInfo.InvariantCulture); // bits 31A000000000000A
Decimal64.DecodeBinary(0x31A000000000000AUL);          // 1.0
```

`0x96` é 150 (o significando) e os bits altos são o expoente com viés: 396, ou seja, -2 depois de tirar o viés de 398. A outra codificação IEEE, DPD (densely packed decimal), está em `EncodeDecimal` e `DecodeDecimal`; só conferi que os métodos existem e não os executei. Use `EncodeBinary`, a menos que o formato que você lê diga DPD. Os dois métodos trabalham com o valor, não com uma ordem de bytes, então para arquivo ou socket decida a endianness você mesmo (`BinaryPrimitives` sobre o `ulong`).

### O mesmo valor em várias representações

Como o `decimal`, os tipos IEEE guardam zeros à direita. `1.0` e `1.00` são iguais e têm bits diferentes, um hash set guarda só um dos dois, e o expoente acompanha a aritmética: `1.50 * 1.50` é `2.2500`. O expoente tem nome aqui, o quantum:

```csharp
Decimal64.GetQuantum(Decimal64.Parse("1.50", inv));  // 0.01
Decimal64.HaveSameQuantum(a, b);                     // mesmo expoente?
Decimal64.Quantize(Decimal64.Parse("19.9", inv), Decimal64.Parse("0.01", inv)); // 19.90
```

`Quantize(x, y)` devolve `x` arredondado para o expoente de `y`. É a ferramenta certa para "duas casas decimais": `Decimal64.Round(2.5, 2)` deixa `2.5`, enquanto `Quantize` dá `2.50`, e `2.675` vira `2.68` e `2.665` vira `2.66` (empates vão para o par). Se o resultado não cabe nos dígitos do tipo, `Quantize` devolve `NaN` (`1E20` em centavos precisa de 22 dígitos e `Decimal64` tem 16).

### Arredondamento: quando os dígitos acabam

O `decimal` tem escala de no máximo 28 e lança `OverflowException` quando a parte inteira é grande demais. Os tipos IEEE têm um número fixo de dígitos e arredondam, em silêncio, para o mais próximo, empates para o par. Isso vale para parsing, conversões e toda operação:

```csharp
Decimal32.Parse("12345675")  // 1.234568E+07   (empate, vai para o 8 par)
Decimal32.Parse("12345685")  // 1.234568E+07   (empate, vai para o 8 par)
Decimal32.Parse("12345695")  // 1.234570E+07
Decimal64.Parse("1234567890123456789") // 1.234567890123457E+18
Decimal64.MaxValue + Decimal64.One     // 9.999999999999999E+384 (o 1 é absorvido)
(Decimal64.One / 3)                    // 0.3333333333333333
```

Essa é a principal mudança de mentalidade. Um `Decimal32` que recebe um inteiro de 8 dígitos não reclama: guarda 7 dígitos. Valide faixas na borda se o número de dígitos importa para você.

Os métodos de arredondamento são `Round`, `Floor`, `Ceiling` e `Truncate` no próprio tipo (não existe `Math.Round(Decimal64)`). `Decimal64.Round(x)` é empate para o par (`2.5` dá `2`), `MidpointRounding.AwayFromZero` dá `3`, `Round(2.675, 2)` dá `2.68` onde `Math.Round(2.675, 2)` em `double` dá `2.67` porque o valor binário está abaixo do empate, e `Decimal32.Round(1.005, 2)` é `1.00` no padrão e `1.01` com `AwayFromZero`. Um `digits` negativo lança `ArgumentOutOfRangeException` (use `Quantize` com um quantum como `1E+2`).

### Overflow, infinito e NaN

O `decimal` lança exceção. Os tipos IEEE seguem o IEEE 754 e produzem valores especiais:

```csharp
Decimal64.One / Decimal64.Zero          // Infinity (decimal: DivideByZeroException)
Decimal32.Zero / Decimal32.Zero         // NaN
Decimal32.MaxValue + Decimal32.MaxValue // Infinity
checked(Decimal32.MaxValue + Decimal32.MaxValue) // continua Infinity, sem exceção
Decimal64.Parse("1E400")                // Infinity
Decimal64.Parse("1E-400")               // 0E-398
Decimal32.NaN == Decimal32.NaN          // False
```

`checked` não tem efeito nesses operadores, então um cálculo que estoura chega ao seu código como `Infinity` e pode ser gravado em banco ou arquivo. `CreateChecked` e as conversões explícitas se comportam igual para um `Decimal64` grande demais indo para `Decimal32`: `Infinity`, não exceção. Se você quer exceção, teste com `IsInfinity` e `IsNaN` (o lab tem um `MultiplyChecked`). Converter um valor fora da faixa para inteiro satura (`(int)Decimal64.Parse("1E20")` é `2147483647`).

### Conversões

As conversões implícitas são as sem perda, e a lista é um bom mapa:

- Para `Decimal32`: `byte`, `sbyte`, `char`, `short`, `ushort`. Não `int`: 10 dígitos não cabem em 7.
- Para `Decimal64`: essas mais `int` e `uint`, e a partir de `Decimal32`. Não `long`.
- Para `Decimal128`: todo tipo inteiro até 64 bits, `decimal` e os dois tipos IEEE menores.
- O resto é explícito: de tipo IEEE maior para menor, `Decimal64` para `decimal`, qualquer coisa de e para `float` e `double`.

`Decimal64 x = 5;` compila, `(Decimal64)0.1m` precisa do cast, e não existe literal de `Decimal64` (sem sufixo). A partir de `double` o resultado depende dos dígitos disponíveis. `(Decimal64)0.1` é `0.1000000000000000` (16 dígitos, o erro binário é arredondado), enquanto `(Decimal128)0.1` é `0.1000000000000000055511151231257827`: 34 dígitos bastam para mostrar o valor verdadeiro do `double`. `(Decimal64)0.1f` é `0.1000000014901161`. Isso combina com a mudança do .NET 11 no `(decimal)` de um `double`, que agora guarda o valor binário exato (veja `numeric-conversions-rounding-and-overflow`). No sentido contrário, `(double)Decimal64.Parse("0.1") == 0.1` é `True` porque a conversão para `double` arredonda para o `double` mais próximo.

A conversão para `decimal` é onde o tamanho pesa. `(decimal)Decimal128.MaxValue` e `(decimal)Decimal64.MaxValue` lançam `OverflowException`, `decimal.MaxValue` vai para `Decimal128` e volta sem mudar, e `(decimal)Decimal128.Parse("0.0000000000000000000000000000001234")` vira `0.0000000000000000000000000000` sem erro: abaixo de 1E-28 o valor vira zero em silêncio, como `(decimal)1e-30`. Em código que não pode perder dígitos, confira a faixa antes de converter ou capture `OverflowException` (o lab tem `ToDecimalOrNull`).

### Parsing e formatação

`Parse`, `TryParse`, `TryParsePartial`, `TryFormat`, as sobrecargas UTF-8 e os parâmetros `NumberStyles` e `IFormatProvider` existem, como nos outros tipos numéricos. Dois detalhes:

- `Decimal64.Parse("1.0")` usa a cultura atual, como `decimal.Parse`. Em uma máquina cuja cultura usa vírgula a chamada lança `FormatException`, então passe `CultureInfo.InvariantCulture` para dados que não são para uma pessoa.
- O formato padrão `G` passa para notação científica quando o valor tem mais dígitos que o tipo: `Decimal32.Parse("12345678")` imprime `1.234568E+07`, e `1234567` imprime `1234567`. Para dígitos simples, peça `F0`, `N0` ou outro formato fixo: `12345680`, `12,345,680`. `Decimal128.MaxValue.ToString("F0")` tem 6145 caracteres.

```csharp
var d = Decimal64.Parse("1234.5", CultureInfo.InvariantCulture);
d.ToString("C", CultureInfo.GetCultureInfo("pt-BR")) // R$ 1.234,50
d.ToString("N2", CultureInfo.InvariantCulture)       // 1,234.50
d.ToString("E3", CultureInfo.InvariantCulture)       // 1.234E+003
Decimal64.TryParse("abc", null, out var r)           // False, r é 0
```

`Infinity` e `NaN` são aceitos no parse, `TryParse` devolve `false` para texto que não é número, e um inteiro de 19 dígitos é lido sem erro como um valor de 16 dígitos.

### JSON e outros formatos

O `System.Text.Json` trata os três tipos como números JSON, sem conversor e sem opções, e o expoente sobrevive:

```csharp
JsonSerializer.Serialize(new { A = Decimal64.Parse("1.50", inv), B = 1.50m }); // {"A":1.50,"B":1.50}
JsonSerializer.Deserialize<Decimal128>("12345678901234567890.123456789");      // exato
JsonSerializer.Deserialize<Decimal32>("1.23456789");                           // 1.234568
JsonSerializer.Deserialize<Decimal64>("1E400");                                // Infinity
```

`Decimal64.NaN` falha ao serializar com `ArgumentException`, a menos que `JsonNumberHandling.AllowNamedFloatingPointLiterals` esteja ligado, como em `double`. Um número dentro de uma string é lido com `AllowReadingFromString`. Um número JSON com mais dígitos que o tipo é arredondado na leitura, como no parsing.

Para todo o resto, testei só a BCL. Não verifiquei Entity Framework Core, Npgsql, `Microsoft.Data.SqlClient`, model binding do ASP.NET Core, protobuf nem MessagePack, e não procurei um provedor que mapeie uma coluna para esses tipos. Os tipos de coluna `decimal` do SQL Server e `numeric` do PostgreSQL são decimais de ponto fixo, não os formatos IEEE, então até um provedor que suporte os tipos novos estaria convertendo. Trate o suporte em uma biblioteca como algo a testar, não a presumir.

### Matemática e código genérico

Os três tipos implementam `IDecimalFloatingPointIeee754<T>`, então toda a superfície IEEE está lá: `Sqrt`, `Pow`, `Exp`, `Log`, funções trigonométricas, `Hypot`, `FusedMultiplyAdd`, `Lerp`, variantes de `Min`/`Max`, `IsFinite`, `IsNormal`, `IsSubnormal`, `BitIncrement`. `Decimal64.Pow(1.05, 10)` é `1.628894626777441`, o valor exato `1.62889462677744140625` arredondado para 16 dígitos, enquanto `Math.Pow(1.05, 10)` dá `1.628894626777442`.

O `decimal` implementa só `IFloatingPoint<T>` e `IFloatingPointConstants<T>`, não `IFloatingPointIeee754<T>`, então código genérico com essa restrição aceita `double` e `Decimal64`, mas não `decimal`. Código escrito contra `INumber<T>` funciona com todos:

```csharp
static T Sum<T>(params T[] xs) where T : INumber<T> { T s = T.Zero; foreach (var x in xs) s += x; return s; }
Sum(Decimal64.Parse("0.1", inv), Decimal64.Parse("0.2", inv), Decimal64.Parse("0.3", inv)); // 0.6
```

Não há operadores entre um decimal IEEE e `long`, `double` ou `decimal`; converta antes. O concept de generic math explica as interfaces.

### Velocidade

A aritmética é feita em software (não há instrução decimal no processador), e o `decimal` também. 20 milhões de operações, melhor de cinco, Release, `net11.0`, Apple Silicon (milissegundos):

| Operação | `double` | `decimal` | `Decimal32` | `Decimal64` | `Decimal128` |
|---|---|---|---|---|---|
| soma | 12 | 67 | 138 | 108 | 128 |
| multiplicação | 15 | 378 | 262 | 534 | 3175 |
| divisão | 11 | 423 | não medido | 637 | 1048 para 5 milhões |

Os laços de multiplicação e divisão dos tipos decimais também comparam e reiniciam ou acumulam, então os números servem só para proporção. Para 2 milhões de chamadas: `Parse` leva 59 ms em `double`, 57 em `decimal`, 65 em `Decimal64` e 69 em `Decimal128`; `ToString` leva 74, 42, 58 e 59; `decimal` para `Decimal64` 47, de volta 55, `double` para `Decimal64` 200 e de volta 20.

O que levar disso: `double` é de 5 a 40 vezes mais rápido que qualquer tipo decimal na aritmética; `decimal` é mais rápido que `Decimal64` nas três operações e muito mais rápido que `Decimal128` na multiplicação; `Decimal32` é mais lento que `Decimal64` na soma e mais rápido na multiplicação (armazenamento menor não significa uma quantidade fixa a menos de trabalho); parsing e formatação custam quase o mesmo em todos; a conversão a partir de `double` é a lenta. Os decimais IEEE compram dígitos, faixa e um layout de bits padrão, não velocidade. Meça a sua carga antes de escolher, e não use `Decimal128` em um laço quente de multiplicação.

### Escolhendo

- Dinheiro, preços, imposto, qualquer valor de negócio com número fixo de casas decimais: `decimal`. Ele lança exceção no overflow, tem o suporte mais amplo (EF Core, drivers, serializadores) e é o mais rápido dos decimais exatos.
- Medições, simulação, qualquer coisa em que um erro relativo de 1E-16 serve: `double`.
- Um formato ou protocolo que diz decimal64 ou decimal128, ou interoperar com uma biblioteca que devolve bits nesse layout: o tipo IEEE correspondente, convertendo na borda e fazendo a lógica de negócio no que seu time já confia.
- Mais de 28 dígitos de precisão, ou um expoente além de `decimal` e `double`, com frações decimais exatas: `Decimal128`.
- Muitos valores decimais pequenos guardados de forma compacta, em que 7 dígitos bastam: `Decimal32`, mas compare antes com centavos em `int` ou `decimal`.
- Um número fixo de centavos e nada mais: ainda `long` de centavos ou `decimal`.

## Trade-offs

- **Novos e pouco usados.** Os tipos estão na BCL, mas o `System.Text.Json` é o único serializador que verifiquei, e não conferi nenhum provedor de banco. Qualquer coisa que cruze uma fronteira pode precisar da sua própria conversão para `decimal` ou para os bits crus.
- **Arredondamento silencioso no lugar de `OverflowException`.** Um valor com dígitos demais é arredondado e um com expoente grande demais vira `Infinity`; `checked` não ajuda. Teste com `IsInfinity` e `IsNaN` nas bordas e valide o número de dígitos quando importa.
- **Mais lentos que `decimal` na maioria dos casos.** A multiplicação de `Decimal64` de 16 dígitos é cerca de 1,4 vez mais lenta que a de `decimal` aqui, a de `Decimal128` cerca de 8 vezes. Só a soma e a multiplicação de `Decimal32` ficam perto.
- **Sem operadores entre tipos.** `Decimal64 + long` não compila e `decimal` precisa de cast. Converter dentro de um laço custa mais que a aritmética (a conversão de `double` para `Decimal64` foi a operação mais lenta medida).
- **Menos dígitos que `decimal` no tamanho comum.** `Decimal64` tem 16 dígitos, `decimal` 28. Usá-lo por ser "do tamanho de um double" pode perder centavos em valores grandes.
- **A representação vaza.** `1.0` e `1.00` são iguais, mas imprimem diferente e têm bits diferentes. Normalize com `Quantize` antes de guardar, calcular hash de texto ou comparar bytes.
- **Surpresas do formato `G`.** Um valor com mais dígitos que o tipo imprime em notação científica; use `F` ou `N` com os dígitos que quiser e sempre passe `CultureInfo.InvariantCulture` para dados.
- **Sensibilidade à cultura no `Parse`.** Como o `decimal`, a cultura da máquina decide se `1.0` é aceito.
- **Underflow silencioso para `decimal`.** Converter um `Decimal128` minúsculo para `decimal` dá zero, não exceção.

## Lab

Use os decimais IEEE de propósito: arredonde para centavos com `Quantize`, converta `Decimal128` para `decimal` sem quebrar, veja o quantum de `1.0` e `1.00`, leia os bits BID, capture o overflow que `checked` ignora e faça ida e volta em JSON.

**O cenário**

Um projeto de biblioteca (`Ieee.cs`) e um projeto de testes que mira `net11.0`. O starter tem stubs com `NotImplementedException` e comentários descrevendo cada rotina.

**O que você vai fazer, passo a passo**

1. **Centavos (TODO-00, TODO-01).** `RoundToCents` com `Quantize` (empate para o par) e `RoundHalfAwayToCents` com um `MidpointRounding` explícito.
2. **Estreitamento (TODO-02, TODO-03).** `ToDecimalOrNull` para um `Decimal128` que pode não caber, e `FitsInDecimal32` com uma ida e volta.
3. **Genérico e quantum (TODO-04, TODO-05).** `SumTenths<T>` com `INumber<T>` para `double`, `decimal` e `Decimal64`, e `SameValueDifferentQuantum`.
4. **Bits (TODO-06, TODO-07).** `ToBid` e `FromBid` com `EncodeBinary` e `DecodeBinary`.
5. **Overflow e JSON (TODO-08 a TODO-10).** `MultiplyChecked`, que lança exceção quando operandos finitos estouram, e `ToJson` / `FromJson`, que mantêm os zeros à direita.

**Como você sabe que terminou**

`dotnet test` fica verde com 28 testes. Você deve conseguir explicar por que `checked` não pega o overflow do TODO-08.

**Desafios opcionais**

- Rode `SumTenths<Decimal32>` e `SumTenths<Decimal128>` e compare com `decimal`.
- Meça 20 milhões de somas de `double`, `decimal` e `Decimal64` em build Release e compare com a tabela acima.

**Pré-requisitos:** os concepts de tipos numéricos e arredondamento, generic math e o SDK do .NET 11 (os projetos miram `net11.0`).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Todo método com stub lança `NotImplementedException`, então os testes vermelhos são a sua lista de tarefas.

## Documentation Links

- [Decimal64 struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.decimal64) (doc)
- [What's new in .NET 11 libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [Decimal, double and BigInteger conversions in .NET 11, breaking change, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/11/decimal-biginteger-floating-point-conversions) (doc)
- [IDecimalFloatingPointIeee754<TSelf> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.idecimalfloatingpointieee754-1) (doc)
