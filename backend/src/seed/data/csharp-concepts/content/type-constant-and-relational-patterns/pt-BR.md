---
version: 1.0
updatedAt: 2026-10-15
title: "Pattern Matching: Patterns de Tipo, Constante e Relacionais, e switch Expressions"
summary: O catálogo de patterns (tipo, declaração, constante, relacional, and/or/not, var, descarte), guardas when, exaustividade e subsunção com as mensagens reais do compilador, e o que o compilador gera.
---
## Objective

Pattern matching permite que uma única expressão pergunte "o que é este valor?"
e desvie conforme a resposta: o tipo em runtime, se ele é igual a uma constante,
em que faixa cai, ou uma combinação lógica disso. Os mesmos patterns funcionam
no `is`, na instrução `switch` e na `switch` expression. O que os torna mais do
que sintaxe é a análise do compilador: ele sabe quando uma `switch` expression
deixa valores sem tratamento, quando um braço nunca será alcançado e quando um
teste com `is` é sempre ou nunca verdadeiro, e compila os braços numa árvore de
decisão em vez de uma lista de `if`s. Este conceito cobre os patterns de tipo,
constante, relacional, lógico, `var` e descarte, as guardas `when`,
exaustividade e subsunção com as mensagens reais do compilador, e como fica o
código gerado. Property, positional e list patterns ficam para o próximo
conceito.

## Use Cases

- Mapear um enum ou um código de status para um valor numa única expressão, com
  o compilador apontando o caso que você esqueceu.
- Classificar números em faixas (faixas de imposto, famílias de status HTTP,
  notas) sem cadeias de `if`/`else if`.
- Tratar um `object` ou um tipo base que pode conter vários tipos concretos, como
  uma mensagem vinda de uma fila ou um nó JSON.
- Trocar `x != null && x is Foo` e casts por um único `x is Foo foo`.

## Deep Dive

### O catálogo

```csharp
static string Describe(object? o) => o switch
{
    null => "null constant",                       // constant pattern
    0 => "zero",                                    // constant pattern (int)
    int n and > 0 => $"positive int {n}",           // declaração + relacional, combinados com and
    int => "other int",                             // type pattern (C# 9)
    string { Length: 0 } => "empty string",         // tipo + property pattern
    string s => $"string of {s.Length}",            // declaration pattern
    char c and (>= 'a' and <= 'z') => $"lowercase {c}",
    long or short => "long or short",               // or entre dois type patterns
    _ => $"something else ({o.GetType().Name})",    // descarte
};

Describe(42);        // positive int 42
Describe(-3);        // other int
Describe("");        // empty string
Describe('x');       // lowercase x
Describe(7L);        // long or short
Describe(new[] {1}); // something else (Int32[])
```

Algumas regras valem ser conhecidas com precisão:

- **Patterns de tipo e de declaração nunca casam com `null`.** `maybe is string`
  é `false` para um `string?` nulo. Eles casam com o tipo em runtime por
  identidade, herança, implementação de interface, boxing ou unboxing, e com um
  `Nullable<T>` que tem valor (`int? ni = 5; ni is int x` dá `x = 5`). Ignoram
  conversões definidas pelo usuário.
- **O pattern `var` casa com tudo, inclusive `null`.** `maybe is var v` é `true`
  mesmo com `maybe` nulo. Use para capturar um valor intermediário, não para
  testar algo.
- **Constant patterns** aceitam valores numéricos, `char`, `string`, `bool`,
  enum e `const`, além de `null`. `x is null` nunca chama um `==` definido pelo
  usuário, e é por isso que é preferido a `x == null`.
- **Relational patterns** (`<`, `<=`, `>`, `>=`) recebem uma constante numérica,
  `char` ou enum. Não casam com `null` nem com `NaN`, que precisa ser tratado com
  o constant pattern `double.NaN`.

### Patterns lógicos e precedência

`not` liga mais forte que `and`, que liga mais forte que `or`. Isso torna um
erro muito fácil de escrever:

```csharp
static bool WrongNotLower(char c) => c is not >= 'a' and <= 'z';   // (not >= 'a') and <= 'z'
static bool RightNotLower(char c) => c is not (>= 'a' and <= 'z');

WrongNotLower('~');   // False: '~' vem depois de 'z', então "<= 'z'" falha
RightNotLower('~');   // True
```

O compilador não pega todas as variações. `n is not 1 or 2` significa
`(not 1) or 2`, então o `2` é redundante e a expressão é só `n is not 1`, mas o
SDK 10.0.100 compila isso sem nenhum aviso. Na dúvida, coloque parênteses.

### Guardas `when`

Uma guarda acrescenta uma condição booleana qualquer depois de um pattern. Ela
só roda quando o pattern já casou, e é o único lugar para checagens que patterns
não expressam, como comparar dois valores capturados ou chamar um método:

