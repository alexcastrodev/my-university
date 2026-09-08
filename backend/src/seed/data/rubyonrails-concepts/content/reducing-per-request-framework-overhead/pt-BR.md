---
version: 1.0
updatedAt: 2026-08-18
title: "Reduzindo o Overhead de Framework por Requisição do Rails"
summary: O Rails custa ~28ms por requisição sobre o Rack puro; um erro de arredondamento contra um carregamento de página de 700ms, mas uma conta real em uma API de alto tráfego; aqui estão as alavancas, e por que um Rails enxuto acabou sendo 25% mais rápido que o Sinatra puro.
---
## Objective

"Rails é lento" costuma ser afirmado, raramente medido. Quando o autor de
*The Complete Guide to Rails Performance* de fato mediu isso com `wrk`
contra uma resposta "Hello World", os números foram: Rack puro ~5ms/req,
Sinatra e Cuba ~9-14ms, Rails ~33ms. Então o próprio overhead de framework
do Rails é aproximadamente **28ms por requisição** sobre o Rack puro; um
número real, mas que precisa ser lido contra o orçamento em que vive. Um
carregamento de página completo típico é em torno de 700ms de ponta a
ponta, então esses 28ms são cerca de 4% do que o usuário de fato percebe.
Perseguir isso por *latência* é quase sempre a otimização errada.
Perseguir isso por **$/requisição** (custo de infraestrutura bruto em uma
API de alto tráfego onde 28ms por requisição se multiplicam em instâncias
que você precisa pagar) pode ser inteiramente racional. Este conceito é
sobre saber em qual situação você está, e quais são as alavancas de fato
se você está na segunda.

## Use Cases

- Rodar uma API JSON de alta vazão onde o tempo de requisição é dominado
  por overhead de framework em vez de I/O de banco de dados ou serviço
  externo, e contagem de instância (não latência percebida pelo usuário) é
  a coisa que você está tentando reduzir.
- Responder "deveríamos reescrever esse serviço em Sinatra/Roda?" com uma
  medição em vez de folclore; a resposta frequentemente é "não, enxugue a
  aplicação Rails em vez disso".
- Auditar o que uma aplicação Rails de fato carrega e roda por requisição:
  `bin/rails middleware` para ver a pilha Rack real, e
  `config/application.rb` para ver quais frameworks foram trazidos por um
  `require "rails/all"` reflexo.
- Cortar a pegada de memória em um container com um teto de memória
  rígido, onde os ~10MB de Sprockets em uma aplicação só de API é
  desperdício por worker multiplicado por todo worker em toda instância.
- Decidir se um endpoint quente específico (um health check, um pixel de
  rastreamento, um receptor de webhook de alto volume) justifica sair
  completamente de `ActionController::Base`.

## Deep Dive

### Carregue só os frameworks que você usa

O `config/application.rb` gerado usa `rails/all`, que dá `require` em todo
framework Rails, seja ele usado pela aplicação ou não:

```ruby
# config/application.rb, the default
require "rails/all"
```

Pegadas aproximadas do que isso traz: Sprockets ~10MB, ActiveRecord
~3.5MB, ActionMailer ~0.5MB, ActiveJob ~0.5MB. Um serviço só de API que
nunca renderiza um asset está pagando por Sprockets em todo processo
worker em toda instância. Escolher a dedo é uma mudança de uma linha por
framework:

```ruby
# config/application.rb, only what this app actually uses
require "rails"

require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
# deliberately NOT required:
#   require "sprockets/railtie"        # no asset pipeline
#   require "action_mailer/railtie"    # no outbound mail
#   require "action_view/railtie"      # JSON only, no templates
#   require "action_cable/engine"      # no websockets
#   require "active_storage/engine"    # no file attachments

module Api
  class Application < Rails::Application
    config.load_defaults 7.1
    config.api_only = true
  end
end
```

Isso principalmente compra **tempo de boot e memória**, não tempo por
requisição; mas memória por worker é exatamente o que decide quantos
workers cabem em uma instância, que é a alavanca de $/requisição.

### `ActionController::Metal` para endpoints quentes

`ActionController::Base` é `ActionController::Metal` mais uma longa lista
de módulos incluídos: `ForceSSL`, `HttpAuthentication`, `ImplicitRender`,
`RequestForgeryProtection`, `Cookies`, `Flash`, `Rendering`, e mais. Cada
um adiciona callbacks e trabalho de busca de método a toda action. Para um
endpoint que retorna uma string fixa milhares de vezes por segundo, você
pode pular quase tudo isso:

```ruby
class HealthController < ActionController::Metal
  def show
    self.status = 200
    self.headers["Content-Type"] = "application/json"
    self.response_body = '{"status":"ok"}'
  end
end
```

```ruby
# config/routes.rb
Rails.application.routes.draw do
  get "/health", to: "health#show"
end
```

O que você abre mão é real, não é de graça:

- **Nenhuma renderização de view.** Não existe `render`; você atribui
  `response_body` você mesmo. Sem templates, sem partials, sem `render
  json:`.
- **Nenhum render implícito.** Uma action que cai no final sem definir
  `response_body` retorna um corpo vazio, não um template.
- **Nenhuma proteção CSRF.** `protect_from_forgery` não existe aqui.
  Seguro para um endpoint só leitura ou autenticado por token; perigoso
  para qualquer coisa em que uma sessão de navegador consiga dar POST.
- **Sem cookies, sessão, ou flash.** `cookies` e `session` levantam
  `NoMethodError` a menos que você inclua os módulos de volta.
- **Nenhum parsing de `params` além do que você adicionar**, sem strong
  parameters, sem cadeia de filtro `before_action`.

Você pode reincluir seletivamente o que precisa, que é o meio-termo
honesto:

```ruby
class TrackingController < ActionController::Metal
  include ActionController::Head          # gives you head :ok
  include AbstractController::Callbacks   # gives you before_action
  include ActionController::StrongParameters

  before_action :verify_token

  def create
    RecordEventJob.perform_later(event_params.to_h)
    head :accepted
  end

  private

  def event_params
    ActionController::Parameters.new(request.POST).permit(:name, :user_id)
  end

  def verify_token
    head :unauthorized unless request.headers["X-Token"] == ENV["INGEST_TOKEN"]
  end
end
```

Todo módulo que você adiciona de volta devolve parte do overhead que você
removeu. `Metal` vale a pena para um punhado de endpoints genuinamente
quentes e genuinamente simples, não como classe base padrão para a
aplicação inteira.

### Logging

Logging é I/O síncrono no caminho da requisição. Em produção, escrever uma
linha nível `INFO` por requisição (mais uma linha por query SQL) em um
arquivo em disco é overhead mensurável, e é overhead que você talvez já
esteja duplicando em um APM ou agregador de log:

```ruby
# config/environments/production.rb
config.log_level = :error

# Log to STDOUT (container-friendly, no disk write, let the platform collect it)
config.logger = ActiveSupport::Logger.new($stdout)
config.logger.formatter = config.log_formatter
config.log_tags = [:request_id]
```

Elevar o nível para `:error` significa que você para de pagar por linhas
de log por requisição e por query, ao custo de perdê-las para depuração.
`:warn` é um meio-termo comum. Fazer log para STDOUT em vez de um arquivo
remove I/O de disco do caminho da requisição e entrega o buffering para a
plataforma.

### Remova middleware Rack que você não usa

Todo middleware na pilha é um `call(env)` na entrada e na saída para
**toda única requisição**. Olhe a pilha real antes de decidir qualquer
coisa:

```
$ bin/rails middleware
use ActionDispatch::HostAuthorization
use Rack::Sendfile
use ActionDispatch::Static
use ActionDispatch::Executor
use Rack::Runtime
use Rack::MethodOverride
use ActionDispatch::RequestId
use ActionDispatch::RemoteIp
use ActionDispatch::Cookies
use ActionDispatch::Session::CookieStore
use ActionDispatch::Flash
run Api::Application.routes
```

Depois delete-os **um de cada vez**, rodando sua suíte de testes depois de
cada um:

```ruby
# config/application.rb
config.middleware.delete Rack::Sendfile
config.middleware.delete Rack::MethodOverride
config.middleware.delete ActionDispatch::Flash
config.middleware.delete ActionDispatch::Session::CookieStore
config.middleware.delete ActionDispatch::Cookies
config.middleware.delete ActionDispatch::RemoteIp
```

Candidatos comuns para uma aplicação só de API, e por quê:

- **`Rack::Sendfile`**: útil só quando um servidor de front-end (nginx,
  Apache) lida com `X-Sendfile`/`X-Accel-Redirect` para você. Inútil se
  você nunca serve arquivos através da aplicação.
