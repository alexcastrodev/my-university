---
version: 1.0
updatedAt: 2026-10-04
title: "Locks, Monitor e Interlocked"
summary: O que lock compila de fato, System.Threading.Lock, o que nunca usar como alvo, Interlocked e laços CAS, ReaderWriterLockSlim, por que não dá para usar await dentro de lock e como a ordem dos locks evita deadlock.
---
## Objective

Duas threads que mexem no mesmo estado mutável sem coordenação produzem bugs que
aparecem uma vez por semana e nunca no debugger. O C# dá uma escada de
ferramentas: `lock` para exclusão mútua, `Interlocked` para uma única operação
atômica sem lock, `ReaderWriterLockSlim` para muitos leitores e escritas raras,
e `Monitor.Wait` e `Pulse` para esperar uma condição. Cada uma tem um custo e um
modo de falha. Este conceito cobre o que o `lock` realmente compila, o tipo
dedicado `System.Threading.Lock`, os objetos em que você nunca deve travar, como
`Interlocked` e os laços de compare-and-swap funcionam, por que não dá para usar
`await` dentro de um `lock` e como a ordem dos locks decide se você tem
deadlock.

## Use Cases

- Proteger um dicionário compartilhado usado como cache por várias threads de
  requisição.
- Contar requisições ou bytes de muitas threads sem pegar um lock a cada
  atualização.
- Um objeto de configuração lido a cada requisição e substituído uma vez por
  hora.
- Um produtor que precisa esperar até que um consumidor libere espaço num
  buffer.
- Mover dinheiro entre duas contas, cada uma protegida por seu próprio lock, sem
  nunca congelar o processo.

## Deep Dive

### O que o `lock` compila

Um `lock` é atalho para adquirir um `Monitor` e liberá-lo num `finally`, então o
lock é liberado mesmo quando o corpo lança exceção:

```csharp
private readonly object _gate = new();
private readonly Dictionary<string, int> _hits = new();

public void Hit(string key)
{
    lock (_gate)
    {
        _hits[key] = _hits.GetValueOrDefault(key) + 1;
    }
}

// Aproximadamente o que o compilador gera:
bool taken = false;
try
{
    Monitor.Enter(_gate, ref taken);
    _hits[key] = _hits.GetValueOrDefault(key) + 1;
}
finally
{
    if (taken) Monitor.Exit(_gate);
}
```

O lock é reentrante: a mesma thread pode pegá-lo de novo sem bloquear, então um
método que segura o lock pode chamar outro método que também trava. As outras
threads esperam até o dono sair. Mantenha o corpo curto e nunca chame código que
você não controla (callbacks, métodos virtuais, eventos) enquanto o segura.

### `System.Threading.Lock`

Desde o .NET 9 e o C# 13 existe um tipo de lock dedicado. Quando o alvo do `lock`
tem o tipo estático `Lock`, o compilador usa a API própria dele em vez de
`Monitor`, o que é mais barato e declara a intenção no tipo:

```csharp
private readonly Lock _gate = new();

public void Hit(string key)
{
    lock (_gate) // compila para using (_gate.EnterScope()) { ... }
    {
        _hits[key] = _hits.GetValueOrDefault(key) + 1;
    }
}

if (_gate.TryEnter())
{
    try { /* ... */ }
    finally { _gate.Exit(); }
}
```

Em código novo no .NET 9 ou posterior, inclusive no .NET 10, declare o campo como
`Lock` em vez de `object`. Não faça cast para `object` e trave nele: o compilador
volta à semântica de `Monitor`, e compiladores recentes avisam sobre isso.

### Nunca trave em algo que outros alcançam

Trave num objeto privado que existe só para isso. Estes alvos quebram o
isolamento, porque qualquer outro código pode travar na mesma instância e criar
um deadlock que você não vê de dentro da sua classe:

```csharp
lock (this) { }          // quem chama pode travar na sua instância
lock (typeof(Cache)) { } // o objeto Type é compartilhado pelo processo todo
lock ("cache") { }       // literais string são internados e compartilhados
```

### `Interlocked` e compare-and-swap

Para uma única atualização numérica, um lock é mais pesado que o necessário.
`Interlocked` corresponde a uma única instrução atômica da CPU:

```csharp
private long _requests;
public void Count() => Interlocked.Increment(ref _requests);
public long Total => Interlocked.Read(ref _requests);
```

`CompareExchange(ref location, newValue, comparand)` grava `newValue` só se
`location` ainda for igual a `comparand`, e sempre devolve o valor que viu. Um
laço em volta dele constrói qualquer atualização sem lock, como um máximo
corrente:

```csharp
private int _max;

public void Observe(int value)
{
    int seen = Volatile.Read(ref _max);
    while (value > seen)
    {
        int previous = Interlocked.CompareExchange(ref _max, value, seen);
        if (previous == seen) return; // vencemos a corrida
        seen = previous;              // outra thread mudou, tenta de novo com o novo valor
    }
}
```

### `ReaderWriterLockSlim`

Quando as leituras superam muito as escritas e cada leitura não é trivial, vários
leitores podem avançar juntos enquanto um escritor ganha acesso exclusivo:

```csharp
private readonly ReaderWriterLockSlim _rw = new();
private Config _config = Config.Default;

public Config Read()
{
    _rw.EnterReadLock();
    try { return _config; }
    finally { _rw.ExitReadLock(); }
}

public void Replace(Config next)
{
    _rw.EnterWriteLock();
    try { _config = next; }
    finally { _rw.ExitWriteLock(); }
}
```

`EnterUpgradeableReadLock` deixa uma thread ler e depois decidir escrever sem
soltar o lock, e só uma thread pode segurá-lo por vez. A instância é
`IDisposable`, então descarte-a junto com o dono.

### Por que não dá para usar `await` dentro de `lock`

```csharp
lock (_gate)
{
    await SaveAsync(); // erro CS1996: não é possível usar await no corpo de um lock
}
```

Um `Monitor` pertence a uma thread, e um `await` pode retomar numa thread
diferente, que não conseguiria liberar um lock que nunca adquiriu. Para exclusão
mútua assíncrona, use um `SemaphoreSlim` com uma vaga:

```csharp
private readonly SemaphoreSlim _mutex = new(1, 1);

public async Task SaveOnceAtATimeAsync(CancellationToken ct)
{
    await _mutex.WaitAsync(ct);
    try { await SaveAsync(ct); }
    finally { _mutex.Release(); }
}
```

Um `lock` continua válido dentro de um método `async`, desde que nenhum `await`
aconteça enquanto ele estiver seguro.

### Ordem dos locks e deadlock

Duas threads têm deadlock quando cada uma segura um lock de que a outra precisa.
O caso clássico é uma transferência entre duas contas chamada em direções
opostas ao mesmo tempo:

```csharp
// Thread 1: Transfer(a, b)   Thread 2: Transfer(b, a)   -> cada uma segura um lock e espera o outro.
public static void Transfer(Account from, Account to, decimal amount)
{
    var (first, second) = from.Id < to.Id ? (from, to) : (to, from); // uma ordem global
    lock (first.Gate)
    lock (second.Gate)
    {
        from.Balance -= amount;
        to.Balance += amount;
    }
}
```

Adquirir os locks numa única ordem combinada (aqui, pelo id) elimina o ciclo.

### Esperando uma condição com `Monitor.Wait` e `Pulse`

`Monitor.Wait` libera o lock e dorme até que outra thread chame `Pulse` ou
`PulseAll` no mesmo objeto. Espere sempre dentro de um laço que reverifica a
condição, porque um despertar não garante que ela seja verdadeira:

```csharp
lock (_gate)
{
    while (_queue.Count == 0)
        Monitor.Wait(_gate);
    return _queue.Dequeue();
}

// Produtor, segurando o mesmo lock:
lock (_gate) { _queue.Enqueue(item); Monitor.Pulse(_gate); }
```

Para código real de produtor e consumidor, prefira `Channel<T>` ou
`BlockingCollection<T>` a `Wait` e `Pulse` escritos à mão.

## Trade-offs

- **`lock` é simples e correto, e serializa.** Todas as threads esperam na fila,
  então uma seção crítica longa vira o limite de vazão do caminho inteiro.
  Mantenha no corpo só a atualização do estado compartilhado e faça I/O fora
  dele.
  ```csharp
  var snapshot = ComputeSlowResult();   // fora do lock
  lock (_gate) { _cache[key] = snapshot; } // só a escrita compartilhada dentro
  ```
- **`Interlocked` cobre uma variável, não uma invariante.** Duas atualizações
  atômicas separadas não são atômicas em conjunto, então um leitor pode ver uma
  alterada e a outra não. Quando dois campos precisam mudar juntos, use um lock
  ou troque um único objeto imutável por uma troca de referência.
  ```csharp
  Interlocked.Increment(ref _count);
  Interlocked.Add(ref _sum, value); // um leitor entre estas linhas vê count e sum fora de passo
  ```
- **`ReaderWriterLockSlim` não é automaticamente mais rápido.** Ele tem mais
  overhead que o `lock`, então para seções críticas curtas ou escritas frequentes
  um `lock` simples ganha. Ele também vem sem recursão por padrão e lança
  exceção se uma thread reentra.
- **Um laço CAS pode girar sob contenção.** Com muita contenção, várias threads
  repetem a tentativa e queimam CPU, então meça antes de trocar um lock por um.
- **`SemaphoreSlim` não é reentrante.** Um método que o segura e chama outro que
  também espera nele bloqueia para sempre, diferente do `lock`, que deixa a mesma
  thread entrar de novo.
- **Ordem fixa de locks exige disciplina.** Ela só funciona se todo caminho de
  código a seguir, e não ajuda quando o segundo lock é escolhido por um callback
  ou uma chamada virtual. Mantenha os escopos de lock pequenos e evite chamar
  código externo enquanto segura um.

## Documentation Links

- [lock statement, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/statements/lock) (doc)
- [Lock class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.lock) (doc)
- [What's new in C# 13, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/whats-new/csharp-13) (doc)
- [Interlocked class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.interlocked) (doc)
- [ReaderWriterLockSlim class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.readerwriterlockslim) (doc)
- [SemaphoreSlim class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.semaphoreslim) (doc)
- [Managed threading best practices, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/threading/managed-threading-best-practices) (doc)
