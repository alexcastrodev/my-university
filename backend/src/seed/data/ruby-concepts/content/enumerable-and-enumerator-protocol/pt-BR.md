---
version: 1.0
updatedAt: 2026-08-18
title: "O Protocolo Enumerable e Enumerator"
summary: Implemente each e ganhe map/select/reduce de graça via Enumerable, depois conduza sequências de fora com Enumerator, iteração externa, geradores customizados, e .lazy para pipelines infinitos.
---
## Objective

O poder de coleção do Ruby vem de um protocolo com duas metades fáceis de
confundir. `Enumerable` é um **módulo** que você mistura na sua própria
classe: defina `each` e você herda cerca de cem métodos (`map`, `select`,
`reduce`, `sort_by`, `group_by`, `partition`, `tally`, `zip`, `all?`) de
graça. `Enumerator` é uma **classe**: um objeto que representa uma sequência
que você pode conduzir de fora com `next`/`peek`/`rewind`, construir à mão
com um yielder, gerar infinitamente com `produce`, ou tornar lazy para que um
pipeline encadeado puxe um elemento de cada vez em vez de materializar cada
array intermediário.

## Use Cases

- Fazer uma classe de domínio (uma playlist, um cliente de API paginado, um
  arquivo de log parseado) se comportar como uma coleção de primeira classe
  implementando um único `each`.
- Percorrer duas sequências em passo sincronizado, onde nenhuma delas conduz a
  outra e `zip` não é suficiente porque você precisa avançá-las
  independentemente.
- Modelar uma sequência ilimitada (um gerador de IDs, uma série de Fibonacci
  ou triangular, um cursor paginado que continua buscando) como um objeto em
  vez de um loop `while` com estado mutável.
- Filtrar uma fonte enorme ou infinita com `.lazy` para que só os elementos
  que o consumidor de fato pede acabem sendo calculados.
- Escrever seu próprio método que recebe bloco e se comporta como um método do
  core: retornando um `Enumerator` quando chamado sem bloco, para que
  chamadores possam encadear `.with_index` ou `.lazy` nele.

## Deep Dive

### `Enumerable`: defina `each`, ganhe todo o resto

```ruby
class Playlist
  include Enumerable

  Track = Struct.new(:title, :artist, :seconds)

  def initialize(tracks)
    @tracks = tracks
  end

  def each
    return to_enum(:each) { @tracks.size } unless block_given?
    @tracks.each { |track| yield track }
    self
  end
end

playlist = Playlist.new([
  Playlist::Track.new("Kid A",        "Radiohead", 264),
  Playlist::Track.new("Idioteque",    "Radiohead", 289),
  Playlist::Track.new("Teardrop",     "Massive Attack", 330)
])

playlist.map(&:title)                      # => ["Kid A", "Idioteque", "Teardrop"]
playlist.select { |t| t.seconds > 280 }    # => [Idioteque, Teardrop]
playlist.sum(&:seconds)                    # => 883
playlist.min_by(&:seconds).title           # => "Kid A"
playlist.group_by(&:artist).keys           # => ["Radiohead", "Massive Attack"]
playlist.partition { |t| t.seconds < 300 } # => [[Kid A, Idioteque], [Teardrop]]
playlist.map(&:artist).tally               # => {"Radiohead" => 2, "Massive Attack" => 1}
playlist.each_slice(2).to_a.size           # => 2
```

Nenhum desses métodos foi escrito à mão. `Enumerable` implementa todos eles
em termos de `each`, e é por isso que é o mixin de maior alavancagem na
biblioteca padrão, e por isso que `Range`, `Dir`, `ENV`, `IO`/`File`, `CSV` e
`Struct` todos suportam o mesmo vocabulário: cada um deles implementa `each`
e inclui o módulo.

Dois métodos precisam de um pouco mais que `each`. `sort`, `min`, `max`, o
desempate de `sort_by`, e `include?` comparam elementos com `<=>` e `==`,
então os elementos precisam ser mutuamente comparáveis (ou você passa um
bloco: `sort_by(&:seconds)` é ao mesmo tempo mais idiomático e mais rápido do
que `sort { |a, b| a.seconds <=> b.seconds }` ao ordenar por um atributo).

