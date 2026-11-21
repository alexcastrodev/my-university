---
version: 1.0
updatedAt: 2026-11-21
title: "MVVM e CommunityToolkit.Mvvm"
summary: MVVM em .NET medido com o pacote CommunityToolkit.Mvvm 8.4.2 num projeto de console (net10.0 e net11.0, macOS): o código que os geradores escrevem para [ObservableProperty] em partial properties, a ordem exata dos eventos, comandos assíncronos e a exceção que derruba o app, WeakReferenceMessenger contra StrongReferenceMessenger medidos com o GC, Ioc.Default como service locator e um ViewModel testado com MSTest 4 sem UI. XAML e bindings ficam como docs only, com o estado de MVVM Light, Prism e ReactiveUI hoje.
---
## Objective

MVVM divide um app cliente em três: a View (o que é desenhado), o ViewModel (o estado e as ações de que a View precisa, sem referência a nenhum controle) e o Model (os dados e as regras). A View se liga ao ViewModel por dois contratos pequenos: `INotifyPropertyChanged` diz "este valor mudou" e `ICommand` diz "esta ação existe e pode ou não rodar agora". O ganho não é o binding em si, e sim que o ViewModel é uma classe comum que você testa sem abrir janela. O `CommunityToolkit.Mvvm` (sucessor do MVVM Light, mantido pela Microsoft) escreve a parte repetitiva com source generators. Esta lição roda o pacote de verdade num projeto de console no macOS (o Toolkit não depende de UI): o código que os geradores escrevem, a ordem exata dos eventos, comandos assíncronos e a exceção que mata o app, messenger fraco contra forte medido com o GC, `Ioc.Default` e um ViewModel testado com MSTest 4 sem UI. XAML, `{Binding}`, bindings compilados e tudo que exige WPF, WinUI ou MAUI está marcado como docs only.
Versões (NuGet, resolvidas em 2026-11-21): `CommunityToolkit.Mvvm` 8.4.2 (publicada em 2026-03-25, a estável mais nova), `Microsoft.Extensions.DependencyInjection` 10.0.15 (11.0.0 no net11.0), `MSTest` 4.5.3 (MSTest.Sdk, Microsoft.Testing.Platform), TFM `net10.0` no SDK 10.0.100 (runtime 10.0.0) e `net11.0` no SDK 11.0.100 (runtime 11.0.0), um Apple M4 Max com macOS 27.2.1 (os tempos são dele).

## Use Cases

- Montar uma tela WPF, WinUI ou .NET MAUI cuja lógica precisa de teste unitário sem subir a UI.
- Trocar 40 linhas de `INotifyPropertyChanged` e `ICommand` escritas à mão em cada ViewModel por atributos.
- Validar a entrada no ViewModel (`INotifyDataErrorInfo`), de modo que o formulário mostre erros das mesmas regras que os testes usam.
- Fazer duas telas conversarem (um usuário mudou, uma lista precisa atualizar) sem que uma guarde referência à outra.
- Migrar uma base com MVVM Light ou com `ViewModelBase` escrito à mão, ou um app MAUI que usava `MessagingCenter`.

## Deep Dive

### O que MVVM é, e o que não é

A View cuida de layout e gestos; o ViewModel cuida do estado (`FirstName`, `IsRunning`, `Items`) e das ações (`SaveCommand`); o Model cuida dos dados e das regras de negócio. O ViewModel nunca cita um controle, uma janela ou um tipo de diálogo, e é isso que o torna testável. O que MVVM não é: code-behind que lê `NameTextBox.Text` e escreve em `ResultLabel.Text` (a View fazendo o trabalho do ViewModel, e nenhum teste alcança isso), uma classe chamada `...ViewModel` que ainda chama `MessageBox.Show`, ou um padrão necessário para uma tela com um botão. Segundo a documentação do MAUI, o Model desconhece o ViewModel e o ViewModel desconhece a View, e em exemplos pequenos muitas vezes nem há Model (docs only: os bindings moram no XAML).

### À mão: INotifyPropertyChanged e INotifyDataErrorInfo

Esta é a classe base que todo livro antigo escreve, mais um ViewModel com validação, reduzidos ao que compila (`HandWrittenPerson`, cerca de 35 linhas no lab):

