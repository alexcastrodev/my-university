---
version: 1.0
updatedAt: 2026-10-15
title: "Acesso a Dados e Streaming Rendering no Blazor"
summary: Por que injetar o DbContext direto em um componente interativo dá problema (o escopo é o circuito), IDbContextFactory, a consulta duplicada do prerender e [PersistentState], e por que o WebAssembly precisa de uma API.
---
## Objective

Em um controller ou em uma minimal API o `DbContext` vive por uma requisição,
então injetá-lo é o óbvio. Em um componente Blazor interativo a mesma linha de
código prende o contexto a outra coisa: o circuito. Este concept roda o mesmo
componente de três jeitos no SDK 10.0.100 com EF Core 10 e SQLite e mostra o que
muda: um contexto que sobrevive a todo clique, entidades rastreadas que continuam
devolvendo dado velho, consultas que rodam duas vezes por causa do prerender, e o
que fazer no lugar (`IDbContextFactory`, `[PersistentState]`, um service atrás de
uma interface). Também explica por que o WebAssembly não pode usar nada disso. As
regras gerais de lifetime do contexto estão em DbContext Lifetime and Change
Tracking, o lifetime scoped em Dependency Injection and Service Lifetimes, e o
`[StreamRendering]` em Blazor Static SSR and Enhanced Navigation.

## Use Cases

- Decidir como um componente lê e grava no banco sem um contexto velho ou
  compartilhado.
- Descobrir por que uma página mostra valores antigos depois que o banco mudou.
- Evitar a segunda consulta que o prerender causa em toda primeira carga.
- Estruturar o acesso a dados para que o mesmo componente rode no servidor ou no
  navegador.

## Deep Dive

### O que "scoped" significa em um componente interativo

`AddDbContext` registra o contexto como scoped. Em uma requisição, o escopo é a
requisição. No Interactive Server, a documentação afirma que a instância scoped é
compartilhada entre os componentes do circuito do usuário, e o circuito dura
enquanto o usuário mantém a página aberta. Um componente com
`@inject ShopContext Db` e três botões (carregar um produto, alterá-lo por outro
contexto, carregar de novo) imprimiu:

```text
context=24129389 tracked=0
clique load      -> context=24129389 tracked=1   tracked read: Pen 1,0
clique external  -> (outro contexto muda o preço de Pen para 2)
clique load      -> context=24129389 tracked=1   tracked read: Pen 1,0   <- velho
clique no-track  -> no-tracking read: Pen 2,0
```

O hash do contexto não mudou entre os cliques e o change tracker manteve a
entidade `Pen`. O segundo `load` devolveu a entidade que já estava no tracker,
então o preço do banco nunca chegou à tela. É o comportamento correto do EF Core
(identity resolution) no lifetime errado: com um contexto do tamanho de uma
requisição o tracker estaria vazio. O `AsNoTracking` devolveu o `2` novo, que é o
sintoma do problema e um paliativo parcial.

O contexto scoped tem um segundo problema, a concorrência. O `DbContext` não é
thread safe, e em um circuito vários componentes, timers e handlers de evento
podem usar a mesma instância. Oito consultas sobrepostas no contexto
compartilhado (`Task.Run` para forçar a sobreposição, já que os métodos async do
SQLite completam de forma síncrona e raramente se sobrepõem sozinhos) falharam
todas as vezes:

```text
InvalidOperationException: A second operation was started on this context
instance before a previous operation completed. This is usually caused by
different threads concurrently using the same instance of DbContext.
```

As mesmas oito consultas, cada uma com seu contexto, funcionaram todas.

### A factory

`AddDbContextFactory` registra `IDbContextFactory<T>`, um singleton que cria um
contexto novo sob demanda. A primeira recomendação da documentação para Blazor é
um contexto por operação, porque criar um contexto é barato:

```csharp
builder.Services.AddDbContextFactory<ShopContext>(o => o.UseSqlite("Data Source=shop.db"));
```

```razor
@inject IDbContextFactory<ShopContext> Factory

@code {
    async Task Load()
    {
        await using var db = Factory.CreateDbContext();
        var p = await db.Products.FirstAsync(x => x.Id == 1);
        msg = $"read: {p.Name} {p.Price}";
    }
}
```

A execução com a factory: `Pen 1`, depois uma atualização externa, depois
`Pen 2` no clique seguinte (um hash de contexto diferente a cada vez), e as oito
consultas paralelas terminaram todas. O custo é que o tracker deixa de abranger
várias operações. Para uma tela de edição que quer change tracking ao longo de
vários passos, a documentação sugere um contexto com escopo do componente: criá-lo
em `OnInitializedAsync` a partir da factory e descartá-lo em `Dispose`. É uma
unidade de trabalho deliberada, não um acidente do escopo do circuito, e precisa
do hook de descarte visto no concept de ciclo de vida dos componentes.

Registrar `AddScoped(sp => sp.GetRequiredService<IDbContextFactory<T>>().CreateDbContext())`
(como no app de teste) mantém o `@inject ShopContext` funcionando em páginas de
static SSR, e lá o escopo é a requisição: duas requisições a uma página
`[StreamRendering]` que injetava o contexto direto mostraram dois hashes
diferentes, e a página transmitiu `Loading...` primeiro e `2 items` quando o dado
ficou pronto. O static SSR é o único lugar onde a injeção direta combina com a
intenção.

