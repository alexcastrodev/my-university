---
version: 1.0
updatedAt: 2026-08-18
title: "Ruby::Box: Isolamento de Namespace em Processo"
summary: O container experimental do Ruby 4.0 para isolar constantes, monkey patches e bibliotecas carregadas dentro de um único processo; o que ele de fato separa, e por que é isolamento de namespace, não paralelismo.
---
## Objective

O Ruby nunca teve uma forma de dizer "carregue esse código aqui, e mantenha
o que quer que ele faça só para si mesmo". Um `require` muta uma única
tabela global de constantes; um monkey patch aplicado em qualquer lugar é
aplicado em todo lugar; e exatamente uma versão de uma gem pode ser
carregada por processo, para sempre. `Ruby::Box`, o recurso experimental que
veio com o Ruby 4.0 (dezembro de 2025), é a primeira resposta real a isso:
um container dentro de um único processo que tem suas próprias constantes,
suas próprias classes e módulos, suas próprias variáveis globais, e sua
própria cópia das extensões nativas que carrega. Este conceito cobre o que
uma box de fato isola, a pequena superfície de API que existe hoje, e, tão
importante quanto, por que isso *não* é um recurso de concorrência e ainda
não é algo para construir infraestrutura crítica em cima.

## Use Cases

- Rodar cada arquivo de teste dentro de sua própria box para que um monkey
  patch ou uma mudança de estado global em um teste não vaze para o
  próximo, sem pagar por um processo novo a cada teste.
- Deploy blue-green dentro de um único processo: duas versões da mesma
  aplicação carregadas em boxes paralelas, com o tráfego alternado entre
  elas, em vez de dois processos implantados separadamente.
- Avaliar uma atualização de dependência carregando as versões antiga e nova
  da gem em duas boxes no mesmo processo, enviando a mesma entrada para as
  duas, e comparando as respostas antes de se comprometer com a mudança.
- Multi-tenancy onde os tenants trazem seus próprios plugins ou patches:
  cada código de tenant carregado em sua própria box para que o override de
  `String#blank?` de um cliente não alcance a requisição de outro.
- O clássico caso de inferno de dependências: duas de suas próprias gems
  precisando de versões incompatíveis de uma terceira, o que o Bundler não
  consegue resolver hoje porque o RubyGems só consegue ativar uma versão por
  processo.
- Recarregamento de código em um servidor de desenvolvimento, onde o
  objetivo é "descartar tudo que aquele arquivo definiu" em vez de
  "defini-lo de novo por cima".

## Deep Dive

### Ligando o recurso

Boxing vem desligado por padrão e não é algo que você consegue ativar em
tempo de execução. Precisa ser solicitado no boot do processo através de
uma variável de ambiente, e `1` é o único valor que o ativa:

```bash
RUBY_BOX=1 ruby app.rb
```

Definir `RUBY_BOX` de dentro de um programa em execução não faz nada; a
infraestrutura de boxing é inicializada durante a sequência de boot do
interpretador, antes de seu código existir. Essa porta de opt-in é
deliberada: isolamento tem um custo real, então o core team escolheu não
fazer todo processo Ruby pagar por ele.

Dois métodos de classe deixam o código checar onde está:

```ruby
Ruby::Box.enabled?   # => true when the process was booted with RUBY_BOX=1
Ruby::Box.current    # => the box this code is running in, or nil when disabled
```

`Ruby::Box.current` retornando `nil` em vez de levantar exceção é o formato
que você quer para código de biblioteca que precisa rodar tanto em
processos com box quanto sem; proteja com `enabled?` e recorra ao `require`
comum como fallback.

### Criando uma box e carregando código nela

Uma box é um objeto. Você cria uma, depois carrega código *através dela* em
vez de através do `require` de nível superior:

```ruby
box = Ruby::Box.new

box.require("some_gem")            # resolved against the box's own load path
box.require_relative("greetings")  # relative to the current file
box.load("config/patches.rb")      # direct file execution
box.eval("SomeClass.configure!")   # a code string, evaluated inside the box
```

