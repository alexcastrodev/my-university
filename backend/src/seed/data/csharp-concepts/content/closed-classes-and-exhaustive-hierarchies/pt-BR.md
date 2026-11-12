---
version: 1.0
updatedAt: 2026-11-12
title: "Classes Closed e Hierarquias Exaustivas no C# 15"
summary: O modificador closed do C# 15, as regras e os erros reais do compilador, como a exaustividade é calculada (e onde há buracos), os metadados, o problema do System.Text.Json e a comparação com abstract mais sealed, enum e union.
---
## Objective

Uma classe `closed`, nova no C# 15, é uma classe base cuja lista completa de
subclasses diretas o compilador conhece, porque só código do mesmo assembly pode
derivar dela. O ganho aparece no `switch`: um switch sobre uma base closed que
trata cada subclasse direta é exaustivo, sem braço de descarte, mesmo que a base
seja uma hierarquia comum e não um enum. Até o C# 14 o compilador não podia
prometer isso, então base `abstract` com filhos `sealed` ainda produzia CS8509
com o pattern `'_'`, e times escreviam um braço `_ => throw` que escondia toda
subclasse acrescentada depois. Este conceito cobre o modificador e suas regras,
como a exaustividade é calculada (e onde há buracos), os diagnósticos, os
metadados, a armadilha do System.Text.Json e como `closed` se compara a `sealed`
com construtor privado, `enum` e `union`. Tudo foi compilado e executado no SDK
11.0.100.

## Use Cases

- Uma hierarquia de domínio que você controla, como formas, eventos de pagamento
  ou estados de comporta, consumida por outros códigos com `switch`.
- Um assembly de contratos que publica um tipo base e subclasses, e assemblies
  consumidores que precisam tratar todos sem braço `_`.
- Trocar o padrão `abstract record` mais `_ => throw new
  UnreachableException()` por uma versão conferida pelo compilador.
- Escolher entre uma hierarquia closed e uma `union` para um conjunto fechado de
  casos.

## Deep Dive

### O modificador e suas regras

```csharp
closed record class GateState;
record class Closed : GateState;
record class Open(float Percent) : GateState;

GateState g = new Open(40f);
string text = g switch { Closed => "closed", Open(var pct) => $"open {pct}%" };
// "open 40%", compilou sem warning
```

A mesma hierarquia declarada com `abstract` na base e `sealed` nos filhos compila
com `warning CS8509: ... the pattern '_' is not covered`. O compilador não pode
descartar uma subclasse em outro assembly. Com `closed` ele pode, e o warning
some. Tire um case da versão closed e o warning volta nomeando a lacuna real:
`the pattern 'Rect' is not covered`.

As regras, cada uma conferida com um programa de uma linha:

| Código | Resultado |
|---|---|
| `new Shape()` numa classe closed | `CS0144`: é abstrata. `closed` implica `abstract` |
| `closed abstract class A;` | `CS9384`: já é sempre implicitamente abstrata |
| `closed sealed class A;` ou `closed static class A;` | `CS9381`: não pode ser sealed nem static |
| `closed struct A;`, `closed interface A;` | `CS0106`: só classes (records incluídos) |
| `class X : ClosedBase` em outro assembly | `CS9382`: não pode usar um tipo closed de outro assembly como base |
| `class closed { }` | `CS9380`: tipos e aliases não podem se chamar `closed` |

O caso `CS9382` precisa de dois projetos, e o lab tem os dois: um assembly de
contratos com `closed record class Shape` e um assembly de aplicação que não
pode derivar dele, mas pode fazer switch sobre ele. Uma classe `closed` também
pode ser um `record class`, que costuma ser o que você quer para dados.

### Como a exaustividade é calculada

O compilador confere as subclasses **diretas**. Três consequências, cada uma de
um exemplo compilado:

1. Uma subclasse direta que não é closed é coberta por um pattern dela mesma.
   Com `closed class Animal` e filhos `Dog` e `Cat`, um switch com `Dog` e `Cat`
   é exaustivo, e um `Leaf : Dog` é coberto pelo braço `Dog`.
