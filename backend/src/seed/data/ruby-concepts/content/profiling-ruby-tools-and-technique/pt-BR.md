---
version: 1.0
updatedAt: 2026-08-18
title: "Profiling em Ruby: ruby-prof, stackprof e memory_profiler"
summary: Profilers de tracing vs. sampling, o viés em cada modo de cronometragem, o kit de memória do MRI, do ObjectSpace ao memory_profiler, e por que um ganho de 12x em micro-benchmark pode não mudar nada.
---
## Objective

A maior parte do trabalho de performance em Ruby dá errado das mesmas duas
formas: medir a coisa errada, e medir a coisa certa no lugar errado. Um
profiler responde "para onde o tempo de fato vai neste programa"; um
benchmark responde "qual desses dois trechos é mais rápido isoladamente", e
a segunda pergunta rotineiramente tem uma resposta que não muda a primeira.
Este conceito cobre o kit de profiling (`ruby-prof`, `stackprof`) e o kit de
memória (`ObjectSpace`, `derailed_benchmarks`, `memory_profiler`), o viés de
medição que cada um carrega, e a disciplina de validar um ganho de
micro-benchmark em nível macro antes de acreditar nele.

## Use Cases

- Encontrar o ponto quente real em uma suíte de testes lenta, uma sequência
  de boot, ou uma biblioteca; código que vive fora do ciclo de
  requisição/resposta, onde um profiler de tracing com overhead de 2 a 3x é
  perfeitamente aceitável.
- Fazer profiling de algo em produção sem destruir a latência, e saber qual
  modo de cronometragem escolher para que `sleep`, I/O de rede, ou um
  processo vizinho barulhento não distorçam silenciosamente o resultado.
- Auditar por que um processo Rails recém-iniciado já custa 200MB antes de
  atender uma única requisição; qual gem no Gemfile está pagando por isso no
  momento do `require`.
- Diferenciar "tudo que essa requisição alocou" de "o que essa requisição
  deixou para trás", que é a única distinção que importa ao caçar um
  vazamento.
- Decidir se um ganho de 12x em micro-benchmark vale a pena colocar em
  produção.

## Deep Dive

### ruby-prof: tracing, e os três modos de medição

`ruby-prof` instrumenta **cada chamada de método**. Isso dá contagens de
chamada exatas e um grafo de chamadas completo, com overhead de 2 a 3x em
tempo de execução; nunca em produção, mas ideal para uma suíte de testes,
um perfil de boot, ou um benchmark de biblioteca.

```ruby
require "ruby-prof"

RubyProf.measure_mode = RubyProf::PROCESS_TIME

result = RubyProf.profile do
  1_000.times { Order.new(items: items).total }
end

RubyProf::FlatPrinter.new(result).print($stdout, min_percent: 1)
```

O modo de medição não é um detalhe; cada um tem um viés específico:

- **`CPU_TIME`** conta ciclos de clock, não tempo decorrido. Um método que
  faz `sleep 5` ou espera em um socket aparece como ~0ms, porque não queima
  CPU nenhuma. Também é distorcido por escalonamento de frequência de CPU
  (um laptop com throttling térmico reporta números diferentes para o mesmo
  trabalho), e é documentado como falho especificamente no kernel do macOS.
- **`WALL_TIME`** (via `gettimeofday`) é o modo mais usado e o mais
  intuitivo, mas mede tudo que aconteceu, incluindo latência de rede e disco
  que você não controla e tempo de CPU roubado por outros processos na
  máquina. Rode um profile enquanto um build compila em outro terminal e os
  números mudam.
- **`PROCESS_TIME`** (via `clock()`) mede tempo consumido só por este
  processo, então é imune a outros processos na máquina. Seu ponto cego são
  subprocessos: qualquer coisa feita via `fork`/`spawn` não é contada. Onde
  disponível, geralmente é o melhor padrão.

### stackprof: sampling, e seguro em produção

```ruby
require "stackprof"

StackProf.run(mode: :wall, out: "tmp/stackprof-orders.dump", interval: 1000) do
  100.times { OrderReport.new(shop).generate }
end
```

```
$ stackprof tmp/stackprof-orders.dump --text --limit 10
```

`stackprof` (Ruby 2.1+) não instrumenta chamadas; ele interrompe o processo
em um timer e registra a pilha. O overhead é baixo o bastante para rodar
contra tráfego real, o que o torna o único dos dois que você pode apontar
para comportamento real de produção. É o motor por baixo do
`rack-mini-profiler`; o uso desse ferramental do lado do Rails (os parâmetros
de query `?pp=`, rodando com segurança atrás de autenticação) pertence ao
conceito de **Observabilidade em Produção**, não aqui. Seu modo de
cronometragem `:cpu` carrega o mesmo bug de macOS que `CPU_TIME` do
`ruby-prof`; em um Mac, prefira `:wall`.

