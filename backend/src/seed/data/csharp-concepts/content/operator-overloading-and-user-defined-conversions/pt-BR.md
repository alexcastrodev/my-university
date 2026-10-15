---
version: 1.0
updatedAt: 2026-10-15
title: "Sobrecarga de Operadores e Conversões Definidas pelo Usuário"
summary: Operadores como métodos estáticos, os pares que o compilador exige, conversões implicit e explicit, operadores checked (C# 11) e os operadores de atribuição composta e de incremento de instância do C# 14, que mutam no lugar e mudam o que x += y significa para um tipo referência.
---
## Objective

Operadores deixam um tipo com cara de tipo nativo: `price * quantity`, `a + b`,
`start < end`. Em C# eles são métodos estáticos comuns com nomes especiais, e a
linguagem põe algumas regras por cima: certos operadores vêm em pares, uma
variante `checked` pode existir ao lado da normal, conversões podem ser
implícitas ou explícitas e, novidade do C# 14, a atribuição composta (`+=`) e o
incremento (`++`) podem ser declarados como métodos de instância que mutam no
lugar. Essa última mudança altera o que `x += y` significa para um tipo
referência, e é a parte que mais vale entender antes de usar. Este conceito
cobre as regras de declaração, conversões definidas pelo usuário, operadores
checked, os operadores de atribuição composta e de incremento de instância do
C# 14, e as diretrizes que evitam que operadores surpreendam quem chama.

## Use Cases

- Value objects com aritmética: `Money`, `Vector2`, `Fraction`.
- Tipos de domínio que embrulham um primitivo com uma conversão: `Digit` para `byte`.
- Tipos numéricos grandes e mutáveis (buffers, tensores, inteiros grandes) em
  que `x += y` deveria atualizar no lugar em vez de alocar um resultado novo.
- Generic math: tipos que implementam `IAdditionOperators<,,>` e companhia para
  que algoritmos genéricos possam usar `+` neles.

## Deep Dive

### Operadores são métodos estáticos

```csharp
readonly record struct Money(decimal Amount, string Currency)
{
    public static Money operator +(Money l, Money r)
    {
        if (l.Currency != r.Currency)
            throw new InvalidOperationException($"{l.Currency} vs {r.Currency}");
        return l with { Amount = l.Amount + r.Amount };
    }
    public static Money operator *(Money m, decimal k) => m with { Amount = m.Amount * k };
}

var a = new Money(10m, "EUR");
var b = new Money(2.5m, "EUR");
a + b;                              // 12.5 EUR
a * 3;                              // 30 EUR
a + new Money(1, "USD");            // InvalidOperationException: EUR vs USD
2m * a;                             // CS0019: só Money * decimal foi declarado
```

O compilador transforma `a + b` numa chamada a `op_Addition(a, b)`. As regras
dos operadores clássicos: `public static`, pelo menos um parâmetro do tipo que
os contém (CS0558 quando falta `public static`), e a ordem dos operandos
importa, então `decimal * Money` precisa de declaração própria. Operadores
declarados numa struct são elevados automaticamente para `Nullable<T>`: com
`Money? none = null`, `none + a` é `null`, não uma exceção.

Não dá para sobrecarregar: `&&` e `||` (derivados de `&`, `|`, `true`, `false`),
indexação (escreva um indexador), `=`, `.`, `?.`, `??`, `..` e os operadores de
palavra-chave como `is`, `as` e `new`.

### Pares que o compilador exige

Operadores de comparação vêm em pares: `==` com `!=`, `<` com `>`, `<=` com
`>=`.

```csharp
class A { public static bool operator <(A l, A r) => true; }
// error CS0216: The operator 'A.operator <(A, A)' requires a matching operator '>' to also be defined

class B { /* só == e != */ }
// warning CS0660: 'B' defines operator == or operator != but does not override Object.Equals(object o)
// warning CS0661: ... does not override Object.GetHashCode()
```

Os avisos importam: um `==` que discorda de `Equals` quebra dicionários e LINQ.
Um record ou record struct gera `==`, `!=`, `Equals` e `GetHashCode` juntos e não
deixa você declarar `==` por conta própria; a história completa da igualdade
está em Struct and Record Equality.

### Conversões definidas pelo usuário

```csharp
readonly struct Digit
{
    private readonly byte value;
    public Digit(byte v) => value = v <= 9 ? v : throw new ArgumentOutOfRangeException(nameof(v));
    public static implicit operator byte(Digit d) => d.value;    // sempre segura
    public static explicit operator Digit(byte b) => new(b);     // pode lançar
}

var d = new Digit(7);
byte by = d;                 // 7: implícita
int i = d;                   // 7: definida pelo usuário até byte, depois padrão de byte para int
Digit back = (Digit)by;      // 7: exige cast explícito
(Digit)(byte)12;             // ArgumentOutOfRangeException

object o = d;
o is byte;                   // False: is/as ignoram conversões definidas pelo usuário
(byte)o;                     // InvalidCastException: isto é unboxing, não o operador
```

A documentação diz a regra com todas as letras: conversões implícitas nativas
nunca lançam e nunca perdem informação, e as definidas pelo usuário devem se
comportar igual; uma conversão que pode lançar ou perder dados tem que ser
explícita. Conversões são resolvidas em tempo de compilação a partir dos tipos
estáticos, então quando o valor está tipado como `object` (ou interface, ou um
`T` genérico) o operador nem é considerado. Conversões de ou para uma interface
(CS0552) ou um tipo base, `object` incluído (CS0553), nem podem ser declaradas.

### Operadores checked (C# 11)

Contextos `checked` e `unchecked` só afetavam a aritmética nativa. Agora um tipo
pode oferecer os dois comportamentos:

```csharp
readonly record struct Meters(int Value)
{
    public static Meters operator +(Meters l, Meters r) => new(l.Value + r.Value);
    public static Meters operator checked +(Meters l, Meters r) => new(checked(l.Value + r.Value));
}

var big = new Meters(int.MaxValue);
unchecked(big + new Meters(1));   // Meters { Value = -2147483648 }
checked(big + new Meters(1));     // OverflowException
```

A forma checked exige a regular (senão CS9025), e é permitida em `++ -- -`
unários, `+ - * /` binários, conversões explícitas e, no C# 14, em
`+= -= *= /=`. O modificador `checked` não torna o corpo checked; escreva
`checked(...)` lá dentro, como acima. A verificação para o projeto todo
(`CheckForOverflowUnderflow`) e o overflow nativo estão em Numeric Conversions,
Rounding and Overflow.

### C# 14: atribuição composta como operador de instância

Antes do C# 14, `x += y` era sempre `x = x + y`: o operador binário produzia um
valor novo e a variável era reatribuída. Agora um tipo pode declarar a forma
composta diretamente, como um método `public`, não estático, `void`, com um
parâmetro:

```csharp
class Buffer
{
    public static int PlusCalls;
    private readonly StringBuilder sb = new();

    public static Buffer operator +(Buffer b, string s)
    { PlusCalls++; var n = new Buffer(); n.sb.Append(b.sb).Append(s); return n; }

    public void operator +=(string s) => sb.Append(s);    // muta this
}

var buf = new Buffer();
var alias = buf;
buf += "abc";
buf += "de";
// buf=abcde alias=abcde same=True plusCalls=0
var r = buf += "!";        // r é a mesma instância que buf
```

Quando o lado esquerdo é uma variável (local, campo, elemento de array) e o tipo
declara um `+=` compatível, o operador de instância ganha e o `+` nunca é
chamado. Esse é o ganho de desempenho que a especificação descreve para tipos
grandes: nenhuma instância nova, nenhuma cópia. E é também uma mudança de
semântica para tipos referência. Com só um `+` estático, o mesmo código deixa
`alias` intacto:

```csharp
var imm = new ImmutableBuffer("x");   // só o operator + estático
var immAlias = imm;
imm += "y";
// imm=xy immAlias=x
```

Quem aprendeu que `+=` numa referência cria um objeto novo passa a ver mutação
no lugar, visível por todos os aliases. Documente, e reserve o recurso para
tipos mutáveis por projeto.

Uma propriedade não é variável, então cai no operador binário e no setter:

```csharp
holder.Buf += "p";   // chama o + estático, depois set_Buf: instância nova, plusCalls=1
holder.Only += 1;    // só existe += de instância: CS0019
```

Como são membros de instância, esses operadores aceitam `virtual`, `abstract`,
`override`, `new` e (em structs) `readonly`: um `virtual +=` sobrescrito em
`Derived` executou a sobrescrita através de uma variável `Base`. Numa struct,
`acc += 5` sobre uma local muta a local no lugar (duas chamadas deram `Total`
12). A linguagem não confere se `+` e `+=` concordam; isso fica com você.

### C# 14: ++ e -- de instância

`++` e `--` podem ser operadores de instância `void` sem parâmetros. Qual deles
roda depende de o resultado ser usado:

```csharp
class Counter
{
    public int Value;
    public static Counter operator ++(Counter c) => new Counter { Value = c.Value + 1 };
    public void operator ++() => Value++;
}

c++; ++c;            // como instruções: operador de instância, Value 2, o estático nunca roda
var old = c++;       // resultado usado: operador estático, old=2, c=3, objetos diferentes
```

Um `x++` pós-fixado cujo valor é usado precisa devolver o valor anterior ao
incremento, coisa que um tipo referência que muta não consegue produzir, então
o compilador usa o operador estático; com só o `++` de instância, essa linha dá
CS0023.

### Operadores em código genérico

Generic math (C# 11) permite que interfaces declarem operadores
`static abstract`, e o `System.Numerics` os expõe (`IAdditionOperators<,,>`,
`IAdditiveIdentity<,>` e muitos outros). Implemente-os e algoritmos genéricos
podem usar `+` no seu tipo:

```csharp
static T Sum<T>(T[] xs) where T : IAdditionOperators<T, T, T>, IAdditiveIdentity<T, T>
{
    T s = T.AdditiveIdentity;
    foreach (var x in xs) s += x;
    return s;
}
Sum([new Meters(1), new Meters(2), new Meters(3)]);   // Meters { Value = 6 }
```

Restrições e membros static abstract estão em Generics: Constraints and
Variance.

## Trade-offs

- **Matemática legível, chamadas escondidas.** `a + b` esconde um método que
  pode alocar ou lançar. Mantenha operadores baratos, totais quando possível e
  coerentes com os métodos nomeados (`Add`, `Multiply`) que linguagens sem
  operadores vão chamar.
- **Surpresa é o risco principal.** Um operador tem que fazer o que o símbolo
  significa para números. `+` em `Money` com moedas diferentes deve lançar, não
  converter em silêncio, e `+` nunca deve mutar um operando.
- **Conversões implícitas se espalham.** Cada conversão implícita amplia a
  resolução de overloads e pode deixar chamadas ambíguas ou escolher um overload
  inesperado. Torne explícita qualquer conversão que possa falhar ou perder
  precisão.
- **Operadores de atribuição composta mudam o aliasing.** Um `+=` no lugar numa
  classe é visível por todas as referências:
  ```csharp
  var alias = buf; buf += "x";   // alias também vê "x"
  ```
  Use-os em tipos mutáveis e sensíveis a desempenho, e deixe tipos imutáveis no
  operador estático.
- **Dois caminhos para manter em sincronia.** `+` e `+=`, `++` estático e de
  instância, checked e unchecked: o compilador confere a presença, nunca a
  coerência. Teste os dois caminhos com as mesmas entradas.
- **Operadores de igualdade vêm com um contrato.** `==` sem `Equals` e
  `GetHashCode` compila com avisos e quebra o hashing; prefira records.

## Documentation Links

- [Operator overloading, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/operator-overloading) (doc)
- [User-defined explicit and implicit conversion operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/user-defined-conversion-operators) (doc)
- [Arithmetic operators: user-defined checked operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/arithmetic-operators#user-defined-checked-operators) (doc)
- [User-defined compound assignment, C# 14 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/user-defined-compound-assignment) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Generic math, .NET fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/generics/math) (doc)
