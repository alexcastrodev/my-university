---
version: 1.0
updatedAt: 2026-10-15
title: "Exceptions: try, catch, Filtros e finally"
summary: O modelo de duas passadas do .NET (filtros when rodam antes do unwind), ordem dos catch, o que o finally garante e onde ele não roda, o custo medido de um throw no .NET 8 e no .NET 10, AggregateException, ExceptionDispatchInfo, handlers globais e como desenhar uma exception customizada.
---
## Objective

Uma exception no .NET não é um salto para o `catch` mais próximo. O runtime
primeiro sobe a pilha procurando um handler, rodando os filtros `when` pelo
caminho, e só depois de achar um é que ele desempilha os frames e roda os
blocos `finally` do meio. Esse modelo de duas passadas explica por que um
filtro enxerga a pilha original, por que logar num filtro é melhor que
capturar e relançar, e por que um `finally` é garantido em algumas situações e
não em outras. Este conceito cobre `try`/`catch`/`finally` com esse modelo em
mente, quanto um `throw` custa de verdade (medido no .NET 8 e no .NET 10),
`AggregateException`, `ExceptionDispatchInfo`, os handlers globais do processo
e como desenhar um tipo de exception customizado hoje.

## Use Cases

- Capturar só as falhas que você sabe resolver (entrada malformada, timeout) e
  deixar o resto chegar a um nível acima que sabe mais.
- Logar uma exception com todo o contexto sem capturá-la.
- Liberar um lock, um arquivo ou uma flag de "ocupado" seja qual for a forma
  de saída do bloco.
- Ler o erro real de uma `Task` que falhou, ou de várias tasks que falharam
  juntas.
- Instalar um handler de último recurso que registra o crash antes de o
  processo terminar.

## Deep Dive

### O modelo de duas passadas

Quando uma exception é lançada, o runtime faz uma primeira passada subindo a
pilha. Em cada `try` que encontra, ele testa as cláusulas `catch` em ordem e,
numa cláusula com `when`, roda o filtro ali mesmo, com todos os frames de baixo
ainda intactos. Só quando uma cláusula aceita a exception começa a segunda
passada: os frames são desempilhados, os `finally` internos rodam e aí o corpo
do `catch` executa. A ordem aparece na saída:

```csharp
static void Inner()
{
    try { throw new InvalidOperationException("boom"); }
    finally { Console.WriteLine("inner finally"); }
}

try { Inner(); }
catch (Exception e) when (Log("outer filter runs"))
{
    Console.WriteLine($"outer catch: {e.Message}");
}
// outer filter runs
// inner finally
// outer catch: boom
```

Duas consequências pesam na prática. Primeiro, um filtro que retorna `false`
deixa a exception intocada, então `catch (Exception e) when (LogAndSkip(e))`
registra o erro e deixa ele seguir até o handler de verdade, sem relançar e
sem mexer no stack trace. Segundo, um filtro não pode falhar: se a própria
expressão do filtro lança, essa exception é engolida e o filtro conta como
`false`, então um bug no filtro vira silenciosamente "não é tratado aqui".

### Ordem e catches específicos

O runtime testa as cláusulas `catch` de cima para baixo e roda no máximo uma.
O compilador recusa uma cláusula inalcançável: `catch (Exception)` seguido de
`catch (FormatException)` dá o erro CS0160 "A previous catch clause already
catches all exceptions of this or of a super type". Com filtros, o mesmo tipo
pode aparecer mais de uma vez, desde que a cláusula sem filtro venha por
último:

```csharp
foreach (var input in new[] { "$12", "abc", "99999999999" })
{
    try { Console.WriteLine(int.Parse(input)); }
    catch (FormatException) when (input.Contains('$')) { Console.WriteLine($"{input}: drop the currency symbol"); }
    catch (FormatException) { Console.WriteLine($"{input}: not a number"); }
    catch (OverflowException) { Console.WriteLine($"{input}: out of range"); }
}
// $12: drop the currency symbol
// abc: not a number
// 99999999999: out of range
```

O `StackTrace` de uma exception capturada lista os frames entre o `throw` e o
frame que a capturou, não a pilha inteira. Ele é preenchido enquanto a
exception viaja, e é por isso que relançar muda o trace (o próximo conceito,
sobre guard clauses e rethrow, compara `throw;` com `throw ex;`).

### O que o `finally` garante, e o que não garante

