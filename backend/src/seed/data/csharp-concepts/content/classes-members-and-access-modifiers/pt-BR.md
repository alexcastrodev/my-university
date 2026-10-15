---
version: 1.0
updatedAt: 2026-10-14
title: "Classes, Membros e Modificadores de Acesso"
summary: Acessibilidade de tipos e membros, a diferença entre protected internal e private protected, InternalsVisibleTo, o modificador file e os membros herdados de System.Object.
---
## Objective

Os modificadores de acesso decidem quem pode compilar uma referência a um tipo ou
a um membro, e C# oferece mais opções que a maioria das linguagens: seis níveis
para membros, dois deles escritos com um par de palavras-chave, mais o `file`
para tipos. Os valores padrão pesam tanto quanto as palavras-chave, porque um
tipo sem modificador é `internal` e um membro sem modificador é `private`. Este
conceito cobre as regras de acessibilidade de tipos e membros, os dois
modificadores combinados (`protected internal` e `private protected`) que as
pessoas confundem, a regra surpreendente do `protected` que bloqueia o acesso por
uma referência do tipo base, o `InternalsVisibleTo` para projetos de teste, o
modificador `file` e os cinco membros que toda classe herda de `System.Object`.

## Use Cases

- Manter os tipos de implementação de uma class library como `internal`, para que
  só uma superfície pública pequena vire API que você precisa sustentar.
- Deixar um projeto de testes unitários alcançar tipos `internal` sem torná-los
  públicos.
- Escolher entre `protected internal` e `private protected` ao desenhar uma classe
  base que será estendida dentro e fora do assembly.
- Esconder um tipo auxiliar de source generator para que ele não colida com outro
  tipo de mesmo nome em outro arquivo.

## Deep Dive

### Acessibilidade de tipos

Um tipo declarado diretamente em um namespace pode ser `public` ou `internal`, e
`internal` é o padrão quando você não escreve nada. Um tipo aninhado pode usar
qualquer modificador de membro e é `private` por padrão. Usar `private` ou
`protected` em um tipo de nível superior é erro (CS1527). Interfaces e delegates
declarados em um namespace também são `internal` por padrão, mas os membros de
uma interface são `public`, porque o objetivo de uma interface é ser chamada de
fora.

A regra que mantém o sistema consistente: um membro não pode ser mais acessível
que os tipos da sua assinatura. O compilador recusa:

```csharp
internal class Helper { }

public class Exposes
{
    public Helper Make() => new Helper();   // error CS0050: return type 'Helper' is less accessible than method 'Exposes.Make()'
    public void Take(Helper h) { }          // error CS0051: parameter type 'Helper' is less accessible than method 'Exposes.Take(Helper)'
    class Nested { }                        // private por padrão
    public Nested Leak() => new Nested();   // error CS0050 de novo
}
```

Trate `internal` como ponto de partida para todo tipo e promova a `public` só
quando outro assembly realmente precisar. Um membro `public` em um tipo
`internal` é válido: a acessibilidade efetiva é a menor das duas.

### Acessibilidade de membros

Para membros de uma classe existem seis níveis, e os dois combinados são fáceis
de trocar:

| Modificador | Quem pode usar |
|---|---|
| `private` (o padrão) | só o tipo que declara |
| `protected` | o tipo que declara e tipos derivados, em qualquer assembly |
| `internal` | qualquer código do mesmo assembly |
| `protected internal` | tipos derivados **ou** código do mesmo assembly (união) |
| `private protected` | tipos derivados **e** do mesmo assembly (interseção) |
| `public` | todos |

`private` vale por tipo, não por instância: um método pode ler o campo privado de
outra instância da mesma classe. Structs aceitam só `public`, `internal` e
`private`. A diferença entre os dois combinados só aparece quando um segundo
assembly herda do seu tipo. Com estes membros em uma biblioteca:

```csharp
// Lib.dll
public class Account
{
    protected string Owner = "alice";
    internal int AuditId = 7;
    protected internal string Tag = "t";
    private protected string Secret = "s";
}
```

uma subclasse em outro assembly enxerga isto:

```csharp
// App.exe, referencia Lib
class Mine : Account
{
    public string Show(Mine m, Account other)
        => Owner + Tag + m.Owner      // ok: protected e protected internal por uma referência do tipo derivado
         + other.Owner                // error CS1540
         + Secret;                    // error CS0103: the name 'Secret' does not exist in the current context
}
```

`Secret` nem é encontrado, porque `private protected` é invisível fora do
assembly, seja ou não uma subclasse. Um `new Account().Tag` direto no App é o erro
CS0122 (inacessível), e `AuditId` dá CS1061 (para o App, o membro simplesmente não
existe).

O erro em `other.Owner` é a regra do `protected` em que muita gente tropeça. O
acesso via `protected` só é permitido por uma referência cujo tipo estático seja a
própria classe que acessa ou uma derivada dela. Um método de `Mine` pode ler
`m.Owner`, mas não `other.Owner` quando `other` é declarado como `Account`, porque
aquele objeto pode ser de outra subclasse, cujo estado protegido `Mine` não tem
por que tocar. A mesma restrição vale dentro da biblioteca quando quem acessa é
uma subclasse, e é assim que este trecho falha com CS1540 mesmo no mesmo assembly:

```csharp
public class Savings : Account
{
    public string PeekOther(Account a) => a.Owner;  // error CS1540: the qualifier must be of type 'Savings'
}
```

### Assemblies amigos com InternalsVisibleTo

