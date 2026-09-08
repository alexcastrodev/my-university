---
version: 1.0
updatedAt: 2026-08-18
title: "Rack: a Interface Sob Todo Framework Web em Ruby"
summary: Por que Rails, Sinatra, Roda e Hanami são todos, por baixo, apenas objetos que respondem a call(env), e como esse contrato de um único método é o que torna middleware portável entre todos eles.
---
## Objective

Rack é a interface padrão entre um servidor web em Ruby e um framework web
em Ruby. Ele desacopla os dois lados: o servidor só precisa saber construir
um hash de requisição e consumir uma resposta, e o framework só precisa
saber responder a um método. Uma "aplicação Rack" é qualquer objeto que
responde a `call(env)` e retorna um array de três elementos `[status,
headers, body]`. Esse é o contrato inteiro, e é por isso que Rails, Sinatra,
Roda e Hanami todos conseguem rodar sobre o Puma, e por que um middleware
escrito para um deles geralmente funciona nos outros.

## Use Cases

- Escrever lógica de requisição transversal (cronometragem, IDs de
  requisição, autenticação, limitação de taxa, curto-circuitos de health
  check) como middleware em vez de como um `before_action` ou filtro
  específico de framework.
- Reutilizar um middleware que você escreveu para uma aplicação Rails dentro
  de um pequeno serviço Sinatra ou Roda, sem reescrevê-lo.
- Montar várias aplicações em um único processo (`map "/admin" { run
  AdminApp }`), ou colocar uma pequena lambda Rack na frente de um framework
  completo para um caminho rápido.
- Depurar "de onde veio esse header?" em uma aplicação Rails lendo a pilha
  de middleware (`bin/rails middleware`) em vez de procurar em controllers.
- Testar uma camada web sem inicializar um servidor, chamando o objeto da
  aplicação diretamente com um hash `env` construído à mão.

## Deep Dive

### O contrato é um único método

```ruby
class HelloApp
  def call(env)
    body = ["Hello from #{env["PATH_INFO"]}\n"]
    [200, { "content-type" => "text/plain" }, body]
  end
end
```

- `env` é um Hash simples com chaves estilo CGI (`REQUEST_METHOD`,
  `PATH_INFO`, `QUERY_STRING`, `SERVER_NAME`, `HTTP_*` para headers de
  requisição) mais chaves específicas do Rack (`rack.input` para o stream do
  corpo da requisição, `rack.errors`, `rack.url_scheme`). É um hash mutável,
  que é como middleware passa dados pela pilha.
- `status` é um Integer (>= 100), não uma string.
- `headers` é um objeto tipo hash. No **Rack 3 as chaves precisam ser
  minúsculas** (`"content-type"`, não `"Content-Type"`), e um valor pode ser
  um Array quando um header legitimamente se repete (vários valores
  `set-cookie`, por exemplo).
- `body` precisa responder a `each`, entregando pedaços String. Um Array de
  strings é o corpo válido mais simples; qualquer coisa com um `each`
  funciona, que é como corpos baseados em arquivo e em enumerator são
  feitos. O Rack 3 também permite um corpo *em streaming*: um objeto que
  responde a `call(stream)` e escreve no próprio stream, para SSE e
  respostas de longa duração.

Como o contrato é só "responde a `call`", uma lambda é uma aplicação Rack
válida:

```ruby
app = ->(env) { [200, { "content-type" => "text/plain" }, ["ok\n"]] }
app.call({}) # => [200, {"content-type"=>"text/plain"}, ["ok\n"]]
```

### `config.ru`: `run` monta, `use` empilha

Um arquivo `config.ru` é Ruby comum avaliado no contexto de
`Rack::Builder`, que dá a ele três verbos principais:

```ruby
# config.ru
require_relative "request_timer"

use Rack::CommonLogger   # outermost
use RequestTimer         # then this
run HelloApp.new         # finally the app itself
```

- `run` define a aplicação **final**, a camada mais interna, chamada por
  último.
- `use` empilha um middleware **em torno de** tudo que for declarado depois
  dele, então o primeiro `use` é o envoltório mais externo. Uma requisição
  desce pela pilha e a resposta sobe de volta pelas mesmas camadas, na ordem
  inversa.
- `map "/prefix" do ... end` monta um builder aninhado sob um prefixo de
  caminho.

### Escrevendo um middleware

Um middleware é só uma aplicação Rack à qual foi entregue a *próxima*
aplicação Rack no momento da construção:

```ruby
class RequestTimer
  def initialize(app)
    @app = app
  end

  def call(env)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    status, headers, body = @app.call(env)
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started

    headers["x-runtime"] = format("%.6f", elapsed)
    env["app.runtime"] = elapsed   # available to outer middleware on the way back
    [status, headers, body]
  end
end
```

Tudo antes de `@app.call(env)` transforma a *requisição*; tudo depois
transforma a *resposta*. Esse é o modelo mental inteiro.

