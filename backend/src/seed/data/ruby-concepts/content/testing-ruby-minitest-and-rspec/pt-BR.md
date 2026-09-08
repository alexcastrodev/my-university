---
version: 1.0
updatedAt: 2026-08-21
title: "Testando Ruby: Minitest, RSpec e Test Doubles"
summary: O Minitest vem na biblioteca padrão e o próprio Rails é testado com ele internamente, mas a maioria das aplicações Rails no mundo real usa RSpec; conhecer os dois, mais a diferença entre um double simples e um verificado, é conhecimento básico para ler a suíte de outra pessoa.
---
## Objective

O Ruby traz um framework de teste de verdade na biblioteca padrão, o
Minitest, e o ecossistema ainda majoritariamente recorre a um segundo, o
RSpec, que não está na biblioteca padrão de forma nenhuma. Isso não é
indecisão: os dois codificam apostas diferentes sobre como uma suíte de
testes deveria ler, e as duas apostas aparecem constantemente em bases de
código de produção (o próprio Rails é testado com Minitest internamente,
enquanto a maioria das *aplicações* Rails no mundo real são testadas com
RSpec). Conhecer só `assert_equal` ou só `expect(x).to eq(y)` significa que
metade das bases de código Ruby que você vai abrir são desconhecidas no
primeiro dia. A outra metade deste conceito (doubles, doubles verificados, e
exemplos compartilhados) é onde suítes de teste de aparência experiente
silenciosamente dão errado: um `double` que mente sobre uma API, um `let`
que esconde uma dependência entre exemplos, ou um equivalente de flag estilo
`changed` que falha silenciosamente.

## Use Cases

- Ler e estender uma suíte de testes Rails ou de gem já existente, qualquer
  que seja o framework escolhido; reconhecer `assert_*` vs `expect(...).to`
  instantaneamente em vez de rederivar a DSL a partir do contexto.
- Escolher um framework para uma gem nova: Minitest para algo pequeno, sem
  dependências, e rápido de inicializar; RSpec quando o time já pensa em
  vocabulário BDD e quer composição de matchers e exemplos compartilhados.
- Substituir um fake feito à mão ou uma chamada de rede real por um test
  double que de fato verifica que a chamada aconteceu
  (`expect(...).to receive`) em vez de um double que aceita silenciosamente
  qualquer nome de método.
- Pegar um bug de desvio de API no momento do teste: `instance_double`
  fazendo a suíte falhar no momento em que o método de um colaborador é
  renomeado, em vez de às três da manhã em produção.
- Diagnosticar "esse teste só falha quando roda depois daquele outro teste"
  reconhecendo acoplamento de ordem de teste introduzido por memoização de
  `let` ou estado mutável compartilhado, e usando ordem de execução
  randomizada (`--seed`) para forçar isso a aparecer.

## Deep Dive

### Minitest: asserções, não frases

Minitest é o framework com o qual o próprio Ruby, e o Rails internamente,
são testados. Um teste é um método cujo nome começa com `test_`, em uma
classe que herda de `Minitest::Test`:

```ruby
require "minitest/autorun"

class InvoiceTest < Minitest::Test
  def setup
    @invoice = Invoice.new("A-1", 12_50)
  end

  def test_total_converts_cents_to_a_float
    assert_equal(12.5, @invoice.total)
  end

  def test_raises_on_negative_cents
    assert_raises(ArgumentError) { Invoice.new("A-2", -1) }
  end

  def teardown
    @invoice = nil
  end
end
```

`require "minitest/autorun"` faz dois trabalhos ao mesmo tempo: carrega o
framework *e* registra um hook `at_exit` que roda todo teste descoberto; não
existe um script executor separado para escrever. `setup`/`teardown` rodam
antes/depois de **todo** método de teste na classe, não uma vez por classe,
então `@invoice` acima é um objeto novo por teste; nenhum vazamento entre
exemplos por construção.

