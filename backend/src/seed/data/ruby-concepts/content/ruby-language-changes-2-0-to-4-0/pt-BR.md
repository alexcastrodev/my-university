---
version: 1.0
updatedAt: 2026-08-21
title: "Mudanças na Linguagem Ruby: da 2.0 à 4.0"
summary: A separação de argumentos nomeados na 3.0, Ractors, Set virando core, Prism como parser padrão na 3.4, e *nil não convertendo mais via to_a na 4.0, a linha do tempo que os outros conceitos de Ruby desta plataforma assumem que você já conhece.
---
## Objective

O Ruby lançou uma mudança de ruptura real aproximadamente a cada três anos
desde a 2.0, não churn de ciclo de depreciação, mas mudanças semânticas que
transformam código funcionando em um `NoMethodError` ou um resultado
silenciosamente diferente. Alguém que escreveu Ruby a sério pela última vez
na era 2.3-2.5 e retoma hoje está sem a separação de argumentos nomeados
(3.0), Ractors (3.0), um parser padrão completamente diferente (o Prism da
3.4), e uma mudança de comportamento do splat em `nil` (4.0); cada uma uma
fonte plausível de "esse tutorial não funciona" ou "essa resposta do
StackOverflow está errada agora." Este conceito é a linha do tempo que os
outros conceitos desta plataforma assumem: é o mapa; os conceitos dedicados
sobre Ractors, `Set`, pattern matching, RBS e Ruby Box são o território.

## Use Cases

- Ler um post de blog antigo, uma resposta do Stack Overflow, ou uma página
  de wiki interna e saber quais partes dependem de versão antes de copiar
  código dela.
- Explicar por que o `Gemfile` de uma gem fixa `ruby ">= 3.0"`: reconhecer de
  qual recurso da linguagem o código de fato depende (separação de
  argumentos nomeados? pattern matching? Ractors?) em vez de tratar a
  restrição como arbitrária.
- Migrar uma base de código através de uma fronteira de versão major (2.7
  para 3.0 é a infame) e saber com antecedência que categoria de bug
  esperar.
- Ler uma assinatura de método e imediatamente identificar qual Ruby
  introduziu a sintaxe (`def initialize(x:) = @x = x`, `case x in [Integer
  => n]`, `def greet(...) = other(...)`), em vez de tratá-la como um dialeto
  desconhecido.
- Decidir quão conservadoramente escrever código de biblioteca que precisa
  rodar em uma ampla faixa de versões (uma gem que suporta 3.0 até 4.0 não
  pode usar casualmente uma API de Ractor exclusiva da 4.0).

## Deep Dive

### 2.0 a 2.7: a era que construiu os idiomas de hoje

O Ruby 2.0 (2013) trouxe **`Module#prepend`** (o mecanismo que o conceito de
modelo de objetos desta plataforma explica em profundidade), uma codificação
de origem UTF-8 padrão, argumentos nomeados (primeira versão, um valor
padrão era obrigatório), e enumeradores preguiçosos. A 2.1 relaxou
argumentos nomeados para permitir nenhum padrão. Adições pequenas mas
duradouras continuaram chegando todo ano depois: `Object#itself` (2.2),
navegação segura `&.` e `dig` e o heredoc squiggly `<<~` (2.3), `Fixnum`/
`Bignum` se unificando em uma única classe `Integer` e `String#match?`
(2.4), o amigável a argumentos nomeados `Struct.new(keyword_init: true)`
(2.5).

A 2.6 adicionou `Object#then`/`#yield_self` e ranges sem fim (`5..`). A 2.7
é a que vale a pena lembrar pelo nome; ela deu um preview do **pattern
matching** (`case/in`, estabilizado de verdade na 3.0, veja o conceito
dedicado desta plataforma), introduziu **parâmetros de bloco numerados**
(`_1`, mais tarde acompanhado pela forma curta `it` na 3.4), e permitiu
**encaminhamento de argumentos com `...`** (`def wrapper(...) =
target(...)`, encaminhando todos os argumentos posicionais, nomeados e de
bloco sem nomear nenhum deles). A 2.7 também tornou `**nil` legal como
"explicitamente nenhum argumento nomeado", uma pequena adição que importou
muito uma versão depois.

