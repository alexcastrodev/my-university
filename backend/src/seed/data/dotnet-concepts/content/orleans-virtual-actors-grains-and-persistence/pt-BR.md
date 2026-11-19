---
version: 1.0
updatedAt: 2026-11-19
title: "Orleans: Atores Virtuais, Grains e Persistência"
summary: Grains do Orleans 10.4.2 como atores virtuais medidos localmente, sem Docker: ativação sob demanda e coleta por ociosidade, turnos sem lock, deadlock A para B para A, IPersistentState em memória contra PostgreSQL, timers contra reminders, StatelessWorker, placement e um cluster de 2 silos com um silo morto por kill -9.
---
## Objective

Orleans é o framework .NET de atores virtuais (o modelo do paper de 2014 da
Microsoft Research): você escreve uma classe (um grain) que guarda estado e trata
uma requisição por vez, endereça por chave, e o runtime decide onde ele vive, cria
na primeira chamada, remove quando ocioso e recria em outro lugar se o servidor
cair. Você nunca cria, localiza nem destrói um grain, e nunca escreve um lock.
Esta lição mede tudo em uma máquina, sem Docker, até um cluster de 2 silos com um
deles morto por `kill -9`. Versões: `Microsoft.Orleans.Server`, `.Client`,
`.Persistence.AdoNet` e `.Reminders.AdoNet` 10.4.2 (estável, 2026-10-30,
`net10.0`), `Npgsql` 10.0.3, PostgreSQL 18 iniciado localmente com `initdb`,
`net10.0`, SDK 10.0.100.

## Use Cases

- Um objeto por entidade, com estado e fluxo de comandos: sessão de jogo, carrinho,
  gêmeo digital de dispositivo, sala de chat.
- Trocar "carrega, altera, salva e torce" por um dono por chave, e agendas por
  entidade que sobrevivem a restart (fechar pedido não pago em 30 min).

## Deep Dive

### Grain, silo e o host

Um grain é uma interface mais uma classe, um silo é um processo host do runtime, e
o `IGrainFactory` entrega referências por chave. Uma referência é um proxy: obter
uma não cria nada.

```csharp
[Alias("IHello")] public interface IHelloGrain : IGrainWithStringKey { [Alias("Hi")] Task<string> Hi(); }
public class HelloGrain : Grain, IHelloGrain   // OnActivateAsync/OnDeactivateAsync registram ACTIVATE/DEACTIVATE
{
    int _calls;                                   // campo comum, sem lock
    public Task<string> Hi() => Task.FromResult($"hello from '{this.GetPrimaryKeyString()}', call #{++_calls}");
}

var b = Host.CreateApplicationBuilder();
b.UseOrleans(s => s.UseLocalhostClustering(siloPort: 5961, gatewayPort: 5962)
    .Configure<GrainCollectionOptions>(o => { o.CollectionAge = TimeSpan.FromSeconds(3); o.CollectionQuantum = TimeSpan.FromSeconds(1); }));
using var host = b.Build(); await host.StartAsync();   // IGrainFactory gf em host.Services: gf.GetGrain<IHelloGrain>("ana").Hi()
```

`UseLocalhostClustering` é o clustering de desenvolvimento; `[Alias]` mantém o nome no fio estável.

### Identidade e ativação sob demanda

A chave é a identidade: `IGrainWithStringKey`, `IGrainWithGuidKey`,
`IGrainWithIntegerKey`, ou uma chave composta `Guid` ou `long` mais uma string
(todas medidas). Chamando `ana` duas vezes, `bob`, ocioso por 6 s com
`CollectionAge` de 3 s, e `ana` de novo:

```text
[  0.0s]   ACTIVATE   HelloGrain 'ana' ... call #1, call #2
[  0.0s]   ACTIVATE   HelloGrain 'bob'
[  3.9s]   DEACTIVATE HelloGrain 'ana' after 2 calls, reason: ActivationIdle
[  3.9s]   DEACTIVATE HelloGrain 'bob' after 1 calls, reason: ActivationIdle
[  6.0s]   ACTIVATE   HelloGrain 'ana' ... call #1
```

