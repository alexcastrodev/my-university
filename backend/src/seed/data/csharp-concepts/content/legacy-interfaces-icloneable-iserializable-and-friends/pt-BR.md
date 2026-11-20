---
version: 1.0
updatedAt: 2026-11-20
title: "Interfaces Legadas: ICloneable, ISerializable e Companhia"
summary: ICloneable e a cópia rasa, ISerializable, [Serializable] e BinaryFormatter hoje, o que Exception ainda serializa, quais hooks cada serializador respeita, ArrayList e Hashtable contra os genéricos, IAsyncResult e o padrão APM, com a nota "livro versus hoje" medida no .NET 10.
---
## Objective

Os livros de C# 1 e 2, e o antigo exame de certificação, ensinavam um conjunto
de interfaces como "o jeito certo": `ICloneable` para copiar, `ISerializable`
com `[Serializable]` para salvar objetos, `ArrayList` e `Hashtable` para
coleções, `IAsyncResult` com `Begin/End` para async. Você ainda as encontra em
código legado e na própria BCL, mas quase nenhuma pertence a código novo. Este
conceito mede o que cada uma faz no .NET 10 (a armadilha da cópia rasa por trás
do `ICloneable`, o que `Exception` ainda serializa, qual serializador respeita
qual hook, o que dizem os diagnósticos de obsolescência, quanto custa o boxing)
e dá o substituto de cada uma. O `BinaryFormatter` tem conceito próprio, ligado
abaixo.

Versões: .NET SDK 10.0.100, runtime 10.0.0, TFM `net10.0`, nenhum pacote NuGet,
macOS arm64 (Apple M4 Max). Os tempos são o melhor de 7 execuções e servem só
como indicação.

## Use Cases

- Manter um código que chama `.Clone()`, `ArrayList` ou `BeginRead`, ou revisar um pull request que adiciona `ICloneable` ou `[Serializable]`.

## Deep Dive

### ICloneable: um contrato que não promete nada

`ICloneable` tem um único membro, `object Clone()`. A página do Learn diz que ele
"não especifica se a operação de clonagem faz cópia profunda, rasa ou algo no
meio", e por isso recomenda não implementar `ICloneable` em APIs públicas. Quem
chama não sabe o que recebe e precisa converter um `object`. A implementação
usual é `MemberwiseClone`, que copia todo campo de instância (privado e
`readonly` inclusive) sem executar construtor:

```csharp
class Basket(string owner, List<string> items) : ICloneable
{
    public string Owner { get; set; } = owner;
    public List<string> Items { get; } = items;
    public object Clone() => MemberwiseClone();
}
var c = (Basket)a.Clone(); c.Items.Add("eggs"); c.Owner = "Bob";
// original=Ana/[milk,eggs] clone=Bob/[milk,eggs] sharedList=True
```

Os campos de valor foram copiados, o campo de referência aponta para a mesma
lista, então a "cópia" alterou o original. O construtor não rodou de novo e um
campo `readonly` privado foi copiado (`s3`), como esperado de `MemberwiseClone`.

### O que escrever no lugar

- **Um construtor de cópia** diz exatamente até onde vai a cópia e devolve o tipo
  real: `public Basket(Basket o) { Owner = o.Owner; Items = [.. o.Items]; }`
  deu `original=[milk] copy=[milk,eggs] shared=False`.
- **Um `with` de record** também é cópia rasa: `r1 with { Owner = "Bob" }` deixou
  `shared=True` para a lista. Records e `with` estão em
  [Records e with-expressions](/csharp-concepts/records-and-with-expressions),
  que também mostra a correção com construtor de cópia.

`ICloneable` sobrevive na BCL, então você vai chamá-lo. Nos assemblies carregados,
31 tipos públicos concretos que não são delegates o implementam: `String`,
`ArrayList`, `Hashtable`, `BitArray`, `CultureInfo`, os calendários, as classes
`Encoding`, `Version`, `AssemblyName`. `List<T>` e `Dictionary<,>` não. Dois casos
merecem atenção: `Array.Clone()` é raso (um `List<int>[]` clonado compartilha as
listas dos elementos, com um objeto de array novo) e `string.Clone()` devolve a
mesma referência (`ReferenceEquals` deu `True`).

### [Serializable], ISerializable e o construtor de serialização