2. Uma subclasse direta que é ela mesma `closed` estende a checagem aos seus
   próprios filhos. Com `closed class Mid : Animal` e `class Leaf : Mid`, um
   switch só com `Dog` e `Cat` avisa `the pattern 'Leaf' is not covered`;
   acrescentar `Leaf l => 3` silencia.
3. Uma subclasse direta que não é closed nem abstrata pode ser instanciada, então
   o switch precisa de um braço para ela. Com `closed class Shape`, uma `class
   Animal : Shape` comum, e `Dog` e `Cat` abaixo de `Animal`, um switch sobre
   `Shape` só com braços para `Dog` e `Cat` avisa `the pattern 'Animal' is not
   covered`.

Então a disciplina é: torne `closed` cada nível que você quer ver conferido, ou
deixe as subclasses diretas como únicos tipos concretos.

A subsunção funciona como em qualquer switch. Se o case da base vem primeiro, os
braços seguintes são inalcançáveis e o compilador diz isso como erro:

```csharp
Shape s = new Circle(1);
s switch { Shape x => 0, Circle c => 1, Rect r => 2 };
// error CS8510: The pattern is unreachable.
```

### O que o compilador escreve

O compilador marca a classe closed com `IsClosedTypeAttribute` e põe
`CompilerFeatureRequired("ClosedClasses")` nos construtores dela. O segundo
impede que um compilador que não conhece o recurso, e outras linguagens, derivem
da classe sem a proteção. O lab lê os dois dos metadados com reflection e
confere. Ambos são tipos do runtime do .NET 11, a mesma lição das unions: com
`net10.0` como alvo, `closed` falha com `CS0656: Missing compiler required member
'System.Runtime.CompilerServices.IsClosedTypeAttribute..ctor'`. No C# 14 o
modificador é `CS9327: Feature 'closed classes' is not available in C# 14.0`.

### O System.Text.Json não adivinha

Uma classe closed é abstrata, e o System.Text.Json trata uma base abstrata como
um tipo sem discriminador, a menos que você diga o contrário. Com as opções
padrão, `JsonSerializer.Serialize<Shape>(new Circle(2))` escreve `{}` e
`Deserialize<Shape>` lança `NotSupportedException`. A opção
`InferClosedTypePolymorphism = true` diz ao serializador que as subclasses
diretas da classe closed são o conjunto polimórfico:

```csharp
var options = new JsonSerializerOptions { InferClosedTypePolymorphism = true };
JsonSerializer.Serialize<Shape>(new Circle(2), options);
// {"$type":"Circle","R":2}
JsonSerializer.Deserialize<Shape>("""{"$type":"Rectangle","W":3,"H":4}""", options);
// Rectangle { W = 3, H = 4 }
```

A propriedade `$type` aparece no payload, o que é um contrato com os clientes.
Trate o nome da propriedade e os nomes dos tipos como API pública, ou escreva os
discriminadores você mesmo com `[JsonPolymorphic]` e `[JsonDerivedType]`.

### Closed versus as alternativas

- **`abstract` com construtor privado e classes aninhadas sealed.** Isso tornava
  a hierarquia fechada por convenção, mas o compilador ainda queria um braço `_`
  e dava CS8509 (veja `result-types-versus-exceptions`). `closed` é esse padrão,
  conferido.
- **Classes `sealed` atrás de uma interface.** Outro assembly pode implementar a
  interface, então não há exaustividade. Mesmo limite.
- **`enum`.** Exaustivo na intenção, mas qualquer inteiro é um valor válido de
  enum e o warning é `CS8524`. `closed enum` é só uma proposta: `closed enum
  Color` é `CS0106` no compilador GA, mesmo com `LangVersion` `preview`. Veja
  `enums-and-flags-enums`.
