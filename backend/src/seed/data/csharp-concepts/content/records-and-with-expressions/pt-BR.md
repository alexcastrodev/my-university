---
version: 1.0
updatedAt: 2026-10-15
title: "Records e Expressões with"
summary: O que o compilador gera para um record, lido no IL (EqualityContract, PrintMembers, o clone, Deconstruct), record class versus record struct, por que with é cópia rasa, herança, e onde records servem (DTOs, JSON) e onde não (entidades do EF Core).
---
## Objective

Um record é uma classe ou struct para a qual o compilador escreve a parte chata:
propriedades a partir de uma lista de parâmetros posicionais, igualdade por
valor, um `ToString` legível, desconstrução e suporte a expressões `with`. A
conveniência é real, mas cada um desses recursos é código gerado comum, com
regras específicas, e as surpresas (uma cópia via `with` que compartilha uma
lista, dois records que deixam de ser iguais depois de ida e volta pelo JSON, uma
propriedade em cache que fica velha) vêm todas de não saber o que foi gerado.
Este conceito lê o IL de um record para listar exatamente o que o compilador
adiciona, compara `record class`, `record struct` e `readonly record struct`,
mostra que `with` é cópia rasa, e cobre herança e onde records se encaixam (DTOs,
JSON) e onde não (entidades do EF Core).

## Use Cases

- DTOs e contratos de API: formatos de request e response que são só dados.
- Value objects num modelo de domínio, como `Money(decimal Amount, string Currency)`.
- Mensagens e eventos trocados entre componentes, comparados e logados por valor.
- Chaves compostas pequenas para dicionários, como `readonly record struct`.
- Gerar uma cópia modificada de configuração ou de estado sem alterar o original.

## Deep Dive

### O que o compilador gera para um record class

Pegue uma linha:

```csharp
public record Person(string Name, int Age, List<string> Tags);
```

Listar os membros declarados com reflexão e ler o IL com `ilspycmd -il` mostra
tudo o que essa linha produziu:

```text
Constructor  public             .ctor(String, Int32, List`1)     primary constructor
Constructor  protected          .ctor(Person)                     copy constructor
Method       public virtual     Person <Clone>$()                 usado pelo 'with'
Property                        Type EqualityContract             (getter protected virtual)
Method       public virtual     Boolean Equals(Object)
Method       public virtual     Boolean Equals(Person)            IEquatable<Person>
Method       public virtual     Int32 GetHashCode()
Method       public static      Boolean op_Equality / op_Inequality
Method       protected virtual  Boolean PrintMembers(StringBuilder)
Method       public virtual     String ToString()
Method       public             Void Deconstruct(out String, out Int32, out List`1)
Properties   Name, Age, Tags com get e init (o setter tem modreq IsExternalInit)
Fields       <Name>k__BackingField ... todos 'initonly'
```

Os corpos interessantes, simplificados a partir do IL:

- **`EqualityContract`** devolve `typeof(Person)` (`ldtoken Person`). Ele existe
  para a igualdade comparar tipos em tempo de execução numa hierarquia.
- **`Equals(Person other)`** devolve true para a mesma referência, false para
  `null`, depois compara `EqualityContract` e em seguida cada backing field com
  `EqualityComparer<T>.Default.Equals`. **Campos, não propriedades**, e com o
  comparador padrão do tipo de cada campo.
- **`GetHashCode`** combina `EqualityContract` e o hash de cada campo com uma
  multiplicação por `-1521134295` seguida de soma.
- **`ToString`** escreve o nome do tipo e `" { "`, chama `PrintMembers` e fecha
  com `}`. O `PrintMembers` acrescenta `Name = valor` para cada campo e
  propriedade públicos, e começa com `RuntimeHelpers.EnsureSufficientExecutionStack()`
  para que um grafo cíclico falhe com `InsufficientExecutionStackException` em vez
  de derrubar o processo.
- **`<Clone>$`** é `newobj Person::.ctor(Person)`, e o copy constructor copia cada
  campo com `ldfld`/`stfld`. Essa é a definição de cópia rasa.

Não dá para sobrescrever o método de clone nem declarar um membro chamado `Clone`
(CS8859). Dá para escrever você mesmo o copy constructor, `Equals(Person)`,
`GetHashCode`, `PrintMembers` ou `ToString`, e aí o compilador não gera a versão
dele.

### Expressões with e cópias rasas

Uma expressão `with` compila para "clona e depois chama os setters init no
clone":

```text
IL_003a: ldloc.0
IL_003b: callvirt instance class Person Person::'<Clone>$'()
IL_0040: dup
IL_0041: ldc.i4.s 31
IL_0043: callvirt instance void modreq(IsExternalInit) Person::set_Age(int32)
```

Como a cópia é campo a campo, membros de tipo referência são compartilhados:

```csharp
var a = new Person("Ana", 30, ["admin"]);
var b = a with { Age = 31 };
b.Tags.Add("billing");

ReferenceEquals(a.Tags, b.Tags);        // True: os dois agora têm "billing"
a == (a with { });                      // True
ReferenceEquals(a, a with { });         // False: sempre uma instância nova
```

Quando a cópia profunda importa, escreva o copy constructor; o `with` passa a
usá-lo:

```csharp
public record Order(string Id, List<string> Lines)
{
    protected Order(Order original)
    {
        Id = original.Id;
        Lines = [.. original.Lines];
    }
}
// order with { Id = "A-2" }, depois copy.Lines.Add("y"):
// order lines=1, copy lines=2
```

Desde o C# 10, `with` também funciona em qualquer struct e em tipos anônimos;
nesses casos não existe método de clone, o valor é simplesmente copiado e os
setters rodam.

### A armadilha da propriedade calculada em cache

O `with` copia os campos e depois roda só os setters que você nomeou. O que foi
calculado num inicializador vem copiado do original, não é recalculado:

```csharp
public record Circle(double Radius)
{
    public double AreaCached { get; } = Math.PI * Radius * Radius;  // calculada uma vez
    public double Area => Math.PI * Radius * Radius;                // calculada na leitura
}
var c2 = new Circle(1) with { Radius = 10 };
// c2.Radius=10, c2.AreaCached=3.14 (velha), c2.Area=314.16
```

Calcule valores derivados na leitura, ou use uma classe.

### record class, record struct, readonly record struct

| | `record` / `record class` | `record struct` | `readonly record struct` |
|---|---|---|---|
| Natureza | tipo referência | tipo valor | tipo valor |
| Propriedades posicionais | `get; init;` | `get; set;` | `get; init;` |
| `EqualityContract` | sim | não | não |
| `with` | `<Clone>$` + setters | cópia + setters | cópia + setters |
| Herança | só de records | nenhuma | nenhuma |

O padrão mutável do `record struct` pega muita gente de surpresa:

```csharp
public record struct MutablePoint(int X, int Y);
var p = new MutablePoint(1, 2);
var q = p with { X = 10 };
p.Y = 99;
// p = MutablePoint { X = 1, Y = 99 }, q = MutablePoint { X = 10, Y = 2 }
```

Prefira `readonly record struct` para valores pequenos e chaves de dicionário. A
igualdade dele é gerada campo a campo, o que evita o caminho lento por reflexão do
`ValueType.Equals` das structs comuns. Chaves, hashing e por que um record com um
`List<T>` é uma chave ruim estão em Dictionary, HashSet, and Equality.

### Herança

Um record só pode herdar de outro record (`record FromClass : Base` é o CS8864) e
uma classe não pode herdar de um record (CS8865). A igualdade usa o tipo em tempo
de execução via `EqualityContract`, então subtipos diferentes com os mesmos dados
não são iguais, e o `with` mantém o tipo real mesmo através de uma variável do
tipo base:

```csharp
public abstract record Person2(string Name);
public record Teacher(string Name, int Grade) : Person2(Name);
public record Student(string Name, int Grade) : Person2(Name);

Person2 t = new Teacher("Nancy", 3);
Person2 s = new Student("Nancy", 3);
t == s;                         // False
Person2 t2 = t with { Name = "Bob" };
// t2 é Teacher: Teacher { Name = Bob, Grade = 3 }
```

Através de uma variável `Person2` você só consegue atribuir propriedades de
`Person2` no `with`, mas as da classe derivada continuam sendo copiadas.

### Records como DTOs e com JSON

O System.Text.Json faz o binding de records posicionais pelo primary constructor,
então um record vai e volta sem precisar de construtor sem parâmetros:

```csharp
var json = JsonSerializer.Serialize(a);
// {"Name":"Ana","Age":30,"Tags":["admin","billing"]}
var back = JsonSerializer.Deserialize<Person>(json)!;
back == a;   // False
```

O `False` é a igualdade rasa de novo: `Tags` é um `List<string>` novo, e
`List<T>` compara por referência. Um DTO que precisa continuar igual depois da
desserialização precisa de membros comparáveis por valor (strings, números,
records aninhados) ou de um `Equals` próprio. O lado da API disso está em DTOs and
the API Contract.

O EF Core é o caso oposto. A documentação oficial de records diz que records não
servem como tipos de entidade, porque o EF Core depende da identidade por
referência para rastrear uma instância por entidade, e entidades imutáveis não
podem ser atualizadas do jeito usual. Use classes para entidades e records para o
que atravessa a fronteira.

## Trade-offs

- **A igualdade por valor é rasa.** Coleções dentro de um record comparam por
  referência, então records que parecem iguais podem ser diferentes:
  ```csharp
  new Person("A", 1, ["x"]) == new Person("A", 1, ["x"]);   // False
  ```
  Use coleções imutáveis com uma semântica de valor que você controla, ou
  sobrescreva o `Equals`.
- **O `with` é fácil de escrever e fácil de usar errado.** Ele compartilha estado
  mutável e copia valores em cache já velhos. Mantenha os membros do record
  imutáveis e os valores derivados calculados na leitura.
- **`init` não é imutabilidade profunda.** Um record de `List<T>` continua
  mutável através da lista.
- **Membros gerados são API pública.** Adicionar um parâmetro posicional muda o
  construtor, o `Deconstruct`, a saída do `ToString` e a igualdade, o que pode
  quebrar quem chama e quem faz parsing de log.
- **A igualdade de record class confere o tipo real primeiro.** Todo `Equals` lê
  o `EqualityContract` dos dois lados (o IL usa `callvirt`), e numa hierarquia
  dois subtipos com dados idênticos nunca são iguais. Marque como `sealed` os
  records que não devem ser estendidos, para ninguém criar um subtipo que mude a
  igualdade.
- **Não serve para entidades.** O rastreamento do EF Core precisa de identidade
  por referência; records combinam melhor com DTOs, mensagens e value objects.

## Documentation Links

- [Records, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [Create record types, tutorial, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/tutorials/records) (doc)
- [with expression, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/operators/with-expression) (doc)
- [The history of C# (records in C# 9, record structs and with on structs in C# 10), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-version-history) (doc)
- [Use immutable types and properties with System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/immutability) (doc)
