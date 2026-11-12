---
version: 1.0
updatedAt: 2026-11-12
title: "Novidades do C# 15: Um Mapa dos Recursos"
summary: Mapa de navegação das novidades do C# 15 que chegam com o .NET 11 (argumentos em collection expressions, union, classes closed, indexers de extensão, break e continue com rótulo, membros estáticos em interfaces e a segurança de memória ainda em preview), com um resumo curto de cada uma, o erro no C# 14 e o link para o conceito que aprofunda.
---
## Objective

O C# 15 vem com o .NET 11, que chegou à disponibilidade geral em 10 de novembro
de 2026, e é a versão padrão da linguagem em projetos que miram `net11.0`. A
página oficial "What's new in C# 15" lista seis recursos que não exigem nenhuma
chave de preview, mais um modelo de segurança de memória que ainda é preview.
Este conceito é um mapa, não um tutorial: cada recurso recebe um resumo curto, um
trecho que foi compilado e executado no SDK 11.0.100, o erro que aparece no C# 14
e o apontamento para o conceito que vai fundo. Use-o para decidir o que ler a
seguir e o que procurar ao levar uma base de código para o SDK do .NET 11. Ele
segue o formato de `whats-new-in-csharp-14`.

## Use Cases

- Ter o quadro completo do C# 15 de uma vez só antes de ler os conceitos
  aprofundados.
- Planejar a atualização para o SDK do .NET 11 e saber quais recursos também
  funcionam num target framework antigo e quais precisam do runtime novo.
- Revisar um pull request que usa `union`, `closed` ou `with(...)` quando você
  ainda não conhece a sintaxe.
- Responder "X está no C# 15?" para recursos que foram anunciados mas não
  chegaram (dictionary expressions, `await?`, enums closed).

## Deep Dive

Todos os trechos abaixo foram compilados com o SDK 11.0.100. As regras de versão
da linguagem (qual recurso exige qual target framework e o que `LangVersion`
faz) estão em `csharp-language-versions-and-preview-features`. Dois fatos
primeiro. Um projeto que mira `net11.0` compila com C# 15 por padrão, e
`LangVersion` `16` é rejeitado com CS1617. Um projeto que mira `net10.0`
continua no C# 14 mesmo quando compilado com o SDK 11.

### Argumentos em collection expressions

Uma collection expression agora pode começar com um elemento `with(...)` que
passa argumentos ao construtor ou à fábrica que o compilador escolher. Ele
precisa ser o primeiro elemento.

```csharp
string[] values = ["a", "b", "c"];
List<string> names = [with(capacity: values.Length * 2), .. values];
// names.Count é 3 e names.Capacity é 6

HashSet<string> set = [with(StringComparer.OrdinalIgnoreCase), "Hello", "HELLO", "hello"];
// set.Count é 1
```

No C# 14 o compilador reporta `CS9327: Feature 'collection expression arguments'
is not available in C# 14.0`. É um recurso só de compilador, então também
funciona em target frameworks antigos quando você define `LangVersion` como 15.
Um efeito colateral: um método chamado `with` invocado dentro de uma collection
expression passa a ser lido como o novo elemento, e `@with(...)` mantém o
significado antigo.

Aprofundamento: a subseção sobre collection expressions em
`collection-interfaces-and-choosing-a-collection`.

### Tipos union

A palavra-chave `union` declara um tipo cujo valor é exatamente um de uma lista
fechada de case types. O compilador gera um struct com conversão implícita de
cada case type, e um `switch` que trata todos os cases não precisa de braço de
descarte.

```csharp
record class Cat(string Name);
record class Dog(string Name);
record class Bird(string Name);
union Pet(Cat, Dog, Bird);

Pet p = new Dog("Rex");
p switch { Dog d => $"dog {d.Name}", Cat c => $"cat {c.Name}", Bird b => $"bird {b.Name}" };
// "dog Rex"; tirar Bird dá CS8509, "the pattern 'Bird' is not covered"
```

Um union struct guarda o case num `object?`, então um case de tipo por valor
como `int` sofre boxing, e `default(Pet)` guarda `null`: um switch sem braço
`null` lança `SwitchExpressionException` para ele. No C# 14 a linha `union` é
erro de sintaxe (CS1001 e CS8803 neste arquivo). O recurso precisa de
`UnionAttribute` e `IUnion` do runtime do .NET 11: em `net10.0` a declaração
falha com CS0518 e CS0656 até você acrescentar esses dois tipos por conta
própria.

Aprofundamento: `union-types-in-csharp-15`. Ele também muda a resposta em
`result-types-versus-exceptions`.

### Classes closed

Uma classe `closed` é implicitamente abstrata, e só código do mesmo assembly
pode derivar dela. Como o compilador passa a conhecer todas as subclasses
diretas, um switch que trata todas é exaustivo, mesmo com a base sendo "quase
abstract".

```csharp
closed record class GateState;
record class Closed : GateState;
record class Open(float Percent) : GateState;

GateState g = new Open(40f);
g switch { Closed => "closed", Open(var pct) => $"open {pct}%" };
// "open 40%", sem CS8509 e sem braço de descarte
```

