---
version: 1.0
updatedAt: 2026-11-12
title: "Runtime async no .NET 11"
summary: O que muda quando o runtime, e não o compilador, suspende os métodos async: como ligar (ainda documentado como preview para o seu código), o que a BCL já faz, profundidade da stack ao vivo, alocação e tempo medidos em Release, e o que continua igual para ConfigureAwait, ValueTask, AsyncLocal e traces de exceção.
---
## Objective

Desde o C# 5, um método `async` é reescrito pelo compilador em uma máquina de estados: campos para as
variáveis locais, um método `MoveNext`, um builder que é dono da `Task` devolvida. Para o runtime isso é
uma classe comum com um método comum, e ele não sabe o que é "suspensão". O .NET 11 acrescenta um segundo
caminho: com runtime async o compilador marca o método como async e o próprio runtime captura e retoma
os frames. A lição sobre os internos de `Task` e `async`/`await` já tem uma seção curta sobre isso. Esta
aprofunda: o que exatamente liga, o que você ganha e o que não ganha, e o que verificar antes de ligar
no seu projeto.

O enquadramento honesto vem primeiro. O runtime async está **ligado nas bibliotecas do runtime, mas
ainda documentado como recurso em preview para o seu código**. Tudo aqui foi executado no SDK 11.0.100
e no runtime 11.0.0 (macOS arm64, builds Release, salvo quando indicado). Onde só tenho a documentação,
eu digo.

## Use Cases

- Decidir se vale ligar a flag em uma aplicação que já está migrando para `net11.0`.
- Ler um profiler, a call stack do depurador ou um log de `new StackTrace()` e se perguntar para onde
  foram os frames `MoveNext` e `AsyncMethodBuilderCore`.
- Explicar por que um serviço que só mudou o target framework passou a alocar menos nas chamadas que
  suspendem, sem mudar código.
- Revisar uma afirmação como "runtime async deixa o async 10 vezes mais rápido" contra o que dá para medir.

## Deep Dive

### O que já vem ligado e o que você liga

São duas coisas separadas. Primeiro, as bibliotecas do runtime do .NET 11 são compiladas com o recurso,
então os métodos async da base class library não têm mais máquinas de estado do compilador. Contei os
métodos com `[AsyncStateMachine]` nos assemblies distribuídos: 3 em `System.Private.CoreLib`, 2 em
`System.Net.Http` e 0 em `System.IO.Compression`, contra 69, 119 e 51 no .NET 10. Isso você recebe sem
fazer nada, assim que o app roda no runtime 11.

Segundo, o seu próprio código opta com uma propriedade, e em `net11.0` não precisa de
`EnablePreviewFeatures`:

```xml
<PropertyGroup>
  <Features>runtime-async=on</Features>
</PropertyGroup>
```

As [notas do runtime do .NET 11](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/runtime)
dizem "Runtime Async is a preview feature", então leia o opt-in como uma decisão de risco, não como um
interruptor que a Microsoft declarou pronto para produção. Segundo a mesma página, as variáveis de
ambiente antigas `DOTNET_RuntimeAsync` e `UNSUPPORTED_RuntimeAsync` foram removidas, e o jeito de sair por
projeto é `<UseRuntimeAsync>false</UseRuntimeAsync>`. Não testei essa saída; ela vem da documentação.
Testei que, com a flag ligada, o método deixa de ter `AsyncStateMachineAttribute`, uma checagem simples
de que o compilador realmente tomou o outro caminho.

### A stack ao vivo fica mais curta

Escrevi um método async recursivo que espera `Task.CompletedTask` e depois chama a si mesmo, e no fundo
devolve `new StackTrace().FrameCount`. Frames nas profundidades 0, 3 e 10:

```text
                 prof. 0   prof. 3   prof. 10   por nível
clássico           9         21        49          4
runtime async      3          6        13          1
```

O build clássico soma quatro frames por nível: o método mais a infraestrutura de máquina de estados e de
builder em volta dele. Com runtime async cada chamada é um frame, a cadeia real de chamadas. O exemplo da
documentação mostra o mesmo efeito: 13 frames viraram 5. Essa é a stack "ao vivo", a que um profiler ou
um depurador vê enquanto o código roda, ou o que um log com `new StackTrace()` imprime.

O `StackTrace` de uma exceção não mudou. Para um método que cede o controle e depois lança três níveis
abaixo, os dois builds imprimiram as mesmas cinco linhas (quatro chamadas do método mais o `Main`). A
documentação explica o motivo: a limpeza que já existia nos stack traces de exceção no código gerado pelo
compilador já escondia os frames da máquina de estados. Então o texto de exceção que seus logs e o Sentry
capturavam antes não encurta ao ligar a flag.

### Alocação e tempo, medidos e não supostos

A versão de marketing diz "menor overhead". Medi dois formatos de chamada, ambos em Release. O primeiro
espera um método que sempre suspende uma vez (`await Task.Yield()`), 200.000 vezes em um laço, e divide
`GC.GetTotalAllocatedBytes` pelo número de chamadas:

```text
                          clássico     runtime async
devolve Task<int>          96 B/chamada  56 B/chamada
devolve ValueTask<int>    104 B/chamada  56 B/chamada
tempo, 200 mil de Task    148-178 ms     59-63 ms
```

Suspender custa menos memória nos dois formatos, e a versão com `Task` levou cerca de 2,5 vezes menos
tempo em várias execuções. O tempo do `ValueTask` foi ruidoso demais para afirmar algo (58 a 106 ms contra
76 a 102 ms), e 56 bytes ainda é uma alocação: runtime async não torna a suspensão gratuita.

