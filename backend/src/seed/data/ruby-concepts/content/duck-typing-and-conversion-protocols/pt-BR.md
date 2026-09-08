---
version: 1.0
updatedAt: 2026-08-18
title: "Duck Typing e Protocolos de Conversão"
summary: O tipo de um objeto é o conjunto de mensagens ao qual ele responde, não sua classe, mais a divisão entre conversão explícita (to_s) e implícita (to_str), que decide se o próprio Ruby vai tratar seu objeto como substituível por um tipo embutido.
---
## Objective

Em Ruby, o "tipo" de um objeto não é sua classe, é o conjunto de mensagens ao
qual ele responde, resolvido no momento em que um método é chamado. Se anda
como um pato e grasna como um pato, o Ruby o trata como um pato. Essa única
ideia é o que permite passar um `Array` onde um arquivo era esperado, trocar
um acumulador `String` por um `Array` sem tocar no código que o preenche, e
validar um objeto perguntando `respond_to?(:<<)` em vez de `is_a?(File)`. Por
cima disso, o Ruby empilha um conjunto formal de *protocolos de conversão*:
conversões explícitas de nome curto (`to_s`, `to_i`) que você chama, e
conversões implícitas de nome longo (`to_str`, `to_int`) que o interpretador
chama por você, e a diferença entre as duas é uma das partes mais mal
entendidas da linguagem.

## Use Cases

- Escrever um método que recebe "algo para escrever" e aceitar qualquer
  objeto que responda a `<<`, para que os testes possam passar um `Array` em
  vez de criar, ler e apagar um arquivo temporário de verdade.
- Trocar uma estrutura de dados por uma mais rápida (acumulador `String` para
  `Array` + `join`) sem mudar o código que constrói o conteúdo, porque esse
  código nunca perguntou qual classe estava segurando.
- Validar que um argumento consegue fazer o que você precisa com
  `respond_to?`, em vez de prender os chamadores a uma hierarquia de herança
  com `kind_of?`.
- Tornar um objeto de valor personalizado utilizável em aritmética que começa
  com um tipo embutido do lado esquerdo (`3 * roman`), implementando `coerce`.
- Decidir se sua classe deve implementar só `to_s`, ou também `to_str`, ou
  seja, se ela apenas *se renderiza como* uma String ou é genuinamente
  substituível por uma.

## Deep Dive

### Duck typing torna os testes baratos

```ruby
def write_report(rows, out)
  rows.each do |row|
    out << row.join(",")
    out << "\n"
  end
  out
end
```

`write_report` nunca pergunta o que `out` é. Em produção ele recebe um `File`;
em um teste pode receber qualquer coisa que responda a `<<`:

```ruby
lines = []
write_report([[1, "a"], [2, "b"]], lines)
lines # => ["1,a", "\n", "2,b", "\n"]

buffer = +""
write_report([[1, "a"]], buffer)
buffer # => "1,a\n"
```

Nenhum diretório temporário, nenhuma limpeza, nenhum sistema de arquivos no
teste, e nenhum objeto mock também. O contrato real do método nunca foi "um
File", foi "responde a `<<`".

### A mesma flexibilidade é uma alavanca de performance

Essa é a história de guerra do Pickaxe, e vale a pena reconstruí-la porque
mostra o duck typing compensando em produção, não em um teste. Uma exportação
CSV construía sua saída em uma `String`:

```ruby
csv = +""
write_report(rows, csv)   # minutes, for a large report
File.write("report.csv", csv)
```

Todo `String#<<` em uma string crescente pode forçar uma realocação e uma
cópia dos bytes acumulados, então o custo cresce com o tamanho do relatório e
o garbage collector passa seu tempo perseguindo strings temporárias cada vez
maiores. A correção não tocou em nenhuma linha de `write_report`:

```ruby
csv = []
write_report(rows, csv)   # seconds, same report
File.write("report.csv", csv.join)
```

`Array#<<` só empurra uma referência: sem realocação de uma string gigante,
muito menos lixo. O método construtor funcionou sem mudanças porque ele só
enviava `<<`. Se ele contivesse um único `raise unless out.is_a?(String)`, a
otimização teria exigido reescrevê-lo.

### `respond_to?` em vez de checagens de classe

```ruby
def write_report(rows, out)
  unless out.respond_to?(:<<)
    raise ArgumentError, "expected an object responding to #<<, got #{out.class}"
  end
  # ...
end
```

`respond_to?(:<<)` faz a pergunta com a qual o método de fato se importa.
`is_a?(IO)` faz uma pergunta diferente, mais estrita, e rejeitaria o `Array` e
a `String` que funcionam perfeitamente bem. Passe `true` como segundo
argumento (`respond_to?(:helper, true)`) para incluir métodos privados; defina
`respond_to_missing?` se seu objeto responde métodos via `method_missing`, ou
`respond_to?` vai mentir sobre eles.

### Conversão explícita vs. implícita: a regra de nome longo/nome curto

