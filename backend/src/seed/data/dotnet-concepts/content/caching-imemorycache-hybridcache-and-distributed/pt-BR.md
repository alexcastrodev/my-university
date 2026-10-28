---
version: 1.0
updatedAt: 2026-10-28
title: "Cache: IMemoryCache, HybridCache e cache distribuído"
summary: IMemoryCache não é atômico (stampede), expiração preguiçosa, SizeLimit que descarta em silêncio, IDistributedCache, HybridCache com L1/L2 e uma única fábrica por chave, tags, o que a invalidação não alcança em outros servidores e os limites de payload e de chave, com o resultado medido de cada experimento.
---
## Objective

Um cache troca atualidade por velocidade, e a parte interessante é tudo o que dá errado em volta dessa troca: dez requisições recalculando o mesmo relatório ao mesmo tempo, um cache que cresce até o processo ser morto, uma invalidação que chega a um servidor e não ao outro. O .NET tem três APIs de cache e elas resolvem problemas diferentes. `IMemoryCache` é um dicionário com expiração dentro de um processo. `IDistributedCache` é um repositório de `byte[]` compartilhado entre servidores (Redis, SQL Server, Postgres). `HybridCache` coloca os dois atrás de uma chamada só e acrescenta o que faltava nos outros: apenas um chamador por chave executa o trabalho caro. Este conceito roda as três e relata o que de fato aconteceu: quantas vezes a fábrica executou, quais entradas foram mantidas, quais foram descartadas em silêncio e o que um segundo servidor enxerga depois que o primeiro invalida. Versões usadas: SDK 10.0.100, `Microsoft.Extensions.Caching.Memory` 10.0.14, `Microsoft.Extensions.Caching.Hybrid` 10.11.0.

## Use Cases

- Guardar o resultado de uma consulta ao banco ou de uma chamada a outro serviço que é cara e muda pouco.
- Proteger uma dependência lenta de uma rajada de requisições idênticas depois de um deploy ou da expiração de uma entrada.
- Compartilhar dados em cache entre várias instâncias de uma API atrás de um balanceador.
- Invalidar um grupo de entradas relacionadas (tudo sobre um cliente) quando a origem muda.

## Deep Dive

### IMemoryCache: simples, local e não atômico

O `IMemoryCache` vive no processo de um servidor. O registro é `AddMemoryCache()` (várias chamadas `Add*`, como `AddRazorPages`, já fazem isso) e o ponto de entrada usual é o `GetOrCreateAsync`. O método parece atômico, e não é. Dez chamadores concorrentes numa chave fria, com uma fábrica que leva 200 ms:

```csharp
var tasks = Enumerable.Range(0, 10).Select(_ => mem.GetOrCreateAsync("report", async e =>
{
    Interlocked.Increment(ref factoryRuns);
    await Task.Delay(200);
    return "data";
}));
await Task.WhenAll(tasks);
```

```text
10 concurrent callers, factory runs: 10
```

Os dez executaram a fábrica. Isso é um cache stampede: logo depois que uma entrada expira, todas as requisições concorrentes erram juntas e batem no banco juntas. A documentação diz o mesmo sobre repopular a partir de um callback ("várias threads repopulando o item em cache"). O `IMemoryCache` é thread-safe, mas não coordena o trabalho que o preenche.

### Expiração: só sliding pode viver para sempre

Existem duas opções de tempo: `SlidingExpiration` (renovada a cada leitura) e `AbsoluteExpirationRelativeToNow` (um prazo rígido). Toquei duas entradas a cada 200 ms, ambas com janela sliding de 300 ms, e uma delas também com limite absoluto de 800 ms:

```text
t=600  ms: sliding-only=True, sliding+absolute(800)=True
t=800  ms: sliding-only=True, sliding+absolute(800)=False
t=1200 ms: sliding-only=True, sliding+absolute(800)=False
```

Uma entrada só com janela sliding nunca expira enquanto continuar sendo lida, então uma chave quente pode servir dado velho indefinidamente. Sempre combine sliding com um limite absoluto, ou use só o absoluto.

