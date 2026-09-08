---
version: 1.0
updatedAt: 2026-08-18
title: "Ruby Tipado: RBS e Sorbet"
summary: O Ruby é dinamicamente mas fortemente tipado, e duas camadas de tipagem opcional muito diferentes ficam por cima; RBS vem com o Ruby, mantém assinaturas em arquivos separados sig/*.rbs, e nunca afeta o runtime, enquanto o Sorbet (Stripe) coloca blocos sig dentro dos seus arquivos .rb e os verifica em tempo de execução também, levantando um TypeError real em um argumento errado.
---
## Objective

O Ruby é *dinamicamente* tipado (o tipo de um valor é resolvido quando um
método é de fato chamado, late binding, nunca antes) e *fortemente* tipado
(ele se recusa a coagir silenciosamente, então `3 + "3"` levanta `TypeError`
em vez de adivinhar `6` ou `"33"`). O que o Ruby historicamente não tinha era
o terceiro eixo: uma camada *estática opcional*, a coisa que o TypeScript
adicionou ao JavaScript. Duas respostas existem agora e são construídas
sobre filosofias opostas. **RBS** vem com o Ruby 3.0+ e mantém declarações de
tipo em arquivos `.rbs` separados com sua própria sintaxe, afetando só o
ferramental e nunca o programa em execução. **Sorbet** é uma gem de
terceiros originada na Stripe que coloca anotações *dentro* dos seus
arquivos `.rb` como chamadas de método Ruby comuns, e as verifica em tempo
de execução assim como estaticamente. Saber qual dos dois uma base de código
usa diz muito sobre o que "um erro de tipo" sequer significa ali.

## Use Cases

- Documentar a API pública de uma biblioteca de uma forma que um editor
  consiga agir sobre ela (ir para definição, autocompletar, e erros inline)
  sem mudar uma linha da implementação (`sig/` + RBS).
- Pegar `nil` antes da produção: declarar o retorno de um método como
  `String?` / `T.nilable(String)` para que o verificador marque todo ponto
  de chamada que esquece de tratar o caso vazio.
- Impor um contrato em uma fronteira de serviço onde um tipo errado precisa
  falhar *alto e imediatamente*, não três camadas mais fundo; o
  `sorbet-runtime` do Sorbet transforma um argumento ruim em um `TypeError`
  real na chamada.
- Se familiarizar com uma base de código Ruby grande (as da Stripe e da
  Shopify são as usuárias mais conhecidas do Sorbet) onde blocos `sig` são a
  forma mais rápida de ler o que um método de fato aceita.
- Inicializar tipos para código legado com `TypeProf`, depois corrigir à
  mão o `.rbs` rascunho em vez de escrever cada assinatura do zero.
- Tipar colaboradores com duck typing estruturalmente: uma `interface
  _Appendable` do RBS diz "qualquer coisa que responda a `<<`", que é a
  versão em nível de tipo da checagem `respond_to?` que você já estava
  escrevendo.

## Deep Dive

### RBS: os tipos moram ao lado do código, não dentro dele

Arquivos RBS carregam a extensão `.rbs` e, por convenção, moram em uma pasta
`sig/` espelhando `lib/`. A sintaxe *parece* Ruby, mas é uma linguagem
declarativa separada; não há corpos de método, só assinaturas:

```rbs
# sig/report.rbs
class Report
  @rows: Array[Array[String]]

  def initialize: (Array[Array[String]] rows) -> void
  def title: () -> String
  def find_row: (String key) -> Array[String]?
  def to_csv: (separator: String, ?header: bool) -> String
end
```

### A assimetria posicional/nomeada que confunde todo mundo

Olhe de perto `find_row` versus `to_csv`. Para um argumento **posicional**,
*o tipo vem primeiro e o nome vem depois*, e esse nome é pura documentação.
O RBS nunca o verifica contra o método real:

```rbs
def find_row: (String key) -> Array[String]?
#              ^^^^^^ type   ^^^ name, not validated
```

Você pode renomear `key` para `banana` no `.rbs` e nada reclama, porque
argumentos posicionais são pareados por posição. Para um argumento
**nomeado** a ordem se inverte, *nome primeiro, depois o tipo*, e agora o
nome **é** validado, porque é assim que os chamadores o endereçam:

```rbs
def to_csv: (separator: String, ?header: bool) -> String
#            ^^^^^^^^^ name, validated against the real signature
```

O `?` no início de `?header:` marca o nomeado como opcional. Errar o nome de
um argumento nomeado no RBS é um erro genuíno; errar o nome de um posicional
é um erro de digitação em um comentário.

### O vocabulário de tipos do RBS

| RBS | Significa |
| --- | --- |
| `String?` | nilable, `String` ou `nil` |
| `Array[String]`, `Hash[String, Integer]` | genéricos |
| `Integer \| String` | união, um ou outro |
| `bool` | exatamente `true \| false` |
| `boolish` | qualquer objeto, usado só por sua veracidade |
| `top` | o supertipo de tudo: um tipo *conhecido*, mas maximamente genérico |
| `untyped` | "eu não sei o tipo", um marcador explícito de ignorância |
| `void` | um valor de retorno que existe mas não deve ser usado |

A distinção entre `top` / `untyped` importa mais do que parece. `top` é uma
afirmação real ("isso pode ser qualquer objeto, e eu quero dizer isso"); o
verificador vai te impedir de chamar métodos exclusivos de `String` nele.
`untyped` é uma válvula de escape que desliga a verificação para aquele
valor; vale tudo. Um arquivo cheio de `untyped` passa a verificação de tipo
limpinho enquanto não te diz nada, que é exatamente o modo de falha de uma
assinatura autogerada que ninguém revisou.

`void` diz que o método é chamado pelo seu efeito colateral: `def log:
(String) -> void` significa "não construa lógica sobre o que quer que
volte."

### `interface _Name`: duck typing tipado

Uma `interface` declara um conjunto de métodos sem nomear uma classe.
Qualquer objeto com esses métodos a satisfaz; tipagem estrutural, a mesma
ideia de uma interface do TypeScript. A convenção é um underscore inicial:

```rbs
interface _Appendable
  def <<: (String) -> self
end

class Report
  def write_to: (_Appendable out) -> void
end
```

`String`, `Array`, `File`, e `StringIO` todos satisfazem `_Appendable` sem
declarar nada, então `write_to` continua tão substituível quanto era; você
só escreveu o contrato que o duck typing deixava implícito.

### RBS não faz nada em tempo de execução

Esse é o fato mais importante sobre o RBS: é **só análise estática e
ferramental**. O Ruby não lê sua pasta `sig/` durante a execução, e nenhuma
declaração em um arquivo `.rbs` pode jamais levantar exceção. Violações
aparecem quando você roda um verificador de tipo (o Steep é o mais comum) ou
no seu editor, nunca em produção. Um `.rbs` obsoleto está silenciosamente
errado, e só o verificador no CI o mantém honesto.

### O `TypeProf` escreve o primeiro rascunho

`typeprof` gera um esqueleto `.rbs` *executando abstratamente* seu código:
ele percorre os caminhos rastreando **tipos em vez de valores**, e reporta o
que flui para onde.

```console
$ typeprof lib/report.rb -o sig/report.rbs
```

É um ponto de partida genuinamente bom e um ponto de chegada ruim. Dois
limites aparecem imediatamente: ele emite muito `untyped` onde não consegue
decidir, e se perde em metaprogramação; um `send` com um nome de método
construído dinamicamente não tem resposta estática, então tudo a jusante
degrada para `untyped`. Trate a saída como um rascunho para corrigir, não
uma assinatura para commitar sem ler.

### A biblioteca padrão já é tipada, e a CLI consegue consultá-la

Toda classe da biblioteca padrão do Ruby vem com definições RBS, o que é o
motivo de o ferramental funcionar de forma útil desde o primeiro dia. A CLI
`rbs` as lê:

```console
$ rbs ancestors ::String
::String
::Comparable
::Object
::Kernel
::BasicObject

$ rbs method ::String gsub
::String#gsub
  defined_in: ::String
  implementation: ::String
  accessibility: public
  types:
    (Regexp | String pattern, String replacement) -> String
  | (Regexp | String pattern) { (String match) -> _ToS } -> String
```

Essa segunda sobrecarga vale a pena ler como documentação por si só: ela diz
que a forma com bloco recebe a `String` correspondida e aceita de volta
qualquer coisa que consiga se renderizar como string.

### Sorbet: anotações são Ruby de verdade

O Sorbet faz a aposta oposta. Não há arquivo separado para o seu próprio
código; `sig` é uma chamada de método de verdade, avaliada quando a classe é
carregada. Três peças o ligam: a gem `sorbet-runtime`, um comentário mágico
`# typed:` no topo do arquivo, e `extend T::Sig` na classe.

```ruby
# typed: true
require "sorbet-runtime"

class Report
  extend T::Sig

  sig { params(rows: T::Array[T::Array[String]]).void }
  def initialize(rows)
    @rows = rows
    @counts = T.let({}, T::Hash[String, Integer])
  end

  sig { params(key: String).returns(T.nilable(T::Array[String])) }
  def find_row(key)
    @rows.find { |row| row.first == key }
  end

  sig { params(separator: String, header: T::Boolean).returns(String) }
  def to_csv(separator: ",", header: true)
    lines = @rows.map { |row| row.join(separator) }
    header ? ["key#{separator}value", *lines].join("\n") : lines.join("\n")
  end
end
```

O comentário mágico é um **sigilo** com níveis: `# typed: false` reporta só
problemas em nível de sintaxe, `# typed: true` é o nível de verificação
normal, `# typed: strict` exige adicionalmente um `sig` em todo método e um
tipo declarado para toda variável de instância, e `# typed: strong` rejeita
`T.untyped` completamente. Sigilos por arquivo são o que torna o Sorbet
adotável incrementalmente em uma base de código grande; você sobe o nível
arquivo por arquivo.

`.void` substitui `.returns(...)` quando o valor de retorno não é feito
para ser usado, a mesma ideia do `void` do RBS.

### O vocabulário de tipos do Sorbet, mapeado para o RBS

| Sorbet | Equivalente em RBS |
| --- | --- |
| `T::Array[String]`, `T::Hash[String, Integer]` | `Array[String]`, `Hash[String, Integer]` |
| `T::Boolean` | `bool` |
| `T.nilable(String)` | `String?` |
| `T.any(Integer, String)` | `Integer \| String` |
| `T.untyped` | `untyped` |
| `.void` | `-> void` |

Semanticamente esses se alinham de perto; a diferença é sintática. O RBS
inventa uma gramática, o Sorbet reutiliza a do Ruby; `T.nilable(String)` é
uma chamada de método que retorna um objeto tipo, o que é o motivo de ele se
compor com Ruby comum (`T.any(*TYPES)` funciona).

### `T.let` quando a inferência não tem com o que trabalhar

O Sorbet infere o tipo de uma variável de instância a partir de sua primeira
atribuição. Isso falha sempre que o valor inicial é vazio, porque `{}` não
revela nada sobre o que vai entrar nele:

```ruby
@counts = {}                                  # Hash[T.untyped, T.untyped]
@counts = T.let({}, T::Hash[String, Integer]) # declared, and checked from here on
```

`T.let(value, Type)` afirma o tipo e, sob `sorbet-runtime`, o verifica ali
mesmo. Use-o para coleções vazias, para inicializadores `nil`
(`T.let(nil, T.nilable(Report))`), e em qualquer lugar onde o tipo estático
de um valor é mais amplo do que você sabe que ele de fato é.

### Splats são anotados por elemento

Uma leitura errada comum. Para `*args` e `**opts`, o tipo que você escreve
descreve **cada elemento**, não o Array ou Hash resultante:

```ruby
sig { params(parts: String, options: T::Boolean).returns(String) }
def self.join_path(*parts, **options)
  parts.join("/")
end
```

`params(parts: String)` significa "todo elemento de `parts` é uma
`String`", não "`parts` é uma `String`". Escrever `T::Array[String]` ali
estaria errado: significaria que cada elemento é ele mesmo um array de
strings.

### O verdadeiro diferencial: o Sorbet também verifica em tempo de execução

O RBS só pode estar errado silenciosamente. O Sorbet, como `sig` é código
executado, envolve o método e valida argumentos e valores de retorno
**enquanto o programa roda**:

```ruby
Report.new([["a", "1"]]).find_row(:a)
# TypeError: Parameter 'key': Expected type String, got type Symbol with value :a
```

Essa é uma exceção genuína de um `TypeError` genuíno, no ponto de chamada,
tanto em desenvolvimento quanto em produção, não um relatório de um linter.
A passagem estática é separada e roda sob demanda:

```console
$ bundle exec srb tc
```

Dependências que você não é dono são tratadas pelo **Tapioca** (uma gem da
Shopify), que gera arquivos `.rbi` (o formato de interface do Sorbet) para
suas gems em `sorbet/rbi/`:

```console
$ bundle exec tapioca init
$ bundle exec tapioca gems
```

A camada de runtime também é a parte com um custo: toda chamada de método
tipado paga pela validação. `sorbet-runtime` deixa você diminuir isso
(níveis de checagem, ou desabilitar validação em produção) precisamente
porque a segurança não é de graça.

## Trade-offs

- **Tipagem compra comunicação e ferramental, e cobra verbosidade**: esse é
  o próprio enquadramento do Pickaxe. Uma linha `sig` ou `.rbs` diz ao
  próximo leitor (e ao editor, e ao CI) exatamente o que um método aceita,
  que vale muito em um time grande. Também significa que toda mudança de
  assinatura agora é duas edições em vez de uma, e um método de três linhas
  pode acabar com uma anotação de duas linhas.
- **Nenhuma das duas soluções venceu na comunidade**: diferente do
  TypeScript no mundo JavaScript, Ruby tipado não é o padrão. O Sorbet é
  usado a sério em escala (a Stripe o originou, a Shopify constrói
  ferramental sobre ele), e o RBS vem com o próprio Ruby, mas muito Ruby de
  produção não usa nenhum dos dois. Espere encontrar as duas convenções e
  escolher por projeto em vez de herdar um padrão de indústria.
- **Arquivos separados (RBS) vs. anotações inline (Sorbet) é uma troca de
  manutenção**: o RBS mantém seus arquivos `.rb` limpos e permite tipar uma
  gem que você não é dono, ao preço de um segundo arquivo que pode se
  desalinhar sem checagem. As anotações do Sorbet não conseguem se
  desalinhar do método sobre o qual ficam, mas colocam declarações de tipo
  no meio do código que você está tentando ler.
- **Verificação em tempo de execução é uma garantia real com uma conta
  real**: o Sorbet pegar um argumento errado como um `TypeError` de fato é
  estritamente mais do que o RBS consegue oferecer, e também é trabalho
  feito em toda chamada, mais uma nova classe de falha de produção (uma
  assinatura que é meramente *estrita demais* agora levanta exceção onde o
  código teria funcionado). A incapacidade do RBS de levantar exceção é uma
  limitação e uma propriedade de segurança ao mesmo tempo.
- **Tipos autogerados são um rascunho, não uma resposta**: `TypeProf` e o
  Tapioca economizam um esforço de digitação enorme, mas `untyped` em todo
  lugar passa a verificação de tipo perfeitamente enquanto não prova nada, e
  metaprogramação derrota os dois. Assinaturas geradas e não revisadas
  compram a cerimônia da tipagem sem o benefício.
- **Tipos estáticos brigam com a dinamicidade pela qual as pessoas vieram
  para o Ruby**: `method_missing`, `define_method`, `send` com um nome
  calculado, e DSLs que constroem classes no momento do carregamento são
  todos difíceis ou impossíveis de expressar estaticamente. Adotar tipos
  costuma significar escrever Ruby menos dinâmico, que é uma mudança de
  design, não só uma mudança de anotação.

## Documentation Links

- [RBS, ruby/rbs no GitHub](https://github.com/ruby/rbs) (doc)
- [Sorbet, documentação oficial](https://sorbet.org/) (doc)
- [Tapioca, Shopify/tapioca no GitHub](https://github.com/Shopify/tapioca) (doc)
- [TypeProf, ruby/typeprof no GitHub](https://github.com/ruby/typeprof) (doc)
- [Steep: static type checker for Ruby using RBS](https://github.com/soutaro/steep) (doc)
- [Programming Ruby 3.3 (Pickaxe), Typed Ruby](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