```csharp
public abstract class ViewModelBase : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    protected bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value)) return false;
        field = value;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
        return true;
    }
}
```

O `INotifyDataErrorInfo` à mão acrescenta `HasErrors`, `GetErrors(name)`, `ErrorsChanged` e um dicionário de mensagens que você mantém sincronizado. Atribuir `First` com `"a"`, `"a"` de novo e depois `"Ada"` disparou `PropertyChanged` 4 vezes (`First` e o calculado `Full`, duas vezes) e `ErrorsChanged` 2 vezes, e `HasErrors` terminou falso. A guarda de igualdade é o motivo de o segundo `"a"` não disparar nada. A mecânica de delegates e eventos por baixo está em [Delegates and Multicast Invocation](/csharp-concepts/delegates-and-multicast-invocation) e [Events, the Observer Pattern and Memory Leaks](/csharp-concepts/events-observer-pattern-and-memory-leaks): uma View que assina `PropertyChanged` é o vazamento do publicador de vida longa descrito lá, que os bindings resolvem por você.

### ObservableObject, ObservableValidator e [ObservableProperty]

`ObservableObject` é essa classe base (também traz `PropertyChanging`, `SetProperty`, `SetPropertyAndNotifyOnCompletion`); `ObservableValidator` acrescenta `INotifyDataErrorInfo` em cima de `System.ComponentModel.DataAnnotations`. `[ObservableProperty]` escreve a propriedade. A página do Toolkit no Learn é de 2024-11-07 e mostra só campos (`[ObservableProperty] private string name;`). A versão 8.4.0 (publicada em 2024-12-12, nas notas: "Add support for partial properties for [ObservableProperty]") mudou a recomendação, e o repositório hoje traz um diagnóstico Info, o MVVMTK0042, que diz que um campo "can be converted to a partial property instead, which is recommended". Uma partial property exige C# 14 (a palavra-chave `field`), que é o padrão no `net10.0`. Este é o ViewModel medido abaixo:

```csharp
public partial class PersonViewModel : ObservableValidator
{
    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(FullName))]
    [NotifyCanExecuteChangedFor(nameof(SaveCommand))]
    [NotifyDataErrorInfo]
    [Required, MinLength(2)]
    public partial string FirstName { get; set; }

    partial void OnFirstNameChanging(string value) => Log.Add($"Changing({value})");
    partial void OnFirstNameChanged(string oldValue, string newValue) => Log.Add($"Changed({oldValue} -> {newValue})");

    bool CanSave() => !HasErrors && FirstName.Length > 0;
    [RelayCommand(CanExecute = nameof(CanSave))] void Save() => Saves++;
}
```

Com `EmitCompilerGeneratedFiles` o compilador grava o que o gerador produziu. O setter de `FirstName` (atributos e comentários de documentação removidos):

```csharp
public partial string FirstName
{
    get => field;
    [RequiresUnreferencedCode("The type of the current instance cannot be statically discovered.")]
    set
    {
        if (!EqualityComparer<string>.Default.Equals(field, value))
        {
            string __oldValue = field;
            OnFirstNameChanging(value);
            OnFirstNameChanging(__oldValue, value);
            OnPropertyChanging(__KnownINotifyPropertyChangingArgs.FirstName);
            OnPropertyChanging(__KnownINotifyPropertyChangingArgs.FullName);
            field = value;
            ValidateProperty(value, "FirstName");
            OnFirstNameChanged(value);
            OnFirstNameChanged(__oldValue, value);
            OnPropertyChanged(__KnownINotifyPropertyChangedArgs.FirstName);
            OnPropertyChanged(__KnownINotifyPropertyChangedArgs.FullName);
            SaveCommand.NotifyCanExecuteChanged();
        }
    }
}
```

