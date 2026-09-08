---
version: 1.0
updatedAt: 2026-08-18
title: "Armadilhas Comuns do Ruby: Bugs Silenciosos que Vale a Pena Saber de Cor"
summary: As armadilhas que não produzem erro nenhum, um setter sem self. virando uma variável local, um initialize com erro de digitação que nunca roda, {} vs do...end vinculando o bloco à chamada errada, além de source_location, sync = true e freeze como as ferramentas que tornam bugs silenciosos ruidosos.
---
## Objective

A maioria dos bugs em Ruby se anuncia com um `NoMethodError` e um backtrace.
Esta página é sobre o outro tipo: aqueles em que o interpretador aceita seu
código, o executa, e produz a resposta errada sem um único aviso. Um setter
que silenciosamente vira uma variável local. Um construtor chamado
`initialise` que simplesmente nunca é chamado. Uma variável de instância
escrita `@anwser` que sempre lê como `nil`. Um bloco que se anexa ao método
errado porque você deixou de fora os parênteses. Nada disso é exótico; são os
pontos cegos de uma linguagem que deliberadamente troca verificação estática
por flexibilidade, e vale a pena conhecê-los de cor porque nenhuma ferramenta
vai pegá-los por você. O mesmo apêndice que os lista também dá três
ferramentas para a direção contrária: `source_location` para achar de onde um
método realmente veio, `sync = true` para parar de confiar na ordem de saída,
e `freeze` para converter uma mutação silenciosa em uma exceção imediata,
exatamente na linha que a causou.

## Use Cases

- Depurar um objeto cujo atributo teimosamente lê `nil` depois de um
  construtor que visivelmente o atribui; o setter sem `self.` e a ivar com
  erro de digitação são as duas primeiras coisas a checar.
- Explicar para alguém vindo de Java ou C# por que `Point(1, 2)` não construiu
  um `Point`, e por que `Point.new(1, 2)` é a única forma que de fato faz isso.
- Rastrear um método que existe em tempo de execução, mas não aparece em
  nenhum `grep`, porque foi criado por `define_method` ou roteado via
  `method_missing`.
- Entender uma saída de log intercalada em que linhas de `$stderr` parecem
  chegar antes de linhas de `$stdout` que foram impressas primeiro.
- Descobrir "quem está mutando esse array?" em uma base de código grande,
  congelando o objeto e deixando o backtrace do `FrozenError` apontar o
  culpado.
- Decidir onde parênteses são um estilo opcional e onde são sintaxe
  estrutural.

## Deep Dive

### `Klass()` é uma chamada de método, nunca um construtor

Em Ruby, um identificador seguido de parênteses é uma *chamada de método*, e
uma constante começando com letra maiúscula é só um nome. Junte os dois e você
tem algo que parece um construtor na maioria das outras linguagens, mas não é:

```ruby
def Point(x, y)
  "the method Point, called with #{x}, #{y}"
end

class Point
  def initialize(x, y) = (@x, @y = x, y)
  def inspect = "#<Point #{@x},#{@y}>"
end

Point(1, 2)      # => "the method Point, called with 1, 2"
Point.new(1, 2)  # => #<Point 1,2>
```

O método e a classe coexistem sem problemas; eles vivem em namespaces
diferentes. `Point(1, 2)` encontra o método; só `Point.new` instancia. Isso
não é uma peculiaridade para se evitar, é um idioma documentado: `Integer("42")`,
`Array(nil)`, `String(x)` e `Rational(1, 3)` são todos métodos comuns do
`Kernel` com nomes capitalizados, e definir o seu próprio é uma forma legítima
de dar a uma classe uma fábrica leve com formato de construtor. Só nunca
assuma que uma chamada capitalizada construiu um objeto.

Se não existir tal método, você recebe uma falha clara em vez de uma surpresa:
`NoMethodError: undefined method 'Point' for main`. A armadilha só é perigosa
quando existe *de fato* um método com esse nome.

### Vírgulas finais: permitidas em quase todo lugar, fatais em um `def`

O Ruby permite uma vírgula pendurada em literais de array, literais de hash,
chamadas de método e listas de parâmetros de bloco, e é por isso que literais
multilinha amigáveis a diff são tão comuns em bases de código Ruby:

```ruby
[1, 2,]                       # => [1, 2]
{ a: 1, }                     # => {a: 1}
takes(1, 2,)                  # fine
[[1, 2]].map { |a, b,| a + b } # fine
```