### O prerender roda a consulta duas vezes

Um componente interativo faz prerender por padrão, então `OnInitializedAsync`
roda no servidor para gerar o HTML e de novo quando o circuito começa. Com o log
de comandos do EF em `Information`, um componente que carrega pela factory
registrou isto em uma carga no navegador:

```text
[loader plain] queried, interactive=False
[loader plain] queried, interactive=True
```

Duas idas ao banco para a mesma lista. Com a persistência declarativa do .NET 10
a segunda desaparece:

```csharp
[PersistentState] public List<Product>? Items { get; set; }

protected override async Task OnInitializedAsync()
{
    if (Items is not null) return;          // restaurado do prerender
    await using var db = Factory.CreateDbContext();
    Items = await db.Products.AsNoTracking().ToListAsync();
}
```

```text
[loader persist] queried, interactive=False      (sem a segunda linha)
```

O atributo vai em uma propriedade pública, que o framework serializa na página
pré-renderizada com System.Text.Json e restaura na instância interativa. A
documentação observa que com `InteractiveServer` o dado é protegido com Data
Protection, enquanto com WebAssembly ou Auto ele fica exposto ao navegador, então
não pode conter nada privado. Duas opções importam para acesso a dados:
`AllowUpdates = true` permite que dados somente leitura e que mudam pouco sejam
atualizados após uma enhanced navigation, e
`RestoreBehavior = RestoreBehavior.SkipLastSnapshot` ignora o snapshot na
reconexão quando você quer dado novo. As duas estão no artigo do .NET 10 sobre
persistência de estado pré-renderizado. Quando a página é alcançada por enhanced
navigation dentro de um app já interativo não há prerender, então a consulta
dupla só aparece em carga completa.

### O WebAssembly não chama o banco

Um componente que roda no navegador não pode usar nada disso: a documentação diz
que o WebAssembly roda em um sandbox que impede a maioria das conexões diretas
com banco, e uma connection string no código do cliente ficaria exposta de
qualquer jeito. O componente precisa de uma API. O formato que mantém um único
componente funcionando nos dois lugares é uma interface, com uma implementação
por lado:

```csharp
public interface IProductService { Task<List<Product>> ListAsync(CancellationToken ct = default); }

public sealed class DbProductService(IDbContextFactory<ShopContext> factory) : IProductService
{
    public async Task<List<Product>> ListAsync(CancellationToken ct = default)
    {
        await using var db = await factory.CreateDbContextAsync(ct);
        return await db.Products.AsNoTracking().OrderBy(p => p.Name).ToListAsync(ct);
    }
}

public sealed class HttpProductService(HttpClient http) : IProductService
{
    public async Task<List<Product>> ListAsync(CancellationToken ct = default)
        => await http.GetFromJsonAsync<List<Product>>("api/products", ct) ?? [];
}
```

O servidor registra `DbProductService` e expõe o mesmo service com
`app.MapGet("/api/products", ...)`; na execução o endpoint devolveu as duas
linhas como JSON. O projeto WebAssembly registra `HttpProductService`. Um
componente que depende só de `IProductService` renderiza em static SSR,
Interactive Server e WebAssembly sem mudança, e as regras de acesso a dados ficam
em uma classe. O lado do cliente, com base address e CORS, é outro assunto.

## Trade-offs

- **Injeção direta serve para static SSR e é errada nos modos interativos.** O
  mesmo `@inject ShopContext` é um contexto por requisição em um e um contexto do
  tamanho do circuito no outro.
  ```razor
  @inject ShopContext Db   @* por requisição em páginas estáticas, por circuito quando interativo *@
  ```
- **A factory resolve o compartilhamento e abre mão do tracker entre operações.**
  Cada operação começa limpa, o que é certo para leituras e para a maioria das
  escritas, mas uma edição em vários passos precisa de um contexto com escopo do
  componente de propósito.
- **Um contexto por componente é uma unidade de trabalho com lifetime que você
  controla.** Ele rastreia e detecta conflitos de concorrência ao longo dos
  passos, e segura uma conexão e memória enquanto a página estiver aberta, então
  descarte-o.
- **`[PersistentState]` remove a consulta duplicada e acrescenta payload.** O
  dado é serializado no HTML, o que aumenta a resposta e, para WebAssembly e Auto,
  fica visível ao navegador.
- **Uma interface esconde de onde o dado vem, e uma implementação HTTP adiciona
  um salto.** O mesmo componente chama um service em processo no servidor e uma
  chamada de rede no navegador, então latência e modos de falha variam por modo.
- **`AsNoTracking` não cura um contexto compartilhado.** Evita entidades velhas,
  mas não a exceção de concorrência, que vem de compartilhar a instância.

## Documentation Links

- [ASP.NET Core Blazor with Entity Framework Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/blazor-ef-core) (doc)
- [ASP.NET Core Blazor prerendered state persistence, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/state-management/prerendered-state-persistence) (doc)
- [ASP.NET Core Razor component rendering, streaming rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/rendering) (doc)
- [Using a DbContext factory, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/#use-a-dbcontext-factory) (doc)
- [DbContext lifetime, configuration, and initialization, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/dbcontext-configuration/) (doc)
