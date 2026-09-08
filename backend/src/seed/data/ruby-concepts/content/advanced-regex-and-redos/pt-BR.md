---
version: 1.0
updatedAt: 2026-08-18
title: "Regex em Ruby Além do Básico, e a Armadilha do ReDoS"
summary: Os recursos de regex além de /pattern/, literais %r{}, match? vs. os globais $~, /i /m /x /o, grupos nomeados, substituição via Hash e bloco, Regexp.union, além do backtracking catastrófico, por que acontece, o que a correspondência em tempo linear do Ruby 3.2 cobre (e o que não cobre), e como Regexp.timeout= transforma uma CPU travada em uma exceção tratável.
---
## Objective

Praticamente todo programa Ruby usa uma expressão regular, e praticamente todo
programa Ruby usa apenas umas quatro das funcionalidades da linguagem para regex.
O resto da superfície (literais `%r{}`, `match?` versus `=~`, a sintaxe estendida
`/x`, grupos nomeados que viram variáveis locais, `gsub` com um Hash,
`Regexp.union` para padrões dinâmicos) é o que transforma um one-liner ilegível
em algo que um revisor consegue conferir. E por baixo de tudo isso existe uma
propriedade de segurança em que a maioria dos desenvolvedores nunca pensa: uma
regex é um *programa*, pode levar tempo exponencial em uma entrada hostil, e o
Ruby traz um controle de verdade para isso (`Regexp.timeout=`, desde a 3.2)
justamente porque ReDoS é uma classe real de incidente em produção, não uma
curiosidade de livro-texto.

## Use Cases

- Casar URLs, caminhos, ou qualquer outra coisa cheia de caracteres `/` sem uma
  parede de escapes `\/`, usando `%r{...}`.
- Testar "essa string parece com X?" em um loop quente ou em uma validação, onde
  `match?` evita alocar um `MatchData` e evita escrever em `$~`.
- Escrever um padrão longo o bastante para merecer comentários (uma data, um
  telefone, uma linha de log) com `/x`, para poder ser lido na vertical em vez de
  como uma fita densa única.
- Extrair vários campos de uma string com grupos nomeados e lê-los como
  `md[:year]` em vez de contar parênteses para achar `$3`.
- Construir um padrão em tempo de execução a partir de configuração ou entrada
  do usuário com `Regexp.new` / `Regexp.union` / `Regexp.escape`.
- Reescrever texto onde a substituição precisa ser *calculada* (templating,
  redação, conversão de unidades): a forma com bloco de `sub`/`gsub`.
- Aceitar um padrão de busca de um usuário final, ou casar entrada não confiável
  contra um padrão complicado, e precisar de uma garantia forte de que uma
  requisição não vai travar um núcleo de CPU para sempre.

## Deep Dive

### Dois literais, e o caso de uso do `%r{}`

`/pattern/` é o literal do dia a dia. `%r{pattern}` é a mesma coisa com um
delimitador diferente, e toda sua razão de existir é que `/` dentro do padrão
deixa de precisar de escape:

```ruby
/https?:\/\/[^\/]+\/users\/\d+/     # leaning-toothpick syndrome
%r{https?://[^/]+/users/\d+}        # same pattern, readable
```

`%r` aceita qualquer par de delimitadores (`%r{}`, `%r[]`, `%r()`, `%r!!`), e
recebe as mesmas opções finais que `/.../`. Quando o padrão vem de uma variável
em tempo de execução, use os construtores em vez disso:

```ruby
Regexp.new("hello", Regexp::IGNORECASE | Regexp::EXTENDED)  # options combine with |
Regexp.escape("a.b*c")            # => "a\\.b\\*c" (treat user text as literal)
Regexp.union("GET", "POST", "PUT") # => /GET|POST|PUT/
Regexp.union("a.b", /c+/).source   # => "a\\.b|(?-mix:c+)"
```

