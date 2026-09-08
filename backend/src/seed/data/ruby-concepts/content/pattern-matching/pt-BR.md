---
version: 1.0
updatedAt: 2026-08-17
title: "Pattern Matching em Ruby"
summary: Desestruturando arrays, hashes e objetos customizados com case/in, correspondência estrutural, binding, guardas e o operador pin.
---
## Objective

Pattern matching (`case/in`, `in` isolado, e a atribuição da direita para a
esquerda `=>`) permite desestruturar arrays, hashes e objetos customizados
enquanto verifica seu formato em uma única expressão, em vez de uma cadeia de
chamadas `is_a?`/`[]`/`dig`. Ele reutiliza a mesma semântica de `===` do
`case/when` para correspondências escalares, mas adiciona correspondência
estrutural, binding de variáveis e cláusulas de guarda por cima; é o único
recurso de controle de fluxo genuinamente novo que o Ruby adicionou em
versões recentes, e aparece cada vez mais em bases de código reais que lidam
com dados no formato JSON (respostas de API, configuração).

## Use Cases

- Desestruturar uma resposta de API ou um hash JSON parseado em variáveis
  locais em uma única linha, com uma checagem embutida de que as chaves
  obrigatórias estão presentes.
- Lidar com uma família de objetos de resultado (`Success`/`Failure`, uma
  união marcada) com `case/in` em vez de uma cadeia de checagens `is_a?`.
- Validar o formato da entrada e extrair valores ao mesmo tempo; uma única
  expressão `in` substitui os passos separados de "isso tem o formato certo"
  e "agora extraia os campos".
- Buscar um elemento em uma posição específica dentro de um array sem um
  índice/loop manual, usando um padrão de busca (find pattern).

## Deep Dive

### Padrões de array e hash

```ruby
config = { host: "db.internal", port: 5432, ssl: true }

case config
in { host:, port:, ssl: true }
  puts "Connecting to #{host}:#{port} over SSL"
in { host:, port: }
  puts "Connecting to #{host}:#{port} without SSL"
end
# => "Connecting to db.internal:5432 over SSL"
```

Padrões de hash só exigem as chaves que mencionam; chaves extras no alvo não
quebram a correspondência. `{host:, port:, ssl: true}` ao mesmo tempo
vincula `host`/`port` como variáveis locais (forma curta de `{host: host,
port: port}`) e exige que `ssl` seja literalmente igual a `true`. Para exigir
um formato de hash *exato*, sem chaves extras, adicione `**nil` ao padrão.

```ruby
case [1, 2, 3]
in [Integer, Integer, Integer] => all_ints
  puts "three ints: #{all_ints}"
end
# => "three ints: [1, 2, 3]"
```

Padrões de array casam elemento por elemento e podem checar tipos via `===`
(`Integer` casa com qualquer Integer). `=> all_ints` vincula o valor
correspondido inteiro a uma variável; a mesma sintaxe de binding `=>`
funciona em qualquer nível de aninhamento.

### Padrões de busca: procurando dentro de um array

```ruby
log_line = ["INFO", "2026-08-17", "user_id=42", "checkout", "completed"]

case log_line
in [*, /user_id=(\d+)/ => match, *]
  puts "Found a user_id field: #{match}"
end
```

O `*` dos dois lados de um elemento de padrão significa "procure em qualquer
lugar do array por isso", em vez de exigir a correspondência em uma posição
fixa; útil para puxar um campo conhecido de um array com estrutura solta sem
saber seu índice exato.

### Cláusulas de guarda e o operador pin

```ruby
def classify(pair)
  case pair
  in [a, b] if a == b
    "equal"
  in [a, b] if a > b
    "descending"
  else
    "ascending"
  end
end
```

```ruby
expected = 5
case [5, "five"]
in [^expected, label]
  puts "Matched the expected value, label is #{label}"
end
```

`if`/`unless` depois de um padrão adiciona uma condição booleana que pode
referenciar variáveis que o padrão acabou de vincular. O operador pin `^`
faz o oposto de vincular: `^expected` compara contra o **valor atual** de
`expected` em vez de criar uma nova variável local, e é assim que você
compara contra algo já conhecido em vez de capturar o que quer que esteja
ali.

### Objetos customizados: `deconstruct` e `deconstruct_keys`

```ruby
Point = Struct.new(:x, :y)

case Point.new(0, 5)
in { x: 0, y: }
  puts "On the y-axis at #{y}"
end
```

`Struct` (e `Data`) implementam `deconstruct`/`deconstruct_keys`
automaticamente, e é por isso que funcionam diretamente em padrões. Qualquer
classe pode aderir definindo esses métodos ela mesma: `deconstruct` retorna
um Array para padrões de array, `deconstruct_keys(keys)` retorna um Hash
para padrões de hash (o argumento `keys` é o subconjunto de chaves que o
padrão de fato pediu, útil como uma dica de otimização).

## Trade-offs

- **`in` (isolado ou em `case/in`) retorna `false` silenciosamente quando
  não há correspondência; a forma isolada da direita para a esquerda `value
  => pattern` levanta `NoMatchingPatternError` em vez disso**: escolher a
  errada ou esconde um bug atrás de um valor falso, ou trava onde uma
  checagem graciosa era pretendida.
  ```ruby
  "text" in Integer   # => false, no error
  "text" => Integer   # NoMatchingPatternError
  ```
- **Bindings de variável dentro de um padrão que correspondeu parcialmente
  antes de falhar são explicitamente comportamento indefinido**: não conte
  com nenhuma variável que um branch `in`/`case in` que falhou possa ter
  começado a vincular.
- **Você não pode vincular uma variável dentro de um padrão de alternação
  `|`** (`[Integer, Integer] | [String, String] => pair` vincula `pair` à
  correspondência inteira, mas você não pode vincular pedaços *dentro* de
  cada alternativa); padrões que precisam desse nível de binding por branch
  têm que ser divididos em cláusulas `in` separadas em vez de combinados com
  `|`.

## Documentation Links

- [Pattern matching, Ruby Core syntax docs](https://docs.ruby-lang.org/en/3.3/syntax/pattern_matching_rdoc.html) (doc)
- [Object#deconstruct, #deconstruct_keys, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Object.html) (doc)