Tudo que essas chamadas trazem, e tudo que *esses* arquivos requerem por
sua vez, recursivamente, cai dentro da box. Isso inclui extensões nativas:
um `.so` / `.bundle` carregado dentro de uma box fica confinado a ela, que é
a parte que torna carregar duas versões de uma gem apoiada em C no mesmo
processo sequer concebível.

Cada box também carrega seu próprio load path, que é o gancho para a
história de múltiplas versões:

```ruby
box.load_path   # => the box's local $LOAD_PATH array
```

Constantes definidas dentro de uma box são alcançáveis de fora usando
resolução de escopo comum no próprio objeto box:

```ruby
box = Ruby::Box.new
box.require_relative("greetings")
puts box::Greetings.say_hello("Edy")
```

Essa é a ponte inteira: a box age como um namespace no qual você indexa.
Duas boxes podem cada uma definir `Greetings`, e `box_a::Greetings` e
`box_b::Greetings` são classes diferentes.

### O que de fato é isolado

As notas de lançamento colocam isso como "separação sobre definições", e
essa frase merece ser levada ao pé da letra. Uma box separa:

- constantes, e portanto definições de classe e módulo;
- variáveis globais e de classe;
- monkey patches aplicados a classes do core;
- bibliotecas Ruby e nativas carregadas.

Então um patch aplicado dentro de uma box simplesmente não existe fora
dela:

```ruby
# patches.rb — loaded into a box
class String
  def shout = upcase + "!"
end
```

```ruby
box = Ruby::Box.new
box.require_relative("patches")
box.eval('puts "hello".shout')   # => HELLO!

"hello".shout                    # => NoMethodError in the root box
```

O que uma box *não* faz é te dar um heap de objetos separado. Tudo ainda
vive em um único processo, compartilhando memória e um único GC. Esse é o
motivo inteiro de uma box ser mais barata que um segundo processo, e também
o motivo de as arestas afiadas estarem onde estão. Passar um objeto através
de uma fronteira de box quando as duas boxes têm sua própria definição da
classe daquele objeto é precisamente o território que o rótulo
"experimental" cobre; trate a troca de objetos entre boxes como algo a
verificar contra a implementação atual, não a assumir.

### O arquivo é a fronteira

A regra que surpreende as pessoas: um arquivo `.rb` executa inteiramente
dentro de uma box, e os métodos e procs que ele define permanecem vinculados
àquela box *não importa quem os chame depois*. Um método carregado em uma
box e invocado a partir da box raiz ainda resolve suas constantes através do
caminho de busca da box.

```ruby
box.require_relative("helper")
box.eval("process(my_data)")     # `process` runs with the box's constants
```

Isso é um recurso, não um acidente: é o que impede o isolamento de se
desfazer no momento em que um callback cruza a fronteira. Mas significa que
"em qual box eu estou" é determinado por onde o código foi *carregado*, não
por de onde veio a chamada, o que é um modelo mental diferente das mudanças
de escopo estilo `instance_eval` que seguem o chamador. Se você está
acostumado a raciocinar sobre `self` e classes singleton para prever a
busca, note que uma box fica um nível acima de tudo isso: ela troca a
tabela de constantes que toda a busca percorre, em vez de mudar com qual
objeto você está falando.

### Boxes não são Ractors

A coisa mais importante de deixar clara. Ractors existem para escapar da
GVL e rodar código Ruby em vários núcleos em paralelo; eles compram
isolamento como o *preço* do paralelismo, o que é o motivo de imporem as
regras de compartilhamento que os tornam tão incômodos de adotar.
`Ruby::Box` é a troca oposta: compra isolamento e não pede nada em termos
de disciplina de compartilhamento de objetos, mas não te dá nenhuma
execução paralela. Código em uma box roda nas mesmas threads, sob a mesma
GVL, que tudo o mais.

