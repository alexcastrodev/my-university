---
version: 1.0
updatedAt: 2026-10-14
title: "Herança: virtual, override, new e sealed"
summary: Como o C# decide qual método roda (override pelo tipo do objeto, new pelo tipo da variável), classes abstratas, retorno covariante, despacho virtual e devirtualização com sealed medidos no JIT, casts com is, as e patterns, a classe base frágil e a escolha entre interface, classe abstrata e composição.
---
## Objective

Em C#, herança é opcional em cada nível. Um método só pode ser sobrescrito se a
classe base marcá-lo como `virtual` ou `abstract`, a classe derivada precisa
dizer `override` para trocá-lo, e `new` existe para dizer "estou escondendo isto
de propósito". Qual implementação roda depende dessa escolha: um override é
escolhido pelo tipo do objeto em runtime, um membro escondido pelo tipo estático
da variável. Este conceito cobre as quatro palavras-chave (`virtual`,
`override`, `new`, `sealed`), classes abstratas, retorno covariante, como uma
chamada virtual é despachada de fato e o que `sealed` permite ao JIT, casts com
`is`, `as` e patterns, o problema da classe base frágil e quando escolher
interface, classe abstrata ou composição simples.

## Use Cases

- Uma classe base de framework com um gancho para sobrescrever, como
  `DbContext.OnModelCreating` ou `BackgroundService.ExecuteAsync`.
- Um `Shape` ou `PaymentMethod` abstrato com alguns subtipos concretos tratados
  num `switch` por tipo.
- Selar as classes concretas de uma aplicação para que o JIT possa chamá-las
  direto e ninguém herde delas sem querer.
- Ler uma hierarquia que você não escreveu e prever qual método uma chamada vai
  executar.
- Decidir se uma abstração nova deve ser interface, classe abstrata ou um objeto
  embrulhado.

## Deep Dive

### `virtual` e `override` versus `new`

```csharp
Animal a = new Dog();
Dog d = (Dog)a;
a.Speak();    // Dog.Speak, depois Animal.Speak
d.Speak();    // Dog.Speak, depois Animal.Speak
a.Describe(); // Animal.Describe   (o tipo estático decide)
d.Describe(); // Dog.Describe

class Animal
{
    public virtual void Speak() => Console.WriteLine("Animal.Speak");
    public void Describe() => Console.WriteLine("Animal.Describe");
}
class Dog : Animal
{
    public override void Speak() { Console.WriteLine("Dog.Speak"); base.Speak(); }
    public new void Describe() => Console.WriteLine("Dog.Describe");
}
```

`override` substitui o slot que a base declarou, então todo chamador, seja qual
for o tipo da variável, chega em `Dog.Speak`. `new` declara um segundo método,
sem relação com o primeiro, que só compartilha o nome; quem segura um `Animal`
nunca o enxerga. `base.Speak()` chama a implementação da base de forma não
virtual, e é assim que um override estende em vez de substituir.

Se você escrever a mesma assinatura sem nenhuma das duas palavras, o compilador
esconde o membro e avisa:

```text
warning CS0108: 'Child.Show()' hides inherited member 'Parent.Show()'.
Use the new keyword if hiding was intended.
```

Trate esse aviso como uma pergunta: quase sempre o método da base deveria ser
`virtual` e você queria `override`. `new` é ferramenta de versionamento (uma
classe base que não é sua ganhou um membro com o seu nome), não de design.

Um override não pode mudar a acessibilidade e só pode sobrescrever um membro que
seja `virtual`, `abstract` ou ele mesmo um `override`.

### Classes abstratas

Uma classe `abstract` não pode ser instanciada e pode declarar membros
`abstract` sem corpo, que toda subclasse concreta precisa implementar.
Diferente de uma interface, ela pode ter campos, construtores e membros não
públicos, então é o lugar natural do padrão template method: o algoritmo
público é fixo e um passo protegido varia.

```csharp
abstract class Report
{
    private readonly DateTime _created = new(2026, 10, 14);
    protected Report() { }
    public string Render() => $"{Title()} @ {_created:yyyy-MM-dd}";
    protected abstract string Title();
}
sealed class SalesReport : Report { protected override string Title() => "Sales"; }

// new SalesReport().Render() -> "Sales @ 2026-10-14"
```

