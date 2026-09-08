---
version: 1.0
updatedAt: 2026-08-21
title: "Bundler, Gemfiles e Gerenciamento de Dependências"
summary: O Gemfile diz o que você está disposto a rodar; o Gemfile.lock é o que você está de fato rodando. Entender bundle exec, groups e restrições de versão é a diferença entre deploys reproduzíveis e o clássico "funciona na minha máquina".
---
## Objective

`gem install` sozinho não consegue responder "qual versão exata de cada
dependência transitiva essa aplicação roda em produção, e eu consigo
reproduzir isso no meu laptop e no CI?" (esse é o trabalho inteiro do
Bundler). Toda aplicação Rails, e a maioria das gems não triviais, são
construídas em torno de um `Gemfile` e um `Gemfile.lock`, e a diferença entre
eles é a diferença entre "o que estamos dispostos a rodar" e "o que estamos
de fato rodando". Tratar o lock file como bagunça, ou não entender o que
`bundle exec` de fato muda em um processo, é onde desenvolvedores experientes
vindos de outros ecossistemas (o `package-lock.json` do npm parece
semelhante, mas o modelo mental não é idêntico) acabam depurando bugs de
"funciona na minha máquina" que a ferramenta já resolveu.

## Use Cases

- Fixar versões exatas de dependências, incluindo as transitivas, para que um
  deploy rode o mesmo código que passou no CI, não "o que quer que satisfizesse
  as restrições de versão hoje".
- Rodar o executável de uma gem (`rspec`, `rubocop`, `rails`) contra as versões
  travadas para *este* projeto, não a versão mais nova que por acaso está
  instalada globalmente na máquina.
- Isolar dependências por ambiente: não carregar `pry`/`factory_bot` em
  produção, não carregar o driver `pg` (só usado em produção) em um job de CI
  que usa SQLite.
- Desenvolver uma gem localmente contra outra gem local ou uma branch Git ainda
  não publicada, sem publicar nada, via fontes `path:`/`git:`.
- Empacotar e publicar sua própria gem: transformar um diretório `lib/` em algo
  que `gem install` ou uma linha de `Gemfile` consiga baixar.

## Deep Dive

### O Gemfile é Ruby de verdade, avaliado de cima para baixo

```ruby
# Gemfile
source "https://rubygems.org"
ruby "3.3.0"

gem "rails", "~> 7.2.0"
gem "pg", ">= 1.5"

group :development, :test do
  gem "rspec-rails"
  gem "pry"
end

group :test do
  gem "capybara"
end

gem "my_internal_lib", git: "git@github.com:acme/my_internal_lib.git", branch: "main"
gem "local_tool", path: "../local_tool"
```

Nada aqui é um formato de configuração especial: `group do ... end` é uma
chamada de método que recebe um bloco, `gem "x", "~> 1.0"` é uma chamada de
método com uma string de restrição de versão. É por isso que `bundler/inline`
consegue embutir um Gemfile inteiro dentro de um único script standalone
(`require "bundler/inline"; gemfile do ... end`): é só código Ruby sendo
avaliado em um contexto diferente, sem nenhum parser separado envolvido.

Operadores de versão, do mais permissivo ao mais estrito: `>=`, `<=`, `>`,
`<`, `=` (exato), e o que vale a pena memorizar porque está em todo lugar,
`~>` (a restrição "pessimista" ou "twiddle-wakka"). `~> 1.5.2` permite
releases de patch `1.5.x`, mas não `1.6.0`; `~> 1.5` (um segmento a menos)
permite qualquer release minor `1.x`, mas não `2.0.0`. Ele codifica "confie
que releases de patch/minor não vão me quebrar, seguindo semver, mas nunca
adote automaticamente uma versão major".

### `bundle install` resolve uma vez; o `Gemfile.lock` é a verdade real

`bundle install` lê cada linha `gem`, resolve um grafo de dependências que
satisfaz todas elas simultaneamente (incluindo dependências transitivas
declaradas por essas gems), e escreve a versão exata resolvida de *cada* gem
na árvore, diretas e transitivas, no `Gemfile.lock`. Esse lock file, não o
`Gemfile`, é o que é commitado e o que todo `bundle install` subsequente em
qualquer máquina reproduz exatamente, enquanto o lock file existir. `bundle
update` reresolve, mas só dentro das restrições que já estão no `Gemfile`;
`bundle update rails` reresolve `rails` e o que depende dele, sem tocar em
gems não relacionadas. Apagar o `Gemfile.lock` e rodar `bundle install` força
uma reresolução completa do zero, o que é uma operação diferente de `bundle
update` e pode produzir um resultado diferente se novos releases foram
publicados nesse meio tempo.