Concretamente: "rodar duas versões da aplicação em boxes paralelas"
significa duas versões *coexistindo*, não duas versões executando
simultaneamente em dois núcleos. Se seu problema é vazão limitada por CPU,
uma box não faz nada por você. Se seu problema é "esses dois pedaços de
código não conseguem concordar sobre o que `Foo` significa", uma box é
exatamente a ferramenta, e Ractors nunca foram.

## Trade-offs

- **Experimental significa experimental**: o Ruby 4.0 traz isso com um
  aviso explícito sobre arestas ásperas e instabilidade, e a API é descrita
  como ainda em evolução. Os métodos acima são o que a 4.0 documenta;
  confira a documentação atual antes de escrever qualquer coisa crítica
  contra eles, porque este é um dos poucos recursos do Ruby onde um release
  de ponto poderia razoavelmente mudar a superfície.
- **Isolamento não é de graça**: há overhead real de performance, e é por
  isso que o subsistema inteiro fica atrás de uma variável de ambiente em
  vez de ligado por padrão. Uma suíte de testes que faz box de cada arquivo
  está trocando tempo de relógio por independência entre testes; essa troca
  costuma valer a pena, mas meça em vez de assumir que é mais barato do que
  o fork que você já faz.
- **Não é um mecanismo de paralelismo**: vale repetir porque o enquadramento
  de "rodar duas versões de aplicação em paralelo" convida à leitura errada.
  Boxes dão separação de namespace sem concorrência. Ractors dão paralelismo
  com restrições dolorosas de compartilhamento. Nenhum substitui o outro, e
  recorrer a uma box para resolver um problema de vazão vai produzir um
  programa mais lento.
- **A porta `RUBY_BOX=1` é uma questão de deploy, não de código**: uma
  biblioteca não consegue ligar o boxing por conta própria. Qualquer coisa
  que você construa sobre boxes só funciona se quem inicia o processo
  cooperar, então código de biblioteca precisa de um caminho de fallback com
  `enabled?` e você precisa da flag conectada em todo lugar onde a aplicação
  inicializa: Procfile, unidade systemd, Dockerfile, CI, e o executor de
  testes.
- **Heap compartilhado, definições separadas**: a economia de memória
  comparada a rodar dois processos é o ponto principal, mas também
  significa que uma box não é uma fronteira de segurança. Código não
  confiável em uma box ainda compartilha o processo, o GC, os descritores
  de arquivo, e a capacidade de sair. Use boxes para isolar *seu* código de
  si mesmo; use processos ou containers para isolar código no qual você não
  confia.
- **A prontidão do ecossistema está atrás do recurso**: os casos de uso
  interessantes (gems multi-versão, plugins por tenant, recarregamento)
  todos assumem que gems e frameworks se comportam bem quando carregados
  mais de uma vez em um processo. Muitas gems mantêm estado de formas que
  são anteriores a esse recurso sequer existir. Espere encontrar a quebra
  você mesmo em vez de encontrá-la documentada.

## Documentation Links

- [Ruby 4.0.0 Released, ruby-lang.org (Ruby Box)](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) (doc)
- [Ruby::Box, Ruby Core docs](https://docs.ruby-lang.org/en/4.0/Ruby/Box.html) (doc)
- [Ruby 4.0.0 introduces ZJIT compiler, Ruby Box isolation, InfoWorld](https://www.infoworld.com/article/4113436/ruby-4-0-0-introduces-zjit-compiler-ruby-box-isolation.html) (doc)
- [Ruby 4.0 Introduces Ruby::Box for In-Process Isolation, Prateek Codes](https://prateekcodes.com/ruby-4-introduces-ruby-box-for-in-process-isolation-part-1/) (doc)
- [Everything you need to know about Ruby 4.0, Honeybadger](https://www.honeybadger.io/blog/ruby-4/) (doc)