`Regexp.union` é a forma segura de construir "casar qualquer um destes":
argumentos String são escapados automaticamente, argumentos Regexp são
embutidos como estão. A única restrição que vale a pena lembrar é que **grupos
de captura dentro de uma união têm numeração indefinida**: os grupos de cada
alternativa são concatenados, então qual índice guarda seu valor depende de
qual ramo casou:

```ruby
u = Regexp.union(/(\d+)/, /(\w+)/)
u.match("abc").captures   # => [nil, "abc"]
```

Se você precisa de capturas, monte a alternação você mesmo em vez de usar union.

### `match?` é o teste booleano moderno

O Ruby tem quatro formas de perguntar se um padrão casa, e elas diferem no que
retornam *e* em se mexem ou não em estado global oculto:

| Forma | Retorna | Preenche `$~`, `$1`, `$&`? |
| --- | --- | --- |
| `re.match?(str)` | `true` / `false` | não |
| `re.match(str)` | `MatchData` ou `nil` | sim |
| `re =~ str` | índice ou `nil` | sim |
| `re === str` | `true` / `false` | sim (usado por `case`/`when`) |

```ruby
"hello".match?(/l(l)o/)   # => true
$~                        # => nil (nothing was touched)

md = "hello".match(/l(l)o/)
md[0]         # => "llo"
md[1]         # => "l"
md.pre_match  # => "he"
md.post_match # => ""
```

Prefira `match?` quando você só quer um sim/não: ele pula a construção do
`MatchData` e pula a contabilidade de `$~`, então é mensuravelmente mais rápido
em código de validação. Quando você *precisa* das capturas, use `match` e
trabalhe com o objeto `MatchData` retornado, não com as variáveis globais
implícitas. `$~`, `$1`, `$&` e `Regexp.last_match` são locais ao frame e à
thread, o que parece seguro até um método auxiliar chamado no meio do caminho
refazer silenciosamente algum match e seu `$1` passar a significar outra coisa.
`=~` e `match` não estão depreciados, mas ler seus resultados de variáveis
globais é um hábito que vale a pena abandonar.

### Opções: `i`, `m`, `x`, `o`

```ruby
/ruby/i          # case-insensitive
/<.*>/m          # multiline: "." also matches "\n"
/\A\d+\z/x       # extended: whitespace and # comments in the pattern are ignored
/val=#{x}/o      # interpolate #{} exactly once, on first evaluation
```

`/m` em Ruby significa só "`.` casa quebra de linha também"; `^`/`$` no Ruby são
*sempre* âncoras de linha, diferente de Perl ou JavaScript. Use `\A` e `\z`
quando você quer dizer "início/fim da string inteira"; `/\A\d+\z/` e `/^\d+$/`
são checagens diferentes, e a segunda aceita alegremente `"1\nrm -rf /"`.

`/x` é a opção que torna padrões longos revisáveis:

```ruby
PHONE = /
  \A
  (?<area>\d{3})   # area code
  -
  (?<num>\d{4})    # local number
  \z
/x

PHONE.match("555-1234")&.named_captures
# => {"area" => "555", "num" => "1234"}
```

Sob `/x`, um espaço literal precisa ser escrito `\ ` ou `[ ]`, e um `#` literal
precisa ser escapado.

`/o` é uma armadilha disfarçada de otimização: ela congela a interpolação após
a primeira avaliação:

```ruby
def build(x) = /val=#{x}/o
build("a").source   # => "val=a"
build("b").source   # => "val=a"   <-- still the first one
```

Só use quando o valor interpolado for genuinamente constante durante toda a
vida do processo, e mesmo assim o ganho é pequeno.

### Classes de caracteres e quantificadores

As abreviações, cada uma com sua gêmea negada maiúscula:

| Classe | Casa com | Negação |
| --- | --- | --- |
| `\d` | dígito decimal | `\D` |
| `\h` | dígito hexadecimal (`0-9a-fA-F`) | `\H` |
| `\s` | espaço em branco | `\S` |
| `\w` | caractere de palavra (`[a-zA-Z0-9_]`) | `\W` |
| `\R` | quebra de linha genérica (`\n`, `\r\n`, `\r`, Unicode) | (nenhuma) |
| `\X` | um cluster de grafema Unicode completo | (nenhuma) |

