---
version: 1.0
updatedAt: 2026-08-18
title: "Coordenação de Threads, Mutex e Fibers"
summary: Coletando resultados com join/value, por que a exceção de uma thread espera em silêncio até você dar join nela, Mutex além do synchronize, e o modelo de pausa e retomada cooperativo do Fiber.
---
## Objective

Saber que threads no MRI dão concorrência, mas não paralelismo, é só metade
da história; a outra metade é coordená-las corretamente. Este conceito cobre
as primitivas que você de fato usa quando threads já existem: esperar
resultados com `join` e `value`, estado por thread, a forma como uma exceção
dentro de uma thread desaparece até você coletá-la, `Thread::Mutex` além do
bloco básico `synchronize` (`try_lock` e padrões não bloqueantes), condução de
processos externos do SO, e `Fiber`, corrotinas cooperativas que cedem o
controle só quando o seu próprio código pede.

## Use Cases

- Disparar N chamadas HTTP em threads e coletar seus valores de retorno, não
  só seus efeitos colaterais.
- Depurar uma thread em segundo plano que "silenciosamente não fez nada": a
  exceção foi levantada e engolida, esperando por um `join` que nunca chegou.
- Carregar contexto vinculado à requisição (id da requisição, usuário atual,
  tenant) ao lado de uma thread, sem passá-lo por toda assinatura de método.
- Proteger uma atualização periódica ou uma reconstrução cara para que
  exatamente uma thread faça o trabalho e as demais sigam em frente em vez de
  fazer fila atrás de um lock.
- Executar um comando externo (um script de migração, `ffmpeg`, um linter) e
  decidir entre pipes bloqueantes, não bloqueantes e bidirecionais.
- Gerar uma sequência potencialmente infinita sob demanda, mantendo a lógica
  do produtor separada da lógica do consumidor.

## Deep Dive

### Coletando resultados: `join`, `value` e a armadilha de saída

`Thread#join` bloqueia quem chamou até a thread terminar, e retorna o objeto
da thread. `Thread#value` faz a mesma espera, mas retorna o valor da última
expressão do bloco da thread, o que costuma ser o que você quer quando a
thread está calculando algo em vez de apenas mutar algo.

```ruby
urls = ["https://example.com/a", "https://example.com/b"]

bodies = urls.map { |url| Thread.new(url) { |u| fetch(u) } }.map(&:value)
# => ["...body a...", "...body b..."]
```

`join` aceita um timeout opcional em segundos e retorna `nil` se a thread
ainda estiver rodando quando ele expirar, útil para colocar um teto em uma
retardatária:

```ruby
t = Thread.new { slow_report }
if t.join(5).nil?
  t.kill          # last resort: no unwinding guarantees for the thread's work
  warn "report timed out"
end
```

Sem um `join`/`value` em algum lugar, o processo pode chegar ao fim da thread
principal e sair, levando junto qualquer outra thread em pleno voo. Threads
não são daemonizadas e aguardadas como em algumas outras runtimes; o fim da
thread principal é o fim do programa.

```ruby
Thread.new { sleep 0.1; puts "never printed" }
# main thread ends here → interpreter exits → thread is killed
```

### Exceções dentro de uma thread são adiadas, não perdidas

Uma exceção não tratada em uma thread mata só aquela thread. Threads irmãs e a
thread principal continuam rodando. A exceção é armazenada e relançada no
momento em que você dá `join` (ou pede `value`):

```ruby
t = Thread.new { raise ArgumentError, "bad input" }
sleep 0.1
t.status   # => nil  (terminated with an exception; `false` means finished cleanly)
t.join     # => ArgumentError: bad input, raised *here*, in the main thread
```

Duas configurações mudam esse comportamento:

- `Thread.report_on_exception`: o padrão é `true` desde o Ruby 2.5, então uma
  exceção de thread não tratada ao menos imprime um aviso em `stderr` quando a
  thread morre. Ela só reporta; não interrompe nada. Defina como `false` por
  thread (`t.report_on_exception = false`) quando uma thread *deve mesmo*
  morrer barulhenta.
