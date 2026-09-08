---
version: 1.0
updatedAt: 2026-08-18
title: "O Fiber Scheduler, async e Falcon: I/O Cooperativo em Produção"
summary: O Ruby traz a interface Fiber::Scheduler, mas nenhuma implementação; async é a implementação de produção, e faz código concorrente parecer Ruby bloqueante comum. O Falcon transforma isso em um servidor web onde uma requisição custa uma fiber em vez de uma thread, então um único worker segura milhares de conexões lentas de I/O que o pool de threads do Puma jamais caberia.
---
## Objective

O Ruby traz a interface `Fiber::Scheduler` e para por aí; no momento em que
você de fato instala uma implementação, o quadro muda completamente. A gem
`async` é essa implementação em produção, e o Falcon é um servidor web
construído em cima dela. Juntos, eles deixam você escrever código que
*parece* Ruby bloqueante comum (sem callbacks, sem cadeias de promise, sem
`.then`) enquanto toda chamada bloqueante silenciosamente cede a thread do SO
para outra fiber. Este conceito é sobre o que isso traz no dia a dia, como o
Falcon transforma isso em uma arquitetura de atendimento de requisições, e a
comparação honesta com o modelo de uma thread por requisição que você já
conhece do Puma.

## Use Cases

- Um serviço cujo handler de requisição se ramifica para cinco APIs upstream
  lentas e passa 90% do seu tempo de relógio esperando em sockets.
- Conexões de longa duração em grande quantidade: WebSockets, Server-Sent
  Events, long polling, respostas em streaming, milhares de conexões que ficam
  ociosas na maior parte do tempo.
- Um crawler, scraper, ou cliente de API em massa que quer alguns milhares de
  requisições em voo com um teto rígido de quantas atingem um único host.
- Um proxy, gateway, ou agregador: alta contagem de conexões, CPU por
  requisição próxima de zero, onde uma thread por requisição significa pagar
  por uma pilha de thread por socket ocioso.
- Decidir se a resposta para "precisamos de mais requisições concorrentes por
  processo" é *aumentar a contagem de threads do Puma* ou *mudar a unidade de
  concorrência inteiramente*.
- Aplicar um timeout ou um limite de concorrência sobre um grupo inteiro de
  operações em voo, sem passar um prazo por toda chamada de método.

## Deep Dive

### O que um scheduler instalado de fato faz com seu código

`Async { }` cria um reactor na thread atual e instala seu scheduler durante o
bloco. A partir daí, operações bloqueantes comuns dentro de fibers não
bloqueantes (leituras e escritas de socket, `sleep`, resolução de DNS,
esperar em um `Thread::Queue` ou um `Thread::Mutex`, `Process.wait`) passam
pelos hooks do scheduler em vez de estacionar a thread. O scheduler suspende
essa fiber, roda qualquer outra fiber que esteja pronta, e retoma a primeira
quando seu I/O está de fato pronto.

A consequência visível é que não há nada para ver. O código é o mesmo código:

```ruby
require "async"

Async do
  3.times do |i|
    Async do
      sleep(3 - i)              # yields to the scheduler; the thread is not blocked
      puts "task #{i} finished"
    end
  end
end
# task 2 / task 1 / task 0, total elapsed ~3s — not 6s
```

Três chamadas `sleep` que se serializariam em seis segundos se sobrepõem em
três, sem uma única linha de encanamento assíncrono. `sleep` é a demonstração
honesta porque torna o ponto inconfundível, mas o mesmo vale para todo
socket que a camada de I/O do ecossistema `async` toca.

`Async { }` aninhado inicia uma **tarefa filha**, não um novo reactor. Uma
tarefa é uma fiber não bloqueante com um resultado:

```ruby
require "async"
require "async/http/internet"

URLS = ["https://example.com/a", "https://example.com/b", "https://example.com/c"]

Async do
  internet = Async::HTTP::Internet.new

  tasks = URLS.map do |url|
    Async do
      response = internet.get(url)
      begin
        response.read
      ensure
        response.close
      end
    end
  end

  bodies = tasks.map(&:wait)   # each `wait` returns the task's value
  puts bodies.map(&:bytesize).inspect
ensure
  internet&.close
end
```

`Async::Task#wait` retorna o valor do bloco, ou relança a exceção com a qual
a tarefa morreu, deliberadamente o mesmo contrato de `Thread#value`. Essa
simetria é o ponto principal: o modelo mental que você já tem para threads se
transfere, enquanto o modelo de custo por baixo não.

### Concorrência estruturada: tarefas formam uma árvore

