---
version: 1.0
updatedAt: 2026-11-21
title: "Escolhendo um framework de UI para apps cliente em .NET"
summary: Um guia de decisão para escolher onde escrever um app cliente em .NET hoje, com as datas e o estado de suporte lidos nas fontes primárias (FAQ de desenvolvimento do Windows, política de suporte do MAUI, páginas de novidades de WPF e WinForms): WinUI 3, .NET MAUI, WPF, WinForms, Blazor Hybrid e Blazor no navegador, mais Avalonia e Uno em uma tabela curta. Medido no macOS arm64 com os SDKs 10.0.100 e 11.0.100: quais templates de cliente existem, o que o workload do MAUI exige, WPF e WinForms que compilam mas não rodam fora do Windows, um WPF hospedando Blazor e um publish de Blazor WebAssembly.
---
## Objective

"Em qual framework de UI eu escrevo um app cliente em .NET?" tem mais respostas do que qualquer outra pergunta do ecossistema, e as respostas mudaram muito em dez anos: o Xamarin acabou, o UWP deixou de ser o futuro, o WinUI 3 virou a recomendação da Microsoft para apps desktop novos no Windows, o .NET MAUI assumiu o papel multiplataforma, e WPF e WinForms continuaram vivos no .NET moderno. Esta lição é um guia de decisão, não um tutorial de nenhum deles. Tudo sobre suporte e datas foi lido nas páginas primárias em 2026-11-21 (não de memória, e em dois pontos contradiz o backlog que me trouxe aqui). O que um Mac com o SDK do .NET consegue mostrar foi medido: quais templates de cliente existem, o que o workload do MAUI puxa, projetos WPF e WinForms que compilam aqui mas não rodam aqui, um app WPF hospedando Blazor e um publish de Blazor WebAssembly. O que exige Windows ou dispositivo (WinUI 3, rodar qualquer coisa, instalar o workload do MAUI, que tem vários GB e que eu não instalei) está marcado como docs only. A lição não ensina MAUI, WPF ou WinForms a fundo: o objetivo é escolher com base em evidência e saber o que se abre mão.
Versões: SDK 10.0.100 (runtime 10.0.0) e SDK 11.0.100 GA (runtime 11.0.0), macOS 27.2 arm64 (Apple M4 Max, os tempos são dele); templates de WPF e WinForms em `net10.0-windows` e `net11.0-windows`; `Microsoft.AspNetCore.Components.WebView.Wpf` 10.0.130 e 11.0.10 (NuGet, 2026-11-21); últimas estáveis do NuGet lidas no mesmo dia: `Microsoft.Maui.Controls` 11.0.10, `Microsoft.WindowsAppSDK` 2.7.0, `Avalonia` 12.1.6, `Uno.WinUI` 7.0.65.

## Use Cases

- Começar uma ferramenta interna nova para Windows e decidir entre WinUI 3, WPF e WinForms.
- Decidir se mantém, porta ou reescreve uma aplicação WPF ou WinForms.
- Escolher uma stack para um app que precisa rodar em celulares e desktops a partir de um único código C#.
- Reaproveitar as habilidades de um time web (Razor ou JavaScript) em uma casca nativa (Blazor Hybrid, `HybridWebView`).
- Achar uma opção .NET para app desktop em Linux e avaliar frameworks de terceiros com honestidade.
- Conferir as datas de suporte antes de prometer a um cliente "cinco anos neste framework".

## Deep Dive

### O que a Microsoft diz hoje (a FAQ de desenvolvimento do Windows)

A fonte primária é a Windows App Development FAQ, no Microsoft Learn. O rodapé da página dizia "Last updated 2026-11-18" quando li (o backlog citava 2026-10-02, então ela mudou desde então). O que ela diz, na ordem da decisão:

- "If you're building a new general-purpose Windows desktop app, we recommend using WinUI 3." O WinUI 3 vem no Windows App SDK, roda no Windows 10 versão 1809 ou superior e não pode ser usado sem o Windows App SDK.
- WPF: "Is WPF deprecated? No." Ele continua recebendo trabalho de recursos, desempenho, acessibilidade e estilo Fluent no .NET moderno, mas "para apps desktop novos de uso geral, a recomendação principal da Microsoft é o WinUI 3". Um app WPF no .NET 9 ou superior pode usar o tema Fluent (visual do Windows 11, claro e escuro, cor de destaque).
- WinForms: não está obsoleto, "continua recebendo atualizações de recursos" (formulários e diálogos assíncronos, modo escuro, acessibilidade, alto DPI, clipboard, designer). Os dois têm roadmaps públicos no GitHub.
- Multiplataforma: "times que pretendem atingir várias plataformas devem começar com .NET MAUI ou React Native for Desktop". À pergunta "posso começar com WinUI 3 e depois integrar o MAUI?", a resposta é "Not at this time". No Windows, a saída de um app MAUI usa o WinUI 3.
- UWP e WinUI 2 "não estão formalmente obsoletos" (UWP no .NET moderno com Native AOT está em disponibilidade geral e é o projeto UWP C# padrão no Visual Studio 2026), mas apps desktop novos devem usar o WinUI 3. O UWP continua sendo a resposta para Xbox, apps 2D do HoloLens e o ambiente padrão do Surface Hub.
- O Blazor Hybrid pode ser hospedado por MAUI, WPF e WinForms (`BlazorWebView`), mas não por WPF ou WinForms em .NET Framework. O MAUI tem o `HybridWebView` desde o .NET 9 para hospedar qualquer UI em JavaScript (Angular, React, Vue).
- Os exemplos da própria página: o Microsoft Photos é um app WinUI 3 (migrado do UWP), e "a maior parte da UI do Visual Studio é construída com WPF".
- Limites do WinUI 3 que ela admite: sem designer de UI no Visual Studio ("Not currently", usa-se XAML Hot Reload e a árvore visual ao vivo); o build de XAML exige MSBuild (`dotnet build` funciona, o Visual Studio não é obrigatório); empacotado ou não empacotado é uma decisão real (alguns recursos exigem identidade de pacote); apps dependentes de framework precisam do runtime do Windows App SDK instalado.

A página de suporte do Windows App SDK (datada de 2026-09-24) lista o Windows App SDK 2 lançado em 2026-04-29, o 1.8 em 2025-09-09, o 1.7 em 2025-03-18 e o 1.6 em 2024-09-04; o NuGet mostra `Microsoft.WindowsAppSDK` 2.7.0 publicado em 2026-11-17. O WinUI 3 é docs only aqui: ele precisa do Windows para compilar, e eu não li nem rodei um projeto WinUI 3.

### Datas de suporte, das fontes

```text
.NET MAUI 11   lançado 2026-11-10  último patch 11.0.10 (2026-11-11)  fim do suporte 2028-05-09
.NET MAUI 10   lançado 2025-11-11  último patch 10.0.130 (2026-11-09) fim do suporte 2027-05-11
.NET MAUI 9    fim do suporte 2026-05-12      Xamarin (todos os SDKs, Xamarin.Forms)  acabou em 2024-05-01
.NET 10 (LTS) e .NET 11 (STS)  ambos terminam em 2028-11-14   (página da política de suporte do .NET, atualizada em 2026-11-10)
```

A página da política do MAUI (atualizada em 2026-11-11) confirma o backlog: o MAUI 10 tem suporte até 2027-05-11 e o MAUI 11 até 2028-05-09. Duas consequências fáceis de perder. Primeiro, o MAUI não tem LTS: cada versão tem suporte por 18 meses aqui, e a política promete "no mínimo 6 meses depois que um sucessor é lançado", então o MAUI 10 termina 18 meses antes do runtime .NET 10 em que ele roda. Um app MAUI no .NET 10 LTS portanto não ganha três anos de manutenção do MAUI; planeje uma atualização maior do MAUI por ano. Segundo, o suporte vale só para a última atualização de serviço ("To receive technical support from Microsoft, you need to be on the latest servicing level"), com patches mensais junto com o resto do .NET. WPF e WinForms são o framework `Microsoft.WindowsDesktop.App` dentro do runtime do .NET (o erro do apphost mais abaixo o nomeia), então seguem as datas da versão do .NET (o [concept de ciclo de vida](/dotnet-concepts/dotnet-support-lifecycle-and-choosing-a-target) trata delas), e não achei uma data de fim separada, em nível de framework, para eles. Para o Windows App SDK, o suporte exige uma versão suportada e um canal de serviço do Windows suportado, segundo a página citada.

O que o .NET 11 trouxe ao MAUI (página de novidades, datada de 2026-09-10): o CoreCLR é o runtime padrão em todas as plataformas (o Mono continua disponível, o NativeAOT é opcional), o Android mínimo subiu da API 21 para a 24, handlers Material 3 no Android, templates de projeto de teste (`androidtest`, `iostest`, ...) e a opção de JSON gerado por source generator no `HybridWebView` para trimming. O destaque da página é "melhorar a qualidade do produto", não superfície nova. Para WPF, a página do .NET 11 (ainda intitulada "RC 1", datada de 2026-09-17 quando li, mesmo com o .NET 11 já em GA) lista três correções de bugs (ijwhost.dll em apps self-contained, prevenção de crash do DWM, uma correção em `WeakEventTable`). Para WinForms ela lista mais: `Application.SetDefaultVisualStylesMode` e `VisualStylesMode.Net11`, `KioskModeManager`, `Application.SystemVisualSettings`, `FormRevealMode`, `SuspendPainting`, um `CheckBox` em formato de toggle, e avisa que a nova renderização "ainda não é final" até o GA. No .NET 10, o WinForms tirou o status experimental de `Form.ShowAsync` e do modo escuro (`Application.SetColorMode`) e passou a compartilhar o código de clipboard com o WPF; o WPF 10 levou o estilo Fluent a mais controles ("ainda em andamento") e fez trabalho de desempenho. Leia isso como "mantido, evoluindo devagar", que é o que a FAQ afirma, e o oposto de um framework sendo reescrito.

### O que o SDK mostra no macOS arm64 (medido)

`dotnet new list` filtrado para templates de cliente, mesma saída nos dois SDKs salvo indicação:

```text
SDK 10.0.100:  blazor, blazorwasm, winforms, winformslib, winformscontrollib, wpf, wpflib, wpfcustomcontrollib, wpfusercontrollib
SDK 11.0.100:  os mesmos, mais blazorwebworker e blazorwasm-servicedefaults
dotnet new list maui | blazorhybrid | winui   ->  "No templates found" (nos dois SDKs)
```

Não existe template de MAUI, Blazor Hybrid ou WinUI sem o workload do MAUI (os templates do WinUI 3 vêm do Visual Studio ou das ferramentas do Windows App SDK, docs only). Uma armadilha: `dotnet new search blazorhybrid` acha no NuGet.org um pacote cujo nome curto é `blazorhybrid`: "Experimental Mobile Blazor Bindings Hybrid App" (`Microsoft.MobileBlazorBindings.Templates`), que não é o template Blazor do MAUI. A listagem do workload (não instalado, a instalação em si é docs only):

```text
dotnet workload search  ->  maui, maui-android, maui-desktop, maui-ios, maui-maccatalyst, maui-mobile, maui-tizen, maui-windows (mais android, ios, maccatalyst, macos, tvos, wasm-tools ...)
manifesto lido do disco, SDK 11.0.100:  maui estende maui-mobile + maui-desktop; maui-windows estende maui-blazor; 14 packs
    (Microsoft.Maui.Controls, Core, Essentials, Graphics, Resizetizer, WebView.Maui, Sdk.net11 e net10, Templates.net11 e net10 ...)
manifesto lido do disco, SDK 10.0.100:  packs do maui 10.0.110 (Sdk.net10 e net9)
```

Dois achados. O manifesto do MAUI embutido no meu SDK 11.0.100 GA lista packs na versão `11.0.0-preview.6.26360.8`, enquanto o NuGet tem o `Microsoft.Maui.Controls` 11.0.0 GA (2026-11-10) e o 11.0.10: uma instalação nova do MAUI precisa da atualização do manifesto (`dotnet workload update`, docs only aqui) para chegar aos packs GA. E o workload `maui` é o único caminho para os templates, os packs de iOS e Android e o alvo Windows, então "o MAUI funciona no agente de CI" é uma questão de instalar workload, não de restaurar pacote (tamanho medido: não medi, o brief fala em vários GB). O SDK 10.0.100 desta máquina já tinha os workloads `android` e `ios` instalados por outra pessoa; não mexi neles.

WPF e WinForms compilam no macOS se você pedir. Sem a propriedade, o build para em 0,15 s:

```text
error NETSDK1100: To build a project targeting Windows on this operating system, set the EnableWindowsTargeting property to true.
```

Com `-p:EnableWindowsTargeting=true` (os projetos de `dotnet new wpf` e `winforms`, sem alteração, três pastas novas por célula, restore incluído, packs já no cache do NuGet):

```text
                 SDK 10.0.100 (net10.0-windows)     SDK 11.0.100 (net11.0-windows)
build WinForms   1,38 a 1,40 s                      1,06 a 1,08 s
build WPF        2,27 a 2,30 s                      1,61 a 1,65 s
primeiro build   3,4 s (WPF, home do NuGet vazio)   2,6 s WPF, 0,9 s WinForms (home vazio próprio, baixa microsoft.windowsdesktop.app.ref)
Demo.dll         WPF 7.168 B, WinForms 5.632 B (idênticos nos dois SDKs); fonte do template 2,4 KB em 6 arquivos (WPF), 1,8 KB em 4 arquivos (WinForms)
```

A saída tem um apphost `osx-arm64` (`Mach-O 64-bit executable arm64`), e rodá-lo mostra por que "só Windows" significa só Windows:

```text
You must install or update .NET to run this application.
Architecture: arm64
Framework: 'Microsoft.WindowsDesktop.App', version '10.0.0' (arm64)
No frameworks were found.
```

Então um Mac ou um agente de CI Linux pode compilar, rodar analisadores e construir bibliotecas de WPF e WinForms, e não consegue rodar nem testar a UI (a página do `NETSDK1100` documenta a propriedade). A diferença de tempo entre o 10 e o 11 é diferença da ferramenta de build medida em uma máquina, três execuções cada; não diz nada sobre desempenho em tempo de execução.

### Blazor Hybrid e Blazor no navegador

O Blazor Hybrid roda componentes Razor dentro do processo do app (sem WebAssembly) e renderiza em um web view embutido por um canal local de interop. A página de Blazor Hybrid lista os hosts: MAUI (`BlazorWebView` já vem incluído), WPF e WinForms (controles `BlazorWebView` de `Microsoft.AspNetCore.Components.WebView.Wpf` e `.WindowsForms`). Medido aqui: segui o tutorial de WPF (SDK `Microsoft.NET.Sdk.Razor`, um `Counter.razor`, `wwwroot/index.html`, `AddWpfBlazorWebView()`) e ele compilou no macOS, 0 avisos:

```text
SDK 11.0.100  net11.0-windows10.0.17763.0  WebView.Wpf 11.0.10   compilou em 4,4 s (primeiro restore dos pacotes)
SDK 10.0.100  net10.0-windows10.0.17763.0  WebView.Wpf 10.0.130  compilou em 5,2 s
pasta bin (Debug) 27,6 MB, com Microsoft.Web.WebView2.Wpf.dll, Microsoft.AspNetCore.Components.WebView.dll ...
```

O tutorial exige um TFM com versão do Windows (`-windows10.0.17763.0`) desde o .NET 10, por causa da troca para o `WebView2CompositionControl`. Rodar exige Windows (docs only). O que isso compra: um app WPF ou WinForms pode ganhar telas novas em Razor e depois compartilhá-las com o MAUI ou a web, sem reescrita. Veja [Blazor render modes and hosting models](/dotnet-concepts/blazor-render-modes-and-hosting-models) para o comportamento dos mesmos componentes nos modos servidor, WebAssembly e estático.

A alternativa sem instalação é o Blazor no navegador. `dotnet new blazorwasm` e `dotnet publish -c Release` no SDK 11.0.100 funcionaram sem nenhum workload, em 15,0 s: 19.648.824 bytes de arquivos em `wwwroot` e 4.368.332 bytes de cópias em brotli. Um app no navegador não tem instalador, loja nem alvos de SO, e não alcança as APIs nativas do dispositivo além do que o navegador expõe; o [concept do cliente WebAssembly](/dotnet-concepts/blazor-webassembly-client-and-api-integration) cobre o lado da API e [escolhendo um modelo de aplicação ASP.NET Core](/dotnet-concepts/choosing-an-aspnet-core-application-model) cobre quando um app web é o formato certo.

### Opções de terceiros (curto, com o estado lido nas fontes)

| | Avalonia | Uno Platform |
|---|---|---|
| Modelo | XAML e renderização próprios (Skia), parecido com WPF | API compatível com WinUI 3, renderiza com Skia em todos os alvos |
| Alvos | Windows, macOS, Linux, iOS, Android, WebAssembly | mobile, web, desktop, embarcado |
| Última lida | 12.1.6 (2026-11-09); 12.0.0 em 2026-04-07 | 7.0.65 no NuGet (2026-11-13) |
| Licença, repositório | MIT, cerca de 31,9 mil estrelas no GitHub | Apache-2.0, cerca de 10,1 mil estrelas |
| Linux | Tier 1: Ubuntu 25.xx, Fedora 43, Debian 13; Wayland opcional desde o 12.1.0 | não verificado (a introdução da doc cita desktop e renderização Skia) |
| Fonte | doc "Supported platforms" do Avalonia | introdução da doc do Uno, NuGet, API do GitHub |

Para comparar, `dotnet/maui` tem cerca de 23,3 mil estrelas, `microsoft-ui-xaml` cerca de 8,6 mil, `dotnet/wpf` cerca de 7,8 mil e `dotnet/winforms` cerca de 4,9 mil (API do GitHub, 2026-11-21): estrelas medem popularidade, não uso, e estão aqui só para o leitor ver a escala. A própria doc do Avalonia divide as plataformas em tiers (Tier 1 é testado a cada release; Tier 2 é best effort; Tier 3 é só com suporte comercial), uma forma franca de ler "suportado". Não compilei com nenhum dos dois (docs only, mais metadados do NuGet e do GitHub). A página de primeiro app do .NET 11 descreve `dotnet new maui-multiproject --avalonia`, que adiciona um projeto desktop em Avalonia para Windows, macOS e Linux ao lado do projeto MAUI: docs only, não executado (exige o workload).

### A tabela de decisão

| Situação | Recomendação | Fonte |
|---|---|---|
| App desktop novo, só Windows | WinUI 3 + Windows App SDK; WPF se o time o conhece e os requisitos cabem | FAQ do Windows (2026-11-18) |
| WPF ou WinForms existente | Manter; sair do .NET Framework para o .NET moderno; acrescentar telas Razor com `BlazorWebView` se precisar | FAQ do Windows; páginas de novidades de WPF e WinForms do .NET 10 e 11; [concept de portabilidade](/dotnet-concepts/porting-from-net-framework-to-modern-net) |
| Celulares e desktops, um código C# | .NET MAUI (comece pelo MAUI, não pelo WinUI 3, segundo a FAQ), atualizar todo ano | política de suporte do MAUI (11 até 2028-05-09) |
| Habilidades web (Razor ou JavaScript) | Blazor Hybrid em MAUI, WPF ou WinForms; `HybridWebView` para UIs JS; Blazor no navegador; React Native for Desktop para times JS | página de Blazor Hybrid; FAQ do Windows |
| Desktop Linux | Avalonia (ou Uno); o MAUI não documenta alvo Linux | página de plataformas do Avalonia; "What is MAUI" |
| Xbox, HoloLens 2D, Surface Hub padrão | UWP | FAQ do Windows |
| Zero instalação, maior alcance | Blazor ou outro app web (PWA) | FAQ do Windows |

Os frameworks XAML desta tabela (WinUI 3, WPF, MAUI, Avalonia, Uno) compartilham o mesmo padrão de UI, então o que você aprende sobre data binding e comandos vale entre eles: veja [MVVM e CommunityToolkit.Mvvm](/dotnet-client-apps-concepts/mvvm-and-communitytoolkit-mvvm).

### Mercado: o que consegui e não consegui verificar

O backlog diz que o mercado de vagas novas para WPF, WinForms e MAUI é médio-baixo, e eu também esperava achar fonte fácil para "WPF e WinForms ainda dominam o legado". Não achei dado para nenhuma das duas afirmações. A Stack Overflow Developer Survey 2026 (e a de 2025) lista frameworks web, e o Blazor aparece com 6,7% de 10.281 respondentes (ASP.NET Core 19,9%) em 2026; WPF, WinForms, MAUI, Avalonia e Uno não estão entre as tecnologias pesquisadas, então a pesquisa não consegue ordená-los. Não consultei sites de vagas. A única evidência de uso nas fontes são os exemplos da própria FAQ (a UI do Visual Studio em WPF, o Photos em WinUI 3), que mostram que esses frameworks sustentam produtos grandes, não quantas vagas existem. Trate "domina o legado" como plausível e não medido.

### Book vs today

- **Xamarin.Forms e "UWP é o futuro".** Livros antigos ensinam Xamarin.Forms para multiplataforma e UWP com WinUI 2 para Windows. O suporte do Xamarin acabou em 2024-05-01 para todos os SDKs, incluindo o Xamarin.Forms, e o MAUI é sua evolução; o UWP "não está formalmente obsoleto", mas apps desktop novos são orientados a usar o WinUI 3, e o WinUI 2 é uma biblioteca só de UWP, incompatível com o WinUI 3.
- **WPF e WinForms estão mortos.** A FAQ responde "não obsoleto" nos dois casos e as páginas do .NET 10 e 11 mostram mudanças contínuas (pequenas no WPF, maiores no WinForms). O que mudou foi a recomendação para projetos novos, não o suporte.
- **WPF em .NET Framework 4.x.** Ainda é o formato da maioria dos livros antigos. O Blazor Hybrid em WPF ou WinForms não é suportado ali, só no .NET moderno.
- **Windows App SDK 1.x.** Tutoriais de 2022 a 2025 mostram o 1.x; a página de suporte lista o 2 (2026-04-29) e o NuGet mostra o 2.7.0 em 2026-11-17, então confira a versão antes de copiar um arquivo de projeto.

## Trade-offs

- **O WinUI 3 é o caminho recomendado e o mais estreito.** Só Windows, Windows 10 1809 ou superior, sem designer no Visual Studio, decisões de empacotamento e de runtime do Windows App SDK logo de início. Se o mesmo app puder precisar de um celular um dia, a FAQ diz para começar pelo MAUI, porque o WinUI 3 não consegue "integrar o MAUI" depois. Exemplo: uma ferramenta interna para 200 notebooks Windows 11 gerenciados cabe em WinUI 3 ou WPF; um app de campo para tablets e celulares não.
- **WPF e WinForms são o mais seguro para código existente e o menos moderno para código novo.** São suportados e evoluem, mas a página de WPF do .NET 11 lista só correções de bugs, e o trabalho de visual moderno de destaque é o novo visual styles do WinForms, que a própria página marca como não final. Escolha-os quando as habilidades do time e o código existente pesarem mais que a recomendação.
- **O MAUI compra alcance e vende um relógio de 18 meses.** Um código para Android, iOS, macOS e Windows, mas cada versão maior tem suporte até 18 meses depois do próprio lançamento, então o app fica numa esteira de atualização anual, enquanto o .NET 10 LTS dura até 2028-11-14. O alvo Windows é WinUI 3 por baixo, e não há alvo Linux na documentação.
  ```text
  MAUI 10 termina em 2027-05-11, .NET 10 termina em 2028-11-14: 18 meses de runtime sem manutenção do MAUI.
  ```
- **O Blazor Hybrid compartilha UI, não aparência nativa.** Os componentes Razor renderizam em um web view, então os estilos podem diferir por plataforma, e a própria página avisa sobre diferenças entre plataformas. É um jeito de reaproveitar habilidades web dentro de uma casca nativa, não um substituto dos controles da plataforma.
- **Apps no navegador não pedem instalação e não alcançam o dispositivo.** O Blazor WebAssembly publicado ficou com 19,6 MB sem compressão (4,4 MB em brotli) para o app do template aqui; serve para uma ferramenta corporativa em boa rede, é um custo em redes móveis.
- **Frameworks de terceiros trocam respaldo de fornecedor por alcance.** Avalonia e Uno cobrem Linux e WebAssembly, que o MAUI não cobre, mas são projetos separados com cadência de release e termos de suporte próprios (os tiers do Avalonia dizem isso por escrito). Avalie os mantenedores como qualquer dependência antes de apostar um produto neles.
- **Um Mac compila UI de Windows e não consegue testá-la.** `EnableWindowsTargeting` torna o CI em Linux ou macOS útil para builds e testes de biblioteca; testes de UI exigem runners Windows.

## Documentation Links

- [Windows App Development Frequently Asked Questions, Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/get-started/windows-developer-faq) (doc)
- [.NET MAUI support policy, .NET](https://dotnet.microsoft.com/en-us/platform/support/policy/maui) (doc)
- [Xamarin support policy, .NET](https://dotnet.microsoft.com/en-us/platform/support/policy/xamarin) (doc)
- [.NET and .NET Core support policy, .NET](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) (doc)
- [Windows App SDK and supported Windows releases, Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/support) (doc)
- [What's new in .NET MAUI for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/whats-new/dotnet-11) (doc)
- [What is .NET MAUI?, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/what-is-maui) (doc)
- [Build your first .NET MAUI app, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/get-started/first-app?view=net-maui-10.0) (doc)
- [What's new in Windows Forms for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/whats-new/net110) (doc)
- [What's new in Windows Forms for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/desktop/winforms/whats-new/net100) (doc)
- [What's new in WPF for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/whats-new/net110) (doc)
- [ASP.NET Core Blazor Hybrid, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/hybrid/?view=aspnetcore-10.0) (doc)
- [Build a WPF Blazor app, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/blazor/hybrid/tutorials/wpf?view=aspnetcore-10.0) (doc)
- [NETSDK1100: building Windows-targeted projects on other operating systems, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/sdk-errors/netsdk1100) (doc)
- [Upgrade from Xamarin to .NET MAUI, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/migration/) (doc)
- [Supported platforms, Avalonia documentation](https://docs.avaloniaui.net/docs/overview/supported-platforms) (doc)
- [Uno Platform documentation](https://platform.uno/docs/articles/intro.html) (doc)
- [WPF roadmap, GitHub](https://github.com/dotnet/wpf/blob/main/roadmap.md) (doc)
- [Windows Forms roadmap, GitHub](https://github.com/dotnet/winforms/blob/main/docs/roadmap.md) (doc)
- [Technology, Stack Overflow Developer Survey 2026](https://survey.stackoverflow.co/2026/technology) (doc)