`\R` e `\X` são as que as pessoas esquecem e depois precisam. `\R` casa com uma
quebra de linha independente da plataforma, então `"a\r\nb".scan(/\R/)` produz
um elemento, não dois. `\X` casa com um caractere inteiro percebido pelo
usuário, incluindo marcas de combinação:

```ruby
s = "é"       # "é" written as e + combining acute accent
s.length             # => 2  (two codepoints)
s.scan(/./).size     # => 2
s.scan(/\X/).size    # => 1  (one grapheme)
```

Quantificadores (`*`, `+`, `{m,n}`) são **gulosos**: consomem o máximo possível
e só devolvem caracteres quando o resto do padrão falha. Um `?` no final os
torna preguiçosos, consumindo o mínimo:

```ruby
"<a><b>"[/<.*>/]    # => "<a><b>"   greedy
"<a><b>"[/<.*?>/]   # => "<a>"      lazy
```

A armadilha que pega todo mundo pelo menos uma vez: `*` e `{0,n}` permitem zero
ocorrências, então um padrão construído só com eles **sempre casa**, na posição
zero, com uma string vazia:

```ruby
"xyz" =~ /a*/          # => 0    (not nil!)
"xyz"[/a*/]            # => ""
"xyz".gsub(/a*/, "-")  # => "-x-y-z-"
```

Se uma validação lê `raise unless input =~ /\A\d*\z/`, ela aceita a string
vazia. Use `+` quando você quer dizer "pelo menos um".

### A alternação tem a menor precedência

`|` tem a menor precedência entre todos os operadores de regex, menor que a
concatenação. Então este padrão *não* está perguntando sobre dois tipos de céu:

```ruby
/red ball|angry sky/
```

Ele significa `(red ball)|(angry sky)`. Ambos casam abaixo, e `"red sky"` não
casa:

```ruby
"red ball"  =~ /red ball|angry sky/    # => 0
"angry sky" =~ /red ball|angry sky/    # => 0
"red sky"   =~ /red ball|angry sky/    # => nil
"red sky"   =~ /red (ball|sky)/        # => 0
```

Sempre coloque entre parênteses uma alternação que esteja dentro de um padrão
maior. Use um grupo não capturante `(?:...)` quando você só quer o escopo, não
uma captura.

### Grupos nomeados, e o truque de variáveis locais com `=~`

Capturas numeradas deixam de ser legíveis a partir de mais ou menos três
grupos. Grupos nomeados resolvem isso, e funcionam de três formas:

```ruby
md = "2026-08-18".match(/(?<year>\d{4})-(?<month>\d{2})/)
md[:year]          # => "2026"
md.named_captures  # => {"year" => "2026", "month" => "08"}
```

Dentro do padrão, `\k<name>` referencia de volta um grupo nomeado; é assim que
se encontra uma palavra duplicada:

```ruby
"the the cat"[/\b(?<w>\w+)\s+\k<w>\b/]   # => "the the"
```

E existe um pedaço de mágica genuína do Ruby: quando um **literal** de regex
está do lado esquerdo de `=~`, seus grupos nomeados são atribuídos a variáveis
locais:

```ruby
if /\A(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})\z/ =~ "2026-08-18"
  [year, month, day]   # => ["2026", "08", "18"]
end
```

Isso só funciona com um literal do lado esquerdo. `re = /(?<year>\d{4})/; re =~
s` não cria nada, e `"2026" =~ /(?<year>\d{4})/` (string do lado esquerdo)
também não cria nada. É um truque interessante, mas conjura variáveis locais a
partir de um padrão; em código compartilhado, `md = str.match(...)` seguido de
`md[:year]` é mais fácil de acompanhar.

### Substituição: a forma com Hash e a forma com bloco

`gsub` aceita um Hash como sua substituição, buscando cada match como uma
chave:

```ruby
map = Hash.new("?").merge("cat" => "gato", "dog" => "cachorro")
"cat and dog and bird".gsub(/\w+/, map)
# => "gato ? cachorro ? ?"
```

