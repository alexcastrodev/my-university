---
version: 1.0
updatedAt: 2026-08-18
title: "Depurando Ruby: a Gem debug e o Pry"
summary: puts vs. p vs. pp, pausando a execução com a gem oficial debug e o rdbg, e o modelo de REPL como navegação do Pry, com show-source para ler a implementação real de uma gem ao vivo.
---
## Objective

A maior parte da depuração em Ruby começa e termina com `puts`, e isso é mais
aceitável do que os puristas admitem, mas `puts`, `p` e `pp` são três
ferramentas diferentes com três regras de saída diferentes, e saber qual usar
economiza uma quantidade surpreendente de confusão. Além da depuração por
impressão, o Ruby traz um depurador oficial (a gem `debug`, acionada por
`binding.break` e pelo comando `rdbg`) que consegue pausar um processo em
execução, percorrê-lo passo a passo, e até se conectar a um programa rodando
dentro do Docker. O Pry é a alternativa de terceiros: não é primariamente um
depurador de passo a passo, mas um REPL completo derrubado dentro do escopo do
seu programa, onde você consegue navegar por objetos como se fossem
diretórios e imprimir o código-fonte de qualquer método ao qual tenha acesso.

## Use Cases

- Escolher rapidamente a chamada de inspeção certa: `p` quando você precisa
  ver se algo é `nil`, a string `"nil"`, ou `:nil`; `pp` quando o objeto é um
  hash profundamente aninhado que `p` imprimiria como uma linha ilegível.
- Pausar uma requisição no meio do caminho em um controller Rails ou em um job
  em segundo plano para inspecionar variáveis locais reais, em vez de adivinhar
  a partir da saída de log.
- Conectar um depurador a um processo que você não iniciou em um terminal (um
  servidor dentro de um container Docker, um worker Sidekiq) via `rdbg --open`
  e `rdbg --attach`.
- Responder "o que esse método está de fato fazendo?" para uma gem que você
  não escreveu, abrindo uma sessão do Pry e rodando `show-source`.
- Descobrir quem chamou o método atual sem parar o programa, usando
  `Kernel#caller`.
- Confirmar de fato que uma otimização é mais rápida com `Benchmark` antes de
  se comprometer com ela.

## Deep Dive

### `puts` vs. `p` vs. `pp` (e `jj`, e `y`)

```ruby
value = nil

puts value       # prints an empty line   (to_s)
p value          # prints: nil            (inspect)

s = "nil"
puts s           # prints: nil
p s              # prints: "nil"
```

`puts` chama `to_s`, a forma legível para humanos, feita para saída de
programa. `p` chama `inspect`, a forma de depuração, que mantém as aspas em
strings, mostra `nil` como `nil`, e renderiza símbolos com seus dois-pontos.
`p` também *retorna* seu argumento, então você pode envolver uma expressão
nele sem mudar o comportamento do código:

```ruby
total = p(subtotal * rate) + shipping
```

`pp` ("pretty print") também usa `inspect`, mas quebra estruturas grandes
aninhadas em várias linhas em vez de emitir uma linha longa só:

```ruby
order = { id: 42, customer: { name: "Ada", address: { city: "London", zip: "E1" } },
          items: [{ sku: "A1", qty: 2 }, { sku: "B7", qty: 1 }] }

p order   # one very long line
pp order  # indented, one nesting level per indent step
```

Mais dois que valem a pena lembrar para hashes e arrays complexos:

```ruby
require "json"
jj order   # formatted JSON

require "yaml"
y order    # YAML
```

`jj` e `y` são úteis quando a estrutura é dado em vez de objetos Ruby; saídas
JSON e YAML costumam ser mais fáceis de escanear do que a saída de `inspect`,
e fáceis de colar em um ticket.

> ⚠️ **Novidade no Ruby 4.0: `instance_variables_to_inspect`.** Toda chamada de
> `p`/`pp` em um objeto passa pelo `inspect` padrão, que despeja toda variável
> de instância, incluindo aquelas que você nunca quis em uma linha de log,
> como um `@password` cru ou um `@token` de API. Sobrescrever `#inspect` por
> completo para consertar isso significa reimplementar toda a lógica de
> formatação dele. `instance_variables_to_inspect` é o conserto mais
> estreito: defina-o para retornar só os símbolos que você quer mostrados, e o
> renderizador padrão faz o resto.
> ```ruby
> class User
>   def initialize(name, password)
>     @full_name = name
>     @first, @last = name.split(" ")
>     @password = password
>   end
>
>   def instance_variables_to_inspect = [:@first, :@last]
> end
>
> p User.new("Jane Smith", "hunter2")
> # => #<User:0x00007f... @first="Jane", @last="Smith">   (@password never appears)
> ```
> Retornar `nil` significa "use o padrão, mostre tudo"; entradas
> desconhecidas ou que não são Symbol são simplesmente ignoradas em vez de
> levantar exceção. O próprio Rails adotou isso na inspeção dos seus modelos,
> substituindo vários overrides de `#inspect` feitos à mão, um sinal de que
> isso é feito para ser a forma normal de fazer isso agora, não um caso de
> borda.