```csharp
double d when double.IsFinite(d) => $"finite double {d}",
```

O preço é que o compilador não consegue raciocinar sobre guardas. Elas não
contam para a exaustividade, como mostra a próxima seção.

### Exaustividade

Uma `switch` expression precisa produzir um valor para toda entrada. Quando o
compilador encontra uma entrada que nenhum braço trata, ele avisa e mostra um
exemplo. Estas são as mensagens do SDK 10.0.100:

```csharp
n switch { < 0 => "negative", 0 => "zero" }
// warning CS8509: The switch expression does not handle all possible values of its
// input type (it is not exhaustive). For example, the pattern '1' is not covered.

c switch { Color.Red => "red", Color.Green => "green", Color.Blue => "blue" }
// warning CS8524: ... involving an unnamed enum value. For example, the pattern
// '(Color)3' is not covered.

s switch { string text => text }          // s é string?
// warning CS8655: The switch expression does not handle some null inputs
// (it is not exhaustive). For example, the pattern 'null' is not covered.

n switch { var x when x >= 0 => "non-negative", var x when x < 0 => "negative" }
// warning CS8846: ... For example, the pattern '_' is not covered. However, a
// pattern with a 'when' clause might successfully match this value.
```

O caso do enum surpreende: um enum é só um inteiro, então `(Color)42` é um valor
legal. Se o aviso for ignorado e esse valor chegar, o runtime lança:

```csharp
Name((Color)42);
// SwitchExpressionException: Non-exhaustive switch expression failed to match its input.
// Unmatched value was 42.
```

Hierarquias de classes não ganham ajuda no C# 14. Mesmo com uma base `abstract`
e duas subclasses `sealed`, ambas tratadas, o compilador ainda reporta CS8509
com o pattern `'_'`, porque outro assembly poderia acrescentar uma subclasse. A
documentação do C# 15, ainda em preview, descreve classes `closed` que mudam
isso; no C# 14 você precisa de um braço de descarte. Já um `switch` sobre `bool`
com braços `true` e `false` é exaustivo e compila sem aviso.

### Subsunção: braços que nunca rodam

Os braços são testados na ordem do texto, então um braço cujos valores já foram
todos tratados antes é código morto. O compilador transforma isso em erro, não
em aviso:

```csharp
n switch { > 0 => "positive", > 10 => "big", _ => "other" }
// error CS8510: The pattern is unreachable. It has already been handled by a
// previous arm of the switch expression or it is impossible to match.

o switch { string s => s, "hello" => "greeting", _ => "other" }   // mesmo CS8510

switch (n) { case > 0: break; case 5: break; }
// error CS8120: The switch case is unreachable. It has already been handled by a
// previous case or it is impossible to match.
```

