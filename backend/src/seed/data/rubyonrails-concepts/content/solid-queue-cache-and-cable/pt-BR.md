---
version: 1.0
updatedAt: 2026-08-21
title: "Solid Queue, Solid Cache e Solid Cable: os Padrões Sem Redis do Rails 8"
summary: O Rails 8 usa por padrão adaptadores de job, cache e pubsub apoiados em banco de dados em vez de Redis; a 37signals cortou o custo de cache do Basecamp em 80% e sua latência P95 pela metade fazendo isso, mas polling não é push, e o teto honesto de cada adaptador é documentado, não presumido.
---
## Objective

A 37signals rodou Resque contra Redis por anos no Basecamp e no HEY, e por
conta própria ainda precisava de **sete gems separadas** (`resque`,
`resque-pool`, `resque-scheduler`, `resque-pause`,
`resque_supervised_fork`, `sequential_jobs`, `scheduled_job`) só para
conseguir pausa de job, agendamento, e forking supervisionado que um único
backend bem desenhado deveria fornecer. O Solid Queue substituiu as sete
por uma única dependência apoiada no próprio banco de dados da aplicação,
e no fim de 2024 estava rodando aproximadamente 20 milhões de jobs por dia
só para o HEY. O Solid Cache fez algo parecido para cache: trocar
Redis/Memcached por uma tabela de banco de dados derrubou o custo do cache
store do Basecamp em aproximadamente 80% enquanto aumentava a retenção de
cache de dias para meses, e cortou a duração P95 de requisição do
Basecamp de 375ms para 225ms; não porque o disco ficou mais rápido que a
RAM, mas porque um **cache seis vezes maior** significou muito menos
misses frios. Este conceito é sobre o que você de fato ganha, e abre mão,
quando deixa o trio padrão apoiado em banco de dados do Rails 8 substituir
o Redis em vez de recorrer ao Sidekiq e ao Action Cable apoiado em Redis
por hábito.

## Use Cases

- Montar uma aplicação Rails 8 nova e decidir se mantém os padrões Solid
  Queue / Solid Cache / Solid Cable ou troca por Sidekiq apoiado em Redis
  e Action Cable antes mesmo de você ter feito um deploy sequer.
- Rodar em um único servidor (ou um punhado, via Kamal) onde todo serviço
  acessório (Redis, um daemon de cache separado, um broker pubsub) é mais
  uma coisa para provisionar, corrigir, e pagar.
- Depurar um job travado ou duplicado consultando `solid_queue_jobs` e
  `solid_queue_failed_executions` diretamente com SQL, em vez de recorrer
  ao `redis-cli` ou a uma Web UI do Sidekiq.
- Decidir se um recurso WebSocket crescente (notificações ao vivo, um
  widget de chat, atualizações de dashboard) ainda está na zona de
  conforto do Solid Cable, ou se já cruzou para o território de "recorra
  ao Redis".
- Escolher onde colocar um cache de fragmento grande e de longa duração
  quando o gargalo honesto é *tamanho* de cache (taxa de acerto), não
  latência por leitura.
- Dimensionar o pool de conexões de banco de dados quando workers,
  dispatchers, threads de expiração de cache, e pollers do Cable estão
  todos disputando conexões junto com requisições web.

## Deep Dive

### Por que o "trio sólido" existe

O Rails 8 tornou três adaptadores apoiados em banco de dados (Solid Queue
para jobs, Solid Cache para cache store, e Solid Cable para pubsub do
Action Cable) o padrão para aplicações novas, substituindo o que costumava
exigir Redis mais, na maioria das aplicações reais, uma gem separada de
fila de job por cima. O anúncio do Rails 8.0 do DHH enquadra o "por quê"
em torno do custo de deploy e uma observação de hardware, não em torno de
uma vitória de benchmark: *"Ninguém deveria ter que pagar ordens de
magnitude a mais por computação básica só para tornar o deploy amigável e
usável"*; a ideia motivadora por trás do Rails 8 parear o trio Solid com o
Kamal 2 para uma história de deploy "sem PaaS necessário" de um ou poucos
servidores. A premissa técnica específica para os três adaptadores é
declarada diretamente: *"Discos ficaram rápidos o bastante para não
precisarmos de RAM para tantas tarefas... [colhendo] os benefícios de
simplificação de discos SSD e NVMe sendo ordens de magnitude mais rápidos
que os bons e velhos discos rígidos mecânicos."* Menos serviços
acessórios não é uma conveniência menor para o modelo de deploy da
37signals; uma instância Redis é mais uma peça para provisionar, proteger,
fazer backup, e pagar em todo servidor, e em um deploy Kamal de máquina
única esse overhead é proporcionalmente muito maior do que é em uma
grande frota PaaS que já roda um Redis gerenciado de qualquer forma.