Lendo: a mesma guarda de igualdade da versão à mão; quatro hooks parciais opcionais (`OnXChanging`/`OnXChanged`, cada um com uma sobrecarga de um argumento e outra com valor antigo e novo; chamadas a parciais não implementadas são removidas pelo compilador); um `PropertyChangedEventArgs` em cache por nome (sem alocação a cada notificação); uma notificação extra por `[NotifyPropertyChangedFor]`; a validação entre a atribuição e o hook `Changed`; e `SaveCommand.NotifyCanExecuteChanged()` por causa do `[NotifyCanExecuteChangedFor]`. O setter leva `[RequiresUnreferencedCode]` porque `[NotifyDataErrorInfo]` valida por reflexão de `DataAnnotations`, então não é seguro para trimming (a outra propriedade, `LastName`, não tem esse atributo). O gerador também escreve `CreateAllPropertiesValidator` para o `ValidateAllProperties()`, que assim acha as propriedades sem reflexão sobre os membros. Os arquivos gerados trazem `GeneratedCode("...", "8.4.0.0")` embora o pacote seja 8.4.2: é a versão do assembly do gerador, não a do pacote. O lado Roslyn de como um gerador assim é escrito está em [Writing a Roslyn Analyzer and an Incremental Source Generator](/csharp-concepts/writing-a-roslyn-analyzer-and-an-incremental-source-generator), e os geradores da plataforma em [Source Generators and AOT-Friendly Code](/dotnet-concepts/source-generators-and-aot-friendly-code).

A ordem dos eventos, medida assinando tudo e atribuindo propriedades (`net10.0` e `net11.0` imprimiram texto idêntico):

```text
start: HasErrors=True CanExecute=False                 <- o construtor atribuiu "" e o [Required] falhou
FirstName = "a":
  Changing(a) / PropertyChanging(FirstName) / PropertyChanging(FullName)
  ErrorsChanged(FirstName)
  Changed( -> a) / PropertyChanged(FirstName) / PropertyChanged(FullName)
  CanExecuteChanged(CanExecute=False)
  errors=[The field FirstName must be a string or array type with a minimum length of '2'.]
FirstName = "a" again:   (nothing)
FirstName = "Ada":
  Changing(Ada) / PropertyChanging x2 / PropertyChanged(HasErrors) / ErrorsChanged(FirstName)
  Changed(a -> Ada) / PropertyChanged(FirstName) / PropertyChanged(FullName) / CanExecuteChanged(CanExecute=True)
```

Três surpresas que valem guardar: atribuir um valor no construtor já valida (então `HasErrors` é verdadeiro antes de qualquer entrada do usuário, e o formulário pode mostrar erro na primeira renderização); `ErrorsChanged` dispara antes de `OnFirstNameChanged` e antes do `PropertyChanged` da própria propriedade; `HasErrors` só dispara o próprio `PropertyChanged` quando o valor vira. A forma com campo, para contraste, gera `get => _title;` com `[MemberNotNull("_title")]` no setter e `OnTitleChanged(string? oldValue, string newValue)`: o mesmo comportamento, mas a propriedade não existe para outros geradores e analisadores até o gerador rodar, que é o motivo declarado da recomendação por partial properties (o MVVMTK0045 vai além para WinUI 3 e UWP: um campo "will generate code that is not AOT compatible in WinRT scenarios", só docs e repositório, não rodei aqui).

Dois problemas de build medidos. Com `<LangVersion>13</LangVersion>` o mesmo projeto falhou com `CS9248: Partial property 'PersonViewModel.FirstName' must have an implementation part`: o gerador não emitiu nada, e não vi na saída da CLI a mensagem MVVMTK0041 que o repositório documenta. E `CompilerGeneratedFilesOutputPath` apontando para uma pasta dentro do projeto (`generated`) fez o build seguinte falhar com dezenas de duplicatas `CS0102`, `CS0111` e `CS0579`, porque o glob padrão compilou os arquivos emitidos de novo; `obj/generated` é seguro.

### RelayCommand: ICommand sem a classe

`ICommand` é `Execute`, `CanExecute` e `CanExecuteChanged`. `[RelayCommand]` num método gera uma propriedade `IRelayCommand` criada sob demanda, com o nome do método (`Save` vira `SaveCommand`, `LoadAsync` vira `LoadCommand`):

```csharp
public IRelayCommand SaveCommand => saveCommand ??= new RelayCommand(new Action(Save), CanSave);
```

`CanExecute = nameof(CanSave)` liga a guarda, e `[NotifyCanExecuteChangedFor]` (acima) é o que dispara de novo o `CanExecuteChanged`. No log de eventos acima o `CanExecuteChanged` disparou depois que `FirstName` mudou e o comando passou a informar `CanExecute=False`, depois `True`. O contrato de `ICommand` é que a UI consulta `CanExecute` de novo quando o evento é disparado (docs only: aqui não há UI).

