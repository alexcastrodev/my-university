---
version: 1.0
updatedAt: 2026-08-21
title: "Limitação de Taxa e Proteção Contra Abuso com rack-attack"
summary: Os padrões do rack-attack parecem prontos no momento em que inicializam, mas um cache store por processo em um deploy Puma multiworker subconta requisições silenciosamente e torna um limite de throttle sem sentido. Este conceito cobre a DSL, o requisito de cache store compartilhado que de fato faz o throttling funcionar, a explosão de borda do algoritmo de janela fixa, e por que bloquear por IP é um risco de falso positivo atrás de NAT compartilhado.
---
## Objective

O `rack-attack` vem com uma instalação de uma linha e um arquivo de
configuração que parece pronto no momento em que inicializa, e essa é
exatamente a armadilha. O cache store padrão em um deploy Puma
multiprocesso (2 workers, digamos) é memória por processo, então um
`throttle` de "5 requisições/segundo" está silenciosamente aplicando "10
requisições/segundo" contra o cliente real, dividido invisivelmente entre
qualquer worker no qual cada requisição por acaso caia. Ninguém vê um
erro; o throttle simplesmente não limita. Este conceito é sobre o punhado
de fatos concretos (o requisito de cache store compartilhado, o algoritmo
de janela, e onde bloquear por IP dá errado) que separam uma configuração
de rack-attack que *parece* correta de uma que de fato aguenta sob
tráfego real e atacantes reais.

## Use Cases

- Adicionar seu primeiro `throttle` ou `blocklist` a uma API Rails e
  decidir se chaveia por IP, chave de API, ou conta; a escolha determina
  se um escritório compartilhado ou NAT de operadora é coletivamente
  limitado por um único ator ruim.
- Depurar "nosso rate limit não parece estar funcionando" em produção,
  onde a resposta acaba sendo `ActiveSupport::Cache::MemoryStore` rodando
  por worker Puma em vez de uma instância Redis/Memcached compartilhada.
- Decidir como responder a uma requisição limitada: 429 simples, ou um
  `429` com headers `Retry-After` e `RateLimit-*` para que clientes bem
  comportados recuem corretamente em vez de tentar de novo imediatamente.
- Revisar um relatório de segurança de "o rate limiting é trivialmente
  contornado" e checar se está explorando a fronteira de janela fixa
  (2x explosão) ou um falso positivo de NAT compartilhado sendo
  contornado com chaves de API distintas.
- Escolher onde na pilha proteção contra abuso pertence: antes de
  autenticação e autorização, como middleware Rack, em vez de dentro de
  um `before_action` de controller que só roda depois de o Rails já ter
  parseado a requisição.

## Deep Dive

### `rack-attack` como middleware Rack, antes da aplicação Rails

`rack-attack` roda como middleware Rack, não como código de aplicação
Rails; para uma aplicação Rails ele é incluído e habilitado
automaticamente uma vez que a gem está no Gemfile, ficando na pilha de
middleware (veja `bin/rails middleware`, coberto para a pilha completa em
[Reduzindo o Overhead de Framework por Requisição](reducing-per-request-framework-overhead.md))
antes de `ActionDispatch::Executor` e tudo a jusante, incluindo
roteamento, cadeias `before_action` de controller, e qualquer chamada
`authorize` do Pundit/CanCanCan:

```ruby
# Gemfile
gem "rack-attack", "~> 6.8"
```

```ruby
# config/initializers/rack_attack.rb
# For Rack (non-Rails) apps you'd need: require "rack/attack"; use Rack::Attack
# Rails apps get this wired in automatically once the gem is present.
```

Essa ordenação é o ponto principal: uma requisição que o rack-attack
bloqueia ou limita nunca chega à [autorização](authorization-mass-assignment-and-encryption.md)
de forma nenhuma; nunca instancia uma política Pundit, nunca toca em
`current_user`, nunca roda uma única linha do seu controller. Proteção
contra abuso nessa camada é deliberadamente mais burra e mais cedo do que
autorização: ela ainda não sabe quem é o usuário, só como a requisição
crua parece (IP, caminho, headers, params). Por padrão o rack-attack não
bloqueia nem limita nada; toda regra abaixo é opt-in, declarada em
`config/initializers/rack_attack.rb`.

