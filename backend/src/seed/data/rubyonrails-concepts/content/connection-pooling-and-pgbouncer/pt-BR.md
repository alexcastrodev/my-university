---
version: 1.0
updatedAt: 2026-08-17
title: "Connection Pooling e a Matemática do pgbouncer"
summary: A aritmética de processos x threads x hosts que seu pool de banco de dados precisa caber, por que a sobreposição no momento do deploy é o risco real, e como o tamanho do pool no pgbouncer significa algo diferente.
---
## Objective

O pool de conexões de banco de dados de uma aplicação Rails é limitado por
uma aritmética simples (processos × threads × hosts) que precisa caber
dentro do que quer que o plano do Postgres de fato permita, incluindo
exatamente no momento em que um deploy roda brevemente dynos antigos e
novos lado a lado. Errar essa conta aparece como
`ActiveRecord::ConnectionTimeoutError` intermitente sob carga, e adicionar
o `pgbouncer` na frente muda a conta de novo de uma forma fácil de inverter
por engano.

## Use Cases

- Dimensionar `RAILS_MAX_THREADS` (que define o tamanho do pool) contra o
  limite real de conexões do banco de dados, levando em conta a
  sobreposição no momento do deploy.
- Decidir se o `default_pool_size` do pgbouncer deveria ser calculado a
  partir da contagem de threads ou do teto de conexões do plano; esses dão
  números bem diferentes e fáceis de confundir.
- Diagnosticar um gargalo de pool de conexões a partir de dados de APM
  antes de se tornar visível como timeouts voltados ao usuário.
- Entender o trade-off real que `pool_mode: transaction` faz (prepared
  statements) antes de ligá-lo para sobreviver a um aperto de conexões.

## Deep Dive

### A matemática base, e por que deploys são o momento arriscado

```ruby
# config/database.yml
production:
  pool: <%= ENV.fetch("RAILS_MAX_THREADS", 5) %>
```

O tamanho padrão do pool de conexões do Rails é igual a
`RAILS_MAX_THREADS`: uma conexão reservada por thread. O total possível de
conexões através da frota é `processos × threads × hosts`, e esse número
precisa caber sob o limite real do banco de dados (por exemplo, o
"standard-0" do Heroku Postgres tem teto de 120). O número que de fato
importa não é o uso em estado estável; é o pico durante um **deploy com
preboot**, onde dynos antigos e novos rodam brevemente ao mesmo tempo e
podem aproximadamente dobrar a contagem de conexões durante aquela janela.

### pgbouncer: um pool diferente, dimensionado de forma diferente

```ini
# pgbouncer.ini
pool_mode = transaction
default_pool_size = 20
```

`default_pool_size` no pgbouncer é **por instância de pgbouncer**; com uma
instância por dyno (a configuração comum no buildpack do Heroku), a fórmula
certa é:

```
default_pool_size = (plan_connection_limit - deploy_overlap_margin) / active_dyno_count
```

não `threads × processos`. Dimensioná-lo como se fosse o pool do lado
Rails derrota completamente o propósito de adicionar o pgbouncer; o ponto
inteiro é que o pgbouncer multiplexa muitas conexões do lado da aplicação
em menos conexões reais do Postgres.

`pool_mode: transaction` libera uma conexão de banco de dados de volta para
o pool no momento em que uma transação termina, em vez de segurá-la pela
sessão inteira do cliente; isso é o que permite um pool pgbouncer pequeno
atender um número muito maior de threads Rails. O custo real: isso
**desabilita prepared statements**, porque um prepared statement está
vinculado a uma conexão de backend específica, algo que o pooling em modo
transação não garante que você vá receber duas vezes seguidas. Esse é um
trade-off genuíno (um pequeno recurso de performance e de reforço de
segurança), não um almoço grátis.

### Diagnosticando um pool pequeno demais

```
# In APM traces, a growing amount of time spent here is the tell:
ActiveRecord::QueryCache middleware
```

Um pool de conexões pequeno demais sob carga geralmente não aparece
primeiro como um erro óbvio; aparece como o tempo de requisição mudando
silenciosamente para espera por uma conexão, visível no APM como tempo
elevado no middleware `ActiveRecord::QueryCache` (ou equivalente de
checkout de conexão), antes de eventualmente surgir como
`ConnectionTimeoutError` quando a espera excede `checkout_timeout`.

## Trade-offs

- **`pool_mode: transaction` abre mão de prepared statements**: um custo
  real, não uma sutileza de configuração, e vale a pena confirmar que a
  aplicação não depende deles (algumas gems assumem que prepared statements
  estão disponíveis) antes de ligar isso para resolver um aperto de
  conexões.
- **Dimensionar o `default_pool_size` do pgbouncer como `threads ×
  processos` derrota seu propósito**: ele deveria ser dimensionado contra o
  teto real de conexões do banco de dados dividido pela contagem de dynos,
  não espelhado do tamanho do pool do Rails.
- **O número que de fato causa incidentes de produção é o pico no momento
  do deploy, não o uso em estado estável**: um pool dimensionado
  corretamente para tráfego normal ainda pode esgotar o limite de conexões
  do banco de dados durante uma janela de preboot a menos que essa
  sobreposição seja explicitamente orçada.

## Documentation Links

- [Configuring Rails Applications, Database Pooling](https://guides.rubyonrails.org/configuring.html#database-pooling) (doc)
- [PgBouncer, Official documentation](https://www.pgbouncer.org/config.html) (doc)
- [The Complete Guide to Rails Performance, Interacting with (SQL) Databases](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
