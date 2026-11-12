---
version: 1.0
updatedAt: 2026-11-12
title: "CQRS, Mediator e Vertical Slices"
summary: Comandos e consultas separados sem event sourcing, um mediator mínimo escrito à mão, pipeline behaviors (validação, logging, transação), vertical slices com Minimal APIs, o estado das bibliotecas depois da mudança de licença do MediatR e quando não usar um mediator.
---
## Objective

CQRS (Command Query Responsibility Segregation) significa que o código que altera estado (comandos) e o código que o lê (consultas) são tipos separados, com regras separadas. Não exige event sourcing, dois bancos de dados nem um barramento de mensagens: na maioria das aplicações .NET são só dois tipos de classe de requisição e um handler por requisição. Um mediator é a peça pequena que recebe uma requisição, encontra o handler e a executa por um pipeline de passos transversais (validação, logging, uma transação). Vertical slices organizam o código por funcionalidade em vez de por camada técnica, de modo que tudo o que um caso de uso precisa fica em uma pasta. O objetivo é entender o que uma biblioteca como o MediatR realmente faz escrevendo o núcleo você mesmo, como colocar validação e transação em um pipeline, como isso se combina com Minimal APIs, qual é a situação das bibliotecas hoje depois da mudança de licença do MediatR e quando um mediator é a ferramenta errada.

## Use Cases

- Um handler por caso de uso, de modo que uma rota ou controller tenha três linhas e a lógica de negócio seja testável sem HTTP.
- Regras transversais aplicadas a todo comando em um só lugar: validar a entrada, abrir uma transação, registrar o tempo.
- Leituras que pulam o modelo de domínio (uma consulta devolve um DTO plano direto do banco) enquanto as escritas passam por agregados e invariantes.
- Uma base de código em que uma funcionalidade nova é uma pasta nova, e não uma edição em quatro projetos (veja a organização em camadas em Clean Architecture em Quatro Projetos).

## Deep Dive

### Comandos e consultas, sem event sourcing

Um comando expressa uma intenção que altera estado e devolve pouco (um id, um status). Uma consulta devolve dados e não altera nada. Mantê-los como tipos diferentes deixa a regra visível e permite que a infraestrutura os trate de forma diferente:

```csharp
public interface IRequest<TResponse>;
public interface ICommand<TResponse> : IRequest<TResponse>;
public interface IQuery<TResponse> : IRequest<TResponse>;

public sealed record PlaceOrder(string Sku, int Quantity) : ICommand<Guid>;
public sealed record GetOrder(Guid Id) : IQuery<OrderDto?>;
```

Isso é todo o CQRS no nível de que a maioria das aplicações precisa. O mesmo banco, o mesmo `DbContext` e a mesma transação servem os dois lados. As variantes caras (um repositório de leitura separado, projeções construídas a partir de eventos, consistência eventual entre os dois) são decisões separadas com custos separados, e o padrão não as implica. Comece pela versão barata e separe os repositórios só quando um problema de leitura medido exigir.

### Um mediator em cerca de 40 linhas

Um mediator expõe um método, `Send`, e esconde qual classe trata cada requisição:

```csharp
public interface IRequestHandler<TRequest, TResponse> where TRequest : IRequest<TResponse>
{
    Task<TResponse> Handle(TRequest request, CancellationToken ct);
}

public interface IMediator
{
    Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken ct = default);
}
```

A única parte difícil é que `Send` recebe a requisição como `IRequest<TResponse>`, mas o contêiner precisa do tipo fechado `IRequestHandler<PlaceOrder, Guid>`. A solução usual é um pequeno wrapper genérico criado por reflexão uma vez por tipo de requisição e guardado em cache:

```csharp
public sealed class Mediator(IServiceProvider services) : IMediator
{
    private static readonly ConcurrentDictionary<Type, object> Wrappers = new();

    public Task<TResponse> Send<TResponse>(IRequest<TResponse> request, CancellationToken ct = default)
    {
        var wrapper = (RequestWrapper<TResponse>)Wrappers.GetOrAdd(request.GetType(), static t =>
            Activator.CreateInstance(typeof(RequestWrapper<,>).MakeGenericType(t, typeof(TResponse)))!);
        return wrapper.Handle(request, services, ct);
    }
}
```

O `RequestWrapper<TRequest, TResponse>` então faz `services.GetService<IRequestHandler<TRequest, TResponse>>()`, lança uma `InvalidOperationException` clara quando não há handler e o chama. Os handlers são registrados varrendo o assembly atrás de tipos que implementam `IRequestHandler<,>` e chamando `AddScoped`. Esse é todo o mecanismo de despacho. Tudo o que uma biblioteca acrescenta (notificações, requisições de streaming, requisições genéricas, verificação de chave de licença) fica por cima dessa ideia.

### O pipeline: behaviors envolvem o handler

Um behavior recebe a requisição e um delegate `next` que representa "o resto do pipeline", e decide se e como chamá-lo:

```csharp
public delegate Task<TResponse> RequestHandlerDelegate<TResponse>();

public interface IPipelineBehavior<TRequest, TResponse> where TRequest : IRequest<TResponse>
{
    Task<TResponse> Handle(TRequest request, RequestHandlerDelegate<TResponse> next, CancellationToken ct);
}
```

O wrapper monta a cadeia dobrando os behaviors registrados do último para o primeiro, de modo que o primeiro registrado é o mais externo:

```csharp
RequestHandlerDelegate<TResponse> pipeline = () => handler.Handle(typed, ct);
var behaviors = services.GetServices<IPipelineBehavior<TRequest, TResponse>>().ToArray();
for (var i = behaviors.Length - 1; i >= 0; i--)
{
    var behavior = behaviors[i];
    var next = pipeline;
    pipeline = () => behavior.Handle(typed, next, ct);
}
return pipeline();
```

Copiar `pipeline` para `next` dentro do laço importa: a lambda precisa capturar um valor que não muda na próxima iteração. O contêiner devolve os registros de genéricos abertos na ordem de registro, e é por isso que o `Program.cs` lista os behaviors explicitamente em vez de varrê-los. Ordem é comportamento.

### Três behaviors que valem a pena

**Logging** envolve tudo e é o mais simples: registrar antes, chamar `next()`, registrar depois. **Validação** executa todo `IValidator<TRequest>` registrado para a requisição, coleta todos os erros (não só o primeiro) e lança antes de o handler rodar:

```csharp
var errors = validators.SelectMany(v => v.Validate(request)).ToList();
if (errors.Count > 0) throw new ValidationException(errors);
return next();
```

**Transação** abre uma unidade de trabalho, executa o resto, faz commit no sucesso e rollback em qualquer exceção, relançando a original:

```csharp
public sealed class TransactionBehavior<TRequest, TResponse>(IUnitOfWork uow)
    : IPipelineBehavior<TRequest, TResponse> where TRequest : ICommand<TResponse>
```

A constraint `where TRequest : ICommand<TResponse>` é todo o truque do "só comandos". Quando o genérico aberto `TransactionBehavior<,>` é registrado para `IPipelineBehavior<,>`, o contêiner só o produz para tipos fechados que satisfazem a constraint, então uma consulta nunca abre transação. Isso foi executado no lab: uma consulta pelo mesmo pipeline deixa a unidade de trabalho sem nenhuma chamada. Colocar a validação antes da transação significa que uma requisição inválida nunca abre uma. Com o EF Core, a unidade de trabalho costuma ser o `SaveChangesAsync`, mais uma transação explícita só quando um caso de uso precisa de mais de um save (veja Transactions and Optimistic Concurrency in EF Core).

