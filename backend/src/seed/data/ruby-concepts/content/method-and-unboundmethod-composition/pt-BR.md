---
version: 1.0
updatedAt: 2026-08-18
title: "Method e UnboundMethod: Objetos, Não Só Chamadas"
summary: obj.method(:name) te entrega um valor chamável que você pode compor com >> e <<, curry, e inspecionar; unbind remove o receptor para que a implementação de um módulo possa ser bind_call'd em um objeto que nunca o incluiu.
---
## Objective

`obj.method(:name)` não chama nada. Ele te entrega um objeto `Method`: o
próprio método, empacotado como um valor que você pode guardar em uma
variável, colocar em um hash, passar para `map`, compor com outros métodos,
fazer curry, ou interrogar sobre sua aridade e localização de origem.
`Class.instance_method(:name)` te dá a outra metade do par: um
`UnboundMethod`, a mesma implementação com o receptor removido, que você pode
depois `bind`ar em algum *outro* objeto. Juntos, eles transformam o despacho
de método (normalmente um evento que acontece e desaparece) em um objeto que
você pode segurar. Essa é a diferença entre "eu consigo chamar esse método" e
"eu tenho esse método".

## Use Cases

- Construir um pequeno pipeline de transformação a partir de métodos já
  existentes com `>>` em vez de embrulhar cada um em uma lambda: `strip >>
  squish >> truncate`.
- Passar um método existente onde um bloco é esperado, sem redigitar seu
  corpo: `rows.map(&method(:parse_row))`.
- Armazenar uma tabela de despacho de objetos `Method` (`{ csv:
  exporter.method(:to_csv) }`) para que o handler seja resolvido uma vez e
  invocado muitas vezes.
- Fazer curry de um método com vários argumentos em um parcialmente
  aplicado, fixando o primeiro argumento agora e fornecendo o resto em cada
  ponto de chamada depois.
- Perguntar a um método quantos argumentos ele quer (`arity`) ou qual o
  formato deles (`parameters`) antes de invocá-lo dinamicamente.
- Reutilizar a implementação de um método de um módulo em um objeto que não
  inclui aquele módulo, via `UnboundMethod#bind_call`.
- Recuperar uma implementação original (`Kernel#inspect`) de um objeto cuja
  classe a sobrescreveu, o truque do qual depuradores e pretty-printers
  dependem.

## Deep Dive

### Um `Method` é um valor com um receptor já anexado

```ruby
class TextPipeline
  def strip_tags(html) = html.gsub(/<[^>]+>/, "")
  def squish(text)     = text.strip.gsub(/\s+/, " ")
  def truncate(text)   = text.length > 20 ? "#{text[0, 17]}..." : text
end

pipe  = TextPipeline.new
strip = pipe.method(:strip_tags)

strip.class    # => Method
strip.receiver # => the pipe object itself, the binding is baked in
strip.owner    # => TextPipeline
```

Três sintaxes de chamada o invocam, e são intercambiáveis:

```ruby
strip.call("<b>hi</b>")  # => "hi", explicit
strip.("<b>hi</b>")      # => "hi", the .() shorthand
strip["<b>hi</b>"]       # => "hi", the [] shorthand
```

Como um `Method` responde a `to_proc`, ele também se encaixa direto em
qualquer slot de bloco com `&`:

```ruby
def shout(s) = s.upcase + "!"
%w[a b].map(&method(:shout))  # => ["A!", "B!"]
```

### Composição: `>>` lê para frente, `<<` lê para trás

Esse é o ganho de métodos serem objetos. `Method#>>` e `Method#<<` constroem
um novo `Proc` que encadeia dois chamáveis:

- `a >> b`: **pipeline, da esquerda para a direita**: chame `a`, entregue seu
  resultado a `b`.
- `a << b`: **composição matemática, da direita para a esquerda**: chame `b`
  primeiro, entregue seu resultado a `a`. Isso é `f∘g`.

```ruby
strip    = pipe.method(:strip_tags)
squish   = pipe.method(:squish)
truncate = pipe.method(:truncate)

raw = "<p>  Ruby   makes   methods first-class  </p>"

forward = strip >> squish >> truncate
forward.class        # => Proc
forward.call(raw)    # => "Ruby makes method..."

backward = truncate << squish << strip
backward.call(raw)   # => "Ruby makes method..."
```

