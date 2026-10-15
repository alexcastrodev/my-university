---
version: 1.0
updatedAt: 2026-10-15
title: "Portando do .NET Framework para o .NET Moderno"
summary: O que não existe mais e com que "barulho" cada lacuna aparece (erro, warning ou só em runtime), NU1701, netstandard2.0 e multi-targeting como ponte, o analisador CA1416, a ordem do porte e o estado atual das ferramentas oficiais.
---
## Objective

Boa parte do código .NET em produção ainda é .NET Framework 4.x: só Windows,
projetos no formato antigo, pacotes em `packages.config`. Portar para o .NET
moderno costuma ser mecânico para bibliotecas e aplicações de console, e só fica
caro onde o app depende de algo que deixou de existir. Este conceito lista o que
sumiu e, mais útil, com que "barulho" cada lacuna aparece: em tempo de
compilação, como warning, ou só em runtime. Depois mostra a ponte
(`netstandard2.0`, multi-targeting, o fallback NU1701), a ordem do porte e o
estado atual das ferramentas oficiais. Os experimentos rodaram no SDK 10.0.100
em macOS, compilando `net48` contra reference assemblies; o código `net48` em si
não executa nesta máquina, então todo resultado de runtime abaixo vem do .NET 10.

## Use Cases

- Estimar um porte legado achando antes as dependências que mais vão doer.
- Mover bibliotecas compartilhadas para um target que o app antigo e o novo
  consigam usar.
- Decidir entre porte in-place e migração incremental (strangler).
- Revisar um porte que "compila na minha máquina" atrás de lacunas que só
  falham em runtime no Linux ou em container.

## Deep Dive

### O que sumiu, e com que barulho falha

A lista oficial de tecnologias indisponíveis é curta: criação de app domains,
Remoting, code access security, security transparency, `System.EnterpriseServices`
e Windows Workflow Foundation. O servidor WCF é a exceção notável que tem
resposta, os pacotes CoreWCF. Uma biblioteca multi-targeted para os dois mundos
mostra como essas lacunas aparecem de formas bem diferentes:

```xml
<TargetFrameworks>net48;net10.0</TargetFrameworks>
<!-- só no net48: <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" /> -->
```

```csharp
#if NETFRAMEWORK
    var d = AppDomain.CreateDomain("sandbox");   // funciona no net48
#else
    AppDomain.CreateDomain("sandbox");           // mesma chamada no net10.0
#endif
```

```text
warning SYSLIB0024: 'AppDomain.CreateDomain(string)' is obsolete: 'Creating and unloading AppDomains is not supported and throws an exception.'   (só no net10.0)
PlatformNotSupportedException: Secondary AppDomains are not supported on this platform.   (em runtime)
```

A API ainda existe no .NET 10, então o código compila; o sinal é um warning. O
`BeginInvoke` de delegate é mais silencioso: `f.BeginInvoke(null, null)`
compilou sem warning e lançou `PlatformNotSupportedException: Operation is not
supported on this platform.` O Remoting é o caso barulhento, porque os tipos
realmente não existem: `using System.Runtime.Remoting.Channels;` falha com
`error CS0234: The type or namespace name 'Channels' does not exist`. As
substituições documentadas são processos ou containers separados para
isolamento, `AssemblyLoadContext` para carregar assemblies dinamicamente (veja o
conceito do host resolver), e pipes, gRPC e HTTP para comunicação.

### Diferenças silenciosas: existe, mas precisa de opt-in

Algumas coisas não sumiram, apenas saíram do framework compartilhado:

```csharp
Encoding.GetEncoding(1252);   // NotSupportedException: No data is available for encoding 1252.
Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
Encoding.GetEncoding(1252);   // ok
```

`ConfigurationManager` e o `app.config` funcionam depois de adicionar o pacote
`System.Configuration.ConfigurationManager`: com um `app.config` simples ao lado
do projeto, o build copiou o arquivo para `cfg.dll.config` e
`ConfigurationManager.AppSettings["Region"]` devolveu `eu-west`. Sem o pacote, a
compilação falha com `CS0103` no nome. As duas correções são baratas, mas nada
avisa antes, e por isso um porte precisa de checklist e de testes, não só de um
build verde.

### APIs de plataforma: warning não é garantia

As APIs específicas de plataforma deveriam ser sinalizadas pelo analisador de
compatibilidade de plataforma, o CA1416, ligado por padrão em projetos que miram
`net5.0` ou superior. Ele lê anotações `[SupportedOSPlatform]`: um método meu
anotado com `windows` gerou `warning CA1416: This call site is reachable on all
platforms`. Mas o analisador só é tão bom quanto as anotações do que você chama.
No macOS, com o projeto em `net10.0`:

```text
new Bitmap(10, 10)                       // System.Drawing.Common 10.0.13, sem warning CA1416
  -> TypeInitializationException, inner DllNotFoundException: Unable to load shared library 'gdiplus.dll'
Registry.CurrentUser                     // também sem warning CA1416
  -> null, então OpenSubKey(...) lança NullReferenceException
Console.SetWindowSize(80, 25)
  -> PlatformNotSupportedException
```

A correção documentada é um guard como `OperatingSystem.IsWindows()` em volta da
chamada, ou marcar o seu próprio método com `[SupportedOSPlatform("windows")]`
para o requisito subir até quem chama. Se o app continua no Windows, o Windows
Compatibility Pack (`Microsoft.Windows.Compatibility`) devolve registro, WMI,
event log, serviços e mais; a documentação fala em cerca de 20 mil APIs. Para
tudo que precisa rodar em Linux, teste em Linux.

### Dependências e a ponte

Um pacote que só traz um assembly `net48` ainda pode ser consumido pelo modo de
compatibilidade com .NET Framework, mas com um custo. Empacotei uma biblioteca
só `net48` e referenciei de um app `net10.0`:

```text
warn : NU1701: Package 'OldLib 1.0.0' was restored using '.NETFramework,Version=v4.6.1, ... v4.8.1' instead of the project target framework 'net10.0'. This package may not be fully compatible with your project.
hello from a net48 package        <- código trivial rodou normalmente
```

O warning é o ponto: ele se repete a cada build para que alguém teste esse
caminho, e dá para suprimir por pacote com `NoWarn="NU1701"` depois de
verificado. A ponte para as suas próprias bibliotecas é o `netstandard2.0`, a
última versão do .NET Standard que o .NET Framework suporta, ou o
multi-targeting como acima. Cuidado: a ponte esconde lacunas. Uma biblioteca
`netstandard2.0` que chama `AppDomain.CreateDomain` compilou com zero warnings e
falhou com o mesmo `PlatformNotSupportedException` quando um app `net10.0` a
chamou. Mirar o padrão garante que a API existe, não que ela funciona.

### Ordem, fases e ferramentas

A preparação documentada dá para fazer ainda no .NET Framework: mirar pelo menos
o 4.7.2, trocar `packages.config` por `PackageReference`, converter os projetos
para o estilo SDK e atualizar dependências. Depois, porte de baixo para cima.
Para uma árvore de dependências, o guia de ASP.NET manda atualizar as
bibliotecas em ordem pós-ordem (depth-first), então as folhas migram primeiro e
fazem multi-target até todos os consumidores terem migrado. Escolha o target
final pelo conceito do ciclo de suporte; a página de porte que li ainda sugere
mirar o .NET 8, então confira as datas antes de copiar uma versão recomendada.

Para apps ASP.NET com muito uso de `System.Web`, o guia recomenda a migração
incremental, uma implementação do padrão Strangler Fig, em vez de reescrever
no lugar. Windows Forms e WPF existem no .NET moderno, mas continuam só Windows.

Sobre ferramentas, confira o estado antes de planejar em cima delas. Nas
páginas consultadas para este conceito, o .NET Upgrade Assistant está
oficialmente deprecated em favor do agente GitHub Copilot modernization, e o
`try-convert` não é recomendado para projetos com tasks, targets ou imports
customizados. Não rodei nenhuma dessas ferramentas aqui, então trate-as como
opções a avaliar, não como passos verificados.

## Trade-offs

- **`netstandard2.0` maximiza o alcance e esconde lacunas.** Um assembly serve
  os dois runtimes, mas APIs presentes no padrão podem lançar exceção no .NET 10.
  ```csharp
  AppDomain.CreateDomain("x");   // compila para netstandard2.0, lança no net10.0
  ```
- **O modo de compatibilidade destrava e morde depois.** Pacotes com `NU1701`
  funcionam até tocarem em algo só do Windows ou removido; suprima o warning
  apenas depois de um teste ter exercitado o pacote.
- **O Windows Compatibility Pack mantém você no Windows.** Ele remove o
  obstáculo do porte, mas o código que fica não é portável para containers Linux.
- **Migração incremental custa infraestrutura duplicada.** Sessão, autenticação
  e logging precisam funcionar nos dois apps por um tempo; em troca, a produção
  nunca para.
- **Build limpo prova pouco.** Os sinais de compilação são parciais (um warning,
  nenhum warning ou um erro); reserve tempo para testes de runtime no SO alvo.

## Documentation Links

- [Upgrade .NET apps overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/) (doc)
- [Port from .NET Framework to .NET, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/framework-overview) (doc)
- [.NET Framework technologies unavailable on .NET 6+, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/net-framework-tech-unavailable) (doc)
- [Analyze dependencies to port code, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/third-party-deps) (doc)
- [Platform compatibility analyzer, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/analyzers/platform-compat-analyzer) (doc)
- [Use the Windows Compatibility Pack to port code, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/porting/windows-compat-pack) (doc)
- [Migrate from ASP.NET Framework to ASP.NET Core, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/migration/fx-to-core/) (doc)