A validação aqui lança uma exceção porque um behavior não pode devolver um `TResponse` diferente sem conhecê-lo. A alternativa é um tipo result, que o behavior só consegue construir quando o `TResponse` é ele próprio um result (veja Result Types versus Exceptions). A rota (ou um único exception handler, veja ProblemDetails and Global Exception Handling) traduz a exceção para um `400`.

### Vertical slices com Minimal APIs

Uma slice agrupa o que um caso de uso precisa: a requisição, o validador, o handler e a rota.

```text
Features/
  Orders/
    PlaceOrder.cs       -> record, validator, handler
    GetOrder.cs         -> record, DTO, handler
    OrdersEndpoints.cs  -> MapGroup("/orders") and the routes
```

A rota faz só HTTP: faz o bind do corpo, envia a requisição e traduz o resultado:

```csharp
group.MapPost("/", async (PlaceOrderRequest body, IMediator mediator, CancellationToken ct) =>
{
    try
    {
        var id = await mediator.Send(new PlaceOrder(body.Sku, body.Quantity), ct);
        return Results.Created($"/orders/{id}", new OrderDto(id, body.Sku.Trim(), body.Quantity));
    }
    catch (ValidationException e)
    {
        return Results.ValidationProblem(new Dictionary<string, string[]> { ["order"] = [.. e.Errors] });
    }
});
```

O record da requisição HTTP (`PlaceOrderRequest`) é separado do comando de propósito, para que o contrato da API e o caso de uso interno possam mudar de forma independente (veja DTOs and the API Contract). Slices não proíbem código compartilhado: uma slice que precisa da entidade `Order` a usa de um lugar compartilhado. O que muda é a direção padrão. As funcionalidades são donas do seu código e extraem peças compartilhadas quando duas delas realmente precisam da mesma coisa, em vez de partir de camadas que toda funcionalidade precisa atravessar. Uma slice pode usar o EF Core direto no handler, sem repositório, porque a slice é a fronteira. Isso é uma simplificação real para funcionalidades dominadas por CRUD e um risco real quando regras de negócio começam a se repetir entre handlers: nesse ponto a regra vai para o modelo de domínio.

Como isso se relaciona com estruturas maiores: camadas (veja Clean Architecture em Quatro Projetos) organizam por papel técnico, slices por funcionalidade, e módulos (veja Modular Monolith: Drawing Module Boundaries e From CRUD to Modular Monolith) traçam fronteiras entre áreas de negócio. Elas se combinam: um módulo pode ser organizado em slices por dentro, e um mediator dentro de um módulo não pode virar a forma como os módulos chamam uns aos outros, porque isso esconde o contrato que o módulo deveria publicar (veja Module Communication and Architecture Tests).

### A situação das bibliotecas hoje

Conferido em 2026-11-12:

- **MediatR** (Jimmy Bogard, agora Lucky Penny Software). A versão 12.5.0 no NuGet é `Apache-2.0`. A partir da 13.0.0, o pacote traz um arquivo `LICENSE.md` em vez de uma expressão SPDX, e o site oficial diz que as versões 13.0.0 e posteriores precisam de uma chave de licença, enquanto as anteriores continuam sob suas licenças open source originais. A última no NuGet é a 15.0.0. O site descreve uma faixa Community gratuita (registro por conta própria, desenvolvedores ilimitados) com condições: receita bruta anual abaixo de 5 milhões de USD, no máximo 10 milhões de USD de capital externo, não ser entidade governamental e não ser uma universidade usando a biblioteca em software institucional. As faixas pagas (Standard, Professional, Enterprise) são precificadas pelo tamanho do time. O `LICENSE.md` do repositório aponta para a Reciprocal Public License 1.5, ou para um contrato de licença comercial para quem não quer publicar o próprio código-fonte. Não há servidor de licenças: uma chave ausente ou inválida produz avisos ou erros nos logs, segundo o site. Leia os termos atuais antes de adotar ou atualizar, porque essa é a parte que muda.
- **Mediator**, de Martin Othamar (`Mediator.SourceGenerator` no NuGet, 3.0.2 estável no momento da escrita): o repositório declara a licença MIT e descreve uma API parecida com a do MediatR gerada em tempo de compilação, com retornos `ValueTask` e suporte a Native AOT. Os pipeline behaviors usam a mesma ideia de `IPipelineBehavior`, mas não são registrados automaticamente: você os lista nas opções.
- **Wolverine** (`WolverineFx` no NuGet, 6.64.0 no momento da escrita, MIT no pacote NuGet e na documentação): um framework maior de mensageria e web que também pode atuar como command bus em memória. É um compromisso de outra escala, com convenções próprias de handler e middleware, não uma substituição direta.
- **Seu próprio mediator**: as 40 linhas acima, mais os behaviors que você realmente usa. Para muitas aplicações é uma resposta legítima, e o lab mostra como pouco é necessário. O que se abre mão é da manutenção de casos de borda (notificações, streaming, requisições genéricas) de que você talvez nunca precise.