### Solid Queue

O Solid Queue é um backend de Active Job apoiado em banco de dados. Seu
mecanismo central, confirmado diretamente pelo README da própria gem, é
`SELECT ... FOR UPDATE SKIP LOCKED` (disponível no PostgreSQL 9.5+, MySQL
8+, MariaDB 10.6+) para que múltiplos processos worker consigam consultar
a mesma tabela `solid_queue_ready_executions` concorrentemente sem
bloquearem uns aos outros em locks de linha:

```sql
-- Solid Queue's actual polling query (no queue filter)
SELECT job_id
FROM solid_queue_ready_executions
ORDER BY priority ASC, job_id ASC
LIMIT ?
FOR UPDATE SKIP LOCKED;
```

Três tipos de ator fazem o trabalho: **workers** pegam jobs prontos
daquela tabela e os rodam (em um pool de threads via `threads:`, ou como
fibers em uma única thread reactor via `fibers:`, configurações
mutuamente exclusivas); **dispatchers** movem jobs agendados cujo momento
chegou de `solid_queue_scheduled_executions` para a tabela pronta, e fazem
manutenção de controle de concorrência; o **scheduler** gerencia tarefas
recorrentes. Um processo `supervisor` faz fork e monitora todos eles (o
modo padrão `fork`; o modo `async` roda tudo nas threads de um único
processo em vez disso, ao custo do isolamento).

Tarefas recorrentes são configuradas declarativamente em
`config/recurring.yml`:

```yaml
production:
  clear_stale_sessions:
    command: "Session.clear_stale"
    schedule: every day at 9am
  send_daily_digest:
    class: SendDailyDigestJob
    schedule: "0 8 * * *"
```

Controles de concorrência (`limits_concurrency`) limitam quantos jobs com
uma dada chave rodam de uma vez; esse é um recurso do Solid Queue,
distinto dos *padrões de design* de idempotência e fan-out/fan-in cobertos
em [Jobs em Segundo Plano: Idempotência e Fan-Out](background-jobs-idempotency-and-fan-out.md):

```ruby
class DeliverAnnouncementToContactJob < ApplicationJob
  limits_concurrency to: 2, key: ->(contact) { contact.account }, duration: 5.minutes

  def perform(contact)
    # at most 2 of these run concurrently per account
  end
end
```

**Operacionalmente versus Sidekiq**: não há nenhum processo Redis separado
para provisionar ou fazer failover; a fila mora no mesmo banco de dados
que você já está rodando (recomendado como um banco de dados lógico
separado, mas ainda nenhum serviço novo). O trade-off real é polling
versus push: os padrões documentados do próprio Solid Queue são um
intervalo de polling de `0.1` segundo para workers e `1` segundo para
dispatchers, que é o mecanismo, não uma aproximação; um worker pegando um
job recém-enfileirado espera nessa cadência de polling, onde uma fila
apoiada em Redis com um pop bloqueante (`BRPOP`) consegue entregar um job
a um worker livre dentro de milissegundos do enfileiramento. Para a
maioria do trabalho em segundo plano (enviar um email, processar um
webhook, gerar um relatório) essa diferença é invisível; para um job cujo
ponto inteiro é tempo de reação abaixo de um segundo, é um piso de
latência real e mensurável que intervalos de polling sozinhos não apagam.

### Solid Cache

O Solid Cache é um `ActiveSupport::Cache::Store` apoiado em uma tabela
dedicada `solid_cache_entries` em vez de Redis ou Memcached. Segundo o
próprio README da gem, é explicitamente um **cache FIFO, não LRU**: a
remoção não rastreia recência de acesso de forma nenhuma; ele estima
tamanho/contagem atual comparando IDs de chave primária máximo e mínimo, e
uma vez que uma escrita empurra o contador de escrita rastreado além de
50% de `expiry_batch_size` (padrão 100), uma thread em segundo plano
deleta as `expiry_batch_size` linhas mais antigas, primeiro por se
`max_entries`/`max_size` for excedido, senão por `max_age` (padrão 2
semanas). Deletar de uma ponta da tabela enquanto insere na outra evita
fragmentação. A troca por abrir mão da precisão de LRU é simplicidade
operacional: sem contabilidade por leitura, e a remoção só roda quando o
cache está de fato sendo escrito, então um cache ocioso não custa nada.

```yaml
# config/cache.yml
production:
  database: cache
  store_options:
    max_age: <%= 60.days.to_i %>
    max_size: <%= 256.gigabytes %>
```