### AsyncRelayCommand: IsRunning, cancelamento e a exceção que derruba o app

Para `async Task LoadAsync(CancellationToken ct)` o gerador cria um `AsyncRelayCommand` e repassa o token (`IncludeCancelCommand = true` acrescenta um `...CancelCommand`). Medido com um comando que espera 200 ms:

```text
before: IsRunning=False ExecutionTask=null
right after Execute: IsRunning=True CanExecute=False task=WaitingForActivation
after: IsRunning=False CanExecute=True task=RanToCompletion Calls=1
  at start and at end: PropertyChanged(ExecutionTask, IsRunning, CanBeCanceled ...), then CanExecuteChanged(False) and later (True)
```

`IsRunning` é `ExecutionTask is { IsCompleted: false }`, então um spinner se liga a ele. Por padrão `CanExecute` é falso enquanto roda (`AsyncRelayCommandOptions.AllowConcurrentExecutions` desligado; com `[RelayCommand(AllowConcurrentExecutions = true)]` continuou verdadeiro durante a execução). Agora a parte que a documentação enterra e o código-fonte confirma: `Execute` não chama `CanExecute`; quem chama é o botão. Chamar `Execute(null)` duas vezes durante a execução rodou o delegate duas vezes (`Calls=2`), e como o delegate recebe um `CancellationToken`, a segunda chamada cancelou a primeira (`first task is Canceled`).

O que acontece com uma exceção depende de `AsyncRelayCommandOptions.FlowExceptionsToTaskScheduler`. O `Execute` termina em `static async void AwaitAndThrowIfFailed(Task)`, então por padrão a exceção é relançada no `SynchronizationContext` do chamador. Registrei o que um contexto parecido com o de UI recebe, e o que um console (sem contexto) faz:

```text
default, delegate throws InvalidOperationException("boom"):   ExecutionTask Faulted; posted to the context: InvalidOperationException: boom
default, no SynchronizationContext (console):                  UnhandledException(terminating=True): boom, process exit code 134
default, Load2CancelCommand cancels the token:                 ExecutionTask Canceled; posted: TaskCanceledException: A task was canceled.
default, second Execute cancels the first:                     posted: TaskCanceledException
FlowExceptionsToTaskScheduler = true, throws:                  ExecutionTask Faulted ("boom2"); posted: nothing
  ...never awaited, no context: UnobservedTaskException raised once, after GC, process alive
await command.ExecuteAsync(null) with the flag:                the caller gets InvalidOperationException (nothing posted)
```

Num app WPF ou WinUI uma exceção postada é o caminho da exceção não tratada do dispatcher, ou seja, derruba o app, a menos que ele a trate (docs only: não há UI aqui). A página do Learn diz isso ("exceptions being thrown would just crash the app") e o exemplo de cancelamento dela envolve o trabalho em `catch (OperationCanceledException)`. Portanto cancelar um comando assíncrono cancelável sem esse `catch` derruba o app por padrão, como medido. As duas formas seguras: capturar `OperationCanceledException` e as suas exceções dentro do método, ou ligar a flag e ler `ExecutionTask` (também é como se liga uma mensagem de erro), aceitando que as exceções alheias ficam silenciosas se você não registrar `UnobservedTaskException`.

### Messenger: fraco contra forte

`IMessenger` desacopla ViewModels: um receptor se registra para um tipo de mensagem (`Register<Ping>(this)` com `IRecipient<Ping>`, ou uma lambda) e qualquer código chama `Send(new Ping(1))`. Há duas implementações. `WeakReferenceMessenger` guarda os receptores com referência fraca e é o padrão do `ObservableRecipient`; `StrongReferenceMessenger` guarda com referência forte e exige `Unregister` explícito. O experimento: registrar um receptor, soltar toda referência, forçar o GC, enviar de novo (Release, um método `NoInlining` cria o receptor para o JIT não o manter vivo):

```text
WeakReferenceMessenger     IRecipient<Ping>        after GC, no reference: received 0, recipient collected
WeakReferenceMessenger     lambda with and without this   received 0, collected
StrongReferenceMessenger   IRecipient<Ping>        received 1, recipientAlive=True   (all three variants)
StrongReferenceMessenger   after Unregister<Ping>(r): received 1 of 2 sends
```

