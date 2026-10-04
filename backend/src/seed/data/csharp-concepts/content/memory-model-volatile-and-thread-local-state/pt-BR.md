---
version: 1.0
updatedAt: 2026-10-04
title: "Modelo de Memória, volatile e Estado Local à Thread"
summary: O que uma thread enxerga das escritas de outra, volatile e Volatile.Read, double-checked locking vs Lazy<T>, Interlocked como barreira completa e ThreadLocal vs ThreadStatic vs AsyncLocal.
---
## Objective

Duas threads lendo e escrevendo o mesmo campo não têm garantia de enxergar as
escritas uma da outra na ordem que o código-fonte sugere. O compilador, o JIT e
a CPU podem reordenar operações, e um valor escrito por uma thread pode ficar
num registrador ou num cache que a outra nunca consulta. Este conceito cobre as
regras que decidem o que uma thread pode observar da outra: o que `volatile`,
`Volatile.Read` e `Volatile.Write` garantem e o que não garantem, como publicar
um objeto compartilhado uma única vez (double-checked locking bem feito, ou
`Lazy<T>` no lugar), o que o `Interlocked` acrescenta e como guardar estado por
thread (`[ThreadStatic]`, `ThreadLocal<T>`) ou por fluxo lógico de controle
(`AsyncLocal<T>`) sem vazá-lo entre requisições.

## Use Cases

- Um laço em segundo plano que precisa parar quando outra thread liga uma flag
  `_stop`.
- Um singleton criado de forma preguiçosa, como uma configuração já lida ou uma
  regex compilada, que muitas threads pedem na inicialização.
- Um contador atualizado por muitas threads sem tomar um lock.
- Um id de correlação que toda linha de log de uma requisição deve carregar, sem
  passá-lo por cada método.
- Um bug que nunca reproduz no notebook x64 de quem desenvolve e aparece num
  servidor ARM64.

## Deep Dive

### Por que uma thread pode não enxergar a escrita de outra

Este laço pode rodar para sempre numa build otimizada, porque nada diz ao
compilador que `_stop` pode mudar por baixo dele, então ele pode ler o campo uma
vez e manter o valor num registrador:

```csharp
private bool _stop;

void Worker()
{
    while (!_stop) { /* trabalho */ } // o JIT pode tirar a leitura de _stop de dentro do laço
}

void Stop() => _stop = true;         // outra thread
```

O modelo de memória do .NET é permissivo: leituras e escritas podem ser
reordenadas desde que uma única thread não perceba a diferença. A documentação
diz apenas que compiladores e processadores podem reordenar operações de memória.
Na prática, o hardware x64 é bastante rígido, então algumas reordenações nunca
acontecem nele e escondem bugs, enquanto o ARM64 é mais fraco e o mesmo código
pode se comportar mal nele. Um
teste que passa em x64 prova menos do que parece.

### volatile, Volatile.Read e Volatile.Write

Marcar o campo como `volatile` faz toda leitura ser um acquire e toda escrita
ser um release. Uma leitura com semântica de acquire não pode ser movida para
depois de leituras e escritas posteriores, e uma escrita com semântica de
release não pode ser movida para antes de leituras e escritas anteriores. O
laço acima fica correto:

```csharp
private volatile bool _stop;
```

`Volatile.Read` e `Volatile.Write` aplicam a mesma regra a um único acesso, em
vez de a todo acesso ao campo, o que serve para um campo que normalmente é
tocado sob um lock e só às vezes lido sem ele:

```csharp
// Publica: tudo que foi escrito antes do release fica visível para quem enxerga a flag.
_config = BuildConfig();
Volatile.Write(ref _ready, true);

// Consome
if (Volatile.Read(ref _ready))
    Use(_config);
```

O que `volatile` não dá: read-modify-write atômico (`_count++` continua sendo
uma leitura, uma soma e uma escrita) e ordenação entre uma escrita e a leitura
de uma variável diferente. Acquire e release juntos ainda permitem que esse par
seja trocado de lugar, que é exatamente o que quebra algoritmos no estilo
Dekker, do tipo "ligo a minha flag, depois confiro a sua". O `volatile` também não
garante que uma leitura veja o último valor escrito por outro processador, nem uma
ordem total única das escritas voláteis vista por todas as threads. A documentação
alerta que o `volatile` é muito mal usado e aponta `Interlocked`, `lock` e
primitivas de nível mais alto como o padrão mais seguro. Com `Volatile.Read` e
`Volatile.Write` a garantia vale para um acesso por vez, então todo acesso ao campo
precisa passar por eles para sincronizá-lo.

### Publicando uma vez: double-checked locking ou Lazy

Criar um objeto compartilhado no primeiro uso exige três coisas ao mesmo tempo:
uma única instância, nenhum lock no caminho rápido e as outras threads vendo um
objeto completamente construído. A versão escrita à mão só funciona com um
campo `volatile`:

```csharp
private static volatile Settings? _settings;
private static readonly object _gate = new();

static Settings Get()
{
    var s = _settings;
    if (s is not null) return s;       // caminho rápido, sem lock
    lock (_gate)
    {
        return _settings ??= Load();   // segunda checagem sob o lock
    }
}
```

Sem o `volatile`, um leitor poderia ver a referência antes das escritas do
construtor (num modelo de memória fraco) e usar um objeto pela metade. O
`Lazy<T>` faz tudo isso por você, e o `LazyThreadSafetyMode` diz qual troca
você quer:

```csharp
private static readonly Lazy<Settings> _settings =
    new(Load, LazyThreadSafetyMode.ExecutionAndPublication); // o padrão: uma chamada da factory, as outras esperam

// PublicationOnly: várias threads podem executar a factory, o primeiro resultado vence e uma
// exceção não é guardada. None: nenhuma segurança entre threads, para uso em uma thread só.
```

