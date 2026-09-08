---
version: 1.0
updatedAt: 2026-08-21
title: "Múltiplos Bancos de Dados, Réplicas de Leitura e Sharding Horizontal no Rails"
summary: Uma réplica de leitura tira carga de query mas não faz nada pela vazão de escrita ou armazenamento no primário; sharding é o passo muito maior e muito mais difícil para quando o próprio primário é o gargalo. O Rails 6+ te dá connects_to, connected_to, e middleware automático de DatabaseSelector/ShardSelector para os dois, mas a janela de defasagem de 2 segundos e joins entre shards carregam cada um modos de falha reais e fáceis de perder.
---
## Objective

Um único primário Postgres consegue absorver uma quantidade surpreendente
de tráfego de leitura antes de se tornar o gargalo; um dashboard de
relatório, uma exportação de analytics, ou um punhado de scopes
barulhentos `COUNT(*)` rodando ao lado de escritas OLTP normais geralmente
aparece como dor no formato de réplica antes de aparecer como dor no
formato de sharding. O Rails 6 adicionou suporte de primeira classe
exatamente para essa progressão: aponte alguns models para uma réplica de
leitura com algumas entradas em `database.yml` e uma chamada
`connects_to`, e o próprio middleware do framework vai rotear leituras
para a réplica automaticamente. Sharding é o próximo passo, muito maior, e
é fácil recorrer a ele antes de precisar: ele transforma "um banco de
dados" em "N bancos de dados sem chaves estrangeiras nem joins entre
eles", e não existe flag de configuração que devolva isso. O sinal de que
você superou uma réplica e de fato precisa de shards é vazão de escrita ou
armazenamento no *primário*; uma réplica não faz nada por isso, porque
toda escrita ainda passa por uma única máquina.

## Use Cases

- Tirar carga de queries de relatório, analytics, e dashboard de admin
  para uma réplica para que parem de competir com escritas OLTP pela
  CPU e I/O do primário.
- Decidir se "adicionar uma réplica" é suficiente, ou se volume de
  escrita/armazenamento no próprio primário é a restrição real, que só
  sharding resolve.
- Conectar um job em segundo plano ou um endpoint de API para ler
  explicitamente do primário logo depois de escrever nele, em vez de
  confiar na janela de defasagem padrão do Rails.
- Construir um SaaS multi-tenant onde os dados de um cliente precisam
  viver em um shard específico; por residência de dados, isolamento de
  vizinho barulhento, ou para que um único tenant enorme não degrade
  todos os outros tenants compartilhando infraestrutura.
- Auditar o que quebra quando um `has_many :through` ou uma query de
  relatório precisa fazer join entre dois shards, e decidir se distribui
  a query na aplicação em vez disso.
- Rodar migrations através de uma topologia com shards, onde "isso foi
  para produção" agora significa "isso foi para todo shard".

## Deep Dive

### Configuração multi-banco de dados: `database.yml` e `connects_to`

O `database.yml` de três camadas do Rails nomeia um primário e uma réplica
por ambiente, e a configuração da réplica é marcada com `replica: true`:

```yaml
# config/database.yml
production:
  primary:
    database: app_production
    username: app
    password: <%= ENV["APP_DB_PASSWORD"] %>
    adapter: postgresql
  primary_replica:
    database: app_production
    username: app_readonly
    password: <%= ENV["APP_REPLICA_PASSWORD"] %>
    adapter: postgresql
    replica: true
```

Duas coisas importam aqui que são fáceis de errar. Primeiro, `primary` e
`primary_replica` apontam para o **mesmo nome de banco de dados**; são os
mesmos dados, alcançados através de duas conexões diferentes. Segundo, o
usuário da réplica deveria de fato ser um papel Postgres só leitura;
`replica: true` diz ao Rails "nunca rode migrations contra isso", não
impõe por si só acesso só leitura em nível de banco de dados. O Rails não
cria nem mantém a própria replicação; `primary_replica` já precisa ser uma
réplica de streaming Postgres real (autogerenciada ou uma oferta
gerenciada como réplicas de leitura RDS/Cloud SQL); o trabalho do Rails
começa em rotear queries para ela, não em configurar replicação.