Conversões explícitas têm **nomes curtos**: `to_s`, `to_i`, `to_a`, `to_h`.
Você as chama deliberadamente. Elas prometem uma *representação razoável* no
tipo alvo; não afirmam que o objeto é aquele tipo. `nil.to_a` é `[]`,
`"3 apples".to_i` é `3`: úteis, não literais.

Conversões implícitas têm **nomes longos**: `to_str`, `to_int`, `to_ary`,
`to_hash`. É *o interpretador* que chama essas, por conta própria, quando
precisa de um valor daquele tipo exato. Implementar uma delas é uma promessa
muito mais forte: "meu objeto é substituível 1:1 por uma String / Integer /
Array / Hash de verdade."

> ⚠️ **Livro vs. hoje (Ruby 4.0):** o próprio operador splat costumava quebrar
> essa regra. `[*nil]` e um argumento `*nil` nu chamavam silenciosamente
> `nil.to_a` por baixo dos panos, invocando a conversão *explícita* a partir
> de uma posição que, pela própria regra deste arquivo, deveria disparar só a
> *implícita* (`to_ary`). Essa incompatibilidade é exatamente o tipo de
> comportamento "mágico e inconsistente" que a divisão nome longo/nome curto
> existe para evitar:
> ```ruby
> def nil.to_a = [1, 2, 3]
> def m(*args) = args
>
> m(*nil)   # Ruby 3.4: [1, 2, 3], silently ran nil.to_a
>           # Ruby 4.0: [], *nil is just "no arguments," to_a never runs
> ```
> O Ruby 4.0 corrigiu isso: `*nil` agora é tratado como "nada", sem nenhuma
> chamada de conversão, alinhando `*` com o jeito que `**nil` já pulava
> `nil.to_hash` desde o Ruby 3.4. Se você algum dia dependeu de `*obj`
> disparar um `to_a` personalizado, essa dependência agora precisa de
> `to_ary` em vez disso, que é a conversão que o splat sempre devia ter
> usado.

```ruby
class RomanNumeral
  VALUES = { "M" => 1000, "D" => 500, "C" => 100, "L" => 50,
             "X" => 10, "V" => 5, "I" => 1 }.freeze

  def initialize(string)
    @string = string
  end

  def to_s  = @string
  def to_i
    @string.chars.map { VALUES.fetch(_1) }.each_cons(2).sum { |a, b| a < b ? -a : a } +
      VALUES.fetch(@string.chars.last)
  end
  alias to_int to_i   # yes: a Roman numeral IS an integer
  # NO to_str: "XIV" renders as a string, but this object is not a String
end

xiv = RomanNumeral.new("XIV")
xiv.to_i         # => 14
[1, 2, 3][xiv]   # nil, Array#[] called to_int for us, no explicit conversion written
"ab" * xiv       # works: String#* wants an Integer, finds to_int
```

Como `RomanNumeral` implementa `to_int`, ele desliza em todo lugar onde o
Ruby espera um Integer. Como ele *não* implementa `to_str`, `"total: " + xiv`
ainda levanta `TypeError`, corretamente, já que um numeral não é uma string.

As conversões implícitas que o interpretador conhece:

| Método | O interpretador pede quando precisa de |
| --- | --- |
| `to_ary` | um `Array`: splat, atribuição múltipla, parâmetros de bloco por desestruturação |
| `to_hash` | um `Hash`: double-splat `**`, expansão de keyword |
| `to_int` | um `Integer`: indexação, repetição, APIs numéricas |
| `to_io` | um objeto `IO` |
| `to_open` | um `IO`: usado por `IO.open` / `open` |
| `to_path` | uma `String` de nome de arquivo: `File.new`, `File.open`, `require` |
| `to_proc` | um `Proc`: o prefixo de argumento `&obj` |
| `to_regexp` | um `Regexp` |
| `to_str` | uma `String`: em quase todo lugar, *exceto* interpolação, que usa `to_s` |
| `to_sym` | um `Symbol` |

`File.new` é a demonstração clássica de duas dessas ao mesmo tempo: aceita
qualquer coisa que responda a `to_int` (tratando como um descritor de
arquivo) *ou* a `to_path`/`to_str` (tratando como um nome de arquivo), e
escolhe seu comportamento com base em qual protocolo o argumento implementa.

### `Kernel#Integer()` e companhia: as conversões que você deve usar

Quando *você* é quem está convertendo, prefira os métodos capitalizados do
`Kernel`: `Array()`, `Integer()`, `Float()`, `String()`, `Hash()`,
`Complex()`, `Rational()`. Cada um tenta a conversão implícita primeiro,
recorre à explícita depois, e levanta uma exceção clara em vez de
silenciosamente produzir lixo:

```ruby
Integer("42")      # => 42
Integer("0x1f", 16) # => 31
Integer("42abc")   # ArgumentError, unlike "42abc".to_i, which returns 42
Integer(nil)       # TypeError, unlike nil.to_i, which returns 0
Integer(xiv)       # => 14, via to_int

Array(nil)         # => []
Array([1, 2])      # => [1, 2]
Array("a\nb")      # => ["a\nb"]
Array(a: 1)        # => [[:a, 1]]
```

