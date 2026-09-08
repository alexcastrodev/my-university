---
version: 1.0
updatedAt: 2026-08-18
title: "Hash e Set: as Partes Não Óbvias"
summary: A armadilha do valor padrão de Hash.new que silenciosamente compartilha um único objeto entre todas as chaves, fetch/merge com bloco/slice/transform_* e Hash#to_proc, depois Set, unicidade ordenada por inserção, todo o vocabulário |, &, -, ^, um <=> que compara por subconjunto e retorna nil, e add?/delete? retornando nil em vez de false.
---
## Objective

`Hash` e `Set` são os dois containers que a maioria dos desenvolvedores Ruby
acha que já conhece, e ambos escondem comportamento que morde em produção.
`Hash` tem um mecanismo de valor padrão com duas formas que parecem
intercambiáveis e não são: uma compartilha um único objeto entre toda chave
faltante, a outra constrói um novo por chave. Também carrega um vocabulário
de filtragem e mesclagem (`fetch`, `merge` com um bloco de conflito,
`slice`/`except`, `transform_keys`/`transform_values`, `Hash#to_proc`) que
substitui muito `each_with_object` escrito à mão. `Set` fica entre Array e
Hash: elementos únicos, ordenados por inserção, com álgebra de conjuntos real
(`|`, `&`, `-`, `^`), um `<=>` que compara por **relação de subconjunto** em
vez de magnitude, e métodos `add?`/`delete?` que retornam `nil` em vez de
`false`.

## Use Cases

- Agrupar registros sob uma chave sem pré-preencher o container: o
  acumulador `Hash.new { |h, k| h[k] = [] }`, e saber por que a forma de um
  argumento o corrompe silenciosamente.
- Ler configuração ou parâmetros onde uma chave faltando é um bug, não um
  `nil`: `fetch` transforma o erro em um `KeyError` no ponto da busca em vez
  de um `NoMethodError` três frames depois.
- Mesclar configurações em camadas (padrões, arquivo, ambiente, flags de CLI)
  onde uma chave presente nos dois lados precisa de uma regra de resolução
  real, não de "o último que escreveu vence".
- Reformatar um payload antes de ele cruzar uma fronteira: transformar chaves
  em símbolos, coagir valores, descartar campos, sem escrever um `map` que
  reconstrói pares à mão.
- Deduplicar e comparar coleções de IDs: quais permissões o usuário ganhou e
  perdeu, quais tags dois posts compartilham, se o conjunto de escopos deste
  papel é um subconjunto dos permitidos.

## Deep Dive

### A armadilha do valor padrão do `Hash`

`Hash.new` recebe ou um **valor** padrão ou um **bloco** padrão, e a
diferença não é estilística.

```ruby
h = Hash.new([])          # one array object, created once

h[:a] << 1
h[:b] << 2

h[:a]        # => [1, 2]   <- both pushes landed in the same array
h[:b]        # => [1, 2]
h[:zzz]      # => [1, 2]   <- a key never touched sees them too
h.keys       # => []       <- and the hash is still empty!
```

Duas surpresas separadas em um trecho só. O padrão é um *único* objeto
compartilhado por toda chave faltante, então `<<` muta a coisa que todas
apontam. E `h[:a] << 1` nunca atribui nada; `[]` retorna o padrão, `<<` o
muta, e o próprio hash nunca é modificado, por isso `h.keys` está vazio.

A forma com bloco resolve os dois problemas, porque roda a cada falta e o
corpo faz a atribuição:

```ruby
h = Hash.new { |hash, key| hash[key] = [] }

h[:a] << 1
h[:b] << 2

h[:a]        # => [1]
h[:b]        # => [2]
h.keys       # => [:a, :b]
h[:c]        # => []      and :c now exists — merely reading created it
h.keys       # => [:a, :b, :c]
```

Regra prática: **um padrão mutável (`[]`, `{}`, `""`, uma Struct) sempre
precisa da forma com bloco.** Um padrão imutável (`0`, `false`, uma string
congelada, `nil`) é seguro como um valor simples, e esse é o uso legítimo de
`Hash.new(0)` para contadores:

```ruby
counts = Hash.new(0)
"mississippi".each_char { |c| counts[c] += 1 }
counts       # => {"m" => 1, "i" => 4, "s" => 4, "p" => 2}
```

`counts[c] += 1` se expande para `counts[c] = counts[c] + 1`, que é uma
atribuição real; inteiros são imutáveis, então não há nada para
compartilhar.