### 3.0: a versão que quebrou coisas de propósito

O Ruby 3.0 (2020) é aquele sobre o qual guias de migração avisam, por um
motivo específico: **argumentos Hash posicionais e argumentos nomeados se
tornaram completamente separados**. Antes da 3.0, um argumento Hash final e
argumentos nomeados eram, em grande parte, intercambiáveis; um método
definido com `def foo(opts = {})` podia ser chamado `foo(a: 1)` e
simplesmente ver `{a: 1}` como `opts`. Da 3.0 em diante, essa conversão
implícita desapareceu: um método precisa declarar `**opts` para receber
argumentos nomeados como um hash, e chamar um método só de nomeados com um
argumento hash literal (sem `**`) levanta `ArgumentError`. Essa é a fonte
mais comum de relatos de bug "funcionava no Ruby 2.7, quebra na 3.0", e é o
motivo de tantas gems daquela era terem precisado de uma mudança de código
de verdade, não só um bump de versão, para suportar a 3.0.

A 3.0 também trouxe as duas adições principais cobertas como seus próprios
conceitos nesta plataforma: **Ractors**, o primeiro mecanismo real de
paralelismo intraprocesso (veja o conceito de GVL/concorrência), e **RBS**,
a própria linguagem de assinatura de tipo do Ruby (veja o conceito de Ruby
tipado). Junto com eles: **métodos endless** (`def double(x) = x * 2`), o
operador de **atribuição para a direita** (`expr => variable`), `in`
utilizável como uma checagem booleana de pattern matching isolada fora de
`case`, o **find pattern** (`case arr; in [*, target, *]`), e Fibers não
bloqueantes com um **fiber scheduler** conectável para I/O assíncrono
cooperativo (seu próprio conceito cobre `async`/Falcon construídos em cima
disso).

A 3.1 adicionou o **operador pin** `^` aceitando expressões arbitrárias em
padrões de match, a forma curta de hash/nomeado `{x:}` que infere o valor de
uma variável local de mesmo nome, e encaminhamento anônimo de argumento de
bloco com um `&` nu. A 3.2 promoveu **`Set` para a biblioteca core**
(autoloaded, sem precisar de `require "set"`, embora `require` ainda
funcione e seja o que código antigo espera), adicionou encaminhamento
anônimo de splats posicionais/nomeados (`*`/`**` sozinhos, sem um nome), e
introduziu **`Data`**, uma irmã mais leve e imutável de `Struct`. A 3.3
introduziu o **Prism**, um novo parser de descida recursiva escrito à mão,
feito para eventualmente substituir a antiga gramática `parse.y`, junto com
trabalho contínuo de performance do YJIT ano após ano.

### 3.4 e 4.0: a linha atual, e o que é genuinamente novo

A 3.4 (dezembro de 2024) fez duas mudanças que vale a pena conhecer de
cabeça: **`Hash#inspect` mudou seu formato de saída padrão** de `{:x=>1,
:y=>2}` para `{x: 1, y: 2}` (o conceito `self-and-singleton-classes` desta
plataforma marca exatamente onde isso aparece), e **`it`** se tornou um
sinônimo documentado e estável para o único parâmetro de bloco numerado
`_1`, então `list.map { it * 2 }` e `list.map { _1 * 2 }` são a mesma coisa,
com `it` lendo mais perto do inglês comum. A 3.4 também trocou o **parser
padrão para o Prism**, e reformulou os internos do garbage collector em uma
estrutura mais modular ("GC modular"), mais uma implementação de **Happy
Eyeballs v2** para tentativas de conexão TCP dual-stack (IPv4/IPv6) mais
rápidas em `Socket`/`Net::HTTP`.

A 4.0 (dezembro de 2025) é o maior salto desde a 3.0, e a maioria de suas
mudanças individuais já tem um conceito dedicado em outro lugar desta
plataforma, então isso é o índice, não a explicação completa:

- **`Ractor.yield`/`Ractor#take` foram removidos**, substituídos pela API
  explícita `Ractor::Port` combinada com `Ractor#join`/`Ractor#value`; veja
  o conceito de GVL/concorrência para o formato da migração.
- **`Ruby::Box`** chegou como um mecanismo experimental de isolamento de
  namespace em processo, distinto de Ractors; seu próprio conceito cobre o
  que ele isola e o que não isola.
- **`*nil` não chama mais `nil.to_a`**: fazer splat de `nil` como argumento
  agora é só "zero argumentos" em vez de converter silenciosamente via
  `to_a`; o conceito de duck typing cobre isso como parte da história maior
  do protocolo de conversão implícita.
- **`SortedSet` foi removido** da biblioteca padrão (dependia da gem externa
  `rbtree`); `Set`, como `Pathname`, agora é uma classe core de verdade em
  vez de um arquivo autoloaded da biblioteca padrão.
- **RJIT foi completamente removido**; **ZJIT**, um novo JIT experimental em
  nível de método do time do YJIT, vem incluído mas não é ativado por
  padrão; o conceito de comparação de runtimes cobre onde ele fica em
  relação ao YJIT.
- Menores mas reais: backtraces de `ArgumentError` mais claras para chamadas
  com aridade errada, um novo hook `instance_variables_to_inspect` que
  `p`/`pp` respeitam, operadores lógicos multilinha (um `&&`/`||` no final
  de linha não precisa mais de uma barra invertida para continuar),
  `source_location` retornando um array de 5 elementos (adicionando
  linha/coluna final), e `String#strip` aceitando argumentos para remover
  caracteres além de espaço em branco.

## Trade-offs

- **Um modelo mental do Ruby agnóstico de versão não existe acima
  aproximadamente da linha da 3.0**: código que depende da
  intercambiabilidade entre nomeado/hash, um exemplo antigo de
  `Ractor.yield`/`take`, ou o formato antigo de `Hash#inspect`, precisa de
  um número de versão anexado antes de você confiar nele, não só "Ruby
  recente."
- **Pular direto da 2.6/2.7 para a 4.0 concentra tudo isso em uma única
  migração**: a separação de argumentos nomeados sozinha da 3.0 costuma ser
  uma correção de várias semanas em uma aplicação Rails grande; fazer isso
  junto com a mudança da API de Ractor da 4.0 e a mudança de splat em `nil`
  de uma vez é estritamente mais difícil de isolar do que atualizar através
  de versões intermediárias.
- **Novos parsers e níveis de JIT (Prism, YJIT, ZJIT) geralmente são seguros
  de ignorar até deixarem de ser**: a maioria do código de aplicação nunca
  toca diretamente em internos de parser ou JIT, mas uma gem fazendo algo
  com `RubyVM::AbstractSyntaxTree`, instrumentação customizada, ou flags
  manuais de JIT precisa acompanhar essas transições explicitamente em vez
  de assumir que o comportamento é estável.
- **Seguir o padrão "livro vs. hoje" usado nos conceitos de Ruby desta
  plataforma é a defesa prática**: trate qualquer fonte única (um livro, um
  tutorial, um conjunto de dados de treinamento) como precisa até sua data
  de corte, e confira as notas de lançamento da versão de fato instalada
  antes de colocar em produção código que dependa de um detalhe de uma das
  eras acima.

## Documentation Links

- [Ruby 3.0.0 Released, ruby-lang.org](https://www.ruby-lang.org/en/news/2020/12/25/ruby-3-0-0-released/) (doc)
- [Ruby 3.2.0 Released, ruby-lang.org](https://www.ruby-lang.org/en/news/2022/12/25/ruby-3-2-0-released/) (doc)
- [Ruby 3.4.0 Released, ruby-lang.org](https://www.ruby-lang.org/en/news/2024/12/25/ruby-3-4-0-released/) (doc)
- [Ruby 4.0.0 Released, ruby-lang.org](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) (doc)
- [Ruby Changes, um changelog comunitário versão a versão](https://rubyreferences.github.io/rubychanges/) (doc)
- [Programming Ruby 3.3 (Pickaxe), apêndice Ruby Changes](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