Trocar de biblioteca é barato quando os handlers dependem só de `Handle(request, ct)` e as interfaces são o único acoplamento, outro argumento para manter os handlers livres de tipos da biblioteca além da interface.

### Quando não usar um mediator

- **Um punhado de endpoints que chamam um serviço.** `IOrderService.PlaceAsync` já é um handler. Um mediator acrescenta um tipo de requisição, um tipo de handler e uma indireção sem nenhum comportamento que você use.
- **Sem comportamento transversal.** A razão mais forte para um pipeline é aplicar os mesmos passos a todo caso de uso. Sem ele, `Send` é uma chamada de método mais cara.
- **A navegação piora.** "Go to definition" em `Send(new PlaceOrder(...))` leva à interface, não ao handler. Ferramentas e convenções (um arquivo por slice) suavizam isso, mas não eliminam.
- **Handlers chamando handlers.** Se um handler envia outra requisição para reaproveitar lógica, você construiu um grafo de chamadas escondido. Extraia uma classe simples ou um método de domínio.
- **Chamadas entre módulos.** Use um contrato explícito entre módulos, não um mediator compartilhado em que qualquer um envia qualquer coisa.
- **Dependências que você pode injetar.** Behaviors podem ser feitos por endpoint filters (veja Parameter Binding and Endpoint Filters) para preocupações só de HTTP, ou por um decorator registrado em uma interface.

## Trade-offs

- **Indireção em troca de uniformidade.** O mediator faz todo caso de uso parecer igual e deixa um pipeline servir todos, mas o leitor não consegue mais seguir uma chamada clicando nela. O custo é pago por cada mantenedor; o benefício só aparece se o pipeline for realmente usado.
  ```csharp
  var id = await mediator.Send(new PlaceOrder(sku, qty), ct); // which class runs? search for IRequestHandler<PlaceOrder, Guid>
  ```
- **Behaviors escondem o fluxo de controle.** Uma transação ou validação aplicada pela ordem de registro é invisível no handler. Ordem errada (transação fora da validação) abre transações para entrada inválida. Mantenha a ordem em um só lugar e teste-a.
- **Exceções ou results vindos de um behavior.** Lançar mantém o `TResponse` simples, mas torna falhas esperadas excepcionais. Devolver um tipo result mantém as falhas na assinatura, mas força toda resposta a um único formato.
- **Um handler por requisição multiplica arquivos.** Slices os mantêm juntos, mas um projeto com centenas de handlers minúsculos precisa de convenção de nomes e boa busca. Também é fácil colocar regras reais nos handlers em vez do modelo de domínio, o que deixa as slices como transaction scripts.
- **CQRS sem repositório dividido ainda é um único modelo de consistência.** Essa é sua força (nenhuma consistência eventual para explicar) e seu limite (leituras são tão lentas quanto o banco de escrita permitir). Dividir repositórios é uma decisão maior e deve seguir uma necessidade medida.
- **Um mediator de terceiros é uma dependência de licença e de atualização.** A mudança do MediatR mostra que uma biblioteca minúscula no centro de toda requisição pode carregar termos comerciais. Um mediator escrito à mão ou gerado por source generator remove esse risco ao custo de manter ou escolher o código.
- **Reflexão e AOT.** A varredura simples e o `MakeGenericType` mostrados aqui funcionam bem no JIT, mas trimming e Native AOT pedem a abordagem gerada (veja Source Generators and AOT-Friendly Code).