- `Thread.abort_on_exception = true` (ou rodar com a flag `-d`) escala mais: uma
  exceção não tratada em qualquer thread é relançada na thread principal,
  matando o processo. Existe uma forma por thread também,
  `t.abort_on_exception = true`, para tornar fatal só uma thread crítica.

A regra prática: se você inicia uma thread e nunca a coleta, envolva o corpo
dela em seu próprio `begin/rescue` e registre o log ali. Caso contrário, um
aviso em stderr é o único rastro que você vai ter.

### Armazenamento local a thread vs. local a fiber

O Ruby tem dois repositórios por thread, e a diferença morde em servidores
carregados de fibers:

```ruby
Thread.current[:request_id] = "abc-123"     # fiber-local, despite the name
Thread.current[:request_id]                 # => "abc-123"

Thread.current.thread_variable_set(:request_id, "abc-123")  # truly thread-local
Thread.current.thread_variable_get(:request_id)             # => "abc-123"
```

`Thread.current[]`/`[]=` (e `key?`, `keys`) são **locais a fiber**: uma nova
fiber rodando dentro da mesma thread começa com um repositório vazio e não
consegue ver valores definidos fora dela. `thread_variable_get`/
`thread_variable_set` (e `thread_variables`) ficam ligados à própria thread e
são visíveis de qualquer fiber naquela thread.

```ruby
Thread.current[:tenant] = "acme"
Fiber.new { Thread.current[:tenant] }.resume                    # => nil
Thread.current.thread_variable_set(:tenant, "acme")
Fiber.new { Thread.current.thread_variable_get(:tenant) }.resume # => "acme"
```

Qualquer um dos dois repositórios pode ser lido de fora via o objeto da
thread (`worker[:progress]`), o que os torna úteis para expor o estado de um
worker. No Rails, prefira `ActiveSupport::CurrentAttributes` a mexer nisso
diretamente; ele embrulha a mesma ideia e, importante, se limpa entre
requisições. Armazenamento que nunca é limpo é como um `current_user`
obsoleto vaza para a próxima requisição em uma thread reutilizada.

### Além do `synchronize`: `try_lock` e padrões não bloqueantes

`Thread::Mutex#synchronize` é o padrão certo para "preciso fazer isso com
exclusividade, e estou disposto a esperar." `try_lock` cobre o outro caso: ele
tenta pegar o lock e retorna `true`/`false` imediatamente em vez de bloquear.
Isso transforma uma fila de threads esperando em um único worker mais N
threads que seguem em frente.

```ruby
class CacheRefresher
  def initialize = @lock = Thread::Mutex.new

  # Exactly one thread rebuilds; everyone else keeps serving the stale value.
  def refresh_unless_busy(cache)
    return :busy unless @lock.try_lock

    begin
      cache.rebuild!
      :refreshed
    ensure
      @lock.unlock
    end
  end
end
```

Note o formato: `try_lock` não tem forma com bloco, então **você** é dono do
`unlock`, e ele pertence a um `ensure`; essa é exatamente a garantia que
`synchronize` te dá de graça, o que é o motivo de a forma com bloco continuar
sendo o padrão sempre que bloquear for aceitável.

A mesma primitiva evita o clássico deadlock de dois locks. Quando duas threads
seguram cada uma um lock e querem o lock da outra, elas esperam para sempre;
pegar o segundo lock com `try_lock` deixa uma thread recuar e tentar de novo em
vez disso:

```ruby
def transfer(from, to, amount)
  from.lock.synchronize do
    return :retry_later unless to.lock.try_lock   # back off rather than deadlock

    begin
      from.balance -= amount
      to.balance   += amount
      :ok
    ensure
      to.lock.unlock
    end
  end
end
```

