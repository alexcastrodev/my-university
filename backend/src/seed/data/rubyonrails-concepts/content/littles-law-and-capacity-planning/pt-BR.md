---
version: 1.0
updatedAt: 2026-08-18
title: "A Lei de Little e Planejamento de Capacidade"
summary: instances_needed = arrival_rate x average_response_time, a única equação por trás do dimensionamento de frota, por que 100% de utilização é um incidente esperando uma explosão de tráfego, e por que tempo de fila (não tempo de resposta) é o único sinal honesto para escalar.
---
## Objective

Planejamento de capacidade para uma frota Rails não é um chute; é uma
equação da teoria de filas. A **Lei de Little** diz que o número de
instâncias de aplicação que você precisa é a taxa de chegada multiplicada
pelo tempo médio de resposta:

```
instances_needed = arrival_rate × average_response_time
```

Tudo o mais em escalonamento decorre disso: o que "utilização" de fato
significa, por que rodar a 100% da capacidade teórica é um sintoma de
sobrecarga crônica em vez de eficiência, por que um endpoint
patologicamente lento corrompe a matemática da frota *inteira*, e por que o
único sinal honesto para adicionar instâncias é o **tempo de fila**, não o
tempo de resposta.

## Use Cases

- Decidir quantas instâncias web (dynos, pods, containers) um dado nível de
  tráfego de fato exige, em vez de escalar no feeling depois de um
  incidente.
- Escolher uma utilização alvo: quanta folga comprar contra picos de
  tráfego, e quanto essa folga custa.
- Decidir se um endpoint lento é "só lento" ou está ativamente contaminando
  a matemática de escalonamento de todo outro endpoint que compartilha as
  mesmas instâncias.
- Dimensionar uma frota de workers em segundo plano, onde a mesma lei se
  aplica, mas a entrada é profundidade de fila em vez de duração de job.
- Ler corretamente um gráfico de "tempo de fila" em um APM, incluindo saber
  o que essa métrica consegue e não consegue enxergar.

## Deep Dive

### A lei, e o que "utilização" significa

Taxa de chegada e tempo de resposta precisam estar em unidades
correspondentes. A 100 requisições por segundo com um tempo médio de
resposta de 100ms (0,1s):

```
instances_needed = 100 req/s × 0.1 s = 10 concurrent request slots
```

Esse "10" é o *mínimo teórico*: o número de slots que estariam ocupados
100% do tempo se as requisições chegassem perfeitamente uniformes. A
**utilização** é o quanto da sua capacidade provisionada esse mínimo
consome. Rode 10 slots e você está a 100% de utilização; rode 200 slots e
você está a 5%.

O livro cita três frotas reais para ancorar a faixa:

```
Twitter (2007)  ~100%  - sobrecarga crônica; a era da Fail Whale
Shopify           ~5%  - deliberadamente, caramente superprovisionado
Envato           ~37%  - citado como um bom equilíbrio
```

### Por que 100% de utilização é um modo de falha, não uma vitória

A Lei de Little descreve uma *média de longo prazo*. Tráfego real não
chega de forma uniforme; chega em rajadas, e tempos de resposta têm uma
cauda longa. A 100% de utilização não há folga nenhuma para absorver
nenhum dos dois. No momento em que a taxa de chegada excede a média mesmo
que brevemente, requisições não têm para onde ir além de uma fila, e como
os servidores já estão saturados, a fila nunca tem chance de esvaziar. A
fila cresce sem limite até o tráfego cair, que é exatamente o que "o site
está fora do ar" parece de fora.

No outro extremo, 5% de utilização significa que 95% do dinheiro gasto em
instâncias não compra nada exceto seguro contra a cauda. Essa é uma compra
legítima e deliberada (a Shopify a compra de propósito para picos de
liquidação relâmpago), mas *é* uma compra. Algo em torno de um terço da
capacidade em uso costuma ser o ponto ideal: folga suficiente para que uma
rajada faça fila brevemente e depois esvazie, sem pagar por vinte vezes a
necessidade em estado estável.

### A regra de 4:1: mantendo a distribuição de tempo de resposta uniforme

A Lei de Little usa um único tempo de resposta *médio* para a aplicação
inteira, e então você escala a contagem de instâncias para a frota
inteira. Isso só funciona se os tempos de resposta forem aproximadamente
distribuídos uniformemente. Duas regras práticas mantêm isso assim:

```
per endpoint:   p95 ≤ 4 × that same endpoint's own mean
across the app: no endpoint's mean > 4 × the application's overall mean
```

Um endpoint fora de qualquer um dos limites contamina a matemática de
escalonamento compartilhada. Se a média da aplicação inteira é 100ms mas
um endpoint de relatório tem média de 2s, as instâncias que por acaso
pegarem requisições de relatório ficam ocupadas 20x mais tempo do que a
média assume; então o número "instances_needed" da frota inteira subconta
a ocupação real, e requisições para endpoints *não relacionados e rápidos*
fazem fila atrás do lento. A correção não é mais instâncias; é ou tornar
aquele endpoint rápido, ou movê-lo para fora da frota compartilhada (um
pool de instância separado, ou um job em segundo plano) para que sua
distribuição de tempo de resposta pare de poluir a de todo mundo.

### Workers em segundo plano: dimensione por profundidade de fila, não duração de job

