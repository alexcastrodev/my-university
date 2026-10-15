---
version: 1.0
updatedAt: 2026-10-15
title: "Primary Constructors em Classes e Structs"
summary: Parâmetros de primary constructor viram campos ocultos e mutáveis quando um membro os usa; o IL gerado, os avisos de armazenamento duplo CS9124 e CS9107, como recuperar readonly e validação, e as regras de structs.
---
## Objective

O primary constructor (C# 12) coloca os parâmetros do construtor na própria
declaração do tipo: `public class OrderService(IRepo repo, ILogger<OrderService> log)`.
A sintaxe é a mesma que os records usam desde o C# 9, mas o significado é outro,
e é nessa diferença que moram os bugs. Numa classe ou struct os parâmetros **não**
viram propriedades. Eles são parâmetros que continuam no escopo do corpo inteiro
do tipo, e quando um membro usa um deles o compilador o transforma, sem avisar,
num campo oculto e **mutável**. Este conceito mostra o que o compilador gera
(lido no IL), quando um campo é criado e quando não é, os dois avisos de
"armazenamento duplo", como recuperar `readonly` e a validação de argumentos, e
as regras para structs e outros construtores.

## Use Cases

- Serviços que recebem dependências por injeção de dependência e só chamam
  essas dependências, que é o caso em que primary constructors ficam mais legíveis.
- Tipos pequenos cujas propriedades são calculadas uma vez a partir dos argumentos.
- Classes derivadas que só repassam argumentos para o construtor da base.
- Revisar código em que um parâmetro inicializa uma propriedade e também é usado
  dentro de um método, o que cria duas cópias que podem divergir.

## Deep Dive

### Parâmetros, não membros

Os parâmetros estão no escopo dos inicializadores, de todo membro de instância e
da lista de argumentos de `base(...)`, mas não são membros do tipo: `this.name`
dá o erro CS1061 (`'NotMember' does not contain a definition for 'name'`). Eles
também não podem ser usados em membros estáticos (CS9105), e um parâmetro que
ninguém lê gera o aviso CS9113 (`Parameter 'name' is unread`).

Todo outro construtor precisa encadear no primário, direto ou passando por outro
construtor, para que os parâmetros estejam sempre atribuídos:

```csharp
public class OtherCtor(string name)
{
    public OtherCtor() { }
    // error CS8862: A constructor declared in a type with parameter list must have 'this' constructor initializer.
}
```

A correção é `public OtherCtor() : this("default") { }`. Numa classe, a presença
do primary constructor também remove o construtor sem parâmetros implícito.

### Quando o compilador cria um campo

O compilador só guarda um parâmetro se algum membro de instância precisar dele
depois. Se o parâmetro só aparece em inicializadores ou na chamada à base, nada é
guardado. A reflexão sobre três tipos mostra a diferença:

```csharp
public class Greeter(string name)
{
    public string Greet() => $"Hello, {name}";
    public void Rename(string newName) => name = newName;   // permitido
}

public class Box(int width, int height)
{
    public int Area { get; } = width * height;             // só no inicializador
}

// Greeter: <name>P (initonly=False)
// Box: <Area>k__BackingField (initonly=True)
```

`Greeter` ganhou um campo privado chamado `<name>P`, um nome impronunciável no
mesmo estilo do `k__BackingField` das auto-properties. `Box` não tem campo para
`width` nem `height`: eles só existiram durante o construtor.

O IL gerado pelo `ilspycmd -il` para `Greeter` deixa o lowering concreto:

```text
.field private string '<name>P'

.method public hidebysig specialname rtspecialname instance void .ctor (string name)
{
    IL_0000: ldarg.0
    IL_0001: ldarg.1
    IL_0002: stfld string Greeter::'<name>P'
    IL_0007: ldarg.0
    IL_0008: call instance void [System.Runtime]System.Object::.ctor()
    IL_000e: ret
}

.method public hidebysig instance string Greet ()
{
    IL_0000: ldstr "Hello, "
    IL_0005: ldarg.0
    IL_0006: ldfld string Greeter::'<name>P'
    ...
}
```

Saem três fatos dali. O campo não tem a flag `initonly`, então é mutável, e o
`Rename` mudou de verdade o que `Greet` imprime (`Hello, Ana`, depois `Hello,
Bia`). A captura é gravada **antes** da chamada ao construtor da base, no mesmo
ponto em que rodam os inicializadores de campo (veja Fields, Constants and
Initialization Order). E todo uso num membro vira `ldfld` em `this`, então uma
lambda que usa o parâmetro captura `this`, não uma cópia do valor.

### Os dois avisos de armazenamento duplo

Como inicialização e captura são mecanismos diferentes, usar o mesmo parâmetro
para as duas coisas cria duas cópias independentes:

```csharp
public class Account(string owner)
{
    public string Owner { get; } = owner;                 // cópia 1: backing field
    public string Describe() => $"owner is {owner}";      // cópia 2: <owner>P
    public void Rename(string n) => owner = n;
}
// warning CS9124: Parameter 'string owner' is captured into the state of the enclosing
// type and its value is also used to initialize a field, property, or event.
// Depois de Rename("bia"): Owner=ana, Describe=owner is bia
```

O segundo aviso aparece em hierarquias, quando a classe derivada repassa um
parâmetro para a base e também o usa:

```csharp
public class BankAccount(string id, string owner)
{
    public string Owner { get; set; } = owner;
}
public class Savings(string id, string owner) : BankAccount(id, owner)
{
    public override string ToString() => $"{id}/{owner}";
}
// warning CS9107: Parameter 'string owner' is captured into the state of the enclosing
// type and its value is also passed to the base constructor. The value might be
// captured by the base class as well.
// Depois de s.Owner = "changed": base Owner=changed, derived ToString=A-1/ana
```

Nos dois casos a correção é escolher uma única fonte da verdade: dentro dos
membros, leia a propriedade (`Owner`) e não o parâmetro.

### Recuperando o readonly

Parâmetros de primary constructor numa classe não aceitam `readonly`:
`class C(readonly string x)` falha com CS9190 (`'readonly' modifier must be
specified after 'ref'`), porque o parser lê aquilo como um modificador `ref
readonly` fora de ordem. O idioma é declarar um campo com o mesmo nome e
inicializá-lo a partir do parâmetro. Dentro do inicializador, `name` é o
parâmetro; dentro dos membros, o campo esconde o parâmetro, então não acontece
captura em `<name>P`:

```csharp
public class Service(string name)
{
    private readonly string name = name.Trim();
    public string Show() => name;                 // o campo readonly
}
// fields: name initonly=True
```

Muitos times preferem um campo com underline (`private readonly IRepo _repo = repo;`)
para que um uso perdido de `repo` num membro apareça no code review e dispare o
CS9124 se os dois forem usados.

### Validando argumentos

Não existe corpo de construtor para colocar guard clauses, então a validação vai
para um inicializador, que roda durante a construção:

```csharp
public class OrderService(IRepo repo)
{
    private readonly IRepo _repo = repo ?? throw new ArgumentNullException(nameof(repo));
}

public class LazyCheck(IRepo repo)
{
    public string Use() => repo.Load();
}
// new OrderService(null!)  -> ArgumentNullException, ParamName "repo"
// new LazyCheck(null!)     -> constrói sem erro; Use() -> NullReferenceException
```

Quando o parâmetro só é capturado, um argumento ruim não é detectado na
construção, e sim no primeiro uso, longe de quem passou o valor. Se você precisa
de várias instruções de validação ou de log, escreva um construtor comum.

### Structs e readonly structs

Numa struct o construtor sem parâmetros implícito continua existindo, e `default`
ou `new S()` sem um construtor sem parâmetros explícito dá os parâmetros zerados.
Um construtor sem parâmetros explícito precisa encadear no primário:

```csharp
public struct Counter(int start)
{
    public Counter() : this(1) { }
    public int Value => start;
    public void Increment() => start++;
}
// new Counter(10) depois de dois Increment(): 12
// default(Counter).Value: 0
// new Counter().Value: 1
```

Numa `readonly struct` os parâmetros capturados são somente leitura: `x++` num
membro é o erro CS9114 (`A primary constructor parameter of a readonly type
cannot be assigned to`). Parâmetros passados por `ref`, `in` ou `out` podem ser
usados em inicializadores, mas nunca capturados: usar um deles num membro de
instância é o CS9109.

### Comparando com records

`record Person(string Name)` usa a mesma lista de parâmetros, mas gera uma
propriedade pública `Name { get; init; }`, além de igualdade, `ToString` e
`Deconstruct`. `class Person(string name)` não gera nada disso. Escolha record
quando os parâmetros são os dados públicos do tipo; escolha primary constructor
de classe quando eles são dependências privadas. Records estão em Records and with
Expressions.

## Trade-offs

- **DI enxuto, estado mutável.** Um serviço como `class Handler(IRepo repo)`
  perde dez linhas de campo e construtor, mas qualquer método agora pode fazer
  `repo = null`. Aceite isso em serviços pequenos, ou crie um campo `readonly`
  onde a dependência não pode mudar.
- **É fácil criar duas cópias.** Trate CS9124 e CS9107 como erro; eles sempre
  apontam para estado que pode divergir.
  ```xml
  <WarningsAsErrors>CS9124;CS9107</WarningsAsErrors>
  ```
- **A validação vai para inicializadores ou some.** Um parâmetro que só é
  capturado nunca é checado na construção. Valide num inicializador ou use um
  construtor comum.
- **Sem corpo de construtor.** Log, setup em várias etapas ou lógica de ordem
  pedem um construtor normal, e os outros construtores só conseguem adicionar
  código depois de encadear com `this(...)`.
- **O nome do parâmetro passa a fazer parte do corpo do tipo.** Renomear um
  parâmetro renomeia uma variável usada em todos os membros, e argumentos
  nomeados em chamadas (`new Greeter(name: "Ana")`) também dependem dele.

## Documentation Links

- [Instance constructors, primary constructors section, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/instance-constructors#primary-constructors) (doc)
- [Declare primary constructors for classes and structs, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/tutorials/primary-constructors) (doc)
- [What's new in C# 12, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-12) (doc)
- [Structure types, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/struct) (doc)
- [ILSpy command-line decompiler (ilspycmd), GitHub](https://github.com/icsharpcode/ILSpy/tree/master/ICSharpCode.ILSpyCmd) (doc)