### Lendo a saída: comece pelo maior `%self`

Ambas as ferramentas reportam `%self` (tempo gasto dentro de um método,
excluindo seus chamados) ao lado de `%total` (incluindo chamados). `%total`
no topo do relatório é quase sempre algo inútil, como `Integer#times` ou a
action do controller; ele contém tudo. **`%self` é onde o trabalho de fato
acontece.** A regra prática é: ordene por `%self`, pegue a entrada do topo,
otimize-a, refaça o profile, repita. Otimizar de cima para baixo por `%self`
garante que você está gastando esforço onde o tempo de fato está, em vez de
em qualquer código que pareceu suspeito.

### Benchmark não é um profile

Um benchmark compara alternativas isoladas:

```ruby
require "benchmark/ips"

arr = (1..10_000).to_a

Benchmark.ips do |x|
  x.report("sort_by rand") { arr.sort_by { rand } }
  x.report("shuffle")      { arr.shuffle }
  x.compare!
end
```

Essa comparação é real e reproduzível: `shuffle` saiu aproximadamente **12x
mais rápido** que `sort_by { rand }` na própria medição do livro. E quando o
autor aplicou a mudança na suíte de testes real onde aquela linha morava, o
tempo total de execução da suíte **não se moveu de forma mensurável**.

Nada estava errado com o benchmark. O erro foi assumir que "mais rápido
isoladamente" implica "mais rápido no programa", o que só vale se aquele
código for uma fração significativa do tempo total. Não era. `benchmark-ips`
responde *qual alternativa é mais rápida*; um profile responde *se esse
código sequer importa*. A ordem de trabalho é: faça o profile primeiro para
encontrar o que de fato está quente, faça benchmark de alternativas para
aquele ponto específico, depois **refaça o profile do programa inteiro**
para confirmar que o ganho sobreviveu em nível macro. Um ganho de
micro-benchmark que não aparece nos números de ponta a ponta não é um ganho;
é uma mudança.

### Introspecção de memória ao vivo: ObjectSpace e GC::Profiler

```ruby
ObjectSpace.count_objects
# => {:TOTAL=>62108, :FREE=>1289, :T_OBJECT=>1723, :T_STRING=>28451, ...}

require "objspace"
ObjectSpace.count_objects_size          # bytes per object type
ObjectSpace.memsize_of("a" * 100_000)   # size of one specific object
ObjectSpace.memsize_of_all(String)      # total bytes held by all Strings
```

`ObjectSpace.count_objects` já vem embutido e não custa nada quando você
não o chama; seguro para expor atrás de um endpoint de administração. A
biblioteca `objspace` é diferente: `require "objspace"` liga um rastreamento
de alocação mais pesado, então os métodos sensíveis a tamanho acima são
ferramentas de desenvolvimento, não de produção.

`GC::Profiler` registra a cronometragem de cada execução de GC:

```ruby
GC::Profiler.enable
run_the_workload
GC::Profiler.report   # prints per-GC invoke time, heap size, slot counts
GC::Profiler.disable
```

Seu overhead é alto; ative-o em torno de uma carga de trabalho específica em
desenvolvimento, nunca o deixe ligado.

### gc_tracer: `GC.stat` ao longo do tempo

`gc_tracer` (Koichi Sasada) registra o snapshot completo de `GC.stat` de
forma contínua, em vez de em um único ponto. Em uma aplicação Rack é um
middleware:

```ruby
require "rack/gc_tracer"
use Rack::GCTracerMiddleware, view_page_path: "/gc_tracer", filename: "log/gc"
```

Isso expõe uma página com `GC.stat` registrado por requisição. Para jobs em
segundo plano, onde não há um ciclo Rack para se conectar, envolva o
trabalho diretamente:

```ruby
require "gc_tracer"
GC::Tracer.start_logging("log/gc-job.log") do
  ImportJob.perform_now(batch)
end
```

### derailed_benchmarks: auditoria estática de gems, depois dinâmica

O lado estático não inicializa sua aplicação de forma nenhuma; ele dá
`require` em cada gem do Gemfile e mede o que isso sozinho custa:

```
$ bundle exec derailed bundle:mem
TOP: 54.3 MiB
  mime-types: 19.9 MiB
    mime-types/columnar: 1.9 MiB
  actionpack: 8.5 MiB
  ...
```

O número `TOP` é o ponto principal: deveria ficar em algum lugar em torno de
**50 a 60MB**. Muito mais alto significa que uma única gem está cobrando
memória de você em cada worker, para sempre, antes de uma requisição ser
atendida. O caso clássico do livro está bem ali na saída acima: `mime-types`
antes da 2.6 custava 15 a 30MB extras, corrigido sem descartar a gem:

```ruby
gem "mime-types", ">= 2.6", require: "mime/types/columnar"
```

Outro caso recorrente: `carrierwave` traz junto o `fog` (~10MB); trocar para
`carrierwave-aws` dá a mesma funcionalidade sem essa dependência.

