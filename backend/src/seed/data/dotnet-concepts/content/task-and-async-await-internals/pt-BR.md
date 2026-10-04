---
version: 1.0
updatedAt: 2026-10-04
title: "Task e async/await por Dentro"
summary: A state machine gerada pelo compilador, SynchronizationContext e ConfigureAwait, deadlock com .Result, async void, as regras do ValueTask e por que Task.Run não torna I/O assíncrono.
---
## Objective

`async` e `await` parecem uma sintaxe para "esperar sem bloquear", e na maior
parte do tempo esse modelo mental basta. Ele deixa de bastar quando uma requisição
trava porque alguém escreveu `.Result`, quando uma exceção some de um método
`async void`, ou quando um `ValueTask` se comporta diferente na segunda vez em que
é aguardado. Cada um desses casos decorre de como o compilador reescreve um método
async numa state machine, de onde a continuação roda depois de um `await` e do que
um `Task` realmente representa. Este conceito cobre essa mecânica e as regras que
ela implica.

## Use Cases

- Explicar por que um controller que chama `.Result` num método async trava num
  host e apenas fica mais lento em outro.
- Escrever uma biblioteca para que ela não dependa da thread de quem a chama.
- Decidir se um event handler pode ser `async void`.
- Escolher entre `Task` e `ValueTask` para um método num caminho quente.
- Revisar código que embrulha I/O já assíncrono em `Task.Run`.

## Deep Dive

### O que o compilador gera

Um método `async` é reescrito numa state machine. Variáveis locais viram campos,
cada `await` vira um estado e `MoveNext` retoma o método de onde ele parou. Uma
visão simplificada do que este método se torna:

```csharp
public async Task<int> CountAsync(HttpClient http, string url, CancellationToken ct)
{
    var body = await http.GetStringAsync(url, ct);   // estado 0: inicia a chamada, registra a continuação, retorna
    return body.Length;                              // estado 1: MoveNext roda de novo quando a chamada termina
}

// Conceitualmente:
// struct CountAsyncStateMachine : IAsyncStateMachine
// {
//     public AsyncTaskMethodBuilder<int> builder;  // dono do Task<int> retornado
//     public HttpClient http; public string url; public CancellationToken ct;
//     int state; string body; TaskAwaiter<string> awaiter;
//     public void MoveNext() { /* switch (state) { ... } */ }
// }
```

Se a operação aguardada já terminou, o `await` continua de forma síncrona e o
método nunca devolve o controle a quem o chamou nesse intervalo. A state machine é
uma struct em builds de release e só vai para o heap (boxing) quando o método de
fato suspende, o que mantém o caminho rápido com poucas alocações. A partir do
.NET 10, o runtime pode assumir parte desse trabalho como um experimento opt-in, e
as regras abaixo não mudam.

### SynchronizationContext e ConfigureAwait

Depois que um `await` termina, a continuação roda onde o código que aguardava foi
capturado: no `SynchronizationContext` atual, se houver um, ou então no thread
pool. Frameworks de UI (WPF, WinForms, MAUI) e o ASP.NET clássico têm um contexto
que força a continuação de volta a uma thread específica. O ASP.NET Core não tem
`SynchronizationContext`, então as continuações rodam no thread pool:

```csharp
// Numa biblioteca, não force o retorno ao contexto de quem chama.
var data = await store.ReadAsync(ct).ConfigureAwait(false);

// .NET 8 em diante: opções para casos especiais.
await task.ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing); // observa o término sem relançar a exceção
```

Código de aplicação no ASP.NET Core não precisa de `ConfigureAwait(false)`.
Bibliotecas que podem rodar sob um contexto de UI precisam, para não depender
dessa thread.

### O deadlock do `.Result`

Bloquear numa task enquanto se segura o contexto de que a continuação precisa é um
deadlock:

```csharp
// Thread de UI (tem um SynchronizationContext):
var text = GetTextAsync().Result;
// GetTextAsync aguarda algo. A continuação precisa da thread de UI para retomar.
// A thread de UI está bloqueada em .Result esperando GetTextAsync. Ninguém avança.
```

O ASP.NET Core não trava desse jeito porque não tem esse contexto, mas `.Result` e
`.Wait()` ainda seguram uma thread durante a chamada inteira. Sob carga isso é
starvation do thread pool, uma falha mais lenta e mais difícil de notar. A correção
é a mesma em qualquer lugar: ser async até o topo e usar `await`.

### async void

Um método `async void` não tem um `Task` para devolver, então quem o chama não pode
aguardá-lo nem capturar sua exceção. A exceção é lançada no contexto capturado, ou
no thread pool, onde pode derrubar o processo:

```csharp
// Ruim: quem chama não consegue observar uma falha.
async void SaveAsync() { await db.SaveChangesAsync(); }

// Certo: devolva Task. async void é só para event handlers.
async Task SaveAsync() { await db.SaveChangesAsync(); }
button.Click += async (s, e) => await SaveAsync(); // o único lugar onde async void cabe
```

### ValueTask e suas regras

`ValueTask<T>` evita alocar um `Task` quando o resultado costuma estar disponível
de forma síncrona. Ele vem com restrições que o `Task` não tem:

```csharp
ValueTask<int> vt = cache.GetAsync(key);

var a = await vt;   // ok, uma vez
var b = await vt;   // errado: um ValueTask não pode ser aguardado mais de uma vez

var t = vt.AsTask(); // se precisar aguardá-lo várias vezes ou combiná-lo, converta antes
```

Não o aguarde de forma concorrente, não leia `.Result` nem
`GetAwaiter().GetResult()` antes de ele ter terminado e não o guarde para depois.
Use `ValueTask` só depois de medir que as alocações importam num caminho que
frequentemente termina de forma síncrona. No resto, `Task` é o padrão certo.

### Task.Run não é um jeito de tornar I/O assíncrono

`Task.Run` enfileira trabalho no thread pool. Embrulhar uma chamada já assíncrona só
acrescenta um salto de thread, e embrulhar uma chamada bloqueante apenas muda qual
thread fica bloqueada:

```csharp
// Sem sentido: GetStringAsync já é assíncrono.
var s = await Task.Run(() => http.GetStringAsync(url));

// Certo para trabalho CPU-bound numa aplicação de UI: mantém a thread de UI livre.
var result = await Task.Run(() => ComputeExpensiveThing(input));
```

No ASP.NET Core, jogar trabalho de CPU para fora com `Task.Run` não ganha nada,
porque a requisição já roda numa thread do pool.

### async sem await

Um método `async` sem nenhum `await` compila (com o warning CS1998) e roda de forma
síncrona, acrescentando uma state machine à toa. Devolver a task diretamente
elimina esse custo, mas tem uma armadilha: uma task devolvida de dentro de um
`using`:

```csharp
// Não é async, mas é inseguro: db é descartado antes de a query terminar.
Task<List<Order>> LoadAsync()
{
    using var db = factory.CreateDbContext();
    return db.Orders.ToListAsync();
}

// Seguro: o await mantém db vivo até o trabalho terminar.
async Task<List<Order>> LoadAsync()
{
    using var db = factory.CreateDbContext();
    return await db.Orders.ToListAsync();
}
```

## Trade-offs

- **`ConfigureAwait(false)` em todo lugar é ruído em código de aplicação.** Faz
  sentido numa biblioteca com chamadores desconhecidos, e numa aplicação ASP.NET
  Core não muda nada observável. Adicione por política de cada projeto, não por
  hábito.
- **Exceções numa task não aguardada desaparecem.** Uma chamada como
  `_ = DoAsync();` engole a falha em silêncio, então um fire-and-forget precisa do
  seu próprio try/catch ou de um job durável.
  ```csharp
  _ = Task.Run(async () => { try { await DoAsync(); } catch (Exception e) { log.LogError(e, "failed"); } });
  ```
- **`ValueTask` troca segurança por alocações.** Um uso incorreto (aguardar duas
  vezes) falha de forma imprevisível, às vezes só sob carga, enquanto um `Task`
  simplesmente funcionaria.
- **Eliminar async/await muda o momento das exceções.** Um método que devolve a task
  diretamente lança erros de validação de argumentos já na chamada, enquanto um
  método `async` os guarda na task, então quem chama os vê no `await`.
- **Async até o topo é contagioso.** Uma API síncrona no meio de uma pilha async
  empurra as pessoas para `.Result`, que é por onde entram os deadlocks e a
  starvation. A correção é uma nova sobrecarga async, não uma ponte.

## Documentation Links

- [Asynchronous programming with async and await, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/) (doc)
- [Task asynchronous programming model (TAP), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/asynchronous-programming-patterns/task-based-asynchronous-pattern-tap) (doc)
- [ValueTask<TResult> struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.valuetask-1) (doc)
- [ConfigureAwait FAQ, .NET Blog](https://devblogs.microsoft.com/dotnet/configureawait-faq/) (doc)
- [ASP.NET Core best practices, avoid blocking calls, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/best-practices#avoid-blocking-calls) (doc)
