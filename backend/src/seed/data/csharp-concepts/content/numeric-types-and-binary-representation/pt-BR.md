---
version: 1.0
updatedAt: 2026-10-15
title: "Tipos Numéricos e Representação Binária"
summary: Complemento de dois, deslocamentos (incluindo >>>), IEEE 754 e por que 0.1 + 0.2 != 0.3, NaN e Infinity, comparação com tolerância, a escala do decimal, float versus decimal para dinheiro e os tipos Half, Int128 e nint.
---
## Objective

A maioria dos bugs numéricos em C# não é erro de sintaxe. Vem do que um número
realmente é na memória: uma quantidade fixa de bits, interpretada como
complemento de dois nos inteiros, como fração binária IEEE 754 em `float` e
`double`, e como um inteiro de 96 bits com uma escala decimal em `decimal`.
Este conceito explica essas três representações, para que `0.1 + 0.2`,
`int.MinValue`, `NaN`, `1 << 32` e `1.0m` versus `1.00m` deixem de ser
surpresa. Também cobre os operadores de deslocamento (incluindo `>>>`), os
tipos novos `Half`, `Int128` e o `nint` de tamanho nativo, e como escolher um
tipo para dinheiro e para medições. Conversões, arredondamento e overflow ficam
no próximo conceito (`numeric-conversions-rounding-and-overflow`).

## Use Cases

- Escolher entre `double` e `decimal` para preços, impostos, leituras de
  sensores e notas.
- Empacotar flags e campos em um inteiro e lê-los de volta com máscaras e
  deslocamentos.
- Comparar resultados de ponto flutuante em um teste de unidade ou numa regra
  de negócio.
- Entender resultados errados nas bordas: `Math.Abs(int.MinValue)`, um contador
  `float` que para de contar, um `NaN` que quebra a ordenação.
- Interop e código de baixo nível em que o tamanho do inteiro importa (`nint`,
  `Int128`, `Half` para dados de ML).

## Deep Dive

Toda a saída abaixo vem do .NET 10 com `CultureInfo.InvariantCulture`; com a
cultura pt-BR ou de-DE o ponto decimal sai como vírgula (veja
`formatting-values-and-interpolated-strings`).

### Tipos inteiros e literais

As palavras-chave integrais são apelidos de tipos .NET: `int` é `System.Int32`.
A tabela abaixo foi impressa com `Unsafe.SizeOf<T>()` e `MinValue`/`MaxValue`:

```csharp
sbyte  1 -128..127              byte   1 0..255
short  2 -32768..32767          int    4 -2147483648..2147483647
uint   4 0..4294967295          long   8 -9223372036854775808..9223372036854775807
ulong  8 0..18446744073709551615
Int128 16 -170141183460469231731687303715884105728..170141183460469231731687303715884105727
```

Um literal pode usar `_` como separador de dígitos e os prefixos `0b` ou `0x`:
`1_000_000`, `0b1010_1010` (170) e `0xFF_FF` (65535). O tipo dele é o primeiro
entre `int`, `uint`, `long`, `ulong` que comporta o valor, então literais não
carregam sinal:

```csharp
0xFFFFFFFF.GetType()   // System.UInt32
2147483648.GetType()   // System.UInt32   (não cabe em int, então é uint, não um int negativo)
0x7FFFFFFF.GetType()   // System.Int32
0xFFFFFFFFF.GetType()  // System.Int64
unchecked((int)0xFFFFFFFF)  // -1
```

A aritmética com `byte`, `sbyte`, `short` e `ushort` acontece em `int`:
`(byte)200 + (byte)100` vale `300` e seu tipo é `System.Int32`, assim como
`short + short`. Por isso `byte c = a + b;` exige um cast.

### Complemento de dois

Um inteiro com sinal usa o bit mais alto como peso de menos 2^(n-1), em vez de
um flag de sinal. Para negar, inverta todos os bits e some um:

```csharp
Convert.ToString(5, 2).PadLeft(32, '0')   // 00000000000000000000000000000101
Convert.ToString(~5, 2)                   // 11111111111111111111111111111010   ~5 == -6
Convert.ToString(-5, 2)                   // 11111111111111111111111111111011
-5 == ~5 + 1                              // true
(-5).ToString("X8")                       // FFFFFFFB
```

Duas consequências. A faixa é assimétrica: há um valor negativo a mais do que
positivos, então `-int.MinValue` não tem representação. Em contexto unchecked
ele continua `-2147483648` em silêncio, e `Math.Abs(int.MinValue)` lança
`OverflowException` ("Negating the minimum value of a twos complement number
is invalid."). E o cast entre com sinal e sem sinal reinterpreta os mesmos
bits: `unchecked((int)uint.MaxValue)` é `-1`, `unchecked((uint)-5)` é
`4294967291` e `unchecked((byte)-5)` é `251`.

Uma armadilha ao imprimir: `Convert.ToString(value, toBase)` não tem overload
para `sbyte`, então `Convert.ToString((sbyte)-1, 2)` é promovido a `short` e
imprime 16 uns, não 8. Converta para `byte` antes para ver `11111111`.

### Deslocamentos, máscaras e `BitOperations`

`<<` e `>>` movem bits. `>>` em tipo com sinal é um deslocamento aritmético
(copia o bit de sinal); em tipo sem sinal é lógico (preenche com zero). O
`>>>`, adicionado no C# 11, é sempre lógico, então não é mais preciso fazer
cast para `uint` e voltar:

```csharp
int n = -16;
n >> 2          // -4
n >>> 2         // 1073741820   (hex 3FFFFFFC)
n << 1          // -32
```

A contagem do deslocamento é mascarada para a largura do operando da esquerda:
cinco bits para `int`/`uint`, seis para `long`/`ulong`. Uma contagem grande
demais não dá zero, ela dá a volta:

```csharp
1 << 31   // -2147483648
1 << 32   // 1
1 << 33   // 2
1L << 32  // 4294967296
1L << 64  // 1
```

Deslocamentos e operadores bitwise nunca estouram e se comportam igual em
contexto `checked` e `unchecked`. Um conjunto de flags é o uso clássico:

```csharp
uint flags = 0;
flags |= 1u << 2;  flags |= 1u << 0;     // 101
(flags & (1u << 2)) != 0                 // true
flags & ~(1u << 2)                       // 1  (bit limpo)
```

Para contar e procurar bits, use os helpers apoiados em hardware em vez de
laços. `System.Numerics.BitOperations` e os métodos estáticos equivalentes nos
tipos inteiros (`int.PopCount`, `uint.RotateRight`, `int.Log2`) deram:

```csharp
BitOperations.PopCount(255u)            // 8
BitOperations.LeadingZeroCount(1u)      // 31
BitOperations.TrailingZeroCount(8u)     // 3
BitOperations.IsPow2(64)                // True
BitOperations.Log2(1000)                // 9
BitOperations.RotateLeft(0x80000001u, 1)  // 00000003
BitOperations.RoundUpToPowerOf2(1000u)  // 1024
```

### IEEE 754: como o `double` guarda um número

Um `double` tem 64 bits: um de sinal, 11 de expoente e 52 de fração. O valor é
(-1)^sinal x 1.fração x 2^(expoente - 1023). Como a fração é binária, só somas
de potências de dois são exatas. O 0.1 não é uma delas, então o valor guardado
é o double representável mais próximo, ligeiramente acima de 0.1:

```csharp
1.0  : 0 01111111111 0000...0000   0x3FF0000000000000
0.1  : 0 01111111011 1001100110011001100110011001100110011001100110011010   0x3FB999999999999A
-2.5 : 1 10000000000 0100...0000   0xC004000000000000

0.1.ToString("F25")                 // 0.1000000000000000055511151
0.1 + 0.2                           // 0.30000000000000004
(0.1 + 0.2) == 0.3                  // False
(0.1 + 0.2).ToString("F20")         // 0.30000000000000004441
0.3.ToString("F20")                 // 0.29999999999999998890
```

Os dois resultados são vizinhos: diferem em uma unidade na última casa
(`BitConverter.DoubleToInt64Bits` dos dois difere em 1). O `ToString()` imprime
o texto mais curto que faz o round-trip, por isso os dígitos parecem poucos,
mas `F20` mostra a verdade. O `float` tem o mesmo problema com 23 bits de fração
(0.1f é exatamente `0.100000001490116...`); só acontece que
`0.1f + 0.2f == 0.3f` dá `true`, o que esconde o problema até um cálculo
posterior.

A precisão é relativa, não absoluta. Um `double` tem mantissa de 53 bits,
então acima de 2^53 ele não representa mais todos os inteiros. O `float` para em
2^24:

```csharp
9007199254740992.0 + 1       // 9007199254740992   (o +1 se perde)
9007199254740992.0 + 2       // 9007199254740994
(float)16777216 + 1f         // 16777216
Math.BitIncrement(1.0) - 1.0 // 2.220446049250313E-16
Math.BitIncrement(1e16) - 1e16  // 2   (distância entre vizinhos perto de 1e16)
```

Erros se acumulam em laços. Somando `0.1` dez vezes:

```csharp
double  0.9999999999999999   == 1.0 ? False
float   1.0000001            == 1.0f ? False
decimal 1.0                  == 1.0m ? True
```

e somar `0.1f` um milhão de vezes num `float` termina em `100958.34`, não em
100000, porque cada soma arredonda para o `float` mais próximo e os erros de
arredondamento se acumulam.

### NaN, Infinity e zero negativo

A aritmética de ponto flutuante não lança exceção na divisão por zero. Ela
devolve valores especiais, enquanto a divisão por zero de inteiro e de `decimal`
lança `DivideByZeroException`:

```csharp
1.0 / 0            // Infinity
-1.0 / 0           // -Infinity
0.0 / 0            // NaN
Math.Sqrt(-1)      // NaN
Math.Log(0)        // -Infinity
double.MaxValue * 2   // Infinity
1.0 % 0            // NaN
```

`NaN` não é igual a nada, nem a ele mesmo, e toda comparação de ordem dá
falso. Os métodos `Equals` e `CompareTo` são a exceção: tratam `NaN` como igual
a si mesmo e menor que qualquer outro valor, para que ordenação e tabelas hash
sejam consistentes:

```csharp
double nan = double.NaN;
nan == nan            // False
nan != nan            // True
nan < 1, nan > 1      // False, False
nan.Equals(nan)       // True
nan.CompareTo(1.0)    // -1
double.IsNaN(nan)     // True

new List<double> { 3, double.NaN, 1, 2 }.Sort()   // NaN, 1, 2, 3
Math.Max(double.NaN, 1)                           // NaN
```

Muitos padrões de bits são `NaN`. Na máquina usada nestes exemplos
`double.NaN` tem os bits `FFF8000000000000`, enquanto `0.0 / 0` calculado em
tempo de execução produziu `7FF8000000000000`, e os dois são `NaN`. O zero
negativo também existe: `-0.0 == 0.0` é `true`, `1 / -0.0` é `-Infinity` e
`double.IsNegative(-0.0)` é `true`. Use `double.IsFinite`, `double.IsNaN` e
`double.IsInfinity` para validar entradas, porque um `NaN` que entra numa soma
contamina o resultado inteiro.

### Comparando valores de ponto flutuante

Nunca use `==` em valores calculados. `double.Epsilon` também não é a resposta:
é o menor double positivo (`5E-324`), não uma tolerância, e a página do `Double`
no Microsoft Learn desaconselha usá-lo em testes de igualdade. Uma tolerância
precisa combinar uma parte absoluta (para valores perto de zero) e uma relativa
(para valores grandes):

```csharp
static bool Near(double a, double b, double rel = 1e-9, double abs = 1e-12)
    => Math.Abs(a - b) <= Math.Max(abs, rel * Math.Max(Math.Abs(a), Math.Abs(b)));

Near(0.1 + 0.2, 0.3)       // True
Near(1e10 + 1e-3, 1e10)    // True
Near(0.0, 1e-15)           // True
Near(0.0, 1e-9)            // False
Math.Abs(0.1 + 0.2 - 0.3) < double.Epsilon   // False  (a diferença é 5.55E-17)
```

A tolerância certa depende do domínio; os números acima são exemplos, não
constantes para copiar. Frameworks de teste já trazem isso pronto (um
`Assert.Equal` com argumento de precisão, por exemplo).

### `decimal`: um inteiro de 96 bits com escala decimal

O `decimal` guarda um sinal, um inteiro de 96 bits e uma escala de 0 a 28 que
diz quantos dígitos há depois da vírgula. O valor é inteiro / 10^escala.
Frações decimais como 0.1 são exatas, e a escala preserva zeros à direita:

```csharp
decimal.GetBits(1.0m)  -> inteiro 10,  escala 1
decimal.GetBits(1.00m) -> inteiro 100, escala 2
decimal.GetBits(1m)    -> inteiro 1,   escala 0
1.0m == 1.00m          // True   (aritmética e comparação ignoram a escala)
1.00m.ToString()       // 1.00   (mas o texto mostra)
1.250m.Scale           // 3
```

A escala acompanha os operandos na aritmética: a soma mantém a maior escala, a
multiplicação soma as escalas, e o resultado não é normalizado.

```csharp
1.10m + 2.205m   // 3.305
1.10m * 2.0m     // 2.200
100m * 1.1m      // 110.0
100m * 1.10m     // 110.00
10m / 4m         // 2.5
1m / 3m          // 0.3333333333333333333333333333   (28 dígitos)
1m / 3m * 3m     // 0.9999999999999999999999999999
```

Ou seja, `decimal` é exato para frações decimais, não para qualquer número
racional. A faixa é de cerca de +/-7,9 x 10^28, e passar dela lança exceção,
diferente do `double`: `decimal.MaxValue + 1m` lança `OverflowException`.
Converter `double` para `decimal` mantém cerca de 15 dígitos significativos,
então `(decimal)(0.1 + 0.2)` é `0.3`, `(decimal)1234567890123.456789` é
`1234567890123.46`, e `NaN`, infinitos e valores fora da faixa lançam
`OverflowException` (uma constante como `(decimal)double.NaN` é erro de
compilação, CS0031). Essa conversão esconde o erro do double; ela não conserta
um cálculo que já perdeu precisão.

O custo é velocidade e tamanho: 16 bytes e aritmética implementada em software.
Um laço de 50 milhões de somas levou 37 ms com `double` e 447 ms com `decimal`
em build Release na máquina de teste (cerca de 12 vezes). A página do Microsoft
Learn diz que a diferença passa despercebida, exceto nas aplicações mais
intensivas em cálculo.

### Por que não `float` para dinheiro

Um preço como `19.99` não é representável, e os erros não se cancelam:

```csharp
// somando 0.10 mil vezes
float   99.99905
double  99.9999999999986
decimal 100.0

19.99 * 100                  // 1998.9999999999998
(int)(19.99 * 100)           // 1998  (centavos truncados)
(int)(19.99m * 100)          // 1999
```

Para dinheiro, guarde `decimal` (ou centavos inteiros em um `long`),
arredonde explicitamente e deixe o `double` para medições, estatística,
gráficos e tudo em que um erro relativo de 1e-16 não importa.

### `Half`, `Int128` e inteiros de tamanho nativo

`Half` é um tipo IEEE 754 de 16 bits (1 de sinal, 5 de expoente, 10 de fração)
usado em GPU e ML. `Half.MaxValue` é `65504` (imprime como `65500`, o texto mais
curto que faz round-trip), `(Half)65520` é `Infinity` e `(Half)0.1` fica
armazenado como `0.0999755859`. A precisão é minúscula: um laço de `Half`
somando `1` para em `2048`, e `(Half)0.1 + (Half)0.2` imprime `0.2998`.

`Int128` e `UInt128` são inteiros de 16 bytes com os operadores usuais. Evitam
o overflow onde `long` falha (`(Int128)long.MaxValue * long.MaxValue` é
`85070591730234615847396907784232501249`), e `>>` versus `>>>` se comportam como
nos outros inteiros (`(Int128)(-1) >> 1` é `-1`, `>>> 1` é
`170141183460469231731687303715884105727`). Para inteiros sem limite use
`System.Numerics.BigInteger`; a aritmética decimal exata em Java é tratada em
`exact-arithmetic-with-bigdecimal-and-biginteger`.

`nint` e `nuint` têm tamanho nativo: 4 bytes num processo de 32 bits, 8 num de
64 bits. Desde o C# 11 são simples apelidos de `System.IntPtr` e
`System.UIntPtr` (`typeof(nint) == typeof(IntPtr)` é `true`). `MinValue` e
`MaxValue` são calculados em tempo de execução, uma constante de compilação do
tipo `nint` fica limitada à faixa de 32 bits (o compilador avisa com CS8778
para constantes maiores) e não existe sufixo de literal, então escreva
`(nint)42`. Use para interop com APIs nativas, não como um "int mais rápido".

## Trade-offs

- **`double` é o tipo real padrão e geralmente está certo.** É rápido, apoiado
  em hardware e tem de 15 a 17 dígitos. Está errado para valores que precisam
  bater com um livro-caixa decimal até o centavo, porque `0.1` não é
  armazenável e os erros se acumulam (mil somas de `0.10` deram
  `99.9999999999986`).
- **`decimal` é exato para frações decimais, mas mais lento e maior.** Custa 16
  bytes e cerca de uma ordem de grandeza de vazão aritmética (12 vezes no laço
  acima), e ainda arredonda (`1m / 3m` tem 28 dígitos). Use para dinheiro e
  taxas, não para física.
  ```csharp
  decimal total = 0m; foreach (var p in prices) total += p;   // exato para centavos
  ```
- **Centavos inteiros são exatos e rápidos, mas empurram a formatação para as
  bordas.** Guardar `1999` num `long` evita os problemas de `float` e de
  `decimal`, ao custo de converter em toda exibição e leitura.
- **Comparar ponto flutuante exige tolerância, e a tolerância é uma decisão.**
  Uma tolerância relativa falha perto de zero, uma absoluta falha em grandes
  magnitudes, e as duas escondem um bug real se forem largas demais. Prefira
  comparar depois de arredondar para a precisão que o domínio define.
- **`NaN` e `Infinity` no lugar de exceções mantêm o cálculo rodando e tornam a
  falha silenciosa.** Valide com `double.IsFinite` nas fronteiras (parsing,
  desserialização) para que um `NaN` não viaje até um relatório.
- **Aritmética com wrap-around é barata e implacável.** O padrão para `int` é
  unchecked, então `int.MaxValue + 1` vira `int.MinValue` sem erro; o próximo
  conceito mostra o `checked`.
- **`Half`, `Int128` e `nint` resolvem problemas estreitos.** `Half` guarda cerca
  de três dígitos decimais e é mais um formato de armazenamento, `Int128` é mais
  lento que `long` e `nint` amarra seu código a um detalhe da plataforma.

## Documentation Links

- [Integral numeric types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/integral-numeric-types) (doc)
- [Floating-point numeric types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/floating-point-numeric-types) (doc)
- [Bitwise and shift operators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/bitwise-and-shift-operators) (doc)
- [Double struct, precision and comparison remarks, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.double) (doc)
- [Decimal struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.decimal) (doc)
- [BitOperations class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.numerics.bitoperations) (doc)
- [The history of C# (C# 11: nint aliases, generic math), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
