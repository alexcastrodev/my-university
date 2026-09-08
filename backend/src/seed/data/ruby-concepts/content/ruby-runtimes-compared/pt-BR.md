---
version: 1.0
updatedAt: 2026-08-18
title: "YJIT, TruffleRuby e JRuby: Escolhendo uma Runtime Ruby"
summary: Por que o YJIT só compensa em processos de longa duração, o que TruffleRuby e JRuby de fato trocam por velocidade e interoperabilidade com Java, e quando trocar de runtime é a resposta errada.
---
## Objective

"Ruby" na conversa do dia a dia significa CRuby/MRI rodando a máquina
virtual YARV, mas essa é uma implementação de uma linguagem que tem várias.
O YJIT (um compilador JIT que vem dentro do próprio CRuby) consegue acelerar
a runtime que você já tem com uma flag. TruffleRuby e JRuby são runtimes
separadas que trocam compatibilidade com o CRuby por performance de pico ou
interoperabilidade com a JVM. mRuby é um subconjunto deliberadamente
incompleto para embarcar. Escolher entre elas quase nunca é uma decisão pura
de performance; é uma decisão sobre quais gems, quais extensões C, e quais
recursos de linguagem você está disposto a abrir mão.

## Use Cases

- Ligar o YJIT para um processo Rails ou Sidekiq de longa duração, onde o
  JIT tem tempo para aquecer e o código compilado é reutilizado em milhares
  de requisições.
- Deliberadamente *não* ligar o YJIT para um script CLI de vida curta ou uma
  função estilo Lambda que termina antes de a compilação compensar.
- Recorrer ao JRuby quando o requisito real é "chamar essa biblioteca Java"
  ou "rodar Ruby ligado a CPU em threads paralelas dentro de um processo".
- Avaliar o TruffleRuby para uma carga de trabalho pesada em computação e
  leve em gems, onde vazão bruta importa mais que amplitude de ecossistema.
- Embarcar mRuby como uma camada de script dentro de um programa C ou em
  hardware restrito, onde o CRuby completo não caberia.
- Ler um post de blog de benchmark e saber qual runtime ele de fato está
  medindo antes de tirar uma conclusão sobre "Ruby ser lento".

## Deep Dive

### YARV: a base que você já está rodando

