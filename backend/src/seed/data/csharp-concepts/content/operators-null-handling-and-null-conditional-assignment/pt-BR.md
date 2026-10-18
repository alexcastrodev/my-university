---
version: 1.0
updatedAt: 2026-10-14
title: "Operadores, Tratamento de Null e Atribuição Condicional Nula"
summary: Curto-circuito de && e ||, a família ?., ?[], ?? e ??=, e a atribuição condicional nula do C# 14, com o que compila, o que não compila, o código gerado e a interação com nullable reference types.
---
## Objective

A maioria dos operadores do C# faz o que aparenta, mas alguns trazem regras que
decidem se um trecho de código chega a rodar. `&&` e `||` pulam o operando da
direita; `&` e `|` não pulam. `?.` transforma um `int` em `int?` e interrompe a
cadeia inteira sem avisar. `??` tem precedência menor que `+`. O C# 14 soma mais
um membro a essa família: `?.` e `?[]` agora podem aparecer do lado esquerdo de
uma atribuição, então `customer?.Name = value` só grava quando `customer` existe
e nem avalia `value` quando ele não existe. Este conceito mostra como esses
operadores avaliam, o que a nova atribuição condicional nula aceita e recusa
(com os erros reais do compilador), o que o compilador gera para ela e como ela
conversa com nullable reference types.

## Use Cases

- Trocar `if (x is not null) x.Prop = value;` por uma única instrução quando
  "sem receptor, nada a fazer" é o comportamento desejado.
- Assinar um evento de um objeto que talvez ainda não exista:
  `button?.Clicked += OnClick;`.
- Definir valores padrão: `name ?? "anonymous"`, inicialização preguiçosa com
  `cache ??= Load()` e validação de argumento com `?? throw`.
- Ler um caminho de propriedades que pode estar quebrado em qualquer nível sem
  uma escada de checagens de null.
- Escolher entre `&&` e `&` quando o operando da direita tem efeito colateral.

## Deep Dive

### Operadores lógicos com curto-circuito e sem curto-circuito

Com operandos `bool`, `&&` e `||` são condicionais: o lado direito só roda se o
esquerdo ainda não decidiu o resultado. `&`, `|` e `^` sempre avaliam os dois
operandos. Com inteiros, `&`, `|` e `^` viram operadores bit a bit.

```csharp
int calls = 0;
bool Check(bool v) { calls++; return v; }

bool a = Check(false) && Check(true);   // a = False, calls = 1
calls = 0;
bool b = Check(false) & Check(true);    // b = False, calls = 2
bool c = true ^ true;                   // False: OU exclusivo
```

As formas sem curto-circuito raramente são o que você quer numa condição, mas
são a escolha honesta quando as duas chamadas precisam acontecer (por exemplo,
validar dois campos e reportar os dois erros).

### A família que lida com null: `?.`, `?[]`, `??`, `??=`

`a?.x` avalia `a` uma vez. Se for `null`, o resultado é `null` e o resto da
cadeia é pulado; senão, se comporta como `a.x`. Daí saem duas consequências.
Primeiro, um membro de tipo por valor vira anulável: `name?.Length` é um `int?`.
Segundo, comparações sobre esse `int?` são "lifted", e qualquer comparação com
`null` dá `false`, o que engana nos dois sentidos:

```csharp
int[]? numbers = null;
Console.WriteLine(numbers?.Length < 2);          // False
Console.WriteLine(numbers?.Length >= 2);         // False
Console.WriteLine((numbers?.Length ?? 0) < 2);   // True: diga o que null significa
```

O curto-circuito vale para toda a cadeia de acessos a membro e a elemento, mas
parênteses a encerram. `o?.Customer.Name` é `null` quando `o` é `null`, enquanto
`(o?.Customer).Name` lança `NullReferenceException`, porque a parte entre
parênteses já é um valor pronto que o `.Name` de fora desreferencia.

`??` devolve o operando da esquerda a menos que ele seja `null`. A precedência
dele é menor que a da aritmética, o que é uma leitura errada clássica:

```csharp
int? y = 5;
Console.WriteLine(y ?? 0 + 10);    // 5, lido como y ?? (0 + 10)
Console.WriteLine((y ?? 0) + 10);  // 15
```

`??=` só atribui quando o lado esquerdo é `null`, e `?? throw` transforma um
valor ausente em exceção numa única expressão. Como `?.` lê o receptor uma vez
só, `Handler?.Invoke(...)` é a forma padrão e thread-safe de disparar um evento:
um cancelamento de inscrição concorrente não consegue tornar `null` a cópia que
já foi lida.

### Atribuição condicional nula (C# 14)

Antes do C# 14, `?.` e `?[]` só podiam ler. Agora podem ser o alvo de `=` e de
toda atribuição composta, inclusive `??=`. A regra central, escrita na
referência da linguagem e na especificação da feature, é que o lado direito só
é avaliado quando o receptor não é `null`. Este programa mostra isso com um
contador:

```csharp
int calls = 0;
int Next() { calls++; return 42; }

Customer? none = null;
Customer some = new() { Name = "Ana" };

none?.Age = Next();       // calls = 0: Next() nunca rodou
some?.Age = Next();       // Age = 42, calls = 1
some?.Age += 1;           // atribuição composta: Age = 43
none?.Age += Next();      // continua calls = 1
some?.Nickname ??= "Aninha";
some?.Nickname ??= "ignored";   // Nickname continua "Aninha"

int[]? arr = null;
arr?[0] = Next();                       // acesso a elemento também funciona
Dictionary<string, int>? dict = new();
dict?["a"] = 1;                         // e indexadores

Order? order = new() { Customer = null };
order?.Customer?.Name = "nobody";       // a cadeia para no Customer nulo

Button? button = new();
button?.Clicked += () => Console.WriteLine("clicked");   // inscrição em evento
```

O receptor é avaliado uma vez: `GetCustomer()?.Age += 10` chama `GetCustomer()`
uma única vez, mesmo que a atribuição composta leia e escreva a propriedade.

Quando a atribuição é usada como valor, o tipo dela é a versão anulável do tipo
atribuído, e ela vale `null` quando nada foi gravado:

```csharp
int? r1 = none?.Age = 5;   // null
int? r2 = some?.Age = 5;   // 5
```

### O que não compila

A feature mantém `a?.b` como algo que não é variável: dá para atribuir através
dele, mas não dá para pegar uma referência a ele. Estes são os erros que o SDK
10.0.100 reporta:

```csharp
h?.Count++;                       // CS1059: The operand of an increment or decrement
--h?.Count;                       //   operator must be a variable, property or indexer
int.TryParse("1", out h?.Field);  // CS1510: A ref or out value must be an assignable variable
ref int r = ref h?.Field;         // CS1510 (mesma mensagem)
(h?.Count, h?.Field) = (1, 2);    // CS0131: The left-hand side of an assignment must be
                                  //   a variable, property or indexer
Point p = default;                // Point é uma struct
p?.X = 1;                         // CS0023: Operator '?' cannot be applied to operand of type 'Point'
Point? np = null;
np?.X = 1;                        // CS0131: np.Value é uma cópia, não uma variável

static void Use<T>(Box<T>? c, T t)
{
    c?.Value = t;                 // ok como instrução
    (c?.Value = t).ToString();    // CS8978: 'T' cannot be made nullable.
}
```

Resumindo: nada de `++`/`--`, nada de `ref`/`out`, nada de alvo de
desconstrução, nada de receptor de tipo por valor, e o resultado com um genérico
sem restrição não pode ser usado como valor. Com `<LangVersion>13</LangVersion>`
a atribuição simples é recusada com CS9260, "Feature 'null conditional
assignment' is not available in C# 13.0".

### O que o compilador gera

Para uma instrução, a especificação define `P?.A = B` como
`if (P is not null) P.A = B;` com `P` avaliado uma vez, e o IL confirma. Este
método:

```csharp
static void Set(Customer? c, int age) => c?.Age = Compute(age);
```

compila para um teste de `c` (`brtrue`) que pula o bloco com a chamada a
`Compute` e a `set_Age`. Não há objeto temporário, nem tratamento de exceção,
nem custo além do desvio que você escreveria à mão. Quando a expressão é usada
como valor, o código gerado monta um local `Nullable<int>`, exatamente como
`(P is null) ? (int?)null : (P.A = B)` faria.

### Interação com nullable reference types

A análise de fluxo trata um `?.` sobre uma variável como sinal de que ela pode
ser `null`. Se a variável era não anulável, a próxima desreferência comum gera
aviso:

```csharp
static void Rename(Customer customer)          // parâmetro não anulável
{
    customer?.Name = "Ana";                     // compila, sem aviso
    Console.WriteLine(customer.Name.Length);    // warning CS8602: Dereference of a
}                                               //   possibly null reference.
```

A correção não é colocar `!`, e sim tirar o `?.` onde `null` é impossível. O
lado direito continua sendo checado contra o alvo: `customer?.Name = null` numa
propriedade `string Name` não anulável gera CS8625.

## Trade-offs

- **Um no-op silencioso pode esconder um bug.** `order?.Status = Shipped` não
  faz nada quando `order` é `null`, e nada te avisa. Use só quando a ausência do
  receptor é um caso normal; quando é defeito, deixe o `.` comum lançar.
  ```csharp
  order.Status = Status.Shipped;    // order nulo é defeito: falhe alto
  ```
- **O lado direito pode nunca rodar.** Isso economiza trabalho, mas um efeito
  colateral colocado ali (log, contador, `GenerateId()`) some junto com o
  receptor nulo. Calcule antes se ele precisa acontecer sempre.