O fraco para de entregar em silêncio quando o receptor vira lixo, o que é uma vantagem para uma tela já fechada e um bug para um receptor que você esqueceu de manter (nada lança exceção). O forte nunca solta o receptor: é o mesmo vazamento da assinatura de evento da [lição de eventos](/csharp-concepts/events-observer-pattern-and-memory-leaks), com o messenger no papel de publicador de vida longa. Até uma lambda que captura `this` foi coletada pelo messenger fraco (a documentação aconselha `(r, m) => ...` para evitar a captura, por desempenho; medi apenas que ela não manteve o receptor vivo). O custo, com `1000` receptores e `1000` envios (1.000.000 de entregas), Release, três execuções de cada:

```text
                          net10.0 (10.0.0)              net11.0 (11.0.0)
Weak   per delivery       32 to 38 ns                   27 to 29 ns
Strong per delivery       24 to 27 ns                   18 to 20 ns
register 1000 recipients  0.11 to 0.9 ms (first run slowest, both)
200,000 short-lived recipients registered then dropped, heap after GC:
  Weak   -245 KB (nothing kept)     Strong +96,441 KB, about 480 bytes each   (net11.0: -122 KB and +56,805 KB)
```

O fraco ficou cerca de 1,3 a 1,4 vez mais lento por entrega nestas execuções e não retém nada; o forte é mais rápido e retém tudo até você cancelar o registro. Os dois runtimes diferem só em velocidade (o código do messenger é o mesmo pacote), então leia os números como os desta máquina. Como o GC decide que um receptor morreu está em [The Garbage Collector: Generations and the LOH](/csharp-concepts/garbage-collector-generations-and-the-loh). Outras regras medidas: registrar o mesmo receptor duas vezes para a mesma mensagem lança `InvalidOperationException: The target recipient has already subscribed to the target message.`; e o `ObservableRecipient` registra seus handlers `IRecipient<T>` quando `IsActive = true` e os remove com `false` (o código gerado de `RegisterAll` é só `messenger.Register<Ping>(recipient)`).

Mensagens de requisição transformam um envio numa pergunta: `class WhoAmI : RequestMessage<string> { }`, um receptor chama `q.Reply("ada")`, e `string who = messenger.Send<WhoAmI>()` devolveu `'ada'`. Sem receptor, a conversão implícita lançou `InvalidOperationException: No response was received for the given request message.` (guarde a mensagem devolvida numa variável para permitir a ausência de resposta). `AsyncRequestMessage<T>` e as variantes de coleção existem (docs only).

### Ioc.Default: um service locator com nome simpático

`Ioc.Default` envolve um único `IServiceProvider` global. Medido: antes da configuração, `GetRequiredService` lança `InvalidOperationException: The service provider has not been configured yet.`; um segundo `ConfigureServices` lança `The default service provider has already been configured.` (ele é configurado uma vez por processo, o que molda os testes). A armadilha é usá-lo dentro de um ViewModel:

```csharp
sealed class ReportViewModel(IClock clock) { }                       // dependency visible, new ReportViewModel(fake) works
sealed class LocatorViewModel { readonly IClock _clock = Ioc.Default.GetRequiredService<IClock>(); }  // hidden, needs global setup
```

Os dois imprimiram `clock=SystemClock` depois de configurado, mas só o primeiro pode ser construído num teste com um fake e sem estado estático. Isso é o padrão service locator: a lista de dependências deixa de estar no construtor. Use `Ioc.Default` na raiz de composição (resolver o primeiro ViewModel da janela) e injeção por construtor daí para baixo; tempos de vida e registro estão em [Dependency Injection and Service Lifetimes](/dotnet-concepts/dependency-injection-and-service-lifetimes). O MAUI e os outros hosts têm integração própria de DI (docs only).

### Testando um ViewModel sem UI

Este é o ganho central. Cinco testes MSTest 4.5.3 (projeto `MSTest.Sdk/4.5.3`, rodados com `dotnet test --project`) passaram no `net10.0` e no `net11.0`, duração total de cerca de 0,4 s, sem janela e sem dispatcher:

```csharp
[TestMethod]
public async Task Load_sets_IsRunning_then_Message_without_any_UI()
{
    var greeter = new ManualGreeter();                 // IGreeter fake that returns a TaskCompletionSource task
    var vm = new GreetingViewModel(greeter);
    Assert.IsFalse(vm.LoadCommand.CanExecute(null));   // Name is empty
    vm.Name = "Ada";
    Task run = vm.LoadCommand.ExecuteAsync(null);      // ExecuteAsync, not Execute: the test awaits it
    Assert.IsTrue(vm.LoadCommand.IsRunning);
    greeter.Pending.SetResult("Hello, Ada");
    await run;
    Assert.IsFalse(vm.LoadCommand.IsRunning);
    Assert.AreEqual("Hello, Ada", vm.Message);
}
```

Os outros: um handler de `PropertyChanged` coleta nomes e afirma que `FirstName` e `FullName` dispararam uma vez, e nada para o mesmo valor; `SaveCommand.CanExecuteChanged` disparou duas vezes entre a entrada inválida e a válida; um greeter que falha aparece em `ExecuteAsync` como `InvalidOperationException` (opções padrão, com await, então dá para capturar, ao contrário de `Execute`); e um `ObservableRecipient` montado sobre `new WeakReferenceMessenger()` (nunca `.Default`) recebe enquanto `IsActive` e para depois. Use `ExecuteAsync` nos testes: `Execute` retorna antes de o trabalho terminar e relança no thread pool. Um fake com `TaskCompletionSource` torna observável o estado intermediário (`IsRunning=true`) sem atraso. O `dotnet test --project` exige `{"test":{"runner":"Microsoft.Testing.Platform"}}` no `global.json`, lido a partir do diretório atual: sem isso o SDK 10.0.100 repassou a flag ao MSBuild (`MSB1001: Unknown switch`). O lado do framework está em [MSTest Fundamentals](/dotnet-testing-concepts/mstest-fundamentals-lifecycle-and-testcontext) e [Test Doubles](/dotnet-testing-concepts/test-doubles-fakes-stubs-and-nsubstitute).

### Blazor e MVU, para contraste

O Blazor não precisa de `INotifyPropertyChanged`: `@bind` liga um input a um membro do componente e um manipulador de evento renderiza o componente de novo; quando o estado muda fora de um evento (um timer, um callback de serviço), você chama `StateHasChanged` por conta própria (veja [Blazor Component Lifecycle and Parameters](/dotnet-concepts/blazor-component-lifecycle-and-parameters) e [Blazor Forms](/dotnet-concepts/blazor-forms-editform-and-validation)). O componente é View e ViewModel ao mesmo tempo, então o caminho de teste é o bUnit, não uma classe comum. O Model-View-Update (MVU) vai além: um estado imutável, mensagens que descrevem o que aconteceu, uma função pura `update(state, message)` que devolve o próximo estado e uma View que é função dele, sem nenhuma notificação de mudança. Descrevo apenas a ideia; nenhuma biblioteca MVU de .NET foi executada nesta lição. Para escolher o framework de UI, veja [Choosing a .NET Client UI Framework](/dotnet-client-apps-concepts/choosing-a-dotnet-client-ui-framework).

### Docs only (exige um toolkit de UI)

`{Binding}` e `x:Bind` em XAML, `DataContext` e `BindingContext`, modos de uma e duas vias, conversores, bindings compilados com `x:DataType` no MAUI (a página de compiled bindings; a página de data binding os usa nos exemplos) e o `Binding` do WPF não foram executados aqui. A página de MVVM do MAUI (de 2024-08-30) afirma que o MAUI leva as atualizações de binding para a thread de UI, então uma propriedade do ViewModel pode ser atribuída de qualquer thread; não testei. `MessagingCenter` do MAUI: a página "what's new" do .NET 10 diz que ele "has been made internal" e a página do `MessagingCenter` diz que ele está "deprecated in .NET 10"; as duas apontam para o `WeakReferenceMessenger`. As páginas divergem na palavra, o conselho é o mesmo.

### Book vs today

