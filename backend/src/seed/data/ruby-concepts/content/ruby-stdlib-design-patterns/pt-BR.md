---
version: 1.0
updatedAt: 2026-08-18
title: "Padrões de Projeto Embutidos na Biblioteca Padrão do Ruby"
summary: Decorator, Observer e Singleton já vêm com o Ruby como delegate, observer e singleton, mas a maioria das bases de código reimplementa os três à mão. SimpleDelegator encaminha tudo que você não sobrescreveu (e permite trocar o alvo), DelegateClass(Array) é composição onde você teria feito subclasse de Array, e Singleton fecha os vazamentos de dup/clone/Marshal mais a corrida de thread que um @instance ||= new feito à mão sempre deixa passar.
---
## Objective

Três dos padrões Gang of Four que desenvolvedores Ruby mais reimplementam à
mão (Decorator, Observer e Singleton) já vêm com o Ruby, testados e
mantidos, em `delegate`, `observer` e `singleton`. Quase toda base de código
que cresceu além de alguns milhares de linhas contém uma classe wrapper
encaminhando duas dezenas de métodos com `def_delegator` feito à mão, um
array `@observers = []` com um loop `notify`, e um bloco `class << self; def
instance; @instance ||= new; end; end` que vaza uma segunda instância
através de `dup`. `SimpleDelegator`, `Observable` e `Singleton` são as
versões que alguém já escreveu corretamente, incluindo os casos de borda que
as versões feitas à mão esquecem. O objetivo aqui não é aprender um padrão;
é reconhecer o momento em que você está prestes a reimplementar um que já
está disponível via `require`.

## Use Cases

- Envolver um objeto para adicionar auditoria, cache, ou formatação *sem*
  tocar em sua classe ou em seus chamadores; `SimpleDelegator` encaminha
  tudo que você não sobrescreveu.
- Trocar o alvo envolvido em tempo de execução (`__setobj__`) para que uma
  instância decoradora consiga seguir um objeto que se move: uma conexão que
  reconecta, um registro que é recarregado.
- Construir um tipo de coleção com um invariante (sempre ordenado, sempre
  único, sempre limitado) via `DelegateClass(Array)` em vez de fazer
  subclasse de `Array` e herdar uma centena de métodos que você nunca
  auditou.
- Deixar vários objetos não relacionados reagirem a uma mudança de estado
  (log de auditoria, invalidação de cache, alertas) sem o publicador segurar
  um `require` de nenhum deles (`Observable`).
- Garantir exatamente uma instância de um carregador de configuração, um
  registro de feature flags, ou um pool de conexões, de forma thread-safe,
  sem escrever o double-checked locking você mesmo (`Singleton`).

## Deep Dive

### `SimpleDelegator`: Decorator sem boilerplate

`SimpleDelegator` é uma classe cujo trabalho inteiro é "ser outra pessoa".
Faça subclasse dela, passe o objeto real para `new`, e toda mensagem que
você *não* definiu é encaminhada para aquele objeto:

```ruby
require "delegate"

class Invoice
  attr_reader :number, :cents

  def initialize(number, cents)
    @number = number
    @cents  = cents
  end

  def total = cents / 100.0
  def to_s  = "Invoice #{number} (#{format('%.2f', total)})"
end

class AuditedInvoice < SimpleDelegator
  def initialize(invoice, log)
    super(invoice)      # sets the delegation target
    @log = log
  end

  def total
    @log << "read total of #{number}"   # `number` already delegates
    super                               # `super` reaches Invoice#total
  end
end
```

```ruby
log = []
inv = AuditedInvoice.new(Invoice.new("A-1", 12_50), log)

inv.total    # => 12.5   — our override, which logged first
inv.number   # => "A-1"  — forwarded, we never defined it
inv.cents    # => 1250   — forwarded
inv.to_s     # => "Invoice A-1 (12.50)" — forwarded
log          # => ["read total of A-1"]
```

Dois detalhes tornam isso mais do que açúcar sintático. Primeiro, `super`
dentro de um método sobrescrito alcança a implementação do *objeto
envolvido*, mesmo que `Invoice` não apareça em nenhum lugar da ancestralidade
de `AuditedInvoice`; `Delegator` implementa isso através de
`method_missing`, então um `super` sem correspondência cai no alvo em vez de
levantar exceção. Segundo, o alvo é trocável:

```ruby
inv.__getobj__            # => the Invoice instance
inv.__setobj__(Invoice.new("A-2", 999))
inv.number                # => "A-2"
inv.total                 # => 9.99, and the log grew again
```