Toda asserção positiva tem uma gêmea negativa: `assert_equal`/
`refute_equal`, `assert_empty`/`refute_empty`, `assert_nil`/`refute_nil`. O
último argumento de qualquer asserção é uma mensagem de falha customizada
opcional, que importa quando uma suíte tem centenas de chamadas
`assert_equal` e uma falha precisa dizer *qual* delas:

```ruby
assert_equal(expected, actual, "invoice total should already be rounded")
```

Rodar `ruby -Ilib test/invoice_test.rb -n test_raises_on_negative_cents`
roda um teste pelo nome exato; `-n /negative/` roda todo teste cujo nome
casa com a regex, a forma do dia a dia de iterar em uma área falhando sem
rodar a suíte inteira. `-Ilib` coloca `lib/` no load path para que `require
"invoice"` resolva sem um gambiarra de caminho relativo.

O Minitest também traz **mocks**, deliberadamente mínimos:

```ruby
mailer = Minitest::Mock.new
mailer.expect(:deliver, true, [Invoice])

InvoiceSender.new(mailer).send_receipt(invoice)

mailer.verify   # raises if :deliver was never called with a matching arg
```

`expect(method, return_value, expected_args)` registra o que precisa
acontecer; `verify` é onde a asserção de fato dispara; esqueça de chamá-lo e
um mock que nunca foi invocado passa silenciosamente. `stub` é a irmã mais
leve e não verificada: ela remenda um método pela duração de um bloco e não
se importa se foi chamado:

```ruby
Time.stub(:now, Time.new(2026, 1, 1)) do
  assert_equal("2026-01-01", Report.new.generated_on)
end
```

Use `stub` para "me dê um valor enlatado para o teste ser determinístico";
use `Mock`/`expect`/`verify` para "afirme que essa interação de fato
aconteceu."

### RSpec: uma DSL para hipóteses, não um executor de asserções

RSpec é uma gem separada, e não se parece nada com Minitest na superfície:
`describe`/`it`/`expect` em vez de uma classe com métodos `test_`:

```ruby
RSpec.describe Invoice do
  subject(:invoice) { described_class.new("A-1", 12_50) }

  it "converts cents to a float total" do
    expect(invoice.total).to eq(12.5)
  end

  it "raises on negative cents" do
    expect { described_class.new("A-2", -1) }.to raise_error(ArgumentError)
  end
end
```

A sintaxe fluente não é mágica especial de parser; é Ruby comum.
`expect(x).to eq(y)` é `self.expect(x).to(self.eq(y))` por baixo dos panos:
`expect` retorna um objeto wrapper, `eq` constrói um objeto matcher, e `to`
chama `matches?` nele e levanta exceção em caso de falha. Blocos
`describe`/`it` rodam via `instance_eval`, o mesmo mecanismo que o conceito
`instance-eval-and-dsls` desta plataforma cobre para construir DSLs
internas; o RSpec *é* aquele padrão, em escala.

`let(:name) { block }` é o idioma do RSpec que substitui uma variável de
instância definida em `before`:

```ruby
RSpec.describe ShoppingCart do
  let(:cart)  { ShoppingCart.new }
  let(:apple) { Item.new("apple", 150) }

  it "sums item prices" do
    cart.add(apple)
    expect(cart.total).to eq(150)
  end
end
```

`let` é **preguiçoso** (o bloco só roda na primeira vez que `apple` é
referenciado dentro de um exemplo, não para todo exemplo que não o usa) e
**memoizado por exemplo** (chamar `apple` duas vezes no mesmo `it` retorna
o mesmo objeto; o próximo `it` recebe um novo). Essa combinação é o apelo
inteiro sobre `@apple = Item.new(...)` em um bloco `before`: fixtures caras
que não são necessárias em todo exemplo do arquivo não são construídas de
graça. Também é a armadilha clássica: `let` cria um *método*, então um erro
de digitação no nome (`aple` em vez de `apple`) é um `NoMethodError`, não um
`nil` silencioso como seria com uma variável de instância mal digitada;
geralmente uma vantagem, ocasionalmente uma falha confusa em um arquivo de
spec compartilhado enorme.