- **`ActionDispatch::Cookies`, `Session::CookieStore`, `Flash`**: uma API
  autenticada por token não tem sessão nem mensagens flash. Note a
  dependência de ordem: `Flash` e `Session` os dois ficam em cima de
  `Cookies`, então delete-os nessa ordem ou a pilha quebra.
- **`Rack::MethodOverride`**: só existe para que formulários HTML consigam
  fingir `PUT`/`DELETE` via um parâmetro `_method`. Um cliente JSON envia
  o verbo real.
- **`ActionDispatch::RemoteIp`**: faz o trabalho de percorrer
  `X-Forwarded-For` para encontrar o IP "real" do cliente. Se não há
  nenhum proxy confiável na frente da aplicação, ou você não usa
  `request.remote_ip` de forma nenhuma, é custo puro. Se você *tem* um
  proxy e *se importa* com IPs de cliente (limitação de taxa, detecção de
  abuso, geolocalização), mantenha-o; removê-lo degrada silenciosamente
  cada um desses.

### O resultado contraintuitivo

Aplicando essas alavancas a uma aplicação Rails, o próprio experimento do
autor terminou com uma build "Rails enxuta" que era **25% mais rápida que
o Sinatra puro**. Vale a pena dizer isso claramente, porque inverte a
suposição usual: o overhead do Rails é majoritariamente o custo de
recursos carregados por padrão, não do despacho de requisição central do
Rails. Uma vez que você para de carregar o que não usa, o framework não é
o gargalo; e uma reescrita em micro-framework, que custaria o ecossistema
Rails inteiro, teria tornado a aplicação *mais lenta* do que a aplicação
Rails que você já tinha.

## Trade-offs

- **Os 28ms são reais mas raramente o problema.** Contra um carregamento
  de página completo de ~700ms, eliminar todo o overhead de framework do
  Rails é uma melhoria de ~4% que nenhum usuário vai perceber. Se o
  objetivo real é latência percebida pelo usuário, o mesmo tempo de
  engenharia gasto em cache, queries N+1, ou entrega de asset de
  front-end vai retornar uma ordem de magnitude a mais. Persiga isso só
  quando a métrica que você é dono é $/requisição ou instâncias por
  vazão.
- **`ActionController::Metal` troca garantias de framework por
  velocidade.** Perder proteção CSRF e tratamento de sessão é uma mudança
  de postura de segurança, não um ajuste de performance. Um controller
  `Metal` que mais tarde ganha uma action POST voltada ao navegador é uma
  vulnerabilidade esperando para acontecer, e o framework não vai te
  avisar, porque você optou por sair do módulo que faria isso.
  ```ruby
  class UnsafeController < ActionController::Metal
    # No protect_from_forgery here, and no error telling you it's missing.
    def update; end
  end
  ```
- **Middleware deletado falha em tempo de execução, não no boot.**
  `config.middleware.delete ActionDispatch::Cookies` inicializa
  tranquilamente; a falha aparece na primeira vez que alguma gem, engine,
  ou caminho de código esquecido toca em `cookies`. É por isso que você
  deleta um de cada vez com uma suíte de testes entre cada um, e por que
  o risco escala com quantas engines de terceiros você monta.
- **Escolher railties a dedo torna atualizações mais barulhentas.**
  `rails/all` absorve novos frameworks automaticamente entre versões
  major; uma lista explícita de require significa que toda atualização do
  Rails é uma decisão sobre adicionar ou não a nova railtie. Isso é
  discutivelmente um recurso (nada carrega sem você saber), mas é trabalho
  contínuo que `rails/all` não te pedia.
- **Elevar `log_level` para `:error` troca observabilidade por I/O.** O
  primeiro incidente de produção em que você desejar ter o log de
  requisição vai custar mais do que os milissegundos economizados. Se
  você já tem um APM capturando traces de requisição, o argumento de
  duplicação se sustenta; se não tem, `:error` te deixa depurando às
  cegas.

## Documentation Links

- [Rails on Rack, Rails Guides](https://guides.rubyonrails.org/rails_on_rack.html) (doc)
- [Configuring Rails Applications, Rails Guides](https://guides.rubyonrails.org/configuring.html) (doc)
- [The Complete Guide to Rails Performance, Reducing Framework Overhead](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
