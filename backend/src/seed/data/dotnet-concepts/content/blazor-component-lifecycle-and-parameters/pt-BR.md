---
version: 1.0
updatedAt: 2026-10-15
title: "Ciclo de Vida e Parâmetros de Componentes no Blazor"
summary: Quais hooks de ciclo de vida rodam e em que ordem no prerender e no modo interativo, quando OnParametersSet dispara, EventCallback, StateHasChanged, valores em cascata e @key, medidos em um app rodando.
---
## Objective

Um componente Razor é uma classe C# com ciclo de vida: o framework cria a
instância, entrega os parâmetros, renderiza e depois descarta. Os hooks desse
ciclo são onde moram a maioria dos bugs de Blazor: dado carregado duas vezes,
callback que muda o estado mas não a tela, `StateHasChanged` que lança exceção,
lista cujos inputs mantêm o texto errado depois de uma ordenação. Este concept
registra em log todos os hooks em um app real (SDK 10.0.100, Interactive Server,
prerender ligado) e mostra o que roda, em que ordem, na instância do prerender e
na interativa, além dos mecanismos de parâmetro que alimentam o ciclo:
`[Parameter]`, `EventCallback`, valores em cascata e `@key`. Render modes e
prerender estão em Blazor Render Modes and Hosting Models, e o roteamento em
Blazor Routing, Layouts and Navigation.

## Use Cases

- Carregar dados no hook certo, sem uma segunda consulta vinda do prerender e sem
  um flash de conteúdo vazio.
- Reagir a uma mudança de parâmetro (um id de rota, um filtro) recarregando, e
  não recarregar quando um re-render do pai não tem relação com isso.
- Ligar um filho ao pai com `EventCallback` para que a tela atualize.
- Limpar assinaturas e timers quando o usuário sai da página.

## Deep Dive

### Os hooks, medidos

Um componente filho sobrescreve todos os hooks e registra cada um, com o
renderer (`RendererInfo.IsInteractive`) entre parênteses. O pai passa um
`int Value`, uma `List<int>` e uma `string`. A primeira requisição, o prerender,
registrou:

```text
SetParametersAsync start (prerender)
OnInitialized
OnInitializedAsync start / end
OnParametersSet value=0
OnParametersSetAsync
ShouldRender
SetParametersAsync end
Dispose
```

`SetParametersAsync` envolve tudo: a implementação base atribui as propriedades
`[Parameter]`, depois chama os hooks de inicialização (só na primeira vez) e
`OnParametersSet{Async}` (toda vez). `OnAfterRender` não aparece, e a instância
foi descartada logo após o render: um componente pré-renderizado é jogado fora
quando a resposta termina, e o navegador depois cria uma instância nova. Na
instância interativa a mesma sequência reaparece, agora com
`OnAfterRender first=True`, e as mudanças de parâmetro seguintes registram só
`SetParametersAsync`, `OnParametersSet{Async}`, `ShouldRender` e
`OnAfterRender first=False`.

O detalhe que surpreende está no meio do log interativo:

```text
OnInitializedAsync start
OnAfterRender first=True          <- o primeiro render aconteceu aqui
OnInitializedAsync end            (depois de 300 ms de delay)
OnParametersSet value=0
```

Quando `OnInitializedAsync` realmente espera algo, o framework renderiza o
componente no primeiro `await` e renderiza de novo quando a task termina. O
componente precisa então tratar o estado "ainda não carregou" (`items is null`),
e `OnAfterRender(firstRender: true)` pode rodar antes de o dado chegar. Se o
método termina de forma síncrona, há um único render.

### Para que serve o `OnAfterRender`

`OnAfterRender{Async}` roda quando o DOM existe, então é o lugar do JavaScript
interop. No prerender não há navegador para chamar. Chamar `IJSRuntime` em
`OnInitializedAsync` registrou:

```text
InvalidOperationException: JavaScript interop calls cannot be issued at this time.
This is because the component is being statically rendered. When prerendering
is enabled, JavaScript interop calls can only be performed during the
OnAfterRenderAsync lifecycle method.
```

A mesma chamada dentro de `if (firstRender)` em `OnAfterRenderAsync` funcionou.
Não chame `StateHasChanged` incondicionalmente em `OnAfterRender`: ele agenda
outro render, que roda `OnAfterRender` de novo, um loop infinito. Proteja com
`firstRender` ou com uma checagem de estado.

### Quando os parâmetros são atribuídos de novo

Clicar em um botão do pai que só muda um contador `other` sem relação fez o filho
com `List<int>` rodar `SetParametersAsync` e `OnParametersSet` outra vez, com os
mesmos valores. Um segundo filho só com `int` e `string` não rodou:

```text
[prim] OnParametersSet value=0   (inicial)
(clique em "other": nada registrado)
[prim] OnParametersSet value=1   (clique em "v": um parâmetro mudou)
```

A documentação explica: os hooks rodam quando o pai re-renderiza e fornece tipos
primitivos ou imutáveis conhecidos com pelo menos uma mudança, ou quando existe
qualquer parâmetro de tipo complexo, porque o framework não tem como saber se um
objeto mutável mudou por dentro. Então `OnParametersSetAsync` não significa "o
parâmetro mudou". Compare com o valor anterior você mesmo antes de recarregar:

```csharp
[Parameter] public int ProductId { get; set; }
private int loadedId;

protected override async Task OnParametersSetAsync()
{
    if (ProductId == loadedId) return;   // re-render do pai com o mesmo id: ignora
    loadedId = ProductId;
    product = await Service.GetAsync(ProductId);
}
```

Sobrescrever `ShouldRender` para devolver `false` pula o render, mas não pula os
hooks de parâmetro. `OnInitializedAsync` é o lugar errado para carregar por
parâmetro, porque roda uma vez por instância e uma navegação para o mesmo
componente com outro id reaproveita a instância.

### `EventCallback` versus um delegate

Um filho que avisa o pai recebe um `EventCallback` ou `EventCallback<T>`. O mesmo
filho tinha dois botões, um chamando `EventCallback<int>` e outro `Action<int>`,
ambos ligados a um método do pai que fazia `picked += n`:

```text
clique callback -> tela: picked=1
clique action   -> tela: picked=1   (o campo valia 2, a UI não foi re-renderizada)
clique "other"  -> tela: picked=2   (qualquer render posterior mostra)
```

`EventCallback.InvokeAsync` chama o handler e depois re-renderiza o componente
dono dele, que é o que a documentação quer dizer com `StateHasChanged` chamado
automaticamente. Um `Action` ou `Func<Task>` puro executa o código e nada mais. O
`EventCallback` também tolera parâmetro não informado (chamar não faz nada), e o
`EventCallback<T>` entra no `@bind` pela convenção `ValueChanged`.

### `StateHasChanged` e o dispatcher

Um componente atualiza a tela enfileirando um render. Handlers que o próprio
framework invoca (eventos, `EventCallback`, hooks de ciclo de vida) já rodam no
contexto de sincronização do renderer. Código que acorda em outro lugar (um
`Task.Run`, um timer, um evento de um service) não. Chamar `StateHasChanged` ali
lançou:

```text
InvalidOperationException: The current thread is not associated with the
Dispatcher. Use InvokeAsync() to switch execution to the Dispatcher when
triggering rendering or component state.
```

A correção é `await InvokeAsync(StateHasChanged);`, e a mudança de estado feita
por esse código externo também deve ficar dentro do `InvokeAsync`. No teste, o
campo já tinha sido alterado pela thread errada antes da exceção, uma data race
que a exceção só denuncia pela metade.

### Valores em cascata

`<CascadingValue Value="theme">` disponibiliza um valor para todo descendente com
um `[CascadingParameter]` do tipo correspondente (ou do `Name`). Quando o valor
do pai muda, os descendentes assinantes rodam `OnParametersSet` de novo:

```razor
<CascadingValue Value="theme"><Themed /></CascadingValue>
<CascadingValue Value="theme" IsFixed="true"><Themed /></CascadingValue>
```

Depois de trocar `theme` de `dark` para `light`, só o primeiro `Themed` registrou
`OnParametersSet theme=light`. `IsFixed` dispensa a assinatura, o que a
documentação apresenta como a opção mais barata quando o valor nunca muda. Dois
limites da mesma página: parâmetros em cascata não atravessam a fronteira de
render mode (uma página estática não consegue cascatear um valor para um
componente interativo), e para estado do app inteiro o caminho suportado é
`AddCascadingValue` como service de nível raiz, porque ele fica disponível para
componentes interativos.

### `@key` e descarte

O Blazor compara uma lista por posição. Duas listas de três componentes `Row`,
cada um com um `<input>` preenchido com `typed-0`, `typed-1`, `typed-2`, e depois
invertidas:

```text
sem @key: c (instance 13)|typed-0   b (instance 14)|typed-1   a (instance 15)|typed-2
com @key: c (instance 18)|typed-2   b (instance 17)|typed-1   a (instance 16)|typed-0
```

Sem `@key` as instâncias ficaram no lugar e só o parâmetro `Label` mudou, então o
texto no input do DOM deixou de corresponder ao item. Com `@key="n"` as
instâncias acompanharam seus itens, e o texto digitado também. Use uma identidade
estável (um id, não o índice do loop) onde as linhas guardam estado.

`IDisposable` (ou `IAsyncDisposable`) é o hook para cancelar assinaturas. Além da
instância do prerender, o `Dispose` rodou também para a instância interativa
depois que a aba navegou para outra página, alguns segundos depois, quando o
circuito foi encerrado. Um timer ou assinatura de evento criado em
`OnInitialized` e nunca liberado mantém o componente vivo no servidor.

## Trade-offs

- **Carregar em `OnInitializedAsync` roda duas vezes com prerender.** O prerender
  e a instância interativa executam o método, então a consulta acontece duas
  vezes, a menos que o estado seja persistido entre as duas.
  ```csharp
  [PersistentState] public List<Product>? Products { get; set; }
  protected override async Task OnInitializedAsync() => Products ??= await Service.ListAsync();
  ```
- **`OnParametersSet` é um sinal de "o pai renderizou", não de mudança.** Um
  parâmetro mutável o faz disparar em todo render do pai, então recarregue só
  quando houver mudança real.
- **`EventCallback` é o padrão seguro de filho para pai.** Um delegate puro serve
  para um helper que não mexe em estado, mas não atualiza o pai.
- **`@key` custa memória e trabalho de diff.** Vale para linhas com estado ou
  animação, e é ruído em uma lista estática.
- **Valor em cascata fixo é rápido e congelado.** Um valor que será trocado
  depois precisa de um `CascadingValue` não fixo, e todo assinante paga por isso.
- **`StateHasChanged` em handler é um cheiro.** Eventos já re-renderizam; chamar
  na mão geralmente indica código fora do dispatcher que precisa de `InvokeAsync`.

## Lab

Neste lab você recebe uma biblioteca de componentes Razor com vários componentes pequenos, cada um com uma lacuna proposital. O seu trabalho é preencher essas lacunas até os testes passarem. A ideia central é tornar o ciclo de vida do componente Blazor visível e correto: a ordem dos hooks, os dois renders de um `OnInitializedAsync` assíncrono, parâmetros que avisam o pai com `EventCallback<T>`, recarregar só quando um parâmetro mudou de verdade, valores em cascata e código que acorda fora do dispatcher do renderer.

**O cenário**

Um conjunto de componentes didáticos, renderizados em memória pelos testes com bUnit (sem navegador, sem JavaScript, sem SignalR). O trabalho assíncrono é controlado por um `TaskCompletionSource` que o teste completa, nunca por um delay.

