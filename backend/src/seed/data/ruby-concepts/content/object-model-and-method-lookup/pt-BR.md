---
version: 1.0
updatedAt: 2026-08-17
title: "O Modelo de Objetos do Ruby e a Busca de Métodos"
summary: Como include, extend e prepend de fato mudam a cadeia de busca de métodos, e por que isso importa mais do que decorar as três palavras-chave.
---
## Objective

Todo objeto Ruby resolve uma chamada de método percorrendo uma única cadeia
ordenada: sua classe singleton, depois sua classe, depois os módulos
misturados naquela classe, depois a superclasse, e assim por diante até
`BasicObject`. `include`, `extend` e `prepend` todos apenas inserem um módulo
em um ponto diferente dessa cadeia. Entender a cadeia (e conseguir lê-la com
`Class#ancestors`) é o que separa "eu misturei um módulo e algo está chamando
a versão errada" de realmente saber o motivo.

## Use Cases

- Decidir se um comportamento transversal (loggable, comparable, cacheable)
  deve ser um mixin (`include`) ou uma superclasse de verdade; mixins
  compõem, cadeias profundas de herança acoplam.
- Envolver/decorar um método existente (por exemplo, adicionando
  instrumentação em torno de um método de biblioteca) sem fazer monkey patch
  diretamente; `prepend` mais `super` é a forma limpa de fazer isso.
- Depurar "qual método está de fato rodando" quando uma classe inclui vários
  módulos que cada um define o mesmo nome de método.
- Entender por que concerns do Rails (`ActiveSupport::Concern`, ele mesmo só
  açúcar sintático sobre `include`) se comportam do jeito que se comportam em
  um model com vários concerns misturados.

## Deep Dive

### A cadeia de busca, em ordem

Para uma chamada de método de instância, o Ruby busca nesta ordem:

1. Métodos singleton definidos diretamente na instância (`def obj.foo`).
2. Módulos `prepend`ados à classe, o mais recentemente prependado primeiro.
3. Métodos definidos diretamente na própria classe.
4. Módulos `include`ados na classe, o mais recentemente incluído primeiro.
5. Repete o processo inteiro na superclasse.
6. Se nada for encontrado em nenhum ponto da cadeia, tenta de novo a busca
   inteira por `method_missing`; se isso também não for encontrado, levanta
   `NoMethodError`.

```ruby
module Loud
  def greet = super.upcase
end

class Greeter
  prepend Loud
  def greet = "hello"
end

Greeter.new.greet          # => "HELLO"
Greeter.ancestors           # => [Loud, Greeter, Object, Kernel, BasicObject]
```

`Loud` fica *antes* de `Greeter` na cadeia de ancestrais porque foi
`prepend`ado, não `include`ado, então `Loud#greet` roda primeiro, e sua
chamada `super` alcança `Greeter#greet`. Se `Loud` tivesse sido `include`ado
em vez disso, `Greeter#greet` rodaria primeiro e `Loud#greet` nunca seria
alcançado a partir de uma chamada normal.

### `include` vs `extend` vs `prepend`

```ruby
module Describable
  def describe = "I am a #{self.class}"
end

class Widget
  include Describable   # adds Describable's methods as *instance* methods
end

class Report
  extend Describable    # adds Describable's methods to Report itself (class-level)
end

Widget.new.describe   # => "I am a Widget"
Report.describe        # => "I am a Report"
```

`include` insere o módulo *depois* da classe na cadeia de busca (os próprios
métodos da classe vencem); `prepend` o insere *antes* (os métodos do módulo
vencem, e podem chamar `super` para alcançar a versão da própria classe);
`extend` adiciona os métodos do módulo diretamente à classe singleton do
receptor; o uso mais comum é `extend AlgumModulo` dentro de um corpo de
classe para adicionar "métodos de classe".

### `super` não significa "a superclasse"; significa "o próximo passo na cadeia"

```ruby
class Greeter
  prepend Loud
  def greet = "hello"
end
```

Dentro de `Loud#greet`, `super` resolve para o que quer que venha *a seguir*
em `Greeter.ancestors` depois de `Loud`, que é o próprio `Greeter`, não a
superclasse do próprio `Loud`. `super` sempre continua a partir de onde o
método *atual* foi encontrado na cadeia, o que é o motivo de a decoração
baseada em `prepend` funcionar: o módulo não precisa saber em qual classe ele
vai eventualmente ser prependado.

## Trade-offs

- **Variáveis de instância dentro de um mixin compartilham o mesmo namespace
  da classe hospedeira.** Um módulo que define `@cache` dentro de um de seus
  métodos pode colidir silenciosamente com uma ivar `@cache` que a classe
  que inclui também usa; mixins são melhores quando mantidos sem estado, ou
  com nomes de ivar deliberadamente incomuns.
- **Cadeias profundas de `include` tornam "qual método de fato roda" difícil
  de responder lendo o código**: `ancestors` é a verdadeira fonte da
  verdade, não o arquivo onde um método é definido.
  ```ruby
  Greeter.ancestors.each { |m| puts m }
  ```
- **`prepend` para decorar um método que você não é dono (fazer monkey
  patch em uma gem) é mais seguro do que reabrir a classe e redefinir o
  método completamente**, porque `super` ainda alcança a implementação
  original em vez de precisar salvá-la e rechamá-la manualmente, mas ainda
  assim acopla seu código aos internos daquela gem entre atualizações de
  versão, então é uma ferramenta pontual, não um padrão.

## Documentation Links

- [Module#include, #prepend, #extend, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html) (doc)
- [Object#method, #singleton_class, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html) (doc)
- [Programming Ruby 3.3 (Pickaxe), Sharing Functionality: Inheritance, Modules, and Mixins](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
