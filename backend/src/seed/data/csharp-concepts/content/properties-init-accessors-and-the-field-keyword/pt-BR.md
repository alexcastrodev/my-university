---
version: 1.0
updatedAt: 2026-10-15
title: "Propriedades, Acessores init e a Palavra-chave field"
summary: O que o compilador gera para uma propriedade, o que init garante (e o que não garante), e as regras exatas do field do C# 14, com vinculação, a quebra na migração, atributos field:, análise de nulos e propriedades partial.
---
## Objective

Uma propriedade parece um campo para quem chama e funciona como um par de métodos
por baixo. Durante anos isso deixou um buraco: a auto-property (`{ get; set; }`)
não tem lugar para lógica, e no momento em que você precisa de uma linha de
validação é obrigado a declarar um campo privado, dar um nome a ele e escrever os
dois acessores na mão. O C# 14 fecha esse buraco com a palavra-chave contextual
`field`, que deixa o corpo de um acessor chegar direto ao campo de apoio gerado
pelo compilador. Este conceito mostra o que o compilador gera para uma
propriedade, como o acessor `init` restringe a escrita, e as regras exatas do
`field`: onde ele é palavra-chave, o que acontece com membros que já se chamam
`field`, atributos com alvo `field:`, análise de nulos e propriedades partial.

## Use Cases

- Colocar validação ou normalização numa auto-property existente sem criar um
  campo de apoio com nome, que o resto da classe poderia usar para pular a regra.
- Calcular um valor caro uma única vez, numa só expressão.
- View models que só disparam notificação de mudança quando o valor muda de fato.
- Objetos imutáveis depois da construção, montados com object initializers (`init`).
- Migrar um código antigo para o C# 14 quando ele já tem um membro chamado `field`.

## Deep Dive

### No que uma propriedade compila

A propriedade `Email` vira dois métodos, `get_Email` e `set_Email` (ou a variante
`init`), mais metadados que ligam os dois. A auto-property também ganha um campo
privado chamado `<Email>k__BackingField`. Os sinais de menor e maior não são
válidos em C#, e é assim que o compilador garante que nenhum código-fonte alcance
esse campo pelo nome. A reflexão mostra:

```csharp
class User
{
    [field: Display(Name = "backing")]
    public string Email { get; init => field = value.Trim().ToLowerInvariant(); } = "";
}

foreach (var f in typeof(User).GetFields(BindingFlags.Instance | BindingFlags.NonPublic))
    Console.WriteLine($"{f.Name} initonly={f.IsInitOnly} attrs=...");
// <Email>k__BackingField initonly=True attrs=CompilerGeneratedAttribute,DebuggerBrowsableAttribute,DisplayAttribute
```

O `field` não muda esse formato: uma propriedade que usa `field` ganha o mesmo
tipo de campo de apoio oculto de uma auto-property. Só os corpos dos acessores
mudam.

### Acessores init