### `Kernel#caller`: a pilha sem um depurador

`caller` retorna a pilha de chamadas atual como um array de strings.
Colocá-la dentro de um método diz a você quem o invocou, o que costuma ser a
pergunta inteira:

```ruby
class Account
  def balance
    puts caller.first(3)   # who is calling this, and from where?
    @balance
  end
end
```

Cada entrada se parece com `"app/models/report.rb:18:in 'Report#totals'"`.
Como é um array comum, você pode filtrá-lo: `caller.grep(/app\//)` corta os
frames do framework e deixa só o seu próprio código.

> ⚠️ **Novidade no Ruby 4.0: backtraces de `ArgumentError` mais claras.** Uma
> linha de backtrace de "número errado de argumentos" costumava nomear só o
> método, deixando você adivinhar a qual classe ele pertencia quando o mesmo
> nome de método existia em várias classes:
> ```
> # Ruby 3.4
> test.rb:1:in 'foo': wrong number of arguments (given 1, expected 2) (ArgumentError)
>
> # Ruby 4.0
> test.rb:1:in 'Object#foo': wrong number of arguments (given 1, expected 2) (ArgumentError)
> ```
> A classe ou módulo do receptor agora faz parte de toda linha assim
> (`Object#foo`, não só `foo`), e frames internos `<internal:...>` são
> filtrados do backtrace por padrão, então a primeira linha que você vê é o
> seu próprio código, não um detalhe de implementação da biblioteca padrão.
> Nenhuma das duas mudanças exige tocar no seu código; você ganha um caminho
> mais curto do stack trace até a causa raiz de graça na atualização.

### A gem `debug`: o depurador oficial do Ruby

O Ruby traz a gem `debug` como uma gem padrão. Ela substituiu a antiga gem de
terceiros `debugger`, descontinuada desde 2015; se um post de blog mandar
você rodar `gem install debugger`, ele está desatualizado.

```ruby
require "debug"

def checkout(cart)
  total = cart.sum(&:price)
  binding.break          # execution stops here, with a prompt on the terminal
  apply_discount(total)
end
```

`binding.break` pausa a execução naquela linha e te entrega um prompt de
depurador com o escopo local completo disponível. Você também pode iniciar um
script sob o depurador sem editá-lo:

```sh
rdbg checkout.rb
```

Para um processo ao qual você não consegue anexar um terminal diretamente
(dentro do Docker, ou um worker em segundo plano), rode-o com um servidor de
depuração aberto e conecte-se a partir de um segundo terminal:

```sh
# terminal 1 (the process being debugged)
rdbg --open checkout.rb

# terminal 2
rdbg --attach
```

### Os comandos que importam

A distinção mais importante é `step` vs. `next`:

- `step` / `s`: entra *dentro* das chamadas de método na linha atual.
- `next` / `n`: executa a linha atual inteira, incluindo qualquer método que
  ela chame, e para na próxima linha do frame *atual*.

Use `next` enquanto você está varrendo um método, e `step` só na chamada que
você de fato suspeita. O resto do conjunto de trabalho:

```
continue / c            run until the next breakpoint (or the end)
break 42                break at line 42 of the current file
break Cart#total        break whenever Cart#total is called
break Cart#total if qty > 10    conditional breakpoint
watch @balance          stop when the instance variable changes
catch ArgumentError     stop wherever that error is raised
eval user.reload.name   evaluate an arbitrary expression in this scope
bt / backtrace          print the call stack
trace call              log every method call from here on
trace exception         log every exception raised
trace line              log every executed line
```

`catch` é o que mais economiza tempo em uma exceção misteriosa: em vez de
ler um backtrace depois do fato, você para no exato momento do `raise` com
todas as variáveis locais ainda vivas.

> ⚠️ `watch @ivar` é poderoso e caro. A documentação oficial descreve esse
> recurso como muito lento; ele precisa checar a variável continuamente.
> Use-o para descobrir *onde* um valor muda, depois remova-o; não deixe um
> armado enquanto você percorre uma execução longa.

### Pry: um REPL onde o seu programa está

Pry é uma gem de terceiros e uma ferramenta diferente de `debug`. Em vez de um
depurador de passo a passo com uma escotilha de escape para avaliação, é um
REPL completo que por acaso abre dentro do seu programa:

```ruby
require "pry"

class Cart
  def total
    binding.pry   # a Pry REPL opens here, with self == this Cart
    @items.sum(&:price)
  end
end
```

Sua característica marcante é a navegação estilo shell Unix por objetos:

```
pry> cd @items.first     # self is now that item
pry> ls                  # variables and methods available here
pry> cd ..                # back up one level
pry> cd /                 # back to the top-level binding
pry> cd -                 # back to where you were before the last cd
```