As Framework Design Guidelines recomendam construtor `protected` (ou
`internal`) em tipos abstratos, nunca público, porque ninguém de fora consegue
chamá-lo mesmo.

### Retorno covariante (C# 9)

Desde o C# 9 um override pode retornar um tipo mais derivado que o do método da
base, o que elimina o cast que os chamadores escreviam:

```csharp
class Animal { public virtual Animal Clone() => new Animal(); }
class Dog : Animal { public override Dog Clone() => new Dog(); }

Dog copy = new Dog().Clone(); // sem cast (Dog)
```

O mesmo vale para propriedades somente leitura sobrescritas. Records dependem
disso: o método de clone oculto de um record derivado retorna o tipo derivado,
e por isso um `with` num record derivado guardado numa variável do tipo base
ainda produz uma cópia derivada.

### Como uma chamada virtual é despachada

Todo objeto começa com um ponteiro para a method table do seu tipo, e cada
método virtual tem um slot nela. Uma chamada por uma referência do tipo base
precisa carregar esse ponteiro, achar o slot e pular para o endereço que estiver
lá. Dá para ver isso pedindo a saída do JIT (`DOTNET_JitDisasm`). O experimento
usou um `Shape` abstrato, um `OpenCircle` não selado e um `sealed SealedCircle`,
os dois sobrescrevendo `Area()` com o mesmo corpo. Com tiered
compilation desligada, no .NET 10.0.0 num Apple M4 (arm64), um método que chama
`Area()` num `Shape` compilou para:

```text
ldr  x1, [x0]         ; method table do objeto
ldr  x1, [x1, #0x40]  ; bloco de slots virtuais
ldr  x1, [x1, #0x20]  ; o slot de Area
blr  x1               ; chamada indireta
```

A mesma chamada num parâmetro do tipo `sealed class SealedCircle` não teve
chamada nenhuma: o JIT sabia o alvo exato, fez inline de `Area()` e emitiu as
duas multiplicações direto. Isso é devirtualização, e foi o `sealed` que a
tornou demonstrável.

Com as configurações padrão o quadro muda de novo. O Dynamic PGO, ligado por
padrão desde o .NET 8, instrumenta o primeiro tier e registra quais tipos
chegam de fato. No mesmo experimento, a versão Tier1 do método com parâmetro do
tipo base comparava a method table do objeto com a de `OpenCircle`, executava o
corpo inline quando batia e caía na chamada indireta caso contrário (guarded
devirtualization). Então uma chamada virtual que sempre vê um único tipo costuma
sair barata na prática, mas só depois do aquecimento e só atrás de uma checagem
de tipo. A regra de análise CA1852 sugere selar tipos internos sem subclasses, e
as Framework Design Guidelines observam que chamadas virtuais são mais lentas
principalmente porque não sofrem inline.

### `sealed` em classes e em overrides

`sealed class` proíbe subclasses; `sealed override` permite que uma classe
sobrescreva um membro e impeça novos overrides abaixo dela. `string` é selada.
Não dá para selar um membro que não seja override, porque um membro não virtual
já é fechado.

### Casts: implícito, explícito, `is`, `as` e patterns

Upcast é implícito. Downcast precisa de cast, que lança exceção quando erra:

```csharp
Shape up = new Square(3);
var c = (Circle)up; // InvalidCastException: Unable to cast object of type 'Square' to type 'Circle'.

Circle? maybe = up as Circle;              // null em vez de exceção
if (up is Circle { Radius: > 1 } big) { }  // testa, desmonta e vincula num passo só

string text = up switch
{
    Circle k => $"circle {k.Radius}",
    Square q => $"square {q.Side}",
    _ => "unknown",
};
```

Dois detalhes pegam muita gente. `is` e `as` só consideram conversões de
referência, boxing, unboxing e nullable, nunca operadores de conversão
definidos pelo usuário, então `o is Feet` é `false` mesmo quando existe um
`explicit operator Feet(Meters)` e `(Feet)meters` funcionaria. E `x is Shape` é
verdadeiro para qualquer subclasse, enquanto `x.GetType() == typeof(Shape)`
confere o tipo exato. `null` nunca casa com um type pattern.

### O problema da classe base frágil

Uma subclasse que sobrescreve métodos depende de como a classe base chama os
próprios membros virtuais, e isso é detalhe de implementação:

```csharp
class Bag
{
    private readonly List<string> _items = [];
    public virtual void Add(string item) => _items.Add(item);
    public virtual void AddRange(IEnumerable<string> items)
    {
        foreach (var i in items) Add(i); // autochamada por um método virtual
    }
}
class CountingBag : Bag
{
    public int Added { get; private set; }
    public override void Add(string item) { Added++; base.Add(item); }
    public override void AddRange(IEnumerable<string> items)
    {
        Added += items.Count();
        base.AddRange(items);
    }
}
// AddRange(["a", "b", "c"]) -> Added: 6
```

Cada item foi contado duas vezes, uma no `AddRange` e outra no `Add` que ele
chama. Se uma versão futura de `Bag` parasse de chamar `Add`, a contagem ficaria
certa sem aviso, e depois errada de outro jeito. Embrulhar uma `List<string>`
numa classe selada que expõe só `Add` e `AddRange` remove o acoplamento: as
mesmas chamadas dão `Added: 4, Count: 4` depois de mais um `Add`, e nada de fora
consegue mudar isso.

### Interface, classe abstrata ou composição

- **Interface** quando tipos sem relação, inclusive structs, precisam
  compartilhar um contrato, ou quando a classe já tem uma classe base. Uma
  classe implementa várias interfaces, mas herda de uma classe só.
- **Classe abstrata** quando os subtipos compartilham estado, um construtor ou
  um algoritmo fixo com passos protegidos, e você é dono da hierarquia inteira.
- **Composição** quando você quer reaproveitar comportamento, não ser
  substituível. Herdar de `List<T>` para adicionar um método expõe todos os
  membros de `List<T>` para sempre.

Desde o C# 8 interfaces podem ter corpos padrão e até membros privados, então
"interface não tem código" deixou de ser o critério. O que ainda separa as duas
é estado de instância, construtores e herança simples.

## Trade-offs

- **`virtual` é uma promessa pública.** Todo membro virtual é um ponto de
  extensão que você precisa documentar e manter estável, inclusive quando a
  própria base o chama. Torne virtual só onde você desenhou um gancho, e prefira
  um protected virtual chamado por um método público não virtual.
  ```csharp
  public void Save() { Validate(); OnSaving(); Write(); } // público, ordem fixa
  protected virtual void OnSaving() { }                    // o único gancho
  ```
- **Selar ajuda o JIT e bloqueia o usuário.** Selar tipos internos ou de
  aplicação é barato e permite inline das chamadas; selar um tipo público de
  biblioteca tira dos seus usuários um jeito de estendê-lo, e tirar o `sealed`
  depois é seguro enquanto colocar depois quebra compatibilidade. As Framework
  Design Guidelines desaconselham selar classes públicas sem motivo.
- **`new` esconde bugs.** O comportamento depende do tipo declarado da
  variável, então o mesmo objeto responde diferente em dois lugares. Reserve
  para conflitos de versão com uma base que você não controla.
- **Hierarquias profundas resistem a mudança.** Cada nível se acopla ao de cima;
  dois ou três níveis com uma raiz abstrata costumam ser o limite útil antes que
  composição fique mais legível.
- **Switch por tipo só substitui chamada virtual em conjunto fechado.** Um
  `switch` sobre subtipos selados mantém a lógica num lugar só, mas precisa ser
  editado a cada subtipo novo; um método virtual espalha a lógica pelas classes,
  mas um subtipo novo não mexe em mais nada.
- **`as` com checagem de null versus pattern.** `as` devolve `null` em silêncio,
  e esse `null` pode viajar longe antes de falhar. Prefira `is T x`, ou um cast
  que lança exceção quando o tipo errado é bug.

## Documentation Links

- [Inheritance, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/inheritance) (doc)
- [Polymorphism, C# fundamentals, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/object-oriented/polymorphism) (doc)
- [Knowing when to use override and new keywords, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/knowing-when-to-use-override-and-new-keywords) (doc)
- [override modifier, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/override) (doc)
- [sealed modifier, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/sealed) (doc)
- [Type-testing operators and cast expressions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/type-testing-and-cast) (doc)
- [What's new in C# 9, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-9) (doc)
- [Virtual members, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/virtual-members) (doc)
- [Sealing, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/sealing) (doc)
- [CA1852: Seal internal types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/code-analysis/quality-rules/ca1852) (doc)
- [Runtime configuration options for compilation (tiered compilation and PGO), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/runtime-config/compilation) (doc)
