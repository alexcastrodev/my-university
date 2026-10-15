---
version: 1.0
updatedAt: 2026-10-15
title: "Enums e Flags Enums"
summary: Um enum é um inteiro com nomes, não um conjunto fechado. Tipo subjacente e tamanho, o valor zero, [Flags] e as operações de bit, as armadilhas do HasFlag, validação de valores de fora, switch sobre enum, código genérico e quando trocar o enum por outra coisa.
---
## Objective

Em C#, um enum não é uma classe com um conjunto fixo de instâncias, como em
Java. É um value type que embrulha um inteiro e dá nome a alguns dos valores.
Todo inteiro do tipo subjacente é um valor legal do enum, com nome ou sem, e
quase todo bug de enum vem de esquecer isso: um `default` que não bate com
nenhum membro, um cast de uma coluna do banco que vira `42`, um `switch` que
estoura em tempo de execução, um teste de flag que dá sempre verdadeiro. Este
conceito cobre o tipo subjacente e o tamanho, o valor zero, `[Flags]` e as
operações de bit que vêm junto, o `HasFlag` e suas armadilhas, validação,
código genérico sobre enums e quando um enum simples é a ferramenta errada.

## Use Cases

- Um conjunto fechado de estados ou tipos: `OrderStatus`, `LogLevel`, `HttpMethod`.
- Opções combináveis passadas como um valor só: acesso a arquivo, permissões,
  chaves de funcionalidade (`[Flags]`).
- Guardar uma escolha pequena de forma compacta em arrays ou structs grandes,
  com tipo subjacente `byte`.
- Mapear códigos inteiros de um banco ou de um protocolo para nomes legíveis.

## Deep Dive

### Um inteiro com nomes

```csharp
enum Status { Pending, Paid, Shipped }          // int, valores 0, 1, 2
enum SmallStatus : byte { Pending, Paid, Shipped }

Enum.GetUnderlyingType(typeof(Status));          // System.Int32
Unsafe.SizeOf<Status>();                          // 4
Unsafe.SizeOf<SmallStatus>();                     // 1
(int)Status.Shipped;                              // 2
(Status)42;                                       // 42, sem exceção
```

O tipo subjacente padrão é `int` e pode ser qualquer tipo integral. Os membros
começam em zero e sobem de um em um, a menos que você atribua valores. As
conversões entre o enum e o tipo subjacente são explícitas, e o cast não
confere nada: `(Status)42` é um `Status` válido cujo `ToString()` é `"42"`.

Trocar o tipo subjacente é decisão de armazenamento. Uma struct com um `long` e
quatro campos de enum baseados em `int` mediu 24 bytes; com enums `byte`, 16.
Isso pesa em arrays com milhões de structs e quase em nenhum outro lugar, e muda
o contrato binário, então escolha na criação do enum.

### O valor zero

O valor padrão de qualquer enum é `(E)0`, exista ou não um membro com esse
valor. O literal `0` (e qualquer constante igual a zero) também converte
implicitamente para todo tipo enum:

```csharp
enum Port { A = 1, B, C }

Port p = default;   // 0, Enum.IsDefined(p) é False
Port q = 0;         // compila: conversão implícita do literal zero
int zero = 0;
Port r = zero;      // CS0266: uma variável precisa de cast explícito
```

Um campo não inicializado, um array `new T[n]` e `default(T)` produzem zero. A
orientação oficial é quase sempre declarar um membro com valor `0`: um padrão
real (`Unknown`, `None`, `Pending`) ou um marcador explícito de "não definido".
Assim uma atribuição esquecida aparece como um estado com nome, que dá para
testar, e não como um número que ninguém declarou.

### Flags: combinando valores

Quando os valores se combinam, dê um bit próprio a cada membro, marque o tipo
com `[Flags]` e combine com `|`:

```csharp
[Flags]
enum Perm { None = 0, Read = 1, Write = 2, Execute = 4 }

var rw = Perm.Read | Perm.Write;
rw;                                 // Read, Write
(Perm)7;                            // Read, Write, Execute
(Perm)9;                            // 9   (o bit 8 não tem nome, então nenhum nome sai)
(Perm)16;                           // 16

rw &= ~Perm.Write;                  // limpar um bit:   Read
rw ^= Perm.Execute;                 // inverter um bit: Read, Execute
```

`[Flags]` não muda nenhuma aritmética; os operadores funcionam em qualquer enum.
Ele muda a formatação e o parsing: sem o atributo, `(NoFlags)3` imprime `3`; com
ele, o valor é decomposto em `Read, Write`. Se algum bit ligado não tem membro,
o valor inteiro sai como número. Literais binários (`0b_0000_0100`) ou shifts
(`1 << 2`) deixam as potências de dois fáceis de revisar, e combinações com nome
(`ReadWrite = Read | Write`) são bem-vindas para conjuntos comuns.

### Testando flags, e as armadilhas do HasFlag

```csharp
(rw & Perm.Read) == Perm.Read;                  // True: todos os bits de Read estão ligados
rw.HasFlag(Perm.Read);                          // True: o mesmo teste
rw.HasFlag(Perm.Read | Perm.Execute);           // False: exige TODOS os bits
(rw & (Perm.Read | Perm.Execute)) != 0;         // True: QUALQUER um dos bits
Perm.Read.HasFlag(Perm.None);                   // True, para qualquer valor
rw.HasFlag(Status.Paid);                        // ArgumentException em tempo de execução
```

Três armadilhas moram nessas linhas. `HasFlag` com argumento combinado significa
"todos estes", não "algum destes". `HasFlag(None)` é sempre verdadeiro, porque
`(x & 0) == 0`: a documentação manda testar `None` com `==`, nunca com AND bit a
bit. E o tipo do parâmetro é `Enum`, então passar um valor de outro enum compila
e lança `ArgumentException`.