O acessor `init` (C# 9) é um setter que só pode rodar durante a construção do
objeto: num object initializer, numa expressão `with`, num construtor do tipo via
`this` ou `base`, ou dentro de outro acessor `init`. Em qualquer outro lugar o
compilador barra:

```csharp
var p = new Point { X = 1, Y = 2 };   // ok
p.X = 9;
// error CS8852: Init-only property or indexer 'Point.X' can only be assigned in an
// object initializer, or on 'this' or 'base' in an instance constructor or an 'init' accessor.
```

A garantia é de compilação. O setter `init` é um método comum cujo tipo de
retorno carrega um modificador obrigatório, `IsExternalInit`, que compiladores
antigos se recusam a chamar. A reflexão não liga para isso:

```csharp
var setter = typeof(Point).GetProperty("X")!.SetMethod!;
setter.ReturnParameter.GetRequiredCustomModifiers();   // [IsExternalInit]
setter.Invoke(p, [9]);
Console.WriteLine(p.X);                                // 9
```

É exatamente assim que serializadores preenchem propriedades `init`. Então trate
`init` como uma promessa sobre o seu próprio código, não como barreira de
segurança. Quando a propriedade precisa ser preenchida, combine `init` com
`required` (veja Fields, Constants and Initialization Order). O `init` também
explica por que o campo gerado de `User` acima é `initonly`.

### A palavra-chave field (C# 14)

Dentro de um acessor de propriedade, `field` aponta para o campo de apoio
sintetizado. Dá para misturar um acessor automático com um completo, escrever os
dois ou usar expression body:

```csharp
class Temperature
{
    public double Celsius
    {
        get;
        set => field = value >= -273.15
            ? value
            : throw new ArgumentOutOfRangeException(nameof(value), "below absolute zero");
    }
}

class Cache
{
    public string Report => field ??= Build();   // Build() roda uma vez
}
```

Ler `cache.Report` duas vezes imprimiu o rastro de `Build()` uma vez só. Antes do
C# 14 o mesmo código exigia `private double _celsius;`, e qualquer outro método da
classe podia fazer `_celsius = -500` e pular a checagem. Com `field`, o
armazenamento só é alcançável pelos acessores. O conceito de DDD em
dotnet-concepts (Aggregates, Entities, and Value Objects) usa isso para manter o
estado do agregado válido a cada mudança.

### Inicializador versus construtor: qual caminho chama o setter

O inicializador da propriedade escreve direto no campo de apoio, sem chamar o
setter. Atribuir a propriedade no construtor chama o setter. Os dois fatos saíram
direto do experimento:

```csharp
class ViewModel
{
    public bool Pending { get; private set; }
    public bool IsActive
    {
        get;
        set { if (field == value) return; field = value; Pending = true; }
    } = true;
}
// after ctor: Pending=False, IsActive=True
// after set:  Pending=True,  IsActive=False

class CtorSet
{
    public CtorSet() { Name = "  set in ctor  "; }
    public string Name { get; set => field = value.Trim(); } = "  initializer  ";
}
// new CtorSet().Name == "set in ctor"   (o setter rodou, valor aparado)
```

O inicializador é o jeito de dar um padrão sem disparar efeitos colaterais; o
construtor é o jeito de forçar o padrão a passar pela validação.

### Como o field é vinculado, e a quebra na migração

`field` só é palavra-chave como expressão primária dentro dos corpos de `get`,
`set` e `init` de propriedades (incluindo lambdas e funções locais aninhadas ali).
Em todo o resto é um identificador comum: em métodos, em acessores de evento e em
**indexadores**, onde `get => field` dá erro CS0103 porque esse nome não existe.

A quebra aparece em código que já tem um membro chamado `field`. No C# 14, um
`field` sem qualificação dentro de um acessor passa a significar o campo de
apoio, e o compilador avisa:

```csharp
class Legacy
{
    private int field = 100;
    public int Value { get => field; set => field = value; }
    public int Escaped => @field;      // o membro
    public int This => this.field;     // o membro
}
// warning CS9258: In language version 14.0, the 'field' keyword binds to a synthesized
// backing field for the property. To avoid generating a synthesized backing field, and
// to refer to the existing member, use 'this.field' or '@field' instead.
// Depois de l.Value = 5: Value=5, member field=100
```

O programa continua compilando e usa um campo novo em silêncio, então trate o
CS9258 como erro durante a migração. Declarar uma variável local ou um parâmetro
de lambda chamado `field` dentro de um acessor é erro de verdade, CS9273; com o
nome `@field` compila. `nameof(field)` é o erro CS8081 (`Expression does not have
a name`), porque o campo de apoio não tem nome no código-fonte. Na validação de
argumento use `nameof(value)`.

### Atributos com alvo field:

`[field: ...]` coloca o atributo no campo de apoio em vez de na propriedade. Isso
já funcionava em auto-properties e agora vale para qualquer propriedade que use
`field`, como mostra o `DisplayAttribute` na saída da reflexão. Numa propriedade
sem campo de apoio (`public string NoBacking => "computed";`) o compilador do SDK
10 não falha: ele emite o aviso CS0657 e **ignora o atributo**. A especificação da
feature diz que isso seria erro, então confie no compilador e mantenha os avisos
visíveis.

### Análise de nulos

Com nullable reference types ligado, o compilador decide se o getter é
*null-resilient*, ou seja, se ele ainda devolve um valor não nulo quando o campo
contém `null`. Um getter preguiçoso é, então o campo é tratado como anulável e o
construtor não precisa atribuí-lo. Um getter simples não é:

```csharp
public string Lazy => field ??= "computed";                  // sem aviso
public string Plain { get => field; set => field = value; }  // aviso CS9264
public string Trimmed { get; set => field = value.Trim(); }  // aviso CS9264
public string Empty { get; set { } }                         // CS8618, e CS9266 no setter
```

O CS9264 diz `Non-nullable property 'Plain' must contain a non-null value when
exiting constructor ... or safely handling the case where 'field' is null in the
'get' accessor`. O CS9266 aponta um setter que ignora `field` enquanto o outro
acessor usa.

### Propriedades partial

Uma propriedade partial (C# 13) pode usar `field` na declaração de implementação.
O inicializador pode ficar em qualquer uma das partes, mas não nas duas (CS9263),
e a parte de implementação não pode ser só de acessores automáticos (CS9250): pelo
menos um acessor precisa de corpo:

```csharp
public partial class Widget
{
    public partial string Title { get; set; } = "  initial  ";
}
public partial class Widget
{
    public partial string Title { get; set => field = value.Trim(); }
}
// new Widget().Title == "  initial  "   (o inicializador pula o setter)
```

É o formato que os source generators preferem: o usuário escreve a declaração e
os atributos `[field: ...]`, e o generator escreve os acessores em cima de `field`.

## Trade-offs

- **`field` deixa o armazenamento privado da propriedade.** O ganho é que nenhum
  método consegue pular a validação. O custo é que a própria classe não lê o valor
  cru sem passar pelo getter, então um getter preguiçoso sempre executa a lógica.
- **Inicializador e construtor se comportam diferente.** Fácil de esquecer no
  code review:
  ```csharp
  public string Name { get; set => field = value.Trim(); } = " x ";  // fica " x "
  ```
- **A migração para o C# 14 pode mudar o significado sem barulho.** Um membro
  chamado `field` continua compilando, só com o CS9258. Renomeie o membro ou
  coloque `<WarningsAsErrors>CS9258</WarningsAsErrors>` durante a migração.
- **`init` só vale na compilação.** Ele barra o seu código, não a reflexão nem os
  desserializadores, e não deixa o objeto profundamente imutável: uma propriedade
  `init` do tipo `List<T>` continua mutável por dentro.
- **Lógica em acessor esconde custo.** Ler uma propriedade parece de graça.
  Mantenha os acessores baratos e sem efeito colateral além de validação e
  notificação, e use um método quando o trabalho for I/O ou puder falhar por
  motivos que quem chama não consegue resolver.
- **Indexadores ficam de fora.** `field` não existe em acessores de indexador,
  então um indexador ainda precisa de um campo explícito.

## Lab

Neste lab você recebe quatro classes pequenas com **auto-properties comuns** e testes xUnit prontos que falham até você pôr lógica nos acessores. O seu trabalho é editar essas propriedades. A ideia central é ver que a palavra-chave `field` (C# 14) deixa você validar, normalizar ou dar um valor padrão preguiçoso dentro de uma auto-property, sem declarar um campo de apoio à mão, e que `init` serve para regras de construção.

**O cenário**

Quatro classes em `Models.cs`, cada uma com uma propriedade que precisa de lógica.

- `Temperature.Celsius`: um `double` que não pode ficar abaixo do zero absoluto (-273.15).
- `Person.Name`: uma propriedade `init` que deve guardar o nome aparado e rejeitar texto vazio.
- `Document.Title`: um título com valor padrão `"untitled"` até alguém atribuir outro.
- `Counter.Value`: um inteiro que dispara o evento `Changed` quando muda. O helper `OnChanged` já existe.

Não há `NotImplementedException`: o código compila e roda como auto-properties simples, então os testes vermelhos mostram o que falta.

**O que você vai fazer, passo a passo**

1. **Validar no setter (TODO-00).** Em `Temperature.Celsius`, lance `ArgumentOutOfRangeException` para qualquer valor abaixo de -273.15 e use `field` no corpo do setter. O teste confere que, após uma rejeição, o valor anterior continua guardado.
2. **Normalizar em um `init` (TODO-01).** Em `Person.Name`, mantenha a propriedade `init`-only, guarde o valor aparado e lance `ArgumentException` para `null`, vazio ou só espaços. Use `field` também no acessor `init`.
3. **Padrão preguiçoso no getter (TODO-02).** Em `Document.Title`, devolva `"untitled"` até haver título, com `field ??= "untitled"` no getter. Mantenha o setter como um `set;` auto-implementado.
4. **Evento só quando muda (TODO-03).** Em `Counter.Value`, dispare `Changed` com o novo valor apenas se ele realmente mudou. Atribuir o valor atual de novo não deve disparar nada. Use `field` para ler o valor antigo dentro do setter.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar o que o compilador gera por trás de `field`, e por que o setter de `Temperature` precisa validar antes de atribuir para preservar o valor anterior.

**Desafios opcionais**

Estes dois não têm esqueleto nem teste, então você cria as classes e os testes.

- **TODO-04:** `Price.Amount`, normalizando o valor em um acessor `init`.
- **TODO-05:** `Session.Token`, aplicando `[field: NonSerialized]` ao campo de apoio gerado pelo compilador.

**Pré-requisitos:** propriedades e auto-properties em C#, eventos, exceções e o .NET 10 SDK (C# 14).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. As propriedades começam como auto-properties sem lógica, então os testes vermelhos mostram o que ainda precisa de validação, e os comentários `TODO-NN` em `Models.cs` dão a dica de cada uma.

## Documentation Links

- [The field contextual keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/field) (doc)
- [field keyword feature specification, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/proposals/csharp-14.0/field-keyword) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [Properties, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/properties) (doc)
- [init keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/init) (doc)