A linha `return to_enum(:each) { @tracks.size } unless block_given?` é a
convenção que toda coleção do core segue: chamado sem bloco, um método de
enumeração devolve um `Enumerator` em vez de não fazer nada. O bloco opcional
passado a `to_enum` fornece um `size` calculado de forma preguiçosa, então
`playlist.each.size` responde sem iterar.

### `Enumerator` (a classe) vs `Enumerable` (o módulo)

Eles não são variantes da mesma coisa. `Enumerable` é um conjunto de métodos
que sua classe adquire. `Enumerator` é um objeto independente que guarda uma
*posição* em uma sequência, um iterador externo. Ele também inclui
`Enumerable`, e é por isso que um Enumerator responde ele mesmo a `map`,
`select` e companhia.

`to_enum` / `enum_for` constroem um a partir de **qualquer** método que
aceite bloco, não só `each`:

```ruby
enum = "hello world".to_enum(:scan, /\w+/)
enum.next   # => "hello"
enum.next   # => "world"

# and any core method called without a block already returns one:
[10, 20, 30].each          # => #<Enumerator: [10, 20, 30]:each>
"cat".each_char.with_index.to_a  # => [["c", 0], ["a", 1], ["t", 2]]
```

Essa regra de "sem bloco significa Enumerator" é exatamente o que faz
`each_char.with_index`, `map.with_index` e `each_with_object` encadearem: a
primeira chamada retorna um objeto, e a segunda chamada o decora.

### Iteração externa: `next`, `peek`, `rewind` e `loop`

```ruby
e = [1, 2, 3].each
e.next    # => 1
e.peek    # => 2   (looks ahead without advancing)
e.next    # => 2
e.rewind
e.next    # => 1
```

O ganho é conduzir duas sequências independentemente, algo que nenhum
iterador interno consegue fazer, porque `each` é dono do loop:

```ruby
names  = %w[ada grace alan turing].each
scores = [95, 88, 72].each

loop do
  puts "#{names.next}: #{scores.next}"
end
# ada: 95
# grace: 88
# alan: 72
# (exits cleanly, "turing" is never consumed)
```

Quando um Enumerator se esgota, `next` levanta `StopIteration`.
`Kernel#loop` captura essa exceção especificamente e retorna normalmente, e é
por isso que o código acima não precisa de nenhuma checagem de limite nem de
`break`. Qualquer outro loop `while`/`until` propagaria a exceção.

### Construindo um Enumerator à mão

```ruby
triangular = Enumerator.new do |yielder|
  total = 0
  n = 1
  loop do
    total += n
    yielder.yield total
    n += 1
  end
end

triangular.take(6)   # => [1, 3, 6, 10, 15, 21]
triangular.next      # => 1
triangular.next      # => 3
```

O bloco contém um loop infinito, mas ainda assim `take(6)` retorna.
`yielder.yield` suspende a execução do bloco (o MRI implementa isso com uma
Fiber) e a retoma só quando o consumidor pede outro valor. O gerador é
escrito como se rodasse para sempre; o consumidor decide quando ele para.

Para o caso comum ("o próximo valor é uma função pura do anterior"),
`Enumerator.produce` diz a mesma coisa em uma linha:

```ruby
Enumerator.produce(1) { |n| n * 2 }.take(5)          # => [1, 2, 4, 8, 16]
Enumerator.produce(Time.now) { |t| t + 86_400 }.first(3)  # today, tomorrow, next day
```

A semente é entregue primeiro, depois o bloco é aplicado repetidamente. Se o
bloco levantar `StopIteration`, a sequência termina ali, útil para percorrer
uma cadeia (ponteiros de pai, cursores paginados) que eventualmente se
esgota.

### `.lazy`: reestruture o pipeline, não só o atrase

Métodos Enumerable encadeados são avaliados de forma ávida: cada etapa roda
até o fim sobre a coleção inteira e constrói um array intermediário completo
antes de a próxima etapa começar.

```ruby
(1..5).map    { |n| print "map #{n} "; n * 2 }
      .select { |n| print "sel #{n} "; n > 4 }
# map 1 map 2 map 3 map 4 map 5 sel 2 sel 4 sel 6 sel 8 sel 10
# => [6, 8, 10]
```

