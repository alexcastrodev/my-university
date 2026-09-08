---
version: 1.0
updatedAt: 2026-08-18
title: "self, Classes Singleton, e Por Que Métodos de Classe Não Existem de Verdade"
summary: self controla onde @var mora e quem recebe uma chamada de método nua; classes singleton explicam por que "métodos de classe" são só métodos definidos no próprio objeto classe.
---
## Objective

`self` é uma variável interna somente leitura que controla exatamente duas
coisas: de onde uma `@var` nua é lida e onde é escrita, e quem recebe uma
chamada de método escrita sem receptor explícito. Todo objeto também pode
ter uma *classe singleton*: uma classe anônima inserida diretamente acima
dele, guardando métodos que pertencem só àquele objeto. Junte esses dois
fatos e "métodos de classe" deixam de ser um recurso especial: dentro de
`class Foo`, `self` **é** o objeto classe `Foo`, então `def self.bar` é só um
método singleton definido em um objeto particular que por acaso é uma
classe.

## Use Cases

- Depurar a surpresa clássica de `class Foo; @count = 0; end`, onde a ivar é
  invisível de todo método de instância porque mora no objeto classe.
- Escrever configuração de nível de classe para uma gem ou objeto de serviço
  (`class << self; attr_accessor :logger; end`) em vez de recorrer a globais.
- Anexar comportamento a exatamente um objeto (um stub em um teste, um
  handler de callback avulso) com `def obj.method` ou
  `obj.extend(SomeModule)`.
- Explicar por que métodos de classe são herdados por subclasses sem
  ninguém escrever código para fazer isso acontecer.
- Construir classes em tempo de execução com `Struct.new`, `Data.define`, ou
  `Class.new` e atribuí-las a constantes, fazer subclasse delas, ou reabri-las
  com um bloco.

## Deep Dive

### O que `self` de fato controla

```ruby
class Counter
  def initialize = @count = 0

  def increment
    @count += 1   # @count is looked up on self, the Counter instance
    report        # no receiver: sent to self
    self          # the object the method was called on
  end

  private

  def report = puts("count is now #{@count}")
end

c = Counter.new
c.increment   # prints "count is now 1"
```

Chamar `c.increment` define `self` como `c` durante o método, e restaura o
`self` anterior quando retorna. Essa única regra explica os dois
comportamentos acima: `@count` resolve contra as próprias variáveis de
instância de `c`, e a chamada sem receptor para `report` é enviada para `c`
(que também é o motivo de um método `private` poder ser chamado dessa forma;
não há receptor explícito).

### A armadilha do corpo de classe: `self` é o objeto classe

Dentro de um corpo de classe ou módulo, fora de qualquer definição de
método, `self` é o próprio objeto classe. Então uma atribuição ali cria uma
variável de instância **na classe**, não em instâncias futuras:

```ruby
class Config
  @setting = "class-level"

  def setting = @setting        # self here is a Config *instance*
  def self.setting = @setting   # self here is the Config *class*
end

Config.new.setting   # => nil
Config.setting       # => "class-level"
```

Os dois métodos contêm o texto-fonte idêntico `@setting`, e leem duas
variáveis diferentes, porque rodam com dois valores diferentes de `self`. O
`nil` de `Config.new.setting` não é um erro; uma variável de instância não
definida simplesmente lê como `nil`, o que é o motivo de esse bug ser
silencioso em vez de barulhento.

### Métodos singleton e a classe singleton

`def obj.method` diz ao Ruby para criar uma classe anônima específica para
`obj` (a *classe singleton*, também chamada eigenclass), colocar o método
ali, e tornar a classe original de `obj` a superclasse dessa classe
singleton:

```ruby
greeting = "hello"

def greeting.shout = upcase + "!"

greeting.shout                       # => "HELLO!"
"hello".shout                        # NoMethodError, a different String object
greeting.singleton_class             # => #<Class:#<String:0x000000010a3c4d20>>
greeting.singleton_class.superclass  # => String
greeting.singleton_methods           # => [:shout]
```

`class << obj` é a sintaxe alternativa para abrir essa mesma classe
singleton, e é a que se usa ao definir vários métodos de uma vez. Dentro
desse bloco, `self` é a própria classe singleton:

```ruby
class << greeting
  def whisper = downcase
  def shout = upcase + "!!!"
end
```

Isso também é o que `extend` faz por baixo dos panos:
`obj.extend(SomeModule)` mistura o módulo na classe singleton de `obj`, o
que é o motivo de os métodos do módulo ficarem disponíveis naquele único
objeto e em nenhum outro lugar.

### "Métodos de classe" são métodos singleton no objeto classe

Como `self` dentro de `class Foo` é o objeto `Foo`, essas três definições
são a mesma coisa escrita de três formas:

```ruby
class Registry
  def self.register(x) = entries << x   # most common
end

def Registry.register(x) = entries << x # explicit receiver, identical result

class Registry
  class << self
    def register(x) = entries << x      # opening the singleton class directly
  end
end
```

Não existe nenhum armazenamento separado de "método de classe" em lugar
nenhum do interpretador; as três colocam `register` na tabela de métodos de
`Registry.singleton_class`. E como o Ruby mantém a hierarquia de classes
singleton paralela à hierarquia de classes normal, a herança de método de
classe surge de graça:

```ruby
class Base
  def self.describe = "I am #{name}"
end

class Child < Base; end

Child.describe                              # => "I am Child"
Child.singleton_class.superclass == Base.singleton_class  # => true
```

`Child.describe` é encontrado pela busca de lookup comum, só que começando a
partir da classe singleton de `Child` em vez de a partir de `Child`. Note
que `self` dentro de `describe` é `Child` quando chamado dessa forma, que é
o que faz `name` retornar `"Child"`.