A regra prática: o `Gemfile.lock` pertence ao controle de versão para uma
aplicação (você quer todo desenvolvedor e todo deploy em versões idênticas).
Para uma gem *biblioteca*, a convenção se inverte: o `.gemspec` declara
restrições soltas e o lock file tipicamente não é commitado, porque uma
biblioteca precisa funcionar em uma faixa de versões que seus consumidores já
podem ter travado, não em uma versão exata.

### `bundle exec`: o que ele de fato muda em um processo

É normal ter várias versões da mesma gem instaladas; `require` sozinho escolhe
a mais nova no load path, que não é necessariamente a que o `Gemfile.lock`
deste projeto resolveu. `bundle exec algum_comando` roda `algum_comando` com o
`$LOAD_PATH` (e `Gem.loaded_specs`) restrito exatamente às versões do
`Gemfile.lock`, antes mesmo de o código do próprio comando rodar. É por isso
que `rspec` rodado nu pode silenciosamente pegar uma versão de `rspec`
diferente da que o projeto travou, enquanto `bundle exec rspec` não consegue.

Dentro de um programa Ruby (em vez de um comando de shell), o equivalente é
`require "bundler/setup"` no topo do ponto de entrada: faz a mesma fixação de
load path, dentro do processo. `bundle binstubs alguma_gem` gera um script
wrapper em `bin/` que já chama `Bundler.setup` internamente, então
`bin/rspec` se comporta como `bundle exec rspec` sem precisar do prefixo toda
vez, o mecanismo do qual `bin/rails` do Rails depende.

### Agrupamento e isolamento por ambiente

```ruby
group :test do
  gem "capybara"
end
```

`Bundler.setup(:default, :production)` (aproximadamente o que um boot de
produção faz) carrega só as gems nesses grupos; `capybara` nunca é requerido
em um processo de produção, mesmo estando listado no mesmo `Gemfile`. As
variáveis de ambiente `BUNDLE_WITH`/`BUNDLE_WITHOUT` controlam isso também no
momento do `bundle install`: um job de CI ou uma imagem de produção pode pular
a instalação de um grupo inteiro (`bundle install --without development
test`), não apenas pular o require dele, o que é o que de fato mantém uma gem
de teste pesada em extensões nativas fora de uma imagem de produção enxuta.

### Fontes alternativas, e desenvolvimento contra código ainda não publicado

```ruby
gem "my_internal_lib", github: "acme/my_internal_lib"   # shorthand for git:
gem "my_internal_lib", git: "...", ref: "abc123"         # pin an exact commit
gem "local_tool", path: "../local_tool"
```

Fontes `git:`/`github:` são buscadas de novo a cada `bundle update`, assim
como uma gem de registro com uma restrição frouxa; o código não fica congelado
até o lock file fixar uma revisão específica. `path:` é diferente por
natureza: aponta para um diretório local real, e edições ali são pegas na
*próxima* execução sem precisar de nenhum `bundle update`, porque não há
nenhuma etapa de busca; o Bundler simplesmente requer o código no lugar. Essa
distinção importa quando se desenvolvem duas gems em conjunto: `path:` dá
feedback instantâneo, `git:` (mesmo fixado em uma branch) ainda exige buscar
de novo para ver um commit novo.

### Publicando uma gem: o formato que RubyGems e Bundler esperam

`bundle gem my_gem` monta o layout convencional:

```
my_gem/
  lib/my_gem.rb          # top-level require_relative fan-out
  lib/my_gem/client.rb   # MyGem::Client (one class per file)
  lib/my_gem/version.rb
  exe/my_gem             # CLI entry point, no .rb extension
  my_gem.gemspec         # metadata + dependencies
  spec/                  # or test/, depending on --test flag
```