A ativação aparece na primeira chamada, nunca em `GetGrain`. Depois da coleta por
ociosidade, `ana` voltou com `call #1`: só a ativação foi removida, não o grain,
então os campos sumiram. O grain "sempre existe" para quem chama, e é isso que o
torna virtual; o que precisa sobreviver exige persistência. Defaults medidos:
`CollectionAge` 15 min e `CollectionQuantum` 1 min (baixados aqui).

### Turnos: sem race, sem lock

Cada ativação roda um turno por vez. 100.000 chamadas `Inc()` disparadas juntas
contra um grain, comparadas ao mesmo laço em um `int` compartilhado comum:

```text
grain Inc():          100000 of 100000 in 678 ms
grain IncSlow():       10000 of 10000 (read, await, write)
[Reentrant] IncSlow:       2 of 10000 (read, await, write)
shared int, Task.Run:  35922 of 100000 (no grain, no lock)
```

`IncSlow` é `var v = _n; await Task.Yield(); _n = v + 1;`, uma atualização perdida
atravessando um `await`. Num grain normal ela fica exata porque a próxima
requisição só começa quando a atual termina, `await`s incluídos. `[Reentrant]`
deixa requisições rodarem no `await` (uma thread, intercalado) e o resultado caiu
para 2. O `int` compartilhado perdeu cerca de dois terços, e muda a cada execução.

### Reentrância e o deadlock A para B para A

A chama B, B chama A de volta e A ainda espera B: a nova requisição nunca começa.
A segunda execução usa `using (RequestContext.AllowCallChainReentrancy())` em A.

```text
after 3.9s: TimeoutException: Response did not arrive on time in 00:00:03 for message: Request [...]->[... ping/A] IPingGrain[(IPingGrain)PingGrain].StartChain(...)
AllowCallChainReentrancy(), after 2 ms: A2 got: B2 got: pong from A2
```

Não há detector de deadlock: a chamada espera `SiloMessagingOptions.ResponseTimeout`
(30 s por padrão, 3 aqui) e falha com `TimeoutException`. A reentrância de cadeia
só readmite chamadas da mesma cadeia, então o ciclo se resolve em 2 ms sem tornar
o grain reentrante (`[AlwaysInterleave]`, `[ReadOnly]`: só documentação).

### Persistência com IPersistentState

O estado é uma classe com membros `[GenerateSerializer]` e `[Id(n)]`, injetada
como `IPersistentState<T>` e salva só quando você chama `WriteStateAsync()`:

```csharp
public class CartGrain([PersistentState("cart", "store")] IPersistentState<CartState> cart) : Grain, ICartGrain
{
    public async Task<string> Add(string item, bool save)
    {   // OnActivateAsync registra cart.RecordExists, cart.State.Items.Count, cart.Etag
        cart.State.Items.Add(item);
        if (save) { cart.State.Writes++; await cart.WriteStateAsync(); }
        return Show();
    }
}
// silo: s.AddMemoryGrainStorage("store");   ou
//       s.AddAdoNetGrainStorage("store", o => { o.Invariant = "Npgsql"; o.ConnectionString = pg; });
```

Um processo adiciona `apple` e salva, um novo lê, com memória e com PostgreSQL
(scripts `OrleansQuery` e `OrleansStorage` do repositório do Orleans, rodados uma
vez). Uma segunda execução no PostgreSQL adiciona `pear` sem salvar:

```text
memory  run 1: after add: [apple] writes=1 etag=7c28f1c17cb542e89e602627e95d08b1
memory  run 2: RecordExists=False, items=0, etag=null
adonet  run 1: after add: [apple] writes=1 etag=1
adonet  run 2: RecordExists=True, items=1, etag=1 ; after add: [apple,pear] writes=1 etag=1 (no WriteStateAsync)
adonet  run 3: RecordExists=True, items=1 ; [apple] writes=1
```