### O idioma `class << self; attr_accessor; end`

Como `attr_accessor` define métodos em qualquer que seja `self` no momento,
chamá-lo dentro de `class << self` os define na classe singleton, produzindo
getters e setters para variáveis de instância de nível de classe:

```ruby
class HttpClient
  class << self
    attr_accessor :base_url, :timeout
  end

  self.timeout = 5

  def initialize(url: self.class.base_url) = @url = url
end

HttpClient.base_url = "https://api.example.com"
HttpClient.base_url   # => "https://api.example.com"
HttpClient.timeout    # => 5
```

Escrito como um `attr_accessor :base_url` simples no corpo da classe, você
teria acessores em nível de instância em vez disso; mesmo método, `self`
diferente, lugar diferente onde os métodos caem.

### Visibilidade de um método herdado

Mudar a visibilidade de um método herdado em uma subclasse funciona sem
tocar no pai:

```ruby
class Parent
  private def secret = "shh"
end

class Child < Parent
  public :secret   # now callable with an explicit receiver on Child instances
end
```

O Ruby lida com isso inserindo um método proxy oculto em `Child` que
simplesmente chama `super` com a nova visibilidade. `Parent#secret` em si
fica intocado, então outras subclasses (e instâncias de `Parent`) mantêm a
visibilidade original.

### Classes são objetos, então qualquer coisa que retorne uma classe funciona

`Struct.new`, `Data.define`, e `Class.new` são chamadas de método comuns que
retornam objetos classe de verdade. Em qualquer lugar onde o Ruby espera
uma classe, uma expressão que avalia para uma é igualmente válida:

```ruby
# Assigned to a constant, the class picks up the constant's name
Person = Struct.new(:name, :address) do
  def to_s = "#{name} of #{address}"
end

# Used directly as a superclass
class Employee < Struct.new(:name, :salary)
  def annual = salary * 12
end

# Immutable value object (Ruby 3.2+)
Point = Data.define(:x, :y)
p1 = Point.new(x: 1, y: 2)
p2 = p1.with(y: 9)   # => #<data Point x=1, y=9>, a new instance
p1.to_h              # => {x: 1, y: 2}

# Fully dynamic
audit_log = Class.new(Employee) do
  def self.kind = "audit"
end
audit_log.name           # => nil, it's anonymous
AuditLog = audit_log
AuditLog.name            # => "AuditLog", naming happens on constant assignment
```

Uma classe anônima fica sem nome até ser atribuída a uma constante, momento
em que ela adota permanentemente o nome daquela constante. Se você quer um
nome legível para depuração sem introduzir uma constante,
`Module#set_temporary_name` (Ruby 3.3+) dá um que uma atribuição de
constante posterior ainda pode sobrescrever.

> ⚠️ **Livro vs. hoje (Ruby 3.4+):** o livro imprime hashes da forma antiga,
> então os exemplos mostram a saída de `to_h` como `{:x=>1, :y=>2}`. O Ruby
> 3.4 mudou `Hash#inspect` para renderizar chaves symbol na forma
> abreviada, então a mesma chamada agora imprime `{x: 1, y: 2}`. Só a
> exibição mudou (o hash é idêntico), mas isso vai morder qualquer teste
> que faça asserção sobre a saída de `inspect` ou sobre uma string de hash
> interpolada.

## Trade-offs

- **Uma variável de instância de nível de classe não é herdada, mesmo que o
  método de classe que a lê seja.** `@setting` mora em um objeto classe
  específico, então uma subclasse começa com `nil` para ela:
  ```ruby
  class Base
    @format = :json
    def self.format = @format
  end
  class Child < Base; end

  Base.format    # => :json
  Child.format   # => nil, Child is a different object with its own ivars
  ```
  Essa é exatamente a lacuna que o `class_attribute` do Rails existe para
  preencher; em Ruby puro você ou aceita isso ou escreve um hook `inherited`
  para copiar o valor para baixo.
- **`private` se comporta diferente para métodos de classe do que para
  métodos de instância.** Um `private` nu no corpo da classe não tem efeito
  em métodos `def self.` definidos depois dele; você precisa de
  `private_class_method :name`, ou um `private` dentro de um bloco
  `class << self`, que é mais um motivo para preferir a forma `class <<
  self` quando vários métodos de classe estão envolvidos.
- **Métodos singleton por objeto tornam objetos não uniformes, e isso tem
  custos reais.** São invisíveis ao ler a definição da classe, não aparecem
  em `SomeClass.instance_methods`, e derrotam o cache de método baseado em
  classe do interpretador para aquele objeto. Também simplesmente não
  existem para alguns valores: objetos imediatos e objetos congelados os
  rejeitam.
  ```ruby
  n = 42
  def n.double = self * 2       # TypeError: can't define singleton

  s = "frozen".freeze
  def s.shout = upcase          # TypeError: can't define singleton
  ```
  Reserve-os para casos genuinamente avulsos (stubs de teste, uma única
  instância configurada); quando vários objetos precisam do comportamento,
  um módulo ou uma subclasse é mais claro.
- **`class << self` é poderoso, mas opaco para iniciantes.** Para um único
  método de classe, `def self.foo` comunica a intenção sem exigir nenhum
  vocabulário de metaprogramação; a sintaxe de classe singleton se justifica
  quando você precisa de controle de visibilidade, `attr_accessor`, ou um
  bloco de várias definições.

## Documentation Links

- [Object#singleton_class, #singleton_methods, #extend, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html) (doc)
- [Module#private_class_method, #attr_accessor, #define_method, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html) (doc)
- [Data, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Data.html) (doc)
- [Programming Ruby 3.3 (Pickaxe), The Ruby Object Model and Metaprogramming](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