Custo: com um parâmetro `Enum`, o argumento é boxed em princípio. A medição em
Value Types, Reference Types and Boxing mostra 48 bytes por chamada enquanto o
código está frio e 0 depois de otimizado. Em caminho quente, a forma bit a bit
nunca é pior.

### Validando valores que vêm de fora

Cast, `Enum.Parse` com número, desserializadores e colunas de banco aceitam
valores não definidos. Valide na fronteira:

```csharp
Enum.IsDefined(Perm.Read | Perm.Write);         // False: nenhum membro vale exatamente 3
Enum.IsDefined(Perm2.Read | Perm2.Write);       // True: ReadWrite = 3 existe

var all = Perm.Read | Perm.Write | Perm.Execute;
((Perm)9 & ~all) == 0;                          // False: tem um bit desconhecido
((Perm)5 & ~all) == 0;                          // True
```

`Enum.IsDefined` procura um membro com exatamente aquele valor, então rejeita
combinações de flags válidas. Para flags, aplique uma máscara com a união dos
bits conhecidos. O lado do parsing (`Enum.TryParse` aceitando `"99"` e
`"Red, Blue"`) está em Parsing, TryParse and the Try Pattern.

### Switch sobre um enum

```csharp
static string Describe(Status s) => s switch
{
    Status.Pending => "waiting",
    Status.Paid    => "paid",
    Status.Shipped => "on the way",
};
// warning CS8524: ... not exhaustive) involving an unnamed enum value.
//                 For example, the pattern '(Status)3' is not covered.
Describe((Status)42);   // SwitchExpressionException: Unmatched value was 42.
```

O compilador sabe que os três nomes não cobrem o tipo e avisa. A correção certa
é um braço de descarte explícito que trate o caso desconhecido de propósito
(`_ => $"unknown ({(int)s})"`), ou lance uma exceção de domínio, e não suprimir
o aviso. Quando um membro novo entra depois, o descarte o esconde, então um teste
que percorre `Enum.GetValues<Status>()` é uma proteção barata.

### Código genérico e a restrição Enum

Um parâmetro de tipo pode ser restrito a enums com `System.Enum`, e os helpers
genéricos (`Enum.GetValues<T>()`, `Enum.GetNames<T>()`, `Enum.IsDefined<T>(T)`)
dispensam `typeof` e casts:

```csharp
static string Name<T>(T v) where T : struct, Enum => $"{typeof(T).Name}.{v}";
Name(Perm.Write);                               // Perm.Write
string.Join(",", Enum.GetValues<Perm>());       // None,Read,Write,Execute
```

### Enums em JSON

O System.Text.Json escreve enums como número por padrão
(`{"Status":2,"Perm":3}`). Com `JsonStringEnumConverter` ele escreve os nomes,
flags incluídas (`"Read, Write"`), e desde o .NET 9
`[JsonStringEnumMemberName("dark-red")]` renomeia um membro. Dois fatos
observados rodando: o conversor ainda lê e escreve o número para um valor não
definido (`(Status)42` virou `42`), e um nome desconhecido como `"Lost"` lança
`JsonException`. Opções e geração de código estão em System.Text.Json
Serialization and Options.

### Quando o enum é a ferramenta errada

Um enum não carrega comportamento nem dados por membro, e C# não permite métodos
dentro dele. Extension members podem acrescentar helpers, mas um `switch` sobre
o mesmo enum espalhado por vários lugares é o sinal de que os membros querem ser
tipos. Duas alternativas:

- **Uma classe com instâncias estáticas** (`sealed record OrderStatus(string
  Code, bool IsFinal)` com `public static readonly OrderStatus Paid = ...`)
  quando cada valor carrega dados ou regras. Você perde `switch` sobre
  constantes e `[Flags]`, e ganha um conjunto fechado e validado.
- **Uma hierarquia fechada** de records quando cada caso tem dados diferentes.

## Trade-offs

- **Barato e rápido, mas não fechado.** Um enum é um inteiro: qualquer valor do
  tipo subjacente é legal, então todo valor de fora precisa de validação.
  ```csharp
  var s = (Status)int.Parse("42");   // aceito em silêncio: s imprime 42
  ```
- **Zero é sempre um valor.** Sem um membro zero, `default` produz um estado que
  ninguém declarou. Declare `None` ou `Unknown` como 0.
- **Os números são o contrato.** Reordenar membros ou inserir um no meio muda
  valores gravados e serializados. Atribua valores explícitos a enums que são
  persistidos ou trafegam pela rede.
- **`[Flags]` é compacto, mas fácil de ler errado.** `HasFlag(a | b)` significa
  "todos", `HasFlag(None)` é sempre verdadeiro e `IsDefined` rejeita combinações
  válidas. Prefira testes bit a bit explícitos e uma máscara dos bits conhecidos.
- **Sem comportamento por membro.** Um número crescente de `switch` sobre o
  mesmo enum é o sinal para migrar para uma classe com instâncias estáticas ou
  uma pequena hierarquia.
- **Tipos subjacentes menores só economizam memória em escala** e viram quebra
  binária se trocados depois. Use `int` a menos que tenha medido um motivo.

## Documentation Links

- [Enumeration types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/enum) (doc)
- [FlagsAttribute class (guidelines for flags enums), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.flagsattribute) (doc)
- [Enum.HasFlag method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.enum.hasflag) (doc)
- [Enum.IsDefined method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.enum.isdefined) (doc)
- [JsonStringEnumMemberNameAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.json.serialization.jsonstringenummembernameattribute) (doc)
