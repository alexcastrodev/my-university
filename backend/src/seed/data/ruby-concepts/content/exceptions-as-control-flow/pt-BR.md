---
version: 1.0
updatedAt: 2026-08-17
title: "Exceções como Controle de Fluxo: o que Elas Realmente Custam"
summary: A hierarquia de exceções, ensure/retry, e por que catch/throw é a ferramenta mais barata para sair de código aninhado que não é um erro.
---
## Objective

Exceções em Ruby são caras, mensuravelmente, não só como questão de estilo.
Usar `begin/rescue` para controle de fluxo normal e esperado (em vez de
tratamento de erro genuíno) tem um custo real de performance, e o Ruby
oferece um mecanismo mais barato, `catch`/`throw`, para o caso específico de
"pular para fora de código aninhado" que não precisa de um stack trace.
Conhecer a hierarquia real, saber quando `ensure` e `retry` se aplicam, e
saber qual idioma usar é a diferença entre exceções usadas corretamente e
exceções usadas como muleta de controle de fluxo.

## Use Cases

- Escolher `find_by`/`where` em vez de `find` (que levanta exceção) em
  caminhos de código onde "não encontrado" é um resultado esperado e comum,
  não um erro.
- Escrever uma hierarquia de exceções personalizada que deixa os chamadores
  fazerem `rescue` de forma ampla (a classe base de erro de uma biblioteca)
  ou estreita (uma falha específica) conforme necessário.
- Usar `catch`/`throw` para sair de loops profundamente aninhados ou de uma
  busca recursiva sem pagar o custo (ou a incompatibilidade semântica) de
  levantar uma exceção para um evento de "achei" que não é um erro.
- Escrever um loop de `retry` para uma chamada de rede instável, com um
  número limitado de tentativas e um backoff real para que não gire para
  sempre.

## Deep Dive

### A hierarquia de exceções, e por que `rescue` é seguro por padrão

```ruby
begin
  1 / 0
rescue => e        # implicitly rescues StandardError, NOT Exception
  puts e.class      # ZeroDivisionError
end
```

`Exception` é a raiz verdadeira, mas `rescue` sem classe explícita só captura
`StandardError` e seus descendentes; condições genuinamente fatais como
`NoMemoryError` ou `SystemExit` vivem fora de `StandardError` justamente para
que uma cláusula `rescue` ampla nunca as engula por acidente. Erros
personalizados de aplicação devem herdar de `StandardError`, e por convenção
o nome termina em `Error`.

### `ensure`, `else` e `retry`

```ruby
attempts = 0
begin
  attempts += 1
  risky_network_call
rescue Net::TimeoutError
  raise if attempts >= 3
  sleep(2 ** attempts)
  retry
ensure
  connection.close
end
```

`ensure` sempre roda (com exceção ou não, mesmo se a exceção não for
capturada), o que o torna o lugar certo para limpeza garantida. `retry`
reexecuta o bloco `begin` inteiro desde o início; sem um contador de
tentativas limitado como `attempts` acima, é um risco real de loop infinito.
`else` (não mostrado) roda só quando nada foi levantado; usado raramente, mas
existe por simetria com `ensure`.

### `catch`/`throw`: pulando para fora sem uma exceção

```ruby
result = catch(:found) do
  matrix.each do |row|
    row.each do |cell|
      throw(:found, cell) if cell == target
    end
  end
  nil
end
```

`catch`/`throw` é um mecanismo distinto de exceções, feito para controle de
fluxo normal que precisa pular para fora de estruturas aninhadas, não
tratamento de erro. `throw` não precisa estar lexicamente dentro do bloco
`catch`, só em algum lugar da pilha de chamadas abaixo dele em tempo de
execução. É mensuravelmente mais barato do que levantar uma exceção para o
mesmo evento de "pare de procurar, eu achei", justamente porque não constrói
um backtrace.

### Exceções personalizadas que carregam dados

```ruby
class PaymentDeclinedError < StandardError
  attr_reader :retryable

  def initialize(message, retryable: false)
    super(message)
    @retryable = retryable
  end
end

begin
  charge_card
rescue PaymentDeclinedError => e
  retry_charge if e.retryable
end
```

Uma exceção personalizada é uma classe normal; ela pode carregar dados
estruturados (como `retryable` aqui) que o ponto de `rescue` usa para
decidir o que fazer em seguida, o que é mais útil do que extrair informação
de volta de uma string de mensagem.

## Trade-offs

- **`begin/rescue` usado para resultados esperados e comuns é
  mensuravelmente mais lento que uma checagem `if`/`else` equivalente**: o
  multiplicador exato varia por implementação e versão do Ruby, mas a
  direção é consistente o bastante para que "esse caminho representa um erro
  de fato, ou um resultado esperado?" deva decidir se vale a pena usar uma
  exceção. `find_by` (retorna `nil`) em vez de `find` (levanta exceção) em um
  caminho de busca normal é o exemplo padrão.
- **Bibliotecas de terceiros que levantam exceção para condições comuns (um
  cliente HTTP levantando em um 404, por exemplo) impõem esse custo ao seu
  código mesmo que você não tenha escolhido isso**: vale a pena checar se uma
  biblioteca expõe uma alternativa que não levanta exceção antes de contornar
  isso.
- **`retry` sem um contador limitado é um risco real de loop infinito**, não
  apenas um capricho de estilo: uma cláusula rescue que chama `retry`
  incondicionalmente em uma condição persistentemente falha (credenciais
  ruins, uma dependência permanentemente fora do ar) nunca termina.

## Documentation Links

- [Exception handling, Ruby Core syntax docs](https://docs.ruby-lang.org/en/3.3/syntax/exceptions_rdoc.html) (doc)
- [Kernel#catch, #throw, Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Kernel.html#method-i-catch) (doc)
- [The Complete Guide to Rails Performance, Exceptions as Flow Control](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