O decorador sobreviveu à troca. Isso é algo que herança não consegue fazer.

A pegadinha de identidade vale a pena decorar: um delegator *não é* seu
alvo.

```ruby
inv.class            # => AuditedInvoice
inv.is_a?(Invoice)   # => false
inv.respond_to?(:number) # => true — Delegator overrides respond_to? properly
```

Código que despacha em `is_a?` não vai enxergar através do wrapper; código
que faz duck typing em `respond_to?` vai. Esse é mais um motivo de o
conselho do capítulo de duck typing ("pergunte o que faz, não o que é")
compensar; decoradores são exatamente os objetos em que checagens de classe
quebram.

### `DelegateClass(Array)`: composição onde você recorreria a herança

`DelegateClass(AlgumaClasse)` retorna uma classe totalmente nova que
encaminha os métodos de instância públicos de `AlgumaClasse` para um alvo
que você entrega via `super` em `initialize`:

```ruby
require "delegate"

class SortedList < DelegateClass(Array)
  def initialize(items = [])
    @items = items.sort
    super(@items)          # @items is the delegation target
  end

  def <<(item)
    @items << item
    @items.sort!
    self
  end

  def push(*) = raise(NoMethodError, "use #<< so the list stays sorted")
end
```

```ruby
list = SortedList.new([3, 1, 2])
list.to_a          # => [1, 2, 3]
list << 0
list.to_a          # => [0, 1, 2, 3]
list.first         # => 0    — Array's method, on our target
list.include?(2)   # => true
list.sum           # => 6
list.map { _1 * 10 }        # => [0, 10, 20, 30] (a plain Array)
list.push(9)       # NoMethodError: use #<< so the list stays sorted
```

Isso é "quase o mesmo que `class SortedList < Array`", com três diferenças
que importam.

**Você escolhe o que fica exposto, explicitamente.** Com herança, todo
método público atual e *futuro* de `Array` faz parte da API da sua classe
por padrão, incluindo `replace`, `fill`, `unshift`, e `[]=`, cada um dos
quais pode quebrar o invariante de ordenação. Com `DelegateClass` o conjunto
encaminhado ainda é amplo, mas o corpo da sua classe é o único lugar que
decide as sobrescritas, e definir um método que levanta exceção de fato o
remove da API. (`undef_method` *não* funciona aqui: indefinir um método em
um delegator só roteia a chamada para `method_missing`, que a encaminha para
o alvo de qualquer forma. Defina um método que levanta exceção em vez
disso.) Quando você quer uma lista de permissão estrita em vez de "tudo",
`Forwardable` e `def_delegators` são a ferramenta certa; mesma família de
arquivo, padrão oposto.

**Você não fica preso aos internos de `Array`.** Classes do core são
implementadas em C e seus métodos se chamam entre si por caminhos em C, não
através de suas sobrescritas Ruby, então a sobrescrita de uma subclasse é
silenciosamente pulada por código que você nunca vê. Desde o Ruby 3.0 a
situação ficou mais estranha, não melhor: métodos de subclasse de `Array`
retornam `Array`s comuns, então herdar te dá menos do que costumava dar.

```ruby
class BadList < Array
  def <<(x) = (super; sort!; self)
end

b = BadList.new
b << 3
b << 1                    # => [1, 3]  — our override ran
b.push(0)                 # => [1, 3, 0] — bypassed it entirely
(b + [9]).class           # => Array   — not BadList
b.select { _1 > 1 }.class # => Array   — not BadList
```

**Seu tipo continua seu.** `SortedList` não é um `Array`, então nada
downstream o confunde com um e o muta através de um caminho exclusivo de
`Array`. Onde você *de fato* quer comportamento de array, ele ainda está lá
através do `to_ary` delegado, então splats e desestruturação continuam
funcionando:

```ruby
[*list]          # => [0, 1, 2, 3]
a, b = list      # a => 0, b => 1
list.is_a?(Array) # => false
```

Essa combinação (se comporta como um `Array` nos pontos de chamada que
perguntam educadamente, não é um nos pontos de chamada que checam) é o
argumento prático para composição sobre herança em Ruby, e `DelegateClass`
é a forma de duas palavras de conseguir isso.

### `Observable`: o padrão Observer, e a flag `changed`

`require "observer"` te dá um mixin. `include Observable` no publicador;
observadores são quaisquer objetos que respondem a `update`:

```ruby
require "observer"

class Ticker
  include Observable

  def initialize(symbol)
    @symbol = symbol
    @price  = nil
  end

  def price=(new_price)
    return if new_price == @price
    @price = new_price
    changed                                     # 1. mark "I changed"
    notify_observers(@symbol, new_price, Time.now)  # 2. fire update on everyone
  end
end

class Alarm
  def initialize(limit) = @limit = limit

  def update(symbol, price, _at)
    puts "ALARM: #{symbol} at #{price} (limit #{@limit})" if price < @limit
  end
end

class AuditLog
  def initialize = @entries = []
  attr_reader :entries

  def update(symbol, price, _at) = @entries << [symbol, price]
end
```

```ruby
log    = AuditLog.new
ticker = Ticker.new("AAPL")
ticker.add_observer(Alarm.new(180))
ticker.add_observer(log)
ticker.count_observers   # => 2

ticker.price = 190       # (no alarm — above the limit)
ticker.price = 175       # prints: ALARM: AAPL at 175 (limit 180)
log.entries              # => [["AAPL", 190], ["AAPL", 175]]
```

`Ticker` não sabe nada sobre alarmes ou logs de auditoria. Ele sabe dizer
"eu mudei, aqui está para quem." Esse é o ponto inteiro do padrão, e aqui
custa um `include` e duas chamadas de método.

**A flag `changed` é o bug clássico.** `notify_observers` não faz nada a
menos que `changed` tenha sido chamado desde a última notificação, e ele
*reseta a flag na saída*. Os dois lados mordem:

```ruby
class Broken
  include Observable

  def fire(v)
    notify_observers(v)     # no `changed` first — silently does nothing
  end

  def fire_twice(v)
    changed
    notify_observers(v)     # runs
    notify_observers(v)     # flag already reset — silently does nothing
  end
end
```

Sem exceção, sem aviso: os observadores simplesmente não rodam. Quando um
bug de pub/sub aparece relatado como "o callback disparou uma vez em vez de
duas" ou "o callback nunca dispara", um `changed` faltando é a primeira
coisa a checar. Você pode inspecionar e controlar a flag diretamente:
`changed?` a lê, `changed(false)` a limpa, que é como você aborta uma
notificação no meio da computação.

Duas facilidades menores: `add_observer` recebe um segundo argumento para
usar um nome de callback diferente, e valida com antecedência.

```ruby
ticker.add_observer(handler, :on_price_change)  # calls handler.on_price_change
ticker.add_observer(Object.new)
# NoMethodError: observer does not respond to `update'
```

Também úteis: `delete_observer(obj)`, `delete_observers`,
`count_observers`. Note que a notificação é síncrona e em processo: cada
`update` roda na thread do chamador antes de `price=` retornar. `Observable`
é uma ferramenta de coordenação em memória, não uma fila de mensagens.

### `Singleton`: o idioma feito à mão, feito direito

`include Singleton` torna `new` e `allocate` privados e adiciona
`.instance`:

```ruby
require "singleton"

class FeatureFlags
  include Singleton

  def initialize
    # runs exactly once, lazily, on the first .instance call
    @flags = JSON.parse(File.read("config/flags.json"))
  end

  def enabled?(name) = @flags.fetch(name, false)
  def enable(name)   = @flags[name] = true
end
```

```ruby
FeatureFlags.instance.equal?(FeatureFlags.instance)  # => true
FeatureFlags.instance.enable("dark_mode")
FeatureFlags.instance.enabled?("dark_mode")          # => true

FeatureFlags.new    # NoMethodError: private method 'new' called for class FeatureFlags
```

A parte interessante é tudo que ele fecha além de `new`. Um singleton feito
à mão geralmente parece com isto, e o conceito `self-and-singleton-classes`
desta plataforma cobre o mecanismo `class << self` em profundidade, então
trate-o como já conhecido aqui:

```ruby
class HandRolled
  class << self
    def instance = @instance ||= new
  end
end
```

Funcionalmente a mesma ideia: `@instance` é uma ivar no objeto classe,
memoizada por `||=`. Mas compare as brechas:

```ruby
# hand-rolled
HandRolled.new.equal?(HandRolled.instance)             # => false — `new` is public
HandRolled.instance.dup.equal?(HandRolled.instance)    # => false — a second instance
HandRolled.instance.clone.equal?(HandRolled.instance)  # => false
Marshal.load(Marshal.dump(HandRolled.instance))
  .equal?(HandRolled.instance)                         # => false

# stdlib Singleton
FeatureFlags.instance.dup    # TypeError: can't dup instance of singleton FeatureFlags
FeatureFlags.instance.clone  # TypeError: can't clone instance of singleton FeatureFlags
Marshal.load(Marshal.dump(FeatureFlags.instance))
  .equal?(FeatureFlags.instance)                       # => true