O storage em memória perde tudo num restart. O PostgreSQL manteve o estado, e o
`pear` se perdeu porque ninguém chamou `WriteStateAsync`: alterar `State` não é
salvar. `Etag` é a versão da linha (escrita velha falha com `InconsistentStateException`,
só documentação). O ADO.NET não traz script de SQLite, então o storage local foi o PostgreSQL.

### Timers contra reminders

Um timer de grain vive na ativação; um reminder é uma linha numa tabela.

```csharp
this.RegisterGrainTimer(() => { Log($"timer tick {++_ticks}"); return Task.CompletedTask; },
    new GrainTimerCreationOptions { DueTime = TimeSpan.FromSeconds(1), Period = TimeSpan.FromSeconds(1), KeepAlive = false });
await this.RegisterOrUpdateReminder("wake-up", TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(8));  // + IRemindable.ReceiveReminder
```

Os dois registrados, `CollectionAge` de 3 segundos, reminders no PostgreSQL:

```text
[  2.0s]   timer tick 2 ; REMINDER 'wake-up' fired (this activation had 2 timer ticks)
[  7.0s]   timer tick 7
[  7.8s]   DEACTIVATE ClockGrain (ActivationIdle)
[ 10.0s]   ACTIVATE   ClockGrain
[ 10.0s]   REMINDER 'wake-up' fired (this activation had 0 timer ticks)
```

O timer bateu por 7 segundos sem impedir a coleta por ociosidade (`KeepAlive`
falso é o padrão; com `true` ele bateu até o fim da execução). Depois da
desativação o timer sumiu e o reminder ativou o grain de novo, com zero ticks. O
reminder é durável: um silo novo, sem chamada a grain, ativou o grain e disparou o
reminder 1,1 segundo depois de subir, enquanto o `UseInMemoryReminderService` não
disparou nada após um restart. Períodos abaixo de
`ReminderOptions.MinimumReminderPeriod` (1 minuto por padrão, 1 s aqui) são
rejeitados: reminders servem para agendas grossas.

### StatelessWorker, placement e um cluster de 2 silos

`[StatelessWorker]` transforma uma chave em um pool de ativações intercambiáveis,
locais a cada silo, que cresce enquanto as existentes estão ocupadas:

```text
StatelessWorker: 10 concurrent calls (200 ms each) to key 1 -> 10 activations, 230 ms (cores: 14)
normal grain:    10 concurrent calls (200 ms each) to key 1 -> 1 activation, 2010 ms
```

O teto por silo é o número de cores, e as ativações não são endereçáveis
individualmente. Para o placement, os silos `5963` (gateway `5964`) e `5965` (gateway `5966`, primário `5963`) são dois
processos com o mesmo PostgreSQL, e o cliente conecta nos dois gateways. 40
grains por estratégia (atributo na classe):

```text
default (resource-opt.) silo 5963: 18 grains  silo 5965: 22 grains
[RandomPlacement]       silo 5963: 20 grains  silo 5965: 20 grains
PreferLocal             silo 5963: 20 grains  silo 5965: 20 grains
HashBased               silo 5963: 29 grains  silo 5965: 11 grains
ActivationCountBased    silo 5963: 20 grains  silo 5965: 20 grains
```

`PreferLocal` significa o silo que recebeu a chamada, e o cliente alternou os
gateways. `HashBased` deu 29 contra 11 em toda execução: é função da chave. O
default sem atributo é o resource-optimized (CPU e memória) desde o Orleans 9.2,
não aleatório, e a divisão variou entre execuções.

Failover: dez carrinhos salvos no PostgreSQL, silos reiniciados, o carrinho `c3`
no `5965`, um cliente chamando-o a cada 500 ms durante um `kill -9` no `5965`:

```text
[  0.0s] c3 -> [apple] writes=1 silo=5965
[  5.0s] c3 -> OrleansMessageRejectionException: Exception while sending message: Orleans.Runtime.Messaging.ConnectionFailedException: Unable to conn...
[  5.5s] c3 -> [apple] writes=1 silo=5963
```

