---
version: 1.0
updatedAt: 2026-10-15
title: "IDisposable, Finalizers e Limpeza Determinística"
summary: using statement e using declaration, await using e IAsyncDisposable, o padrão Dispose e quando ele é necessário, o custo medido de um finalizer, por que SafeHandle substitui quase todo finalizer e como o container de DI descarta serviços no .NET 10.
---
## Objective

O garbage collector recupera memória, e só memória. Handles de arquivo,
sockets, conexões de banco, locks, timers e inscrições em eventos precisam que
alguém os libere num momento conhecido, e esse é o papel do `IDisposable`.
Este conceito cobre `using` statement e `using` declaration, `await using` e
`IAsyncDisposable`, o padrão Dispose e quando ele é necessário, o que um
finalizer realmente custa, por que `SafeHandle` substitui quase todo finalizer
e como o container de injeção de dependência descarta serviços, tudo medido no
.NET 10.

## Use Cases

- Garantir que um arquivo ou uma conexão seja fechado mesmo quando uma exceção
  estoura no meio do caminho.
- Escrever uma classe que é dona de um `Stream`, de um handler de
  `HttpClient` ou de um timer.
- Embrulhar um handle nativo vindo de P/Invoke para que ele seja liberado uma
  vez, e só uma.
- Explicar por que a memória cresce num serviço que resolve transients
  descartáveis a partir do provider raiz.
- Escolher entre `Dispose` e `DisposeAsync` para um tipo que descarrega dados
  pela rede.

## Deep Dive

### `using` statement e `using` declaration