Tarefas não são soltas no ar. Uma tarefa filha pertence à tarefa que a criou,
e o bloco `Async` que a envolve não retorna até suas filhas terem terminado.
Se o pai for parado ou levantar exceção, a subárvore é parada com ele. Isso
elimina o modo de falha de trabalho em segundo plano vazado que um simples
`Thread.new`-e-esquecer convida; não há como "esquecer" uma tarefa enquanto
seu pai ainda está na pilha.

Para concorrência limitada, o `async` te dá um semáforo e uma barreira, não
um pool de threads. Uma fiber é barata o bastante para que a tentação seja
criar uma por item de trabalho; o limite que você de fato precisa costuma ser
o do sistema *remoto*, não o do Ruby:

```ruby
require "async"
require "async/barrier"
require "async/semaphore"

Async do
  barrier   = Async::Barrier.new
  semaphore = Async::Semaphore.new(10, parent: barrier)   # at most 10 in flight

  urls.each do |url|
    semaphore.async { fetch(url) }
  end

  barrier.wait     # all queued work is done (or one of them raised)
ensure
  barrier.stop     # on any exception, cancel whatever is still running
end
```

Timeouts são expressos na tarefa em vez de por chamada, então um prazo cobre
tudo que acontece dentro dela:

```ruby
Async do |task|
  task.with_timeout(5) do
    internet.get(slow_url).read
  end
rescue Async::TimeoutError
  fallback_payload
end
```

### Falcon: o mesmo modelo, rodando um servidor web

O Falcon é um servidor de aplicação compatível com Rack, construído sobre
`async` e `async-http`. Ele fala HTTP/1, HTTP/2 e TLS nativamente (sem
precisar de um proxy terminador separado para isso), e roda **uma fiber por
requisição** dentro de um reactor, com *processos* worker usados só para
alcançar vários núcleos de CPU.

Sua aplicação não muda de formato; continua sendo uma aplicação Rack:

```ruby
# config.ru
run ->(env) { [200, {"content-type" => "text/plain"}, ["hello"]] }
```

```bash
bundle add falcon
bundle exec falcon serve --bind http://localhost:9292
```

A diferença arquitetural está inteiramente no que uma "unidade de
concorrência" custa. Sob o Puma, uma requisição em voo ocupa uma thread por
toda sua vida. A GVL é liberada durante I/O (veja o conceito da GVL), então
outras threads *fazem* progresso, mas a requisição esperando ainda é dona de
uma thread e sua pilha durante todo o tempo em que espera. A concorrência é
limitada pela sua contagem de threads, e aumentar essa contagem custa memória
por thread, esteja ela fazendo alguma coisa ou não.

```
Puma, 4 workers x 16 threads    → 64 concurrent requests, hard ceiling.
                                  A 500ms upstream call holds one of those 64
                                  slots for 500ms, doing nothing.

Falcon, 4 workers x 1 reactor   → thousands of concurrent requests. A request
                                  waiting on an upstream call holds a suspended
                                  fiber, and the reactor serves others.
```

Fibers são em espaço de usuário: trocar entre elas é uma troca de pilha
dentro do interpretador, sem troca de contexto do kernel e sem repasse de
GVL, e suas pilhas são muito menores e crescem de forma preguiçosa comparadas
à de uma thread do SO. É por isso que "dez mil conexões ociosas" é um número
comum para um servidor de fibers e um número absurdo para um servidor de uma
thread por requisição.

### O modelo de estado muda de thread para fiber

Esse é o detalhe de migração que morde, e decorre diretamente do conceito de
fibers: `Thread.current[]` é local a fiber. Sob o Puma, estado por requisição
armazenado contra a thread funciona porque uma requisição *é* uma thread. Sob
o Falcon, muitas requisições compartilham uma thread, e cada uma é sua
própria fiber, então qualquer coisa indexada por thread agora é compartilhada
entre requisições concorrentes, e qualquer coisa indexada por fiber fica
invisível onde você esperava vê-la.

O Rails aborda isso com um controle explícito:
`ActiveSupport::IsolatedExecutionState` e
`config.active_support.isolation_level`, que um servidor baseado em fibers
define como `:fiber` para que o estado por requisição e o checkout de conexão
do ActiveRecord acompanhem a fiber, não a thread. O corolário é uma questão
de capacidade, não de correção: se cada requisição faz checkout de uma
conexão de banco de dados, então a concorrência é limitada pelo pool de
conexões não importa quantas fibers você consiga criar. Fibers movem o
gargalo; não o eliminam.

