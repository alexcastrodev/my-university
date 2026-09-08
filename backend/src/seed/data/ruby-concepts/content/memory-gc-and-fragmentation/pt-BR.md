---
version: 1.0
updatedAt: 2026-08-17
title: "Memória, GC e o Modelo de Inchaço vs. Vazamento"
summary: Por que o heap do MRI nunca encolhe depois de um pico, como diferenciar inchaço de um vazamento real, e quando fragmentação por arena de thread e jemalloc de fato importam.
---
## Objective

O modelo de memória do Ruby tem uma propriedade que explica quase toda
pergunta de "por que meu processo está usando tanta RAM": **o heap do MRI
nunca encolhe de volta depois de um pico**. Um processo que precisa
brevemente de 350MB para renderizar uma página grande permanece
aproximadamente nesse tamanho depois, mesmo que quase nada dessa memória
ainda esteja em uso. Diferenciar isso de um vazamento de memória genuíno (e
saber o que de fato está disponível para corrigir cada um) é a habilidade
central que este conceito cobre.

## Use Cases

- Decidir se um processo que cresceu de 100MB para 350MB depois de uma
  requisição grande é um problema (vazamento) ou comportamento esperado
  (inchaço) antes de chamar alguém sobre isso.
- Diagnosticar uma subida lenta e constante de RSS que nunca reinicia: é um
  vazamento de objeto Ruby, ou um vazamento de extensão C/VM invisível para
  `GC.stat`?
- Decidir se um processo Ruby multithreaded e pesado em I/O (Puma, Sidekiq)
  se beneficiaria de jemalloc, e por que essa combinação específica importa.
- Saber quando (raramente) vale de fato a pena ajustar as variáveis de
  ambiente `RUBY_GC_HEAP_*` em vez de deixar os padrões do GC em paz.

## Deep Dive

### Inchaço vs. vazamento: o modelo de diagnóstico

```ruby
# A single big allocation permanently grows the process, even after GC:
arr = Array.new(1_000_000) { "string" }
arr = nil
GC.start
# RSS recovers only a small fraction of what it grew by
```

O heap do Ruby é feito de páginas de tamanho fixo; uma página com até um
único objeto vivo nela ("eden") não pode ser devolvida ao sistema
operacional, só uma página completamente vazia ("tomb") pode. Uma grande
alocação transitória deixa para trás muitas páginas eden meio vazias; o
processo parece permanentemente maior mesmo que `GC.start` tenha de fato
coletado o lixo. Isso é **inchaço**: rápido, grande, único, e ele se
estabiliza dentro de algumas horas de tráfego normal.

Um **vazamento** parece diferente: crescimento lento e linear que nunca se
estabiliza, mesmo depois de 24+ horas com reinícios de worker desabilitados.
A divisão diagnóstica:

```ruby
# Watched over time in a long-running process:
GC.stat[:heap_live_slots]
```

- `heap_live_slots` crescendo sem limite: um vazamento real de objeto Ruby
  (algo mantém uma referência viva que não deveria, um cache crescente sem
  remoção, um array que recebe itens mas nunca é limpo).
- `heap_live_slots` fica estável mas o RSS continua subindo: o vazamento
  está em uma **extensão C ou na própria VM**, completamente invisível para
  as estatísticas de GC em nível Ruby. Isso é mais raro, mas muito mais
  difícil de rastrear; costuma exigir o próprio profiler de vazamento do
  `jemalloc` (`MALLOC_CONF=prof_leak:true,...`) ou um dump de heap completo,
  e pode levar tempo real de investigação.

### Fragmentação por arena de thread: o caso avançado

```
MALLOC_ARENA_MAX=2 ruby app.rb
```

O malloc do glibc (o alocador padrão do Ruby no Linux) dá a cada thread sua
própria arena de memória para reduzir disputa de lock, normalmente até `8 ×
número de núcleos`. Arenas não conseguem compartilhar memória livre entre si,
o que fragmenta gravemente em uma combinação específica: um processo que é
**tanto multithreaded quanto pesado em I/O** (Puma, Sidekiq), porque a GVL
só permite disputa real entre threads enquanto uma delas está bloqueada em
I/O, que é exatamente quando essa fragmentação aparece. Números reportados
no mundo real: RSS de 2 a 4 vezes maior nessa configuração específica,
corrigível com `MALLOC_ARENA_MAX=2` (redução de memória de ~40%, custo de
CPU de ~13%) ou, de forma mais limpa, trocando o alocador inteiramente.

### jemalloc como uma correção estrutural

```
# Linux, no Ruby recompile needed:
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so ruby app.rb
```

O design de arenas do jemalloc evita o problema de fragmentação do glibc por
construção, não só limitando-o. É uma mudança quase sem risco para testar:
no pior caso é neutro; no melhor caso (especificamente Puma/Sidekiq) é um
ganho de memória significativo e estrutural, sem o trade-off de ~13% de CPU
que o `MALLOC_ARENA_MAX` carrega.

## Trade-offs

- **Ajustar as variáveis de ambiente `RUBY_GC_HEAP_*` raramente vale a
  pena**: a maioria das aplicações gasta menos de 1% do tempo de CPU em GC.
  Só compensa em dois casos estreitos: picos momentâneos de pressão de
  memória deixando centenas de milhares de slots permanentemente livres
  (diminua as taxas de crescimento, fixe `INIT_SLOTS` no estado estável
  observado), ou uma aplicação provadamente limitada por CPU no GC (faça o
  oposto: troque memória por coletas menos frequentes). Sempre confirme com
  `GC.stat` antes de mexer em qualquer uma dessas; adivinhar desperdiça o
  esforço de ajuste.
- **`MALLOC_ARENA_MAX=1`** parece a correção mais agressiva possível, mas não
  vale a pena: compra só de 1 a 2% a mais de economia de memória sobre `=2`,
  por um custo de CPU desproporcional. `2` a `4` é a faixa prática.
- **jemalloc/tcmalloc mostram um ganho real de ~15% em benchmarks
  sintéticos de estresse de GC, mas um ganho pequeno e inconsistente sob
  tráfego real de requisições**: trate como um experimento seguro e barato
  que vale a pena rodar em qualquer aplicação de produção multithreaded, não
  como uma porcentagem fixa garantida.

## Documentation Links

- [GC, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/GC.html) (doc)
- [ObjectSpace, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/ObjectSpace.html) (doc)
- [The Complete Guide to Rails Performance, Memory Leaks & Memory Fragmentation](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