Roteamento é declarado uma vez, em uma classe de conexão abstrata, com
`connects_to`:

```ruby
# app/models/application_record.rb
class ApplicationRecord < ActiveRecord::Base
  self.abstract_class = true

  connects_to database: { writing: :primary, reading: :primary_replica }
end
```

Todo model que herda de `ApplicationRecord` agora tem duas conexões
disponíveis (`:writing` e `:reading`), mapeadas para as entradas
`primary` e `primary_replica` em `database.yml`. Nada em um model ou
controller precisa mudar para usar a réplica; o que muda é *para qual
papel o Rails roteia uma dada query*, coberto a seguir.

### Divisão automática de leitura/escrita e a janela de defasagem

Dentro de um papel, o código só roda:
`ActiveRecord::Base.connected_to(role: :reading) { ... }` envia toda
query no bloco para `primary_replica`, e passar `prevent_writes: true`
faz o Rails de fato checar cada instrução e levantar exceção se algo
naquele bloco tentar escrever:

```ruby
ActiveRecord::Base.connected_to(role: :reading, prevent_writes: true) do
  Report.heavy_aggregate_query
end
```

Você raramente precisa escrever isso você mesmo para requisições web
comuns, porque o Rails traz um middleware que faz o roteamento
automaticamente: `ActiveRecord::Middleware::DatabaseSelector`, pareado
com uma classe resolver e uma classe de contexto de resolver, conectado
via `bin/rails g active_record:multi_db`:

```ruby
# config/initializers/multi_db.rb
Rails.application.configure do
  config.active_record.database_selector = { delay: 2.seconds }
  config.active_record.database_resolver = ActiveRecord::Middleware::DatabaseSelector::Resolver
  config.active_record.database_resolver_context = ActiveRecord::Middleware::DatabaseSelector::Resolver::Session
end
```

A única configuração que vale a pena entender precisamente é `delay:`,
que tem padrão de **2 segundos**. O Rails Guide descreve a garantia
exatamente nestes termos: o Rails vai enviar uma requisição `GET`/`HEAD`
para o *escritor*, não a réplica, se ela cair dentro de `delay` depois da
última escrita daquela sessão; isso é o que compra "leia sua própria
escrita" sem nenhuma mudança de código. O risco que existe para prevenir
é concreto e comum: um controller cria um registro, redireciona, e o
`GET` seguinte imediatamente consulta uma réplica que a replicação de
streaming ainda não alcançou; o clássico relato de bug "eu acabei de
salvar isso e agora sumiu", causado por defasagem de replicação, não por
um bug real de perda de dados.

Essa garantia é heurística, não uma medição de defasagem. Ela assume que
a defasagem real de replicação fica abaixo de 2 segundos; não a verifica.
Uma réplica ficando para trás sob carga (uma importação em massa, um
vacuum longo, um soluço de rede) pode defasar além dessa janela, e o
middleware vai tranquilamente rotear uma requisição de volta para a
réplica acreditando que ela está atualizada. E o middleware só cobre o
ciclo de requisição/resposta de uma sessão; um job Sidekiq que escreve e
depois precisa ler aquela mesma linha não tem nenhum middleware o
envolvendo e precisa optar explicitamente:

```ruby
class SendWelcomeEmailJob < ApplicationJob
  def perform(user_id)
    ActiveRecord::Base.connected_to(role: :writing) do
      user = User.find(user_id) # force primary — this job just wrote `user` moments ago
      UserMailer.welcome(user).deliver_now
    end
  end
end
```

### Sharding horizontal: `connects_to shards:` e `connected_to(shard:)`

Uma réplica resolve disputa de leitura; não faz nada por vazão de escrita
ou armazenamento, porque toda escrita ainda cai em um único primário.
Sharding divide o próprio caminho de *escrita* entre múltiplos primários
independentes, cada um dono de uma fatia dos dados:

```ruby
# app/models/sharded_record.rb
class ShardedRecord < ApplicationRecord
  self.abstract_class = true

  connects_to shards: {
    shard_one: { writing: :primary_shard_one, reading: :primary_shard_one_replica },
    shard_two: { writing: :primary_shard_two, reading: :primary_shard_two_replica }
  }
end
```

Todo shard ainda pode ter seu próprio leitor, então troca de papel e
troca de shard se compõem, mas selecionar um shard agora leva as duas
dimensões:

```ruby
ShardedRecord.connected_to(role: :writing, shard: :shard_two) do
  Order.create!(customer_id: 42, total_cents: 5_000)
end
```

Resolução por requisição tem o mesmo padrão de middleware gerado por
generator que a divisão de leitura/escrita, dessa vez
`ActiveRecord::Middleware::ShardSelector`, cujo trabalho é descobrir a
qual shard uma dada requisição pertence e envolver a requisição inteira
em `connected_to(shard: ...)` para você:

```ruby
# config/initializers/multi_db.rb
Rails.application.configure do
  config.active_record.shard_selector = { lock: true, class_name: "ShardedRecord" }
  config.active_record.shard_resolver = ->(request) { Tenant.find_by!(host: request.host).shard }
end
```

`lock:` tem padrão `true` e é um mecanismo de segurança real, não só um
padrão: com ele ligado, código dentro da requisição não consegue trocar
para um shard diferente daquele que o resolver escolheu, que é o que
impede um bug (ou um parâmetro de tenant-id não validado) de
acidentalmente ler ou escrever no shard de outro tenant no meio da
requisição. `class_name:` aponta o middleware para a classe abstrata dona
das conexões de shard; é `ActiveRecord::Base` por padrão, que está errado
no momento em que você tem mais de uma hierarquia conectada a shard.

### Escolhendo uma estratégia de sharding, e seus custos operacionais

As duas estratégias comuns são shard por uma chave de negócio
(tenant/id de cliente) e shard por um hash de uma chave:

- **Por tenant/cliente.** Um diretório (uma tabela pequena e rápida ou
  serviço mapeando `tenant_id → shard`) decide o posicionamento.
  Roteamento é simples e todas as linhas de um tenant vivem juntas, que é
  exatamente o que você quer para isolamento (um tenant barulhento ou
  enorme só afeta seu próprio shard) e para requisitos de residência de
  dados. O custo é tamanhos de shard desiguais: tenants não são do mesmo
  tamanho, então shards se distanciam, e mover um tenant baleia para seu
  próprio shard depois é um projeto de migração de dados ao vivo, não uma
  mudança de configuração.
- **Por hash consistente.** Fazer hash de uma chave espalha linhas
  uniformemente entre shards sem precisar de um serviço de diretório para
  posicionamento, e rebalanceia de forma mais previsível conforme shards
  são adicionados. O custo é que "os dados de um tenant" não estão mais
  colocalizados a menos que você deliberadamente faça hash no id do
  tenant (o que reintroduz o problema de tamanho desigual acima), e
  adicionar ou remover um shard significa refazer o hash e mover
  fisicamente uma fração de toda linha existente.

Qualquer que seja a estratégia escolhida, três custos aparecem de
qualquer forma:

1. **Joins e associações entre shards majoritariamente param de funcionar
   como joins SQL.** Um `has_many :through` (ou `has_one :through`) que
   abrange dois shards precisa de `disable_joins: true` na associação, o
   que faz o Rails rodá-lo como duas ou mais queries separadas e combinar
   os resultados em Ruby em vez de no banco de dados:
   ```ruby
   class Customer < ShardedRecord
     has_many :orders, through: :order_items, disable_joins: true
   end
   ```
   Isso tem implicações reais de performance, e qualquer `order`/`limit`
   na associação é aplicado **em memória** depois da busca, já que o
   Postgres em um shard não tem como ordenar por uma coluna que vive em
   outro shard.
2. **Migrations rodam uma vez por shard, não uma vez.** `bin/rails
   db:migrate` se torna uma operação que precisa ter sucesso contra a
   conexão `primary_*` de cada shard; uma migration que falha no shard
   três depois de ter sucesso nos shards um e dois deixa a frota em
   versões de schema inconsistentes até alguém perceber e reconciliar.