Um `finally` roda quando o controle sai do `try` normalmente, por `return`,
`break`, `continue` ou `goto`, ou porque uma exception propaga e algum frame
acima a trata. O valor de um `return` é calculado antes de o `finally` rodar,
então mudar a variável depois não muda o resultado:

```csharp
static int F()
{
    int x = 1;
    try { return x; }
    finally { x = 2; Console.WriteLine("finally ran, x = 2"); }
}
// finally ran, x = 2
// 1
```

O `using` é o mesmo mecanismo: o compilador transforma o statement num
`try`/`finally` que chama `Dispose`.

A garantia acaba onde o processo acaba. Cada caso abaixo foi rodado no
.NET 10 (macOS arm64):

| Situação | O `finally` rodou? |
|---|---|
| `Environment.FailFast("...")` dentro do `try` | não, o processo termina na hora (exit code 134) |
| Stack overflow dentro do `try` | não, "Stack overflow." e o processo termina; não dá para capturar |
| `Environment.Exit(3)` dentro do `try` | não, mas os handlers de `AppDomain.ProcessExit` rodaram |
| Exception não tratada (ninguém captura) | sim nesta execução, depois da mensagem "Unhandled exception" |

A última linha é a armadilha. A referência do C# diz que o `finally` rodar ou
não depende de o sistema operacional disparar um unwind, então para exception
não tratada isso não é promessa. Nunca coloque a única cópia de um estado
importante, como o flush de um log, num `finally` que depende de a exception
ser capturada.

### Quanto custa um `throw`

Um laço com stopwatch de 200.000 iterações depois de aquecer, em Release, num
Apple M4 Max (macOS 27, arm64), o mesmo código em dois runtimes:

| Operação | .NET 8.0.22 | .NET 10.0.0 |
|---|---|---|
| `int.TryParse("abc")` falhando | 35 ns | 35 ns |
| `throw` e `catch` no mesmo método | cerca de 17.900 ns | cerca de 2.230 ns |
| `throw` 10 frames abaixo, depois `catch` | cerca de 22.200 ns | cerca de 3.900 ns |
| `int.Parse("abc")` mais `catch` | cerca de 18.900 ns | cerca de 2.800 ns |

O salto vem do .NET 9, quando o CoreCLR passou a usar uma implementação de
tratamento de exceptions baseada no modelo do NativeAOT (a Microsoft reporta
de 2 a 4 vezes mais rápido nos micro-benchmarks dela; nesta máquina a
diferença ficou entre 6 e 8 vezes). Mesmo assim, um `TryParse` que falha ainda
é de 60 a 80 vezes mais barato que uma exception lançada e capturada, e o custo
cresce com o número de frames desempilhados. Exception serve para falha; para
um resultado esperado dentro de um laço, é a ferramenta errada.

### `AggregateException` e tasks

Uma `Task` guarda a falha como `AggregateException`, porque várias coisas
podem falhar ao mesmo tempo. As APIs bloqueantes (`Wait`, `WaitAll`,
`.Result`) lançam esse invólucro; `await` e `GetAwaiter().GetResult()`
desembrulham e lançam a primeira exception interna:

```csharp
var t1 = Task.Run(() => throw new InvalidOperationException("A"));
var t2 = Task.Run(() => throw new ArgumentException("B"));

try { Task.WaitAll(t1, t2); }
catch (AggregateException ae) { /* ae.InnerExceptions.Count == 2: A, B */ }

var all = Task.WhenAll(t1, t2);
try { await all; }
catch (Exception e) { /* InvalidOperationException 'A'; all.Exception has 2 */ }
```

Depois de um `await` no `WhenAll`, leia `all.Exception.InnerExceptions` se
precisar de todas as falhas. `ae.Handle(predicate)` marca algumas exceptions
internas como tratadas e relança uma nova `AggregateException` com o resto, e
`Flatten()` junta agregados aninhados.

### `ExceptionDispatchInfo`: relançar em outro lugar

Às vezes a exception é capturada num ponto e precisa ser relançada depois, em
outro frame ou outra thread. `ExceptionDispatchInfo.Capture(ex)` guarda a
exception e `Throw()` relança mantendo os frames originais e acrescentando o
novo ponto de relançamento. Na execução abaixo, o trace mostra `Int32.Parse` e
a chamada original na linha 6, mais o `Throw()` na linha 9:

```csharp
ExceptionDispatchInfo? captured = null;
try { Parse("x"); }                                         // line 6
catch (FormatException ex) { captured = ExceptionDispatchInfo.Capture(ex); }

try { captured!.Throw(); }                                  // line 9
catch (FormatException ex) { Console.WriteLine(ex.StackTrace); }
// at System.Number.ThrowFormatException[TChar](ReadOnlySpan`1 value)
// at System.Int32.Parse(String s)
// at Program.<<Main>$>g__Parse|0_4(String s)
// at Program.<Main>$(String[] args) ... line 6   (original call)
// at Program.<Main>$(String[] args) ... line 9   (the rethrow)
```

É o mesmo mecanismo que o `await` usa por dentro para que uma falha assíncrona
pareça uma falha comum.

### Handlers globais do processo

- `AppDomain.CurrentDomain.UnhandledException` é uma notificação, não um
  handler: dispara para uma exception que nenhum frame capturou, em qualquer
  thread, e o processo termina mesmo assim (`IsTerminating` veio `True`). Use
  para logar.
- `TaskScheduler.UnobservedTaskException` dispara quando uma task com falha,
  que ninguém aguardou nem inspecionou, é finalizada pelo GC. Por padrão ela
  não derruba o processo, e é exatamente por isso que falhas de
  fire-and-forget somem em silêncio. No teste, o evento só disparou depois de
  `GC.Collect()` e `WaitForPendingFinalizers()`.
- `ExceptionHandling.SetUnhandledExceptionHandler` (novo no .NET 10) instala um
  handler único que pode retornar `true` para tratar a exception como
  resolvida. Lançada numa thread de trabalho, uma `InvalidOperationException`
  aceita pelo handler deixou o `Main` continuar; uma `FormatException` recusada
  seguiu para `AppDomain.UnhandledException` e encerrou o processo. Só pode ser
  definido uma vez e foi pensado para hosts como REPLs e executores de
  plug-ins.

### Desenhando uma exception customizada

Herde da base com significado mais próximo (`InvalidOperationException`,
`ArgumentException`), mantenha os construtores padrão e exponha como
propriedades os dados que o handler precisa, para que filtros possam usá-los:

```csharp
public sealed class InsufficientFundsException : InvalidOperationException
{
    public decimal Shortfall { get; }
    public InsufficientFundsException() { }
    public InsufficientFundsException(string message) : base(message) { }
    public InsufficientFundsException(string message, Exception inner) : base(message, inner) { }
    public InsufficientFundsException(decimal shortfall)
        : base($"Insufficient funds: missing {shortfall}") => Shortfall = shortfall;
}

catch (InsufficientFundsException e) when (e.Shortfall > 20) { ... }
// Insufficient funds: missing 30
```

Dispense o `[Serializable]` e o construtor `(SerializationInfo,
StreamingContext)`: chamar o da base agora gera o warning SYSLIB0051, porque a
serialização baseada em formatter está obsoleta.

## Trade-offs

- **Capturar de forma ampla esconde bugs.** Um `catch (Exception)` no fundo do
  código também pega o `NullReferenceException` dos seus próprios erros.
  Capture tipos específicos, ou logue e relance.
- **Filtros são poderosos, mas precisam ser triviais.** Um filtro que lança é
  tratado como `false` sem rastro do erro, e um filtro com efeito colateral
  roda mesmo quando outro handler acaba tratando a exception.
  ```csharp
  catch (Exception e) when (LogAndSkip(e)) { } // só logging, sem lançar nada
  ```
- **Exceptions ficaram mais baratas, não baratas.** Cerca de 2 microssegundos
  por throw no .NET 10 é aceitável para falha real e desperdício como fluxo de
  controle num caminho quente; ali, use métodos `TryX`.
- **`finally` é para limpeza, não para durabilidade.** Ele não roda com
  `FailFast`, stack overflow ou `Environment.Exit`, e não é prometido para
  exception não tratada.
- **Handlers globais observam, raramente recuperam.** Só o
  `SetUnhandledExceptionHandler` consegue manter o processo vivo, e seguir
  depois de uma falha desconhecida pode deixar estado compartilhado
  corrompido.

## Documentation Links

- [Exception-handling statements, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/exception-handling-statements) (doc)
- [Best practices for exceptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/exceptions/best-practices-for-exceptions) (doc)
- [What's new in .NET 9 runtime: faster exceptions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-9/runtime) (doc)
- [ExceptionDispatchInfo class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.exceptionservices.exceptiondispatchinfo) (doc)
- [ExceptionHandling.SetUnhandledExceptionHandler, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.exceptionservices.exceptionhandling.setunhandledexceptionhandler) (doc)
- [Exception handling (Task Parallel Library), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/parallel-programming/exception-handling-task-parallel-library) (doc)
