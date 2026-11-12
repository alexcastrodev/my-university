---
version: 1.0
updatedAt: 2026-11-12
title: "Diagnosticando testes instáveis, travados e que derrubam o processo com o MTP"
summary: Ligue retry, hang dump, crash dump e relatórios no Microsoft.Testing.Platform, leia o que cada um imprime e grava, veja o que um retry esconde e compare com o [Retry] do MSTest, o [Timeout] e as duas formas de --timeout, tudo medido no SDK 11 GA.
---
## Objective

Um job de CI que falha "às vezes" tem três causas diferentes, e cada uma parece
diferente vista de fora. Um teste que passa sozinho e falha na execução completa
é instável (flaky). Um teste que nunca retorna é um travamento, e o job morre no
limite de tempo sem dizer quem foi. Um teste que derruba o processo é um crash, e
o resumo diz `total: 0`. O Microsoft.Testing.Platform (MTP) traz uma extensão para
cada caso, e elas só ajudam se estiverem ligadas antes da falha. O objetivo:
ligar retry, hang dump, crash dump e os relatórios, ler exatamente o que cada um
imprime e grava, e saber o que um retry esconde. Versões: `MSTest.Sdk` 4.5.2
(extensões 2.5.2), executado no SDK .NET 11.0.100 (o projeto `net10.0` sobre o
runtime .NET 11, com roll forward) e, para o retry, também no SDK 10.0.100. Não
foi usado Docker.

## Use Cases

- Manter o build verde enquanto um teste instável é corrigido, sem perder o registro de que ele falhou.
- Descobrir qual teste travou um job que foi morto depois de uma hora.
- Obter o nome do teste que derrubou o processo e um dump para abrir.
- Publicar arquivos TRX, HTML ou JUnit que o CI mostra junto do build.

## Deep Dive

### Três suspeitos

O lab tem um contador de tickets compartilhado pelo processo inteiro, uma caixa
de entrada alimentada por outra thread e uma rota feita de paradas encadeadas:

```csharp
public static int Next() => ++_last;                       // TicketCounter

public string Receive() => _messages.Take();               // Inbox, espera para sempre

public static int Length(Stop? start) =>                   // Route
    start is null ? 0 : 1 + Length(start.Next);
```

e quatro testes, ligados com `DISPATCH_SUSPECTS=1`. `TicketsAreSequential` pega
dois tickets; `TheFirstTicketOfTheDayIsOne` afirma que o próximo ticket é 1 e
roda depois dele. `TheDepotAnswers` chama `Receive()` numa caixa em que ninguém
posta. `ARouteCanBeCounted` chama `Length` em duas paradas que apontam uma para a
outra.

### Ligando as extensões

O perfil `Default` do `MSTest.Sdk` carrega cobertura de código e o relatório TRX,
e nada mais. Retry, hang dump, crash dump e o relatório HTML são pacotes
separados. Ou você nomeia um perfil, ou liga cada um com uma propriedade (o
`MSTest.Sdk` adiciona o pacote):

```xml
<Project Sdk="MSTest.Sdk/4.5.2">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <EnableMicrosoftTestingExtensionsRetry>true</EnableMicrosoftTestingExtensionsRetry>
    <EnableMicrosoftTestingExtensionsHangDump>true</EnableMicrosoftTestingExtensionsHangDump>
    <EnableMicrosoftTestingExtensionsCrashDump>true</EnableMicrosoftTestingExtensionsCrashDump>
    <EnableMicrosoftTestingExtensionsHtmlReport>true</EnableMicrosoftTestingExtensionsHtmlReport>
  </PropertyGroup>
</Project>
```

`<TestingExtensionsProfile>AllMicrosoft</TestingExtensionsProfile>` também
funciona e carrega mais (relatórios do Azure DevOps e do GitHub Actions, hot
reload). Um teste pode conferir a configuração: os assemblies das quatro
extensões aparecem em `AppDomain.CurrentDomain.GetAssemblies()` quando estão
carregados, que é o que os `RunnerTests` do lab fazem.

### Retry: o que passa e o que ele esconde

`TheFirstTicketOfTheDayIsOne` rodou depois de `TicketsAreSequential` e viu o
ticket 3. Sozinho ele passa. Com `--retry-failed-tests 3`:

```text
(try 1) Running tests from ...Dispatch.Tests.dll (net11.0|arm64)
failed (try 1) TheFirstTicketOfTheDayIsOne (9ms)
  expected: 1
  actual:   3
(try 2) Running tests from ...Dispatch.Tests.dll (net11.0|arm64)

Test run summary: Passed!
  total: 2
  succeeded: 2
  flaky: 1 (passed after retry)
  retried: 1 test(s), 1 extra run(s)

Flaky tests:
  TheFirstTicketOfTheDayIsOne failed -> passed (2 attempts)
```