3. **"Em qual shard essa linha está" se torna infraestrutura obrigatória.**
   Uma vez que os dados de um cliente vivem em um shard específico,
   qualquer caminho de código que só tem um id (uma ferramenta de
   suporte, um handler de webhook, uma query de admin entre tenants)
   precisa de uma busca (a mesma tabela/serviço de diretório da
   estratégia de tenant acima, generalizada) antes mesmo de conseguir se
   conectar ao banco de dados certo. Não existe um `Order.find(id)` que
   busque "todos os shards" para você.

## Trade-offs

- **A garantia de ler sua própria escrita é um timer, não uma checagem
  de defasagem.** Ela assume que a defasagem de replicação fica abaixo de
  `delay` (2 segundos por padrão); nunca mede a defasagem real. Sob carga
  (uma importação em massa, um `VACUUM` de longa duração, saturação de
  rede de replicação) a defasagem real pode exceder a janela, e o exato
  bug de leitura obsoleta que o middleware existe para prevenir volta
  silenciosamente, sem erro e sem nenhuma linha de log apontando para
  ele.
- **O middleware só envolve o ciclo de requisição/resposta.** Um job em
  segundo plano, uma Rake task, ou uma conexão websocket não ganham nada
  disso automaticamente. Código fora de uma requisição web que escreve e
  depois lê a mesma linha precisa se envolver em `connected_to(role:
  :writing)` explicitamente; esquecer isso é a forma mais comum desse
  recurso causar um bug de produção em vez de prevenir um:
  ```ruby
  def perform(order_id)
    order = Order.find(order_id) # created moments ago by the enqueuing request —
                                  # this may hit a replica that hasn't seen it yet
    ChargeCustomerJob.perform_now(order)
  end
  ```
- **Sharding é uma porta arquitetural de mão única.** Uma vez que ids,
  chaves estrangeiras, e código de aplicação estão moldados em torno de
  "essa linha vive no shard N", desfazer isso (mesclar shards de volta,
  ou refazer a chave para uma estratégia de shard diferente) é uma
  migração de dados completa, não um revert. Confirme que o gargalo é de
  fato vazão de escrita ou armazenamento no primário (o que uma réplica
  não consegue corrigir) antes de adotar isso; adicionar shards para
  resolver um problema que uma réplica teria resolvido é um erro comum e
  caro.
- **`disable_joins: true` troca correção por um penhasco de
  performance.** "Joins" entre shards se tornam no formato N+1 por
  construção; uma query por shard, combinada e ordenada em Ruby, e esse
  custo escala com a contagem de shards, não com a contagem de linhas.
  Torna uma associação utilizável entre shards; não a torna barata.
- **`shard_selector` com `lock: true` é um padrão de segurança que também
  pode ser uma armadilha na direção oposta.** É o padrão certo para a
  maioria das aplicações (previne vazamento acidental de tenant no meio
  da requisição), mas qualquer fluxo de trabalho legítimo que genuinamente
  precisa tocar em dois shards em uma requisição (uma ação de admin entre
  tenants, um script de migração de dados) precisa gerenciar
  `connected_to` explicitamente ele mesmo em vez de confiar no resolver
  automático.

## Documentation Links

- [Active Record Multiple Databases, Rails Guides](https://guides.rubyonrails.org/active_record_multiple_databases.html) (doc)
- [ActiveRecord::Middleware::DatabaseSelector, Rails API](https://api.rubyonrails.org/classes/ActiveRecord/Middleware/DatabaseSelector.html) (doc)
- [ActiveRecord::Middleware::ShardSelector, Rails API](https://api.rubyonrails.org/classes/ActiveRecord/Middleware/ShardSelector.html) (doc)
- [ActiveRecord::ConnectionHandling#connects_to, Rails API](https://api.rubyonrails.org/classes/ActiveRecord/ConnectionHandling.html#method-i-connects_to) (doc)
