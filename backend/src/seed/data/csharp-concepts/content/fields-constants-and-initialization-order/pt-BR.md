---
version: 1.0
updatedAt: 2026-10-15
title: "Campos, Constantes e Ordem de Inicialização"
summary: A ordem exata de inicialização de instância e estática com saída real, a chamada virtual no construtor, const contra static readonly entre assemblies, beforefieldinit e required com SetsRequiredMembers.
---
## Objective

Um campo é o único lugar onde um objeto realmente guarda estado, e C# oferece
quatro formas de "ser definido": um `const` gravado dentro do código compilado de
quem o usa, um `static readonly` definido uma vez por tipo, um `readonly` definido
uma vez por objeto e um membro `required` que o chamador é obrigado a preencher. A
ordem em que essas coisas rodam (inicializadores de campo, construtor base, corpo
do construtor) não é óbvia e difere do Java em um ponto importante. Este conceito
percorre a ordem exata de inicialização de instância e estática com saída real, a
armadilha da chamada virtual no construtor, por que um `const` pode ficar velho
entre assemblies, o que o `beforefieldinit` muda na inicialização estática e como
`required` e `SetsRequiredMembers` se encaixam.

## Use Cases

- Depurar uma `NullReferenceException` ou um objeto meio inicializado visto por um
  método sobrescrito chamado pelo construtor da classe base.
- Decidir entre `const` e `static readonly` para um valor publicado por uma class
  library.
- Garantir que uma configuração única (uma tabela de consulta, um registro) rode
  exatamente uma vez e em um momento previsível.
- Obrigar o chamador a fornecer dados mandatórios sem um construtor de dez
  parâmetros.

## Deep Dive

### Ordem de inicialização de instância

Criar um objeto executa, nesta ordem: os inicializadores de campo da classe mais
derivada, depois os inicializadores de cada classe base subindo a hierarquia, e
por fim os corpos dos construtores descendo, a base primeiro. O trace abaixo mostra
construtores e inicializadores:

```csharp
class Base
{
    private readonly string _baseField = Log("Base field initializer");
    public Base() { Log("Base constructor body"); Describe(); }
    protected virtual void Describe() => Log("Base.Describe");
    protected static string Log(string m) { Console.WriteLine(m); return m; }
}

class Derived : Base
{
    private string _name = Log("Derived field initializer (_name)");
    private string? _late;

    public Derived() : this(0) => Log("Derived() body");
    public Derived(int n) { Log("Derived(int) body"); _late = "set in ctor"; }

    protected override void Describe()
        => Log($"Derived.Describe: _name='{_name}', _late={(_late is null ? "null" : _late)}");
}

var d = new Derived();
```

```
Derived field initializer (_name)
Base field initializer
Base constructor body
Derived.Describe: _name='Derived field initializer (_name)', _late=null
Derived(int) body
Derived() body
```

Três coisas chamam atenção. Primeiro, os inicializadores de campo da classe
derivada rodam antes do construtor da base, então C# difere do Java, onde os
inicializadores da subclasse rodam depois que o `super(...)` retorna. Segundo, a
chamada `Describe()` no construtor da base é despachada para o **override**, que
executa enquanto o corpo do construtor derivado ainda não começou: `_name` já está
definido (o inicializador rodou) mas `_late` ainda é `null`, embora o campo seja
atribuído em todos os construtores. Terceiro, com o encadeamento `this(...)`, os
inicializadores de campo rodam uma vez, no construtor que não encadeia, e os
corpos rodam depois, do mais interno para o mais externo.

Chamar um membro virtual em um construtor é permitido e quase sempre é bug. Se a
classe base precisa de um gancho depois da construção, use um método de fábrica ou
uma chamada explícita a `Initialize()`, e mantenha os construtores sem chamadas
virtuais (o analisador CA2214 avisa).

### Campos de instância: valores padrão e readonly

Todo campo tem um valor padrão (`0`, `false`, `null`) antes de qualquer código
rodar, e um inicializador ou uma atribuição em construtor o substitui. Um
inicializador de campo não pode usar `this`, então não consegue ler outro membro de
instância (erro CS0236).

`readonly` permite atribuição apenas em um inicializador de campo ou em um
construtor do mesmo tipo; em qualquer outro lugar é o erro CS0191. A garantia é
rasa: uma `readonly List<int>` não pode apontar para outra lista, mas o conteúdo
pode mudar.

### const contra static readonly

`const` é uma constante de compilação limitada a primitivos, `string`, enums e
`null` (`const decimal` funciona, `const DateTime` é o erro CS0283). O compilador
copia o valor para todo lugar que o usa. Esse é o problema quando a constante vem
de outro assembly:

```csharp
// Lib: public const int MaxConst = 10;  public static readonly int MaxReadonly = 10;
// O App imprime os dois:         const=10 static readonly=10

// Mude os dois para 20, recompile só a Lib, copie a nova Lib.dll para junto do App.dll antigo:
// const=10 static readonly=20
```