O segundo formato é o que se usa para vender `ValueTask`: 2 milhões de awaits de um método cujo resultado
já está disponível (`await Task.CompletedTask` dentro). Os dois builds não alocaram nada. Depois do
aquecimento, o clássico rodou em cerca de 8 ms e o runtime async em cerca de 12 ms (as primeiras
execuções do clássico levaram 75 ms antes da compilação em camadas otimizá-las). Então, no caminho
síncrono, não medi ganho e medi uma pequena perda. Uma medição anterior minha, em uma release candidate
e em build Debug, tinha mostrado 94 MB contra 215 KB neste laço. Isso não descreve o Release, onde o
caminho rápido do clássico não alocou nada, e é por isso que esta lição usa só números de Release. São
micromedições em uma máquina: mostram a direção, não o ganho do seu serviço. A documentação lista os
mecanismos por trás da melhoria (continuações em cache, compilação em camadas para async, o JIT
reduzindo `Task.CompletedTask`) e diz que continuações sem nada a restaurar pulam a captura do
`ExecutionContext`, o que não medi.

### O que não muda para o código que você escreve

O contrato é o mesmo, e o lab verifica as peças:

- **Resultados e ordem.** Os dois builds devolveram as mesmas somas, e o `await` continua retomando depois
  que o trabalho esperado termina.
- **`ConfigureAwait`.** Com um `SynchronizationContext` contador instalado, um `await Task.Delay(5)` postou
  uma continuação nele e `ConfigureAwait(false)` postou zero, nos dois modos. As regras para bibliotecas
  e para código de aplicação não mudam.
- **`AsyncLocal<T>`.** Um valor definido dentro de um método async era visível depois de um `await` nesse
  método e não vazava para quem chamou, nos dois modos.
- **`ValueTask`.** As regras de uso (aguardar uma vez, não usar de forma concorrente) fazem parte do tipo,
  não da implementação. Runtime async não torna legal o await duplo.
- **O tipo devolvido.** O método continua devolvendo `Task<T>`; imprimi o `GetType()` da task devolvida nos
  dois modos e obtive `Task<int>`, então nada nas suas assinaturas muda.

### Depurador e diagnóstico

Esta parte vem da documentação, não de uma sessão de depurador. Ela diz que os breakpoints funcionam dentro
dos métodos runtime-async e que o passo a passo atravessa o `await` sem entrar em infraestrutura gerada, e
que o async profiler agora reporta eventos tanto de métodos runtime-async quanto de métodos de máquina de
estados do compilador, então as ferramentas veem um modelo único. Diz também que Native AOT e ReadyToRun são
suportados.

O que eu verificaria antes de ligar em um projeto real é qualquer coisa que leia a máquina de estados: uma
ferramenta ou script interno que percorra frames `MoveNext` ou campos de máquina de estados em um dump, ou
um teste que procure `AsyncStateMachineAttribute` por reflexão. Com a flag ligada o atributo some, como o lab
mostra. Não testei `dotnet-dump` nem os comandos de async stack contra um dump de um processo runtime-async,
então trate isso como pendência para as suas próprias ferramentas.

### O lab

O lab compila um único `Workload.cs` em dois projetos que diferem em uma linha, e os testes carregam os dois
por extern aliases. Eles verificam propriedades com margem: o clássico soma pelo menos o dobro de frames por
nível em relação ao runtime async, o runtime async soma cerca de um, a alocação por chamada que suspende fica
entre 1 e 1.024 bytes nos dois e é menor com runtime async, `ConfigureAwait` posta 1 ou 0 continuações, e os
traces de exceção têm o mesmo número de linhas. Nenhum teste afirma um número exato de bytes ou um tempo,
porque ambos mudam com a máquina e com a configuração do build.

## Trade-offs

- **Preview para o seu código.** As bibliotecas usam; o seu opt-in é o preview documentado. Ligue em um
  serviço com bons testes e caminho de volta, não em uma biblioteca que você distribui para terceiros.
- **Stack ao vivo e stack de exceção diferem.** Profilers e depuradores ganham stacks mais curtas, mas os
  traces de exceção não mudaram, então não prometa logs de erro mais curtos.
- **O ganho depende do formato da chamada.** As chamadas que suspendem alocaram cerca de 40 a 50 por cento
  menos aqui. O caminho síncrono não tinha alocação para remover e foi um pouco mais lento no meu laço.
- **Ferramentas que leem máquinas de estados podem quebrar.** Tudo que depende de `MoveNext`, builders ou
  `AsyncStateMachineAttribute` precisa ser checado com a flag ligada.
- **Não é motivo para mudar código.** Não troque `Task` por `ValueTask` nem remova `ConfigureAwait` por causa
  deste recurso; as regras da lição de internos continuam decidindo isso.

## Documentation Links

- [What's new in the .NET 11 runtime, Runtime Async, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/runtime) (doc)
- [Runtime-native async, dotnet/runtime issue 109632](https://github.com/dotnet/runtime/issues/109632) (doc)
- [Asynchronous programming with async and await, C#, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/) (doc)
- [ConfigureAwait FAQ, .NET Blog](https://devblogs.microsoft.com/dotnet/configureawait-faq/) (doc)
- [ValueTask<TResult> struct, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.threading.tasks.valuetask-1) (doc)
