---
version: 1.0
updatedAt: 2026-08-18
title: "instance_eval, class_eval e a Construção de DSLs Internas"
summary: Por que class_eval define métodos de instância e instance_eval define métodos de classe, as variantes _exec que corrigem a armadilha da ivar desaparecida, e como DSLs internas estilo RSpec são construídas sobre a mesma troca de self.
---
## Objective

`instance_eval`, `class_eval` (e seu apelido `module_eval`), mais as
variantes `_exec`, todos fazem a mesma coisa central: rodam um bloco com
`self` temporariamente trocado por algum outro objeto. O que eles *não*
compartilham é a **definee padrão**: o alvo invisível para o qual um `def`
nu dentro do bloco escreve. `class_eval` em uma classe define métodos de
instância; `instance_eval` naquela mesma classe define métodos de classe.
Entender essa única assimetria é o que separa "eu copiei uma DSL de um post
de blog" de conseguir construir e depurar uma.

## Use Cases

- Construir uma DSL interna onde o corpo do bloco lê como uma mini-linguagem
  (`Turtle#walk { forward(8); left }`, `describe`/`it` do RSpec, um
  `Gemfile`, o `routes.draw` do Rails) rodando o bloco do chamador com `self`
  definido como o objeto construtor, para que chamadas de método nuas
  resolvam contra ele.
- Reabrir uma classe calculada em tempo de execução (`klass.class_eval { ...
  }`) quando você não tem um nome de constante literal para escrever contra
  `class Foo`.
- Escrever uma macro de nível de classe que fecha sobre seus argumentos,
  combinando `class_exec` com `define_method`.
- Espiar o estado privado de um objeto a partir de um teste ou de uma sessão
  de console (`obj.instance_eval { @cache }`) sem adicionar um leitor que
  você não quer em código de produção.
- Diagnosticar o clássico relato de bug de DSL: "meu `@config` é `nil`
  dentro do bloco, mas ele está definido logo antes da chamada."

## Deep Dive

### A mesma troca de `self`, alvo de `def` diferente

```ruby
class Widget; end

Widget.class_eval do
  self          # => Widget
  def render = "an instance method"
end

Widget.instance_eval do
  self          # => Widget  (identical!)
  def build = "a class method"
end

Widget.new.render  # => "an instance method"
Widget.build       # => "a class method"
```

`self` é `Widget` nos dois blocos, mas `def` cai em dois lugares diferentes.
`class_eval` define a definee padrão como o próprio receptor, então `def` se
comporta exatamente como se você tivesse digitado dentro de `class Widget
... end`. `instance_eval` define a definee padrão como a **classe singleton**
do receptor, que para um objeto classe é onde os métodos de classe moram.
`Widget.instance_eval { def build; end }` e `Widget.singleton_class.class_eval
{ def build; end }` são a mesma coisa escrita de duas formas.

O corolário confunde as pessoas o tempo todo: `define_method` é uma chamada
de método normal em `self`, não um `def`, então ele ignora completamente a
definee padrão.

```ruby
Widget.instance_eval { define_method(:oops) { 1 } }
Widget.new.oops  # => 1  — an INSTANCE method, despite instance_eval
```

Dentro de `instance_eval`, `def` segue a classe singleton, mas
`define_method` segue `self`. Se você quer um método de classe com nome
dinâmico, seja explícito: `Widget.define_singleton_method(:oops) { 1 }`.

### `_exec`: passando valores em vez de capturá-los

Como `self` muda, variáveis de instância dentro do bloco são lidas do *novo*
`self`, não do escopo onde o bloco foi escrito. Variáveis locais continuam
funcionando (blocos são closures), mas ivars silenciosamente viram `nil`:

```ruby
class Report
  def initialize(title) = @title = title

  def render_into(target)
    target.instance_eval { @title }   # @title is looked up on `target`!
  end

  def render_into_fixed(target)
    target.instance_exec(@title) { |title| title }  # evaluated before the switch
  end
end

Report.new("Q3").render_into(Object.new)        # => nil, silently
Report.new("Q3").render_into_fixed(Object.new)  # => "Q3"
```

`instance_exec` / `class_exec` / `module_exec` são idênticos aos irmãos
`_eval`, exceto que eles encaminham seus argumentos para o bloco. Isso os
torna a ferramenta certa sempre que o bloco precisa de dados do escopo
chamador: calcule o valor *fora* (onde `self` ainda é o objeto original) e
entregue-o como um parâmetro do bloco. `class_exec` mais `define_method` é a
receita padrão para uma macro que captura seus próprios argumentos:

```ruby
module Auditable
  def self.add_audit(klass, label)
    klass.class_exec(label) do |captured|
      define_method(:audit_tag) { "#{captured}:#{object_id}" }
    end
  end
end
```