`.lazy` transforma isso em um fluxo elemento por elemento por todo o
pipeline, conduzido pela demanda a partir do final:

```ruby
(1..5).lazy.map    { |n| print "map #{n} "; n * 2 }
           .select { |n| print "sel #{n} "; n > 4 }
           .first(2)
# map 1 sel 2 map 2 sel 4 map 3 sel 6 map 4 sel 8
# => [6, 8]
```

Os mesmos blocos, o mesmo prefixo de resultado, uma ordem de execução
completamente diferente, e o elemento 5 nem chega a ser tocado. Essa
propriedade é o que torna fontes infinitas utilizáveis:

```ruby
Enumerator.produce(1) { |n| n + 1 }
  .lazy
  .map    { |n| n * n }
  .select { |n| n % 3 == 0 }
  .first(3)              # => [9, 36, 81]
```

Sem `.lazy`, um `select` sobre um produtor infinito nunca retorna; ele tenta
construir primeiro a coleção filtrada completa.

Uma cadeia lazy continua lazy até uma operação terminal forçá-la: `first(n)`,
`take(n).force`, `to_a`, `reduce`, `include?`. `force` é só um apelido para
`to_a` que lê melhor no final de uma cadeia. E `.eager` converte um
`Enumerator::Lazy` de volta em um enumerator normal, então os métodos
seguintes voltam a ser avaliados de forma ávida:

```ruby
lazy_chain = (1..Float::INFINITY).lazy.map { |n| n * 2 }
lazy_chain.class            # => Enumerator::Lazy
lazy_chain.first(3)         # => [2, 4, 6]
lazy_chain.eager.class      # => Enumerator
(1..10).lazy.select(&:even?).force  # => [2, 4, 6, 8, 10]
```

## Trade-offs

- **Enumerable te dá cerca de 100 métodos, mas todos retornam `Array`, nunca
  sua classe**: `playlist.select { ... }` devolve um Array comum de faixas,
  não uma `Playlist`. Se o encadeamento deve preservar seu tipo, você precisa
  sobrescrever o punhado de métodos que importam (ou embrulhar o resultado
  você mesmo); o Ruby não tem um equivalente de "construtor de coleção" que o
  Enumerable possa consultar.
- **As implementações do Enumerable são genéricas, então são lineares mesmo
  quando sua classe poderia fazer melhor**: `include?` percorre cada elemento
  via `each`, que é o padrão certo, mas é O(n) em uma classe que tem um
  índice de hash internamente. Sobrescrever `include?`, `size`, ou `min`/`max`
  com uma versão especializada é normal e esperado; você mantém o resto do
  mixin.
- **Iteração externa (`next`/`peek`) é bem mais cara que iteração interna**: o
  MRI a apoia com uma Fiber, então cada `next` é uma troca de contexto. Use-a
  quando você genuinamente precisa de controle independente de duas
  sequências, não como um loop de uso geral:
  ```ruby
  # internal: one pass, no fiber
  arr.each { |x| use(x) }
  # external: a fiber switch per element
  e = arr.each
  loop { use(e.next) }
  ```
- **`.lazy` é um ganho para fontes infinitas, enormes, ou caras por elemento,
  e uma perda para as pequenas**: cada etapa adiciona uma indireção de
  chamada de bloco por elemento, então uma cadeia lazy sobre um array de 20
  itens é mensuravelmente mais lenta que a versão ávida. Use-a quando o
  pipeline de outra forma calcularia valores que ninguém lê, ou alocaria
  arrays intermediários que você não pode se dar ao luxo (veja o conceito de
  Memória, GC e Fragmentação para o motivo desses intermediários importarem).
- **Uma cadeia lazy que nunca é forçada parece que não fez nada**: sem saída,
  sem erro, sem efeitos colaterais, porque nenhum dos blocos jamais rodou.
  Esquecer o `first(n)`/`force`/`to_a` terminal é o bug característico de
  `Enumerator::Lazy`, e ele falha silenciosamente em vez de levantar exceção.

## Documentation Links

- [Enumerable, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Enumerable.html) (doc)
- [Enumerator, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Enumerator.html) (doc)
- [Enumerator::Lazy, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Enumerator/Lazy.html) (doc)
- [Programming Ruby 3.3 (Pickaxe), Collections, Blocks, and Iterators](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
