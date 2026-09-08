---
version: 1.0
updatedAt: 2026-08-17
title: "Observabilidade em Produção: rack-mini-profiler e Orçamentos de APM"
summary: Rodando um profiler com segurança em produção, definindo orçamentos de tempo de resposta que significam algo, e encontrando exceções escondidas dentro de respostas 200 OK.
---
## Objective

Adivinhar onde uma aplicação Rails gasta seu tempo não escala além de um
punhado de requisições. O `rack-mini-profiler` rodando em produção (com
segurança, atrás de autenticação) e um APM com orçamentos realistas de
tempo de resposta são o que transforma "a aplicação parece lenta" em uma
linha de código específica ou uma query específica; a ferramenta de maior
alavancagem que a maioria das aplicações Rails subutiliza é um profiler que
de fato está rodando onde os dados reais e o tráfego real vivem, não só em
desenvolvimento contra um punhado de registros de seed.

## Use Cases

- Encontrar a query, a renderização de template, ou a alocação de memória
  real por trás de uma página lenta, não só saber que a página em geral é
  lenta.
- Definir um orçamento realista de tempo de resposta para um APM alertar
  contra, em vez de um limite arbitrário.
- Pegar exceções sendo silenciosamente levantadas e capturadas durante uma
  requisição que de outra forma seria 200 OK, invisíveis ao rastreamento
  de erro normal, mas um custo real de performance (veja o conceito de
  Exceções como Controle de Fluxo).
- Decidir quando o problema de um endpoint lento é de fato externo: uma
  chamada síncrona a uma API de terceiros que deveria ser jogada para
  segundo plano e cacheada.

## Deep Dive

### rack-mini-profiler, com segurança, em produção

```ruby
# app/controllers/application_controller.rb
before_action { Rack::MiniProfiler.authorize_request if params[:rmp] }

# config/initializers/mini_profiler.rb
Rack::MiniProfiler.config.storage = Rack::MiniProfiler::MemoryStore
```

Rodar o profiler só em desenvolvimento perde tudo que só aparece sob
volume real de dados de produção e padrões reais de tráfego: N+1s que não
aparecem com dez registros de seed, renderizações de template que só ficam
lentas depois de um certo tamanho de coleção. Colocá-lo atrás de uma
chamada explícita `authorize_request` (disparada por um parâmetro de query
que só administradores conhecem) o mantém seguro de deixar habilitado em
produção. O armazenamento padrão baseado em sistema de arquivos é lento o
bastante para distorcer as próprias medições que está fazendo;
`MemoryStore` evita isso.

```
?pp=flamegraph        millisecond-by-millisecond flamegraph of the whole request
?pp=profile-memory     allocated vs. retained memory, per line of code
?pp=profile-gc         GC.stat delta across the request, catches abnormal allocation spikes
?pp=trace-exceptions   exceptions raised and silently rescued during a 200 OK request
```

O selo que aparece em toda página por padrão já traz o primeiro sinal, o
mais rápido: contagem de queries SQL (mais de 1 a 3 em uma página simples
vale a pena investigar) e o tempo total em SQL como porcentagem da
requisição.

### Orçamentos de tempo de resposta de APM que significam algo

```
Server response time (HTML app):  < 100ms good · < 300ms okay · > 300ms slow
                                   (halve these thresholds for a JSON-only API)
Browser load time:                < 3s good · < 6s okay · > 6s slow
```

O tempo de resposta do servidor costuma ser só cerca de 10% do que um
usuário de fato experimenta como tempo de carregamento de página; um
alerta de APM ajustado só no tempo de resposta do servidor perde a maioria
do que determina se a página *parece* lenta. Requisições por minuto é um
proxy útil para quando escalar de fato importa: abaixo de aproximadamente
10 req/min, um servidor é suficiente independente de otimização; acima de
aproximadamente 1000 req/min, o gargalo quase sempre se moveu para um
banco de dados ou cache externo, não "adicione outro servidor de
aplicação".

### Encontrando exceções escondidas dentro de respostas 200 OK

```ruby
begin
  ExternalPricingAPI.fetch(sku)
rescue Timeout::Error
  fallback_price(sku)   # request still returns 200, but an exception was raised
end
```

Uma requisição pode retornar `200 OK` mesmo tendo levantado e capturado uma
exceção em algum ponto do caminho; invisível para rastreadores de erro
(nada foi reportado como erro), mas ainda pagando o custo real de
tratamento de exceção (veja o conceito de Exceções como Controle de Fluxo
para o motivo de esse custo ser mensurável). `?pp=trace-exceptions` é a
ferramenta que traz à tona especificamente esse padrão, que nada mais em
uma stack de monitoramento típica captura.

## Trade-offs

- **Armazenamento de profiler baseado em sistema de arquivos é lento o
  bastante para distorcer as medições que está fazendo**: sempre troque
  para `MemoryStore` (ou equivalente) antes de confiar em números de
  profiler coletados sob carga real.
- **Tempo de resposta do lado do servidor sozinho é um proxy enganoso para
  velocidade percebida pelo usuário**: um alerta de APM ajustado só nele
  vai perder lentidão dominada pelo front-end (veja os conceitos de
  front-end/rede desta trilha para o que domina os outros ~90%).
- **Um dashboard de estatísticas de GC de um APM geralmente não é
  confiável para um deploy multiprocesso e multithreaded** (Puma em
  cluster, Sidekiq): `rack-mini-profiler` combinado com `memory_profiler` é
  a fonte mais confiável para questões específicas de memória nessa
  configuração.

## Documentation Links

- [rack-mini-profiler, GitHub](https://github.com/MiniProfiler/rack-mini-profiler) (doc)
- [The Complete Guide to Rails Performance, rack-mini-profiler & Performance Monitoring with New Relic](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