O `using` statement compila para um `try`/`finally` que chama `Dispose`. A
`using` declaration (C# 8) dispensa as chaves e descarta no fim do escopo que a
contém; várias declarações são descartadas em ordem inversa, e um recurso
`null` simplesmente é ignorado:

```csharp
try
{
    using var a = new Res("a");
    using var b = new Res("b");
    using Res? none = null;          // permitido: nada a descartar
    throw new InvalidOperationException("boom");
}
catch (InvalidOperationException e) { Console.WriteLine($"caught {e.Message}"); }
// dispose b
// dispose a
// caught boom

sealed class Res(string name) : IDisposable
{
    public void Dispose() => Console.WriteLine($"dispose {name}");
}
```

A variável é somente leitura, então não dá para reatribuí-la a algo que
escaparia do descarte. A declaração vive até o fim do bloco, que muitas vezes é
o fim do método; quando o recurso deve ser liberado antes, a forma com chaves
deixa isso explícito. O C# 8 também aceita `using` numa `ref struct` que só tem
um método `void Dispose()` acessível e sem parâmetros, porque uma `ref struct`
não podia implementar interfaces antes do C# 13.

### `await using` e `IAsyncDisposable`

Tipos cuja limpeza faz I/O (descarregar um stream com buffer, mandar um frame
de fechamento) implementam `IAsyncDisposable`, e `await using` aguarda o
`DisposeAsync` deles:

```csharp
await using (var r = new AsyncRes()) { }   // DisposeAsync rodou

using (var r = new AsyncRes()) { }
// error CS8418: 'AsyncRes': type used in a using statement must implement
// 'System.IDisposable'. Did you mean 'await using' rather than 'using'?

sealed class AsyncRes : IAsyncDisposable
{
    public async ValueTask DisposeAsync() { await Task.Yield(); Console.WriteLine("DisposeAsync ran"); }
}
```

Um tipo que implementa as duas interfaces deixa quem chama escolher; o conceito
de async streams mostra o `await foreach` chamando `DisposeAsync` no enumerador
do mesmo jeito.

### O padrão Dispose, e quando você precisa dele

A maioria das classes descartáveis é dona de outros descartáveis gerenciados e
de nada nativo. Para elas a orientação é curta: selar a classe e repassar o
`Dispose` para o que ela possui.

```csharp
public sealed class ReportWriter(string path) : IDisposable
{
    private readonly StreamWriter _writer = new(path);
    private bool _disposed;

    public void Write(string line)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        _writer.WriteLine(line);
    }

    public void Dispose()
    {
        if (_disposed) return;          // idempotente: a segunda chamada não faz nada
        _disposed = true;
        _writer.Dispose();
    }
}
```

O padrão completo existe para classes que podem ser herdadas: um `Dispose()`
público e não virtual que chama `Dispose(true)` e depois
`GC.SuppressFinalize(this)`, mais um `protected virtual Dispose(bool disposing)`
que as classes derivadas sobrescrevem, encadeando com `base.Dispose(disposing)`.
O flag `disposing` só vale `false` quando quem chama é um finalizer, e esse
caminho não pode tocar outros objetos gerenciados, porque a ordem de
finalização não é determinística. Um finalizer só é necessário se a própria
classe segura um recurso não gerenciado cru, o que a documentação chama de
cenário bem avançado.

A posse decide quem descarta. A classe que cria um descartável é dona dele; a
classe que o recebe (por argumento de construtor ou por DI) em geral não é e
não deve descartá-lo. Os decorators de stream deixam essa escolha explícita com
`leaveOpen`, como mostra Hierarquia de Stream e Decorators.

### Finalizers são uma rede de segurança com preço

Um finalizer (`~Type()`) roda na thread de finalização algum tempo depois de o
objeto ficar inalcançável. Alocar um milhão de objetos pequenos e forçar uma
coleta no fim mediu, no .NET 10 em Release:

| Objetos | Tempo | Coletas extras | Finalizados |
|---|---|---|---|
| classe simples | 7 ms | nenhuma | 0 |
| classe com finalizer | 89 a 151 ms | 3 gen0, 1 gen1 | 1.000.000 |
| finalizer, com `GC.SuppressFinalize` no laço | 25 ms | 3 gen0 | 0 |

Todo objeto com finalizer é registrado na alocação, e por isso até a versão
suprimida custa mais. Um objeto finalizável inalcançável também sobrevive à
primeira coleta: ele espera na fila de finalização, o finalizer roda e só uma
coleta posterior libera a memória:

```csharp
var wr = new WeakReference(new WithFinalizer(), trackResurrection: true);
GC.Collect();                     // na fila de finalização: wr.IsAlive == true
GC.WaitForPendingFinalizers();    // agora o finalizer com certeza rodou
GC.Collect();                     // wr.IsAlive == false: memória recuperada
```

Não conte com finalizers no encerramento. O .NET 5 em diante não roda
finalizers quando o processo termina; um programa que criou um objeto
finalizável e saiu do `Main` não imprimiu nada do finalizer, enquanto um
handler de `AppDomain.ProcessExit` rodou. Limpeza que precisa acontecer na
saída passa por um `Dispose` chamado desse handler ou pelo host.

### `SafeHandle` em vez de um finalizer próprio

`SafeHandle` embrulha um `IntPtr` e já traz o finalizer, a garantia de liberar
uma vez só e a segurança entre threads. Você sobrescreve `IsInvalid` e
`ReleaseHandle`:

```csharp
sealed class NativeBuffer : SafeHandle
{
    private NativeBuffer() : base(IntPtr.Zero, ownsHandle: true) { }
    public override bool IsInvalid => handle == IntPtr.Zero;

    public static NativeBuffer Allocate(int bytes)
    {
        var h = new NativeBuffer();
        h.SetHandle(Marshal.AllocHGlobal(bytes));
        return h;
    }

    protected override bool ReleaseHandle() { Marshal.FreeHGlobal(handle); return true; }
}
```

Quando quem chamou esqueceu de descartar, o `ReleaseHandle` rodou mesmo assim
depois de `GC.Collect()` e `GC.WaitForPendingFinalizers()`. A classe que guarda
o `NativeBuffer` precisa então só do `Dispose` simples e selado de antes, sem
finalizer próprio. `SafeFileHandle`, `SafeWaitHandle` e os outros handles
nativos do framework já seguem esse desenho.

### Descarte no container de DI

O `Microsoft.Extensions.DependencyInjection` descarta os serviços que ele cria:
transients e scoped quando o escopo termina, singletons quando o provider raiz
é descartado. Uma instância que você mesmo passa (`AddSingleton(new Foo())`)
nunca é descartada pelo container. Duas armadilhas apareceram num teste com a
versão 10.0.0:

- Resolver um transient `IDisposable` 1.000 vezes a partir do provider raiz
  manteve as 1.000 instâncias vivas depois de um GC completo, porque o
  container as guarda para descartar; elas só foram descartadas junto com o
  provider raiz. A documentação lista isso como anti-padrão de vazamento de
  memória.
- Um serviço scoped que implementa só `IAsyncDisposable`, dentro de um escopo
  descartado com `using` comum, lançou `InvalidOperationException: 'OnlyAsync'
  type only implements IAsyncDisposable. Use DisposeAsync to dispose the
  container.` Trocar para `CreateAsyncScope()` com `await using` resolveu.

Os ciclos de vida em si estão em Injeção de Dependência e Ciclos de Vida de
Serviços.

## Trade-offs

- **`using` declaration versus bloco `using`.** A declaração é mais curta, mas
  segura o recurso até o fim do escopo; um lock ou uma conexão presos durante
  uma cauda lenta do método são custo real.
  ```csharp
  using var conn = Open();
  var rows = Query(conn);
  Render(rows);                // conn continua aberta aqui
  ```
- **Com finalizer versus sem finalizer.** Um finalizer pega o `Dispose`
  esquecido de handles crus, ao preço de alocação mais lenta, uma coleta extra
  antes de a memória voltar e nenhuma garantia no fim do processo.
  `SafeHandle` dá a mesma rede de segurança sem você escrever um.
- **Descartável selado versus herdável.** Selar elimina a cerimônia do
  `Dispose(bool)`; uma classe pública não selada precisa oferecê-lo para que as
  derivadas acrescentem limpeza corretamente.
- **Descarte síncrono versus assíncrono.** Implementar só `IAsyncDisposable`
  obriga todo chamador, inclusive escopos de DI, a usar `await using`;
  implementar as duas é mais amigável, mas são dois caminhos para manter.
- **Deixar o container descartar.** O descarte pela DI é automático e certo
  para trabalho com escopo, mas transients descartáveis resolvidos da raiz
  vivem até o desligamento; resolva-os dentro de um escopo ou crie-os com uma
  factory que você mesmo descarta.

## Documentation Links

- [Implement a Dispose method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-dispose) (doc)
- [Implement a DisposeAsync method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/garbage-collection/implementing-disposeasync) (doc)
- [using statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/using) (doc)
- [Finalizers, C# programming guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/programming-guide/classes-and-structs/finalizers) (doc)
- [SafeHandle class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.safehandle) (doc)
- [Dependency injection guidelines: disposal of services, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/dependency-injection/guidelines#disposal-of-services) (doc)