Note a sutileza: isso mede o tempo até os headers voltarem, não até o corpo
ser completamente escrito no socket. Um corpo lazy (um arquivo, um
enumerator, uma resposta em streaming) é iterado pelo servidor *depois* de
seu middleware já ter retornado. O próprio `Rack::Runtime` do Rack tem
exatamente essa característica.

Um middleware também pode decidir não chamar a próxima aplicação nenhuma
vez; é assim que autenticação, modos de manutenção e health checks fazem
curto-circuito:

```ruby
class HealthCheck
  def initialize(app, path: "/up")
    @app = app
    @path = path
  end

  def call(env)
    return [200, { "content-type" => "text/plain" }, ["ok\n"]] if env["PATH_INFO"] == @path

    @app.call(env)
  end
end
```

`use HealthCheck, path: "/healthz"` passa os argumentos extras direto para
`initialize`, depois da aplicação.

### Todo framework é uma aplicação Rack por baixo

- **Rails**: `Rails.application` responde a `call(env)`. A maior parte do
  que parece ser "Rails" nas bordas (servir arquivos estáticos,
  `Rack::Runtime`, as camadas de sessão e cookie, `ActionDispatch::
  ShowExceptions`) é middleware que você pode listar com `bin/rails
  middleware` e onde inserir com `config.middleware.use`/`insert_before`.
- **Sinatra** é um framework construído diretamente sobre o Rack, trocando a
  estrutura do Rails por blocos de rota:

  ```ruby
  require "sinatra"

  get "/hello/:name" do
    "Hello, #{params["name"]}!"
  end
  ```

  O valor de retorno do bloco se torna o corpo da resposta; o Sinatra monta
  a tripla `[status, headers, body]` para você. Roda e Hanami fazem escolhas
  de roteamento diferentes sobre a mesma interface.

Como todos terminam no mesmo array de três elementos, um middleware só
depende do Rack, não do framework, o que é precisamente o motivo de ele ser
portável.

### Onde o servidor de aplicação se encaixa

Abaixo do Rack fica o servidor de aplicação (Puma, Unicorn, Passenger). Seu
trabalho é falar HTTP, construir o hash `env`, chamar sua aplicação Rack, e
escrever a resposta de volta. Rack é a costura que permite trocar esse
servidor sem tocar no código da aplicação; os servidores diferem em seus
modelos de processo/thread/I-O, que é uma decisão separada, coberta no
conceito de servidor de aplicação.

## Trade-offs

- **Middleware é portável, mas trabalha abaixo das abstrações do
  framework**: dentro de `call(env)` você tem um hash cru, não parâmetros
  parseados, um usuário atual, ou uma instância de controller.
  `Rack::Request.new(env)` te dá um leitor mais amigável, mas qualquer coisa
  específica do framework precisa ser rederivada ou lida de chaves de `env`
  que o framework por acaso define. Lógica que precisa do contexto do
  framework pertence ao framework, não ao middleware.
- **Toda camada tributa toda requisição**: a pilha é chamada em ordem para
  todo o tráfego, incluindo assets e health checks. Um middleware que
  parseia um corpo ou acessa um armazenamento em toda requisição está
  fazendo isso para requisições que nunca vão usar o resultado; proteja
  cedo e retorne rápido.
- **Corpos de resposta são lazy, então "depois da chamada" não é "depois da
  resposta"**: middleware que registra log, cronometra, ou limpa recursos
  depois de `@app.call(env)` roda antes de um corpo em streaming ou de
  arquivo ter sido enviado. O contrato `body.close` do Rack (e
  `Rack::BodyProxy`) existe para trabalho que precisa acontecer só quando o
  corpo genuinamente terminar.
- **O Rack 3 quebrou suposições do Rack 2**: chaves de header se tornaram
  minúsculas, headers multivalor se tornaram Arrays em vez de strings
  unidas por nova linha, e o comando `rackup` mais o namespace
  `Rack::Handler` se moveram para uma gem `rackup` separada. Middleware que
  escreve `headers["Content-Type"]` ou divide em `"\n"` é código Rack 2.
  `Rack::Lint` em desenvolvimento pega a maioria dessas violações cedo.
- **A ordem de `use` é acoplamento real**: um middleware que precisa ver a
  sessão, ou precisa rodar antes de a resposta ser comprimida, tem uma
  posição obrigatória na pilha. Essa ordenação é fácil de quebrar
  silenciosamente quando uma camada é inserida em outro lugar, e não é
  expressa em nenhum lugar exceto a ordem das linhas no `config.ru` ou no
  inicializador do Rails.

## Documentation Links

- [Rack, GitHub (README e SPEC)](https://github.com/rack/rack) (doc)
- [Rack API documentation, RubyDoc.info](https://www.rubydoc.info/github/rack/rack) (doc)
- [Rails on Rack, Ruby on Rails Guides](https://guides.rubyonrails.org/rails_on_rack.html) (doc)
- [Sinatra, Intro e README](https://sinatrarb.com/intro.html) (doc)
- [Programming Ruby 3.3 (Pickaxe), Ruby and the Web: Rack](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) (doc)