O modelo antigo: marcar a classe com `[Serializable]`, excluir campos com
`[NonSerialized]` e, para ter controle, implementar `ISerializable`:
`GetObjectData` escreve pares nome/valor num `SerializationInfo` e um construtor
`(SerializationInfo, StreamingContext)` os lê de volta. A página do Learn diz que
o construtor "deve ser protected se a classe não for sealed". Um tipo escrito à
mão, acionado chamando os métodos diretamente (sem formatter):

```csharp
[Serializable]
class CustomSer : ISerializable
{
    public string Name; public int Level; [NonSerialized] public string Hidden;
    protected CustomSer(SerializationInfo i, StreamingContext c) { Name = i.GetString("n")!; Level = i.GetInt32("l"); Hidden = "(default)"; }
    public void GetObjectData(SerializationInfo i, StreamingContext c) { i.AddValue("n", Name); i.AddValue("l", Level); }
}
// keys: n=x, l=7  ->  rebuilt: x/7/(default)
```

O atributo ainda vale como metadado (`typeof(Person).IsSerializable` deu `True`
com ele e `False` sem), mas as peças que o acionavam estão obsoletas. O
SYSLIB0050 (desde o .NET 8) cobre `FormatterConverter`, `StreamingContextStates`,
`IFormatterConverter`, `FormatterServices` e `Type.IsSerializable`; toda linha do
teste acima que tocava nelas gerou aviso. O SYSLIB0051 (desde o .NET 8) cobre os
construtores públicos ou protegidos `.ctor(SerializationInfo, StreamingContext)`
e as implementações implícitas de `GetObjectData`, como a de `Exception`.
Implementar `ISerializable` num tipo seu não gerou aviso do compilador; com
`AnalysisMode` em `All`, só o `CA2237` disparou, por faltar `[Serializable]`.

### Onde o ISerializable ainda aparece: Exception

240 tipos públicos nos assemblies carregados implementam `ISerializable`, 113 deles
exceções e 82 delegates; entre os outros estão `Dictionary<,>`, `HashSet<>`,
`StringBuilder`, `DateTime` e `FileInfo`. Chamar `GetObjectData` numa
`InvalidOperationException("boom", inner)` lançada mostrou o que uma exceção
serializa:

```text
ClassName, Message, Data, InnerException, HelpURL, StackTraceString,
RemoteStackTraceString, RemoteStackIndex, ExceptionMethod, HResult, Source, WatsonBuckets
```

São doze entradas, incluindo o texto do stack trace e o nome do assembly em
`Source`. Reflection na `InvalidOperationException` listou os três construtores
públicos e `protected (SerializationInfo, StreamingContext) [Obsolete SYSLIB0051]`.
Derivar de `Exception` e escrever o construtor de serialização clássico
`: base(info, ctx)` compilou com `warning SYSLIB0051` na chamada ao base. O
conselho da página do SYSLIB0051 é perguntar se a exceção precisa mesmo ser
serializável: a serialização de exceções é "voltada principalmente a dar suporte
a remoting", abandonado no .NET Core 1.0, então a página manda remover
`[Serializable]`, o construtor de serialização e o override de `GetObjectData`
(uma biblioteca presa a compatibilidade de API pode, em vez disso, marcar os seus
como obsoletos com SYSLIB0051). Para exceções novas, escreva os três construtores
comuns (veja [Exceções](/csharp-concepts/exceptions-try-catch-filters-and-finally)).

### Qual serializador respeita qual hook

`[NonSerialized]`, `[OnDeserialized]` e `IDeserializationCallback` pertencem ao
modelo antigo, e os serializadores modernos discordam sobre eles. A mesma classe
`[Serializable]` com um campo `[NonSerialized]`, um método `[OnDeserialized]` e um
`IDeserializationCallback`:

```text
System.Text.Json:       {"Name":"Ana","Age":3}
DataContractSerializer: <Person ...><Callback>false</Callback><Hooked>false</Hooked>
  <_x003C_Age_x003E_k__BackingField>3</_x003C_Age_x003E_k__BackingField>
  <_x003C_Name_x003E_k__BackingField>Ana</_x003C_Name_x003E_k__BackingField></Person>
DCS read back: Cache=null, OnDeserialized ran=True, IDeserializationCallback ran=True
STJ read back: OnDeserialized ran=False, IDeserializationCallback ran=False
STJ IncludeFields, [NonSerialized] field: {"Keep":1,"Skip":2}
```

