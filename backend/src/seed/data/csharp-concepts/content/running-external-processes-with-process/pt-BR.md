---
version: 1.0
updatedAt: 2026-11-12
title: "Executando processos externos com Process"
summary: Process e ProcessStartInfo com ArgumentList, o deadlock ao ler stdout e stderr e como evitá-lo, timeout com Kill(entireProcessTree), código de saída e sinais, e os atalhos do .NET 11 (Run, RunAndCaptureText, ReadAllLines, ProcessExitStatus) com o comportamento do timeout verificado.
---
## Objective

Chamar `git`, `ffmpeg`, `docker` ou um script a partir de C# parece uma linha,
`Process.Start`, e dá errado de quatro jeitos previsíveis: argumentos que uma
concatenação de string estragou ou deixou um atacante reescrever, um filho que
trava para sempre porque ninguém leu o stderr dele, um timeout que derruba o
programa mas deixa os filhos rodando, e um código de saída que ninguém
interpretou. Este concept cobre `Process` e `ProcessStartInfo` como você usa no
.NET 8 e no 10 (o padrão que funciona em todo lugar), o deadlock e a correção,
timeout com `Kill(entireProcessTree: true)`, códigos de saída e sinais, e os
atalhos que o .NET 11 acrescenta (`Process.Run`, `RunAndCaptureText`,
`ReadAllLines`, `ProcessExitStatus`), incluindo um comportamento do timeout deles
que me surpreendeu. Os códigos de saída do seu próprio programa estão no concept
de aplicativos de console.

## Use Cases

- Rodar `git`, `ffmpeg` ou um linter a partir de uma ferramenta de build ou de um worker e devolver o que ele imprimiu.
- Chamar um programa de linha de comando legado cujos parâmetros vêm de entrada do usuário.
- Rodar um script com prazo num passo de CI e limpar tudo o que ele iniciou.
- Distinguir "a ferramenta falhou" de "a ferramenta foi morta" numa política de retry.

## Deep Dive

### Inicie sem shell, um argumento por item

Todos os números e mensagens abaixo foram executados no .NET 11.0.0 (SDK
11.0.100), macOS, com `sh` como filho.

```csharp
var psi = new ProcessStartInfo("printf") { RedirectStandardOutput = true };
psi.ArgumentList.Add("[%s]\n");
psi.ArgumentList.Add("hello world");
psi.ArgumentList.Add("a \"quoted\" $HOME");
using var p = Process.Start(psi)!;
Console.WriteLine(p.StandardOutput.ReadToEnd());
// [hello world]
// [a "quoted" $HOME]
```

`ArgumentList` entrega cada item ao filho como um argumento. A mesma chamada com
a propriedade de string, `Arguments = "[%s]\\n hello world"`, imprimiu `[hello]`
e `[world]`: a string é dividida nos espaços, e quem cuida de aspas e escapes é
você. `UseShellExecute` é `false` por padrão no .NET, então nenhum shell entra no
caminho e `$HOME` ou `; rm -rf` continuam sendo caracteres comuns. Nunca monte
uma string de argumentos a partir de entrada do usuário. Definir as duas
propriedades falha no start com
`InvalidOperationException: Only one of Arguments or ArgumentList may be used.`

Um programa que não existe lança exceção no `Start`, não depois:
`Win32Exception: An error occurred trying to start process 'definitely-not-a-program' with working directory '...'. No such file or directory`.
Capture isso onde você inicia o processo, é o caso "ferramenta não instalada".
`WorkingDirectory` e `psi.Environment["FOO"] = "bar"` definem a pasta e as
variáveis do filho (o filho imprimiu `bar` e `/private/tmp`).

### Redirecionando a saída, e o deadlock

`RedirectStandardOutput` e `RedirectStandardError` entregam os pipes como
`StreamReader`. Um pipe tem um buffer fixo. Quando o filho o enche e você não
está lendo aquele pipe, o filho bloqueia no `write`, e se você está bloqueado
esperando o outro pipe, os dois esperam para sempre. O código clássico faz
exatamente isso:

```csharp
// o filho escreve 200 KB no stderr e depois "done" no stdout
var o = p.StandardOutput.ReadToEnd();   // espera o stdout fechar...
var e = p.StandardError.ReadToEnd();    // ...mas o filho está preso escrevendo no stderr
```

Rodei com uma guarda de 3 segundos: não terminou, e `HasExited` era `False`.
Nada lança exceção, o programa simplesmente para. A correção é drenar os dois
pipes ao mesmo tempo e só então esperar:

```csharp
var o = p.StandardOutput.ReadToEndAsync();
var e = p.StandardError.ReadToEndAsync();
await Task.WhenAll(o, e);
await p.WaitForExitAsync();
// out=done err=200000 exit=0
```

Inicie as duas leituras antes de aguardar qualquer uma. Redirecionar só um
stream, ou nenhum, não é problema: sem redirecionar, o filho escreve direto no
seu console. Ler um stream que você não redirecionou lança
`InvalidOperationException: StandardOut has not been redirected or the process hasn't started yet.`

