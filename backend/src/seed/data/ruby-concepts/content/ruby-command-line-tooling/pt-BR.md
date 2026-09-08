---
version: 1.0
updatedAt: 2026-08-21
title: "Ferramental de Linha de Comando em Ruby: Scripts, OptionParser, Rake e irb"
summary: A maior parte do Ruby que roda em produção não é um handler de requisição, é um script, uma tarefa de deploy, ou um job Rake. As flags -n/-p/-a, ARGV vs ARGF, OptionParser, as regras reais de escopo de ENV, e o grafo de tarefas do Rake são a metade da linguagem que código de framework nunca toca.
---
## Objective

A maior parte do Ruby que roda em produção não é um handler de requisição
web, é um script de migração de dados, uma tarefa de deploy, um relatório
avulso, um job Rake. Esse código se apoia em uma parte diferente da
linguagem daquela que código de aplicação usa: flags de linha de comando que
transformam o Ruby em um substituto de `sed`/`awk`, parsing de `ARGV`,
`ENV`, e `Rake`, o executor de tarefas sobre o qual Bundler, RSpec, e o
próprio `bin/rails` do Rails são construídos. Um desenvolvedor experiente
que passou a carreira dentro do ciclo de requisição de um framework ainda
pode não conhecer essa metade do Ruby, a metade que aparece no momento em
que você precisa escrever um script descartável ou uma tarefa de deploy em
vez de uma action de controller.

## Use Cases

- Escrever um script avulso de correção de dados como um one-liner `ruby -e`
  em vez de um arquivo completo, ou usar `-n`/`-p`/`-a` para processar um
  arquivo linha por linha do jeito que `sed`/`awk` fariam.
- Construir uma pequena ferramenta CLI com parsing real de `--flag valor`,
  geração de `--help`, e nenhuma dependência além da biblioteca padrão, via
  `OptionParser`.
- Ler e estender o `Rakefile` de um projeto: entender dependências entre
  tarefas, `desc`, e por que `rake -T` é o primeiro comando a rodar em um
  repositório desconhecido.
- Depurar por que um script lê uma variável de ambiente corretamente em um
  shell, mas não depois de uma chamada de subprocesso, entendendo as regras
  reais de escopo de `ENV`.
- Usar `irb` como uma ferramenta de exploração de verdade: recarregando um
  arquivo que você está editando ativamente, ou abrindo uma subsessão
  escopada contra um objeto, em vez de reiniciar um REPL a cada mudança.

## Deep Dive

### Ruby como calculadora de linha de comando e filtro de texto

`ruby -e 'puts 2 ** 10'` roda uma linha diretamente do shell, sem precisar
de arquivo, útil para aritmética rápida ou uma checagem rápida do
comportamento de um método. Quatro flags transformam o Ruby em um
processador de linhas estilo `sed`/`awk`: `-n` envolve o código dado em um
`while gets; ...; end` implícito (roda uma vez por linha de entrada, não faz
nada com o resultado a menos que o próprio código imprima); `-p` faz o
mesmo, mas também dá `print` na linha automaticamente depois de rodar o
código, espelhando o `sed`; `-a` divide automaticamente cada linha por
espaço em branco no array `$F` (`-F` define um delimitador customizado,
espelhando o `-F` do `awk`). As flags se acumulam: `ruby -nae '...'` é
`-n -a -e '...'` combinados. `$_` é a variável mágica que guarda a última
linha lida por `gets`, sobre a qual `-n`/`-p` operam implicitamente.

```bash
# print the second whitespace-separated field of every line
ruby -ane 'puts $F[1]' access.log

# in-place edit: replace "foo" with "bar" in every .rb file, keeping a .bak
ruby -i.bak -pe '$_.gsub!("foo", "bar")' *.rb
```

`-i[.ext]` (edição no local, um idioma herdado do Perl) reescreve o arquivo
sendo processado em vez de imprimir no stdout, opcionalmente mantendo um
backup com a extensão dada. Um script feito para ser rodado diretamente em
vez de via `ruby script.rb` quer o shebang portável `#!/usr/bin/env ruby`
mais `chmod +x`.

### `ARGV`, `ARGF`, e `$0`

`ARGV` é o array de argumentos de linha de comando; diferente do C, ele
**não** inclui o nome do programa, que mora separadamente em `$0` (apelido
`$PROGRAM_NAME`). `ARGF` é a ferramenta mais especializada: trata cada
arquivo nomeado em `ARGV` como **um único stream lógico concatenado**,
abrindo transparentemente o próximo arquivo quando o atual se esgota,
exatamente o comportamento que `cat`/`grep` dão quando você passa vários
arquivos, sem escrever o loop de iteração de arquivos você mesmo:

```ruby
ARGF.each_line { |line| puts line if line.include?("ERROR") }
# ruby this_script.rb app.log app.log.1 app.log.2
# processes all three files as a single stream, in argument order
```

### `OptionParser`: parsing de flags de verdade sem uma gem

Para qualquer coisa além de alguns argumentos posicionais, fazer parsing de
`ARGV` à mão fica propenso a erro rápido. `OptionParser` (biblioteca padrão,
`require "optparse"`) lida com parsing de `--long-option VALOR`, apelidos de
flag curta, coerção de tipo, e geração de `--help`:

```ruby
require "optparse"

options = { verbose: false, limit: 100 }

OptionParser.new do |parser|
  parser.banner = "Usage: report.rb [options]"

  parser.on("-v", "--verbose", "Run verbosely") { options[:verbose] = true }
  parser.on("-l", "--limit N", Integer, "Max records") { |n| options[:limit] = n }
end.parse!

# ARGV now holds only the leftover positional arguments, flags removed
```

`parse!` muta `ARGV` no lugar, removendo as flags reconhecidas e deixando os
argumentos posicionais para trás; o `!` está fazendo trabalho real aqui, não
é só convenção. `--help` é gerado automaticamente a partir do `banner` e das
descrições passadas a `on`. Para uma CLI com subcomandos estilo git
(`mytool deploy --env production`), o `OptionParser` sozinho fica
desajeitado rapidamente; **Thor** é a escolha de terceiros de fato quando
uma ferramenta cresce além de flags simples, dando a cada subcomando seu
próprio método de classe e conjunto de opções.

### `ENV` e `$LOAD_PATH`: duas coisas que parecem dados simples e não são

`ENV` se comporta como um `Hash` (`ENV["DATABASE_URL"]`, `ENV.fetch("KEY",
default)`), mas não é um; é uma view viva sobre o ambiente real do
processo. A regra de escopo que confunde as pessoas: uma mudança em `ENV`
dentro de um processo Ruby afeta **aquele processo e qualquer processo
filho que ele gerar depois**, mas nunca se propaga de volta para o shell
pai que o lançou; a mesma regra do `export` em qualquer shell Unix, mas
fácil de esquecer quando `ENV` parece um estado mutável comum.

`$LOAD_PATH` (apelido `$:`) é o array de diretórios que `require` procura.
Manipulá-lo diretamente para carregar um arquivo vizinho era o idioma
antigo; `require_relative` (caminho relativo ao arquivo atual, resolvido no
momento do parse) é o substituto moderno correto para carregar um arquivo
irmão e deveria ser preferido em essencialmente todo código novo; recorrer
à manipulação de `$LOAD_PATH` hoje costuma ser um sinal de código anterior a
`require_relative` ou de um layout de script que está brigando com sua
própria estrutura de diretórios.

### Rake: o executor de tarefas sobre o qual quase tudo o mais é construído

Um `Rakefile` é Ruby comum. `task :name do ... end` define uma tarefa;
`desc "..."` imediatamente acima de uma tarefa anexa uma descrição que
aparece em `rake -T` (`--tasks`), o primeiro comando que vale a pena rodar
em qualquer repositório com um `Rakefile` que você nunca viu, já que ele
lista toda tarefa disponível com sua descrição em uma passagem só.

```ruby
desc "Run the full test suite"
task test: [:lint, :spec] do
  puts "All checks passed"
end

desc "Run RuboCop"
task :lint do
  sh "bundle exec rubocop"
end

desc "Run RSpec"
task :spec do
  sh "bundle exec rspec"
end

task default: :test
```

Dependências entre tarefas são declaradas como um hash (`task combined:
[:t1, :t2]`); o Rake roda as dependências primeiro, cada uma exatamente uma
vez mesmo se várias tarefas dependerem do mesmo pré-requisito. Uma tarefa
literalmente chamada `default` é o que roda quando `rake` é invocado sem
argumento nenhum, o que é o motivo de `rake` sozinho costumar simplesmente
funcionar em um projeto bem configurado. `CLEAN` e `CLOBBER` são arrays
especiais (de `rake/clean`) que geram automaticamente tarefas
`clean`/`clobber` para apagar arquivos gerados; `CLEAN` para artefatos de
build regeneráveis, `CLOBBER` para coisas mais caras de regenerar (e
tipicamente inclui tudo de `CLEAN` também).

### `irb`: um REPL feito para ficar aberto enquanto você edita

O `irb` moderno (3.1+) tem autocompletar, coloração de sintaxe, e
indentação automática de múltiplas linhas. `_` sempre guarda o valor da
última expressão avaliada, útil para capturar um resultado que você
esqueceu de atribuir (`result = _`). O histórico persiste entre sessões uma
vez configurado em `~/.irbrc` (`IRB.conf[:SAVE_HISTORY] = 1000`), que
também é o lugar para definir auxiliares pessoais que carregam em toda
sessão, um wrapper `time { block }` em torno de `Benchmark`, por exemplo, ou
um método de diagnóstico que reabre `Object`.