Existe exatamente um lugar onde isso é um erro de sintaxe, e é justo o lugar
onde você mais esperaria simetria:

```ruby
def foo(a, b,)   # SyntaxError: unexpected `,` in parameters
end
```

O arquivo nem vai carregar. É um erro de parse, não um erro em tempo de
execução, então falha alto e instantaneamente, mas só quando você de fato
tenta rodar o arquivo, o que é o motivo de isso aparecer às pressas depois de
uma edição de "só vou adicionar mais um parâmetro" que reordenou argumentos em
uma chamada e em uma definição ao mesmo tempo.

### O `self.` ausente: um setter que silenciosamente vira uma local

Essa é a armadilha mais cara da lista, porque não produz nenhum erro, nenhum
aviso no nível de verbosidade padrão, e um `nil` que aparece longe da causa.

```ruby
class Person
  attr_accessor :name, :age

  def initialize(name)
    @name = name
    age = 0        # creates a local variable named age (the setter is never called)
  end
end

Person.new("Ada").age   # => nil
```

`age = 0` é inequívoco para o parser: uma atribuição a um identificador nu
sempre cria ou atualiza uma *variável local*. Não existe uma regra que diga
"se existir um setter com esse nome, chame-o em vez disso"; isso tornaria
impossível ter uma local chamada `age` em uma classe que também tem um
accessor `age=`. A única forma de alcançar o setter de dentro do objeto é dar
a ele um receptor explícito:

```ruby
def initialize(name)
  @name = name
  self.age = 0     # calls age=(0)
end
```

A assimetria que torna isso tão fácil de cair: o *getter* não precisa de
receptor. `age` do lado direito de fato chama o método leitor (contanto que
não exista uma local com esse nome). Ler funciona sem `self.`; escrever não.

A flag `-w` do Ruby pega esse formato específico quando a local nunca é lida
de novo:

```
$ ruby -w person.rb
person.rb:6: warning: assigned but unused variable - age
```

Esse aviso é um dos argumentos mais fortes para rodar sua suíte de testes com
avisos habilitados. Ele não dispara se a local por acaso for usada depois no
método, então é uma boa rede, não uma garantia.

### Erros de digitação sobre os quais o Ruby nunca vai te contar

Dois nomes em Ruby não têm nenhuma verificação estática, e errar qualquer um
deles é completamente silencioso.

```ruby
class Answer
  def initialise(value)   # British spelling (not the constructor Ruby calls)
    @answer = value
  end

  def answer
    @anwser               # typo (this ivar was never assigned)
  end
end

a = Answer.new
a.answer               # => nil
a.instance_variables   # => []
```

`Answer.new` roda `Object#initialize`, que não recebe argumentos e não faz
nada; `initialise` fica ali como um método de instância perfeitamente válido,
nunca chamado. E `@anwser` não é um erro; ler uma variável de instância não
atribuída retorna `nil` por design, porque é isso que faz a inicialização
preguiçosa (`@cache ||= compute`) funcionar. O Ruby 2.x costumava avisar sobre
ivars não inicializadas sob `-W`; esse aviso foi removido no Ruby 3.0, então
hoje até o modo verboso fica em silêncio aqui.

Defesas práticas: rode o RuboCop no CI (`Lint/UselessAssignment` e
`Lint/UselessMethodDefinition` pegam boa parte dos dois formatos), prefira
`attr_reader` a leitores escritos à mão que repetem o nome da ivar
manualmente, e escreva pelo menos um teste que afirme sobre o *estado de um
objeto construído* em vez de só sobre a presença de seus métodos; um
construtor que nunca roda é invisível para um teste que só checa
`respond_to?`.

### `{}` versus `do...end`: o bloco pode se anexar à chamada errada

Chaves têm precedência maior que `do...end`. Com parênteses, isso nunca
importa. Sem eles, isso decide *qual método recebe o bloco*:

```ruby
def one(arg = nil)
  "one(#{arg.inspect}#{block_given? ? ', &block' : ''})"
end

def two(&blk)
  "two(#{blk ? '&block' : 'nil'})"
end

one two { "three" }      # => "one(\"two(&block)\")"  (block went to two)
one two do "three" end   # => "one(\"two(nil)\")"     (block went to one)
```