A alternativa mais antiga é `BeginOutputReadLine` com `OutputDataReceived`.
Funciona, com uma armadilha: `WaitForExit()` sem argumento também espera os
streams de evento chegarem ao fim do arquivo. Com um shell que saiu na hora mas
deixou um `sleep 2` segurando o pipe, `WaitForExit()` voltou depois de 2012 ms,
enquanto `WaitForExit(5000)` voltou em 3 ms com `HasExited` verdadeiro. É um
motivo comum de passo de build "travado": um neto ainda é dono do pipe.

Para entrada, ligue `RedirectStandardInput`, escreva e feche o writer. O `cat`
devolveu `hello` só depois de `StandardInput.Close()`, porque fechar é o que
avisa ao filho que não há mais entrada.

### Timeout e matar a árvore

`Process` não tem timeout próprio. Cancele a espera e mate:

```csharp
using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(30));
try { await p.WaitForExitAsync(cts.Token); }
catch (OperationCanceledException)
{
    p.Kill(entireProcessTree: true);
    await p.WaitForExitAsync();
}
```

`Kill()` mata um processo. Com `sh -c "sleep 310 & echo $!; wait"` como filho,
depois de `Kill(false)` o pai estava morto e o neto `sleep` **continuava vivo**;
depois de `Kill(true)` os dois tinham sumido. Um neto sobrevivente também mantém
seu pipe de stdout aberto, então um leitor esperando o fim do arquivo trava
depois do kill "bem-sucedido". Use `Kill(true)` por padrão e aguarde a saída
antes de ler `ExitCode`: ler antes lança
`InvalidOperationException: Process must exit before requested information can be determined.`

### Códigos de saída e sinais

Uma saída normal dá o código do próprio programa (`exit 3` deu `ExitCode=3`). No
Unix, um processo morto por sinal não tem código de saída, e o .NET reporta
`128 + sinal`: um filho que enviou SIGTERM a si mesmo deu `143`, e um morto por
`Kill()` deu `137` (SIGKILL é o 9). Então `código > 128` significa "morto por
sinal" na prática, com a ressalva de que um programa também pode sair com 130 por
conta própria. No Windows não há sinais e o código é o que o programa devolveu.

No .NET 11 você pode enviar um sinal e ler o sinal de volta:
`Process.Signal(PosixSignal.SIGTERM)` devolveu `True` e
`WaitForExitStatusAsync()` entregou um `ProcessExitStatus` com `ExitCode=143` e
`Signal=SIGTERM`. Um SIGTERM educado primeiro, e um kill depois de um período de
graça, é a forma elegante de parar um servidor filho.

### O que o .NET 11 acrescenta