### A DSL: `throttle`, `blocklist`, `safelist`, `track`

Quatro declarações, checadas em uma ordem de precedência fixa: safelist
primeiro (uma permissão incondicional que pula tudo o mais), depois
blocklist, depois throttle, depois track (que nunca bloqueia; só observa
e instrumenta).

**`safelist`**: sempre permite, independente de qualquer correspondência
de blocklist ou throttle:

```ruby
Rack::Attack.safelist("allow from localhost") do |req|
  "127.0.0.1" == req.ip || "::1" == req.ip
end
```

**`blocklist`**: bloqueio incondicional, avaliado como um booleano por
requisição:

```ruby
Rack::Attack.blocklist("block known bad UA") do |req|
  req.user_agent == "BadBot/1.0"
end
```

**Um throttle por chave de API**, o formato que você quer para uma API
autenticada; o discriminador é a própria chave, então cada chamador ganha
seu próprio contador independente:

```ruby
Rack::Attack.throttle("api requests by key", limit: 100, period: 60) do |req|
  req.env["HTTP_X_API_KEY"] if req.path.start_with?("/api/")
end
```

**Um throttle por IP**, o fallback para endpoints não autenticados
(cadastro, login, redefinição de senha) onde ainda não há uma chave de
API para chavear:

```ruby
Rack::Attack.throttle("logins by ip", limit: 5, period: 20) do |req|
  req.ip if req.path == "/login" && req.post?
end
```

O bloco retorna o **discriminador**: qualquer valor pelo qual o
rack-attack deveria contar requisições. Retornar `nil` (como os dois
exemplos fazem implicitamente para caminhos que não casam) significa "não
conte essa requisição contra esse throttle de forma nenhuma", que é como
você escopa um throttle a rotas específicas sem uma guarda `blocklist`
separada. `limit` e `period` também aceitam um `proc`, que é como o
próprio exemplo do README dá a um admin autenticado um limite mais alto
que um usuário anônimo de dentro do mesmo bloco de throttle.

**`track`**: observação pura, sem bloqueio, útil para medir um padrão
antes de decidir se merece um throttle:

```ruby
Rack::Attack.track("scraper-looking requests") do |req|
  req.user_agent&.include?("HeadlessChrome")
end
```

`Fail2Ban.filter` e `Allow2Ban.filter` são dois padrões prontos
construídos em cima de `blocklist` para "N falhas em uma janela bane por
um período de resfriamento" (Fail2Ban: conta requisições ruins, bane
acima de um limite) e seu inverso (Allow2Ban: permite até um limite,
depois bane); os dois ainda só chamam o mesmo cache compartilhado por
baixo.

### O cache store: a misconfiguração mais comum do rack-attack

Todo contador de `throttle`, `Fail2Ban`, e `Allow2Ban` é armazenado em
`Rack::Attack.cache`, que tem padrão `Rails.cache` se o Rails estiver
presente. Esse padrão é a armadilha: **se `Rails.cache` é
`ActiveSupport::Cache::MemoryStore` (o padrão do Rails em `development`, e
às vezes deixado sem mudança em `production` em uma aplicação pequena),
todo processo worker do Puma conta independentemente**. Um `throttle` de
`limit: 5, period: 20` em um cluster Puma de 4 workers não aplica "5
requisições por 20 segundos"; aplica até "20 requisições por 20
segundos", silenciosamente, porque o contador em memória de cada worker
nunca vê as requisições que os outros três workers contaram. Nada
levanta um erro; o throttle simplesmente subconta silenciosamente, e o
modo de falha é invisível até alguém apontar uma rajada real para o
endpoint.

A correção: aponte o cache explicitamente para um armazenamento
compartilhado entre todo processo e toda instância:

```ruby
# config/initializers/rack_attack.rb
Rack::Attack.cache.store = ActiveSupport::Cache::RedisCacheStore.new(url: ENV["REDIS_URL"])
```