Definir um `default` no Hash (aqui via `Hash.new("?")`) é o que impede matches
não mapeados de virarem strings vazias, uma forma limpa de escrever uma tabela
de tradução ou redação sem um bloco.

Quando a substituição precisa ser calculada, passe um bloco. O match é entregue
ao bloco como uma String:

```ruby
"price: 10 and 20".gsub(/\d+/) { |m| (m.to_i * 2).to_s }
# => "price: 20 and 40"
```

A forma com bloco também é a forma *segura*. Em uma **string** de substituição,
`\0`/`\&` significam "o match inteiro", `\1`..`\9` significam grupos numerados,
`` \` `` e `\'` significam pré e pós-match; então qualquer uma dessas
sequências aparecendo nos seus dados é interpretada em vez de inserida
literalmente, e conseguir um backslash literal exige contar escapes tanto no
literal de string do Ruby quanto na passagem de substituição:

```ruby
"hello".sub(/(l+)/, '[\1]')   # => "he[ll]o"
"price".sub(/p/, '\&\&')      # => "pprice"   (\& expanded twice)
"a-b".gsub(/-/, '\\\\')       # => "a\\b"     (four backslashes for one)
"a-b".gsub(/-/) { "\\" }      # => "a\\b"     (block form, no double pass)
```

Note que a forma com aspas duplas é ainda pior, porque o próprio escaping do
Ruby acontece primeiro. Se seu texto de substituição é dinâmico, use o bloco.

### ReDoS: por que uma regex pode travar, e o que o Ruby faz sobre isso

O motor de regex do Ruby (Onigmo) é um motor de backtracking. Quando um padrão
pode casar o mesmo texto de mais de uma forma, uma falha o obriga a voltar e
tentar a próxima divisão. Aninhe dois quantificadores e o número de divisões
cresce exponencialmente com o tamanho da entrada. O caso clássico é
`/(a+)+b/` contra uma sequência longa de `a`s sem nenhum `b`: o `+` externo pode
dividir 30 `a`s entre suas repetições de 2^29 formas, e cada uma delas precisa
ser tentada antes de o motor poder dizer "não". Trinta caracteres, um bilhão de
tentativas. Isso é ReDoS: uma negação de serviço em que o payload é uma string
curta e de aparência inofensiva.

O Ruby tem duas defesas, e vale a pena saber o que cada uma cobre.

**1. Correspondência em tempo linear por memoização (Ruby 3.2+).** O Ruby 3.2
adicionou um cache de match que lembra "nesta posição, neste estado, já
falhou", o que colapsa a busca exponencial para tempo linear na maioria dos
padrões. O exemplo clássico é genuinamente neutralizado em um Ruby moderno:

```ruby
# Ruby 3.4 (returns nil essentially instantly, at any length)
/(a+)+b/ =~ ("a" * 1_000_000)
```

**2. `Regexp.timeout=` (Ruby 3.2+).** A otimização tem furos: ela é pulada para
padrões que usam back-references ou chamadas de subexpressão (`\g<name>`), e
para entradas grandes o bastante que o próprio cache seria caro demais. Esses
padrões ainda voltam a fazer backtracking exponencial:

```ruby
# subexpression call (NOT memoized, still exponential on Ruby 3.4)
re = /\A(?<x>a|a)\g<x>*c/
re =~ ("a" * 22)   # ~0.1s
re =~ ("a" * 26)   # ~1.6s     (4 more characters, 16x the time)
re =~ ("a" * 40)   # minutes
```

Então o controle de reforço é um limite de tempo real. Defina-o globalmente,
uma vez, na inicialização; o padrão é `nil`, ou seja, sem limite, então isso é
opt-in:

```ruby
Regexp.timeout = 1.0            # seconds, applies process-wide

begin
  /\A(?<x>a|a)\g<x>*c/ =~ ("a" * 40)
rescue Regexp::TimeoutError => e
  # => "regexp match timeout"
  logger.warn("regex timeout: #{e.message}")
end
```