Desde o Ruby 1.9, o interpretador padrão é o YARV ("Yet Another Ruby VM").
Os nomes CRuby, MRI (Matz's Ruby Interpreter) e YARV são usados de forma
intercambiável na prática; CRuby/MRI nomeia a implementação em C, YARV
nomeia a VM de bytecode dentro dela.

O YARV compila seu código-fonte para um bytecode interno antes de
interpretá-lo. Diferente da JVM, esse bytecode não é um artefato externo que
você entrega; não existe um arquivo `.rbc` para fazer deploy, e o passo de
compilação acontece a cada boot. Você ainda consegue olhar para ele:

```ruby
puts RubyVM::InstructionSequence.compile("a = 1 + 2").disasm
```

Isso é uma ferramenta de depuração e ensino, não um passo de build. Também
explica um fato prático: o tempo de boot do Ruby inclui parsear e compilar
todo arquivo que você dá `require`, o que é o motivo de aplicações Rails
grandes pagarem um custo de inicialização visível.

### YJIT: o que importa na prática

O CRuby já lançou mais de um JIT ao longo dos anos. O Ruby 3.3 até a 3.4
também trazia o **RJIT**, um sucessor em Ruby puro do antigo MJIT, uma ideia
elegante (o JIT é hackeável por programadores Ruby) que sempre foi rotulada
experimental e nunca recomendada para produção. O Ruby 4.0 **removeu o RJIT
completamente**; a flag se foi.

O **YJIT** é o que importa na prática. É escrito em Rust, lançado
experimentalmente no Ruby 3.1, e é considerado pronto para produção desde o
Ruby 3.2, com ganhos substanciais na 3.3 e versões seguintes. Sua técnica
central é **versionamento preguiçoso de blocos básicos (LBBV)**: em vez de
compilar um método inteiro de antemão, ele compila blocos básicos
individuais *conforme são executados pela primeira vez*, e cria uma versão
compilada separada de um bloco para cada conjunto de tipos observados em
tempo de execução.

Isso importa porque o Ruby é dinamicamente tipado e quase toda operação é
uma chamada de método. Em `a + b`, o interpretador precisa checar o que `a`
é antes de saber qual `+` rodar. Se o YJIT já observou que um dado bloco
sempre vê receptores `Integer`, ele compila uma versão especializada para
`Integer` com a checagem de tipo reduzida a uma guarda barata, e pula direto
para a soma de inteiros. A parte "preguiçoso" significa que ele nunca gasta
tempo compilando caminhos de código que seu programa de fato não percorre,
uma grande diferença em um framework como o Rails, onde a maior parte do
código carregado nunca roda no caminho quente.

Ligá-lo é uma flag ou uma variável de ambiente:

```bash
ruby --yjit app.rb
RUBY_YJIT_ENABLE=true bundle exec puma
```

```ruby
# Check at runtime whether YJIT is actually on
RubyVM::YJIT.enabled?    # => true / false
RubyVM::YJIT.runtime_stats  # requires a stats-enabled build
```

A pegadinha é o aquecimento. O YJIT só compila um método depois que ele foi
chamado um certo número de vezes (o limite padrão de chamadas é 30, e o
CRuby o aumenta automaticamente para aplicações muito grandes, para que
código pesado no boot do Rails não inunde o cache de código). Código
compilado também custa memória. Então o YJIT é um ganho claro para um
worker Puma atendendo tráfego por horas, e próximo de puro overhead para
`ruby script_avulso.rb`.

> ⚠️ **Livro vs. hoje:** *Programming Ruby 3.3* foi escrito antes de tudo
> isso; na época, RJIT era a segunda trilha de JIT do CRuby. O Ruby 4.0 o
> removeu e o substituiu pelo ZJIT (abaixo). Confira as notas de lançamento
> da versão exata do Ruby que você está rodando antes de assumir quais
> JITs ela traz.

### ZJIT: a próxima direção experimental, não um substituto do YJIT

O Ruby 4.0 introduziu o **ZJIT**, construído pelo mesmo time por trás do
YJIT, mas em uma arquitetura deliberadamente diferente: um JIT **baseado em
método** usando uma representação intermediária SSA (atribuição única
estática), mais próximo de como um compilador otimizador "de livro-texto" é
construído. Onde o YJIT compila e especializa preguiçosamente blocos
básicos individuais conforme rodam, o ZJIT compila no nível do método, uma
estratégia que o time espera que tenha um **teto de performance de longo
prazo mais alto**, ao custo de a engenharia ser mais nova e menos testada em
batalha.

O ZJIT vem incluído no lançamento do Ruby 4.0, mas **não é compilado nem
ativado por padrão**; requer Rust 1.85+ para compilar e é habilitado
explicitamente por opt-in:

```bash
ruby --zjit app.rb
```

Duas coisas importam para como você deve tratá-lo hoje:

- **O YJIT continua sendo a recomendação de produção.** O ZJIT é
  explicitamente enquadrado como a fundação para trabalho futuro de
  compilador, não uma atualização direta; ainda não há migração a fazer.
- **Os dois não são mutuamente exclusivos no roteiro.** O objetivo de
  design declarado do ZJIT é uma arquitetura de compilador mais acessível e
  amigável a contribuidores (um method-JIT tradicional é mais fácil de
  raciocinar e estender do que o versionamento preguiçoso de blocos
  básicos), o que importa para a velocidade de longo prazo da linguagem
  antes mesmo de importar para a latência da sua aplicação.

Trate o ZJIT como você trataria qualquer flag experimental de
interpretador: vale a pena testar contra um benchmark representativo em um
ambiente inferior, não vale a pena usar em produção enquanto o YJIT está
disponível e comprovado.

### TruffleRuby: performance de pico, compatibilidade parcial

TruffleRuby é uma implementação de terceiros rodando sobre a **GraalVM**,
construída com o framework de linguagem Truffle e o compilador otimizador
agressivo do Graal. Sua afirmação principal é real: em alguns benchmarks
ligados a CPU, ele é várias vezes mais rápido que o CRuby, porque o Graal
consegue fazer inline e especializar através de fronteiras de método Ruby de
formas que um interpretador não consegue.

Uma escolha de design incomum torna isso possível: o TruffleRuby
**reimplementa boa parte da biblioteca core em Ruby puro** em vez de C.
Métodos que são funções C no CRuby são métodos Ruby comuns no TruffleRuby, o
que significa que o JIT consegue enxergar através deles e otimizá-los junto
com o seu código, em vez de tratá-los como chamadas nativas opacas.

Os custos são compatibilidade e aquecimento:

- Ele passa aproximadamente 97% do ruby-spec; alto, mas "aproximadamente
  97%" em uma linguagem tão reflexiva quanto essa significa que programas
  reais ainda encontram lacunas.
- O ecossistema de gems é mais estreito. Gems com **extensões nativas em
  C** são o problema principal; o TruffleRuby consegue rodar algumas delas
  através de sua camada de bitcode LLVM, mas lentamente e não
  universalmente.
- Velocidade de pico exige aquecimento. Rodar na JVM dá o teto mais alto,
  mas a inicialização mais lenta; a build Native Image inicia rápido, mas
  não alcança o mesmo pico. Nenhum dos dois perfis serve bem a um processo
  de vida curta.

### JRuby: Ruby na JVM

O JRuby roda Ruby na Java Virtual Machine. Sua característica marcante é
interoperabilidade em mão dupla com bibliotecas Java:

```ruby
require "java"

list = java.util.ArrayList.new
list.add("one")
list.add("two")
list.size         # => 2, calling Java's size()

# Ruby-style names map onto Java's camelCase automatically
map = java.util.HashMap.new
map.put("k", "v")
map.key_set.to_a  # keySet() reachable as key_set
```

O JRuby também herda o modelo de threading da JVM, suas opções maduras de
GC, e seu ferramental de profiling e monitoramento.

As limitações são específicas e vale a pena decorar:

- **Ractors não são suportados**, e a semântica de escalonador de threads /
  fiber scheduler do CRuby não se transfere; o JRuby usa threads reais da
  JVM em vez disso.
- **Gems com extensão nativa em C não são suportadas** no sentido do CRuby.
  As gems precisam ou de um modo Ruby puro ou de um substituto específico
  do JRuby (o padrão comum sendo um adaptador apoiado em JDBC no lugar de
  um driver de banco de dados nativo).
- O custo de inicialização da JVM é real e é sentido com mais força em
  comandos de vida curta.

> ⚠️ **Livro vs. hoje:** a reclamação do livro de que o JRuby fica anos
> atrás do CRuby (o JRuby 9.4, de novembro de 2022, só alcançando paridade
> com o Ruby 3.1) era justa na época, mas é bem menos verdadeira agora. O
> JRuby 10, lançado em 2025, mira compatibilidade com o Ruby 3.4 e exige
> uma base moderna de JDK (Java 21+). Trate "o JRuby está travado várias
> versões atrás" como uma afirmação a reconferir contra o lançamento atual,
> não como um fato permanente.

### mRuby: não é um substituto direto

O mRuby é um Ruby minimalista projetado pelo Matz para **embarcar**: um
interpretador pequeno que você liga a um programa C ou roda em hardware com
memória restrita. Implementa um subconjunto da linguagem e uma biblioteca
padrão muito menor, montada a partir de `mrbgems` opt-in no momento do
build.

O enquadramento importante é que o mRuby não é "Ruby, mas menor para sua
aplicação web". É uma camada de script para hosts C e dispositivos. Sua
aplicação Rails não vai rodar nele, e não é essa a proposta.

### A cauda longa

Várias outras implementações existem mas têm pouca ou nenhuma atividade, e
vale a pena reconhecê-las pelo nome em vez de avaliá-las:

- **Artichoke Ruby**: escrito em Rust, pré-produção.
- **Opal**: compila Ruby para JavaScript para o navegador.
- **MagLev**: construído sobre a VM Smalltalk/GemStone.
- **Rubinius**: uma implementação Ruby-em-Ruby.
- **IronRuby**: mirava o CLR do .NET.

Se uma runtime não é CRuby, TruffleRuby, JRuby, ou mRuby, assuma que você
está por conta própria em termos de suporte.

## Trade-offs

- **O YJIT é quase de graça para ligar, mas só para processos de longa
  duração**: o limite padrão de 30 chamadas significa que um script que
  termina em um segundo paga o custo de compilação sem colher o benefício.
  Ative-o em processos web e worker; deixe desligado para ferramentas CLI, e
  confirme com `RubyVM::YJIT.enabled?` em vez de assumir que a flag chegou
  ao processo.
- **O YJIT troca memória por velocidade**: código compilado vive em um
  cache de código limitado (`--yjit-exec-mem-size`). Em uma máquina apertada
  de memória rodando muitos workers forkados, isso é uma linha de orçamento
  real, não um arredondamento.
- **O TruffleRuby compra vazão com risco de ecossistema**: a taxa de
  aprovação de ~97% no ruby-spec e o suporte limitado a extensão nativa
  significam que a pergunta decisiva nunca é "é mais rápido?" mas "todo o
  meu `Gemfile.lock` funciona?" Audite as gems antes de fazer benchmark.
- **O JRuby compra interop com Java e paralelismo real de threads, e abre
  mão de fidelidade ao CRuby**: sem Ractors, sem extensões nativas em C, e
  custo de inicialização da JVM. É a resposta certa quando você já está
  dentro de uma casa JVM ou precisa de uma biblioteca Java específica, e um
  desvio caro quando você só quer "Ruby, mas mais rápido".
- **Trocar de runtime é um compromisso operacional, não um experimento**:
  comportamento de GC diferente, perfil de memória diferente, ferramental
  de profiling diferente, e um conjunto menor de pessoas que já depuraram
  sua stack em produção. O ganho de performance mais barato disponível para
  a maioria das aplicações Ruby ainda é CRuby com YJIT ligado.
- **"Ruby é lento" não é uma afirmação sobre uma linguagem**: sempre
  pergunte qual runtime, qual versão, e se o JIT estava aquecido antes de
  aceitar um benchmark.

## Documentation Links

- [YJIT, o compilador JIT do Ruby (ruby/ruby docs)](https://github.com/ruby/ruby/blob/master/doc/yjit/yjit.md) (doc)
- [YJIT Numbers in 2023, Rails at Scale](https://railsatscale.com/2023-11-08-yjit-numbers-in-2023/) (doc)
- [Everything you need to know about Ruby 4.0, Honeybadger](https://www.honeybadger.io/blog/ruby-4/) (doc)
- [TruffleRuby, GraalVM](https://www.graalvm.org/ruby/) (doc)
- [JRuby, Ruby on the JVM](https://www.jruby.org/) (doc)
- [mruby, the lightweight embeddable Ruby](https://mruby.org/) (doc)
- [Programming Ruby 3.3 (Pickaxe), Ruby Runtimes](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