`before(:example)` (o padrão) é o `setup` do RSpec; `before(:context)` roda
uma vez para o bloco `describe` inteiro em vez de uma vez por exemplo,
útil para fixtures genuinamente caras e só leitura, perigoso para qualquer
coisa que um teste mute, já que mutações então vazam entre exemplos que
assumiam isolamento.

### Matchers, incluindo os que leem os métodos do seu objeto

A biblioteca de matchers do RSpec vai muito além de `eq`:

```ruby
expect(cart).to be_empty
expect(price).to be_between(0, 1000)
expect(price).to be > 0
expect(list).to contain_exactly(1, 2, 3)      # same elements, any order
expect(list).to include(2)
expect(name).to start_with("A")
expect(record).to have_attributes(id: 1, active: true)
expect { cart.add(nil) }.to raise_error(ArgumentError)
expect { cart.add(apple) }.to change { cart.total }.from(0).to(150)
```

`be_*` e `have_*` não são uma lista fixa; o RSpec parseia o nome do matcher
no momento da chamada e o transforma em uma chamada de método predicado no
objeto: `expect(book).to be_a_paperback` chama `book.paperback?`;
`expect(book).to have_cover` chama `book.has_cover?`. Nada precisa ser
declarado para isso funcionar; é despacho dinâmico no nome do matcher, a
mesma família de truque de DSLs baseadas em `method_missing`. Também
significa que uma falha de matcher tipo `expected #<Book> to be a
paperback` está de fato reportando que `paperback?` retornou falso; vale a
pena lembrar quando o nome do matcher em uma falha não mapeia obviamente
para um método na classe que você está olhando.

### Test doubles: a diferença entre um double e uma mentira

`double` cria um objeto nu que não responde a nada até você dizer a ele:

```ruby
mailer = double("mailer")
allow(mailer).to receive(:deliver).and_return(true)
```

`allow(...).to receive` é um **stub**: não faz o exemplo falhar se
`:deliver` nunca for chamado. `expect(...).to receive` é uma **expectativa
de mock**: o exemplo falha se `:deliver` *não* for chamado até o fim do
exemplo. Essa é a mesma distinção stub-vs-mock que o Minitest traça entre
`stub` e `Mock#expect` + `verify`; o RSpec só dobra a verificação no
matcher em vez de uma chamada `verify` separada.

A armadilha com um `double` nu é que ele vai responder alegremente a um
método que o objeto real não tem, ou com uma aridade que o método real não
aceita; a suíte de testes fica verde contra uma API que não existe mais.
**Doubles verificados** fecham esse buraco:

```ruby
mailer = instance_double(Mailer, deliver: true)
allow(Mailer).to receive(:new).and_return(mailer)
```

`instance_double(Mailer, ...)` checa, no momento em que o double é definido
e no momento em que cada método stubado é chamado, que `Mailer` de fato
define um método de instância com aquele nome e uma assinatura compatível.
Renomeie `Mailer#deliver` para `Mailer#send_email` no código de produção e
todo double verificado chamando `:deliver` falha imediatamente; um `double`
nu continuaria passando. O custo é real: `Mailer` precisa estar carregado
(autoloadable, em uma aplicação Rails) para a verificação rodar, o que é
ocasionalmente incômodo em um teste unitário genuinamente isolado, mas a
segurança quase sempre vale a pena em uma base de código acima do tamanho
de brinquedo.

### Exemplos compartilhados: DRY entre várias implementações

Quando várias classes devem satisfazer o mesmo contrato (vários adaptadores,
vários objetos estilo `Comparable`), repetir os mesmos blocos `it` por
classe é o tipo de duplicação que `shared_examples` existe para remover:

```ruby
RSpec.shared_examples "a storage backend" do
  it "round-trips a value" do
    subject.write("k", "v")
    expect(subject.read("k")).to eq("v")
  end

  it "returns nil for a missing key" do
    expect(subject.read("missing")).to be_nil
  end
end

RSpec.describe RedisBackend do
  subject { described_class.new(fake_redis) }
  it_behaves_like "a storage backend"
end

RSpec.describe FileBackend do
  subject { described_class.new(tmp_dir) }
  it_behaves_like "a storage backend"
end
```

