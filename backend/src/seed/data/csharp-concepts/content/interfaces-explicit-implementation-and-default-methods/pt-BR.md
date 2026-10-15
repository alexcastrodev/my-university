---
version: 1.0
updatedAt: 2026-10-15
title: "Interfaces: implementação explícita e métodos padrão"
summary: Implementação implícita versus explícita e quando a explícita é obrigatória, default interface methods (C# 8) e o diamante, membros static abstract e static virtual (C# 11) como introdução, e o trio IComparable, IComparer e IEquatable.
---
## Objective

Uma interface é um contrato: um tipo que a implementa promete ter certos
membros, e o código que depende da interface funciona com qualquer um desses
tipos, sejam classes ou structs. As interfaces do C# moderno carregam mais do
que assinaturas. Elas podem esconder um membro atrás de implementação
explícita, trazer um corpo padrão (C# 8) e exigir membros estáticos, como
factories e operadores (C# 11). Este conceito cobre implementação implícita
versus explícita e quando a explícita é a única opção, default interface methods
e o diamante que eles podem criar, membros `static abstract` e `static virtual`
em nível introdutório, e o trio de comparação que todo tipo de dados encontra
cedo ou tarde: `IComparable<T>`, `IComparer<T>` e `IEquatable<T>`. A escolha
entre interface e classe abstrata está no conceito de herança.

## Use Cases

- Uma classe que é ao mesmo tempo writer e conexão, em que `Close` significa uma
  coisa diferente para cada papel.
- Implementar `IEnumerable<T>` sem expor no contrato público o `GetEnumerator`
  não genérico e fracamente tipado.
- Adicionar um método de conveniência a uma interface já publicada sem quebrar
  todas as implementações existentes.
- Um `ParseAll<T>` genérico que precisa chamar `T.Parse` no próprio tipo, não
  numa instância.
- Tornar um value type ordenável com `Array.Sort` e utilizável como chave de
  `HashSet` sem surpresas.

## Deep Dive

### Implementação implícita e explícita

Um membro público com a assinatura certa implementa o membro da interface de
forma implícita, e quem chama alcança esse membro pela classe ou pela
interface. Uma implementação explícita nomeia a interface e só é alcançável por
uma referência do tipo da interface:

```csharp
var file = new LogFile();
((IWriter)file).Close();     // flush buffer
((IConnection)file).Close(); // drop socket
// file.Close();             // error CS1061: 'LogFile' does not contain a definition for 'Close'

interface IWriter { void Close(); }
interface IConnection { void Close(); }

sealed class LogFile : IWriter, IConnection
{
    void IWriter.Close() => Console.WriteLine("flush buffer");
    void IConnection.Close() => Console.WriteLine("drop socket");
}
```

A implementação explícita é obrigatória quando duas interfaces declaram a mesma
assinatura com significados diferentes, ou quando dois membros diferem só no
tipo de retorno, que é exatamente o caso de `IEnumerable<T>`: o
`GetEnumerator()` genérico e o não genérico não recebem parâmetros e retornam
tipos diferentes. O padrão comum é implementar o genérico como público e
encaminhar o antigo de forma explícita:

```csharp
sealed class Names(string[] items) : IEnumerable<string>
{
    public IEnumerator<string> GetEnumerator() => ((IEnumerable<string>)items).GetEnumerator();
    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() => GetEnumerator();
}
```

Também é um jeito de manter um membro fora da API pública quando ele só faz
sentido para código que já trata o objeto como a interface. Membros explícitos
não aceitam modificador de acesso nem podem ser `virtual`; uma subclasse que
precise mudá-los reimplementa a interface.

### Default interface methods (C# 8)

Um membro de interface pode ter corpo. Classes que não implementam o membro
ficam com o padrão; classes que implementam substituem:

```csharp
ILogger log = new Plain();
log.Info("started");                  // INFO started
ILogger custom = new Prefixed();
custom.Info("started");               // [info] STARTED

interface ILogger
{
    void Write(string level, string message);
    void Info(string message) => Write("INFO", message); // adicionado na v2
}
class Plain : ILogger
{
    public void Write(string level, string message) => Console.WriteLine($"{level} {message}");
}
class Prefixed : ILogger
{
    public void Write(string level, string message) => Console.WriteLine($"[{level}] {message}");
    public void Info(string message) => Write("info", message.ToUpperInvariant());
}
```

Três coisas surpreendem. Primeiro, o padrão não é herdado como membro da classe:
`new Plain().Info("x")` falha com CS1061, então a chamada tem que passar pela
interface. Segundo, corpos padrão dependem de suporte do runtime que chegou no
.NET Core 3.0, e por isso o .NET Framework não pode usá-los. Terceiro, a
motivação principal é versionamento: as Framework Design Guidelines ainda dizem
para não adicionar membros a uma interface publicada, e é o corpo padrão que
torna essa adição segura para quem já implementa.

Interfaces continuam sem estado de instância. Uma propriedade declarada numa
interface sem corpo é abstrata, não uma auto-property, porque não há campo onde
guardar o valor.

### O diamante

Se duas interfaces derivadas da mesma base fornecem corpo para o mesmo membro,
uma classe que implementa as duas fica sem resposta única, e o compilador
recusa:

```csharp
interface IShape { string Name() => "shape"; }
interface IRounded : IShape { string IShape.Name() => "rounded"; }
interface IFramed : IShape { string IShape.Name() => "framed"; }

class Square : IRounded, IFramed { }
// error CS8705: Interface member 'IShape.Name()' does not have a most specific implementation.
// Neither 'IRounded.IShape.Name()', nor 'IFramed.IShape.Name()' are most specific.
```

A correção é implementar o membro na classe, que é sempre a mais específica.
Diferente da herança múltipla de classes do C++, não há estado que possa ser
duplicado, só uma ambiguidade sobre qual corpo executar, e o C# transforma isso
em erro de compilação em vez de uma regra que você precisa decorar.

### Membros `static abstract` e `static virtual` (C# 11)

Uma interface pode exigir um membro estático. O tipo que implementa fornece o
membro, e o código genérico o chama pelo parâmetro de tipo:

```csharp
using System.Globalization;

Console.WriteLine(ParseAll<Celsius>(["21", "30"]).Sum(c => c.Value)); // 51
Console.WriteLine(Describe<Celsius>());                              // unit=C

static List<T> ParseAll<T>(string[] raw) where T : IParseableUnit<T>
    => raw.Select(T.Parse).ToList();
static string Describe<T>() where T : IParseableUnit<T> => $"unit={T.Unit}";

interface IParseableUnit<TSelf> where TSelf : IParseableUnit<TSelf>
{
    static abstract TSelf Parse(string text);
    static virtual string Unit => "?";   // tem um padrão
}
readonly record struct Celsius(double Value) : IParseableUnit<Celsius>
{
    public static Celsius Parse(string text) => new(double.Parse(text, CultureInfo.InvariantCulture));
    public static string Unit => "C";
}
```

A restrição `TSelf : IParseableUnit<TSelf>` é o padrão autorreferente que a BCL
usa em todo lugar (`IParsable<TSelf>`, `INumber<TSelf>`). A referência oficial
reforça que essas chamadas não têm despacho em runtime como os métodos virtuais
de instância: elas são resolvidas pelo tipo que o código genérico recebeu, não
pelo tipo em runtime de um objeto. É esse recurso que torna generic math
possível, assunto que tem conceito próprio.

### `IComparable<T>`, `IComparer<T>` e `IEquatable<T>`

`IComparable<T>` dá a um tipo sua ordem natural. `IComparer<T>` é uma ordem
definida fora do tipo, então o mesmo tipo pode ser ordenado de várias formas.
`IEquatable<T>` dá um `Equals` fortemente tipado:

```csharp
SemVer[] versions = [new(2, 0), new(1, 10), new(1, 2)];
Array.Sort(versions);                                          // 1.2, 1.10, 2.0
Array.Sort(versions, Comparer<SemVer>.Create((a, b) => a.Minor.CompareTo(b.Minor)));
                                                               // 2.0, 1.2, 1.10
var set = new HashSet<SemVer> { new(1, 2), new(1, 2) };       // Count: 1

readonly struct SemVer(int major, int minor) : IComparable<SemVer>, IEquatable<SemVer>
{
    public int Major => major;
    public int Minor => minor;
    public int CompareTo(SemVer other) =>
        Major != other.Major ? Major.CompareTo(other.Major) : Minor.CompareTo(other.Minor);
    public bool Equals(SemVer other) => Major == other.Major && Minor == other.Minor;
    public override bool Equals(object? obj) => obj is SemVer v && Equals(v);
    public override int GetHashCode() => HashCode.Combine(Major, Minor);
    public override string ToString() => $"{Major}.{Minor}";
}
```

O `EqualityComparer<T>.Default`, usado por `HashSet<T>` e
`Dictionary<TKey,TValue>`, verifica se `T` implementa `IEquatable<T>` e, se
implementa, usa essa implementação (para essa struct ele retornou um
`GenericEqualityComparer<SemVer>`); senão cai em `object.Equals`. Implementar
`IEquatable<T>` obriga, portanto, a sobrescrever `Equals(object)` e
`GetHashCode` de forma coerente, ou coleções diferentes vão discordar.

## Trade-offs

- **Implementação explícita esconde membros dos seus próprios usuários.** Ela é
  certa para conflito de nomes e membros legados, mas um membro de que as
  pessoas precisam não deveria exigir um cast para ser encontrado.
  ```csharp
  ((IConnection)file).Close(); // ok para um conflito raro, chato numa chamada diária
  ```
- **Default methods versionam interfaces, não substituem classes base.** Sem
  estado, sem construtores, e quem chama precisa segurar o tipo da interface
  para ver o padrão. Mantenha os padrões pequenos e escritos em termos dos
  membros abstratos.
- **Adicionar um corpo padrão ainda pode mudar comportamento.** Uma classe
  existente que por acaso tinha um método público com a mesma assinatura vira,
  em silêncio, a implementação.
  ```csharp
  class Old : ILogger
  {
      public void Write(string level, string message) { }
      public void Info(string message) { } // método antigo, sem relação: agora é ILogger.Info
  }
  ```
- **`static abstract` limita como a interface é usada.** Ela vira uma restrição
  para código genérico, não um tipo polimórfico para passar adiante, e traz o
  padrão genérico autorreferente, que é mais difícil de ler.
- **`IComparable<T>` fixa uma ordem para todo mundo.** Se não existe ordem
  natural óbvia, não implemente; passe um `IComparer<T>` onde ordenar.
- **`Array.Sort` não é estável.** A documentação diz que elementos que comparam
  como iguais podem sair em qualquer ordem, o que importa assim que um comparer
  customizado olha só parte do valor. Use `OrderBy` (estável) quando a ordem
  original dos empates importar.
  ```csharp
  var sorted = versions.OrderBy(v => v.Minor).ToArray(); // empates mantêm a ordem de entrada
  ```

## Documentation Links

- [interface keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/interface) (doc)
- [Explicit interface implementation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/interfaces/explicit-interface-implementation) (doc)
- [Tutorial: Update interfaces with default interface methods, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interface-implementation/default-interface-methods-versions) (doc)
- [Tutorial: Explore static virtual members in interfaces, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interface-implementation/static-virtual-interface-members) (doc)
- [Interface design, Framework Design Guidelines, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/interface) (doc)
- [EqualityComparer<T>.Default, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.equalitycomparer-1.default) (doc)
- [IComparable<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.icomparable-1) (doc)
- [IComparer<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.collections.generic.icomparer-1) (doc)
- [IEquatable<T> interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.iequatable-1) (doc)