A mesma hierarquia com `abstract` na base e `sealed` nos filhos continua
reportando CS8509 com o pattern `'_'`, porque outro assembly poderia acrescentar
uma subclasse. No C# 14 o erro é `CS9327: Feature 'closed classes' is not
available`. Como `union`, depende de um tipo que só o runtime do .NET 11 traz
(`IsClosedTypeAttribute`), então `net10.0` falha com CS0656 sem um polyfill.

Aprofundamento: `closed-classes-and-exhaustive-hierarchies`. Relacionado:
`type-constant-and-relational-patterns` para exaustividade em geral.

### Indexers de extensão

Um bloco `extension`, introduzido no C# 14, agora pode declarar um indexer.

```csharp
static class Ext { extension(IEnumerable<int> s) { public int this[int i] => s.ElementAt(i); } }
// new[] { 1, 2, 3, 4 }.AsEnumerable()[2] imprime 3
```

No C# 14 é `CS9327: Feature 'extension indexers' is not available`. Os outros
membros que blocos de extensão ainda rejeitam (campos, auto-properties, eventos
e constantes) reportam CS9282; `extension(string) { public const int Max = 5; }`
continua sendo erro no compilador GA.

Aprofundamento: `extension-members-and-extension-blocks`.

### break e continue com rótulo

Um rótulo antes de um laço ou de um `switch` agora pode ser alvo de `break` e
`continue` a partir de uma instrução aninhada, o que substitui a flag booleana
ou o `goto` que laços aninhados exigiam.

```csharp
int visited = 0;
int[][] grid = [[1, 0, 1], [2, 3, 9], [4, 5, 6]];
outer:
for (int r = 0; r < grid.Length; r++)
{
    for (int c = 0; c < grid[r].Length; c++)
    {
        visited++;
        if (grid[r][c] == 0) continue outer;   // próxima linha
        if (grid[r][c] == 3) break outer;      // sai dos dois laços
    }
}
// visited é 4
```

No C# 14 é `CS9327: Feature 'labeled break and continue' is not available`. É só de
compilador e funciona em qualquer target framework com `LangVersion` 15. Este é
o único recurso aqui sem conceito dedicado: o exemplo acima é a história toda.
O rótulo precisa estar no laço ou `switch` que envolve o jump, e não pode ser
atravessado por uma lambda ou por uma função local (CS1632 e CS9393).

### Membros estáticos em interfaces em runtimes antigos

Interfaces podem declarar membros `static` não virtuais (métodos, campos
`static readonly`, auxiliares `private static`) sem o suporte de runtime a
default interface methods.

```csharp
public interface IVersioned { static string Describe() => "x"; private static int n = 1; }
```

Isso compilou para `netstandard2.0` com `LangVersion` 15 e falhou com
`CS9327: Feature 'static members in interfaces' is not available` no 14. Corpo
de instância, `static abstract` e `static virtual` continuam precisando do
runtime: essa fronteira está descrita em
`interfaces-explicit-implementation-and-default-methods`. Só a compilação foi
conferida aqui; não executei o resultado no .NET Framework.

### Regras de segurança de memória (preview)

Esta é a parte da página que não é um recurso estável do C# 15. O modelo
atualizado de segurança de memória (relaxamentos de ponteiro, a expressão
`unsafe(expr)` e a palavra-chave `safe`) está atrás de `LangVersion` `preview`,
e as regras que fazem `unsafe` significar "exige unsafe" estão atrás de um
segundo opt-in, `<Features>$(Features);updated-memory-safety-rules</Features>`.
Com `LangVersion` 15 o recurso é rejeitado com `CS8652: The feature 'updated
memory safety rules' is currently in Preview and *unsupported*`. Com `preview` e
`AllowUnsafeBlocks`, `int n = 5; int* p = &n; Console.WriteLine(unsafe(*p));`
imprimiu 5. Trate como "o que vem", nunca como o padrão atual.

Aprofundamento: a seção de memory safety de
`unsafe-code-pointers-and-function-pointers`.

### O que não está no C# 15

Estes itens foram discutidos publicamente e não existem no compilador GA, nem
com `LangVersion` `preview`:

| Recurso | O que o compilador diz |
|---|---|
| Dictionary expressions `["a": 1]` | CS1002, CS1003, CS1022 (sintaxe) |
| Await condicional nulo `await? t` | CS1525 |
| Comparação encadeada `0 < x < 10` | CS0019 (`bool` e `int`) |
| Membro com tipo inferido `DayOfWeek d = .Monday;` | CS1525 |
| Enums closed `closed enum Color` | CS0106 |
| Constantes em blocos de extensão | CS9282 |

Como `closed enum` não existe, o aviso `CS8524` num switch sobre enum continua;
veja `enums-and-flags-enums`.

## Trade-offs

- **Linguagem estável, ecossistema jovem.** `union` e `closed` são GA, mas
  bibliotecas e ferramentas adotam com o tempo. O System.Text.Json entende
  unions no .NET 11; confira o serializador, o ORM e os analyzers que você usa
  antes de pôr um union num contrato público.
- **Só de compilador versus dependente do runtime.** `with(...)`, indexers de
  extensão, jumps com rótulo e membros estáticos de interface funcionam em
  target frameworks antigos com `LangVersion` 15; `union` e `closed` precisam de
  tipos do runtime do .NET 11. Decida por recurso, não pelo número da versão.
- **Acrescentar um case é breaking change.** Um case type novo num `union`
  público, ou uma subclasse nova numa classe `closed` pública, deixa o switch de
  todo consumidor não exaustivo. Isso é o recurso, e também um custo de
  versionamento.
- **Novas palavras contextuais.** `closed` e `union` não podem mais nomear um
  tipo (`class closed { }` é CS9380), então código com tipos em minúsculas deve
  ser recompilado com o SDK 11 antes de trocar o target framework.
- **Um mapa não é o território.** Esta página repete o que foi executado. Casos
  de borda e comportamento medido estão nos conceitos linkados.

## Documentation Links

- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
- [Union types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/union) (doc)
- [Closed hierarchies, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/closed-hierarchies) (doc)
- [Collection expression arguments, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/collection-expression-arguments) (doc)
- [C# language versioning, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/configure-language-version) (doc)
- [Roslyn Language Feature Status, dotnet/roslyn](https://github.com/dotnet/roslyn/blob/main/docs/Language%20Feature%20Status.md) (doc)