Note que o hash em forma de bloco cresce só de ser *lido*, o que importa
quando você o entrega para código que sonda por chaves. `Hash#dig` e `fetch`
não disparam a atribuição do bloco padrão da mesma forma (`fetch` ignora o
padrão completamente), então uma sondagem só de leitura deve usar
`fetch(key, [])` em vez de `[]`.

### `fetch`: fazendo uma chave faltante fazer barulho

`[]` retorna `nil` para uma chave desconhecida, que se propaga e falha em
outro lugar. `fetch` te dá três escolhas explícitas:

```ruby
config = { host: "localhost", port: 5432 }

config.fetch(:host)                  # => "localhost"
config.fetch(:user, "postgres")      # => "postgres"    (default argument)
config.fetch(:pool) { |key| ENV.fetch("DB_#{key.upcase}", 5) }  # block, gets the key
config.fetch(:password)              # => KeyError: key not found: :password
```

A forma nua `fetch(key)` é o ponto principal: sem padrão e sem bloco
significa um `KeyError` levantado exatamente na linha da busca ruim, com o
nome da chave na mensagem. A forma com bloco também é a preguiçosa: seu corpo
só roda numa falta, então `fetch(:conn) { expensive_default }` não paga pelo
padrão quando a chave está presente, diferente de `fetch(:conn,
expensive_default)`, que avalia o argumento de qualquer forma.

### Ordem de inserção é uma garantia, não um detalhe de implementação

Hashes do Ruby iteram na ordem de inserção, e isso é comportamento
especificado pela linguagem; você pode confiar nele em serialização, em
asserções de teste, em saída gerada.

```ruby
h = {}
h[:zebra] = 1
h[:apple] = 2
h[:mango] = 3

h.keys                # => [:zebra, :apple, :mango]
h.first               # => [:zebra, 1]
h.to_a                # => [[:zebra, 1], [:apple, 2], [:mango, 3]]

h[:zebra] = 99        # updating a value does NOT move the key
h.keys                # => [:zebra, :apple, :mango]

h.delete(:zebra)
h[:zebra] = 1         # deleting and re-adding DOES move it to the end
h.keys                # => [:apple, :mango, :zebra]
```

### `merge` com um bloco de conflito

O `merge` simples é "o último que escreve vence". Passe um bloco e você
decide, por chave em conflito, qual é o valor resultante; o bloco recebe
`|key, old_value, new_value|` e só dispara para chaves presentes nos **dois**
hashes.

```ruby
defaults = { retries: 3, timeout: 10, tags: %w[base] }
override = { timeout: 30, tags: %w[prod urgent] }

defaults.merge(override)
# => {retries: 3, timeout: 30, tags: ["prod", "urgent"]}

defaults.merge(override) { |key, old, new| key == :tags ? old | new : new }
# => {retries: 3, timeout: 30, tags: ["base", "prod", "urgent"]}
```

`merge!` (apelido `update`) faz o mesmo no lugar. `merge` também aceita
vários hashes de uma vez, aplicando o bloco da esquerda para a direita:

```ruby
{ a: 1 }.merge({ a: 2 }, { a: 3 }) { |_k, old, new| old + new }  # => {a: 6}
```

Esse one-liner de "somar em caso de conflito" é a forma idiomática de
combinar hashes de contadores.

### Filtrando por chave: `slice` e `except`

```ruby
params = { id: 7, name: "Ada", email: "ada@example.com", admin: true, _csrf: "x" }

params.slice(:name, :email)      # => {name: "Ada", email: "ada@example.com"}
params.except(:_csrf, :admin)    # => {id: 7, name: "Ada", email: "ada@example.com"}
params.slice(:name, :nonexistent) # => {name: "Ada"}  (missing keys are skipped)
```

Os dois retornam um novo hash e os dois recebem um splat de chaves, então
uma lista de permissão ou de bloqueio pode viver em uma constante:
`params.slice(*PUBLIC_FIELDS)`. `slice` nunca levanta exceção em chaves
desconhecidas, o que o torna seguro sobre entrada não confiável, mas também
significa que ele não vai te avisar quando sua lista de permissão tiver um
erro de digitação.

### `transform_keys` e `transform_values`

`map` sobre um Hash te obriga a lidar com as duas metades do par e retorna
um Array de pares que você depois precisa transformar com `to_h`. Quando só
um lado muda, diga isso:

```ruby
row = { "user_id" => "42", "created_at" => "2026-08-18", "active" => "true" }

row.transform_keys(&:to_sym)
# => {user_id: "42", created_at: "2026-08-18", active: "true"}

row.transform_values(&:strip)
# => same keys, whitespace-trimmed values

row.transform_keys(&:to_sym).transform_values { |v| v == "true" ? true : v }
# => {user_id: "42", created_at: "2026-08-18", active: true}
```

`transform_keys` também recebe um hash de renomeações explícitas, com o
bloco lidando com o que não estiver listado:

```ruby
row.transform_keys("user_id" => :id) { |k| k.to_sym }
# => {id: "42", created_at: "2026-08-18", active: "true"}
```

As versões com bang `transform_keys!` / `transform_values!` mutam no lugar.
Note a assimetria com `map`: essas retornam um **Hash**, não um Array, então
elas se encadeiam com o resto do vocabulário de Hash.

### `Hash#to_proc`: um hash como função de busca

`&` em um objeto chama `to_proc`. Todo mundo conhece a versão
`Symbol#to_proc` (`map(&:upcase)`); `Hash` também a implementa, produzindo um
proc que busca cada elemento como uma chave.

```ruby
ROLE_NAMES = { 0 => "guest", 1 => "member", 2 => "admin" }

[2, 0, 1, 1].map(&ROLE_NAMES)     # => ["admin", "guest", "member", "member"]
[2, 9].map(&ROLE_NAMES)           # => ["admin", nil]   (missing key -> nil)
```

É o mesmo mecanismo, não um caso especial: `ROLE_NAMES.to_proc.call(2)` é
`ROLE_NAMES[2]`. Como passa por `[]`, um padrão fornecido por `Hash.new` se
aplica, então `Hash.new("unknown")` te dá uma função total.

### `Set`: entre Array e Hash

`Set` armazena elementos únicos e, diferente de um conjunto matemático ou do
`HashSet` do Java, **itera na ordem de inserção**. É apoiado internamente em
um Hash, de onde vêm tanto a semântica de unicidade quanto a ordenação.

```ruby
require "set"   # needed on older rubies; autoloaded since 3.2, core class in 4.0

a = Set[3, 1, 2, 3, 1]
a.to_a                 # => [3, 1, 2]   (order of first insertion, not sorted)
a.size                 # => 3
a.include?(2)          # => true        (O(1), unlike Array#include?)

# Set.new accepts any enumerable
Set.new(1..5)          # => Set[1, 2, 3, 4, 5]
Set.new("hello".chars) # => Set["h", "e", "l", "o"]
Set.new([1, 2, 3]) { |n| n * 10 }  # => Set[10, 20, 30]  (optional block maps first)
```

> ⚠️ **Livro vs. hoje (Ruby 4.0):** `Set#inspect` mudou de `#<Set: {1, 2,
> 3}>` para o formato amigável a eval `Set[1, 2, 3]`, uma sintaxe literal que
> pode ser alimentada de volta direto em um `eval` para reconstruir o mesmo
> conjunto, igualando como `Array` e `Hash` já inspecionam. Uma subclasse do
> próprio `Set` mantém o formato antigo `#<MySet: {...}>` por compatibilidade
> retroativa; só subclasses do novo `Set::CoreSet` recebem o formato novo.
> Qualquer coisa que faça parsing da saída de `Set#inspect` em um teste ou
> log (raro, mas acontece) precisa ser atualizada nessa fronteira de versão.
> Separadamente, a gem `sorted_set` (`SortedSet`) foi removida da biblioteca
> padrão na 4.0; ela dependia da gem externa `rbtree` e tinha ficado para
> trás; adicione `sorted_set` explicitamente ao seu `Gemfile` se ainda
> precisar dela.

Associação usa `hash` e `eql?`, exatamente como chaves de Hash, então dois
objetos distintos mas `eql?` colapsam em uma única entrada.
`compare_by_identity` troca a regra para `object_id`, tornando distintos até
objetos que parecem iguais:

```ruby
s = Set.new(["ruby", "ruby".dup])
s.size                        # => 1   (eql? strings collapse)

t = Set.new.compare_by_identity
t << "ruby" << "ruby".dup
t.size                        # => 2   (different objects, different ids)
```

### Os operadores de conjunto