- **`?.` espalha nulabilidade.** Cada `?.` numa variável não anulável diz ao
  analisador que ela pode ser `null`, o que gera avisos CS8602 mais adiante. Use
  onde o null é real, não por defesa.
- **`??=` não é atômico.** É uma leitura seguida de uma escrita, então duas
  threads podem ver `null` e as duas inicializarem. Use `Lazy<T>` ou
  `Interlocked.CompareExchange` para estado compartilhado.
  ```csharp
  Interlocked.CompareExchange(ref _cache, Load(), null);
  ```
- **Comparações lifted e precedência enganam.** `x?.Length < 2` é `false` para
  `null`, e `a ?? b + c` soma antes de coalescer. Use parênteses e declare o
  padrão com `??`.
- **`&` e `|` rodam os dois lados.** Certo quando os dois efeitos colaterais
  precisam acontecer, surpreendente em qualquer outro lugar. Em condições, use
  `&&` e `||` por padrão.

## Lab

Neste lab você recebe a classe estática `Operations` **esboçada**, com nove métodos de uma linha que lançam `NotImplementedException`, e testes xUnit prontos. O seu trabalho é implementá-los com os operadores nulos do C# (`?.`, `?[]`, `??`, `??=` e a atribuição condicional nula do C# 14). A ideia central é sentir que esses operadores não são só açúcar: eles decidem se o lado direito chega a rodar, e têm armadilhas de precedência e de comparação com `null` que viram bugs silenciosos.

**O cenário**

Operações pequenas sobre um modelo de pedidos, em que quase tudo pode ser `null`.

- `Models.cs`: `Customer` (`Name`, `Nickname?`, `Age`), `Order` (com um `Customer?`) e `Button` (com um evento `Clicked`).
- `Operations.cs`: os nove métodos a implementar, um por TODO.
- `NullTests.cs`: os testes. Vários **contam quantas vezes o lado direito executa**: com `customer?.Name = newName()`, a chamada só acontece se `customer` não for `null`. É assim que o teste prova que houve curto-circuito.

**O que você vai fazer, passo a passo**

1. **Atribuir só se existir (TODO-00).** Em `Rename`, use `customer?.Name = newName()`. Se `customer` for `null`, `newName` nem roda.
2. **Atribuição composta (TODO-01).** Em `Birthday`, some um ano com `+=` condicional e devolva o valor da expressão: a nova idade, ou `null` sem cliente.
3. **Combinar `?.` com `??=` (TODO-02).** Em `EnsureNickname`, coloque o apelido do fallback só quando o cliente existe e o apelido ainda é `null`, numa única instrução.
4. **Cadeias, eventos e indexadores (TODO-03, TODO-04 e TODO-05).** Em `SetCustomerName`, a cadeia pedido e cliente deve parar em silêncio no primeiro `null`. Em `Subscribe`, use `?.` com `+=` no evento `Clicked`. Em `Put`, atribua pelo indexador com `?[]` e garanta que `value()` não rode para um dicionário nulo.
5. **Desarmar a comparação lifted (TODO-06).** Em `IsShort`, `numbers?.Length < 2` dá `false` para `null`, porque comparar um `int?` nulo é sempre falso. Diga o que `null` significa com `??`, já que aqui ausente conta como vazio.
6. **Precedência e avaliação (TODO-07 e TODO-08).** Em `Total`, `bonus ?? 0 + 10` é lido como `bonus ?? (0 + 10)`, então ajuste para somar 10 ao bônus. Em `BothValid`, `&&` pularia a segunda checagem: use o `&` ansioso para rodar as duas, como faria ao coletar todos os erros de validação.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar, olhando os contadores `calls`, qual lado direito roda e qual é pulado em cada método, e por que `?.Length < 2` e `?? 0 + 10` enganam.

**Desafios opcionais**

- **TODO-09:** crie `BirthdayOf(Func<Customer?> getCustomer)` que soma dez anos com `getCustomer()?.Age += 10` e prove que o receptor é avaliado uma única vez.
- **TODO-10:** crie `TryRename(Customer?, string)` que usa a atribuição como valor (`string? written = customer?.Name = name`) e informa se algo foi escrito. Qual é o tipo dessa expressão?

**Pré-requisitos:** nullable reference types e `?.` para leitura, eventos e indexadores, e o .NET 10 SDK (C# 14).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Cada método esboçado lança `NotImplementedException` e traz um comentário `TODO-NN` com a dica, então os testes vermelhos são o seu checklist.

## Documentation Links

- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Member access and null-conditional operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/member-access-operators) (doc)
- [Null conditional assignment, C# feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/null-conditional-assignment) (doc)
- [?? and ??= operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/null-coalescing-operator) (doc)
- [Boolean logical operators, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/boolean-logical-operators) (doc)
- [C# operators and expressions (precedence), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/) (doc)