Ambos soletram o mesmo pipeline em ordens de leitura opostas. Siga `forward`
passo a passo: `strip_tags` remove `<p>` e `</p>`, deixando
`"  Ruby   makes   methods first-class  "`; `squish` colapsa os espaços em
branco para `"Ruby makes methods first-class"` (30 caracteres); `truncate`
vê 30 > 20 e retorna os primeiros 17 caracteres mais reticências. `backward`
é escrito com o mais interno por último: `truncate << squish << strip` diz
"truncate de squish de strip", e executa `strip` primeiro, exatamente como a
notação matemática.

O resultado é um `Proc`, não um `Method`, então a cadeia continua se
compondo com qualquer coisa chamável, incluindo lambdas e symbol-procs:

```ruby
double = ->(n) { n * 2 }
def add_ten(n) = n + 10

(method(:add_ten) >> double).call(1)          # => 22  (11, then doubled)
(method(:add_ten) << double).call(1)          # => 12  (2, then +10)
(method(:add_ten) >> :to_s.to_proc).call(1)   # => "11"
```

Note como `>>` e `<<` no *mesmo* par produzem respostas diferentes (22 vs.
12); os operadores não são variantes estilísticas, são ordens opostas.

### `arity`: o que os números negativos significam

`Method#arity` reporta quantos argumentos o método espera. Quando todo
argumento é obrigatório, é uma contagem positiva simples. Assim que o método
aceita um argumento *opcional* ou *variádico*, o Ruby não consegue expressar
um único número, então ele codifica "pelo menos n" como **`-n-1`**, onde `n`
é a contagem de argumentos obrigatórios:

```ruby
def two(a, b)                  = nil
def opt(a, b = 1)              = nil
def tag(name, content, *attrs) = nil

method(:two).arity   # =>  2, exactly 2
method(:opt).arity   # => -2, 1 required, then optional  (-1-1)
method(:tag).arity   # => -3, 2 required, then a splat   (-2-1)
```

`method(:tag).arity == -3` significa, portanto, "dois argumentos
obrigatórios e uma cauda aberta". Lendo de volta: tire o sinal, subtraia um,
2 obrigatórios.

Argumentos nomeados colapsam em um *único* slot extra, obrigatório só se
algum nomeado for obrigatório:

```ruby
def kw(a, b:)     = nil
def kwopt(a, b: 1) = nil

method(:kw).arity     # =>  2, a, plus one mandatory keyword bundle
method(:kwopt).arity  # => -2, a required, the keyword bundle optional
```

Quando você precisa de detalhe real em vez de uma contagem, `parameters` te
dá o formato completo e é o que você deveria usar em código de despacho
dinâmico:

```ruby
method(:tag).parameters
# => [[:req, :name], [:req, :content], [:rest, :attrs]]
```

### `curry`: alimente os argumentos um de cada vez

`Method#curry` retorna um `Proc` que acumula argumentos e só invoca o método
subjacente quando tem o bastante:

```ruby
class Notifier
  def initialize(from) = @from = from
  def deliver(channel, subject, body)
    "[#{channel}] #{@from} -> #{subject}: #{body}"
  end
end

deliver = Notifier.new("billing@acme.io").method(:deliver)
deliver.arity   # => 3

curried = deliver.curry          # a Proc awaiting 3 arguments
email   = curried[:email]        # a Proc awaiting 2, channel pinned
invoice = email["Invoice #42"]   # a Proc awaiting 1, subject pinned too

invoice.call("Due in 7 days")
# => "[email] billing@acme.io -> Invoice #42: Due in 7 days"

curried[:sms]["Invoice #42"]["Due in 7 days"]
# => "[sms] billing@acme.io -> Invoice #42: Due in 7 days"
```

`email` e `invoice` são valores comuns: entregue-os a colaboradores que não
sabem nada sobre `Notifier`, e cada ponto de chamada fornece só a peça que
lhe pertence.

Fazer curry precisa saber quando "o bastante" foi alcançado, então um método
variádico (cuja aridade é negativa e portanto ambígua) exige que você nomeie
a aridade alvo explicitamente:

```ruby
def sum_all(a, b, *rest) = ([a, b] + rest).sum
method(:sum_all).arity                  # => -3, so curry can't guess
method(:sum_all).curry(4)[1][2][3][4]   # => 10
```

### Introspecção, e a conexão com depuração

Objetos `Method` carregam seus próprios metadados: `name`, `owner` (a classe
ou módulo onde a definição de fato mora, não necessariamente a classe do
receptor), `receiver`, `parameters`, e `source_location`, que retorna
`[file, line]`.

```ruby
m = Money.new(1999).method(:formatted)
m.owner            # => Money
m.source_location  # => ["/app/lib/money.rb", 5]
```

`source_location` é a ferramenta de "de onde diabos esse método veio"; o
conceito `common-ruby-gotchas` desta plataforma já cobre seu uso em métodos
definidos dinamicamente e roteados via `method_missing`, então não repetimos
aqui. Um alerta que vale a pena conhecer antes do tempo: o Ruby 4.0 amplia o
valor de retorno para `[path, start_line, start_col, end_line, end_col]`.
Desestruturar como `file, line = m.source_location` continua funcionando,
mas código que assume que o array tem exatamente dois elementos não.

### `unbind` e `UnboundMethod`: a implementação sem o receptor

`Method#unbind` remove o receptor; `Module#instance_method` te dá a mesma
coisa sem nunca ter tido uma instância:

```ruby
um = deliver.unbind                     # from an existing Method
um = Notifier.instance_method(:deliver) # or straight from the class
um.class  # => UnboundMethod
```

Um `UnboundMethod` expõe a mesma superfície de introspecção (`name`,
`arity`, `owner`, `parameters`), mas é inerte. Não há receptor, então não há
nada em que chamá-lo:

```ruby
um.call(:sms, "Ping", "up?")
# NoMethodError: undefined method 'call' for an instance of UnboundMethod
```

Duas formas de torná-lo chamável de novo:

```ruby
target = Notifier.new("ops@acme.io")

um.bind(target).call(:sms, "Ping", "up?")   # bind -> Method -> call
um.bind_call(target, :sms, "Ping", "up?")   # one step
# both => "[sms] ops@acme.io -> Ping: up?"
```

`bind_call` não é só mais curto. `bind` precisa *alocar* um objeto `Method`
para guardar o pareamento, que você então chama imediatamente e descarta;
`bind_call` faz a vinculação e o despacho em uma única operação sem nenhum
objeto intermediário. Em um loop apertado isso é uma diferença mensurável:
um milhão de iterações de `um.bind(obj).call` leva aproximadamente 0,26s
contra 0,22s de `um.bind_call(obj)` na mesma máquina, e, mais importante,
produz zero lixo por chamada. Se você está vinculando uma vez e chamando
muitas vezes, guarde o `Method` de `bind`; se está vinculando por chamada,
use `bind_call`.

### Revinculação: emprestando uma implementação para um objeto não relacionado

A vinculação não é irrestrita. Um método **de propriedade de uma classe** só
pode ser vinculado a uma instância daquela classe ou de uma subclasse:

```ruby
class Money
  def initialize(cents) = @cents = cents
  def formatted = format("$%.2f", @cents / 100.0)
end

fmt = Money.instance_method(:formatted)

class Discounted < Money; end
fmt.bind_call(Discounted.new(1999))  # => "$19.99", a subclass instance is fine

fmt.bind_call(Object.new)
# TypeError: bind argument must be an instance of Money
```

Um método **de propriedade de um módulo** não tem essa restrição (o Ruby 3.0
a removeu): como um módulo pode ser misturado em qualquer coisa, seus
métodos de instância podem ser vinculados a *qualquer* objeto. Isso torna
um módulo simples uma sacola de comportamento reutilizável e
transplantável:

```ruby
module Sluggable
  def slug
    title.downcase.strip.gsub(/[^a-z0-9]+/, "-").delete_prefix("-").delete_suffix("-")
  end
end

slugify = Sluggable.instance_method(:slug)

Article = Struct.new(:title)          # neither of these
Video   = Struct.new(:title, :duration)  # includes Sluggable

slugify.bind_call(Article.new("  Hello, Ruby World!  "))  # => "hello-ruby-world"
slugify.bind_call(Video.new("Method Objects 101", 300))   # => "method-objects-101"
```