Para um campo que já existe num tipo, `LazyInitializer.EnsureInitialized` evita
alocar um `Lazy<T>` por instância:

```csharp
private Settings? _settings;
Settings Settings => LazyInitializer.EnsureInitialized(ref _settings, Load);
```

### Interlocked e barreiras

`Interlocked.Increment`, `Exchange` e `CompareExchange` são operações
read-modify-write atômicas. Nos runtimes atuais elas também funcionam como
barreiras de memória completas, então nada atravessa por elas em nenhuma direção,
embora a documentação de `Interlocked` não prometa isso e ofereça
`MemoryBarrier()` para uma barreira explícita. Isso as torna a
ferramenta certa para um contador compartilhado ou uma flag reivindicada por
exatamente uma thread:

```csharp
Interlocked.Increment(ref _requests);

if (Interlocked.CompareExchange(ref _started, 1, 0) == 0)
    Start(); // só a thread que trocou 0 por 1 chega aqui
```

`Thread.MemoryBarrier()` é uma barreira completa avulsa. Use-a apenas quando
estiver construindo uma estrutura lock-free e puder dizer qual reordenação está
impedindo. Uma instrução `lock` já dá acquire na entrada e release na saída,
então um dado protegido por lock não precisa de `volatile`.

### Estado por thread e por fluxo

Três ferramentas guardam um valor que muda conforme o contexto, e respondem a
perguntas diferentes:

```csharp
[ThreadStatic] private static int t_depth;              // um valor por thread do SO, sem inicializador por thread
private static readonly ThreadLocal<Random> s_rng =
    new(() => new Random());                            // um valor por thread, criado sob demanda, IDisposable
private static readonly AsyncLocal<string?> s_correlationId = new(); // um valor por fluxo assíncrono lógico
```

`[ThreadStatic]` é a mais barata e tem uma armadilha: um inicializador como
`= 5` roda apenas para a primeira thread que toca o campo, e todas as outras
começam no valor padrão. `ThreadLocal<T>` recebe uma factory que roda uma vez
por thread. `AsyncLocal<T>` acompanha o `ExecutionContext`, então seu valor
atravessa o `await` mesmo quando a continuação roda em outra thread, e um
`Task.Run` ou `ThreadPool.QueueUserWorkItem` iniciado a partir desse fluxo herda
uma cópia. Na prática, uma mudança feita dentro de um método assíncrono chamado não fica visível para quem chamou depois que a chamada retorna, porque o contexto de quem chamou é restaurado (as páginas oficiais não afirmam isso; é comportamento observado, então confirme com um teste pequeno).

```csharp
s_correlationId.Value = "req-42";
await DoWorkAsync();        // continua "req-42" lá dentro, mesmo se retomar em outra thread
```

## Trade-offs

- **`volatile` resolve visibilidade, não atomicidade.** É a ferramenta certa para
  uma flag escrita por uma thread e lida por outras, e a errada para um
  contador.
  ```csharp
  private volatile int _count;
  _count++;                    // atualizações perdidas sob contenção
  Interlocked.Increment(ref _count); // correto
  ```
- **Double-checked locking escrito à mão é fácil de quebrar.** Tirar o
  `volatile`, ler o campo duas vezes em vez de copiá-lo para uma variável local
  ou devolver o campo fora do lock reabre uma corrida que testes em x64 raramente
  encontram. `Lazy<T>` e `LazyInitializer` são o padrão de menor risco.
- **`Lazy<T>` guarda uma falha.** No modo padrão, se a factory lança exceção, ela
  é armazenada e relançada a cada acesso, então um erro transitório vira
  permanente. `PublicationOnly` tenta de novo, mas pode executar a factory mais de
  uma vez, então a factory precisa ser segura para repetição.
- **Estado preso à thread quebra no `await`.** Depois de um `await`, o código pode
  retomar em outra thread, então um valor `[ThreadStatic]` ou `ThreadLocal<T>`
  definido antes some ou, pior, pertence a uma requisição sem relação numa thread
  do pool. Para dados do escopo da requisição, use `AsyncLocal<T>` ou um
  parâmetro explícito.
  ```csharp
  t_userId = 7;
  await Task.Delay(1);
  Console.WriteLine(t_userId); // pode imprimir 0, ou o valor de outra requisição
  ```
- **`AsyncLocal<T>` é estado implícito.** Um valor que flui de forma invisível por
  todas as chamadas é difícil de rastrear, e é copiado para cada novo fluxo, então
  objetos grandes guardados nele ficam retidos por mais tempo que o esperado.
  Prefira passar o valor como parâmetro quando a cadeia de chamadas for curta, e
  reserve o `AsyncLocal<T>` para dados ambientais, como um id de trace ou de
  correlação.
- **`ThreadLocal<T>` precisa de dispose.** Um `ThreadLocal<T>` de vida longa criado
  por objeto mantém os slots por thread vivos até ser descartado, e com
  `trackAllValues: true` mantém o valor de toda thread alcançável.

## Documentation Links

- [volatile keyword, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/volatile) (doc)
- [Volatile class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.volatile) (doc)
- [Lazy initialization, .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/framework/performance/lazy-initialization) (doc)
- [LazyThreadSafetyMode enum, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.lazythreadsafetymode) (doc)
- [Interlocked class, System.Threading, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.interlocked) (doc)
- [ThreadLocal<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.threadlocal-1) (doc)
- [AsyncLocal<T> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.asynclocal-1) (doc)
- [ThreadStaticAttribute class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threadstaticattribute) (doc)
