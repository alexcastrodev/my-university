---
version: 1.0
updatedAt: 2026-10-05
title: "DTOs e o Contrato da API"
summary: Por que uma API REST não deve serializar entidades, um DTO por caso de uso com records C#, onde mora o mapeamento e a projeção direto na query.
---
## Objective

Um DTO (data transfer object) é um tipo que existe só para descrever o que
cruza a fronteira HTTP. Ele é o contrato entre a API e seus clientes: o front
end é escrito contra esses formatos, então eles precisam ficar estáveis enquanto
o modelo do banco muda livremente por baixo. O objetivo é saber por que uma API
REST nunca deve serializar suas entidades diretamente, como modelar um DTO por
caso de uso com records C# e onde o mapeamento entre entidade e DTO deve morar.

## Use Cases

- Devolver um jogo a um front end React com o gênero como texto numa lista, mas
  como id num formulário de edição, a partir da mesma entidade.
- Aceitar uma requisição de criação que não pode conter `Id`, porque o banco o
  gera.
- Renomear uma coluna ou dividir uma tabela sem nenhuma mudança no cliente.
- Manter campos sensíveis ou internos (um hash de senha, uma flag de soft
  delete, uma coleção de navegação) fora de toda resposta por construção.

## Deep Dive

### Por que não devolver a entidade

Com o EF Core, a entidade é o modelo de persistência: tem propriedades de
navegação, um estado de change tracking e colunas que o cliente não deveria
conhecer. Devolvê-la diretamente causa três problemas ao mesmo tempo:

- **O cliente fica acoplado à tabela.** Adicionar uma coluna adiciona uma
  propriedade JSON; renomear uma quebra o front end.
- **Ciclos e over-fetching.** `Game.Genre.Games.Genre...` serializa para sempre
  ou carrega muito mais do que a tela precisa.
- **Mass assignment.** Se o mesmo tipo é aceito no `POST`, um cliente pode
  definir `Id` ou qualquer outra propriedade que você não pretendia expor.

### Records servem bem

Um DTO é dado sem comportamento e sem identidade, que é exatamente o que um
`record` é. Um record posicional cabe em uma linha e é imutável:

```csharp
public record GameSummaryDto(
    int Id, string Name, string Genre, decimal Price, DateOnly ReleaseDate);
```

O compilador gera o construtor, as propriedades, a igualdade por valor e o
`ToString`. O `System.Text.Json` serializa records posicionais e consegue
desserializá-los pelo construtor primário, então o mesmo tipo serve para
requisições e respostas.

### Um DTO por caso de uso

A mesma entidade costuma precisar de vários formatos. Numa loja de jogos, estes
três são diferentes de propósito:

```csharp
// Tela de lista: gênero como texto, o suficiente para renderizar uma linha
public record GameSummaryDto(int Id, string Name, string Genre, decimal Price, DateOnly ReleaseDate);

// Detalhe e formulário de edição: gênero como o id que o formulário devolve
public record GameDetailsDto(int Id, string Name, int GenreId, decimal Price, DateOnly ReleaseDate);

// Criação: sem Id, o banco é o dono dele
public record CreateGameDto(
    [Required][StringLength(50)] string Name,
    [Range(1, 50)] int GenreId,
    [Range(1, 100)] decimal Price,
    DateOnly ReleaseDate);
```

Não os junte para digitar menos. `GameSummaryDto.Genre` é `string` e
`GameDetailsDto.GenreId` é `int` porque as telas precisam de coisas diferentes.
Um DTO "universal" acaba com propriedades anuláveis cujo significado depende de
qual endpoint o devolveu. `UpdateGameDto` é um quarto tipo que muitas vezes
parece idêntico ao `CreateGameDto`; mantenha-o separado mesmo assim, porque os
dois divergem no dia em que uma atualização não puder alterar um dos campos.

### Onde mora o mapeamento

O mapeamento é repetitivo, então merece uma casa. A opção menor é um conjunto
de métodos de extensão ao lado dos DTOs:

```csharp
public static class GameMappingExtensions
{
    public static Game ToEntity(this CreateGameDto dto) => new()
    {
        Name = dto.Name,
        GenreId = dto.GenreId,
        Price = dto.Price,
        ReleaseDate = dto.ReleaseDate,
    };

    public static GameDetailsDto ToDetailsDto(this Game game) =>
        new(game.Id, game.Name, game.GenreId, game.Price, game.ReleaseDate);

    public static GameSummaryDto ToSummaryDto(this Game game) =>
        new(game.Id, game.Name, game.Genre!.Name, game.Price, game.ReleaseDate);
}
```

Os handlers passam a ler como intenção: `db.Games.Add(dto.ToEntity())` e
`return game.ToDetailsDto()`. Há uma sutileza: `ToSummaryDto` acessa
`game.Genre`, que é `null` a menos que a query o tenha carregado. Para listas,
projete na própria query e deixe o banco buscar só o que o DTO precisa:

```csharp
var games = await db.Games
    .Select(g => new GameSummaryDto(g.Id, g.Name, g.Genre!.Name, g.Price, g.ReleaseDate))
    .AsNoTracking()
    .ToListAsync();
```

Com a projeção, o EF Core traduz o join e seleciona só essas colunas, e o
`Include` não é necessário. Uma biblioteca de mapeamento como o Mapperly (gerado
por source generator) ou o AutoMapper é uma opção quando o número de tipos
tornar a versão manual cansativa, não um ponto de partida.

### A entidade nunca sai do handler

Uma regra útil: a entidade pode aparecer dentro do handler e do código de acesso
a dados, e em nenhuma assinatura que o mundo externo vê. Depois do
`SaveChangesAsync`, a entidade já tem o `Id` gerado, então monte o DTO de
resposta a partir dela ali mesmo:

```csharp
var game = dto.ToEntity();
db.Games.Add(game);
await db.SaveChangesAsync();                 // game.Id já está preenchido
return Results.CreatedAtRoute(GetGameEndpointName, new { id = game.Id }, game.ToDetailsDto());
```

## Trade-offs

- **Mais tipos e mais código de mapeamento.** Um CRUD com quatro DTOs por
  recurso parece boilerplate e, para um protótipo descartável, é. O custo se
  paga na primeira vez que a tabela muda e o cliente não.
- **O mapeamento esconde erros em silêncio.** Adicione uma coluna `Description`
  e esqueça de copiá-la no `ToEntity`: nada falha, o valor simplesmente nunca é
  salvo. Um teste que faz o round trip de um DTO totalmente preenchido pega essa
  classe de bug.
  ```csharp
  // falha se uma propriedade for adicionada ao DTO mas não ao mapeamento
  Assert.Equal(dto, dto.ToEntity().ToDetailsDto());
  ```
- **Contratos que espelham a entidade perdem o sentido.** Um DTO com as mesmas
  vinte propriedades da entidade acopla o cliente à tabela com a mesma força;
  desenhe o DTO a partir da tela, não da classe.
- **Bibliotecas de mapeamento trocam clareza por brevidade.** Mapeadores
  baseados em reflection movem erros da compilação para o runtime (uma
  propriedade renomeada quebra na primeira requisição). Mapeadores gerados por
  source generator mantêm a maior parte da segurança em compilação.
- **Records posicionais têm uma ruga de validação.** Atributos em parâmetros
  posicionais precisam chegar às propriedades para serem lidos por alguns
  validadores. O conceito de validação cobre como o ASP.NET Core lida com isso.

## Documentation Links

- [Records, C# reference, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record) (doc)
- [Create responses in Minimal API apps, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/responses) (doc)
- [How to serialize and deserialize JSON, System.Text.Json, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/how-to) (doc)
- [Efficient querying, projections, EF Core, Microsoft Learn](https://learn.microsoft.com/en-us/ef/core/performance/efficient-querying) (doc)
- [Mapperly, source-generated object mapper](https://mapperly.riok.app/) (doc)
