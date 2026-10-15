---
version: 1.0
updatedAt: 2026-10-15
title: "Render Modes e Modelos de Hospedagem do Blazor"
summary: Static SSR, Interactive Server, WebAssembly e Auto, o que o servidor devolve em cada modo, a dupla renderização da pré-renderização e os custos de latência, circuito e download.
---
## Objective

Antes do .NET 8 você escolhia um modelo de hospedagem para o app inteiro: Blazor
Server ou Blazor WebAssembly. Um Blazor Web App no .NET 8 ou posterior abandona
essa escolha e faz uma pergunta menor, por componente: onde este componente
renderiza e ele é interativo? A resposta é o render mode. Errar nisso produz
sintomas que parecem não ter relação: um botão que não faz nada, dados que
carregam duas vezes, um flicker na primeira pintura, um serviço que "não pode
ser resolvido" só na primeira requisição, ou um servidor que guarda estado de
cada aba aberta. Este concept mostra o que o servidor realmente envia em cada
modo, para você raciocinar a partir da saída e não a partir dos nomes.

## Use Cases

- Decidir entre uma página de conteúdo que não precisa de interatividade
  (static SSR) e um dashboard que reage a cada clique (Interactive Server).
- Entender por que o `OnInitialized` de um componente rodou duas vezes e como
  impedir que a segunda execução substitua os dados pré-renderizados.
- Escolher WebAssembly ou Auto para um site público em que manter um circuito no
  servidor por visitante sai caro demais.
- Ler os comentários HTML que o Blazor emite para depurar por que um componente
  não está interativo.

## Deep Dive

### Quatro modos, um padrão

Um componente não tem render mode a menos que você dê um, e então ele é
renderizado uma vez, no servidor, para HTML. Isso é static server-side rendering
(static SSR). Os outros três modos são escolhidos com a diretiva `@rendermode`:

| Modo | Onde roda | O que o browser mantém |
|---|---|---|
| Static (padrão) | Servidor, uma vez por requisição | Nada, a página é HTML puro |
| `InteractiveServer` | Servidor, por uma conexão SignalR | Um circuito no servidor |
| `InteractiveWebAssembly` | Browser, no runtime .NET WebAssembly | O runtime e os seus assemblies |
| `InteractiveAuto` | Primeiro no servidor, depois no browser | Um circuito, depois um download em cache |

Tudo abaixo vem de um projeto criado com `dotnet new blazor -int Auto` (SDK
10.0.100), que gera um projeto de servidor e um projeto `.Client`, mais cinco
páginas de teste. Cada página renderiza o mesmo componente, que registra onde e
com qual renderer o `OnInitialized` rodou:

```razor
@code {
    protected override void OnInitialized() =>
        Console.WriteLine($"{(OperatingSystem.IsBrowser() ? "BROWSER" : "SERVER")}, " +
                          $"renderer={RendererInfo.Name}, interactive={RendererInfo.IsInteractive}");
}
```

Um componente que precisa rodar no browser tem que morar no projeto `.Client`,
porque esse é o assembly que o runtime WebAssembly baixa.

### O que o servidor envia

O `curl` na página estática devolve a marcação pronta, e o botão não tem nenhuma
ligação de evento:

```text
$ curl -s localhost:5320/m-static
... <section data-probe="m-static"><p id="init">OnInitialized ran on SERVER, renderer=Static, interactive=False</p>
    <button>clicks: 0</button></section> ...
```

Em um modo interativo, a mesma marcação chega embrulhada em um par de
comentários. O primeiro descreve como iniciar o componente, o segundo fecha a
região que será substituída:

```text
<!--Blazor:{"type":"server","prerenderId":"884d...","sequence":0,"descriptor":"CfDJ8..."}-->
  <h1>m-server</h1> ... <button>clicks: 0</button>
<!--Blazor:{"prerenderId":"884d..."}-->
```

O marcador de `InteractiveWebAssembly` tem `"type":"webassembly"` e carrega o
`assembly` e o `typeName` a carregar (`auto.Client`,
`auto.Client.Pages.MWasm`). O `InteractiveAuto` tem `"type":"auto"` e carrega
tanto o descriptor do servidor quanto o assembly e o nome do tipo, porque quem
decide é o cliente, mais tarde. Com a pré-renderização desligada
(`@rendermode @(new InteractiveServerRenderMode(prerender: false))`), só o
marcador de abertura é enviado e a região vem vazia: o usuário não vê nada até o
circuito subir.

### A pré-renderização executa o seu componente duas vezes

Os modos interativos fazem prerender por padrão, então a primeira resposta já
tem conteúdo. O log do servidor para a página Interactive Server mostra as duas
renderizações:

```text
[m-server] OnInitialized ran on SERVER, renderer=Static, interactive=False
[m-server] OnInitialized ran on SERVER, renderer=Server, interactive=True
[m-server] OnAfterRender(first) on SERVER
```

A primeira linha é o prerender, com `RendererInfo.IsInteractive` falso. A
segunda é a nova instância do componente criada quando o circuito começa. Repare
que o `OnAfterRender` disparou só uma vez, depois da interatividade: ele nunca
roda durante a pré-renderização. Na página WebAssembly a história é a mesma,
exceto que o segundo `OnInitialized` escreve no console do browser, com
`BROWSER` e `renderer=WebAssembly`. Com `prerender: false` o log mostra só a
linha interativa.