Os mesmos tokens, na mesma ordem, e um método diferente recebe o bloco. `{ }`
agarra a chamada mais próxima (`two`), enquanto `do...end` se vincula de forma
mais frouxa e se anexa à chamada externa, `one`. Nenhum dos dois está errado;
são operadores diferentes.

A correção não é decorar a precedência, é remover a ambiguidade:

```ruby
one(two { "three" })     # block clearly belongs to two
one(two) { "three" }     # block clearly belongs to one
```

É por isso que a regra de estilo comum (chaves para blocos funcionais de uma
linha, `do...end` para blocos procedurais multilinha) só é um conselho seguro
quando a chamada do receptor já tem parênteses. Assim que você escrever uma
chamada de método nua com um argumento e um bloco, adicione os parênteses.

### `source_location`: de onde esse método realmente veio?

Quando um método existe em tempo de execução, mas `grep` não encontra nada,
pergunte ao próprio objeto do método. `Object#method` retorna um `Method`, e
`Method#source_location` dá o arquivo e a linha, inclusive para métodos que
nunca foram digitados literalmente:

```ruby
class Widget
  [:width, :height].each do |dim|
    define_method(dim) { 42 }
  end

  def respond_to_missing?(name, priv = false)
    name.to_s.start_with?("legacy_") || super
  end

  def method_missing(name, *args)
    return "legacy #{name}" if name.to_s.start_with?("legacy_")
    super
  end
end

w = Widget.new
w.method(:width).source_location   # => ["widget.rb", 3]  (the define_method block)
w.method(:width).owner             # => Widget
```

Para um método criado com `define_method`, `source_location` aponta para o
*bloco* que o definiu, linha 3, dentro do loop `each`. Essa é exatamente a
linha que você precisava encontrar.

Métodos roteados via `method_missing` se comportam de forma diferente, e a
diferença é, ela mesma, o diagnóstico:

```ruby
w.method(:legacy_color).source_location  # => nil
w.method(:legacy_color).owner            # => Widget
w.method(:legacy_color).call             # => "legacy legacy_color"
```

Você só recebe um objeto `Method` porque `respond_to_missing?` está definido;
sem ele, `method(:legacy_color)` levanta `NameError`, o que é mais um motivo
para sempre parear `method_missing` com `respond_to_missing?`. E o
`source_location` como `nil` diz que não há nenhum código-fonte Ruby por trás
desse nome: ele é sintetizado dinamicamente ou implementado em C
(`1.method(:+).source_location` é `nil` pelo mesmo motivo). Combine isso com
`owner` para descobrir qual módulo na cadeia de ancestrais é responsável, e
`Class.instance_method(:name)` para fazer as mesmas perguntas sem precisar de
uma instância.

### Saída com buffer mente sobre a ordem

`$stdout` e `$stderr` são streams separadas com políticas de buffer
separadas, então a ordem em que as linhas *aparecem* não é necessariamente a
ordem em que foram escritas:

```ruby
$stdout.sync   # => true on a terminal, false when redirected to a file or pipe
$stderr.sync   # => true (stderr is unbuffered by default)

$stdout.print "out1 "
$stderr.print "err1 "
$stdout.print "out2 "
$stderr.puts  "err2"
```

Rodado interativamente, isso imprime na ordem do código-fonte. Redirecione com
pipe (`ruby demo.rb 2>&1 | cat`) e você recebe:

```
err1 err2
out1 out2
```

`$stdout` parou de ser um TTY, mudou para buffer em blocos, e descarregou tudo
na saída; `$stderr` saiu imediatamente. Toda sessão de depuração baseada em
`puts` contra um arquivo de log, um log do Docker, ou um job de CI está
rodando exatamente nesse modo, e "o erro aconteceu antes da coisa que o
causou" é uma miragem.

```ruby
$stdout.sync = true   # flush after every write
$stderr.sync = true
```

Ative os dois no topo do programa enquanto depura, e o intercalamento volta a
ser confiável. Isso custa uma syscall por escrita, e é justamente por isso que
não é o padrão para saída redirecionada, mas durante uma sessão de depuração
esse preço não é nada comparado a ler um log enganoso. A alternativa é enviar
a saída de depuração para uma única stream, o que evita completamente a
questão de ordenação entre streams.

### `freeze` como ferramenta de depuração