O único contrato é duck typing: `slug` envia `title`, então qualquer coisa
que responda a `title` funciona. Você ganha o comportamento exato do módulo
em objetos que nunca modificou: sem `include`, sem monkey patch, sem
nenhuma mudança em `Article` ou `Video`. É assim que um serializador ou
apresentador consegue aplicar uma implementação canônica única entre tipos
que ele não é dono.

A mesma alavanca recupera uma implementação que um objeto sobrescreveu.
`Kernel` é um módulo, então seus métodos de instância se vinculam a
qualquer coisa:

```ruby
class Sneaky
  def inspect = "<totally normal object>"
end

s = Sneaky.new
s.inspect                                  # => "<totally normal object>"
Kernel.instance_method(:inspect).bind_call(s)
# => "#<Sneaky:0x00000001042b17b8>"
```

O objeto não pode mentir para você, porque você contornou completamente sua
tabela de métodos, o que é precisamente o motivo de depuradores, `pp`, e
frameworks de teste recorrerem a `bind_call` quando precisam da verdade
sobre um objeto em vez de sua autodescrição.

## Trade-offs

- **Composição é elegante mas opaca em um backtrace**: `(strip >> squish >>
  truncate).call(raw)` levantando exceção dentro de `squish` te dá uma
  pilha através de frames anônimos de `Proc`, não o aninhamento legível de
  `squish(strip_tags(raw))`. Para dois ou três passos o pipeline lê melhor;
  para uma cadeia longa, um método simples com variáveis intermediárias
  nomeadas costuma ser mais fácil de depurar.
- **`>>` e `<<` são fáceis de trocar por engano**: são ordens opostas, e em
  um par de transformações que parece simétrico o operador errado produz um
  valor plausível mas errado, em vez de um erro. Escolha uma direção como
  estilo da casa (`>>` lê na ordem de execução e é o padrão mais seguro) em
  vez de misturar os dois.
- **`arity` é um resumo com perda de informação**: um único inteiro negativo
  não consegue te dizer quais argumentos são opcionais, quais são
  nomeados, ou seus nomes. É bom para uma checagem rápida de "isso recebe um
  argumento de bloco?"; qualquer coisa tomando decisões reais deve ler
  `parameters`.
- **Currying troca clareza no ponto de chamada por reutilização**:
  `curried[:email]["Invoice"]` esconde qual parâmetro cada colchete
  preenche, e uma contagem errada só falha quando o último argumento
  finalmente chega. Compensa quando o proc parcialmente aplicado de fato
  viaja para algum lugar; para uma chamada local, argumentos nomeados são
  mais claros que uma cadeia com curry.
- **Segurar objetos `Method` mantém seus receptores vivos**: uma tabela de
  despacho de `Method`s vinculados prende cada um desses receptores na
  memória enquanto a tabela viver. `UnboundMethod` evita isso, ao custo de
  precisar de um receptor no momento da chamada.
- **Revincular métodos de módulo é poderoso e fácil de abusar**: reutilizar
  uma implementação em um objeto que nunca optou por isso acopla aquele
  objeto a um contrato invisível (`slug` exige `title`), e nenhuma listagem
  de `ancestors` jamais vai revelar a relação. É a ferramenta certa para
  código de framework e ferramental; em código de aplicação, `include`
  declara a mesma intenção onde um leitor consegue ver.
- **`bind_call` é mais rápido, mas só significativamente em caminhos
  quentes**: o ganho é uma alocação evitada. Recorrer a isso como
  micro-otimização em código que roda uma vez é ruído; recorrer a isso
  dentro de um serializador que roda por registro é real.

## Documentation Links

- [Method, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Method.html) (doc)
- [UnboundMethod, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/UnboundMethod.html) (doc)
- [Object#method, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html#method-i-method) (doc)
- [Module#instance_method, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html#method-i-instance_method) (doc)
- [Proc#curry and Proc#>> / #<<, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Proc.html#method-i-curry) (doc)
- [Programming Ruby 3.3 (Pickaxe), Ruby's Object Model](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