O `internal` termina na fronteira do assembly, e os testes vivem em outro
assembly. O `InternalsVisibleTo` abre uma brecha só para os assemblies que você
nomear. Em um projeto no estilo SDK ele é um item do MSBuild, sem arquivo de
atributo para manter:

```xml
<ItemGroup>
  <InternalsVisibleTo Include="Lib.Tests" />
</ItemGroup>
```

Com esse item no Lib.csproj nomeando o projeto App, `new Account().AuditId`
(`internal`) e `Helper.Hi()` (um tipo `internal`) compilam no App e imprimem `7` e
`hi`. O amigo conta como "o mesmo assembly" para a metade `internal` de todo
modificador combinado, então uma subclasse no amigo consegue usar até um membro
`private protected`, enquanto `private` simples continua fechado. Assemblies com
nome forte precisam citar o amigo com a chave pública.

### O modificador file

O `file` (C# 11) restringe um tipo de nível superior ao arquivo de código que o
declara. Ele não combina com outro modificador de acesso e vale só para tipos. Dois
arquivos podem declarar cada um um `file class Gen`, e os dois não colidem:

```csharp
// FileA.cs
file class Gen { public static string Who() => "A"; }
public static class UseA { public static string Run() => Gen.Who(); }

// FileB.cs
file class Gen { public static string Who() => "B"; }
public static class UseB { public static string Run() => Gen.Who(); }

// em outro lugar: UseA.Run() + UseB.Run() imprime "AB", e escrever Gen.Who()
// falha com error CS0103: The name 'Gen' does not exist in the current context
```

O recurso nasceu para source generators que emitem tipos auxiliares ao lado do
código do usuário sem se preocupar com colisão de nomes. Em código de aplicação
raramente é necessário.

### Acessibilidade é uma cerca de compilação

A acessibilidade é imposta pelo compilador, não pelo runtime. A reflection a
ignora, e é assim que serializadores e containers de DI alcançam construtores
privados:

```csharp
var field = typeof(Account).GetField("_balance",
    BindingFlags.NonPublic | BindingFlags.Instance);
Console.WriteLine(field?.GetValue(account));   // 0, um campo privado lido de fora
```

Use os modificadores para comunicar a intenção do design e pegar erros em tempo de
build. Não os use como fronteira de segurança.

### O que toda classe herda de System.Object

Toda classe deriva de `System.Object`, direta ou indiretamente, e os structs
também (via `System.ValueType`). Interfaces não têm tipo base. Cinco membros de
instância e um auxiliar estático definem o comportamento básico (existe ainda o
gancho `protected` do finalizador, `Finalize`, que você nunca chama diretamente):

- `ToString()` devolve o nome completo do tipo por padrão. Sobrescreva para logs e
  saída de depuração.
- `Equals(object)` e `GetHashCode()` usam, por padrão, identidade de referência em
  classes. Devem ser sobrescritos juntos, como mostra o conceito sobre dictionary
  e equality.
- `GetType()` devolve o `Type` em tempo de execução e não pode ser sobrescrito.
- `MemberwiseClone()` é `protected`, então só o próprio tipo (ou uma subclasse)
  pode chamá-lo. Ele copia os campos do objeto bit a bit.
- `ReferenceEquals(a, b)` é estático e sempre compara identidade.

```csharp
class Point
{
    public int X;
    public List<int> Y = [];
    public Point Clone() => (Point)MemberwiseClone();
}

var a = new Point { X = 1, Y = [1] };
var b = a.Clone();
Console.WriteLine(a);                          // Point
Console.WriteLine(a.Equals(b));                // False, instâncias diferentes
Console.WriteLine(ReferenceEquals(a.Y, b.Y));  // True, o clone é raso
```

A cópia rasa é o ponto que morde: o clone e o original compartilham a mesma
`List<int>`, então adicionar em um altera o outro. Se você precisa de cópia
profunda, escreva a cópia explicitamente, como o conceito de Java nos links
relacionados também alerta sobre o `clone()`.

## Trade-offs

- **`internal` por padrão encolhe a API, mas os testes passam a precisar de uma
  brecha.** A superfície pública menor é uma promessa que você não precisa
  cumprir, e o preço é adicionar `InternalsVisibleTo` para o projeto de testes.
  ```xml
  <InternalsVisibleTo Include="Orders.Core.Tests" />
  ```
- **`InternalsVisibleTo` acopla assemblies.** Um assembly amigo pode chamar
  qualquer coisa `internal`, então refatorar esse código passa a quebrar o amigo.
  Mantenha a lista restrita a projetos de teste.
- **`protected` expõe mais do que parece.** Todo membro protegido faz parte do
  contrato com cada subclasse, em cada assembly, para sempre. Um campo `protected
  internal` é amplamente visível. Na dúvida, prefira `private protected` ou
  `internal` para membros destinados só à sua própria hierarquia.
- **`public` em um campo tira a sua liberdade de mudá-lo depois.** Trocar um campo
  público por uma propriedade quebra a compatibilidade binária para consumidores
  já compilados, mesmo que o código C# pareça igual. Exponha uma propriedade desde
  o início (veja o conceito de propriedades).
- **Reflection e serialização atravessam os modificadores de acesso.** Deixar um
  setter `private` não impede que um serializador o chame. A validação que importa
  precisa viver nos caminhos de código por onde todo escritor passa.

## Documentation Links

- [Access modifiers, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/access-modifiers) (doc)
- [file keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/file) (doc)
- [protected keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/protected) (doc)
- [private protected keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/private-protected) (doc)
- [Friend assemblies, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/assembly/friend) (doc)
- [Object class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.object) (doc)
- [Compiler Error CS1540, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/compiler-messages/cs1540) (doc)