O argumento de venda usual do `freeze` é imutabilidade e segurança em threads.
Seu uso subestimado é diagnóstico: quando você suspeita que *algo, em algum
lugar*, está mutando um objeto que não deveria, congele-o e deixe o Ruby
encontrar a linha por você.

```ruby
CONFIG = { retries: 3 }.freeze

def sneaky(h)
  h[:retries] = 99
end

sneaky(CONFIG)
# FrozenError: can't modify frozen Hash: {retries: 3}
#   from config.rb:4:in 'Object#sneaky'
```

Em vez de um valor errado descoberto três módulos depois, você recebe uma
exceção cujo backtrace nomeia exatamente a instrução que violou sua suposição.
Isso funciona em qualquer objeto (`String`, `Array`, `Hash`, suas próprias
classes), e vale a pena fazer temporariamente mesmo sem nenhuma intenção de
mandar o `freeze` para produção.

Duas coisas para saber antes de confiar nisso:

```ruby
config = { hosts: ["a", "b"] }.freeze
config[:hosts] << "c"     # no error (freeze is shallow)
config                    # => {hosts: ["a", "b", "c"]}
```

`freeze` protege só o objeto no qual você o chamou, não os objetos que ele
referencia. Para um freeze profundo você precisa percorrer a estrutura você
mesmo (ou usar `Ractor.make_shareable`, que congela transitivamente e é a
coisa mais próxima que a biblioteca padrão oferece).

Segundo, congelar é uma via de mão única (não existe `unfreeze`), e `dup`
retorna uma cópia descongelada enquanto `clone` preserva o estado congelado:

```ruby
s = "config".freeze
s.dup.frozen?     # => false
s.clone.frozen?   # => true
s.clone(freeze: false).frozen?  # => false
```

## Trade-offs

- **O setter sem `self.` é o preço de sequer ter variáveis locais**: o Ruby
  não pode deixar uma atribuição nua às vezes significar "chame um setter", ou
  toda classe com um accessor proibiria uma local do mesmo nome. Rodar a suíte
  de testes com `-w` recupera a maior parte da segurança, já que esse formato
  quase sempre deixa uma local atribuída mas não usada, mas é uma heurística,
  não uma checagem.
- **`nil` silencioso para ivars não definidas permite inicialização preguiçosa
  e esconde erros de digitação**: `@cache ||= expensive` só lê bem porque uma
  `@cache` não atribuída é `nil`. A mesma regra torna `@anwser` uma expressão
  válida. O Ruby escolheu esse idioma e removeu o antigo aviso do modo verboso
  na 3.0; a compensação são linters e testes que verificam o estado
  construído.
- **Parênteses opcionais compram DSLs legíveis e custam certeza sobre a
  vinculação de blocos**: `one two { }` e `one two do end` diferem só no
  delimitador do bloco, e nenhum guia de estilo resolve isso sozinho.
  Parênteses no ponto de chamada ambíguo são o conserto barato, local e
  permanente.
- **`sync = true` troca vazão por ordenação honesta**: um flush por escrita é
  overhead real de syscall em um caminho de log quente, e é exatamente por
  isso que a saída redirecionada tem buffer em blocos por padrão. Ative
  durante a depuração, e use um logger de verdade em vez de deixar isso ligado
  em produção.
- **`freeze` transforma mutação silenciosa em falha ruidosa, mas só um nível
  de profundidade**: converte uma caçada em um backtrace, uma troca excelente
  durante a depuração. Deixado permanentemente também pode quebrar chamadores
  legítimos que fazem dup e mutam, e sua superficialidade significa que um
  container congelado cheio de valores mutáveis dá menos proteção do que
  parece.
- **`source_location` é diagnóstico, não exaustivo**: ele acerta em cheio
  `define_method` e definições comuns, e retorna `nil` para métodos
  implementados em C e roteados via `method_missing`. O `nil` ainda é
  informação, mas você precisa de `owner` e da cadeia de ancestrais para
  fechar a história.

## Documentation Links

- [Programming Ruby 3.3 (Pickaxe), Troubleshooting Ruby](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
- [Method#source_location and Method#owner, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Method.html#method-i-source_location) (doc)
- [Object#freeze and Object#frozen?, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html#method-i-freeze) (doc)
- [IO#sync and IO#sync=, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/IO.html#method-i-sync) (doc)
- [BasicObject#method_missing and respond_to_missing?, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/BasicObject.html#method-i-method_missing) (doc)
