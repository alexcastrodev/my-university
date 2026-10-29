---
version: 1.0
updatedAt: 2026-10-28
title: "Apps de Console, Códigos de Saída e System.CommandLine"
summary: Assinaturas de Main, args e o separador -- do dotnet run, códigos de saída e o truncamento para 0..255 no Unix, crashes e FailFast, stdout versus stderr, stdin e encodings, Ctrl+C e SIGTERM no .NET 10, e uma CLI com System.CommandLine 2.0 (opções, argumentos, validadores, ajuda, erros, response files, diretivas e cancelamento).
---
## Objective

Um programa de linha de comando conversa com quem o chamou por argumentos,
código de saída, stdout (dados) e stderr (o resto). Scripts, CI e
orquestradores só leem isso, então sair com 0 depois de uma falha quebra tudo
em silêncio. Este conceito mostra, no .NET 10 / C# 14 no macOS, como `Main`
devolve códigos, o que o Unix faz com códigos fora de 0..255, como termina um
crash, como manter o stdout limpo, como tratar Ctrl+C e SIGTERM e como montar
uma CLI com `System.CommandLine`, que ficou seis anos em beta: o NuGet mostra a
2.0.0 estável desde 2025-11-11, a 2.0.14 como estável atual (2026-10-25) e a
3.0.0 ainda em prerelease (rc.3). Os exemplos usam a 2.0.14, cuja API difere da
beta4 da maioria dos posts. O README do Spectre.Console.Cli o chama de "a modern
library for parsing command line arguments", e o do Cocona descreve um
micro-framework em que métodos públicos viram comandos (nenhum foi testado).

## Use Cases

- Ferramentas em que um script, um passo de CI ou o `make` podem confiar.
- Um worker de console num container, onde SIGTERM é o pedido de desligamento.
- Trocar o parsing manual de `args` por opções tipadas e `--help`.
- Diagnosticar "o pipeline diz sucesso mas nada aconteceu" (código perdido).

## Deep Dive

### Pontos de entrada, args e o separador `--`

`Main` devolve `void`, `int`, `Task` ou `Task<int>`, com ou sem
`string[] args`; um top-level program ganha a forma `int` quando contém
`return n;`. `args` nunca traz o nome do programa, enquanto
`Environment.GetCommandLineArgs()[0]` é o caminho do assembly. No `dotnet run`,
o que vem após `--` vai ao programa; sem ele, o SDK fica com o que reconhece:

```text
$ dotnet run -- args --verbose -c x
4: [args] [--verbose] [-c] [x]
$ dotnet run args -c Release
1: [args]                         // -c Release was taken by dotnet run
```

### Códigos de saída: o Unix guarda um byte

Cada caso foi executado e lido com `echo $?` no zsh:

```text
return 3     -> 3
return 256   -> 0       return -1  -> 255
return 300   -> 44      void Main with Environment.ExitCode = 1000 -> 232
Environment.ExitCode = 7, then return 0   -> 0   (the return value wins)
Environment.ExitCode = 7, then Exit(3)    -> 3
Environment.Exit(4) inside try/finally    -> 4, and the finally did not run
throw new InvalidOperationException(...)  -> 134  "Unhandled exception. System..."
Environment.FailFast("state corrupted")   -> 134  "Process terminated." + stack
```

O status é tomado módulo 256: devolver "256 erros" reporta sucesso. Shells
reportam morte pelo sinal n como 128 + n: crash é SIGABRT (6), daí 134; 130 e
143 aparecem abaixo. Mantenha seus códigos abaixo de 128. Mensagens de crash
vão para o stderr; o `FailFast` (para estado danificado demais para limpeza)
também pulou o seu `finally`. 134 é o valor no macOS; para Windows, a
documentação do Azure Service Fabric lista `0xE0434352` para exceção .NET não
tratada.

### stdout para dados, stderr para pessoas

```csharp
Console.Out.WriteLine("data line");
Console.Error.WriteLine("progress: 50%");
Console.Error.WriteLine($"out={Console.IsOutputRedirected} in={Console.IsInputRedirected} err={Console.IsErrorRedirected}");
```

```text
terminal (a pty):        out=False in=False err=False
./basics | cat           out=True  in=False err=False   (cat got only "data line")
echo hi | ./basics       out=False in=True  err=False
./basics 2>/dev/null     data line
```