O trade-off de latência é real e a 37signals é explícita sobre o número:
mover o cache do Basecamp para o Solid Cache apoiado em disco tornou
leituras individuais **aproximadamente 40% mais lentas** do que a
configuração Redis anterior deles. O que tornou isso uma troca obviamente
boa para eles não foi um truque mágico de disco-é-rápido-o-bastante; foi
que o cache ficou aproximadamente **6 vezes maior** a um custo de
armazenamento aproximadamente **80% menor**, o que elevou a taxa de
acerto o bastante para a duração P95 de requisição do Basecamp cair de
375ms para 225ms. Um cache mais lento acertado com muito mais frequência
venceu um cache mais rápido acertado com menos frequência. Essa é uma
aposta dependente de carga de trabalho: uma aplicação levemente cacheada
para começar não vai ver o mesmo retorno, e segundo o README do Solid
Cache, latência por leitura ainda importa nesse caso; nada aqui dispensa
o raciocínio de latência de cache store coberto em [Russian Doll
Caching](russian-doll-caching.md), que é dono da pergunta de estratégia
sobre *o que* cachear e *como* chaveá-lo, não do motor de armazenamento
por baixo.

O Solid Cache também suporta **criptografia em repouso**, real e
diretamente configurável: defina `encrypt: true` em `config/cache.yml`
(ou `config.solid_cache.encrypt = true`), em cima de uma aplicação já
configurada para Active Record Encryption. Ele usa um encriptador com
compressão desabilitada (o cache já comprime) e um serializador MessagePack
que armazena aproximadamente 40% mais dados do que o serializador padrão,
o que importa porque payloads criptografados são armazenados em colunas
binárias com limites reais de tamanho.

### Solid Cable

O Solid Cable é a camada pubsub do Action Cable apoiada em uma tabela
`solid_cable_messages` em vez de Redis, usando polling (padrão `0.1`
segundos) em vez de `PUBLISH`/`SUBSCRIBE`. O próprio README da gem declara
seu alvo de performance claramente: *"Apesar do polling, a performance do
Solid Cable é comparável à do Redis na maioria das situações."* Essa
afirmação é apoiada por benchmarks publicados no próprio repositório da
gem (teste de carga k6, SQLite, polling padrão de 0.1s, 100 VUs): tempo
médio de ida e volta ~136ms versus ~69ms do Redis no mesmo hardware; uma
diferença real e mensurável, não "comparável" no sentido de idêntica, mas
pequena o bastante para não importar na maioria dos recursos de tempo
real orientados a UI. Essa diferença aumenta sob carga: a 750 usuários
virtuais concorrentes no mesmo benchmark, o RTT médio do Solid Cable
cresceu para ~548ms (Redis: ~163ms), e a própria documentação da gem
observa que baixar o intervalo de polling para `0.01s` traz o SQLite de
volta a "comparável ao Redis"; ao custo de dez vezes o volume de query de
polling contra o banco de dados.

Mensagens são retidas e autotrimmed com base em `message_retention`
(padrão 1 dia); um benefício colateral é que o histórico recente de
broadcast é consultável para depuração, algo que o pubsub do Redis nunca
te deu já que não guarda nada depois da entrega. O próprio autotrimming
tem um custo documentado: o README observa que ele "pode impactar
negativamente a performance levemente dependendo da sua carga de trabalho
porque potencialmente faz um delete a cada broadcast", que é o motivo de
`autotrim: false` mais um `SolidCable::TrimJob` agendado ser oferecido
como alternativa para aplicações de alto volume de broadcast.

### Quando ainda escolher o Redis

Nenhum dos três adaptadores afirma ser um substituto universal, e o
framework de decisão honesto acompanha o mesmo eixo nos três casos: **o
quanto latência abaixo de um segundo até milissegundos, em concorrência
significativa, de fato importa para essa carga de trabalho específica**:

- **Solid Queue → Sidekiq/Redis**: recorra ao Sidekiq apoiado em Redis
  quando jobs precisam começar dentro de milissegundos de um único
  dígito depois de serem enfileirados em volume alto sustentado (trading
  em tempo real, lances ao vivo), ou quando você já está rodando Redis
  por outros motivos e o custo operacional de um segundo sistema de fila
  excede o custo de mais um cliente Redis.
- **Solid Cache → Redis/Memcached**: recorra a um armazenamento em
  memória quando a carga de trabalho é sensível a latência de leitura no
  nível de microssegundos em vez de sensível a taxa de acerto, ou quando
  os dados cacheados mudam tão rápido que uma grande janela de retenção
  não compra nada (uma política de remoção FIFO em um cache que nunca tem
  entradas "frias" que valha a pena manter não está se justificando).
- **Solid Cable → Redis (ou AnyCable)**: os próprios benchmarks do Solid
  Cable mostram a diferença de RTT crescendo conforme conexões
  concorrentes sobem para as centenas altas; para tempo real
  genuinamente de alta vazão (milhares de conexões concorrentes, muitas
  mensagens/segundo por conexão, ou garantias de entrega abaixo de 10ms) o
  modelo de polling é a ferramenta errada, e o pubsub do Redis (ou um
  produto dedicado como AnyCable) é o fallback documentado.

