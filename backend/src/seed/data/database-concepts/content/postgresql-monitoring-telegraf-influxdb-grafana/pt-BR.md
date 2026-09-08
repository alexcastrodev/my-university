---
version: 1.0
updatedAt: 2026-08-05
title: "Monitoramento com Telegraf, InfluxDB e Grafana"
summary: Um pipeline de monitoramento push-based em que o Telegraf faz polling do PostgreSQL (incluindo SQL customizado arbitrário via o plugin extensível) e envia para o InfluxDB para armazenamento, com o Grafana renderizando dashboards; lag de replication slot, idade de XID até o wraparound e contagens de estado de sessão como as métricas que vale a pena coletar.
---
## Objective

Uma stack de monitoramento precisa que três trabalhos distintos sejam bem feitos: coletar métricas de todo servidor (Telegraf), armazená-las eficientemente como dados de série temporal (InfluxDB), e transformá-las em gráficos e dashboards sobre os quais um humano possa realmente agir (Grafana). Nenhum dos três faz os três trabalhos; cada um é um especialista, e o pipeline é push-based: o Telegraf faz polling no PostgreSQL em um intervalo e empurra o que encontra rio abaixo, em vez de algo alcançar e puxar métricas sob demanda.

## Use Cases

- Observar o lag de um replication slot ao longo do tempo (não só seu valor atual) para ver exatamente quando um standby começou a ficar para trás e por quanto tempo; crítico porque um slot com lag significa que o PostgreSQL está retendo WAL indefinidamente, o que pode esgotar o espaço em disco se passar despercebido.
- Rastrear a idade do transaction ID (XID) em todos os bancos para ter aviso antecipado de um desligamento forçado por wraparound se aproximando, em vez de descobrir isso quando o banco se recusa a aceitar novas transações.
- Construir um painel de "saúde de sessão" ao vivo (contagens de ativo versus idle-in-transaction, consultas rodando além de um limiar) que expõe sintomas de contenção antes que escalem para uma indisponibilidade.
- Estender a cobertura de monitoramento para qualquer coisa expressável como SQL, já que o plugin coletor usado aqui executa consultas arbitrárias em uma programação em vez de ficar limitado a um conjunto fixo de métricas embutidas.

## Deep Dive

### O pipeline: Telegraf → InfluxDB → Grafana

```
PostgreSQL server (pgha1)          Monitoring server (pgmon)
┌─────────────────────┐            ┌───────────┐    ┌─────────┐
│ Telegraf agent       │──push───▶ │ InfluxDB   │◀──│ Grafana │
│ (polls every 10s)    │           │ (time-series store) │  (dashboards)
└─────────────────────┘            └───────────┘    └─────────┘
```

O Telegraf roda em todo nó PostgreSQL monitorado e faz polling localmente (evitando o overhead de uma conexão remota por ciclo de coleta de métrica); o InfluxDB roda centralizado, ingerindo métricas de todo agente Telegraf da frota; o Grafana consulta o InfluxDB para renderizar dashboards. Cada camada pode ser trocada independentemente (Grafana apontado para um backend diferente, ou um coletor diferente alimentando a mesma instância do InfluxDB), porque os estágios do pipeline só concordam em um formato de dados, não em um fornecedor.

### O input básico de PostgreSQL: um ponto de partida, não o teto

```ini
# /etc/telegraf/telegraf.d/pgha1.conf
[[inputs.postgresql]]
  address = "host=pgha1 user=postgres"
  outputaddress = "pgha1"
  max_lifetime = "0s"
  databases = ["pgbench"]
```

`max_lifetime = "0s"` mantém a conexão do Telegraf com o PostgreSQL persistente em vez de reconectar a cada ciclo de polling. Esse plugin embutido dá métricas básicas de conexão/throughput, mas o poder de verdade está na variante *extensível*, que roda SQL arbitrário em uma programação.

### O plugin extensível: monitoramento é só escrever uma consulta

```ini
[[inputs.postgresql_extensible]]
  address = "host=pgha1 user=perf_mon dbname=postgres"
  outputaddress = "pgha1"
  max_lifetime = "0s"
  databases = ["pgbench"]

[[inputs.postgresql_extensible.query]]
  sqlquery = """
    SELECT slot_name,
           pg_wal_lsn_diff(pg_current_wal_insert_lsn(), restart_lsn)::BIGINT AS restart_lsn_lag,
           pg_wal_lsn_diff(pg_current_wal_insert_lsn(), confirmed_flush_lsn)::BIGINT AS confirmed_flush_lag
      FROM pg_replication_slots
  """
  version = 940
  withdbname = false
  tagvalue = "slot_name"
  measurement = "postgresql.slot_lag"

[[inputs.postgresql_extensible.query]]
  sqlquery = """
    SELECT count(*) AS total,
           count(*) FILTER (WHERE state LIKE 'idle in%') AS trans_idle,
           count(*) FILTER (WHERE state = 'active') AS active,
           count(*) FILTER (WHERE wait_event IS NOT NULL) AS waiting,
           count(*) FILTER (WHERE state = 'active' AND now() - state_change > INTERVAL '1s') AS slow
      FROM pg_stat_activity
  """
  version = 960
  withdbname = false
  measurement = "postgresql.sessions"
```