- **`union`.** Escolhe entre tipos que não precisam de base comum, inclusive tipos
  que você não controla. Uma hierarquia closed precisa de uma base sua e dá
  herança e membros compartilhados. Veja `union-types-in-csharp-15`.

## Trade-offs

- **Só no mesmo assembly.** Consumidores não podem acrescentar subclasses, que é
  o ponto, mas isso elimina extensão estilo plugin. Se extensões precisam existir,
  não use `closed`.
- **Acrescentar ou fechar é breaking change.** Acrescentar uma subclasse a uma
  classe closed publicada deixa o switch de todo consumidor não exaustivo, e
  acrescentar `closed` a uma classe pública existente impede que subclasses
  externas compilem. Planeje o versionamento do assembly de contratos para isso.
- **Buracos em níveis intermediários não closed.** Uma classe intermediária que
  não é closed nem sealed pode ser instanciada se não for abstrata, então o
  compilador pede um braço para ela. Torne as classes intermediárias `closed`
  quando quiser a checagem mais funda.
- **Exigência de runtime.** Os tipos de atributo vêm com o .NET 11. Uma
  biblioteca que precisa mirar `net10.0` não pode usar `closed` sem polyfill, e
  outras linguagens não conseguem derivar dela.
- **Serialização exige uma decisão.** Ligue `InferClosedTypePolymorphism` ou
  escreva os discriminadores você mesmo; a saída padrão é `{}`.
- **Fique sem o braço de descarte.** Acrescentar `_` traz de volta o problema
  antigo: a subclasse nova compila e cai em silêncio no ramo padrão.

## Lab

Neste lab um assembly de contratos publica `closed record class Shape` com `Circle` e `Rectangle`, e um assembly de aplicação calcula áreas e serializa formas. O starter declara `Shape` como `abstract`, então você vê o problema primeiro e depois o corrige. O `Shapes.App` transforma CS8509 em erro.

**O cenário**

Dois projetos de código, `Shapes.Contracts` (`Shape.cs`) e `Shapes.App` (`ShapeService.cs` com `Area`, `ToJson` e `FromJson`), mais o projeto de testes. Os testes leem os metadados do compilador por reflection e conferem o texto JSON.

**O que você vai fazer, passo a passo**

1. **Fechar a hierarquia (TODO-00).** Em `Shape.cs`, troque `abstract` por `closed`.
2. **Switch exaustivo entre assemblies (TODO-01).** Em `Area`, um braço por subclasse e nenhum `_`. Note que isso só compila por causa do TODO-00.
3. **Discriminador JSON (TODO-02).** Implemente `ToJson` e `FromJson` com `InferClosedTypePolymorphism = true` para obter `{"$type":"Circle","R":2}`.

**Como saber que terminou**

`dotnet test` fica verde com 10 testes. Você deve conseguir explicar por que `Area` não precisa de braço `_` mesmo com `Shapes.Contracts` sendo outro assembly, e por que o mesmo código com `abstract` não compila.

**Desafios opcionais**

- Acrescente `public record class Triangle(double B, double H) : Shape;` em `Shapes.Contracts` e recompile: `Area` falha com CS8509 nomeando `Triangle`.
- Crie um terceiro projeto que derive de `Shape` e leia o `CS9382`.

**Pré-requisitos:** records, `switch` expressions e o SDK do .NET 11 (os projetos miram `net11.0`).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Todo método stubado lança `NotImplementedException`, então os testes vermelhos são seu checklist.

## Documentation Links

- [closed modifier, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/closed) (doc)
- [Closed hierarchies, C# 15 feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-15.0/closed-hierarchies) (doc)
- [What's new in C# 15, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-15) (doc)
- [Unions and closed hierarchies in ASP.NET Core, .NET Blog](https://devblogs.microsoft.com/dotnet/unions-and-closed-hierarchies-in-aspnetcore/) (doc)
- [Closed enums proposal, dotnet/csharplang](https://github.com/dotnet/csharplang/blob/main/proposals/closed-enums.md) (doc)