```

`Singleton` define `dup` e `clone` para levantar exceção, e define
`_dump`/`_load` para que um round-trip de Marshal retorne o *mesmo* objeto
em vez de uma cópia, um vazamento real em qualquer coisa que armazena em
cache ou serializa objetos. Herança também é tratada: uma subclasse não
compartilha nem duplica a instância do pai, ela ganha a sua própria, ainda
com `new` privado.

```ruby
class Base; include Singleton; end
class Sub < Base; end

Base.instance.equal?(Sub.instance)  # => false — Sub has its own
Sub.new                             # NoMethodError — still private
```

E o que de fato importa em um servidor com threads: `Singleton.instance` é
protegido por mutex com um double-checked lock, então duas threads
competindo no primeiro acesso recebem o mesmo objeto. O `@instance ||= new`
feito à mão é uma leitura, um branch, e uma escrita sem nenhuma
sincronização; duas threads podem ambas ver `nil` e ambas chamar `new`, e se
`initialize` for lenta (carregando um arquivo, abrindo uma conexão), essa
corrida não é teórica.

> ℹ️ **Livro vs. hoje:** o Pickaxe cobre o Ruby 3.3. O Ruby 3.4 adicionou
> `RactorLocalSingleton` ao lado de `Singleton` no mesmo arquivo, mesma API
> (`include RactorLocalSingleton`, depois `.instance`), mas a instância é
> por Ractor em vez de por processo, já que um singleton mutável em todo o
> processo é exatamente o que o isolamento de Ractor proíbe.

## Trade-offs

- **Um delegator ganha transparência e perde identidade**: tudo encaminha,
  mas `is_a?` e `case/when` veem o wrapper, não o alvo, e um backtrace
  através de `method_missing` fica um frame mais longe do código real.
  Envolver é a escolha certa quando os chamadores fazem duck typing; é uma
  armadilha em uma base de código que despacha por classe.
- **O encaminhamento via `method_missing` custa uma falha de busca em cada
  chamada delegada**: tudo bem para um decorador em torno de objetos de
  negócio, mensurável se você envolve uma coleção quente e chama através
  dela em um loop apertado. `def_delegators` do `Forwardable` gera métodos
  reais e evita esse custo, ao preço de listar cada método que você quer.
- **`DelegateClass` te dá composição, mas não encapsulamento por padrão**:
  ele encaminha toda a API pública, então "eu só queria `each` e `<<`" ainda
  significa que todo método de `Array` é chamável até você sobrescrevê-lo
  para levantar exceção. Se a lista de permissão é curta, `Forwardable` diz
  o que você quer dizer; se é longa, `DelegateClass` diz.
- **`Observable` desacopla o publicador e esconde o custo**: o publicador
  para de conhecer seus consumidores, que é o ganho, mas cada `update` roda
  sincronamente na thread do publicador, exceções de um observador abortam
  o resto da notificação, e a ordem é a ordem de registro. Para qualquer
  coisa lenta ou propensa a falha, o observador deveria enfileirar, não
  trabalhar.
- **A flag `changed` falha silenciosamente nas duas direções**: esqueça-a e
  nada dispara; chame `notify_observers` duas vezes e só o primeiro roda.
  Não há aviso, então o modo de falha é um efeito colateral faltando
  descoberto bem mais tarde em vez de uma exceção no ponto de chamada.
- **`Singleton` é uma implementação correta de um padrão que costuma ser a
  escolha errada**: é estado global mutável com um nome mais bonito, difícil
  de substituir em testes, dependente de ordem no boot, e compartilhado por
  tudo no processo. Recorra a ele quando a instância única for genuinamente
  uma propriedade do processo (um registro de configuração, um pool de
  conexões); passe uma instância explicitamente quando não for. Sua
  verdadeira vantagem sobre a versão feita à mão é segurança de thread e os
  caminhos fechados de `dup`/`clone`/`Marshal`, não o padrão em si.

## Documentation Links

- [Delegator, SimpleDelegator, DelegateClass, Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/Delegator.html) (doc)
- [Observable, Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/Observable.html) (doc)
- [Singleton, Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/Singleton.html) (doc)
- [Forwardable, Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/Forwardable.html) (doc)
- [Programming Ruby 3.3 (Pickaxe), Ruby on Ruby](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
- [Ruby 3.4.0 Released, ruby-lang.org](https://www.ruby-lang.org/en/news/2024/12/25/ruby-3-4-0-released/) (doc)