Cada bloco `[[inputs.postgresql_extensible.query]]` é uma consulta SQL completa executada a cada intervalo de polling. `version` controla para quais releases do PostgreSQL a consulta é válida (o Telegraf pula uma consulta em servidores mais antigos do que a versão declarada, escrita como `960` para 9.6.0, não `9.6.0`); `tagvalue` marca qual coluna retornada é um rótulo em vez de uma métrica (aqui, `slot_name`, para que o lag de cada replication slot possa ser filtrado/agrupado independentemente no Grafana); `measurement` nomeia a série de métrica. O usuário de monitoramento só precisa de `pg_read_all_stats`, um papel (role) predefinido, não superusuário, para rodar consultas como a de atividade de sessão contra `pg_stat_activity`.

### Armazenamento e visualização

```
# InfluxDB: a time-series database Telegraf pushes into
# Grafana: points at InfluxDB as a data source (URL, database name, HTTP method),
#          then builds panels by picking a measurement + fields + aggregation
```

O Grafana organiza painéis em dashboards; um painel consulta uma `measurement` (como `postgresql.sessions` acima) e escolhe quais campos plotar, com agregação point-and-click (média, soma, sobre um bucket de tempo) em vez de sintaxe de consulta escrita à mão para o caso comum. As três consultas customizadas mostradas acima mapeiam diretamente para painéis de dashboard que vale a pena ter em qualquer configuração de HA de PostgreSQL: lag de replication slot (risco de esgotamento de disco se ignorado), idade de XID (risco de desligamento por wraparound se ignorado), e contagens de estado de sessão (sintomas de contenção/acúmulo).

## Trade-offs

- **Uma consulta SQL customizada no plugin extensível roda a cada ciclo de polling, em todo servidor monitorado**: uma consulta diagnóstica cara ou que trava locks é aceitável rodar manualmente uma vez, mas rodá-la a cada 10 segundos em toda uma frota é um custo bem diferente; mantenha as consultas do coletor baratas e amigáveis a índices, e reserve diagnósticos mais pesados para uso sob demanda.
- **Replication slots criam uma dependência forte entre monitoramento e segurança de disco**: o lag de um slot não é só uma métrica de desempenho, é retenção de WAL: um lag de slot crescente e não monitorado significa que o PostgreSQL está segurando arquivos de WAL indefinidamente para um standby que pode estar fora do ar, e pode encher o disco. É exatamente por isso que o livro destaca essa métrica como algo que ferramentas genéricas como o Nagios não rastreiam nativamente; ela precisa de um coletor ciente do PostgreSQL.
- **O controle por `version` significa que a mesma métrica conceitual pode precisar de múltiplas variantes de consulta**: uma frota rodando uma mistura de versões do PostgreSQL nem sempre pode compartilhar uma única definição de consulta; uma consulta escrita contra colunas exclusivas do 9.6 (como `wait_event`) simplesmente não vai rodar contra servidores mais antigos, por design, em vez de falhar ruidosamente.
```ini
# same metric, older-version-compatible variant would need to drop wait_event
# and any column/view introduced after the target version
```
- **Livro vs. hoje**: esta receita usa **InfluxDB 1.x** (um "database" `telegraf`, InfluxQL implicitamente, HTTP POST como método de conexão do Grafana); a linha atual do InfluxDB passou por dois redesigns significativos desde então: o **InfluxDB 2.x** substituiu o modelo de database/retention-policy por buckets e autenticação baseada em token, e introduziu o **Flux** como linguagem de consulta principal; o **InfluxDB 3.x** reintroduziu suporte tanto a InfluxQL quanto a **SQL** padrão, junto com uma reescrita do motor de armazenamento para um formato colunar. Nada disso muda o lado de *coleta* do Telegraf (o plugin `postgresql_extensible` e seus blocos de consulta funcionam do mesmo jeito), mas a camada de armazenamento/consulta que esta receita descreve é especificamente o formato da era 1.x. Separadamente, **Prometheus + Grafana** (com o `postgres_exporter` da comunidade) se tornou uma alternativa pull-based amplamente adotada a este pipeline push-based de Telegraf/InfluxDB; vale saber disso como um segundo caminho válido, não uma substituição para a qual a abordagem do livro exige migrar.

## Documentation Links

- [Shaun Thomas, "PostgreSQL 12 High Availability Cookbook", 3rd Edition (Packt, 2020), Chapter 6, "Monitoring", recipes "Installing and configuring Telegraf", "Adding a custom PostgreSQL monitor to Telegraf", "Installing and configuring InfluxDB", "Installing and configuring Grafana", "Building a graph in Grafana", p. 249-268](https://www.packtpub.com/en-us/product/postgresql-12-high-availability-cookbook-9781838984854) - doc
- [Telegraf postgresql_extensible input plugin](https://github.com/influxdata/telegraf/tree/master/plugins/inputs/postgresql_extensible) - doc
- [InfluxDB Documentation](https://docs.influxdata.com/) - doc
- [Grafana Documentation](https://grafana.com/docs/) - doc
- [prometheus-community/postgres_exporter](https://github.com/prometheus-community/postgres_exporter) - doc