O exit code é 0. A extensão reinicia a aplicação de teste com um filtro só para
os testes que falharam, então a segunda tentativa é um processo novo e o contador
começa em 0. É por isso que passou, e é o diagnóstico: o teste depende do que
outros testes fizeram no mesmo processo. A linha `flaky` e a lista `Flaky tests`
são o sinal para agir (`--show-flaky-tests off` as esconde). O SDK 10.0.100
imprime `total: 2 (+1 retried)` e nenhuma linha `flaky`.

Um teste sempre vermelho é reexecutado e continua falhando.
`--retry-failed-tests 2` deu três tentativas no total (`(try 1)` a `(try 3)`) e
exit code 2. Um orçamento de retry impede que uma falha em massa seja
reexecutada: com `--retry-failed-tests-max-tests 1` e dois testes falhando, a
saída foi `Failure threshold policy is enabled, failed tests will not be
restarted.` e `Maximum failed tests threshold is 1 and 2 tests failed`, e o exit
code foi 2. `--retry-failed-tests-max-percentage` faz o mesmo por proporção, e
`--retry-failed-tests-delay` espera entre as tentativas (ambos listados no
`--help`).

### O `[Retry]` do MSTest não é isso

`[Retry(3)]` num teste refaz a tentativa dentro do mesmo processo. No mesmo teste
instável as quatro tentativas viram os tickets 3, 4, 5 e 6, todas falharam, e a
execução saiu com 2: o contador compartilhado continuou crescendo, então um retry
no mesmo processo não podia corrigir. Em outro teste o atributo passou na terceira
tentativa com exit code 0, mas o resumo ainda contou `failed: 2` (cada tentativa é
um resultado). A extensão reexecuta num processo novo e diz quais testes foram
instáveis; o atributo reexecuta no lugar e conta as tentativas como resultados.
Nenhum dos dois torna um teste determinístico.

### Travamento: o dump dá o nome do teste

```bash
dotnet test --filter "Name=TheDepotAnswers" --hangdump --hangdump-timeout 5s --hangdump-type Mini
```

```text
Hang dump timeout of '00:00:05' expired
The following tests were still running when dump was taken (format: [<time-elapsed-since-start>] <name>):
[00:00:05] TheDepotAnswers
Creating dump file 'TestResults/Dispatch.Tests_73742_hang.dmp'
Test application process didn't exit gracefully, exit code is '137'
Exit code: 7
```

Exit code 7 significa que o test host saiu de forma inesperada. `TestResults/`
guarda o `.dmp` (cerca de 40 MB num dump `Mini`; o padrão documentado é `Full`) e
um `_hang.log` com os nomes dos testes em execução. Escolha `--hangdump-timeout`
acima do seu teste legítimo mais lento e abaixo do limite do job de CI, e publique
a pasta como artefato. O dump é para um depurador ou o `dotnet-dump`, tratado no
concept Diagnosing Production. Uma proteção mais barata é `[Timeout(2000)]` no
teste: um teste bloqueado (um sleep de 20 segundos) falhou em 2 segundos com `Test
'TimeoutAttribute' timed out after 2000ms`, um teste vermelho comum (exit code 2),
e o processo terminou. O dump serve quando nenhum teste tem timeout, ou quando o
travamento está numa fixture.

### Crash: o sequence log dá o último teste

Um stack overflow não pode ser capturado. Sem extensão, a execução imprimiu
`Stack overflow.`, um trace que repete `Dispatch.Route.Length` 32374 vezes, e saiu
com 134. O resumo tinha `error: 1` e `total: 0`, sem nome de teste. Com
`--crashdump --crashdump-type Mini`:

```text
Test host process with PID '74328' crashed, a dump file was generated
The following tests were still running when the test host crashed (...):
[00:00:00] ARouteCanBeCounted
Exit code: 7
    - TestResults/Dispatch.Tests_74328_crash.dmp
    - TestResults/Dispatch.Tests_2e509bb2_crash.sequence.log
```

O sequence log tem uma linha `STARTED` e uma `ENDED`, com o resultado, para cada
teste. Numa execução de 13 testes a última linha foi
`STARTED ... ARouteCanBeCounted` sem `ENDED`, depois de onze testes que passaram e
um que falhou. O culpado é o último `STARTED` sem `ENDED`, mesmo quando o console
é só uma página de stack trace.

### Relatórios: o retry muda o que um TRX contém

`--report-trx` e `--report-html` escrevem um arquivo por aplicação de teste. Numa
execução com retry há três lugares: o arquivo de `TestResults/`, um par por
tentativa em `TestResults/Retries/<id>/1` e `/2`, e um par mesclado em
`Retries/<id>/1/merged/`. O TRX do topo tinha um resultado para
`TheFirstTicketOfTheDayIsOne` (Passed): a falha sumiu. O TRX mesclado tinha três
resultados, `total="3" passed="2" failed="1"`: a tentativa que falhou também. Se o
relatório alimenta um painel de instabilidade, leia o arquivo mesclado.

