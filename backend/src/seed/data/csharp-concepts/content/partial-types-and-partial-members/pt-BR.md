---
version: 1.0
updatedAt: 2026-10-15
title: "Tipos e Membros Partial"
summary: Como declarações partial se fundem, métodos partial legados e estendidos, propriedades e indexadores partial (C# 13), construtores e eventos partial (C# 14) e o contrato com source generators.
---
## Objective

`partial` permite que um tipo viva em vários arquivos, e desde o C# 13 e o C# 14
ele também permite dividir um único membro em uma declaração em um lugar e uma
implementação em outro. A razão de isso importar hoje não são os arquivos de
designer, e sim os source generators: `[GeneratedRegex]`, `[LoggerMessage]` e
`[LibraryImport]` funcionam pedindo que você escreva uma assinatura `partial` e
deixando o compilador preencher o corpo. Este conceito cobre como as declarações de
um tipo partial se fundem, os dois tipos de método partial, propriedades e
indexadores partial (C# 13), construtores e eventos partial (C# 14), os erros
exatos do compilador para cada regra e o contrato entre o seu código e um
generator.

## Use Cases

- Dividir uma classe grande para que o código escrito à mão e o código gerado
  fiquem em arquivos diferentes.
- Trocar um `Regex` criado em runtime, ou um log baseado em reflection, por código
  gerado em tempo de compilação, sem mudar os pontos de chamada.
- Dar a um generator um lugar estável para colocar um construtor ou a
  implementação de um evento que você mesmo declara.
- Ler as mensagens de erro quando um generator e a sua declaração discordam.

## Deep Dive

### Como as declarações de um tipo partial se fundem

Toda declaração do tipo precisa levar `partial`, e o compilador as combina em um só
tipo. Faltar o modificador em qualquer parte é o erro CS0260. A acessibilidade
precisa concordar quando escrita (CS0262), enquanto alguns modificadores se
combinam: se uma parte diz `sealed`, o tipo inteiro é sealed, e tipos base e
interfaces são a união das partes.

```csharp
partial class Order : IDisposable { public void Dispose() { } }
sealed partial class Order : Base, IComparable { public int CompareTo(object? o) => 0; }

typeof(Order).IsSealed;                                  // True
typeof(Order).GetInterfaces().Select(i => i.Name);       // IDisposable, IComparable
typeof(Order).BaseType;                                  // Base
```

Todas as partes precisam ser compiladas juntas no mesmo assembly. `partial` também
vale para structs, interfaces e records, mas não para enums nem delegates. Tipos
partial não têm significado em runtime: depois da compilação existe um só tipo e as
partes desaparecem.

### Métodos partial: a forma legada e a estendida

A forma original (C# 3) foi feita para ganchos opcionais. Precisa retornar `void`,
não tem parâmetros `out` e não tem modificador de acesso (é implicitamente
private). Se nenhuma parte a implementa, o compilador remove a chamada, **inclusive
a avaliação dos argumentos**:

```csharp
sealed partial class Order
{
    partial void OnSaving(string detail);          // nunca implementado
    public void Save()
    {
        OnSaving(Expensive());                     // chamada e argumento removidos
        Console.WriteLine("saved");
    }
    static string Expensive() { Console.WriteLine("Expensive() ran"); return "x"; }
}
// new Order().Save() imprime só: saved
```

Desde o C# 9, um método partial com qualquer modificador de acesso, tipo de retorno
diferente de `void` ou parâmetro `out` é um método partial **estendido**. Ele não
tem a saída "opcional": a implementação é obrigatória, senão o compilador reporta o
erro CS8795 (`Partial method 'A1.Name()' must have an implementation part because it
has accessibility modifiers`). As duas declarações também precisam concordar na
acessibilidade (CS8799). Essa é a forma que os generators usam.

### Propriedades e indexadores partial (C# 13)

Uma propriedade partial tem uma declaração de definição, escrita como uma
auto-property, e uma declaração de implementação com corpos de accessor de verdade.
Indexadores seguem a mesma regra. As assinaturas precisam ser iguais.

```csharp
public partial class Widget
{
    public partial string Title { get; set; }       // definição
    public partial int this[int i] { get; }
}

public partial class Widget
{
    private string _title = "";
    private int _size = 3;
    public partial string Title { get => _title; set => _title = value.Trim(); }
    public partial int this[int i] => i * _size;
}
```

A declaração de implementação não pode ser ela mesma uma auto-property, porque
pareceria uma segunda declaração de definição: esse é o erro CS9250 (`A partial
property may not have multiple defining declarations, and cannot be an
auto-property`). Uma definição sem implementação é o CS9248. No C# 14 a
implementação pode usar a palavra-chave `field`, então uma implementação como
`get => field; set => field = value;` compilou no experimento sem campo de apoio
manual.

### Construtores e eventos partial (C# 14)

O C# 14 completa o conjunto. Ambos seguem o mesmo formato de uma definição e uma
implementação, e as notas oficiais acrescentam duas regras:

- Só a declaração de **implementação** de um construtor pode ter inicializador
  (`: this(...)` ou `: base(...)`), e apenas uma parte do tipo pode declarar um
  primary constructor.
- A definição de um evento é field-like (`public partial event Action<string>
  Changed;`) e a implementação precisa fornecer os accessors `add` e `remove`.

```csharp
public partial class Widget
{
    public partial Widget(int size);                       // definição
    public partial event Action<string> Changed;           // definição
}

public partial class Widget
{
    private int _size;
    private Action<string>? _changed;

    public partial Widget(int size) { _size = size; }       // implementação, pode ter : this(...)

    public partial event Action<string> Changed
    {
        add => _changed += value;
        remove => _changed -= value;
    }
}
```

Isso compilou e rodou no SDK 10.0.100 com a versão de linguagem padrão. Os erros
dos experimentos nomeiam a regra violada: uma definição sem implementação dá
CS9275 (`Partial member 'A9.A9(int)' must have an implementation part`), duas
definições dão CS9277 e um segundo corpo de implementação dá CS9278. Um corpo de
construtor escrito na declaração de definição conta como a implementação, e por
isso colocar `: this()` ali falha com CS9276 ou CS9278 em vez de uma mensagem
amigável.

### O contrato com source generators

Um generator não pode editar o seu arquivo, então ele adiciona uma segunda parte da
sua classe. Você escreve a assinatura, o generator escreve o corpo, e as regras de
partial acima são a cola. Três generators embutidos mostram o padrão:

```csharp
public static partial class Matcher
{
    [GeneratedRegex(@"\d+")]
    public static partial Regex Digits();          // forma de método (.NET 7)

    [GeneratedRegex(@"\d+")]
    public static partial Regex DigitsProp { get; } // forma de propriedade (partial properties)
}

public partial class Service(ILogger<Service> logger)
{
    [LoggerMessage(Level = LogLevel.Information, Message = "Started job {Id}")]
    private partial void Started(int id);
}

internal static partial class Native
{
    [LibraryImport("libc", EntryPoint = "getpid")]
    internal static partial int GetPid();          // exige <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
}
```

`Matcher.Digits().Match("abc 123 def").Value` retorna `123`, a chamada de log
imprime `Started job 7` e `GetPid()` é igual a `Environment.ProcessId`. Definir
`<EmitCompilerGeneratedFiles>true</EmitCompilerGeneratedFiles>` grava as partes
geradas em disco, e elas mostram a cola com clareza: a parte do Regex é uma
`partial class Matcher` cujo `Digits()` devolve uma instância em cache de uma
subclasse de `Regex` gerada; a parte de logging é outra `partial class Service` que
usa o parâmetro `logger` do primary constructor declarado na **sua** parte, checa
`IsEnabled` e chama um callback estático de `LoggerMessage.Define`.

Uma armadilha: aponte `CompilerGeneratedFilesOutputPath` para uma pasta dentro de
`obj/`. Se você apontar para uma pasta na raiz do projeto, o próximo build inclui
esses arquivos como código-fonte normal e falha com erros como CS0757 e CS0102 (o
código gerado passa a existir duas vezes).

## Trade-offs

- **Uma classe partial espalha um design por vários arquivos.** É ótimo para código
  gerado e cansativo para pessoas: para ler os construtores você precisa abrir
  todas as partes. Mantenha tipos escritos à mão em um só arquivo, a menos que um
  generator force a divisão.
- **Métodos partial legados somem em silêncio.** Um erro de digitação no nome da
  implementação cria um segundo método sem relação, e o gancho nunca roda, sem
  nenhum erro. Prefira a forma estendida, em que o compilador exige a
  implementação.
  ```csharp
  partial void OnSaving(string d);       // implementado depois como OnSavng(...): sem erro
  ```
- **Chamadas removidas pulam efeitos colaterais.** Na forma legada a expressão do
  argumento também não é avaliada, então `OnSaving(Expensive())` sai de graça
  quando ninguém implementa, e vira bug se `Expensive()` também fazia algo de que
  você dependia.
- **Generators exigem uma casca partial, e todo tipo que contém o membro faz parte
  dela.** `[GeneratedRegex]` em um método dentro de uma classe, ou de uma classe
  aninhada, que não seja `partial` falha com CS0260, porque a parte gerada é uma
  declaração `partial` daquele tipo. O ganho é uma API tipada e nenhum custo de
  construir o regex na inicialização; o custo é código gerado que não aparece no
  code review.
  ```csharp
  public class NotPartial { [GeneratedRegex(@"\d+")] public static partial Regex Digits(); }
  // error CS0260: Missing partial modifier on declaration of type 'NotPartial'
  ```
- **Os membros mais novos exigem um compilador mais novo.** Propriedades e
  indexadores partial precisam de C# 13, e construtores e eventos partial precisam
  de C# 14 (SDK 10). Quem compila com um SDK mais antigo não consegue compilar
  esses arquivos, então adote quando o time inteiro e a imagem de CI já tiverem
  migrado.

## Documentation Links

- [partial type, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/partial-type) (doc)
- [partial member, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/partial-member) (doc)
- [What's new in C# 14, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-14) (doc)
- [What's new in C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
- [.NET regular expression source generators, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/base-types/regular-expression-source-generators) (doc)
- [Compile-time logging source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/logger-message-generator) (doc)
- [P/Invoke source generation, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/native-interop/pinvoke-source-generation) (doc)