Três achados. O `DataContractSerializer` trata `[Serializable]` como "escreva todo
campo", então os campos de apoio das propriedades automáticas aparecem com nomes
deformados e o `[NonSerialized]` é respeitado (`Cache` não foi escrito), enquanto
ele chama `[OnDeserialized]` e `IDeserializationCallback`. O System.Text.Json não
chama nenhum dos dois hooks e ignora `[NonSerialized]`: com `IncludeFields` ele
escreveu o campo marcado `[NonSerialized]`. Ou seja, pôr `[Serializable]` num DTO
por comodidade muda o formato do XML e não faz nada pelo JSON. Use `[JsonIgnore]`
e `IJsonOnDeserialized`, tratados em
[System.Text.Json](/csharp-concepts/system-text-json-serialization-and-options).

### BinaryFormatter, em um parágrafo

O [BinaryFormatter](/csharp-concepts/binaryformatter-removal-and-safe-serialization)
consumia toda essa maquinaria. No .NET 10, código que o usa não compila:
`error SYSLIB0011: 'BinaryFormatter' is obsolete`; com o diagnóstico silenciado,
`Serialize` lançou `PlatformNotSupportedException: BinaryFormatter serialization
and deserialization have been removed`. O risco é de projeto (o payload escolhe
os tipos), por isso o guia de migração manda parar de usá-lo mesmo com dados
confiáveis. O conceito ligado traz a migração.

### Livro versus hoje: as interfaces legadas e seus substitutos

| Legado (livro, .NET 1 e 2) | O que custa ou faz | Use hoje |
|---|---|---|
| `ICloneable` | profundidade ambígua, devolve `object` | construtor de cópia, `with`, tipos imutáveis |
| `[Serializable]`, `ISerializable` | modelo de formatter, SYSLIB0050/0051 | System.Text.Json, protobuf, MessagePack |
| `BinaryFormatter` | removido no .NET 9 | JSON ou um formato binário com contrato |
| `ArrayList`, `Hashtable`, `Queue`, `Stack` | slots `object`, boxing | `List<T>`, `Dictionary<,>`, `Queue<T>`, `Stack<T>` |
| `IEnumerable`, `IEnumerator`, `ICollection`, `IList` | sem tipo | as versões genéricas; as antigas ficam como base |
| `IComparable` (não genérico) | faz boxing de structs | `IComparable<T>`, `Comparer<T>.Default` |
| `IAsyncResult`, `Begin/End` (APM) | encanamento de callback e handle | `Task`, `async`/`await` |
| `ISynchronizeInvoke` | volta para a thread de UI, era do `Control` | `SynchronizationContext`, o dispatcher do framework de UI |
| `EventArgs` em todo evento | uma classe por evento | `EventHandler<T>` com qualquer `T` |

As coleções não genéricas não têm diagnóstico do compilador, mas as páginas do
Learn de `ArrayList`, `Hashtable`, `Queue` e `Stack` dizem cada uma "não
recomendamos o uso" delas "em desenvolvimento novo". As linhas de interface também
não foram removidas: `IEnumerable<T>` herda de `IEnumerable`, e `string`
implementa `IComparable` e `IComparable<string>`. O que muda é o que você escreve.

### Quanto custam as versões não genéricas

`GC.GetAllocatedBytesForCurrentThread`, 100.000 `int`s, Release, melhor de 7
execuções no tempo. As linhas de "add" incluem o array de apoio (o conceito de
generics conta só os boxes, 2.401.488 bytes):

```text
ArrayList.Add               3,200,096 bytes  0.417 ms   List<int>.Add           400,096 bytes  0.064 ms
Hashtable[i]=i              8,554,624 bytes  0.788 ms   Dictionary<int,int>   2,172,792 bytes  0.224 ms
Queue.Enqueue               3,200,112 bytes  0.450 ms   Queue<int>.Enqueue      400,104 bytes  0.201 ms
foreach IEnumerable (object) 2,400,072 bytes 0.589 ms   foreach IEnumerable<int>     72 bytes  0.133 ms
((IComparable)v1).CompareTo   2,424,016 bytes 0.249 ms  Comparer<Ver>.Default         40 bytes  0.052 ms
ArrayList.Sort              4,000,120 bytes  6.219 ms   List<int>.Sort          400,096 bytes  0.792 ms
```

