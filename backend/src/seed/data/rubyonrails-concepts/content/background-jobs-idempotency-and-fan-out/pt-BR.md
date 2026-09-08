---
version: 1.0
updatedAt: 2026-08-17
title: "Jobs em Segundo Plano: Idempotência, Fan-out/Fan-in e Escolha de Fila"
summary: Por que o recurso de unicidade embutido em uma fila não é uma garantia de correção, como dividir jobs por duração, e quando uma fila apoiada em Redis vence uma apoiada em Postgres.
---
## Objective

Jobs em segundo plano falham, tentam de novo, e às vezes rodam duas vezes;
essa é a condição normal de operação de qualquer fila, não um caso de
borda. Idempotência (um job que é seguro de rodar mais de uma vez), separar
jobs por duração para que os lentos não bloqueiem os rápidos, e escolher o
backend de fila certo para a carga de trabalho são as três decisões que
determinam se um sistema de jobs continua confiável sob condições reais de
falha de produção.

## Use Cases

- Escrever um job que é seguro de rodar duas vezes: o pagamento cobrado
  duas vezes, o email enviado duas vezes, os bugs de registro duplicado que
  vêm de uma fila tentando de novo um job que na verdade teve sucesso mas
  falhou em confirmar isso.
- Decidir entre construir uma garantia de "rode isso só uma vez" você mesmo
  com um lock de banco de dados, versus confiar no recurso de unicidade
  embutido de uma biblioteca de fila.
- Dividir uma carga de trabalho mista (alguns jobs de 100ms, alguns de 10
  segundos) em filas separadas para que os rápidos não fiquem presos atrás
  dos lentos.
- Escolher entre uma fila apoiada em SQL e uma apoiada em Redis quando
  durabilidade e vazão puxam em direções diferentes.

## Deep Dive

### Idempotência via lock de linha, não um recurso de fila

```ruby
class ProcessRefundJob
  def perform(order_id)
    order = Order.find(order_id)
    order.with_lock do
      return if order.refund_processed?
      order.process_refund!
      order.update!(refund_processed: true)
    end
  end
end
```

`with_lock` pega um lock de banco de dados em nível de linha durante o
bloco, tornando a sequência "verifique, depois aja" atômica mesmo se o
mesmo job rodar concorrentemente (uma retentativa competindo com a
tentativa original, por exemplo). Essa é uma garantia de idempotência mais
confiável do que o recurso embutido de "job único" de uma biblioteca de
fila; esses são geralmente de melhor esforço, não algo para depender quando
correção genuinamente importa (uma cobrança duplicada). Recorra aos
recursos de throttling de uma biblioteca de fila quando o objetivo é de
fato limitar taxa, não unicidade; eles resolvem um problema diferente.

### Separe filas por duração de job

```ruby
class TranscodeVideoJob
  include Sidekiq::Job
  sidekiq_options queue: "slow"
end

class SendWelcomeEmailJob
  include Sidekiq::Job
  sidekiq_options queue: "fast"
end
```

Misturar uma transcodificação de vídeo de 10 segundos e um envio de email
de 100ms na mesma fila significa que o email espera atrás de quantas
transcodificações estiverem na frente dele; o job rápido herda a latência
do job lento. Pools de worker separados e dimensionados apropriadamente por
fila (mais workers em `fast`, menos em `slow`) corrigem isso sem nenhuma
mudança nos próprios jobs.

### Fan-out / fan-in: transformando trabalho serial em trabalho paralelo

```ruby
class GenerateReportJob
  def perform(report_id)
    item_ids = Report.find(report_id).item_ids
    item_ids.each { |id| GenerateItemStatsJob.perform_async(report_id, id) }
  end
end

class GenerateItemStatsJob
  def perform(report_id, item_id)
    ItemStats.compute_and_store(item_id)
    ReduceReportJob.perform_async(report_id) if Report.find(report_id).all_items_done?
  end
end
```

Um pipeline de três estágios (fan out do trabalho por item, depois fan back
in quando tudo termina) transforma um job serial O(n) em O(n /
worker_count), limitado por quantos workers estiverem disponíveis. Custa
complexidade real de coordenação (saber quando "todos os itens terminaram"
é verdade) em troca desse paralelismo.

### Escolhendo um backend de fila

```
Sidekiq (Redis)  - citado como 20-25x a vazão de uma fila estilo Resque em
                    trabalho pesado em I/O, via threading real. Nenhuma garantia
                    ACID vinda do próprio Redis.
Que (Postgres,
 advisory locks) - troca vazão pelas garantias ACID do mesmo banco de dados onde
                    os dados da sua aplicação já vivem; um job enfileirado na
                    mesma transação que os dados dos quais depende ou os dois
                    fazem commit ou nenhum faz.
```

O próprio datastore da fila deveria viver no mesmo datacenter que os
workers; a mesma penalidade de ida e volta de rede (50 a 80ms) que se aplica
a qualquer banco de dados remoto se aplica aqui também, e aparece
diretamente como latência de job.

## Trade-offs

- **O recurso de "job único" de uma biblioteca de fila é de melhor
  esforço, não uma garantia de correção**: para qualquer coisa onde uma
  execução duplicada é um problema real (cobrar dinheiro, enviar uma ação
  irreversível), um lock em nível de banco de dados é o mecanismo
  confiável, não uma flag de conveniência em nível de fila.
- **Uma fila apoiada em Redis troca garantias ACID por vazão; uma fila
  apoiada em Postgres troca vazão por consistência com o resto dos dados
  da aplicação**: a escolha certa depende de se perda/duplicação de job ou
  latência de job é o modo de falha mais caro para aquele job específico.
- **`Timeout` (o módulo de timeout da biblioteca padrão do Ruby) não é
  confiável para limitar o tempo de execução de um job**: ele funciona
  levantando uma exceção em um ponto arbitrário da execução de outra
  thread, o que pode deixar as coisas em um estado inconsistente; a opção
  nativa de timeout da própria biblioteca ou API é o limite mais seguro.

## Documentation Links

- [Active Job Basics, Rails Guides](https://guides.rubyonrails.org/active_job_basics.html) (doc)
- [Sidekiq, Best Practices](https://github.com/sidekiq/sidekiq/wiki/Best-Practices) (doc)
- [The Complete Guide to Rails Performance, Backgrounding Work](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
