---
version: 1.0
updatedAt: 2026-08-17
title: "Reflexão e Introspecção"
summary: method_missing vs. define_method, source_location, ObjectSpace, e os hooks included/extended por trás do ActiveSupport::Concern.
---
## Objective

O Ruby permite inspecionar e manipular quase tudo sobre um programa em
execução a partir de dentro do próprio programa: todo objeto vivo, a
localização de origem e os parâmetros de todo método, a ancestralidade de
toda classe, e, via `method_missing` e `define_method`, a capacidade de
fabricar métodos que nunca foram de fato escritos. Esse é o maquinário por
trás de DSLs, ORMs e bibliotecas de mocking, e entendê-lo é o que faz "como o
ActiveRecord sabe sobre colunas que nunca declarou como métodos" deixar de
ser magia.

## Use Cases

- Construir uma DSL ou API de configuração onde chamadas de método devem
  mapear dinamicamente para dados (o mecanismo por trás do `OpenStruct`, e
  por trás dos acessores de atributo do ActiveRecord).
- Depurar "de onde esse método realmente vem" para um método definido via
  metaprogramação, usando `source_location` e `owner`.
- Escrever uma biblioteca de mock/stub, ou entender como uma funciona, via
  `define_singleton_method` e introspecção de método.
- Auditar uso de memória percorrendo todos os objetos vivos de uma classe
  dada com `ObjectSpace.each_object`.

## Deep Dive

### `method_missing`: métodos que não existem até serem chamados

```ruby
class DynamicConfig
  def initialize(data) = @data = data

  def method_missing(name, *args)
    key = name.to_s.chomp("=")
    return @data[key] = args.first if name.to_s.end_with?("=")
    @data.fetch(key) { super }
  end

  def respond_to_missing?(name, include_private = false)
    true
  end
end

config = DynamicConfig.new({})
config.timeout = 30
config.timeout   # => 30
```

`method_missing` é o último passo da cadeia de busca de métodos do Ruby; só
roda quando nada mais na cadeia de ancestrais casou. Toda sobrescrita deveria
ser pareada com `respond_to_missing?`; pular isso significa que
`respond_to?` mente sobre o que o objeto de fato consegue fazer, o que
quebra qualquer coisa que verifica antes de chamar (incluindo depuração
simples).

### `define_method`: métodos gerados no momento da definição da classe

```ruby
class Product
  %i[name price stock].each do |attr|
    define_method(attr) { instance_variable_get("@#{attr}") }
    define_method("#{attr}=") { |v| instance_variable_set("@#{attr}", v) }
  end
end
```

Diferente de `method_missing` (que intercepta chamadas em tempo de
execução, em toda chamada), `define_method` gera métodos reais e comuns uma
vez, no momento de carregamento da classe: mais rápido por chamada, e
visível em `instance_methods`/`respond_to?` sem trabalho extra nenhum.
Prefira `define_method` a `method_missing` sempre que o conjunto completo de
nomes de método for conhecido de antemão (como é aqui); recorra a
`method_missing` só quando os nomes forem genuinamente ilimitados ou
desconhecidos de antemão.

### Introspeccionando objetos, classes e métodos

```ruby
"hello".method(:upcase).source_location   # => nil (C-implemented, no Ruby source)
config.method(:timeout).owner              # => DynamicConfig
Product.instance_methods(false)            # methods defined directly on Product
ObjectSpace.each_object(Product).count     # every live Product instance right now
```

`Method#source_location` e `#owner` funcionam mesmo para métodos definidos
dinamicamente via `define_method` ou despachados através de
`method_missing`; essa é a forma prática de responder "de onde esse método
realmente vem" em código que usa metaprogramação pesada, em vez de fazer
grep nos arquivos fonte. `ObjectSpace.each_object` percorre todo objeto vivo
de uma classe, útil para auditorias pontuais de memória (`require
"objspace"` primeiro, para os métodos de introspecção mais pesados; a
enumeração básica não precisa disso).

### Métodos hook: reagindo a eventos de nível de classe

```ruby
module Trackable
  def self.included(base)
    base.extend(ClassMethods)
  end

  module ClassMethods
    def track_changes_for(*attrs)
      attrs.each { |a| puts "Tracking #{a} on #{self}" }
    end
  end
end

class Order
  include Trackable
  track_changes_for :status, :total
end
```

`included`/`extended`/`inherited` são hooks que o Ruby chama
automaticamente no momento em que um módulo é misturado ou uma classe é
subclassificada; a forma padrão de um mixin adicionar comportamento de
nível de classe (`ClassMethods`) ao mesmo tempo em que adiciona
comportamento de nível de instância, que é o mecanismo por trás do
`ActiveSupport::Concern`.

## Trade-offs

- **`method_missing` paga um custo real por chamada comparado a um método
  real**, porque toda chamada primeiro falha na cadeia de busca normal
  antes de cair nele; para um caminho quente com um conjunto conhecido e
  fixo de nomes de método, `define_method` no momento do carregamento da
  classe é ao mesmo tempo mais rápido e mais introspeccionável.
- **Sobrescrever `method_missing` sem `respond_to_missing?` faz
  `respond_to?` mentir**: qualquer código (incluindo um depurador, ou uma
  biblioteca fazendo checagens de duck typing) que pergunta "esse objeto
  consegue fazer X?" antes de chamar X recebe uma resposta errada.
- **`ObjectSpace.each_object` e companhia carregam overhead real e são uma
  ferramenta de desenvolvimento/diagnóstico, não algo para chamar em um
  caminho de requisição quente**: `require "objspace"` em particular
  adiciona overhead de rastreamento que deveria ficar fora de código de
  produção.

## Documentation Links

- [Object#method_missing, #respond_to_missing?, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/BasicObject.html#method-i-method_missing) (doc)
- [Module#define_method, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Module.html#method-i-define_method) (doc)
- [ObjectSpace, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/ObjectSpace.html) (doc)