Use `IsOutputRedirected` para desligar cores, spinners e prompts num pipe. O
`head` mostra uma diferença das ferramentas nativas: `yes | head -1` dá ao
`yes` o status 141 (SIGPIPE), já um programa .NET escrevendo 1.000.000 de
linhas em `| head -2` seguiu rodando, imprimiu "wrote all" no stderr e saiu
com 0; o que escreveu após o pipe fechar foi descartado em silêncio.

`Console.ReadLine()` devolve `null` no fim da entrada. `Console.ReadKey()` com
stdin redirecionado, como no CI, lança `InvalidOperationException: Cannot read
keys when either application does not have a console or when console input has
been redirected. Try Console.Read.`, então proteja com
`!Console.IsInputRedirected`. O encoding segue o locale:
`Console.OutputEncoding.WebName` foi `utf-8` com `LANG=en_US.UTF-8`, `LANG=C` e
sem variáveis de locale, mas `iso-8859-1` com `LANG=en_US.ISO8859-1`, onde
`"café ✓"` saiu como `caf\xe9 ?`. Definir `Console.OutputEncoding =
Encoding.UTF8` restaurou o UTF-8, sem escrever BOM.

### Ctrl+C e SIGTERM

```csharp
// e.Cancel / ctx.Cancel = true: não morra, nós mesmos encerramos
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };
using var reg = PosixSignalRegistration.Create(PosixSignal.SIGTERM,
    ctx => { ctx.Cancel = true; cts.Cancel(); });
await Task.Delay(30_000, cts.Token);   // o trabalho, cancelado por qualquer um dos sinais
```

Sinais enviados com `kill -INT` e `kill -TERM` ao processo em execução:

```text
SIGINT,  handler sets e.Cancel = true -> cleanup ran, exit 0
SIGINT,  handler leaves Cancel false  -> handler ran, exit 130
SIGINT,  no handler                   -> exit 130
SIGTERM, registration sets ctx.Cancel -> "drained, exiting", exit 0
SIGTERM, registration without Cancel  -> handler ran, exit 143
SIGTERM, nothing registered           -> exit 143, ProcessExit NOT raised
```

Após um SIGINT tratado, o código de saída é o que seu código devolver (devolva
130 para sinalizar "interrompido"). A última linha é uma breaking change do
.NET 10: a documentação diz que o runtime não instala mais handler de SIGTERM,
então `ProcessExit` não dispara; no .NET 9 o mesmo programa imprimiu
"ProcessExit". Um worker em container precisa do próprio registro ou do Generic
Host. Armadilha: um job com `&` num shell não interativo ignora SIGINT.

### System.CommandLine 2.0: comandos, opções, argumentos

```csharp
Option<bool> verbose = new("--verbose", "-v") { Description = "Print extra diagnostics to stderr", Recursive = true };
Argument<string> title = new("title") { Description = "Task title" };
Option<int> priority = new("--priority", "-p") { Description = "1 (high) to 5 (low)", DefaultValueFactory = _ => 3 };
Option<string> list = new("--list", "-l") { Description = "Target list", Required = true };

Command add = new("add", "Add a task") { title, priority, list };   // e --due
add.SetAction((ParseResult r, CancellationToken ct) =>
{
    Console.WriteLine($"added '{r.GetValue(title)}' to {r.GetValue(list)} priority={r.GetValue(priority)}");
    return Task.FromResult(0);
});
RootCommand root = new("todo: a tiny task tracker") { verbose, add, done, sync };
return await root.Parse(args).InvokeAsync();
```

Construtores recebem nome e aliases; a descrição é propriedade. Código beta4
falha na 2.0.14: `root.SetHandler(...)` dá
`CS1061: 'RootCommand' does not contain a definition for 'SetHandler'` (virou
`SetAction`, que recebe `ParseResult`), `InvocationContext` dá `CS0234`, e
`new Option<int>("--count", "How many items")` lança `ArgumentException: Names
and aliases cannot contain whitespace: "How many items" (Parameter 'alias')`.

### Ajuda, erros, validadores, response files e diretivas

`RootCommand` adiciona `-?, -h, --help` e `--version` (que imprimiu `1.0.0`);
`todo add --help` mostrou `[default: 3]`, `(REQUIRED)` e o `-v, --verbose`
recursivo. Erro de parsing não chega à action: erros no stderr, ajuda no
stdout, saída 1.

```text
$ todo add                       (exit 1)
stderr: Option '--list' is required.
        Required argument missing for command: 'add'.
$ todo ad "Buy milk"             (exit 1, more stderr lines omitted)
stdout: 'ad' was not matched. Did you mean one of the following?
        add
stderr: Unrecognized command or argument 'ad'.
$ todo done 7                    (exit 2, returned by the action)
```