- `LifecycleProbe.razor`: registra no `CallLog` cada hook que roda.
- `AsyncLoader.razor`: mostra "Loading..." enquanto espera um `IDataSource`.
- `SelectableCard.razor` e `CardPicker.razor`: um cartão que avisa o pai, e o pai que exibe a escolha.
- `ProductView.razor`: carrega o nome de um produto por `ProductId` e também recebe um `List<int>` mutável (`Tags`).
- `ThemedLabel.razor`: um rótulo cuja classe depende de um tema.
- `Ticker.razor`: conta eventos de um `TickSource`, que pode disparar em qualquer thread.

**O que você vai fazer, passo a passo**

1. **Registrar os hooks (TODO-00).** Em `LifecycleProbe`, sobrescreva `SetParametersAsync` (chamando a base), `OnInitialized`, `OnInitializedAsync`, `OnParametersSet`, `OnParametersSetAsync`, `OnAfterRender` e `OnAfterRenderAsync`, adicionando uma entrada ao `Log` em cada um. Use o valor real de `firstRender`. Assim você vê que na segunda renderização os hooks de inicialização não rodam de novo.
2. **Carregar de forma assíncrona (TODO-01).** Em `AsyncLoader`, sobrescreva `OnInitializedAsync`, dê `await Source.LoadAsync()` e guarde o resultado em `data`. O componente renderiza "Loading..." no primeiro `await` e de novo quando a task termina.
3. **Devolver eventos ao pai (TODO-02).** Em `SelectableCard`, marque `Name` com `[EditorRequired]` e faça o botão invocar o `EventCallback<string>` com o nome (`@onclick`). Observe por que `CardPicker` atualiza sozinho: o `EventCallback` re-renderiza o dono do callback.
4. **Recarregar só quando o id mudou (TODO-03).** Em `ProductView`, o `List<int>` faz o `OnParametersSet` rodar a cada render do pai. Compare `ProductId` com `loadedId` e só chame o serviço quando ele realmente mudou.
5. **Ler o tema em cascata (TODO-04).** Em `ThemedLabel`, receba o tema com um `[CascadingParameter]` e use-o na classe (`label-dark`, `label-light`...). Sem valor em cascata, a classe continua `label-light`.
6. **Acordar fora do renderer (TODO-05).** Em `Ticker`, mova a mudança de estado e o `StateHasChanged` para dentro de `InvokeAsync`, e cancele a inscrição no `Dispose`. Sem isso o teste que dispara o evento numa thread de fundo quebra, e o componente vaza a inscrição.

**Como saber que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar a ordem dos hooks na primeira e na segunda renderização, por que `ProductView` não pode confiar em `OnParametersSet` para detectar mudança, e por que um evento vindo de outra thread precisa passar por `InvokeAsync`.

**Desafios opcionais**

- **TODO-06:** em `Badge`, capture os atributos não declarados com `CaptureUnmatchedValues = true` num `Dictionary<string, object>?` e aplique-os no `span` com `@attributes`.
- **TODO-07:** em `CounterBox`, sobrescreva `ShouldRender` para pular o render quando só `Other` mudou, e confirme que `OnParametersSet` ainda roda.

**Pré-requisitos:** async/await e `TaskCompletionSource` em C#, componentes Razor (`[Parameter]`, `@code`) e o .NET 10 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. A biblioteca já compila; os testes dos TODOs obrigatórios falham até você preencher cada componente, e cada TODO está marcado em comentário no próprio arquivo `.razor`.

## Documentation Links

- [ASP.NET Core Razor component lifecycle, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/lifecycle) (doc)
- [ASP.NET Core Razor component rendering, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/rendering) (doc)
- [ASP.NET Core Blazor event handling and EventCallback, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/event-handling) (doc)
- [ASP.NET Core Blazor cascading values and parameters, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/cascading-values-and-parameters) (doc)
- [Prerender ASP.NET Core Razor components, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/prerender) (doc)