### Quando essa é a escolha de engenharia certa

O teste honesto é o formato da carga de trabalho, não a novidade:

- **Sim** quando o tempo de relógio é dominado por esperar em sockets de
  outras pessoas, ou quando a contagem de conexões é alta e a CPU por conexão
  é baixa.
- **Provavelmente não** quando a aplicação é um CRUD Rails comum contra um
  banco de dados local rápido. O pool de threads do Puma já cobre isso, e o
  ecossistema ao redor dele (agentes de APM, profilers, middleware, folclore
  operacional) é muito mais testado em batalha.
- **Não** quando o trabalho é limitado por CPU. Nada aqui cria paralelismo;
  você ainda precisa de processos para usar núcleos, e veja os trade-offs
  abaixo para entender por que trabalho de CPU fica ativamente *pior* sob um
  scheduler cooperativo.

A checagem de pré-requisito é a cadeia de dependências: toda gem no caminho
da requisição precisa ou usar I/O em nível Ruby (que o scheduler intercepta)
ou suportar explicitamente o scheduler. Uma extensão em C que bloqueia em um
socket internamente, sem passar pela camada de I/O do Ruby, bloqueia o
reactor inteiro, não só sua própria requisição. Verifique os drivers dos
quais você depende antes de se comprometer com a arquitetura.

## Trade-offs

- **Cooperativo significa sem preempção, e uma fiber gulosa trava tudo.** Sob
  o Puma, uma requisição fazendo trabalho pesado de CPU é fatiada no tempo
  pela GVL, então outras threads ainda ganham suas vezes. Sob um reactor, uma
  fiber que computa por 200ms sem tocar em I/O simplesmente não cede o
  controle, e toda outra requisição naquele worker espera.
  ```ruby
  Async do
    Async { 50_000_000.times { |i| i * i } }   # no I/O → never yields
    Async { puts "starved until the loop above finishes" }
  end
  ```
- **Fiber-safety é uma barra mais estrita que thread-safety de uma forma
  específica.** Código que armazenava estado de requisição em
  `Thread.current[]` e estava correto sob o Puma não é automaticamente
  correto aqui; a mesma thread agora atende muitas requisições concorrentes.
  Use a configuração de isolamento do framework
  (`config.active_support.isolation_level = :fiber` no Rails) em vez de
  auditar cada ponto de chamada à mão.
- **Unidades de concorrência baratas não criam recursos baratos.** Dez mil
  fibers, cada uma querendo uma conexão de banco de dados, só realoca a fila
  para o pool de conexões, e o mesmo vale para descritores de arquivo,
  limites de taxa upstream, e memória mantida por corpos de requisição em
  voo. Limite o fan-out com `Async::Semaphore` em vez de assumir que o
  reactor vai resolver isso sozinho.
- **Uma única extensão C não integrada pode anular todo o design.** Um driver
  nativo que bloqueia sem cooperar com o scheduler bloqueia a thread do SO,
  o que significa que bloqueia toda outra fiber naquele worker. Isso costuma
  ser o verdadeiro bloqueador para adoção, não o código da aplicação.
- **Isso compra concorrência, nunca paralelismo.** Um único reactor é uma
  única thread rodando Ruby. O Falcon ainda roda múltiplos processos worker
  para usar múltiplos núcleos, exatamente como o Puma em cluster faz.
- **O ecossistema operacional assume threads.** Profilers e agentes de APM
  que atribuem trabalho por thread, middleware que se baseia na identidade da
  thread, e stack traces que param em uma fronteira de fiber ficam todos
  menos úteis. Reserve orçamento para uma observabilidade pior do que o
  caminho do Puma oferece.
- **Adote isso através de um framework, não à mão.** `Fiber.set_scheduler`
  com um scheduler que você mesmo escreveu é uma opção genuína e quase nunca
  a certa. Rodar o Falcon, ou envolver um job em lote em `Async { }`, te dá
  um scheduler testado e uma camada de I/O mantida; um scheduler feito à mão
  te dá uma categoria nova de bug.

## Documentation Links

- [Falcon, um servidor web baseado em fibers para Ruby (GitHub)](https://github.com/socketry/falcon) (doc)
- [Falcon, guia de Getting Started](https://socketry.github.io/falcon/guides/getting-started/index.html) (doc)
- [Fiber, Ruby Core docs (Fiber::Scheduler)](https://docs.ruby-lang.org/en/3.3/Fiber.html) (doc)
- [async, GitHub (socketry)](https://github.com/socketry/async) (doc)