### A expiração é preguiçosa

Nada no `MemoryCache` roda num timer. Uma entrada expirada é removida quando você lê aquela chave, ou quando uma varredura periódica roda, e a varredura é limitada por `ExpirationScanFrequency`, que por padrão é um minuto (`00:01:00`):

```text
default scan, 500 ms after a 200 ms entry expired, nobody read it: count=1
reading the expired key itself: hit=False, count=0, callbacks=y:Expired
```

Com `ExpirationScanFrequency = 100 ms`, tocar em qualquer outra chave depois que a entrada expirou a removeu e disparou o callback de despejo (`x:Expired`). Com o padrão, uma entrada expirada e não lida continua ocupando memória e continua no `Count` por até um minuto. A memória não cai no instante da expiração.

### Limite de tamanho: o cache não vigia a sua memória

A documentação afirma que o runtime não esvazia o cache sob pressão de memória. Sem `SizeLimit` ele cresce sem limite, e a expiração sozinha não segura um cache alimentado por muitas chaves diferentes. Com limite, toda entrada precisa declarar um tamanho, na unidade que você escolher (1 por entrada transforma o limite numa contagem):

```csharp
using var mem = new MemoryCache(new MemoryCacheOptions { SizeLimit = 3 });
mem.Set("nosize", "x");   // lança exceção
```

```text
InvalidOperationException: Cache entry must specify a value for Size when SizeLimit is set.
```

Depois inseri quatro entradas de tamanho 1 num cache com limite 3, e uma de tamanho 10:

```text
after 4 inserts of size 1, limit 3: count=3, a=True, d=False
after 300 ms: count=3, a=True, b=True, c=True, d=False
entry of size 10 (> limit 3): cached=False
no SizeLimit, Size=999 ignored: cached=True
```

A quarta entrada foi descartada sem exceção: o `Set` voltou normalmente e o `d` simplesmente não estava lá, então um erro causado pelo limite se parece com qualquer outro erro de cache. Mais dois fatos: sem limite, o `Size` é ignorado, e um `SizeLimit` no cache compartilhado do DI pode quebrar outras bibliotecas que inserem entradas sem tamanho, por isso a documentação recomenda uma instância dedicada para o uso com limite.

### Chaves: nunca entrada crua do usuário

As três APIs tratam a chave como uma string opaca. A documentação avisa contra usar entrada crua do usuário em chaves: um cliente pode inundar o cache com chaves aleatórias (crescimento de memória, negação de serviço) ou alcançar entradas que não deveria. Monte chaves a partir de identificadores confiáveis e use um delimitador, porque `$"order{customerId}{orderId}"` gera `order42123` tanto para o cliente 42 pedido 123 quanto para o cliente 421 pedido 23. Prefira `$"order/{customerId}/{orderId}"`.

### IDistributedCache: bytes compartilhados entre servidores

O `IDistributedCache` guarda `byte[]` e não tem noção de objetos, tags nem proteção contra stampede. As implementações vêm de pacotes (`Microsoft.Extensions.Caching.StackExchangeRedis`, `.SqlServer`, `.Postgres`). `AddDistributedMemoryCache()` registra uma implementação em processo que a documentação chama de útil para desenvolvimento, testes e um único servidor em produção: ela não é distribuída. A serialização fica por sua conta, e esse é o principal motivo de se escrever o mesmo código de ler, desserializar, errar, carregar, serializar e gravar em todo serviço.

### HybridCache: uma chamada, dois níveis, uma fábrica

O `HybridCache` (pacote `Microsoft.Extensions.Caching.Hybrid`, registrado com `AddHybridCache()`) é a abstração a usar em código novo. O cache primário (L1) é o `MemoryCache` do processo. Se houver um `IDistributedCache` registrado, ele vira o cache secundário (L2) e a serialização entra em cena (`string` e `byte[]` de forma nativa, `System.Text.Json` para o resto).