O detalhe que vale a pena conhecer deliberadamente: `load("file.rb")`,
diferente de `require`, reexecuta o arquivo toda vez que é chamado, mesmo
se já tiver sido carregado; que é exatamente o que o torna útil para iterar
dentro de uma sessão `irb` de longa duração contra um arquivo que você está
editando ativamente, algo que `require` estruturalmente não consegue fazer,
já que é um no-op na segunda chamada para o mesmo caminho. `irb` também
suporta subsessões aninhadas: digitar `irb` de novo dentro de uma sessão
existente abre uma nova com seu próprio namespace independente (`jobs`
lista sessões abertas, `fg n` alterna entre elas); `irb "wombat"` abre uma
subsessão onde `self` é `"wombat"`, uma forma rápida de explorar o
comportamento real de um objeto interativamente sem embrulhá-lo em um
script primeiro.

### Documentando Ruby: RDoc e YARD, brevemente

**RDoc** vem com o Ruby e documenta a própria biblioteca padrão do Ruby;
extrai o bloco de comentário imediatamente anterior a uma definição de
classe, módulo, ou método, sem nenhuma marcação obrigatória: parágrafos
alinhados simples, `_itálico_`, `*negrito*`, `+monoespaçado+`, e listas
`rótulo:: descrição` são tudo que ele precisa. `#--`/`#++` delimitam uma
região que o RDoc deve ignorar completamente, útil para uma nota interna ou
TODO vivendo ao lado da documentação pública sem vazar para ela. `rdoc --ri`
gera o formato que `ri NomeDaClasse#metodo` e a busca de documentação
inline do irb leem diretamente.

**YARD** é o superconjunto de terceiros que a maioria dos autores de gems
usa em vez disso, usando tags `@` estruturadas em vez da prosa livre do
RDoc: `@param nome [Tipo] descrição`, `@return [Tipo] descrição`, `@raise`,
`@example`, `@deprecated`. `yard doc .` gera HTML mais rico que a saída
padrão do RDoc, e `yri` é o equivalente próprio do YARD ao `ri`, escopado
ao projeto atual em vez das classes do core do Ruby.

## Trade-offs

- **One-liners com `-n`/`-p`/`-a` são rápidos de escrever e difíceis de
  reler depois**: perfeitos para um comando genuinamente descartável, de
  execução única; um script que alguém vai ler de novo daqui a um mês
  merece um arquivo de verdade com variáveis nomeadas, mesmo que fique cinco
  linhas mais longo.
- **`OptionParser` cobre bem o parsing de flags simples e para por aí**:
  recorrer a Thor (ou equivalente) no momento em que uma ferramenta precisa
  de subcomandos evita construir à mão uma lógica de despacho para a qual o
  `OptionParser` nunca foi desenhado.
- **A tarefa `default` implícita do Rake é conveniente até ser
  surpreendente**: um `Rakefile` herdado de outra pessoa onde `rake` sozinho
  dispara uma tarefa lenta ou destrutiva (uma reconstrução completa de
  dados, um deploy) é um momento comum de "espera, o que eu acabei de
  rodar"; `rake -T` antes do primeiro `rake` em um repositório desconhecido
  é o seguro barato contra isso.
- **A mutação de `ENV` é limitada ao processo de uma forma que surpreende
  quem vem de shells que fazem source de arquivos no shell atual**: um
  processo Ruby definindo `ENV["X"] = "y"` nunca vai afetar o terminal que o
  lançou, só a si mesmo e seus filhos; quem espera o contrário está pensando
  em `source` do shell, não em `export`.
- **A conveniência de zero marcação do RDoc troca por estrutura contra o
  YARD**: o RDoc é suficiente para um script pequeno ou ferramenta interna;
  uma gem publicada com uma API pública não trivial se beneficia o
  suficiente das tags tipadas `@param`/`@return` do YARD para que a maioria
  dos autores de gems o adote apesar da dependência e sintaxe extras para
  aprender.

## Documentation Links

- [ruby(1), man page de opções de linha de comando](https://docs.ruby-lang.org/en/3.3/man/ruby.1.html) (doc)
- [OptionParser, Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/OptionParser.html) (doc)
- [Rake, GitHub (ruby/rake)](https://github.com/ruby/rake) (doc)
- [IRB, Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/IRB.html) (doc)
- [YARD, guia de introdução](https://rubydoc.info/gems/yard/file/docs/GettingStarted.md) (doc)
- [Programming Ruby 3.3 (Pickaxe), Ruby from the Command Line](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