O contrato é escrito uma vez; todo backend que afirma implementá-lo é
rodado contra as mesmas asserções. O trade-off é a facilidade de
descoberta: uma falha reporta contra o arquivo e linha do exemplo
compartilhado, um passo removido do bloco `describe` que de fato falhou, o
que custa um pouco de tempo na primeira vez que alguém não familiarizado
com a suíte precisa rastreá-la.

### Dependência de ordem: o bug que a ordem de execução randomizada existe para achar

O RSpec (e, via um plugin, o Minitest) consegue rodar exemplos em ordem
aleatória por execução, semeada por `--seed N`. Isso existe porque `let`,
fixtures `before(:context)` compartilhadas, e estado global/de classe
simples tornam fácil escrever um teste que só passa porque um teste
anterior por acaso rodou primeiro e deixou algo configurado. Uma suíte que
está verde em ordem alfabética/de definição e vermelha sob `--seed random`
tem um bug real de isolamento, não um teste instável; a seed reportada na
falha permite reproduzir a ordem exata que a quebrou.

## Trade-offs

- **A legibilidade do RSpec é comprada com indireção**: `expect(x).to
  raise_error` é mais natural de ler em voz alta que `assert_raises`, mas o
  backtrace de uma falha passa por várias camadas de maquinário de matcher
  antes de chegar ao seu código, e o despacho dinâmico de `be_*`/`have_*`
  significa que o nome do matcher em uma mensagem de falha nem sempre casa
  literalmente com um nome de método na sua classe. As asserções do Minitest
  ficam a uma chamada de método de distância da checagem real.
- **O Minitest inicializa mais rápido e não depende de nada**: nenhuma gem
  para adicionar, nenhuma DSL para aprender além de `assert_*`, o que
  importa para a suíte de testes de uma gem pequena ou um pipeline de CI
  sensível a tempo de boot. O vocabulário mais rico de matcher/double/exemplo
  compartilhado do RSpec se paga principalmente na escala de "muitos
  contribuidores, muitos arquivos, contratos compartilhados entre várias
  classes".
- **A preguiça do `let` também é sua armadilha**: memoização por exemplo
  evita configuração redundante, mas uma cadeia de `let`s se referenciando
  pode esconder quanto de fato roda por teste, e um erro de digitação vira
  silenciosamente "método indefinido" em vez de "nil inesperado", que
  geralmente é mais claro mas ocasionalmente surpreendente para quem está
  acostumado com variáveis de instância.
- **Um `double` nu é barato e pode mentir; um double verificado custa um
  carregamento de classe real e diz a verdade**: use `instance_double`/
  `class_double` por padrão assim que a classe colaboradora for carregável
  no ambiente de teste; mantenha `double` nu para colaboradores
  genuinamente fictícios (um objeto de protocolo que ainda não tem
  implementação real).
- **`allow` vs `expect` em um double é uma decisão sobre o que o teste de
  fato está afirmando**: fazer stub com `allow` quando a própria interação
  é o comportamento sob teste deixa um chamador quebrado passar
  silenciosamente; usar `expect` em todo lugar, incluindo em colaboradores
  sobre os quais ninguém se importa se foram chamados, faz refatorações
  quebrarem testes não relacionados sem motivo comportamental.
- **Exemplos compartilhados removem duplicação ao custo de uma indireção
  extra quando uma asserção compartilhada falha**: vale a pena quando três
  ou mais classes genuinamente compartilham um contrato; prematuro para
  duas classes que só parecem semelhantes hoje.

## Documentation Links

- [Minitest, GitHub (seattlerb/minitest)](https://github.com/minitest/minitest) (doc)
- [RSpec, Core documentation (rspec.info)](https://rspec.info/documentation/) (doc)
- [RSpec Mocks, verifying doubles](https://rspec.info/features/3-13/rspec-mocks/verifying-doubles/) (doc)
- [RSpec Expectations, built-in matchers](https://rspec.info/features/3-13/rspec-expectations/built-in-matchers/) (doc)
- [Programming Ruby 3.3 (Pickaxe), Testing Ruby Code](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