A mesma análise roda no `is`: `n is > 5 and < 3` é o erro CS8518 ("An
expression of type 'int' can never match the provided pattern"), e `n is int`
sobre um `int` é o aviso CS0183 ("The given expression is always of the provided
('int') type").

### O que o compilador gera

Os braços não viram uma sequência de `if`s. O Roslyn monta um grafo de decisão
que compartilha testes entre braços e os ordena por velocidade. Desmontando um
build Release, dá para ver:

- **Constantes inteiras densas** (`0 => ..., 1 => ..., 4 => ...`) viram uma
  única instrução IL `switch`, uma tabela de saltos.
- **Faixas relacionais** (`< 0`, `< 10`, `< 100`, `_`) viram uma busca binária:
  a primeira comparação no IL é contra `10`, a fronteira do meio, e não contra
  `0`, o primeiro braço.
- **Constantes string** são despachadas pelo `Length` com um `switch` de IL,
  depois por um caractere numa posição escolhida, e só então confirmadas com
  `string ==`. Para sete verbos HTTP, nenhum hash é calculado.
- **Type patterns** viram `isinst`, e dois braços do mesmo tipo
  (`string s when s.Length > 3` e `string`) compartilham um único
  `isinst string`.

A consequência prática: a ordem dos braços importa para o resultado, mas você
não precisa reordenar braços por desempenho. Escreva na ordem que lê melhor e
deixe a checagem de subsunção te proteger.

## Trade-offs

- **Um braço de descarte silencia a exaustividade para sempre.** `_ => throw`
  deixa o código de hoje seguro, mas quando alguém adiciona `Color.Yellow` o
  compilador fica quieto. Para enums seus, prefira listar todos os membros e
  aceitar o CS8524, ou lance a exceção com o valor para a falha ficar óbvia.
  ```csharp
  _ => throw new ArgumentOutOfRangeException(nameof(c), c, "Unknown color"),
  ```
- **Guardas derrotam a análise.** Todo `when` é opaco para exaustividade e
  subsunção. Expresse a condição como pattern (`> 0` em vez de `when x > 0`)
  sempre que der.
- **`switch` sobre tipos não é polimorfismo.** Um switch de tipos coloca o
  comportamento perto de quem chama, o que é bom para conjuntos fechados que
  você controla (mensagens, resultados) e ruim quando tipos novos aparecem com
  frequência: todo switch precisa mudar. Um método virtual mantém o
  comportamento junto do tipo.
- **A precedência de `not`, `and`, `or` engana fácil,** e nem todo erro gera
  diagnóstico. Coloque parênteses em tudo que misture `not` e um combinador.
- **`NaN` e `null` escapam de braços relacionais.** `< 0` e `>= 0` juntos não
  cobrem um `double`. Adicione braços `double.NaN` e `null` explicitamente quando
  o tipo de entrada permitir.

## Lab

Neste lab você recebe a classe estática `Patterns` com seis métodos **esboçados**, que lançam `NotImplementedException`, e testes xUnit prontos que cobrem as bordas. O seu trabalho é implementá-los trocando cadeias de `if`/`else` por pattern matching: padrões de tipo, constante, relacionais, lógicos (`and`, `or`, `not`), de tupla e switch expressions. A ideia central é ver o que "exaustivo" significa na prática: o compilador avisa quando falta um caso, mas um valor fora do enum ainda pode estourar em tempo de execução.

**O cenário**

Seis pequenas decisões do dia a dia (descrever um valor, dar nota, checar dia útil, checar letra, precificar ingresso, avançar um semáforo), todas em `Patterns.cs`, junto com o enum `Light { Red, Yellow, Green }`.

- `Describe(object?)`: `null`, inteiros negativos, zero e positivos, texto vazio ou não, `bool` e "outro".
- `Grade(int)`: nota de 0 a 100 em A, B, C ou F.
- `IsWeekday(DayOfWeek)` e `IsAsciiLetter(char)`: predicados escritos como um único padrão `is`.
- `TicketPrice(int, bool)`: preço por idade e por ser sócio.
- `Next(Light)`: o próximo estado do semáforo.

Em `PatternTests.cs`, os `[InlineData]` incluem as fronteiras (89 e 90, 12 e 13, 64 e 65) e um valor de enum indefinido, `(Light)99`.

**O que você vai fazer, passo a passo**

1. **Um switch para vários padrões (TODO-00).** Em `Describe`, use uma switch expression com padrões de tipo, constante e relacionais (`null`, `int and < 0`, `0`, `""`, `string`, `bool` e o resto). A ordem dos braços importa.
2. **Faixas relacionais (TODO-01).** Em `Grade`, use `< 0 or > 100` para lançar `ArgumentOutOfRangeException` e `>= 90`, `>= 80`, `>= 70` para as notas, com `F` no resto.
3. **Padrões lógicos (TODO-02 e TODO-03).** Em `IsWeekday`, escreva um único `is not (... or ...)`. Em `IsAsciiLetter`, combine faixas com `and`/`or` e cuide dos parênteses: `and` amarra mais forte que `or`.
4. **Padrão de tupla (TODO-04).** Em `TicketPrice`, faça switch em `(age, isMember)`. Os braços são testados de cima para baixo: idade negativa lança, abaixo de 3 paga 0, abaixo de 13 paga 5, 65 ou mais paga 7, e os demais pagam 8 (sócios) ou 10.
5. **Exaustividade e o custo em runtime (TODO-05).** Em `Next`, liste os três membros do enum **sem** braço de descarte. O compilador só avisa se faltar um membro, e `(Light)99` lança `SwitchExpressionException` na execução.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que a ordem dos braços importa em `TicketPrice`, e por que o teste de `(Light)99` espera uma exceção em vez de um aviso de compilação.

**Desafios opcionais**

- **TODO-06:** adicione a `Describe` um braço que o compilador marque como inalcançável (por exemplo `int` antes de `int and < 0`) e leia o erro.
- **TODO-07:** reescreva `TicketPrice` com uma cláusula `when` em vez de padrão de tupla e compare a legibilidade.

**Pré-requisitos:** `switch`, o operador `is` e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Cada método esboçado lança `NotImplementedException` e tem no comentário a lista de casos esperada, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Patterns, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/patterns) (doc)
- [switch expression, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/switch-expression) (doc)
- [Pattern matching overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/functional/pattern-matching) (doc)
- [Selection statements: if and switch, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/selection-statements) (doc)
- [Errors and warnings for pattern matching, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/pattern-matching-warnings) (doc)
- [SwitchExpressionException class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.compilerservices.switchexpressionexception) (doc)