## Lab

Neste lab você recebe uma API de pedidos com o encanamento de despacho já pronto (encontrar o wrapper certo por tipo de requisição e varrer handlers), e escreve as partes que tornam um mediator útil: a composição do pipeline, um behavior de validação, um behavior de transação que se aplica só a comandos e a rota que liga isso ao HTTP. Tudo roda em um único projeto de testes, sem banco de dados; a unidade de trabalho é um fake que registra as chamadas.

**O cenário**

`PlaceOrder` é um comando (`ICommand<Guid>`) com um validador e um handler; `GetOrder` é uma consulta. O `Program.cs` registra `LoggingBehavior`, `ValidationBehavior` e `TransactionBehavior` nessa ordem, então o logging envolve a validação, que envolve a transação.

**O que você vai fazer, passo a passo**

1. **Componha o pipeline (TODO-00).** Em `Mediator.cs`, envolva o handler com todo `IPipelineBehavior<TRequest, TResponse>` registrado. O primeiro behavior registrado precisa ser o mais externo, então dobre a lista a partir do fim. Um teste registra dois behaviors e verifica a ordem `outer>`, `inner>`, `handler`, `<inner`, `<outer`.
2. **Valide (TODO-01).** No `ValidationBehavior`, execute todos os validadores, colete todos os erros, lance `ValidationException` quando houver algum e nunca chame o handler nesse caso.
3. **Commit ou rollback (TODO-02).** No `TransactionBehavior`, inicie, execute `next()`, faça commit e devolva; em caso de exceção faça rollback, nunca commit, e relance a exceção original.
4. **Traduza para HTTP (TODO-03).** Em `OrdersEndpoints`, faça `POST /orders` enviar `PlaceOrder` e responder `201` com `Location` e um `OrderDto`, ou `400` com os erros de validação.

**Como saber que terminou**

`dotnet test` está todo verde. Você deve conseguir explicar por que o `TransactionBehavior` não roda para `GetOrder` embora esteja registrado para toda requisição, e o que muda se você trocar validação e transação no `Program.cs`.

**Desafios opcionais**

- **TODO-04:** adicione `CancelOrder` como um segundo comando em seu próprio arquivo. O que você precisou tocar fora da slice?
- **TODO-05:** chame um handler diretamente em um teste, sem o mediator. O que o mediator acrescentou e o que custou?
- **TODO-06:** troque a ordem de `ValidationBehavior` e `TransactionBehavior`. O que muda para uma requisição inválida?

**Pré-requisitos:** generics e interfaces em C#, Minimal APIs, injeção de dependência com registros de genéricos abertos e o SDK do .NET 10.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. No estado inicial os testes falham com `NotImplementedException` carregando o número do TODO.

## Documentation Links

- [MediatR license and pricing, MediatR.io](https://mediatr.io/) (doc)
- [MediatR on NuGet](https://www.nuget.org/packages/MediatR) (doc)
- [MediatR source and LICENSE.md, GitHub](https://github.com/jbogard/MediatR) (doc)
- [Mediator (source generator), GitHub](https://github.com/martinothamar/Mediator) (doc)
- [Wolverine documentation](https://wolverinefx.net/) (doc)
- [Dependency injection in ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/dependency-injection) (doc)
- [Minimal APIs overview, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis/overview) (doc)
- [CQRS pattern, Microsoft Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) (doc)
- [Vertical Slice Architecture, Jimmy Bogard](https://www.jimmybogard.com/vertical-slice-architecture/) (doc)