```csharp
builder.Services.AddHybridCache();

app.MapGet("/orders/{id:int}", async (int id, HybridCache cache, OrderDb db, CancellationToken ct) =>
    await cache.GetOrCreateAsync($"order/{id}", async token => await db.LoadAsync(id, token), cancellationToken: ct));
```

O mesmo teste de stampede de antes, agora pelo `HybridCache` (só L1):

```text
10 concurrent callers, factory runs: 1
```

Um chamador executou a fábrica e os outros nove esperaram o resultado dele. O `CancellationToken` da fábrica só é cancelado quando todos os chamadores que esperam cancelaram. Padrões lidos de volta em `IOptions<HybridCacheOptions>`:

```text
MaximumPayloadBytes=1048576, MaximumKeyLength=1024, DefaultEntryOptions=null
```

Três comportamentos que vale conhecer, todos medidos:

```text
factory throws twice: runs=2   (a failure is not cached)
expiration 300 ms: runs=2      (entry expired, factory ran again)
3 calls with a 1025-char key: factory runs=3, with a 1024-char key: runs=1
```

Uma chave maior que `MaximumKeyLength` ignora o cache e registra um erro (`Cache key maximum length exceeded (maximum: 1024, actual: 1025)`), então toda chamada paga o preço cheio. Não monte chaves a partir de texto sem limite.

### O que a proteção contra stampede não cobre

A coordenação é por instância de `HybridCache`. Três nós, cinco chamadores concorrentes cada, uma chave fria, um L2 compartilhado:

```text
3 nodes x 5 concurrent callers, cold key: factory runs=3
```

Uma execução por nó, e não uma no total. A documentação também diz isso: a coordenação não se estende a outras instâncias, mesmo que compartilhem o mesmo cache secundário. Para uma fábrica muito cara você ainda precisa de um lock ou de um desenho com escritor único fora do cache.

### Tags, e o que a invalidação realmente faz

As entradas podem ser agrupadas com tags e removidas juntas com `RemoveByTagAsync`:

```csharp
var tags = new[] { "customer:42" };
await cache.GetOrCreateAsync("order:1", Load, tags: tags);
await cache.RemoveByTagAsync("customer:42");
```

```text
tags: v1, v1, after RemoveByTagAsync -> v2, factory runs=2
tag '*': ArgumentException: The tag '*' is reserved and cannot be used in this context.
tag '  ': ArgumentException: Tags cannot be empty.
```

A documentação explica o mecanismo: a invalidação por tag é lógica, não física. O `RemoveByTagAsync` registra "ignore tudo o que foi criado antes deste momento" para a tag, e os valores antigos continuam nos repositórios até expirarem. `RemoveByTagAsync("*")` invalida tudo, mas não existem padrões glob.

### Os outros servidores mantêm o L1

Simulei dois servidores com dois service providers compartilhando um `IDistributedCache`, cada um com `LocalCacheExpiration` de 2 s e `Expiration` de 30 s:

```text
A computes -> A-v1; B reads -> A-v1; L2 entries=1; factory runs A=1 B=0
after A.RemoveByTagAsync: A -> A-v2; B (same moment) -> A-v1
after B's local expiration (2 s): B -> A-v2
RemoveAsync on A; B still serves: A-v3 (it was A-v3)
```

O B nunca executou a fábrica dele: ele se encheu a partir do L2. Depois que o A invalidou, o B continuou servindo o valor antigo do próprio L1 até o `LocalCacheExpiration` passar. Isso confere com a documentação: a invalidação por chave e por tag chega ao servidor atual e ao repositório fora do processo, e o cache em memória dos outros servidores não é afetado. Num deploy com várias instâncias, o `LocalCacheExpiration` é o seu orçamento de defasagem, então mantenha-o curto para dados que precisam convergir rápido.

### HybridCache sem um L2 de verdade ainda é útil

O `AddDistributedMemoryCache()` não é usado como L2. Registrei-o ao lado de `AddHybridCache()` e depois pedi a chave ao `IDistributedCache`:

```text
IDistributedCache.Get("k") is null (HybridCache did not write to it)
```

Isso confere com a documentação: ele só duplicaria o L1 no mesmo processo. Você continua com o L1 e a proteção contra stampede, então migrar código de `IMemoryCache` para `HybridCache` vale a pena mesmo antes de existir um Redis. Compartilhar entre servidores exige uma implementação de verdade fora do processo.

### Limite de payload: o que observei

A documentação diz que valores acima de `MaximumPayloadBytes` (1 MB por padrão) são registrados no log e não são guardados. Coloquei em cache uma string de 2 MB e um DTO de 2 MB com `byte[]`, três vezes cada, com e sem L2:

```text
with L2: 2 MB string  -> factory runs=1, L2 entries=0
with L2: 2 MB DTO     -> factory runs=1, L2 entries=0
L1 only: 2 MB DTO     -> factory runs=1
```

Com o `Microsoft.Extensions.Caching.Hybrid` 10.11.0 o valor grande nunca chegou ao L2 (e o log mostra `Cache MaximumPayloadBytes (1048576) exceeded`), mas a cópia local continuou atendendo as chamadas seguintes. A regra prática vale de qualquer jeito: payloads acima do limite não atravessam servidores, então blobs grandes pertencem a um blob storage, não ao cache.

### Reaproveitando instâncias

Por padrão o `HybridCache` entrega uma cópia a cada chamador, para evitar estado mutável compartilhado. Se o tipo é `sealed` e marcado com `[ImmutableObject(true)]`, ele entrega a mesma instância:

```text
mutable class: same instance? False; sealed+[ImmutableObject]: same instance? True
```

Isso economiza alocações e desserialização em objetos grandes e muito lidos, e só é seguro quando ninguém os modifica.

## Trade-offs

- **O IMemoryCache exige a sua disciplina.** Sem proteção contra stampede e sem teto de memória, a menos que você adicione um.
  ```csharp
  new MemoryCacheOptions { SizeLimit = 1024 }   // e toda entrada define Size
  ```
- **Um limite de tamanho falha em silêncio.** Uma entrada que não cabe não é guardada e nenhuma exceção avisa, então acompanhe a taxa de acerto.
  ```csharp
  mem.Set("big", "x", new MemoryCacheEntryOptions { Size = 10 });   // limite 3: cached=False
  ```
- **Só sliding pode servir dado velho para sempre.** Adicione um limite absoluto.
  ```csharp
  new MemoryCacheEntryOptions { SlidingExpiration = TimeSpan.FromMinutes(5), AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1) }
  ```
- **Um segundo nível traz uma defasagem que você precisa dimensionar.** Os outros nós só ficam sabendo de uma invalidação quando o L1 deles expira, então `LocalCacheExpiration` é uma configuração de consistência, não só de desempenho.
  ```csharp
  new HybridCacheEntryOptions { Expiration = TimeSpan.FromMinutes(10), LocalCacheExpiration = TimeSpan.FromSeconds(30) }
  ```
- **A invalidação por tag é barata, mas lógica.** Os bytes antigos continuam na memória e no Redis até expirarem, então ela não libera espaço.
- **Serialização é custo e risco.** Ter L2 significa serializar, e um tipo que não faz o ciclo completo com `System.Text.Json` falha em tempo de execução (com Native AOT você precisa fornecer um serializador gerado por source generator).
- **Cache não é fonte da verdade.** O código precisa continuar funcionando quando a entrada não existe, e por isso a fábrica precisa estar correta e ser segura para rodar mais de uma vez (uma por nó, como medido).

## Documentation Links

- [HybridCache library in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/hybrid?view=aspnetcore-10.0) (doc)
- [Cache in-memory in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/memory?view=aspnetcore-10.0) (doc)
- [Distributed caching in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/distributed?view=aspnetcore-10.0) (doc)
- [Caching overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/performance/caching/overview?view=aspnetcore-10.0) (doc)
- [Caching in .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/extensions/caching) (doc)