`"42abc".to_i` retornando `42` é o comportamento certo para uma conversão
*tolerante* e o comportamento errado para analisar entrada de usuário.
`Integer()` é a que falha alto, que é o que você quase sempre quer em uma
fronteira de sistema.

### `Symbol#to_proc`: o que `&:upcase` de fato faz

O prefixo `&` em um argumento não exige um `Proc`; exige algo que possa
*virar* um, via `to_proc` (outra conversão implícita):

```ruby
%w[a b c].map(&:upcase)  # => ["A", "B", "C"]
```

`Symbol#to_proc` retorna aproximadamente:

```ruby
proc { |obj, *args| obj.send(self, *args) }
```

"Envie essa mensagem para o que quer que você receba." O `map` não sabe nada
sobre o truque do símbolo existir; ele só recebe um bloco, porque `&` fez uma
conversão. O mesmo mecanismo significa que qualquer objeto seu pode ser
passado com `&` se ele definir `to_proc`:

```ruby
class Multiplier
  def initialize(n) = @n = n
  def to_proc = proc { |x| x * @n }
end

[1, 2, 3].map(&Multiplier.new(3))  # => [3, 6, 9]
```

### Coerção numérica: double dispatch para aritmética

`1 + 2.3` funciona mesmo que `Integer#+` não consiga somar um `Float`
diretamente. Quando o operando da esquerda não sabe lidar com o da direita,
ele pede para o da direita nivelar o campo de jogo chamando `coerce`, que
retorna `[argumento_convertido, receptor_convertido]` (ambos agora do mesmo
tipo), e a operação original é tentada de novo nesse par. O resultado depende
das *duas* classes: isso é double dispatch.

```ruby
2.3.coerce(1)  # => [1.0, 2.3]
```

Implementar `coerce` é o que faz um objeto customizado que se comporta como
número funcionar com o literal embutido do lado *esquerdo*, onde sua classe
não controla nada:

```ruby
class RomanNumeral
  def coerce(other)
    [other, to_i]   # coerce toward the more general type: Integer
  end
end

xiv = RomanNumeral.new("XIV")
xiv.to_i * 3   # => 42, trivially, your class is the receiver
3 * xiv        # => 42, only because Integer#* asked xiv.coerce(3)
```

Sempre coerça *em direção ao tipo mais geral*. Se `A#coerce` converte para
`B` enquanto `B#coerce` converte de volta para `A`, as duas classes entregam
a operação uma para a outra para sempre e você acaba com um loop infinito de
coerção em vez de um `TypeError`.

## Trade-offs

- **Duck typing remove garantias em tempo de compilação em troca de
  substituibilidade**: nada avisa com antecedência que um chamador vai passar
  um objeto sem `<<`; você descobre no ponto de chamada, em tempo de
  execução, como um `NoMethodError`. O ganho é que trocar `String` por
  `Array` (ou um arquivo real por um falso) não custa nada.
- **Guardas de `respond_to?` são baratas, mas fáceis de exagerar**: uma
  checagem em uma fronteira de API pública compra uma boa mensagem de erro em
  vez de um `NoMethodError` confuso lá no fundo de uma pilha de chamadas.
  Espalhar uma antes de toda chamada interna só reimplementa tipagem estática
  de forma ruim; deixar o `NoMethodError` disparar costuma ser a resposta
  honesta.
- **Implementar uma conversão implícita é uma promessa que talvez você não
  queira fazer**: `to_str` significa "utilizável em qualquer lugar onde uma
  String é esperada", incluindo concatenação de strings e APIs de arquivo. Se
  isso não é verdade para o seu objeto, entregue só `to_s`; um `to_str`
  errado transforma `TypeError`s claros em comportamento surpreendente,
  longe da causa.
- **Conversões explícitas são tolerantes por design, o que as torna erradas
  para análise de entrada**: `to_i` nunca levanta exceção, então entrada ruim
  vira `0` e segue em frente silenciosamente. `Integer()` custa um handler de
  exceção e te dá uma falha na fronteira em vez de um número errado três
  camadas depois.
- **`coerce` destrava aritmética natural, mas adiciona um risco de recursão
  mútua**: ele sempre precisa converter em direção a um tipo mais geral, e é
  chamado a partir de código que você não controla, então um erro aparece
  como um travamento ou um estouro de pilha em vez de uma falha de teste
  local.

## Documentation Links

- [Object#respond_to?, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html#method-i-respond_to-3F) (doc)
- [Kernel#Integer, #Array, #String, #Hash, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Kernel.html) (doc)
- [Numeric#coerce, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Numeric.html#method-i-coerce) (doc)
- [Symbol#to_proc, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Symbol.html#method-i-to_proc) (doc)
- [Programming Ruby 3.3 (Pickaxe), Ruby Style: Duck Typing](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
- [Ruby 4.0.0 Released, ruby-lang.org](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) (doc)