O JUnit ainda não tem pacote estável. `Microsoft.Testing.Extensions.JUnitReport`
`1.0.0-alpha.26561.10` (preview) adicionou `--report-junit`, e a execução gravou um
arquivo `testsuites` com `tests`, `failures` e um `testcase` por teste, mais o exit
code como propriedade. Existe um pacote CTRF na mesma linha alpha (não executado
aqui).

### Duas opções chamadas `--timeout`

```bash
dotnet test --timeout 3s              # antes do separador: a execução
dotnet test -- --timeout 3s           # depois dele: cada aplicação de teste
```

Num teste que dorme 20 segundos, a primeira forma não o interrompeu: a execução
levou 20 segundos, o teste passou, e o resumo disse `Aborted` com exit code 3. Com
dois projetos de teste e `--max-parallel-test-modules 1`, o módulo que ainda não
tinha começado nunca rodou (`total: 1`). Então o timeout da execução age entre
módulos e não interrompe um test host que já está rodando. Depois do `--` a
plataforma matou o test host aos 3 segundos, exit code 3 e `total: 0`. Para um
teste preso, use a forma por aplicação, um `[Timeout]` ou um hang dump.

### Qual ferramenta para qual sintoma

| Sintoma | Ferramenta | O que você recebe | Exit code |
| --- | --- | --- | --- |
| Falha na execução completa, passa sozinho | `--retry-failed-tests` | linha `flaky`, lista, TRX mesclado | 0 se passar |
| Job morto sem nome | `--hangdump --hangdump-timeout` | nomes em execução, `.dmp`, `.log` | 7 |
| `total: 0` e um stack trace | `--crashdump` | teste que caiu, `.dmp`, `crash.sequence.log` | 7 (134 sem ele) |
| Precisa de um arquivo para o CI | `--report-trx`, `--report-html` | por aplicação e por tentativa | inalterado |

## Trade-offs

- **Retry é um curativo com recibo.** Ele mantém o job verde, e a lista `flaky` é
  o recibo. Se ninguém a lê, o defeito continua. Reexecute só os testes que
  falham, defina um máximo e corrija o que a lista nomeia.
- **O timeout do hang é um palpite.** Curto demais, mata uma execução lenta mas
  saudável; longo demais, o CI estoura o tempo antes. Meça o teste mais lento e
  some uma margem.
- **Dumps são grandes.** Um dump `Mini` tinha cerca de 40 MB para um projeto de
  teste vazio; o `Full` padrão é maior. Guarde-os como artefatos de vida curta.
- **Relatório em preview é um risco.** JUnit e CTRF saem como pacotes
  `1.0.0-alpha`, então formato ou opção podem mudar. TRX e HTML são estáveis (2.5.2).
- **Ver a causa exige a opção ligada antes.** Dumps de crash e de hang só existem
  se a opção estava ligada quando falhou, então ligue-as por padrão no CI.

## Lab

A mesa de despacho já está implementada, com os quatro testes suspeitos. Sua tarefa é ligar as extensões, diagnosticar cada suspeito pelo que o MTP imprime e escrever os testes corrigidos.

**O que você vai praticar**

- Ligar retry, hang dump, crash dump e HTML com propriedades do `MSTest.Sdk`.
- Ler o resumo `flaky` e explicar por que o retry passou.
- Ler a lista de testes em execução de um travamento e o `crash.sequence.log` de um crash.
- Comparar um TRX do topo com o TRX mesclado de uma execução com retry.
- Comparar a extensão de retry com o `[Retry]`, o `[Timeout]` do MSTest e as duas formas de `--timeout`.

**Pré-requisitos:** Microsoft.Testing.Platform, dotnet test e Code Coverage no CI, MSTest Fundamentals: Lifecycle and TestContext, SDK .NET 10.

**Como funciona:** os suspeitos só rodam com `DISPATCH_SUSPECTS=1`, então `dotnet test` continua verde. No starter, três checagens de configuração falham até as extensões carregarem, e seis testes falham com `TODO-NN` até você escrevê-los. Os TODOs opcionais medem `[Retry]`, `[Timeout]` e `--timeout`.

## Documentation Links

- [Microsoft.Testing.Platform features, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-features) (doc)
- [Retry, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-retry) (doc)
- [Crash and hang dumps, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-crash-hang-dumps) (doc)
- [Test reports, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-test-reports) (doc)
- [MTP troubleshooting and exit codes, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/microsoft-testing-platform-troubleshooting) (doc)
- [MSTest SDK configuration, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-sdk) (doc)
- [dotnet test with Microsoft.Testing.Platform, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/tools/dotnet-test-mtp) (doc)