Um `return` de dentro de `synchronize` é seguro (o mutex é liberado na saída),
mas o `try_lock` interno ainda precisa do seu próprio `ensure`. Auxiliares
relacionados: `locked?` (verdadeiro se *qualquer* thread o segurar, uma
checagem de status, nunca um substituto de `try_lock`), `owned?` (verdadeiro
se a thread *atual* o segurar), e `Thread::Mutex#sleep`, que libera o lock
enquanto dorme e o readquire depois, o bloco básico por trás de
`ConditionVariable`.

### Conduzindo processos externos

Threads não são a única forma de concorrência em um programa Ruby; às vezes o
trabalho pertence inteiramente a outro processo do sistema operacional.

```ruby
system("bundle exec rubocop")       # blocks; => true (exit 0), false, or nil (command not found)
$?.exitstatus                       # => 0 / 1 / ...

pid = spawn("ffmpeg -i in.mov out.mp4")   # returns immediately with the PID
# ... do other work ...
Process.wait(pid)                          # block until that child finishes

sha = `git rev-parse HEAD`.strip           # backticks capture stdout as a String

IO.popen("sort", "w+") do |io|             # bidirectional pipe
  io.puts "banana", "apple", "cherry"
  io.close_write                           # signal EOF or `read` hangs forever
  io.read                                  # => "apple\nbanana\ncherry\n"
end
```

Duas coisas que a versão resumida esconde. Primeiro, `system` e `spawn`
aceitam uma lista de argumentos no **estilo array** que ignora completamente o
shell; `system("git", "checkout", branch)` é seguro contra injeção, enquanto
`system("git checkout #{branch}")` entrega `branch` para o `/bin/sh`. Sempre
prefira a forma multi-argumento para qualquer coisa com entrada interpolada.
Segundo, backticks te dão só o stdout; quando você precisa de stdout, stderr e
o status de saída juntos, `Open3.capture3` é a resposta moderna:

```ruby
require "open3"
stdout, stderr, status = Open3.capture3("git", "status", "--porcelain")
```

### Fibers: corrotinas cooperativas

Uma fiber é um bloco de código com sua própria pilha, que pode ser pausado e
retomado. Diferente de threads, fibers **não são preemptivas**: o scheduler
nunca tira o controle de uma fiber em execução. O controle só muda quando a
própria fiber chama `Fiber.yield`, ou quando o mundo externo chama `resume`.

```ruby
fib = Fiber.new do
  a, b = 0, 1
  loop do
    Fiber.yield a
    a, b = b, a + b
  end
end

5.times.map { fib.resume }   # => [0, 1, 1, 2, 3]
fib.alive?                   # => true (an infinite loop never finishes)
```

`resume` retorna o que quer que tenha sido dado a `Fiber.yield`;
simetricamente, o valor passado para `resume` se torna o valor de retorno do
`Fiber.yield` que estava esperando, então o canal é de mão dupla:

```ruby
echo = Fiber.new do |first|
  message = first
  loop { message = Fiber.yield("got: #{message}") }
end

echo.resume("hello")   # => "got: hello"
echo.resume("world")   # => "got: world"
```

Quando o bloco finalmente termina, a fiber está morta; `alive?` retorna
`false` e outro `resume` levanta `FiberError`. É isso que faz das fibers um
encaixe limpo para geradores: a lógica do produtor continua sendo um loop
direto, e o consumidor puxa um valor de cada vez. Dito isso, `Enumerator`
(que é, ele mesmo, construído sobre fibers) é a ferramenta mais idiomática
para o caso de gerador hoje em dia, e `Enumerator::Lazy` lida com sequências
infinitas com menos cerimônia:

```ruby
fibs = Enumerator.new do |y|
  a, b = 0, 1
  loop { y << a; a, b = b, a + b }
end
fibs.lazy.select(&:even?).first(5)   # => [0, 2, 8, 34, 144]
```