O caminho do arquivo espelha o namespace de constantes (`MyGem::Client` mora
em `lib/my_gem/client.rb`), o que também é exatamente o que autoloaders como
o Zeitwerk (o que o Rails usa) exigem para conseguir dar `require` em uma
constante só de referenciá-la, sem nenhuma linha explícita de `require`.

O `.gemspec` também é, de novo, Ruby puro:

```ruby
Gem::Specification.new do |spec|
  spec.name     = "my_gem"
  spec.version  = MyGem::VERSION
  spec.authors  = ["Acme Corp"]
  spec.summary  = "A short summary"
  spec.files    = Dir["lib/**/*.rb"]
  spec.add_dependency "faraday", "~> 2.0"
  spec.add_development_dependency "rspec", "~> 3.13"
end
```

`gem build my_gem.gemspec` empacota um arquivo `.gem` localmente (útil para
conferir antes de publicar, ou para instalar com `gem install
./my_gem-1.0.0.gem` sem sequer tocar no rubygems.org); `gem push
my_gem-1.0.0.gem` publica. Uma vez publicado, `gem yank` pode puxar de volta
um release ruim, embora quem já tenha resolvido e travado aquela versão
continue rodando ela até reresolver.

### Comandos `gem` do dia a dia que vale a pena conhecer fora do Bundler

`gem list` mostra o que está instalado; `gem which alguma_gem` imprime o
caminho do arquivo carregado, a forma mais rápida de responder "qual cópia
disso eu estou de fato rodando"; `gem open alguma_gem` abre o código-fonte
instalado no `$EDITOR`, genuinamente útil para ler (ou aplicar um patch
temporário, para depuração local) a implementação real de uma dependência em
vez de adivinhar a partir da documentação; `gem pristine alguma_gem` restaura
uma gem instalada aos seus arquivos originais se uma edição local ou uma
recompilação incompleta de extensão nativa a deixou quebrada.

## Trade-offs

- **`Gemfile.lock` no git é reprodutibilidade, não burocracia**: a tentação de
  colocá-lo no `.gitignore` porque "só causa conflitos de merge" descarta o
  único artefato que garante que o CI, a máquina de cada desenvolvedor e a
  produção estão rodando versões de dependência idênticas. Resolva o
  conflito; não remova o arquivo.
- **`~>` troca segurança por se manter atualizado automaticamente**: um `~>
  1.5.2` apertado precisa de atualizações manuais a cada release minor (mais
  seguro, mais manual); um `~> 1.5` solto adota automaticamente releases
  minor no próximo `bundle update` (menos manual, confia na disciplina de
  semver da gem). Escolha por dependência, com base em quanto você confia no
  versionamento dos mantenedores.
- **`path:` dá iteração local instantânea, mas não entrega nada em produção**:
  ótimo para desenvolver duas gems juntas, inútil (e ativamente errado) para
  deixar em um `Gemfile` que vai para deploy, já que o caminho não vai existir
  em outra máquina. `git:` fixado em uma ref é o equivalente que pode ir para
  produção quando um release de registro ainda não está pronto.
- **Commitar o `Gemfile.lock` para uma aplicação vs. omiti-lo para uma gem
  biblioteca é a convenção oposta por um motivo**: uma aplicação quer um
  conjunto de dependências exato e reproduzível; uma biblioteca precisa
  continuar instalável ao lado do que *seus* consumidores já travaram, então
  fixar versões transitivas na própria biblioteca entraria em conflito com
  toda aplicação que depende dela.
- **`bundle exec` (ou um binstub) não é cerimônia opcional**: pular esse passo
  funciona bem até duas aplicações na mesma máquina terem travado versões
  diferentes da mesma gem, momento em que `rspec`/`rails` rodados nus pegam
  silenciosamente a versão que `require` encontrar primeiro, e a falha parece
  completamente sem relação com versionamento.

## Documentation Links

- [Bundler, documentação oficial](https://bundler.io/docs.html) (doc)
- [Gemfile, man page (bundler.io)](https://bundler.io/man/gemfile.5.html) (doc)
- [RubyGems Guides, Make Your Own Gem](https://guides.rubygems.org/make-your-own-gem/) (doc)
- [RubyGems Guides, Specification Reference](https://guides.rubygems.org/specification-reference/) (doc)
- [Programming Ruby 3.3 (Pickaxe), Ruby Gems](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