`cd` de fato muda `self`, então depois de `cd @items.first` você consegue
chamar os métodos daquele objeto de forma nua, sem receptor. `ls` lista o que
está no escopo (variáveis locais, variáveis de instância, e os métodos que o
objeto atual responde), agrupados por onde são definidos.

O comando pelo qual a maioria das pessoas instala o Pry é `show-source`:

```
pry> show-source Cart#total       # the actual Ruby source of the method
pry> show-source ActiveRecord::Base#save
pry> show-doc Array#sum           # its documentation
```

Conseguir ler a implementação real de uma gem de dentro de uma sessão viva,
sem caçar pelo caminho do bundle, é a coisa que o Pry faz que nenhuma outra
ferramenta faz de forma tão fluida. Qualquer coisa prefixada com `.` é
entregue ao shell do sistema operacional, então `.git status` ou `.ls -la`
funcionam sem sair da sessão.

O Pry não faz depuração passo a passo sozinho. A gem complementar
`pry-byebug` adiciona `step`, `next`, `continue` e `finish` a uma sessão do
Pry, te dando o REPL e a execução passo a passo no mesmo lugar.

### `Benchmark`: medindo em vez de adivinhar

```ruby
require "benchmark"

words = File.readlines("/usr/share/dict/words", chomp: true)

Benchmark.bmbm(20) do |x|
  x.report("select + size") { words.select { |w| w.length > 10 }.size }
  x.report("count")         { words.count  { |w| w.length > 10 } }
end
```

`Benchmark.bm(width)` imprime o tempo de CPU do usuário, o tempo de CPU do
sistema, o total deles, e o tempo real (de relógio) decorrido para cada bloco
`report`; `width` é só a largura da coluna de rótulo. `bmbm` roda o conjunto
inteiro **duas vezes** (uma passagem de ensaio, depois a passagem medida),
para que a memória alocada pelo primeiro bloco não esteja ainda sendo
coletada pelo garbage collector enquanto o segundo bloco é cronometrado. A
documentação oficial é explícita ao dizer que isso reduz a distorção em vez
de eliminá-la, então trate uma pequena diferença entre dois relatórios como
ruído, não como um resultado.

## Trade-offs

- **A depuração por impressão não é uma técnica inferior, mas não escala para
  um estado que você não previu**: `p` e `pp` exigem que você já saiba qual
  valor é interessante. Um breakpoint te dá o escopo inteiro de uma vez,
  incluindo a variável que você nem teria pensado em imprimir. O custo é que
  você precisa conseguir alcançar um terminal anexado ao processo, que é
  exatamente o motivo de `rdbg --open` / `--attach` existirem.
- **`debug` e Pry resolvem problemas que se sobrepõem, mas são diferentes**:
  `debug` é o depurador passo a passo oficial e sem dependências, o padrão
  certo para "me guie por essa execução." O Pry é um REPL e navegador de
  código superior (`ls`, `cd`, `show-source`) e a escolha certa para "explique
  esse objeto/essa gem para mim." Adicionar `pry-byebug` te dá os dois, ao
  custo de mais duas gems no grupo `:development`.
- **Um `binding.break` ou `binding.pry` esquecido vai travar a produção**: o
  processo para e espera silenciosamente por uma entrada que nunca chega.
  Mantenha as duas gems fora do grupo de produção, e deixe um linter (o cop
  `Lint/Debugger` do RuboCop) falhar a build em um breakpoint commitado.
- **`watch` e `trace` compram visibilidade com uma lentidão grande**:
  `watch @ivar` é documentado como muito lento, e `trace line` registra cada
  linha executada. Ambos são excelentes para restringir um mistério específico
  e terríveis como configuração permanente.
- **Números de Benchmark são ruidosos por construção**: o GC, o escalonador
  do sistema operacional e o aquecimento do JIT tudo cai dentro da sua
  medição. `bmbm` atenua a parte do GC e nada atenua o resto, então prefira
  diferenças grandes e execuções repetidas a um resultado apertado único.

## Documentation Links

- [Programming Ruby 3.3 (Pickaxe), Debugging Ruby](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
- [ruby/debug, o depurador oficial do Ruby](https://github.com/ruby/debug) (doc)
- [pry/pry, uma alternativa ao IRB e console de desenvolvedor em tempo de execução](https://github.com/pry/pry) (doc)
- [deivid-rodriguez/pry-byebug, depuração passo a passo para o Pry](https://github.com/deivid-rodriguez/pry-byebug) (doc)
- [Kernel, Ruby Core docs (p, pp, caller)](https://docs.ruby-lang.org/en/3.3/Kernel.html) (doc)
- [Benchmark, Ruby Standard Library docs](https://docs.ruby-lang.org/en/3.3/Benchmark.html) (doc)
- [Ruby 4.0.0 Released, ruby-lang.org](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) (doc)