Uma chamada falhou com erro de conexão; a seguinte, 0,5 segundo depois, foi
atendida pelo silo sobrevivente, que ativou `c3` e leu o estado do PostgreSQL.
Quem chama nunca soube de endereço: o grain "sempre existe". O cliente precisa
repetir a chamada que falhou, o Orleans não repete. Com storage em memória o item
também sobreviveu, provavelmente porque esse provider guarda os dados em grains de
storage do cluster (`NumStorageGrains`) e o silo morto não segurava aquele: não é
durabilidade. A detecção de falha estava mais rápida que o padrão (1 s, 2 probes,
1 voto; padrão 5 s, 3, 2). No `UseLocalhostClustering` o primário é a tabela de
membership, então matei o secundário; produção usa tabela real (ADO.NET, Azure,
Redis, Kubernetes), só documentação.

### O que "uma ativação" realmente garante

A documentação diz que existe no máximo uma ativação por vez, mas o directory
padrão do cluster é eventualmente consistente e "allows occasional duplicate
activations during cluster instability". O fortemente consistente
(`AddDistributedGrainDirectory`, preview no Orleans 10 segundo a doc, presente no
10.4.2) evita isso ao custo de coordenação; a doc se contradiz sobre qual é o
padrão. Não medi duplicatas: assuma que o padrão pode gerá-las, e que um silo
declarado morto roda até ler seu próprio status.

## Trade-offs

- **Orleans vs serviço HTTP sem estado com banco.** O serviço escala trivialmente,
  mas todo update é ler, alterar e gravar com lock ou retry otimista. O Orleans dá
  um dono por chave e estado em memória, ao preço de um runtime, uma tabela de
  membership e um modelo mental novo. Entidades quentes e pequenas combinam;
  relatórios sobre o dataset inteiro não.
- **Orleans vs Akka.NET vs Dapr actors.** O Akka.NET (não rodado aqui) é explícito:
  você cria e supervisiona atores, mais controle e mais código. O Orleans esconde
  o ciclo de vida. Dapr actors trazem a mesma ideia por um sidecar, de qualquer
  linguagem, com saltos extras de rede (não medido). Orleans é .NET in-process.
- **Quando não usar.** CRUD sem contenção, analytics em lote, consultas entre
  entidades (um grain não tem índice secundário), um time que não vai operar um
  cluster, ou uma instância que cabe num processo (um `ConcurrentDictionary`).
- **A consistência é mais fraca do que "um único escritor" sugere.** Duplicatas são
  possíveis na instabilidade, uma chamada que falhou pode ou não ter executado, e
  um grain bloqueado (`.Result`) trava a sua chave: torne os comandos idempotentes.
  Atomicidade entre grains pede transações do Orleans ou uma saga (só documentação).
- **Estado e timers.** `State` alterado sem `WriteStateAsync` se perde na
  desativação, e é lido por inteiro a cada ativação: mantenha-o pequeno. Um timer
  morre com a ativação; um reminder sobrevive, mas custa uma linha e tem período
  mínimo de 1 minuto por padrão.

## Documentation Links

- [Request scheduling and reentrancy, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/grains/request-scheduling) (doc)
- [Grain persistence, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-persistence/) (doc)
- [Timers and reminders, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/grains/timers-and-reminders) (doc)
- [Grain placement, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/grains/grain-placement) (doc)
- [Grain directory, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/host/grain-directory) (doc)
- [Cluster management, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/orleans/implementation/cluster-management) (doc)
- [Orleans repository and releases, GitHub](https://github.com/dotnet/orleans) (doc)
- [Orleans: Distributed Virtual Actors for Programmability and Scalability, Bernstein et al., Microsoft Research 2014](https://www.microsoft.com/en-us/research/publication/orleans-distributed-virtual-actors-for-programmability-and-scalability/) (paper)