### Construindo uma DSL interna

```ruby
class Turtle
  MOVES = { north: [0, 1], east: [1, 0], south: [0, -1], west: [-1, 0] }.freeze
  TURNS = %i[east north west south].freeze

  attr_reader :trail

  def initialize
    @x = @y = 0
    @heading = :east
    @trail = []
  end

  def walk(&block)
    instance_eval(&block)   # the block's `self` becomes this turtle
    self
  end

  def forward(steps = 1)
    dx, dy = MOVES.fetch(@heading)
    @x += dx * steps
    @y += dy * steps
    @trail << [@x, @y]
  end

  def left
    @heading = TURNS[(TURNS.index(@heading) + 1) % TURNS.size]
  end
end

Turtle.new.walk do
  forward(8)
  left
  forward(3)
end.trail
# => [[8, 0], [8, 3]]
```

`forward` e `left` não têm receptor explícito, e eles resolvem porque `self`
dentro do bloco *é* a tartaruga. Esse é todo o truque por trás do RSpec:
`describe` constrói um objeto de grupo de exemplo e faz `instance_eval` do
seu bloco contra ele, o que é o motivo de `it`, `let` e `subject` serem
chamáveis de forma nua dentro dele, mas não serem métodos globais.

### Constantes são buscadas lexicamente, não através de `self`

```ruby
LABEL = "top level"

class Widget
  LABEL = "widget"
end

Widget.instance_eval { LABEL }   # => "top level"
Widget.class_eval    { LABEL }   # => "top level"
Widget.class_eval("LABEL")       # => "widget"
```

`self` foi movido para `Widget`, mas a resolução de constantes usa o escopo
**lexical** do lugar onde o bloco foi *escrito* (aqui, o nível superior),
então `Widget::LABEL` nunca é consultado. Só a forma em string (desencorajada)
reancora a busca de constantes no receptor, porque uma string é parseada do
zero com o receptor como seu escopo lexical. Quando um `class_eval` em forma
de bloco não consegue ver uma constante que você esperava, dê o nome
completo (`Widget::LABEL`) em vez de recorrer à forma em string.

### Por que a forma em string é desencorajada

```ruby
# Avoid: parsed at runtime, unreadable backtraces, injection risk
klass.class_eval("def #{name}; @#{name}; end", __FILE__, __LINE__)

# Prefer: same effect, no parsing, no interpolation of untrusted text
klass.class_eval { define_method(name) { instance_variable_get(:"@#{name}") } }
```

`eval` em string reinvoca o parser a cada chamada, produz backtraces
apontando para `(eval)` a menos que você passe `__FILE__`/`__LINE__`, e
transforma qualquer `name` fornecido externamente em execução arbitrária de
código. A forma com bloco não tem nenhum desses problemas e quase sempre é
expressável.

## Trade-offs

- **Um bloco de DSL é um ambiente hostil para o código do chamador.** Dentro
  de `instance_eval`, o chamador perde seu próprio `self`: suas ivars, seus
  auxiliares privados, e qualquer método cujo nome o alvo da DSL também
  defina. A alternativa explícita, entregar o construtor como um argumento
  de bloco (`config.database { |db| db.pool = 5 }`), é um pouco mais
  verbosa, mas mantém `self` intacto e nunca surpreende ninguém. Reserve
  `instance_eval` para DSLs cujos blocos devem ser *dados declarativos*, não
  código geral.
- **`instance_eval` no objeto de outra pessoa contorna o encapsulamento.**
  Útil em um console ou em um teste, corrosivo em código de produção: te
  acopla a nomes de ivars privadas que o dono é livre para renomear em um
  patch release.
- **A escolha entre `_eval` / `_exec` não é estilística.** Se o bloco precisa
  de valores do escopo chamador, `_exec` é a única opção correta; depender
  de ivars capturadas produz um `nil` que nenhum teste pode pegar até muito
  mais tarde.
- **Métodos metaprogramados são invisíveis para grep e para seu editor.** Um
  método criado dentro de uma string de `class_eval`, ou por um nome de
  `define_method` calculado, não pode ser navegado até. `Widget.
  instance_method(:render).source_location` é sua alternativa; reserve
  orçamento para o custo extra de depuração antes de tornar uma API
  dinâmica.

## Documentation Links

- [BasicObject#instance_eval, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/BasicObject.html#method-i-instance_eval) (doc)
- [BasicObject#instance_exec, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/BasicObject.html#method-i-instance_exec) (doc)
- [Module#class_eval, #class_exec, #module_eval, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html#method-i-class_eval) (doc)
- [Programming Ruby 3.3 (Pickaxe), The Ruby Object Model and Metaprogramming](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
