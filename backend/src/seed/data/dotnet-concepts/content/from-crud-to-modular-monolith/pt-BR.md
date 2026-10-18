---
version: 1.0
updatedAt: 2026-10-05
title: "Do CRUD ao Monolito Modular"
summary: Um caminho concreto, em passos pequenos, de uma API CRUD de um projeto só para dois módulos (Catalog e Orders) com projetos, schemas e um contrato entre eles.
---
## Objective

Quase nenhum monolito modular começa como um. Ele começa como uma API CRUD
pequena, com um projeto, um `DbContext` e todo endpoint livre para tocar toda
tabela, e essa é a forma certa de começar. A habilidade é saber quando essa
forma deixa de compensar e como migrar para módulos em passos pequenos que
mantêm a aplicação rodando a cada commit, em vez de numa reescrita. O objetivo é
um caminho concreto de um CRUD de projeto único (um catálogo de jogos) para dois
módulos (Catalog e Orders), com projetos separados, schemas separados e um
contrato entre eles, terminando onde o conceito de fronteiras de módulo começa.

## Use Cases

- Um CRUD de catálogo que agora precisa de pedidos, e a primeira pergunta é se um
  pedido pode fazer join direto com a tabela de jogos.
- Um `Program.cs` crescendo e um único `DbContext` em que a mudança numa feature
  vive quebrando outra.
- Um segundo time prestes a entrar no repositório, que precisa de linhas de
  propriedade que o compilador consiga impor.
- Um protótipo que provou seu valor e agora precisa ser estruturado para uma vida
  mais longa, sem uma reescrita big-bang.

## Deep Dive

### Comece como um CRUD, de propósito

Um projeto único com `Models/`, `Data/`, `Dtos/` e `Endpoints/` é a forma certa
para um recurso. Dividi-lo em projetos antes de existir uma segunda área de
negócio congela palpites sobre fronteiras na estrutura de pastas. Mova-se só
quando um sinal real aparecer:

- Chega uma **segunda área com dados e regras próprios** (pedidos, pagamentos,
  estoque), e as tabelas dela começam a referenciar as da primeira.
- A mudança numa feature **quebra uma não relacionada** com frequência, porque
  todo endpoint consegue consultar todo `DbSet`.
- **Dois times** precisam trabalhar em paralelo e vivem se atropelando.
- Uma parte do sistema precisa **mudar ou escalar de forma independente**, e você
  quer que isso seja barato depois.

Com um recurso e uma pessoa desenvolvendo, nenhum deles se aplica, e as pastas
bastam.

### Passo 0: nomeie os módulos e quem é dono de quê

Antes de tocar no código, decida o dono de cada tabela. Na loja de jogos:

- **Catalog** é dono de `Games` e `Genres`.
- **Orders** é dono de `Orders` e `OrderLines`.

Se uma tabela parece ter dois donos, a fronteira está desenhada errada. Um
produto referenciado por uma linha de pedido continua sendo do Catalog; o Orders
guarda só o id dele (e uma cópia do que precisa lembrar, como o preço no momento
da compra).

### Passo 1: agrupe por feature dentro do projeto único

O primeiro movimento mais barato não muda a estrutura de projetos: transforme as
pastas técnicas em pastas por feature, para os arquivos de cada área ficarem
juntos. `Games/` contém suas entidades, DTOs, endpoints e mapeamento; `Genres/`
idem. Esse passo prova que as áreas são separáveis antes de qualquer `.csproj`
ser criado, e é fácil de desfazer.

### Passo 2: um projeto por módulo, mais um host

Agora crie a estrutura de verdade:

```text
src/
  Host/                    -> só Program.cs, compõe os módulos
  Modules/
    Catalog/
      Catalog.Contracts/   -> DTOs públicos e ICatalogModule
      Catalog.Core/        -> entidades, DbContext, endpoints (internal)
  Shared/
    Shared.Kernel/         -> minúsculo, sem significado de negócio
```

Mova o CRUD existente para o `Catalog.Core` como está. O `GameStoreContext` vira
`CatalogDbContext`; a app continua se comportando igual. Depois torne os tipos
`internal` por padrão e deixe o compilador reclamar. Cada reclamação é um lugar
onde algo de fora do módulo estava alcançando por dentro. Resolva cada uma
movendo o código ou publicando um tipo deliberado em `Catalog.Contracts`.

### Passo 3: cada módulo se registra sozinho

Troque o conhecimento que o host tem das entranhas do Catalog por duas chamadas
que o módulo expõe:

```csharp
// Program.cs no Host
builder.Services.AddCatalogModule(builder.Configuration);
var app = builder.Build();
app.MapCatalogEndpoints();
```