```ruby
a = Set[1, 2, 3, 4]
b = Set[3, 4, 5]

a | b     # => #<Set: {1, 2, 3, 4, 5}>   union        (also a.union(b), a + b)
a & b     # => #<Set: {3, 4}>            intersection (also a.intersection(b))
a - b     # => #<Set: {1, 2}>            difference   (also a.difference(b))
a ^ b     # => #<Set: {5, 1, 2}>         symmetric difference (XOR)
```

`^` é "em um ou em outro, mas não nos dois"; é exatamente `(a | b) - (a &
b)`, e é o operador que responde "o que mudou?" em um único passo:

```ruby
before = Set[:read, :write, :admin]
after  = Set[:read, :write, :billing]

after - before   # => #<Set: {:billing}>   gained
before - after   # => #<Set: {:admin}>     lost
before ^ after   # => #<Set: {:billing, :admin}>  everything that moved
```

Todos esses aceitam qualquer enumerable do lado direito, não só outro Set:
`a | [7, 8]` funciona.

### `<=>` compara por subconjunto, e pode retornar `nil`

Essa é a que surpreende quem vem de outras bibliotecas de coleções.
`Set#<=>` não compara tamanho nem conteúdo lexicamente; ele reporta a
**relação de subconjunto**, e retorna `nil` quando nenhum dos conjuntos
contém o outro.

```ruby
Set[1, 2]    <=> Set[1, 2, 3]   # => -1    proper subset
Set[1, 2, 3] <=> Set[1, 2]      # => 1     proper superset
Set[1, 2]    <=> Set[2, 1]      # => 0     equal (order irrelevant to equality)
Set[1, 2]    <=> Set[2, 3]      # => nil   overlapping, neither contains the other
Set[1, 2]    <=> Set[8, 9]      # => nil   disjoint — still nil, not -1
```

Note esse último par: `Set[1, 2]` e `Set[8, 9]` têm o mesmo tamanho e não
têm relação nenhuma, então não há resposta: `nil`. A consequência prática é
que `Set` **não** é significativamente `Comparable`: `sets.sort` levanta
`ArgumentError` no momento em que dois deles não têm relação, porque `sort`
não consegue lidar com uma comparação `nil`. Ordene por uma chave explícita
em vez disso (`sets.sort_by(&:size)`), e use os predicados nomeados quando
você quer um booleano:

```ruby
Set[1, 2].subset?(Set[1, 2, 3])         # => true
Set[1, 2].proper_subset?(Set[1, 2])     # => false
Set[1, 2].superset?(Set[1])             # => true
Set[1, 2].disjoint?(Set[8, 9])          # => true
Set[1, 2].intersect?(Set[2, 3])         # => true
```

### `add?` e `delete?` retornam `nil`, não `false`

A convenção do Ruby é que um método com `?` retorna um booleano.
`Set#add?` e `Set#delete?` quebram isso: eles retornam `self` quando o
conjunto mudou, e **`nil`** quando não mudou.

```ruby
s = Set[1, 2]

s.add(3)      # => #<Set: {1, 2, 3}>   always returns self
s.add(3)      # => #<Set: {1, 2, 3}>   no way to tell it was already there

s.add?(4)     # => #<Set: {1, 2, 3, 4}>   truthy: it was actually added
s.add?(4)     # => nil                    already present, nothing changed

s.delete?(4)  # => #<Set: {1, 2, 3}>      truthy: it was removed
s.delete?(99) # => nil                    wasn't there
```

Isso os torna a primitiva idiomática de "inserir se novo", uma guarda de
deduplicação que custa uma busca em vez de `include?` seguido de `add`:

```ruby
seen = Set.new
urls.each do |url|
  next unless seen.add?(url)   # skip duplicates in one operation
  crawl(url)
end
```

O retorno `nil` funciona bem para `if`/`unless`/`next unless`, já que `nil`
é falso. Ele quebra no momento em que você compara contra `false`
explicitamente:

```ruby
s.add?(4) == false    # => false  — WRONG, nothing was added but this says "false"
s.add?(4).nil?        # => true   — correct test for "no change"
!s.add?(4)            # => true   — correct, nil is falsy
```

Então `if set.add?(x) == false` é um bug que parece correto. Teste
truthiness, ou teste `nil?`.

### `classify` e `divide`

`classify` roda um bloco sobre cada elemento e retorna um **Hash de Sets**,
indexado pelo valor de retorno do bloco: um `group_by` para conjuntos, com
baldes tipados como conjunto:

```ruby
words = Set["apple", "avocado", "banana", "blueberry", "cherry"]

words.classify { |w| w[0] }
# => {"a" => #<Set: {"apple", "avocado"}>,
#     "b" => #<Set: {"banana", "blueberry"}>,
#     "c" => #<Set: {"cherry"}>}

words.classify(&:length)
# => {5 => #<Set: {"apple"}>, 7 => #<Set: {"avocado"}>, 6 => #<Set: {"banana", "cherry"}>, 9 => #<Set: {"blueberry"}>}
```

Como os baldes são Sets, você pode alimentá-los de volta direto nos
operadores: `by_letter["a"] & allowed`. Seu irmão `divide` recebe um bloco
de aridade um ou dois e retorna um conjunto de conjuntos, particionando por
uma relação de equivalência em vez de uma chave: `divide { |a, b| (a -
b).abs == 1 }` agrupa números consecutivos em sequências.

## Trade-offs

- **A forma conveniente `Hash.new(value)` é a errada para qualquer coisa
  mutável**: e ela falha silenciosamente, produzindo dados de aparência
  plausível onde toda chave compartilha estado. Não há aviso e não há erro;
  você percebe quando dois grupos não relacionados contêm os registros um do
  outro. Reserve a forma de valor para padrões imutáveis (`0`, `false`,
  strings congeladas) e use a forma com bloco em todo o resto.
- **A forma com bloco faz leituras mutarem o hash**: `h[:missing]` insere a
  chave. Isso costuma ser o que você quer em um acumulador e exatamente o
  que você não quer em código que sonda por chaves opcionais, já que o hash
  cresce a cada falta e `h.key?` começa a reportar chaves que ninguém
  definiu. Sonde com `fetch(key, default)` ou `dig`, que não atribuem.
- **`fetch` troca conveniência por um stack trace no lugar certo**: é mais
  digitação que `[]` e levanta exceção, então é errado para buscas
  genuinamente opcionais. O ganho é que um erro em chave obrigatória aparece
  como `KeyError: key not found: :password` na busca, em vez de `undefined
  method for nil` em qualquer código que tenha recebido o `nil`.
- **`slice`/`except`/`transform_*` todos alocam um novo hash**: são claros,
  mas uma cadeia de quatro deles sobre um hash grande faz quatro cópias. As
  versões com bang existem para `transform_keys!`/`transform_values!`; para
  o resto, uma única passagem de `each_with_object` é a válvula de escape
  quando o hash é grande o bastante para aparecer em um profile.
- **`Set` custa um objeto e uma busca de hash para comprar associação
  O(1)**: para um punhado de elementos, `Array#include?` em 5 itens vence
  construir um Set, e o Array é mais barato de alocar. Set vence quando a
  associação é testada repetidamente ou a coleção é grande; converter um
  Array em Set para um único `include?` é uma perda líquida (veja o conceito
  de Memória, GC e Fragmentação sobre custo de alocação).
- **`Set` é ordenado por inserção, mas essa ordem não faz parte da igualdade
  de conjuntos**: `Set[1, 2] == Set[2, 1]` é `true` enquanto `[1, 2] == [2,
  1]` é `false`. Útil para comparação, enganoso se você estava contando com a
  ordem como um sinal semântico; se ordem carrega significado, você queria um
  Array (ou um Array mais um Set usado só como índice de associação).
- **`Set#<=>` retornando `nil` torna `sort`, `min`, `max` e encadeamento
  estilo `Comparable` inseguros em conjuntos**: eles levantam `ArgumentError`
  no primeiro par sem relação, e se levantam ou não depende dos dados, então
  pode passar em testes e falhar em produção. Ordene conjuntos por uma chave
  explícita com `sort_by`, e expresse intenção com
  `subset?`/`superset?`/`disjoint?` em vez do operador.
- **`add?`/`delete?` retornando `nil` em vez de `false` viola a convenção do
  `?`**: a vantagem é um idioma de "inserir se ausente" em uma única
  operação; a desvantagem é que qualquer checagem explícita de `== false` ou
  `is_a?(FalseClass)` contra eles está errada. Use-os em posição booleana
  (`next unless seen.add?(x)`) e nunca compare o resultado deles a um
  literal.

## Documentation Links

- [Hash, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Hash.html) (doc)
- [Set, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Set.html) (doc)
- [Programming Ruby 3.3 (Pickaxe), Enumerators and Containers](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
- [Ruby 4.0.0 Released, ruby-lang.org](https://www.ruby-lang.org/en/news/2025/12/25/ruby-4-0-0-released/) (doc)