`Regexp::TimeoutError < RegexpError < StandardError`, então um `rescue =>`
simples em um request handler o captura e você retorna um 400 em vez de
prender um worker refém.

Um timeout por padrão sobrepõe o global, o que importa para aquele padrão
específico que você sabe ser caro, e para padrões que você não escreveu:

```ruby
# a search box that lets users type a regex
user_re = Regexp.new(params[:q], Regexp::IGNORECASE, timeout: 0.1)
user_re.timeout   # => 0.1
Regexp.timeout    # => unchanged
```

Passar `timeout: nil` explicitamente em um Regexp derivado de literal significa
"sem limite, ignore o global", o oposto do que você normalmente quer. E note
que o timeout não se aplica ao próprio `Regexp.new`, só ao matching.

A regra prática: defina um `Regexp.timeout` global em todo processo Ruby de
longa duração, mantenha-o generoso (0,5 a 2s) para que só dispare em casos
patológicos, e trate qualquer `Regexp::TimeoutError` nos logs como um relatório
de bug sobre um padrão, não como ruído. Se você aceita padrões vindos de
usuários, adicione por cima um timeout apertado por Regexp.

## Trade-offs

- **`%r{}` lê melhor, mas `/.../` é o que as pessoas esperam ver**: use `%r`
  quando o padrão contém barras (URLs, caminhos) e fique com `/.../` no resto;
  trocar de delimitador para um padrão sem nenhuma barra só adiciona mais uma
  coisa para interpretar.
- **`match?` é mais rápido e sem efeitos colaterais, mas não deixa nada para
  inspecionar**: se você se pega chamando `match?` e depois `match` na mesma
  string para pegar as capturas, você pagou por dois matches; chame `match` uma
  vez e verifique o resultado quanto a `nil`.
- **O truque de variáveis locais do `=~` é elegante e invisível**: as variáveis
  aparecem sem nenhuma atribuição visível, ele não faz nada silenciosamente se a
  regex estiver em uma variável, e só funciona em um sentido. Ótimo em um
  script, questionável em código que outras pessoas mantêm.
- **`/x` torna padrões longos revisáveis ao custo de novas regras de escape**:
  espaços e `#` deixam de ser literais, o que é uma nova forma de quebrar um
  padrão que funcionava. Vale a pena acima de umas duas linhas de padrão,
  raramente vale abaixo disso.
- **Strings de substituição são concisas; blocos de substituição são
  previsíveis**: a forma em string é boa para uma reescrita fixa tipo
  `'\1-\2'`, mas cada sequência de backslash é uma chance de dados serem
  interpretados como sintaxe. Qualquer coisa dinâmica pertence a um bloco.
- **A correspondência em tempo linear do Ruby elimina a maior parte do risco de
  ReDoS, mas não todo ele**: não cobre back-references nem chamadas de
  subexpressão `\g<>`, e custa memória proporcional ao tamanho do padrão vezes o
  tamanho da entrada, então se desliga em entradas muito grandes. Tratar "o
  Ruby 3.2 corrigiu o ReDoS" como algo completo é exatamente a suposição que
  deixa um buraco.
- **`Regexp.timeout` converte um travamento em uma exceção, o que é uma falha
  estritamente melhor, mas ainda é uma falha**: é uma rede de segurança, não uma
  correção. Também adiciona uma verificação de tempo a cada match, e um limite
  definido baixo demais vai disparar em uma entrada legitimamente grande sob
  carga, então escolha o valor pensando na sua carga real mais lenta.

## Documentation Links

- [Regexp, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Regexp.html) (doc)
- [MatchData, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/MatchData.html) (doc)
- [Regexp.timeout=, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Regexp.html#method-c-timeout-3D) (doc)
- [String#gsub and #sub, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/String.html#method-i-gsub) (doc)
- [Ruby 3.2.0 release notes, ReDoS mitigations](https://www.ruby-lang.org/en/news/2022/12/25/ruby-3-2-0-released/) (doc)
- [Programming Ruby 3.3 (Pickaxe), Regular Expressions](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