O sinal unificador: os três adaptadores trocam um imposto de latência
pequeno e aproximadamente constante (um intervalo de polling, uma leitura
de disco individual mais lenta) por simplicidade operacional e, no caso do
Solid Cache, um recurso genuinamente maior (tamanho de cache). Essa é uma
boa troca até o próprio imposto se tornar o gargalo, o que, para a maioria
das aplicações Rails no formato CRUD, nunca acontece.

## Trade-offs

- **A armadilha da integridade transacional**: o README do Solid Queue
  aponta isso diretamente. Se o banco de dados de job e o banco de dados
  da aplicação são a mesma conexão, enfileirar um job dentro de uma
  transação ActiveRecord amarra a existência do job ao commit/rollback
  daquela transação; poderoso, mas fácil de depender silenciosamente.
  Mova o Solid Queue para seu próprio banco de dados depois (a
  configuração recomendada, padrão) e essa garantia evapora sem nenhum
  erro:
  ```ruby
  ApplicationRecord.transaction do
    order.update!(status: "paid")
    ChargeReceiptJob.perform_later(order.id) # enqueue rides the transaction...
    raise ActiveRecord::Rollback if suspicious?
    # ...until someone points Solid Queue at its own DB, at which point
    # ChargeReceiptJob may already have been enqueued and could run even
    # though the order update above got rolled back.
  end
  ```
  `enqueue_after_transaction_commit` do Rails 8 (opt-in, desligado por
  padrão) corrige isso de verdade em vez de depender de comportamento
  incidental do mesmo banco de dados.
- **O Solid Cache é FIFO, não LRU.** Uma chave lida com frequência que
  por acaso é antiga pode ser removida antes de uma chave que ninguém
  tocou em semanas só porque foi escrita mais recentemente. Para uma
  carga de trabalho com um "conjunto quente" genuíno distinto da recência
  de escrita, essa é uma lacuna real de intuição de correção, mesmo sendo
  o design deliberado e documentado (rastrear recência custaria uma
  escrita em toda leitura).
- **Controles de concorrência têm overhead real.** A própria documentação
  do Solid Queue avisa que `limits_concurrency` não deveria ser usado como
  um throttle geral; todo job controlado precisa de uma linha de semáforo
  criada e atualizada, e jobs controlados perdem o benefício de
  performance de enfileiramento em massa (`perform_all_later`)
  completamente, já que precisam ser enfileirados um de cada vez para
  respeitar o limite. Para limitação de taxa simples (em oposição a
  exclusão mútua verdadeira), uma fila dedicada de baixa concorrência com
  menos threads worker é a alternativa documentada e mais barata.
- **Os três adaptadores adicionam pressão de pool de conexões**, por cima
  do que a camada web já precisa; workers, dispatchers, threads de
  expiração de cache, e pollers do Cable cada um segura suas próprias
  conexões contra o que quer que os apoie. A própria orientação do Solid
  Queue é dimensionar o `threads:` de um worker igual a ou abaixo do
  tamanho do pool do banco de dados de fila menos 2; errar isso não falha
  alto, aparece como `ActiveRecord::ConnectionTimeoutError` intermitente
  sob carga; veja [Connection Pooling e PgBouncer](connection-pooling-and-pgbouncer.md)
  para a matemática de dimensionamento de pool com a qual isso interage.
- **"Menos peças móveis" não significa "um banco de dados".** A
  configuração recomendada para os três adaptadores é um banco de dados
  lógico *separado* para cada um (fila, cache, cable); significando que
  uma aplicação Rails 8 do zero vem com quatro bancos de dados
  configurados (primário + três), cada um com seu próprio caminho de
  migration e sua própria entrada em `database.yml`, e sua própria
  história de capacidade/backup. Ainda são menos superfícies operacionais
  do que Redis-mais-Sidekiq-mais-um-broker-pubsub-separado, mas também
  não é zero superfície nova.

## Documentation Links

- [rails/solid_queue, README](https://github.com/rails/solid_queue) (doc)
- [rails/solid_cache, README](https://github.com/rails/solid_cache) (doc)
- [rails/solid_cable, README](https://github.com/rails/solid_cable) (doc)
- [Rails 8.0: No PaaS Required, rubyonrails.org](https://rubyonrails.org/2024/11/7/rails-8-no-paas-required) (doc)
- [Introducing Solid Queue, 37signals Dev](https://dev.37signals.com/introducing-solid-queue/) (doc)
- [Solid Cache, 37signals Dev](https://dev.37signals.com/solid-cache/) (doc)
- [Ruby on Rails 8.0 Release Notes, Rails Guides](https://guides.rubyonrails.org/8_0_release_notes.html) (doc)
