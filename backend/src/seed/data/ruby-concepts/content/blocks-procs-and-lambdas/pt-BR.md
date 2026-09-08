---
version: 1.0
updatedAt: 2026-08-17
title: "Blocks, Procs e Lambdas"
summary: As closures que tornam o Enumerable do Ruby idiomático, e a diferença de aridade e semântica de return entre proc e lambda que confunde a maioria dos iniciantes.
---
## Objective

Blocks são o recurso mais usado do Ruby e o de nome menos óbvio: `{ ... }` ou
`do...end` anexado a uma chamada de método é uma closure (ela captura as
variáveis locais ao redor), e `yield` dentro de um método invoca qualquer bloco
que tenha sido passado. `Proc` e `Lambda` são as duas formas de transformar
esse bloco em um objeto de primeira classe que você pode guardar e passar
adiante, e elas diferem exatamente em duas coisas que importam: quão rígidas
são quanto ao número de argumentos, e o que `return` faz dentro delas.

## Use Cases

- Escrever seus próprios métodos que aceitam um bloco (iteradores próprios,
  wrappers de recurso com limpeza automática, métodos de configuração estilo
  DSL).
- Escolher corretamente entre `proc`/`->(x)` e `lambda`/`->(x)`; na maior parte
  do tempo você quer a semântica de lambda (aridade estrita, `return` local),
  então `->(x) { }` é o padrão idiomático no Ruby moderno.
- Converter um método ou símbolo em um bloco com `&` (`arr.map(&:upcase)`,
  `arr.map(&method(:process))`) em vez de escrever um bloco equivalente à mão.
- Usar `Enumerator::Lazy` para compor `map`/`select` sobre uma sequência que
  pode ser infinita, sem materializá-la.

## Deep Dive

### Blocks são closures

```ruby
def with_total
  total = 0
  yield ->(n) { total += n }
  total
end

with_total { |add| add.(3); add.(4) }   # => 7
```

O bloco captura `total` diretamente do escopo ao redor; não é copiado, é a
mesma variável. É isso que faz idiomas como um acumulador contínuo, um cache
memoizado, ou uma closure de contador funcionarem sem precisar de nenhum
objeto para guardar o estado.

### Proc vs Lambda: aridade e `return`

```ruby
add_proc   = proc   { |a, b| (a || 0) + (b || 0) }
add_lambda = lambda { |a, b| a + b }
# or, the idiomatic form:
add_lambda = ->(a, b) { a + b }

add_proc.call(1)          # => 1  (missing arg silently becomes nil)
add_lambda.call(1)        # ArgumentError: wrong number of arguments (given 1, expected 2)
```

```ruby
def proc_return
  p = proc { return 10 }   # returns from proc_return itself
  p.call
  20                        # never reached
end

def lambda_return
  l = -> { return 10 }      # returns only from the lambda
  l.call
  20                        # this IS reached
end

proc_return    # => 10
lambda_return  # => 20
```

Um `return` dentro de um `proc` retorna do **método que o envolve**, o que
levanta `LocalJumpError` se esse proc sobreviver ao método em que foi criado e
for chamado depois. Um `return` dentro de uma `lambda` retorna só da própria
lambda, se comportando como uma chamada de método normal. Esse é o motivo mais
comum de bugs do tipo "por que meu proc explodiu", e é a principal razão de
`->(x) { }` (lambda) ser o padrão mais seguro em vez de `proc { |x| }`, a menos
que você especificamente queira o comportamento mais solto e não estrito do
proc.

### `Symbol#to_proc` e referências de método como blocks

```ruby
%w[a b c].map(&:upcase)              # equivalent to .map { |s| s.upcase }
%w[1 2 3].map(&method(:Integer))     # any object with #to_proc works with &
```

`&` converte o que vier depois dele em um bloco usando `to_proc`;
`Symbol#to_proc` transforma `:upcase` em `->(x) { x.upcase }`, e `Method#to_proc`
faz o mesmo para uma referência de método já existente, o que muitas vezes é
mais legível do que um bloco inline para uma transformação de um argumento que
já tem nome.

### `.lazy` para sequências que não cabem na memória

```ruby
(1..Float::INFINITY).lazy
  .select(&:even?)
  .map { |n| n * n }
  .first(3)   # => [4, 16, 36]
```

Sem `.lazy`, um `select` sobre um range infinito nunca retornaria; ele tenta
construir todo o array filtrado antes mesmo de o `map` começar. `.lazy`
encadeia cada etapa como uma transformação pendente e só puxa valores pelo pipe
quando algo (`.first(n)`, `.take(n)`, etc.) realmente os solicita.

## Trade-offs

- **A checagem de aridade solta do Proc é ocasionalmente útil (handlers de
  evento com payload de tamanho variável), mas é uma armadilha em todo o resto**:
  prefira a sintaxe de lambda (`->(x) { }`) a menos que você deliberadamente
  queira o comportamento do proc de "preencher argumentos faltando com nil".
- **Um parâmetro de bloco com o mesmo nome de uma variável local externa
  sombreia essa variável dentro do bloco, mas um bloco *sem* esse parâmetro lê e
  altera a variável externa**: esse é exatamente o mecanismo que torna as
  closures úteis e também exatamente o mecanismo que causa captura acidental de
  variável em loops que disparam threads ou procs (veja o conceito de GVL e
  Concorrência para a versão com threads desse bug).
- **`return` dentro de um proc armazenado além do ciclo de vida do método que o
  definiu levanta exceção no momento da chamada, não no momento da definição**:
  o bug só aparece quando o proc é de fato invocado, o que pode estar longe de
  onde ele foi escrito:
  ```ruby
  def make_proc
    proc { return 1 }
  end
  make_proc.call   # LocalJumpError: unexpected return
  ```

## Documentation Links

- [Proc, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Proc.html) (doc)
- [Enumerable, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Enumerable.html) (doc)
- [Symbol#to_proc, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Symbol.html#method-i-to_proc) (doc)
