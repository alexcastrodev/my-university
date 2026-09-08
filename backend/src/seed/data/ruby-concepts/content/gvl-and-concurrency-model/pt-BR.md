---
version: 1.0
updatedAt: 2026-08-17
title: "A GVL e o Modelo de Concorrência do Ruby"
summary: Por que threads em Ruby dão concorrência de I/O, mas não paralelismo de CPU, e quando Ractors são a ferramenta que de fato muda isso.
---
## Objective

O MRI (o interpretador Ruby padrão) tem uma Global VM Lock (GVL,
historicamente chamada de GIL): apenas uma thread executa bytecode Ruby por
vez, mesmo em uma máquina com vários núcleos. Threads ainda dão concorrência
real para trabalho ligado a I/O, porque a GVL é liberada em torno de chamadas
de I/O bloqueantes, mas nunca dão paralelismo de CPU. Ractors (Ruby 3.0+) são
o único mecanismo no MRI que de fato roda código Ruby em vários núcleos ao
mesmo tempo, ao custo de um modelo de isolamento muito mais rígido que o das
threads.

## Use Cases

- Decidir se uma tarefa lenta deve ser uma thread (ligada a I/O: chamadas
  HTTP, consultas de banco, leitura de arquivos) ou precisa de paralelismo
  real (ligada a CPU: processamento de imagem, computação pesada); threads
  ajudam com a primeira, não com a segunda, no MRI.
- Dimensionar o pool de threads de um servidor web (ex.: Puma); mais threads
  só ajuda até o ponto em que a carga de trabalho é genuinamente ligada a
  I/O; depois disso, threads disputam a mesma GVL sem ganho de vazão.
- Reconhecer um bug clássico de threading: variáveis capturadas do escopo ao
  redor (não passadas como argumentos da thread) são estado compartilhado e
  não sincronizado.
- Considerar Ractors para trabalho paralelo ligado a CPU dentro de um único
  processo Ruby, em vez de recorrer a múltiplos processos do sistema
  operacional.

## Deep Dive

### A GVL: concorrência, não paralelismo

```ruby
require "benchmark"

def cpu_work
  1_000_000.times { |i| i * i }
end

Benchmark.bm do |x|
  x.report("1 thread")  { 4.times { cpu_work } }
  x.report("4 threads") { 4.times.map { Thread.new { cpu_work } }.each(&:join) }
end
```

No MRI, a versão com 4 threads não é significativamente mais rápida que a
versão com 1 thread para esse loop ligado a CPU; a GVL significa que só o
bytecode de uma thread roda por vez, então quatro threads fazendo computação
pura levam aproximadamente o mesmo tempo total de CPU que uma única thread
fazendo isso quatro vezes seguidas, só que intercalado. Troque `cpu_work` por
`sleep(0.1)` ou uma chamada HTTP real e a versão com threads *de fato* ganha,
porque a GVL é liberada enquanto uma thread está bloqueada em I/O.

### O bug clássico de variável compartilhada

```ruby
threads = [1, 2, 3].map { |i| Thread.new { puts i } }
threads.each(&:join)
```

Aqui, `i` é passado como um argumento de bloco que se torna um valor
capturado uma vez por chamada de `Thread.new`; é seguro. O bug aparece
quando uma variável do *escopo ao redor* é lida dentro do corpo da thread sem
ser passada:

```ruby
results = []
[1, 2, 3].each do |i|
  Thread.new { results << i * i }   # `i` here is the shared loop variable
end
```

Dependendo do escalonamento, isso pode ler um valor obsoleto ou já avançado
de `i` do escopo externo, porque aquele `i` é uma única local compartilhada,
não uma por thread. Passá-lo explicitamente (`Thread.new(i) { |local_i| ...
}`) corrige isso dando a cada thread sua própria cópia no momento da criação.

### Ractors: paralelismo real, isolamento real

```ruby
ractors = 4.times.map do
  Ractor.new { 1_000_000.times.sum { |i| i * i } }
end
ractors.map(&:join)  # Ruby 4.0+: #join waits for completion, doesn't collect a value
```

Cada Ractor tem sua própria GVL, então trabalho ligado a CPU de fato roda em
paralelo entre núcleos. O custo é o isolamento: o bloco de um Ractor não
consegue ver variáveis locais ou globais de fora dele, só o que é passado
explicitamente como argumento, ou objetos tornados compartilháveis
(congelados, ou de outra forma imutáveis) via `Ractor.make_sharable`. A
comunicação entre Ractors acontece só por troca explícita de mensagens, nunca
por estado mutável compartilhado.

> ⚠️ **Nota de API (Ruby 4.0+):** exemplos mais antigos de Ractor que você
> vai encontrar por aí usam `Ractor.yield(value)` dentro do Ractor e
> `another_ractor.take` fora dele; ambos foram **removidos no Ruby 4.0**. A
> API atual usa `Ractor::Port` para portas de mensagem explícitas, combinada
> com `Ractor#join`/`Ractor#value` para esperar pelo resultado de um Ractor.
> Confira a documentação de `Ractor` para a versão do Ruby que você está de
> fato rodando antes de copiar um exemplo mais antigo.

## Trade-offs

- **Threads custam quase nada para usar, mas só compensam para trabalho
  ligado a I/O**: recorrer a `Thread.new` em torno de um loop pesado de CPU é
  um beco sem saída de performance comum especificamente no MRI (o JRuby, sem
  GVL, não tem essa limitação; veja o conceito de JRuby para esse trade-off).
- **Ractors compram paralelismo real ao custo do modelo de isolamento**: sem
  estado mutável compartilhado, código existente que fecha sobre variáveis de
  instância ou globais geralmente não pode ser jogado dentro de um Ractor sem
  mudanças; precisa ser reestruturado em torno de troca explícita de
  mensagens.
- **Um mutex protege estado mutável compartilhado entre threads, mas é fácil
  esquecer um**: `Thread::Mutex#synchronize` é o padrão seguro porque garante
  o unlock mesmo se o bloco levantar exceção:
  ```ruby
  mutex = Thread::Mutex.new
  counter = 0
  10.times.map { Thread.new { mutex.synchronize { counter += 1 } } }.each(&:join)
  counter # => 10, reliably
  ```

## Documentation Links

- [Ractor, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Ractor.html) (doc)
- [Thread, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Thread.html) (doc)
- [Ruby 4.0.0 Released, ruby-lang.org (mudança na API Ractor::Port)](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) (doc)
- [The Complete Guide to Rails Performance, Webservers and I/O models](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
