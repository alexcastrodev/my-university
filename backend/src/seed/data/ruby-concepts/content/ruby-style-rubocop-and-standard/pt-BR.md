---
version: 1.0
updatedAt: 2026-08-21
title: "Estilo em Ruby: RuboCop, Standard e a Aplicação de Convenções"
summary: A sintaxe do Ruby tolera quase qualquer escolha de formatação, e é exatamente por isso que times de verdade rodam um linter, os cops e severidades configuráveis do RuboCop, ou a resposta sem configuração do Standard para o mesmo problema, além de como adotar um dos dois em uma base de código que nunca teve um.
---
## Objective

A sintaxe do Ruby é flexível o bastante para que dois arquivos na mesma base
de código pareçam ter sido escritos por linguagens diferentes (`{}` ou
`do...end`, parênteses explícitos ou não, indentação de dois ou quatro
espaços), e nada disso é erro de sintaxe. Essa flexibilidade é exatamente o
motivo de todo time acima de um punhado de engenheiros acabar rodando um
linter no CI: não para pegar bugs (alguns cops fazem isso), mas para remover
as centenas de pequenas decisões de formatação que de outra forma
transformariam todo pull request em um debate de estilo. RuboCop é o linter
para o qual essa questão converge em quase todo lugar no mundo Ruby;
Standard é a resposta para times que preferem nem ter esse debate sobre a
configuração do linter. Saber o que é um "cop", o que as severidades
significam, e como adotar linting em uma base de código que nunca teve um
são conhecimentos básicos para trabalhar em um time Ruby de verdade, não
trivia acadêmica de estilo.

## Use Cases

- Ler um `.rubocop.yml` em um repositório desconhecido e saber o que os
  namespaces de cop `Layout/`, `Style/`, `Lint/` e `Metrics/` aproximadamente
  fiscalizam, antes de tocar em um único arquivo.
- Decidir se uma checagem de lint falhando no CI é segura de autocorrigir
  (`rubocop -a`) ou precisa de um julgamento humano (`rubocop -A`,
  autocorreção não segura, ou uma correção manual).
- Introduzir linting em uma base de código legada grande sem um projeto de
  várias semanas de "corrigir tudo primeiro" bloqueando isso.
- Desabilitar um cop específico para uma linha justificada sem desabilitá-lo
  no projeto inteiro, e saber a sintaxe exata desse comentário mágico.
- Escolher entre a configurabilidade total do RuboCop e a postura sem
  configuração do Standard para um projeto novo, com base em quanto o time
  de fato quer discutir formatação.

## Deep Dive

### As convenções que um linter existe para parar de discutir

O Ruby idiomático tem convenções consolidadas que são anteriores a qualquer
linter e que o RuboCop majoritariamente só codifica: indentação de dois
espaços, nunca tabs ou quatro espaços; `when` dentro de um `case`, e
`rescue`/`ensure` dentro de um `begin`, **não** são indentados em relação ao
seu pai; eles não são blocos logicamente aninhados, são cláusulas da mesma
instrução; métodos depois de uma palavra-chave `private` nua também ficam na
mesma indentação dos métodos acima dela. Sem ponto e vírgula no final.
Espaços em torno de operadores binários, em torno de `=`, e depois de
vírgulas, mas não dentro de `[]`/`()`. As exceções são consistentes o
bastante para decorar como um grupo: sem espaço em torno de um range
(`1..10`), um `!` unário (`!foo`), navegação segura (`&.`), exponenciação
(`x**2`), ou um literal Rational (`3/5r`).

Nomenclatura segue um padrão fixo: `snake_case` para variáveis, métodos, e
nomes de arquivo; `CamelCase` para classes e módulos (com siglas mantidas em
minúsculas internamente: `HttpReceiver`, não `HTTPReceiver`);
`SCREAMING_SNAKE_CASE` para constantes. Accessors abandonam os prefixos
`get`/`set` de estilo Java (`user.name`, não `user.getName`), métodos
predicado terminam em `?` em vez de começar com `is_`, e métodos que mutam
ou são perigosos terminam em `!` por convenção, não por imposição:
`sort!` de fato muta no lugar, mas nada impede um método mal nomeado que não
faça isso.

A escolha de delimitador de bloco tem uma divisão de estilo genuína que vale
a pena conhecer em vez de simplesmente escolher um lado: a regra comum é
`{}` para um bloco de uma linha, `do...end` para um multilinha, exceto o que
às vezes é chamado de "convenção Weirich" (em homenagem a Jim Weirich, autor
do Rake), que mantém `{}` mesmo para um bloco multilinha quando o valor de
retorno do bloco é encadeado (`arr.map { |x| ... }.sort.first`), porque
`end.sort.first` lê mal. O cop `Style/BlockDelimiters` do RuboCop tem uma
configuração exatamente para essa distinção, o que é o motivo de duas bases
de código limpas pelo RuboCop ainda poderem discordar sobre isso.

### RuboCop: cops, severidades, e adotando sem uma reescrita

As regras do RuboCop são chamadas de **cops**, organizadas em namespaces por
preocupação: `Layout` (espaço em branco, indentação), `Style` (preferência
de idioma, `{}` vs `do...end`, aspas de literal de string), `Lint` (coisas
que plausivelmente são bugs, não só gosto), `Metrics` (tamanho de método,
tamanho de classe, complexidade ciclomática), e mais. Todo cop tem uma
severidade configurável (`Info < Refactor < Convention < Warning < Error <
Fatal`), controlando quão alto uma violação é reportada e se ela falha o
CI.

A configuração mora em `.rubocop.yml`, ele mesmo só YAML habilitando,
desabilitando, e ajustando cops individuais:

```yaml
AllCops:
  NewCops: enable
  TargetRubyVersion: 3.3

Style/Documentation:
  Enabled: false

Layout/LineLength:
  Max: 120

Metrics/MethodLength:
  Max: 15
  Exclude:
    - 'db/migrate/**/*'
```

`rubocop -a` autocorrige violações que o RuboCop considera **seguras**:
mudanças que não conseguem alterar o comportamento, como adicionar um
espaço faltando. `rubocop -A` também aplica autocorreções **não seguras**:
mudanças que geralmente estão certas, mas poderiam, em um caso incomum,
mudar o comportamento (reordenar chaves de hash, converter arrays `%w[]`),
o que é o motivo de a saída de `-A` merecer uma revisão de diff de verdade
antes de commitar, e `-a` ser a que é segura de rodar sem supervisão em um
hook de pre-commit.

Adotar o RuboCop em uma base de código com anos de histórico sem linting não
significa corrigir toda violação existente antes de o linter poder ser útil.
`rubocop --auto-gen-config` escaneia a base de código atual e gera um
`.rubocop_todo.yml` que suprime todo cop já sendo violado, arquivo por
arquivo; o linter fica verde imediatamente, e o arquivo todo se torna um
backlog visível e que pode encolher em vez de um bloqueador. Código novo é
mantido no padrão completo desde o dia um; violações antigas são corrigidas
oportunisticamente (ou via uma passagem de limpeza agendada) sem uma
reescrita que pare o mundo.

Uma única exceção justificada não precisa de nenhuma mudança de
configuração; um comentário mágico a delimita a uma linha ou bloco:

```ruby
# rubocop:disable Metrics/AbcSize
def legacy_report_generator
  # ...gnarly, deliberately-not-refactored-yet method...
end
# rubocop:enable Metrics/AbcSize
```

O par disable/enable sempre deveria vir junto e delimitado o mais
estreitamente possível; um `disable` sem um `enable` correspondente silencia
o cop pelo resto do arquivo, o que é um bug comum de escopo acidental se
alastrando em um diff grande.

### Standard: a mesma aplicação, zero debate de configuração

`standard` (CLI: `standardrb`) é o RuboCop por baixo dos panos, com uma
configuração fixa e opinativa e deliberadamente quase nenhuma configuração
exposta. O argumento, do seu autor Justin Searls, é explícito: times gastam
tempo de verdade discutindo configurações de `.rubocop.yml` que não importam
de fato para correção (tabs vs. espaços, estilo de aspas, regras de vírgula
final), e o Standard remove essa superfície inteiramente entregando uma
única resposta. `standardrb --fix` autocorrige, a mesma ideia de `rubocop
-a`. O trade-off é simétrico à liberdade de configuração que o RuboCop
oferece: um time que genuinamente quer `Metrics/MethodLength` definido como
30 em vez do padrão, ou quer um cop que o Standard não habilita, precisa
aceitar a resposta do Standard ou voltar direto para o RuboCop.

### Parênteses, e as exceções que vale a pena conhecer

A convenção da casa na maioria dos guias de estilo é usar parênteses em
chamadas de método com argumentos, mas com exceções específicas e fáceis de
lembrar: métodos do `Kernel` que leem como palavras-chave (`puts`, `p`,
`require`), declarações no corpo da classe que leem como palavras-chave
(`include Comparable`, `private`), e chamadas de método de DSL feitas para
ler como prosa (`it "does a thing" do` do RSpec). Nunca escreva parênteses
vazios em uma chamada sem argumentos (`foo()` em vez de `foo`), com uma
exceção deliberada: `super()` com parênteses vazios significa "chame o
método pai com **nenhum** argumento", que é uma chamada diferente de um
`super` nu (repassa o que quer que o método atual tenha recebido). Retirar
os parênteses ali não é uma violação de estilo, é uma mudança de
comportamento.

## Trade-offs

- **A configurabilidade do RuboCop também é seu custo**: um time consegue
  ajustar cada cop ao gosto, mas esse ajuste em si é uma fonte recorrente de
  debate em PR que o Standard existe especificamente para remover. Escolha o
  RuboCop quando o time tem motivos genuínos, não de bikeshedding, para
  desviar dos padrões (um limite de `Metrics::` que não cabe em uma base de
  código pesada em domínio); escolha o Standard quando a resposta para a
  maioria das perguntas de configuração seria "tanto faz, vamos só escolher
  uma".
- **`-A` (autocorreção não segura) é um diff para revisar, não um comando
  para confiar cegamente**: geralmente está certo, que é precisamente o que
  torna o caso raro errado perigoso: ele escapa da revisão porque "é só o
  linter" recebe menos escrutínio do que uma mudança escrita por humano.
- **`--auto-gen-config` desbloqueia adoção mas pode calcificar em dívida
  permanente** se o `.rubocop_todo.yml` resultante nunca for revisitado;
  trate-o como um backlog com um dono, não como uma lista de isenção
  permanente.
- **A severidade de um cop é uma decisão de política, não um fato sobre o
  código**: times que definem tudo como `Error` ganham um CI que bloqueia
  por caprichos puros de estilo; times que deixam cops `Lint` que
  genuinamente parecem bug em `Warning` arriscam mesclar coisas que o
  RuboCop de fato capturou corretamente. As severidades padrão são um ponto
  de partida razoável, não algo para deixar sem exame para sempre.

## Documentation Links

- [RuboCop, documentação oficial](https://docs.rubocop.org/rubocop/) (doc)
- [RuboCop, referência de configuração de cop](https://docs.rubocop.org/rubocop/configuration.html) (doc)
- [Standard, Ruby Style Guide, guia de si mesmo](https://github.com/standardrb/standard) (doc)
- [Programming Ruby 3.3 (Pickaxe), Ruby Style](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
