---
version: 1.0
updatedAt: 2026-10-15
title: "Conversões Numéricas, Arredondamento e Overflow"
summary: Conversões implícitas e explícitas entre tipos numéricos, o que checked e unchecked realmente mudam, Math.Round e MidpointRounding (banker's rounding), Convert versus cast, CheckForOverflowUnderflow e as APIs que escolhem a política de overflow.
---
## Objective

Mover um número de um tipo para outro pode perder informação de quatro formas:
o valor não cabe, a fração é descartada, a precisão é arredondada ou o bit de
sinal muda de significado. O C# deixa você escolher o comportamento, mas o
padrão depende do tipo de conversão, e as três ferramentas que as pessoas usam
(o cast, `System.Convert` e `Math.Round`) discordam entre si sobre o `2.5`.
Este conceito cobre as regras de conversão implícita e explícita, o que
`checked` e `unchecked` realmente mudam (e o que não mudam), os modos de
arredondamento por trás de `Math.Round`, `Convert` e `ToString("F2")`, e as
APIs que escolhem a política de overflow de forma explícita. Ele continua a
visão em nível de bits do conceito anterior
(`numeric-types-and-binary-representation`).

## Use Cases

- Converter um `double` de um cálculo para um índice `int` ou um valor de pixel
  `byte` sem surpresas nas bordas.
- Arredondar dinheiro para centavos do jeito que a regra de negócio manda, e
  não do jeito que o padrão acontece de fazer.
- Detectar overflow de inteiros em totais, contadores, tamanhos e cálculos de
  hash.
- Estreitar números genéricos (`TTo.CreateChecked`) em código de biblioteca.
- Ler código que mistura `(int)x`, `Convert.ToInt32(x)` e `Math.Round(x)` e
  saber exatamente como cada um difere.

## Deep Dive

A saída vem do .NET 10 (SDK 10.0.100) em arm64, com
`CultureInfo.InvariantCulture`. Onde um resultado depende da plataforma, o
texto diz.

### Conversões implícitas: alargamento, nem sempre sem perda

O compilador permite uma conversão implícita quando todo valor do tipo de
origem cabe no destino. Exemplos: `byte` para `short`, `int` para `long`,
`float` para `double`, qualquer inteiro para `decimal`. A tabela está na página
do Microsoft Learn sobre conversões numéricas internas. Três regras importam na
prática:

- Qualquer tipo inteiro converte implicitamente para `float`, `double` e
  `decimal`. A conversão mantém a ordem de grandeza, mas nem sempre todos os
  dígitos.
- Não existe conversão implícita entre `decimal` e `float` ou `double` em
  nenhuma direção, então misturá-los numa expressão é erro de compilação.
- Uma expressão constante `int` converte implicitamente para um tipo menor
  quando o valor cabe (`byte b = 17;`), e é o erro CS0031 quando não cabe
  (`byte b = 300;`).

As conversões implícitas com perda são `int`/`uint`/`long`/`ulong` para `float`
e `long`/`ulong` para `double`:

```csharp
int i = 123_456_789;
float f = i;                 // 123456790
(int)f                       // 123456792   (não é o valor original)
(double)i                    // 123456789   (o double tem espaço para um int)

long big = 9_007_199_254_740_993;
double bd = big;             // 9007199254740992
(float)16777217              // 16777216
```

A aritmética promove os dois operandos a um tipo comum: `int + long` é `long`,
`int + float` e `long + float` são `float` (então um `long` pode perder dígitos
numa soma com `float`), `int + double` é `double`, `int + decimal` é `decimal`.
Tipos menores que `int` são promovidos a `int` antes, por isso `char + int` é
`int`, enquanto `(char)(ch + 1)` é `char` e `ch++` continua `char` (`'A'` vira
`'B'`).

### Conversões explícitas: casts e o que fazem

Um cast é um pedido ao compilador. O resultado depende do par de tipos.

**Inteiro para inteiro** mantém os bits baixos (unchecked) ou lança exceção
(checked):

```csharp
unchecked((byte)300)               // 44      300 = 1_0010_1100, 8 bits baixos = 0010_1100
unchecked((sbyte)200)              // -56
unchecked((short)70000)            // 4464
unchecked((uint)-1)                // 4294967295
unchecked((int)3_000_000_000L)     // -1294967296
```

**Ponto flutuante para inteiro** trunca em direção a zero, não arredonda:

```csharp
(int)-3.7     // -3
(int)3.7      // 3
(int)2.5      // 2
(long)-0.9    // 0
(int)-3.7m    // -3      decimal também trunca
```

**Fora da faixa, NaN e infinito.** A especificação da linguagem deixa sem
definição o resultado de um cast unchecked de `double` fora da faixa para
inteiro. Desde o .NET 9 o runtime faz as conversões de `double`/`float` para
`int`, `uint`, `long` e `ulong` saturarem em x86 e x64 (a página de breaking
change diz isso), e nesta máquina arm64 o .NET 10 deu o mesmo:

```csharp
(int)1e20                 // 2147483647
(int)-1e20                // -2147483648
(int)double.NaN           // 0
(int)double.PositiveInfinity   // 2147483647
(uint)-1.0                // 0
(uint)5e9                 // 4294967295
(ulong)-5.0               // 0
(long)1e30                // 9223372036854775807
```

Para os tipos pequenos, o resultado no .NET 10 passou por `int` e depois deu a
volta: `(byte)300.0` é `44`, `(byte)-5.0` é `251`, `(sbyte)1e10` é `-1`. As
páginas de compatibilidade do Microsoft Learn dizem que o .NET 11 faz as
conversões para `sbyte`, `byte`, `short`, `ushort` e `char` saturarem também,
então não dependa dos valores do .NET 10 para esses tipos. Trate casts de ponto
flutuante fora da faixa como "valide antes ou use `checked`".

**`double` para `float`** arredonda para o `float` mais próximo, e vira
`Infinity` ou `0` quando fora da faixa (`(float)1e40` é `Infinity`,
`(float)1e-50` é `0`). `(double)(float)0.1` é `0.10000000149011612`: alargar de
volta não recupera os dígitos.

**De e para `decimal`.** `(decimal)` de um `double` arredonda para cerca de 15
dígitos significativos, e `NaN`, infinitos e valores acima de cerca de 7,9e28
lançam `OverflowException`; um valor pequeno demais vira `0`
(`(decimal)1e-30` é `0`). `(int)` de um `decimal` trunca e lança exceção quando
não cabe, independentemente do contexto checked. A documentação do .NET 11
Preview 7 lista uma mudança para que as conversões entre `decimal` e `double`
sejam arredondadas corretamente (um `double` como `1.23` converteria para o
valor exato `1.229999999999999982236431606`). Isso não está no .NET 10, então o
comportamento de 15 dígitos acima é o que um programa .NET 10 vê.

### `checked` e `unchecked`

A aritmética e as conversões de inteiros rodam em um contexto de verificação de
overflow. O padrão é unchecked: o resultado é truncado nos bits baixos.

```csharp
int max = int.MaxValue;
max + 1                       // -2147483648
max * 2                       // -2
(short)max                    // -1
int acc = 1; for (int i = 1; i <= 13; i++) acc *= i;   // 13! = 1932053504 (errado)
```

Você troca o contexto para um bloco ou para uma expressão:

```csharp
checked { v++; }                        // OverflowException
checked(a + b)                          // OverflowException
checked((byte)300)                      // OverflowException
checked((int)3e9)                       // OverflowException  (double para int)
checked((int)double.NaN)                // OverflowException
checked((int)-3.7)                      // -3  (cabe depois do truncamento, sem exceção)
checked((uint)-1)                       // OverflowException
```

As operações afetadas são `++`, `--`, `-` unário, `+ - * /` binários em tipos
integrais e enums, e conversões explícitas entre tipos integrais ou de
`float`/`double` para um tipo integral. Não são afetados: deslocamentos e
operadores bitwise, `decimal` (ele sempre lança) e a aritmética de
`float`/`double` (dá `Infinity`; `checked((float)1e40)` continua `Infinity`).

Dois detalhes que causam bugs reais:

**O escopo é textual.** O contexto cobre as expressões escritas dentro do bloco
ou dos parênteses, não os métodos que elas chamam:

```csharp
static int Mul(int a, int b) => a * b;
checked { return Mul(2, int.MaxValue); }        // -2, sem exceção: Mul é unchecked
checked { return Mul(2, 2 * int.MaxValue); }    // OverflowException: 2 * int.MaxValue está escrito dentro
checked(x * y) / z                              // a multiplicação é checked
(x * y) / z                                     // unchecked: 100000 * 100000 / 1000 = 1410065
(long)x * y / z                                 // 10000000: alargue antes de multiplicar
```

Uma lambda escrita dentro do bloco é checked, porque o corpo dela está
textualmente ali.

**Constantes são checked por padrão em tempo de compilação.** O compilador
rejeita expressões constantes que estouram, então `int a = int.MaxValue + 1;` é
o erro CS0220, `byte b = 300;` é CS0031, `(byte)300` é CS0221 ("use `unchecked`
syntax to override") e `(decimal)double.NaN` é CS0031. Você precisa de
`unchecked(...)` para obter a constante com wrap de propósito.

O padrão pode ser invertido para um projeto com
`<CheckForOverflowUnderflow>true</CheckForOverflowUnderflow>` (um file-based
app aceita `#:property CheckForOverflowUnderflow=true`). Com isso ligado, todo
overflow de inteiro não constante no seu código lança exceção, inclusive hashes
escritos como `h = h * 31 + c`; esse laço lançou numa string de 43 caracteres,
então use `unchecked(...)` explicitamente ali, e ele retornou `1972221122`. O
código do framework é compilado separadamente e não é afetado
(`HashCode.Combine` e `string.GetHashCode` rodaram normalmente). Deslocamentos
continuam dando a volta (`int.MaxValue << 1` é `-2`).

A divisão tem um caso que nunca é unchecked: divisão inteira por zero lança
`DivideByZeroException`, e `int.MinValue / -1` lança `OverflowException` (a
documentação diz que uma `ArithmeticException` pode ser lançada) mesmo dentro
de `unchecked`. No experimento `int.MinValue % -1` também lançou.

O que o compilador emite é simples. Para `a + b` é `add`, para `checked(a + b)`
é `add.ovf`, para `checked(a * b)` é `mul.ovf`, e para um cast que estreita é
`conv.u1` versus `conv.ovf.u1` (bytes `58`, `D6`, `D8`, `D2`, `B4` nos corpos
de método que despejei). A forma checked custa um desvio e um teste de flag,
então é barata, mas não de graça em laços numéricos apertados.

### Arredondamento: cast, `Math.Round`, `Convert` e formatação

`Math.Round(double)` e `Math.Round(decimal)` usam `MidpointRounding.ToEven` por
padrão (banker's rounding): um valor exatamente no meio vai para o inteiro par
mais próximo. Os outros modos são `AwayFromZero` e três modos direcionados,
`ToZero`, `ToNegativeInfinity` e `ToPositiveInfinity`, que arredondam todos os
valores e não só os pontos médios.

```csharp
//    x  (int)  Round  ToEven AwayFromZero ToZero ToNegInf ToPosInf Floor Ceiling Truncate Convert.ToInt32
//  -2.5   -2     -2     -2        -3        -2     -3       -2      -3    -2      -2       -2
//  -1.5   -1     -2     -2        -2        -1     -2       -1      -2    -1      -1       -2
//   0.5    0      0      0         1         0      0        1       0     1       0        0
//   1.5    1      2      2         2         1      1        2       1     2       1        2
//   2.5    2      2      2         3         2      2        3       2     3       2        2
//   3.5    3      4      4         4         3      3        4       3     4       3        4
//   2.6    2      3      3         3         2      2        3       2     3       2        3
//  -2.6   -2     -3     -3        -3        -2     -3       -2      -3    -2      -2       -3
```

`Convert.ToInt32(double)` arredonda com a mesma regra de `Math.Round`
(`Convert.ToInt32(2.5)` é `2`, `3.5` é `4`, `2.51` é `3`), enquanto o cast
trunca. `Math.Round(-0.4)` é `-0` (zero negativo), e imprime como `-0`.

As casas decimais são onde `double` e `decimal` diferem.
`Math.Round(double, digits)` no código-fonte do .NET 10 multiplica por uma
potência de dez, arredonda o produto e divide de volta, e aceita de 0 a 15
dígitos; `decimal` arredonda o valor decimal exato e aceita de 0 a 28. Uma
quantidade negativa de dígitos lança `ArgumentOutOfRangeException` nos dois.

```csharp
Math.Round(2.675, 2)                 // 2.68   (2.675 * 100 = 267.5 em double, depois para o par)
Math.Round(2.675m, 2)                // 2.68
2.675.ToString("F2")                 // 2.67   (a formatação usa o valor exato guardado 2.67499999...)
Math.Round(1.005, 2)                 // 1      (1.005 * 100 = 100.49999999999999)
Math.Round(1.005m, 2)                // 1.00
Math.Round(1.005m, 2, MidpointRounding.AwayFromZero)  // 1.01
Math.Round(1.015m, 2)                // 1.02   (101.5 vai para o par 102)
Math.Round(1.015, 2)                 // 1.01   (1.015 é guardado um pouco abaixo)
Math.Round(0.125, 2)                 // 0.12
Math.Round(0.125, 2, MidpointRounding.AwayFromZero)   // 0.13
```

Duas conclusões. Primeiro, a mesma chamada em `double` e em `decimal` pode
diferir porque o literal `double` não é o número que você digitou. Segundo, a
formatação é uma terceira implementação de arredondamento: nesta execução
`0.5.ToString("F0")` deu `0` e `2.5.ToString("F0")` deu `2` para `double`, mas
`1` e `3` para `decimal`, e `0.125.ToString("N2")` deu `0.12` contra
`0.125m.ToString("N2")` dando `0.13`. Se um valor é exibido e também guardado,
arredonde uma vez, explicitamente, com o modo que a regra nomeia, e formate o
valor arredondado.

Arredondar cada parte e arredondar o total dão resultados diferentes:

```csharp
Math.Round(1.005m, 2) + Math.Round(1.005m, 2)   // 2.00
Math.Round(1.005m + 1.005m, 2)                  // 2.01
Math.Round(10m / 3, 2) * 3                      // 9.99, falta um centavo
```

Regras de dinheiro costumam dizer onde o arredondamento acontece (por linha ou
por nota) e para onde vai o centavo que sobra; codifique essa decisão, não uma
chamada a `Math.Round`.

### `System.Convert`

`Convert` é uma família de métodos estáticos. Para números ele se comporta de
forma diferente de um cast nestes pontos:

```csharp
Convert.ToInt32(2.51)             // 3      arredonda (para o par no ponto médio); (int)2.51 é 2
Convert.ToInt32(3e9)              // OverflowException (sempre checked)
Convert.ToByte(300)               // OverflowException
Convert.ToInt32(uint.MaxValue)    // OverflowException
Convert.ToInt32(double.NaN)       // OverflowException
Convert.ToInt32(true)             // 1
Convert.ToInt32('7')              // 55   o code point, não 7
Convert.ToInt32("42")             // 42
Convert.ToInt32((string?)null)    // 0    null vira zero
Convert.ToInt32("4.5")            // FormatException
Convert.ToBoolean("yes")          // FormatException
Convert.ToInt32(new object())     // InvalidCastException (não é IConvertible)
Convert.ToString(255, 2)          // 11111111
Convert.ToInt32("ff", 16)         // 255
Convert.ToInt32("102", 2)         // FormatException
Convert.ChangeType(12.7, typeof(int))   // 13
```

Duas armadilhas aparecem nessa lista. `Convert` com uma string `null` devolve `0`
em vez de falhar, o que esconde um valor ausente; e `Convert.ToInt32(string)`
usa a cultura atual, então `Convert.ToDouble("1,5")` devolveu `15` com a
cultura invariante e `Convert.ToDouble("1.5", new CultureInfo("pt-BR"))`
também devolveu `15` (o `.` é separador de milhar ali). O parsing com cultura
explícita é tratado em `parsing-tryparse-and-the-try-pattern`.

Os overloads de base 2, 8, 10 e 16 leem e escrevem texto em complemento de
dois: `Convert.ToString(-1, 16)` é `ffffffff` e uma string de 32 uns com base 2
vira `-1`.

### Escolhendo a política no código: `checked`, saturar, truncar, limitar

As interfaces de generic math colocam a política na própria chamada.
`TTo.CreateChecked`, `CreateSaturating` e `CreateTruncating` existem em todo
tipo numérico:

```csharp
byte.CreateChecked(300)        // OverflowException
byte.CreateSaturating(300)     // 255
byte.CreateSaturating(-5)      // 0
byte.CreateTruncating(300)     // 44        bits baixos, como unchecked
int.CreateSaturating(3e9)      // 2147483647
int.CreateChecked(double.NaN)  // OverflowException
int.CreateSaturating(double.NaN)   // 0
int.CreateTruncating(-3.7)     // -3
int.CreateTruncating(uint.MaxValue)  // -1

static TTo Narrow<TFrom, TTo>(TFrom v)
    where TFrom : INumberBase<TFrom> where TTo : INumberBase<TTo>
    => TTo.CreateChecked(v);
Narrow<long, short>(70000L)    // OverflowException
```

`Math.Clamp(300, 0, 255)` é a saturação legível para um valor que você já tem
em um tipo mais largo.

Algumas APIs do framework são checked independentemente do que o seu projeto
diz: `Math.Abs(int.MinValue)`, `Enumerable.Sum` sobre `int` ou `long`
(`new[] { int.MaxValue, 1 }.Sum()` lança), `new int[-1]` e
`Math.DivRem(int.MinValue, -1)` lançaram `OverflowException`, enquanto
`Aggregate(0, (a, b) => a + b)` deu a volta para `-2147483648` e
`Sum(x => (long)x)` deu `2147483648`. `Average()` de dois `int.MaxValue` é
correto (`2147483647`) porque acumula em um `long`.

### Operadores e conversões checked definidos pelo usuário

Desde o C# 11 um tipo pode fornecer uma variante `checked` dos operadores
aritméticos e das conversões explícitas. Um contexto checked chama ela, um
contexto unchecked chama a comum, e você também precisa definir o operador
comum:

```csharp
readonly record struct Pct(byte Value)
{
    public static Pct operator +(Pct a, Pct b) => new(unchecked((byte)(a.Value + b.Value)));
    public static Pct operator checked +(Pct a, Pct b) => new(checked((byte)(a.Value + b.Value)));
    public static explicit operator Pct(int v) => new(unchecked((byte)v));
    public static explicit operator checked Pct(int v) => new(checked((byte)v));
}

new Pct(200) + new Pct(100)               // 44%
checked(new Pct(200) + new Pct(100))      // OverflowException
(Pct)300                                  // 44%
checked((Pct)300)                         // OverflowException
```

Segundo a documentação, a palavra-chave `checked` no operador não muda o
contexto dentro do corpo dele; o corpo usa `checked`/`unchecked`
explicitamente, como acima.

## Trade-offs

- **Unchecked é o padrão porque é rápido e às vezes desejado.** Hashes,
  checksums e geradores aleatórios dependem do wrap-around. O custo é que um
  contador ou uma soma pode ficar negativo em silêncio; coloque `checked` em
  volta de dinheiro, tamanhos e índices, e `unchecked` em volta de código de
  hash.
- **`CheckForOverflowUnderflow` no projeto inteiro é uma rede de segurança com
  preço.** Pega todo overflow silencioso no seu código, e também quebra funções
  de hash escritas à mão até você marcá-las `unchecked`. Ligue em aplicações e
  testes, decida caso a caso em bibliotecas.
- **Um cast é a forma mais curta de dizer "aceito a perda", e não diz qual
  perda.** `(int)x` trunca, `Math.Round` vai para o par, e `Convert.ToInt32`
  arredonda e lança exceção. Nomeie a intenção no código
  (`Math.Round(x, MidpointRounding.AwayFromZero)`, `int.CreateSaturating(x)`).
- **Banker's rounding é estatisticamente justo e surpreende usuários.** Evita
  viés ao somar muitas metades arredondadas, mas uma lista de preços em que
  `2.5` vira `2` parece errada. Escolha o modo pela regra de negócio, e prefira
  `decimal` para que o ponto médio seja de fato um ponto médio.
- **`Convert` é conveniente nas fronteiras e permissivo nos lugares errados.**
  Um `null` vira `0` e a cultura é implícita. Para entrada, faça parsing; para
  um estreitamento numérico sabidamente seguro, use um cast dentro de `checked`
  ou `CreateChecked`.
- **Saturar esconde o problema que checked revela.** Limitar a leitura de um
  sensor a um `byte` é aceitável; limitar o valor de um pagamento é um bug à
  espera de uma auditoria. Use saturação onde o máximo é uma resposta legítima.
- **Depender de casts de ponto flutuante fora da faixa é depender da versão do
  runtime.** O resultado mudou entre o .NET 8 e o .NET 9, e os tipos inteiros
  pequenos mudam de novo no .NET 11. Valide a faixa e o `NaN` antes.

## Lab

Neste lab você recebe a classe estática `Conversions` **esboçada**, com seis métodos que lançam `NotImplementedException`, e testes xUnit prontos. O seu trabalho é implementá-los. A ideia central é escolher de forma explícita a conversão, o modo de arredondamento e a política de overflow, em vez de confiar no padrão de um cast, de `Convert` ou de `Math.Round`. Cada método tem um caso de borda em que o código óbvio dá um resultado errado ou silencioso (NaN, metades, estouro que dá a volta).

**O cenário**

Pequenos conversores numéricos que aparecem em qualquer sistema: brilho de pixel, valores em centavos, índices e somas.

- `ToPixel` e `RoundToCents`: arredondamento com regra de negócio (`double` para `byte` e `decimal` para duas casas).
- `ToIndex` e `ToIntWithConvert`: duas formas de ir de `double` para `int`, com regras diferentes para a parte fracionária.
- `SumExact` e `TryAddExact`: soma de `int` sem estouro silencioso, uma lançando exceção e a outra seguindo o padrão Try.

Tudo mora em `Conversions.cs`, e os testes em `ConversionTests.cs` fixam os valores de borda.

**O que você vai fazer, passo a passo**

1. **Pixel seguro (TODO-00).** Em `ToPixel`, arredonde metades para longe de zero (2.5 vira 3), limite o valor a 0..255 e mapeie NaN para 0. Um cast `(byte)` direto dá resultado não especificado fora da faixa, então limite antes de converter.
2. **Arredondar dinheiro (TODO-01).** Em `RoundToCents`, arredonde para duas casas com as metades indo para longe de zero (2.345 vira 2.35, -2.345 vira -2.35). O `Math.Round` padrão usa arredondamento bancário, então escolha o `MidpointRounding` de forma explícita.
3. **Truncar e falhar alto (TODO-02).** Em `ToIndex`, trunque em direção a zero (2.9 vira 2, -2.9 vira -2) e lance `OverflowException` para NaN, infinitos e valores fora da faixa de `int`. Um cast sem `checked` devolve lixo nesses casos.
4. **Conhecer o `Convert` (TODO-03).** Em `ToIntWithConvert`, use `System.Convert`: `Convert.ToInt32` arredonda para o inteiro mais próximo e manda as metades para o vizinho par (2.5 vira 2, 3.5 vira 4), ao contrário do cast que trunca.
5. **Detectar a volta (TODO-04).** Em `SumExact`, some os valores e lance `OverflowException` quando o total não cabe em `int`. Sem `checked`, a soma de `int` dá a volta em silêncio, tanto para cima quanto para baixo.
6. **Padrão Try (TODO-05).** Em `TryAddExact`, devolva `true` e a soma quando couber, e `false` com `result = 0` quando não couber, sem exceção para uma falha esperada.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `ToIntWithConvert(2.5)` dá 2 enquanto `ToIndex(2.9)` dá 2 por motivo diferente, e quando preferir `SumExact` a `TryAddExact`.

**Desafios opcionais**

Os três não têm esqueleto nem teste, então você escreve ambos.

- **TODO-06:** `NarrowChecked<TFrom, TTo>` usando `TTo.CreateChecked`.
- **TODO-07:** `AddSaturating`, que limita o resultado à faixa de `int` em vez de lançar exceção ou dar a volta.
- **TODO-08:** `SplitEvenly`, que divide um valor em partes cuja soma é exatamente o total.

**Pré-requisitos:** tipos numéricos de C#, `checked` e `unchecked`, exceções e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos esboçados lançam `NotImplementedException`, então os testes vermelhos são o seu checklist, e os comentários `TODO-NN` explicam o caso de borda de cada um.

## Documentation Links

- [Built-in numeric conversions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/numeric-conversions) (doc)
- [The checked and unchecked statements, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/checked-and-unchecked) (doc)
- [Arithmetic operators, overflow and user-defined checked operators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/arithmetic-operators) (doc)
- [MidpointRounding enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.midpointrounding) (doc)
- [Math.Round method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.math.round) (doc)
- [Convert class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.convert) (doc)
- [Floating point-to-integer conversions are saturating (.NET 9), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/jit/9.0/fp-to-integer) (doc)
- [CheckForOverflowUnderflow compiler option, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-options/language#checkforoverflowunderflow) (doc)