O `App` ainda imprime o `const` antigo porque o `10` foi compilado no IL dele. Um
`static readonly` é lido do campo em tempo de execução, então acompanha a
atualização da biblioteca. Use `const` para valores que nunca mudam (`Math.PI`,
dias da semana) e `static readonly` para o que uma versão futura pode alterar,
como um limite ou um timeout padrão.

### Inicialização estática e beforefieldinit

Os inicializadores de campo estático rodam uma vez por tipo, na ordem textual, e
depois o corpo do construtor estático. Se isso acontece "exatamente no primeiro
uso" ou "algum momento antes do primeiro uso" depende de a classe declarar ou não
um construtor estático. Sem ele, o compilador marca o tipo como `beforefieldinit`,
o que permite ao runtime rodar os inicializadores antes ou de forma preguiçosa; com
um construtor estático explícito o tipo não é marcado, e a inicialização acontece
exatamente antes do primeiro acesso a um membro estático ou da primeira criação de
instância.

```csharp
using System.Reflection;

class WithStaticCtor
{
    public static readonly int Value = Log.Value("WithStaticCtor field initializer");
    static WithStaticCtor() => Console.WriteLine("  [init] WithStaticCtor static constructor");
}
class WithInitializer
{
    public static readonly int Value = Log.Value("WithInitializer field initializer");
}

typeof(WithInitializer).Attributes.HasFlag(TypeAttributes.BeforeFieldInit); // True
typeof(WithStaticCtor).Attributes.HasFlag(TypeAttributes.BeforeFieldInit);  // False

Console.WriteLine(WithStaticCtor.Value);
//   [init] WithStaticCtor field initializer
//   [init] WithStaticCtor static constructor
// 1
```

Nesta execução o tipo preguiçoso também inicializou no primeiro acesso, mas só o
tipo preciso tem essa garantia. Se a ordem dos efeitos colaterais importa, adicione
um construtor estático vazio ou, melhor, evite efeitos colaterais em inicializadores
estáticos.

Mais dois fatos sobre estáticos. Cada tipo genérico fechado tem seus próprios
estáticos: `Counter<int>.Next()` duas vezes e depois `Counter<string>.Next()`
imprime `1 2 1`. E um inicializador de tipo que lança exceção deixa o tipo
inutilizável: o primeiro acesso lança `TypeInitializationException` envolvendo a
exceção real, e todo acesso seguinte também, porque o runtime não tenta de novo.

### Membros required e SetsRequiredMembers