A segunda instância começa do zero, então tudo que é gerado em `OnInitialized`
muda diante dos olhos do usuário. Um componente que sorteia um número e também
marca uma propriedade com `[PersistentState]` (confirmado nas release notes do
ASP.NET Core 10) mostra a diferença. Lendo o DOM em `DOMContentLoaded` e de novo
dois segundos depois:

```text
first paint : plain: 7185   persisted: 9050
interactive : plain: 7403   persisted: 9050
```

O `[PersistentState]` serializa o valor durante o prerender e o restaura na
instância interativa, então a consulta cara ou o id aleatório não são refeitos.
Os detalhes desse atributo pertencem ao lado de acesso a dados do Blazor.

### O que o browser faz em cada modo

Usando um browser de verdade contra o mesmo app:

- `InteractiveServer`: a página carrega o `blazor.web.js`, que faz um POST em
  `/_blazor/negotiate` e abre a conexão SignalR. Um clique envia o evento ao
  servidor e o servidor devolve um diff. O contador foi de 0 para 1 pelo
  circuito.
- `InteractiveWebAssembly`: nenhuma requisição a `/_blazor`. O browser baixa o
  runtime e os assemblies e executa o componente localmente.
- `InteractiveAuto`: em um profile de browser novo, a primeira visita abriu um
  circuito (o log mostra `renderer=Server`) enquanto os assets WebAssembly
  baixavam em segundo plano. Depois de um reload no mesmo profile, o componente
  rodou com `renderer=WebAssembly` e sem circuito. A documentação acrescenta que
  o Auto nunca muda um componente que já está na página de um modo para o outro
  e que ele prefere um modo que combine com os componentes interativos já
  presentes.

### Onde colocar o `@rendermode`

A diretiva pode ir na definição do componente (o arquivo da página), em uma
instância (`<Counter @rendermode="InteractiveServer" />`) ou no `<Routes>` do
`App.razor` para tornar o app inteiro interativo. Os render modes se propagam
pela árvore, então um filho herda o modo do pai, e a configuração de prerender
de um filho é ignorada quando um pai já escolheu um modo. Um filho não consegue
sair de um pai interativo, mas uma página estática pode conter componentes
interativos, que é o jeito barato de manter a maior parte de um site como HTML
puro.

Fazer prerender de um componente que mora em `.Client` o executa também no
servidor, então um serviço registrado só no projeto do browser não é resolvido
na primeira requisição. Registre-o também no servidor, torne-o opcional ou
desligue o prerender daquele componente.

### O que cada escolha custa

Latência: no Interactive Server todo evento vai ao servidor e volta, então a
documentação lista latência maior e ausência de suporte offline. Ela também
afirma que cada tela do browser precisa do seu próprio circuito e do seu próprio
estado de componente, e que um circuito termina quando não resta nenhum
componente Interactive Server na página.

Tamanho de download: um publish Release do template Auto padrão no SDK 10.0.100
produziu, para os arquivos que um cliente precisa (os 32 assemblies, o
`dotnet.native.wasm`, os scripts do runtime, o `blazor.web.js` e um arquivo de
dados ICU), 6,7 MiB sem compressão e 2,1 MiB com as cópias Brotli
pré-comprimidas que o publish gera. Uma página estática ou Interactive Server
precisa apenas do script do próprio Blazor, o `blazor.web.js`, com 47,5 KB em
Brotli no mesmo publish. São números de um app vazio: os seus assemblies somam a
eles. A memória por circuito depende inteiramente do que os seus componentes
guardam, então meça no seu app, a documentação não dá um valor fixo.

## Trade-offs

- **Static SSR é o mais barato e o menos interativo.** Sem circuito, sem
  download, ótimo para SEO, mas os botões não fazem nada até você adicionar um
  post de formulário ou uma região interativa.
  ```razor
  <button @onclick="Save">Save</button> @* inerte em uma página estática *@
  ```
- **Interactive Server guarda estado no servidor para cada tela aberta.** É
  simples de escrever e dá acesso direto ao banco, mas a capacidade é limitada
  pelos circuitos, e a documentação avisa que o estado do usuário muitas vezes se
  perde quando uma conexão caída é restabelecida, a menos que você o salve.
- **WebAssembly move trabalho para o cliente ao custo do primeiro download.**
  Funciona offline e é barato de hospedar, mas o código fica visível para os
  usuários e o componente só alcança recursos do servidor por uma API.
- **Auto esconde o custo do download na primeira visita e dobra a superfície.**
  Os componentes precisam rodar corretamente no servidor e no browser, então
  qualquer dependência só de servidor em um componente `.Client` é um bug
  esperando a segunda visita.
- **O prerender compra uma primeira pintura rápida e cobra uma execução em
  dobro.** Efeitos colaterais em `OnInitialized` (um insert, um contador)
  acontecem duas vezes se você não protegê-los.
  ```csharp
  protected override async Task OnInitializedAsync() =>
      items ??= await Service.LoadAsync(); // com [PersistentState] a segunda execução reaproveita a primeira
  ```
- **Um `@rendermode` global no `<Routes>` é conveniente e torna tudo
  interativo.** Você paga por um circuito ou um download em páginas que nunca
  precisaram; modos por página mantêm as páginas estáticas estáticas.

## Documentation Links

- [ASP.NET Core Blazor render modes, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/render-modes) (doc)
- [ASP.NET Core Blazor hosting models, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/hosting-models) (doc)
- [Prerender ASP.NET Core Razor components, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/components/prerender) (doc)
- [Blazor prerendered state persistence, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/state-management/prerendered-state-persistence) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