`AddCatalogModule` registra o `DbContext`, os serviços e a implementação do
contrato; `MapCatalogEndpoints` mapeia o route group. O host passa a listar
módulos e nada mais. O registro também é onde o módulo escolhe o próprio schema
(próximo passo).

### Passo 4: schemas separados, históricos de migration separados

Dê a cada módulo seu próprio schema de banco e sua própria tabela de histórico de
migrations, no mesmo banco:

```csharp
modelBuilder.HasDefaultSchema("catalog");

options.UseNpgsql(connectionString,
    npgsql => npgsql.MigrationsHistoryTable("__EFMigrationsHistory", "catalog"));
```

Schemas são o motivo de sair do SQLite para o PostgreSQL neste ponto: o provider
do SQLite não tem a noção de schema, então não há nada equivalente a um
namespace `catalog` para as tabelas. Gere de novo a migration inicial para o novo
provider. A partir daí, Catalog e Orders podem evoluir suas tabelas, e aplicar
suas migrations, sem saber um do outro.

### Passo 5: o segundo módulo, atrás de um contrato

Agora adicione o Orders. Ele ganha seus próprios `Orders.Contracts` e
`Orders.Core`, e as referências de projeto dele permitem só `Catalog.Contracts`,
nunca `Catalog.Core`:

```xml
<!-- Orders.Core.csproj -->
<ProjectReference Include="..\Orders.Contracts\Orders.Contracts.csproj" />
<ProjectReference Include="..\..\Catalog\Catalog.Contracts\Catalog.Contracts.csproj" />
```

O Orders precisa do nome e do preço de um jogo. Ele pergunta pelo contrato:

```csharp
// Catalog.Contracts
public interface ICatalogModule
{
    Task<IReadOnlyDictionary<int, GameInfoDto>> GetGamesAsync(int[] ids, CancellationToken ct);
}
```

Duas regras mantêm isso honesto. Primeira: `OrderLine.GameId` é um `int` simples,
sem foreign key para `catalog.Games`, porque uma constraint entre schemas é uma
dependência que o compilador e o grafo de módulos não enxergam. Segunda: quando o
Orders cria uma linha, ele copia o preço para `UnitPrice`, para que uma mudança
de preço posterior no Catalog não reescreva o histórico. Ler um pedido com os
nomes dos jogos vira duas queries: as linhas do pedido em `orders`, depois
`GetGamesAsync` para os ids delas.

### Passo 6: trave a fronteira

Referências de projeto impedem as violações óbvias, e nada impede o resto: uma
referência nova adicionada "temporariamente", um `InternalsVisibleTo` para um
relatório, um `AppDbContext` que mapeia os dois schemas. Adicione testes de
arquitetura que quebram o build quando o `Orders.Core` depende do `Catalog.Core`
ou quando um tipo de entidade é público. Esse é o assunto do conceito de testes
de arquitetura, e é o que transforma o layout de convenção em regra.

### O que o caminho evita de propósito

- **Dividir antes de existir uma segunda área.** Módulos vazios para áreas que
  ainda não existem são palpites, e palpites errados custam caro para mover.
- **Um `AppDbContext` compartilhado como degrau.** É a forma mais rápida de
  desfazer a divisão, e ele nunca é removido.
- **Joins entre módulos "por performance".** Uma query em vez de duas é o
  primeiro atalho que apaga a fronteira. Se doer num caminho quente, mantenha uma
  pequena cópia local dos dados alimentada por eventos, não um join.
- **Uma transação compartilhada entre dois módulos.** Funciona enquanto há um
  banco só e vira uma transação distribuída no dia em que um módulo é extraído.

## Trade-offs

- **Cada passo adiciona cerimônia.** Mais projetos, mais código de registro, mais
  mapeamento nas bordas. Para um recurso é custo puro, e é por isso que o gatilho
  é uma segunda área real e não um desejo vago de "arquitetura limpa".
- **Duas queries em vez de uma.** Ler um pedido com nomes de jogos custa um round
  trip a mais. O preço compra independência; se for alto demais, mantenha uma
  projeção local dos dados do catálogo dentro do Orders.
  ```csharp
  var lines = await db.OrderLines.Where(l => l.OrderId == id).ToListAsync(ct);
  var games = await catalog.GetGamesAsync(lines.Select(l => l.GameId).Distinct().ToArray(), ct);
  ```
- **Migrar dados é a parte difícil.** Mover tabelas para schemas num banco que já
  tem dados de produção exige uma migração cuidadosa (criar o schema, mover as
  tabelas, manter a tabela de histórico consistente), não um rename casual.
- **A fronteira pode estar errada.** Às vezes você vai descobrir que dois módulos
  mudam juntos em toda feature. É sinal de que são um módulo só; juntar é mais
  barato num monolito do que entre serviços, o que é parte da ideia.