A mesma lei governa frotas Sidekiq/Resque/Solid Queue, mas a entrada útil
muda. Durações de job variam por ordens de magnitude entre filas, então um
tempo médio de job fica próximo de sem sentido. **Profundidade de fila** (o
backlog, e se está crescendo ou esvaziando) é o observável direto. Uma
profundidade que tende a zero entre rajadas significa que a frota está
dimensionada corretamente; uma profundidade que sobe continuamente ao
longo de um dia significa que a taxa de chegada excede a taxa de serviço
da frota e você precisa de mais workers (ou jobs mais rápidos),
independente de quão rápido qualquer job individual pareça no dashboard.

### Como uma requisição de fato chega a um dyno

A história de roteamento importa porque determina onde a fila fisicamente
acontece, e portanto o que suas métricas conseguem ver:

```
client
  → load balancer (SSL termination)
  → one of 100+ INDEPENDENT routers, each with its own queue
                 (no coordination between them)
  → RANDOM selection of a web dyno (not "smart"/least-busy routing)
  → up to ~5s waiting for a connection to that dyno
  → the socket backlog ON the dyno
  → an app server worker finally picks it up
```

Roteamento aleatório é o cerne: um roteador não sabe nem se importa que o
dyno que escolheu já está ocupado. Com poucos dynos, uma atribuição
aleatória azarada estaciona uma requisição atrás de uma lenta enquanto
outros dynos ficam ociosos, o que é o motivo de a variabilidade de tempo
de resposta (a regra 4:1 acima) machucar muito mais aqui do que a média
sozinha sugeriria.

### A métrica de tempo de fila, e por que já foi simplesmente errada

O "tempo de fila" de hoje em um APM (New Relic e companhia) é calculado a
partir do header `REQUEST_START` que o roteador carimba na entrada: a
aplicação subtrai aquele timestamp do seu próprio relógio quando começa a
processar. Isso é uma **diferença de relógio de parede entre duas máquinas
diferentes**, então é inerentemente impreciso em resolução de
milissegundos; trate leituras de dígito único em milissegundos como ruído.

Historicamente era pior que impreciso, era *errado*. O incidente da
RapGenius em 2013 tornou isso público: a métrica na época só contabilizava
fila do lado do **roteador** e era cega para a fila que de fato importava:
requisições sentadas no **socket backlog no próprio dyno**, esperando por
um worker de servidor de aplicação livre. Times liam um gráfico de tempo
de fila plano e saudável enquanto sua fila real era invisível, e concluíam
que sua capacidade estava boa quando não estava.

### O único gatilho honesto para escalar para cima

```
queue time is a small fraction of average response time  →  don't scale
queue time > ~5-10ms relative to average response time   →  add instances
```

Abaixo desse limite, a frota tem capacidade e adicionar instâncias é
dinheiro gasto à toa. Acima dele, requisições estão genuinamente esperando
por um worker livre e mais instâncias reduzem diretamente essa espera.

O ponto complementar é igualmente importante: **uma instância maior não
torna uma única requisição mais rápida.** Dobrar o tamanho de um dyno (ou
o CPU/RAM de um container) permite que ele segure mais workers, o que
reduz a *espera na fila*. O próprio caminho de código leva o mesmo tempo
que sempre levou. Se seu problema é uma action de controller de 2s sem
nenhuma fila atrás dela, nenhuma quantidade de capacidade resolve isso;
esse é um problema de otimização, não um problema de escalonamento.

## Trade-offs

- **Utilização é uma troca direta entre custo e segurança contra
  variância**: os ~5% da Shopify não são incompetência, são seguro
  comprado deliberadamente para tráfego de liquidação relâmpago; os ~100%
  do Twitter não eram eficiência, eram o formato de uma indisponibilidade
  esperando uma rajada. Em torno de um terço é o equilíbrio usual, mas o
  número certo depende de quão irregular sua taxa de chegada genuinamente
  é.
- **Isolar um endpoint lento em seu próprio pool de instância corrige a
  matemática de escalonamento contaminada, mas dobra as frotas que você
  precisa dimensionar, fazer deploy e monitorar**: o movimento inicial mais
  barato geralmente é fazer o endpoint caber dentro do limite de 4:1, ou
  empurrar seu trabalho para um job em segundo plano, e só dividir o pool
  quando não puder ser tornado rápido.
- **Escalar instâncias e otimizar tempo de resposta são duas alavancas
  válidas na mesma equação, e o tempo de fila é o que diz qual delas você
  de fato está faltando**: mas ler esse sinal significa confiar em uma
  diferença de relógio de parede entre máquinas, então construa a decisão
  sobre uma tendência sustentada, nunca sobre uma leitura ruidosa em escala
  de milissegundos.
- **Dimensionar workers por profundidade de fila reage ao backlog real,
  mas é um sinal defasado**: no momento em que a profundidade está
  visivelmente crescendo, jobs sensíveis à latência naquela fila já estão
  atrasados, que é o argumento para filas separadas por classe de latência
  em vez de uma fila profunda única dimensionada pela sua média.

## Documentation Links

- [Heroku Dev Center, HTTP Routing (roteamento aleatório, filas de requisição por roteador)](https://devcenter.heroku.com/articles/http-routing) (doc)
- [Speedshop, Scaling Ruby Apps to 1000 Requests per Minute (a Lei de Little na prática)](https://www.speedshop.co/blog/scaling-ruby-apps-to-1000-rpm/) (doc)
- [The Complete Guide to Rails Performance, Little's Law and Capacity Planning](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) (doc)