`required` (C# 11) faz o compilador obrigar todo inicializador de objeto a definir
o membro:

```csharp
class Person
{
    public required string Name { get; init; }
    public required int Born { get; init; }
    public Person() { }

    [SetsRequiredMembers]
    public Person(string name, int born) { Name = name; Born = born; }
}

var a = new Person { Name = "Ana", Born = 1990 };   // ok
var b = new Person("Bia", 1985);                    // ok: o atributo garante pelo construtor
var c = new Person { Name = "Cris" };
// error CS9035: Required member 'Person.Born' must be set in the object initializer or attribute constructor.
```

`required` também vale para campos e é herdado: uma subclasse que adiciona o
próprio membro `required` cria um tipo cujos inicializadores precisam definir
também os membros da base. O `[SetsRequiredMembers]` desliga a checagem para aquele
construtor, ou seja, o compilador confia em você: nada verifica se o construtor
realmente atribui os membros. Reflection, desserializadores e
`Activator.CreateInstance` não passam pela checagem, porque ela existe só no ponto
de chamada.

## Trade-offs

- **`const` é o mais rápido e o mais fácil de ficar velho.** A substituição
  elimina uma leitura de campo e também a possibilidade de corrigir o valor
  entregando só a biblioteca. Constantes públicas são um compromisso de versão.
  ```csharp
  public const int MaxRetries = 3;                  // consumidores mantêm 3 até recompilar
  public static readonly int MaxRetries = 3;        // consumidores veem o novo valor
  ```
- **Inicializadores são concisos e invisíveis.** Um inicializador de campo roda
  antes do construtor da base, então não pode usar parâmetros do construtor. O que
  depende de argumentos pertence ao corpo do construtor.
- **Chamadas virtuais em construtores veem um objeto parcialmente construído.**
  Campos derivados com inicializador estão prontos, os definidos no corpo do
  construtor não estão. Marque a classe como `sealed`, evite a chamada ou mova o trabalho para uma
  fábrica.
- **Um construtor estático dá previsibilidade de tempo e cobra uma checagem.** O
  tipo perde o `beforefieldinit`, então o JIT pode emitir uma checagem barata de
  inicialização a cada acesso estático em código compilado antes de o tipo
  inicializar. Raramente é mensurável, mas não é grátis em laços apertados.
- **Um inicializador estático que falha é permanente.** Uma leitura de arquivo de
  configuração que falhou em um campo estático desabilita o tipo pelo resto da vida
  do processo. Prefira `Lazy<T>` criado com `LazyThreadSafetyMode.PublicationOnly`
  para trabalho que pode falhar, já que esse modo não guarda a exceção em cache.
- **`required` move a checagem só para o ponto de chamada.** Ele não protege contra
  desserializadores nem reflection, e `[SetsRequiredMembers]` é uma promessa sem
  verificação. Use para ergonomia de construção, não como garantia de validação.

## Lab

Neste lab você recebe `Models.cs` com pequenos tipos que **já compilam**, cada um expondo uma regra de inicialização, mais testes xUnit prontos que falham até você aplicar a regra. O seu trabalho é editar esses tipos. A ideia central é observar a ordem exata em que o C# inicializa um objeto e escolher o tipo certo de campo (`const`, `static readonly`, `required`) para cada função. Alguns testes usam reflection para inspecionar a forma compilada do tipo, porque a regra é uma propriedade da IL, não da saída em tempo de execução.

**O cenário**

Cinco tipos pequenos, um por regra.

- `Base` e `Derived`: o construtor de `Base` chama um método virtual, e `Derived` tem um campo com inicializador (`_name`) e outro só atribuído no corpo do construtor (`_late`).
- `Limits`: duas constantes de configuração, `MaxRetries` e `Timeout`, hoje ambas `static` mutáveis.
- `Precise` e `Relaxed`: dois tipos com um `static readonly`, um sem construtor estático (já marcado `beforefieldinit`) e outro que você ajusta.
- `Person`: `Name` e `Born` com `init`, um construtor vazio e outro que atribui tudo.

Repare que não há `NotImplementedException` aqui: o código roda, mas os testes ficam vermelhos até você fazer cada TODO.

**O que você vai fazer, passo a passo**

1. **Chamada virtual no construtor (TODO-00).** Em `Base`, chame `Describe()` no construtor e guarde o resultado em `SeenByBase`. Em `Derived`, faça o override para devolver `$"name={_name};late={_late ?? "null"}"`. O inicializador de campo roda **antes** do construtor base, mas a atribuição do corpo roda **depois**, e é isso que o teste mostra: `name=initialized;late=null`.
2. **`const` contra `static readonly` (TODO-01).** Em `Limits`, torne `MaxRetries` uma `const`, porque nunca muda. Torne `Timeout` `static readonly`: uma `const` seria copiada para dentro de cada chamador compilado e não refletiria uma troca de versão da biblioteca.
3. **Perder o `beforefieldinit` (TODO-02).** Em `Precise`, adicione um construtor estático vazio. O compilador deixa então de marcar o tipo como `beforefieldinit`, o que muda quando a inicialização estática roda. `Relaxed` fica de comparação.
4. **Membros `required` (TODO-03).** Em `Person`, marque `Name` e `Born` como `required`, para que os inicializadores de objeto sejam obrigados a atribuí-los. O construtor `(name, born)` atribui tudo, então coloque `[SetsRequiredMembers]` nele para o compilador aceitar `new Person("Bia", 1985)`.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que `_late` aparece como `null` para `Base`, e por que uma `const` pública em uma biblioteca é uma decisão de compatibilidade e não só de estilo.

**Desafios opcionais**

- **TODO-04:** em `Counter<T>`, guarde a contagem num campo estático do próprio tipo genérico, de modo que `Counter<int>.Next()`, `Counter<int>.Next()` e `Counter<string>.Next()` devolvam 1, 2, 1. Hoje ele usa o campo compartilhado de `Shared`. Não há teste para este desafio, então confira você mesmo.
- **TODO-05:** em `Settings`, encadeie os construtores com `this(...)`: `()` usa `"localhost"` e 5432, `(host)` usa 5432, e só o `(host, port)` atribui as propriedades e valida (host em branco lança `ArgumentException`, porta menor ou igual a 0 lança `ArgumentOutOfRangeException`). Também sem teste.

**Pré-requisitos:** classes, construtores e herança em C#, `const`, `readonly` e `static`, e o .NET 10 SDK (C# 14).

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os testes vermelhos indicam quais regras ainda não foram aplicadas, e os comentários `TODO-NN` em `Models.cs` explicam o que mudar em cada tipo.

## Documentation Links

- [Instance constructors, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/instance-constructors) (doc)
- [Static constructors, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/static-constructors) (doc)
- [Constants, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/constants) (doc)
- [readonly keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/readonly) (doc)
- [required modifier, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/required) (doc)
- [SetsRequiredMembersAttribute, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.codeanalysis.setsrequiredmembersattribute) (doc)
- [TypeInitializationException, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.typeinitializationexception) (doc)