Segundo o próprio README do rack-attack, o armazenamento só precisa
implementar `increment` e `write` do jeito que `ActiveSupport::Cache::Store`
faz, então qualquer subclasse de `ActiveSupport::Cache::Store` se
qualifica; Redis e Memcached são os dois que o README menciona
explicitamente, e ele recomenda explicitamente um **banco de
dados/instância separado do seu cache de propósito geral**, para que um
pico de tráfego de throttle durante um ataque real não degrade também o
cache de aplicação não relacionado.

O `Solid Cache` do Rails 8 (coberto em [Solid Queue, Cache e
Cable](solid-queue-cache-and-cable.md)) tecnicamente satisfaz a mesma
interface; é apoiado em `ActiveSupport::Cache::Store`; então ele vai
*funcionar*. Mas é apoiado em uma tabela de banco de dados
(`solid_cache_entries`), não memória, e um contador de throttle faz uma
escrita `increment` em toda única requisição correspondente. O padrão de
tráfego que faz rate limiting importar (uma rajada ou um ataque) é
exatamente o padrão de tráfego que transforma isso em uma rajada de
escritas de banco de dados no momento em que seu banco de dados está
menos capaz de absorver carga extra. Redis/Memcached continuam sendo o
ajuste melhor especificamente para essa carga de trabalho; o trade-off de
amplificação de escrita do Solid Cache é bom para cache de aplicação
geral, não para um contador atingido em toda requisição a um endpoint
quente.

### Estratégia de janela: janela fixa, não deslizante

A contagem do rack-attack é uma **janela fixa**, confirmada diretamente em
seu código-fonte (`Rack::Attack::Cache#key_and_expiry`): a chave de cache
embute `epoch_time / period`, agrupando toda requisição em uma janela
alinhada ao relógio de parede (por exemplo, com `period: 60`, toda
requisição entre `:00` e `:59` de um minuto compartilha um contador, e o
contador reseta para zero na próxima fronteira de minuto) em vez de
rastrear uma janela retroativa contínua de N segundos a partir de cada
requisição.

Isso tem uma consequência concreta e explorável: um cliente pode enviar
`limit` requisições no último instante de uma janela e outro `limit` de
requisições no primeiro instante da janela seguinte, obtendo **até 2x o
limite configurado** em um espaço curto do mundo real que atravessa a
fronteira; com `limit: 100, period: 60`, até 200 requisições em alguns
segundos, divididas em torno da marca de `:59.9`. É uma lacuna real, mas
limitada: no máximo uma rajada extra por cruzamento de fronteira, não um
bypass ilimitado, e a própria documentação do rack-attack é explícita
que o objetivo principal é amortecer abuso sustentado, não fornecer uma
garantia exata de janela deslizante; para precisão mais estrita, um
algoritmo de janela deslizante implementado no seu próprio bloco
`throttle` (contra o mesmo cache compartilhado) é a válvula de escape
documentada, não um modo embutido.

### Tratamento de resposta: 429, `Retry-After`, e customizando o responder

Uma requisição limitada recebe um `429 Too Many Requests` por padrão; uma
requisição bloqueada recebe `403 Forbidden` por padrão. Os dois são
sobrescrevíveis:

```ruby
Rack::Attack.throttled_responder = lambda do |request|
  match_data = request.env["rack.attack.match_data"]
  now = match_data[:epoch_time]

  headers = {
    "Content-Type"        => "application/json",
    "RateLimit-Limit"     => match_data[:limit].to_s,
    "RateLimit-Remaining" => "0",
    "RateLimit-Reset"     => (now + (match_data[:period] - now % match_data[:period])).to_s
  }

  [429, headers, [{ error: "rate_limited" }.to_json]]
end
```

`request.env["rack.attack.match_data"]` carrega `:discriminator`,
`:count`, `:period`, `:limit`, e `:epoch_time`: tudo que é necessário
para dizer ao chamador exatamente quanto tempo esperar, em vez de fazê-lo
adivinhar e tentar de novo. Para o caso comum de só querer um header
`Retry-After` padrão sem escrever um responder customizado:

```ruby
Rack::Attack.throttled_response_retry_after_header = true
```