Recorra a um `Fiber` bruto quando você precisar da comunicação de mão dupla ou
do controle explícito de pausa/retomada que `Enumerator` não expõe.

### Fibers não bloqueantes (o caminho avançado)

`Fiber.new(blocking: false)` (e seu atalho `Fiber.schedule`) marca uma fiber
como não bloqueante: quando ela encontra I/O bloqueante, o Ruby passa o
controle para um **fiber scheduler** em vez de bloquear a thread, deixando
outra fiber rodar. A pegadinha é que o Ruby traz a *interface*
`Fiber::Scheduler`, mas nenhuma implementação; `Fiber.set_scheduler` precisa
de um objeto scheduler que você instala a partir de uma gem (o ecossistema
`async` é o mais conhecido) ou escreve você mesmo. Sem um, `blocking: false`
não muda nada. Trate isso como um caminho real, mas raramente construído à
mão: você tipicamente o adota adotando um framework que já configurou o
scheduler.

## Trade-offs

- **`value` em vez de `join` quando a thread calcula algo**: `join` retorna a
  thread, então `threads.map(&:join)` te dá um array de objetos `Thread`, uma
  surpresa comum. `threads.map(&:value)` te dá os resultados, e ambos
  relançam a exceção da thread em quem chamou.
- **Uma thread que você nunca coleta é uma thread cujas falhas você nunca
  vê**: `report_on_exception` imprime em stderr, que é invisível na maioria
  das configurações de job em segundo plano. Ou colete a thread, ou envolva o
  corpo dela no seu próprio `rescue` mais log. Ligar o
  `Thread.abort_on_exception` global torna as falhas barulhentas, mas também
  significa que um soluço em segundo plano derruba o processo inteiro; a forma
  por thread costuma ser a escolha mais proporcional.
- **`Thread.current[]` é local a fiber, e essa incompatibilidade é
  silenciosa**: sob um servidor baseado em fibers ou qualquer código pesado em
  `Enumerator`, valores definidos fora de uma fiber simplesmente ficam
  invisíveis dentro dela, sem erro nenhum. Use `thread_variable_get/set`
  quando você realmente quer dizer a thread, e prefira uma abstração de
  framework (`CurrentAttributes`) que também cuide da limpeza.
- **`try_lock` evita bloquear, mas transfere o fardo do unlock para você**: sem
  forma com bloco, não há liberação automática. Um `try_lock` sem um `ensure
  ... unlock` correspondente é um lock vazado na primeira exceção, o que então
  trava todo futuro esperador.
- **`Thread::Mutex` não é reentrante**: uma thread que já segura um mutex e
  chama `synchronize` nele de novo levanta
  `ThreadError: deadlock; recursive locking`. Métodos auxiliares recursivos
  que cada um "defensivamente" trava costumam ser o culpado; trave uma vez na
  borda em vez disso.
  ```ruby
  m = Thread::Mutex.new
  m.synchronize { m.synchronize { } }   # => ThreadError
  ```
- **A forma em string de `system`/backticks roda um shell**: conveniente para
  um comando fixo, um buraco de shell injection no momento em que dados do
  usuário são interpolados. A forma em array (`system("ls", dir)`) não tem
  essa exposição e não custa nada.
- **Fibers são muito mais baratas que threads, mas exigem cooperação**: sem
  disputa por GVL, sem necessidade de locking entre elas já que só uma roda
  por vez, mas uma fiber que faz um trecho longo de trabalho ligado a CPU sem
  ceder o controle faz passar fome em qualquer outra fiber naquela thread. E
  fibers não bloqueantes só compensam depois de um scheduler estar instalado;
  sem um, `blocking: false` não faz nada.

## Documentation Links

- [Thread, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Thread.html) (doc)
- [Thread::Mutex, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Thread/Mutex.html) (doc)
- [Fiber, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Fiber.html) (doc)
- [Programming Ruby 3.3 (Pickaxe), Threads, Fibers, and Ractors](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