Sugestões de digitação vêm ligadas. `todo add x -l home -vp 2` (bundling) rodou
com verbose e prioridade 2. Uma exceção numa action sai como `Unhandled
exception: System.IO.IOException: disk full` e vira código 1.

```csharp
priority.Validators.Add(result =>
{
    // GetValue aqui lança exceção se o token não for int, então leia o token
    if (int.TryParse(result.Tokens.SingleOrDefault()?.Value, out int value)
        && value is < 1 or > 5)
        result.AddError("--priority must be between 1 and 5.");
});
```

`-p 9` imprimiu `--priority must be between 1 and 5.` (saída 1). O exemplo da
documentação chama `result.GetValue(option)`; com `-p abc` isso derrubou o
processo (saída 134) com `InvalidOperationException: Cannot parse argument
'abc' for option '--priority' as expected type 'System.Int32'.`, pois
validadores rodam dentro de `Parse`, fora do tratador de exceções. Lendo o
token, vira um erro de parsing normal (saída 1).

Response files vêm ligados por padrão: `todo @add.rsp --due 2026-12-24` (um
token por linha no arquivo) rodou `add` com os tokens do arquivo mais o
`--due`. `[suggest]` é registrada por padrão, mas `[diagram]` não, embora a
página de sintaxe a chame de recurso padrão: falhou com `Unrecognized command
or argument '[diagram]'` até `root.Directives.Add(new DiagramDirective())`,
depois do que `todo [diagram] add "Buy milk" -l home -p abc` imprimiu
`[ todo ![ add <Buy milk> [ -l <home> ] ![ -p <abc> ] ] *[ --verbose ] ]`.

### Cancelamento nas actions, e dotnet run versus uma ferramenta publicada

Uma action assíncrona recebe um `CancellationToken` que a biblioteca cancela em
SIGINT (Ctrl+C) ou SIGTERM. O comando `sync` aguarda `Task.Delay(30 s, ct)`:

```text
token honored, catch returns 130          -> exit 130 right after the signal
token honored, OperationCanceledException -> exit 1
token ignored (SIGINT)                    -> killed 2 s later, exit 130
ProcessTerminationTimeout = 5 s, ignored  -> killed 5 s later, exit 130
ProcessTerminationTimeout = null (SIGINT) -> exit 130 at once, no cleanup ran
```

As duas primeiras linhas foram iguais com SIGTERM. O apphost publicado
(`dotnet publish -c Release -o out`) iniciou em cerca de 35 ms, contra cerca de
670 ms do `dotnet run` e 290 ms do `dotnet run --no-build` (medianas de cinco
execuções). Use `dotnet run --` no dia a dia; distribua e teste o executável.

## Trade-offs

- **Códigos de saída são um byte no Unix.** Fora de 0..255 dá a volta em
  silêncio. Documente um conjunto pequeno (0 ok, 1 falha, 2 uso, outros < 128).
- **System.CommandLine é estável, mas o histórico é confuso.** A maioria dos
  exemplos na internet é código beta4 que não compila mais. Fixe uma versão
  2.0.x e ignore exemplos com `SetHandler` ou `InvocationContext`.
- **A biblioteca escreve no console por você.** Ajuda e sugestões vão para o
  stdout mesmo após erro de uso: confira o código de saída antes. Mensagens são
  parcialmente localizadas (com `LANG=pt_BR.UTF-8` uma virou "Argumento
  obrigatório ausente", outra ficou em inglês).
- **Sinais exigem código explícito desde o .NET 10.** Um app de console puro
  morre com SIGTERM sem `ProcessExit`. Use `PosixSignalRegistration`, uma
  action assíncrona do System.CommandLine ou o Generic Host.

## Documentation Links

- [System.CommandLine overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/commandline/) (doc)
- [Tutorial: Build a command-line app with System.CommandLine, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/tutorials/system-command-line) (doc)
- [Main() and command-line arguments, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/fundamentals/program-structure/main-command-line) (doc)
- [Environment.Exit method, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.environment.exit?view=net-10.0) (doc)
- [PosixSignalRegistration class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.runtime.interopservices.posixsignalregistration?view=net-10.0) (doc)
- [.NET runtime no longer provides default termination signal handlers, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/compatibility/core-libraries/10.0/sigterm-signal-handler) (doc)