`blocklisted_responder` é o override equivalente para requisições
bloqueadas, e o README observa um motivo real para recorrer a ele:
retornar `503` em vez do `403` padrão para uma requisição bloqueada pode
fazer um atacante acreditar que conseguiu derrubar o serviço em vez de
que foi identificado e bloqueado, o que às vezes é preferível a confirmar
a detecção.

## Trade-offs

- **Bloqueio baseado em IP atrás de NAT compartilhado é uma máquina de
  falso positivo.** Um `blocklist_ip` ou um `throttle` por IP escopado
  estreitamente demais trata "um endereço IP" como "um usuário", que é
  falso para qualquer um atrás de um proxy corporativo, uma rede
  universitária, o CGNAT de uma operadora móvel, ou um nó de saída VPN
  compartilhado. Bloquear um ator abusivo naquele IP tranca fora todas as
  outras pessoas que por acaso o compartilham, potencialmente um
  escritório inteiro ou uma fatia da base de assinantes de uma
  operadora, nenhuma das quais fez nada de errado:
  ```ruby
  # Looks reasonable, silently punishes everyone behind req.ip:
  Rack::Attack.blocklist("ban abusive ip") do |req|
    Rack::Attack::Fail2Ban.filter(req.ip, maxretry: 3, findtime: 1.minute, bantime: 1.hour) do
      req.path == "/login" && req.post? && invalid_login?(req)
    end
  end
  ```
  Para uma API autenticada, limitar por chave de API ou por conta (como
  no primeiro throttle do Deep Dive) não tem esse modo de falha de forma
  nenhuma; isola a própria credencial de cada chamador, então o abuso de
  um chamador não consegue vazar para um estranho que por acaso
  compartilha a rede dele. Throttling por IP é o fallback necessário só
  para a superfície pré-autenticação (login, cadastro, redefinição de
  senha) onde ainda não há uma conta para chavear.
- **Contagem de janela fixa protege insuficientemente bem na fronteira.**
  Como mostrado acima, um cliente determinado consegue extrair
  aproximadamente 2x o limite configurado cronometrando requisições em
  torno da borda da janela. Essa é uma propriedade conhecida e limitada
  do algoritmo, não um bug; mas um `throttle` dimensionado como se fosse
  um limite deslizante exato vai se surpreender com isso sob tráfego
  adversarial.
- **Um cache store compartilhado é um novo ponto único de disputa, e
  possivelmente de falha.** Apontar o rack-attack para Redis/Memcached
  significa que toda requisição limitada agora custa uma ida e volta de
  rede até aquele armazenamento; a própria nota de performance do README
  aponta isso e recomenda manter baixo o número de checagens de throttle
  por requisição. Também significa que uma indisponibilidade ou pico de
  latência naquele armazenamento agora afeta o tratamento de requisição
  em toda rota que um throttle cobre, não só as que estão sob ataque;
  esse é o argumento para o conselho do README de dar ao rack-attack seu
  próprio banco de dados/instância dedicado em vez de compartilhar o
  cache de propósito geral da sua aplicação.
- **Safelisting sobrepõe tudo, incluindo um throttle que você pretendia
  aplicar.** Um bloco `safelist` amplo demais (por exemplo, confiando em
  um header que o próprio cliente pode definir, como um `X-Internal:
  true` não autenticado) não só falha em bloquear; ele contorna toda
  blocklist e throttle na aplicação para qualquer requisição que casa com
  ele, silenciosa e completamente.
- **`track` nunca bloqueia, então um deploy só com `track` dá uma falsa
  sensação de proteção.** É fácil entregar um `track` para um padrão
  suspeito, observar as métricas, e esquecer que nada está de fato
  parando o tráfego; observação não é aplicação, e as duas são fáceis de
  confundir de relance no inicializador.

## Documentation Links

- [rack-attack, GitHub](https://github.com/rack/rack-attack) (doc)
- [rack-attack, Advanced Configuration](https://github.com/rack/rack-attack/blob/main/docs/advanced_configuration.md) (doc)
- [rack-attack, Example Configuration](https://github.com/rack/rack-attack/blob/main/docs/example_configuration.md) (doc)