Os benchmarks dinâmicos de fato atingem a aplicação real em execução:

```
$ PATH_TO_HIT=/products TEST_COUNT=5000 bundle exec derailed exec perf:mem_over_time
$ PATH_TO_HIT=/products TEST_COUNT=100  bundle exec derailed exec perf:objects
```

`perf:mem_over_time` imprime o RSS repetidamente enquanto martela um
endpoint, e o **formato** dessa série é a resposta: memória que sobe rápido
e depois se estabiliza é inchaço, esperado, e coberto pelo modelo de
inchaço-vs-vazamento no conceito **Memória, GC e o Modelo de Inchaço vs.
Vazamento**. Memória que continua crescendo linearmente sem estabilizar
depois de milhares de requisições é um vazamento. `perf:objects` então
mostra quais alocações estão por trás disso.

### memory_profiler: alocado vs. retido

```ruby
require "memory_profiler"

report = MemoryProfiler.report do
  ProductsController.action(:index).call(env)
end

report.pretty_print(to_file: "tmp/memprof.txt")
```

```
Total allocated: 12.4 MB (148213 objects)
Total retained:   1.9 MB (4021 objects)
```

Os dois totais respondem perguntas diferentes. **Alocado** é tudo que
passou pela memória durante o bloco, incluindo objetos que o GC já coletou;
alocação alta custa CPU (mais execuções de GC), mas não necessariamente
cresce o processo. **Retido** é o que ainda está vivo depois de o bloco
terminar, e esse é o número que importa para vazamentos: uma requisição que
retém objetos toda vez que roda é um vazamento, não importa quão modesta
seja sua contagem de alocação. O relatório detalha os dois por gem, arquivo
e linha, então um número retido aponta para uma linha específica. Diferente
da inspeção pura de `GC.stat`, `memory_profiler` também funciona com
extensões C.

## Trade-offs

- **Tracing vs. sampling é uma decisão de posicionamento, não de
  qualidade.** `ruby-prof` dá contagens exatas de chamada e um grafo de
  chamadas completo, que é o que você quer para uma suíte de testes ou
  perfil de boot onde overhead de 2 a 3x é de graça. `stackprof` dá um
  retrato estatístico sem contagens exatas, que é a única coisa segura de
  rodar sob tráfego de produção. Tentar forçar `ruby-prof` em um caminho de
  requisição de produção é o erro comum; assim como concluir de uma execução
  de stackprof com poucas amostras que um método "não é chamado".
- **Todo modo de cronometragem mente sobre alguma coisa; escolha a mentira
  com a qual você consegue viver.** `CPU_TIME` esconde toda espera de I/O
  (um método ligado a HTTP parece de graça); `WALL_TIME` inclui ruído de
  processos não relacionados; `PROCESS_TIME` perde subprocessos. No macOS,
  os modos baseados em CPU são adicionalmente não confiáveis em nível de
  kernel nas duas ferramentas, então `WALL_TIME`/`:wall` costuma ser a única
  opção honesta ali; só faça o profile em uma máquina quieta.
- **Ferramental de memória se divide de forma limpa entre "sempre seguro" e
  "só desenvolvimento".** `ObjectSpace.count_objects` e `GC.stat` não
  custam nada até serem chamados; `require "objspace"`, `GC::Profiler` e
  `memory_profiler` todos adicionam overhead real de rastreamento. Recorrer
  às ferramentas pesadas primeiro é tentador e geralmente desnecessário; as
  baratas respondem à pergunta "existe algo errado".
- **Um ganho de micro-benchmark é uma hipótese, não um resultado.** O caso
  do `shuffle` de 12x é o exemplo de cautela: medição correta, ganho real de
  velocidade, efeito zero no programa. Sempre feche o ciclo com uma medição
  macro da execução inteira; se o tempo total não se moveu, reverta a
  complexidade que você adicionou e volte ao profile.
- **Auditorias estáticas de gems são baratas e incomumente de alta
  alavancagem.** `derailed bundle:mem` roda em segundos, não precisa de
  tráfego, e suas descobertas se aplicam a todo worker em toda máquina
  permanentemente, mas ele só vê o custo no momento do `require`. Uma gem
  leve para carregar mas perdulária por requisição é invisível para ele, que
  é para o que servem os benchmarks dinâmicos e o `memory_profiler`.

## Documentation Links

- [ruby-prof](https://github.com/ruby-prof/ruby-prof) (doc)
- [stackprof](https://github.com/tmm1/stackprof) (doc)
- [memory_profiler](https://github.com/SamSaffron/memory_profiler) (doc)
- [derailed_benchmarks](https://github.com/schneems/derailed_benchmarks) (doc)
- [ObjectSpace, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/ObjectSpace.html) (doc)
- [The Complete Guide to Rails Performance, Profiling and Memory](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