Livros e posts antigos escrevem `ViewModelBase`, `RelayCommand`/`DelegateCommand` e um messenger à mão, ou usam MVVM Light (`ViewModelBase`, `Messenger.Default`, `SimpleIoc`). O próprio README do MVVM Light diz "MVVM Light is not maintained anymore" e recomenda o MVVM Toolkit da Microsoft; a última versão dele no NuGet é a 5.4.1.1 (2018-09-11), marcada como obsoleta "Legacy" com `CommunityToolkit.Mvvm` como alternativa. Hoje o padrão é o `CommunityToolkit.Mvvm` com `[ObservableProperty]` em partial properties e `[RelayCommand]`. Alternativas, pelas fontes delas: o Prism (9.0.537 em 2024-08-20) é um framework mais completo, com navegação e módulos, e desde a 9.0 tem licença dupla: uma Community License gratuita e uma Commercial License exigida de organizações maiores (README dele); o ReactiveUI (27.0.1 em 2026-11-16, MIT) constrói o MVVM sobre observables (Rx), um estilo diferente, não medido aqui. Não comparei desempenho nem ergonomia entre eles.

## Trade-offs

- **Código gerado é invisível até você olhar.** Uma combinação ruim de atributos dá um diagnóstico, não um stack trace. Emita os arquivos uma vez (`EmitCompilerGeneratedFiles`, saída sob `obj/`) e leia.
- **Partial properties elevam o piso da linguagem.** Exigem C# 14; um projeto net8 ou net9 precisa de `<LangVersion>14.0</LangVersion>` com o SDK 10, ou fica com campos. Medido: LangVersion 13 falha com CS9248.
- **`[NotifyDataErrorInfo]` é validação por reflexão.** Serve para formulários, não é seguro para trimming (`RequiresUnreferencedCode`) e valida já na atribuição do construtor, então o estado inicial pode nascer inválido.
- **O comando assíncrono padrão derruba o app ao cancelar.** Capture `OperationCanceledException` no método, ou:
  ```csharp
  [RelayCommand(FlowExceptionsToTaskScheduler = true)] async Task SaveAsync(CancellationToken ct) { ... }
  ```
  e depois registre `TaskScheduler.UnobservedTaskException`, porque os erros passam a ser silenciosos.
- **Messenger fraco falha em silêncio, o forte vaza com barulho.** Fraco: um receptor que ninguém referencia para de receber sem erro. Forte: 480 bytes por receptor esquecido na execução acima, para sempre. Use o fraco por padrão e cancele o registro em `OnDeactivated` de qualquer forma.
- **`Ioc.Default` é estado global.** Uma configuração por processo, sem contêiner por teste. Deixe-o na raiz de composição.
- **MVVM tem cerimônia.** Para uma ferramenta de uma tela, o code-behind é mais simples; o custo se paga quando a lógica precisa de testes ou a tela tem vários estados.

## Documentation Links

- [MVVM Toolkit introduction, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/) (doc)
- [ObservableProperty attribute, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/generators/observableproperty) (doc)
- [RelayCommand attribute, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/generators/relaycommand) (doc)
- [AsyncRelayCommand, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/asyncrelaycommand) (doc)
- [Messenger, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/messenger) (doc)
- [Inversion of control (Ioc.Default), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/ioc) (doc)
- [ObservableValidator, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/communitytoolkit/mvvm/observablevalidator) (doc)
- [CommunityToolkit/dotnet repository, GitHub](https://github.com/CommunityToolkit/dotnet) (doc)
- [CommunityToolkit 8.4.0 release notes, GitHub](https://github.com/CommunityToolkit/dotnet/releases/tag/v8.4.0) (doc)
- [Data binding and MVVM in .NET MAUI, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/xaml/fundamentals/mvvm) (doc)
- [What's new in .NET MAUI for .NET 10, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/whats-new/dotnet-10) (doc)
- [Publish and subscribe to messages (MessagingCenter), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/fundamentals/messagingcenter) (doc)
- [Compiled bindings in .NET MAUI, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/maui/fundamentals/data-binding/compiled-bindings) (doc)
- [INotifyPropertyChanged interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.inotifypropertychanged) (doc)
- [INotifyDataErrorInfo interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.componentmodel.inotifydataerrorinfo) (doc)
- [ICommand interface, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.windows.input.icommand) (doc)
- [MVVM Light (not maintained), GitHub](https://github.com/lbugnion/mvvmlight) (doc)
- [Prism library, GitHub](https://github.com/PrismLibrary/Prism) (doc)