Cada `int` em box ocupa 24 bytes, então `ArrayList` e `Queue` alocam 8 vezes o que
`List<int>` e `Queue<T>` alocam para os mesmos dados (o `Hashtable`, cerca de 4
vezes o `Dictionary`) e foram de 2 a 8 vezes mais lentos aqui (o sort inclui a
construção da lista). Um `foreach (object x in (IEnumerable)intArray)` não
genérico fez box de cada elemento; o laço genérico alocou só o enumerador. O boxing
do `IComparable` custa 24 bytes por comparação de struct. Ler um `ArrayList` de ints não alocou nada por elemento (88 bytes no
total), porque o unboxing não aloca: o custo está na escrita, não na leitura.

### APM e as outras relíquias de async

`IAsyncResult` com `BeginX/EndX` é o modelo do .NET 1; a página do Learn diz que o
padrão baseado em Task "substitui tanto o APM quanto o EAP". Medido no .NET 10:

```text
delegate BeginInvoke: PlatformNotSupportedException: Operation is not supported on this platform.
FileStream.BeginRead/EndRead: 9 bytes, IAsyncResult type TaskAsyncResult
Task.Factory.FromAsync wrapped: 9 bytes
ReadAsync: 9 bytes
```

Duas surpresas para código antigo: `Func<,>.BeginInvoke` (a "chamada async de graça" de C# 1)
lança exceção no .NET (Core), enquanto o `BeginRead` de stream
ainda funciona como um invólucro sobre a maquinaria de Task (`TaskAsyncResult`), e
o `Task.Factory.FromAsync` transforma um par `Begin/End` sobrevivente numa `Task`
que dá para usar com `await`, então embrulhe essa biblioteca na borda em vez de
reescrevê-la. `ISynchronizeInvoke` é um contrato da era Windows Forms; nenhum tipo dos
assemblies carregados o implementou nesta execução no macOS, e o
`SynchronizationContext` faz o trabalho dele hoje.
`EventHandler<int>` compilou e rodou: no .NET Core o `TEventArgs` não precisa mais
derivar de `EventArgs`, como explica
[Eventos](/csharp-concepts/events-observer-pattern-and-memory-leaks).

## Trade-offs

- **Não adicione `ICloneable`, mas não o arranque.** Embrulhe:
  `public Basket Copy() => new(this)` é tipado e honesto sobre a profundidade.
  `MemberwiseClone` só serve se o tipo tiver apenas campos de valor.
- **Manter `[Serializable]` em exceções é quase só ruído.** O construtor de
  serialização agora avisa (SYSLIB0051). Apague numa hierarquia sua; numa
  biblioteca pública com restrição de compatibilidade, marque a sua cópia como
  obsoleta.
- **Um DTO `[Serializable]` tem duas vidas.** O `DataContractSerializer` escreve
  todos os campos e respeita os hooks, o System.Text.Json escreve propriedades e
  não respeita nenhum. Escolha o serializador primeiro, depois os atributos.
- **Trocar `ArrayList` costuma ser ganho de graça.** `List<int>` tirou 2,8 MB de
  alocação em 100.000 itens, mas uma lista realmente mista é `List<object>`.

## Documentation Links

- [ICloneable Interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.icloneable) (doc)
- [Object.MemberwiseClone, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.object.memberwiseclone) (doc)
- [ISerializable Interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.serialization.iserializable) (doc)
- [SYSLIB0050: Formatter-based serialization is obsolete, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib0050) (doc)
- [SYSLIB0051: Legacy serialization support APIs are obsolete, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib0051) (doc)
- [SYSLIB0011: BinaryFormatter serialization is obsolete, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/fundamentals/syslib-diagnostics/syslib0011) (doc)
- [BinaryFormatter migration guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-migration-guide/) (doc)
- [Commonly used collection types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/collections/) (doc)
- [Non-generic collections shouldn't be used, dotnet/platform-compat](https://github.com/dotnet/platform-compat/blob/master/docs/DE0006.md) (doc)
- [Asynchronous Programming Model (APM), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/asynchronous-programming-model-apm) (doc)
- [Interop with other asynchronous patterns and types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/interop-with-other-asynchronous-patterns-and-types) (doc)
- [ISynchronizeInvoke Interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.isynchronizeinvoke) (doc)