- **O monolito continua sendo um deploy só.** Uma migration ruim ou um vazamento
  de memória num módulo afeta todos eles. O layout modular reduz o custo de
  extração; ele não remove o runtime compartilhado.

## Lab

Neste lab você recebe uma solução que já tem o layout de módulos (um catálogo de jogos e um fluxo de pedidos), mas com a fronteira falsa: tudo é `public` e o módulo de pedidos chama o `GameStore` do catálogo diretamente. Além disso, um pedido guarda preço `0` em vez do preço pago. O seu trabalho é consertar a estrutura passo a passo e deixar o compilador dizer o que estava invadindo o outro módulo. A ideia central é transformar duas features que mexem nos internos uma da outra em dois módulos que só conversam por um contrato, com o compilador e alguns testes de arquitetura garantindo a fronteira.

**O cenário**

- `src/Host` (`GameStore.Host`): só compõe os módulos, chamando `AddCatalogModule`/`AddOrdersModule` e os `Map...Endpoints`.
- `Catalog.Contracts`: `ICatalogModule` e `GameInfoDto`, a cara pública do catálogo.
- `Catalog.Core`: `Game`, `GameStore`, `CatalogModuleApi` e `CatalogModule` (registro e endpoints).
- `Orders.Contracts`: os formatos de request e response dos pedidos.
- `Orders.Core`: `Order`, `OrderLine`, `OrderStore` e `OrdersModule`. Hoje referencia `Catalog.Core` no csproj.

Os testes têm duas frentes: `OrderFlowTests` exercita a API de ponta a ponta (preço pago, `Location`, jogo inexistente, pedido sem linhas) e `ModuleBoundaryTests` confere com reflection as referências entre assemblies e que cada `Core` exporta só a classe do módulo.

**O que você vai fazer, passo a passo**

1. **Esconder o interior do catálogo (TODO-00).** Torne `internal` todos os tipos de `Catalog.Core`, exceto `CatalogModule` (inclusive `Game`, `GameStore` e `CatalogModuleApi`). A solução deixa de compilar, porque o `Orders.Core` usava esses tipos. É o compilador impondo a fronteira, e os próximos passos consertam isso.
2. **Expor o catálogo por contrato (TODO-01).** Em `CatalogModuleApi.GetGamesAsync`, procure os ids no store e devolva um dicionário de `GameInfoDto` por id (ids que não existem simplesmente ficam de fora). Depois registre `ICatalogModule` com `CatalogModuleApi` (scoped) em `AddCatalogModule`.
3. **Trocar a dependência de Orders (TODO-02).** Em `Orders.Core`, use `ICatalogModule` no lugar de `GameStore` nos dois endpoints e em `ToDto`, e em `Orders.Core.csproj` troque a referência a `Catalog.Core` por `Catalog.Contracts`.
4. **Esconder o interior de pedidos (TODO-03).** Torne `internal` `Order`, `OrderLine` e `OrderStore`, deixando público só o `OrdersModule`.
5. **Guardar o preço pago (TODO-04).** Ao fazer o pedido, copie o preço atual do jogo para `OrderLine.UnitPrice`. Um pedido deve manter o preço que foi pago, mesmo que o preço do catálogo mude depois.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar o que o compilador acusou depois do TODO-00 e por que isso é bom, por que `Orders.Core` pode referenciar `Catalog.Contracts` mas não `Catalog.Core`, e por que o total de um pedido antigo não muda quando o catálogo reajusta o preço.

**Desafios opcionais**

- **TODO-05:** adicione um teste de arquitetura que falha quando algum assembly `*.Contracts` expõe um tipo que não seja record nem interface.
- **TODO-06:** recoloque `Orders.Core` -> `Catalog.Core` no csproj "temporariamente" e veja qual teste pega isso antes mesmo de o código usar o tipo.
- **TODO-07:** troque os stores em memória por um schema PostgreSQL por módulo (`catalog` e `orders`), cada um com seu `DbContext` e sua tabela de histórico de migrations.

**Pré-requisitos:** referências entre projetos e modificadores de acesso em C# (`public` vs `internal`), Minimal APIs e injeção de dependência, e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. No estado inicial a solução compila, mas `GetGamesAsync` lança `NotImplementedException` e os testes de fronteira e de fluxo falham; os TODOs estão em comentário nos arquivos citados.

## Documentation Links

- [Common web application architectures, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures) (doc)
- [SQLite EF Core provider limitations, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/providers/sqlite/limitations) (doc)
- [Migrations history table, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/history-table) (doc)
- [dotnet add reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-add-reference) (doc)
- [Modular Monolith with DDD, kgrzybek (reference implementation)](https://github.com/kgrzybek/modular-monolith-with-ddd) (doc)