O .NET 11 coloca o padrão inteiro acima atrás de métodos estáticos em `Process`
(documentados em What's new in .NET 11 libraries). No runtime GA eu chamei cada
um:

```csharp
var r = Process.RunAndCaptureText("sh", ["-c", "echo out; echo err >&2; exit 3"]);
// r.StandardOutput = "out", r.StandardError = "err", r.ExitStatus.ExitCode = 3, r.ProcessId > 0

var st = Process.Run("sleep", ["30"], silent: false, timeout: TimeSpan.FromMilliseconds(300));
// st.ExitCode = 137, st.Signal = SIGKILL, st.Canceled = True
```

- `Run`, `RunAsync`: iniciam, esperam e devolvem um `ProcessExitStatus` (`ExitCode`, `Signal`, `Canceled`). `silent: true` descarta a saída do filho (nada foi impresso), `false` deixa passar para o seu console.
- `RunAndCaptureText`, `RunAndCaptureTextAsync`: o padrão de redirecionar e ler deste concept, com os dois streams separados. 2 MB em cada stream terminaram sem deadlock.
- `ReadAllLines`, `ReadAllText`, `ReadAllBytes` (e versões assíncronas) num `Process` que você mesmo iniciou. `ReadAllLines` produz `ProcessOutputLine` com `Content` e uma flag `StandardError`. A ordem não é a ordem em que o filho escreveu: com três linhas intercaladas em cada stream, vieram primeiro as linhas do stderr e depois as do stdout, então use a flag, não a posição.
- `StartAndForget` devolve o id do processo e não acompanha o filho.
- `ProcessStartInfo` também ganhou `StartSuspended` (documentado para Windows e macOS), `KillOnParentExit` (Linux, Android e Windows, o compilador avisou no macOS), `CreateNewProcessGroup` (Windows) e `InheritedHandles`. Não executei estes.

O timeout é onde os atalhos diferem entre si e do padrão manual. `Run` com
timeout e `RunAsync` com token cancelado **não lançam exceção**: devolvem
`Canceled=True`, `ExitCode=137`, `Signal=SIGKILL`. `RunAndCaptureText` com
timeout **lança** `TimeoutException: The operation has timed out.`, e
`RunAndCaptureTextAsync` com token cancelado lança `OperationCanceledException`.
E em `Run` e em `RunAndCaptureText` o neto do experimento anterior continuava
**vivo** depois do timeout. Ou seja, o atalho mata o processo que iniciou, não a
árvore. Se o seu filho inicia filhos, mantenha a versão manual com
`Kill(entireProcessTree: true)`, ou coloque-os num script que faz a limpeza.
Observei isso só no macOS; confira a documentação da sua plataforma.

## Trade-offs

- **O atalho é mais curto, a versão manual é a que você consegue ajustar.**
  `RunAndCaptureText` elimina a classe de bugs do deadlock. Ele não transmite a
  saída enquanto o filho roda, não envia entrada e não mata a árvore.
  ```csharp
  var r = Process.RunAndCaptureText("git", ["rev-parse", "HEAD"], TimeSpan.FromSeconds(10));
  ```
- **Capturar texto mantém tudo em memória.** Um filho que imprime gigabytes
  enche o seu heap. Para saída grande, leia linha a linha (`ReadAllLines`) ou
  copie o stream para um arquivo.
- **`ArgumentList` protege do shell, não do programa.** Um valor que começa com
  `-` ainda é uma opção para `git` ou `tar`. Coloque `--` antes dos valores do
  usuário quando o programa suportar, e valide o valor.
- **Código de saída 0 é convenção, não lei.** `grep` devolve 1 para "sem
  resultado", `diff` devolve 1 para "diferente". Mapeie os códigos por
  ferramenta em vez de tratar todo não-zero como erro.
- **`128 + n` é uma leitura de Unix.** Código portável confere
  `ExitStatus.Signal` no .NET 11 ou a plataforma antes de assumir um sinal.
- **Não envolva isso numa thread por chamada.** As leituras assíncronas e o
  `WaitForExitAsync` não bloqueiam uma thread enquanto o filho trabalha.

## Lab

Neste lab você recebe `ShellRunner` com **métodos vazios** (`NotImplementedException`). Sua tarefa é montar o `ProcessStartInfo`, rodar um filho e capturar os dois streams sem deadlock, aplicar um timeout que mata a árvore inteira e ler um código de saída como sucesso, falha ou sinal. A ideia central é que o filho e o seu programa dividem dois pipes pequenos, e sempre que um lado espera o outro sem drená-los, os dois param.

**O cenário**

Os testes usam pequenos scripts de shell (`sh`, `head`, `tr`, `sleep`, `printf`) como programa externo, então precisam de macOS ou Linux e nenhuma rede. Os testes de deadlock têm uma guarda que falha depois de 10 segundos em vez de travar.

- `Build`: o `ProcessStartInfo`.
- `RunAsync`: rodar, capturar e aplicar timeout.
- `Classify` e `SignalNumber`: interpretação do código de saída.

**O que você vai fazer, passo a passo**

1. **Montar o start info (TODO-00).** Adicione cada argumento em `ArgumentList`, redirecione stdout e stderr, desligue `UseShellExecute`, aplique pasta de trabalho e ambiente. Um teste passa `$HOME; echo injected` como argumento e espera receber exatamente isso de volta.
2. **Rodar e capturar (TODO-01).** Inicie as duas `ReadToEndAsync` antes de aguardar, depois espere a saída. Um filho que escreve 300 KB no stderr primeiro não pode travar você, e um programa inexistente deve lançar `Win32Exception`.
3. **Timeout e matar a árvore (TODO-02).** Espere com um `CancellationToken`. No cancelamento chame `Kill(entireProcessTree: true)`, aguarde a saída e devolva `TimedOut = true`. Um teste inicia um neto, grava o pid dele num arquivo e confere que está morto depois.
4. **Ler o código de saída (TODO-03).** `0` é sucesso, `1` a `128` é falha, acima de `128` é sinal e `código - 128` é o número dele.

**Como você sabe que terminou**

`dotnet test` fica todo verde. Você deve conseguir explicar por que ler o stdout até o fim antes do stderr trava, por que `Kill()` sozinho deixa um neto vivo e por que `143` significa SIGTERM.

**Desafios opcionais**

- **TODO-04:** leia o stdout até o fim e depois o stderr, e descubra a quantidade de stderr em que a guarda começa a falhar.
- **TODO-05:** num projeto de console `net11.0` separado, repita os scripts com `Process.RunAndCaptureText` e `Process.Run` e compare o comportamento do timeout e o neto sobrevivente com a sua versão.

**Pré-requisitos:** `async` e `await`, `CancellationToken` e o .NET 10 SDK. O desafio opcional precisa do .NET 11 SDK.

**Como rodar:** clone o repositório, entre na pasta do lab e rode `dotnet test`. Os métodos lançam `NotImplementedException` e cada `TODO-NN` está num comentário, então os testes vermelhos são o seu checklist.

## Documentation Links

- [Process Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process) (doc)
- [ProcessStartInfo.ArgumentList, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.argumentlist) (doc)
- [What's new in .NET libraries for .NET 11, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/whats-new/dotnet-11/libraries) (doc)
- [Process.Kill(Boolean), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.process.kill) (doc)
- [ProcessStartInfo.RedirectStandardOutput, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.redirectstandardoutput) (doc)
