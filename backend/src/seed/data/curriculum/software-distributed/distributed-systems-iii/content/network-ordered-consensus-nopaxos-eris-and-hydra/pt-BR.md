---
version: 1.0
updatedAt: 2026-11-04
title: "Consenso Ordenado pela Rede: NoPaxos, Eris e Hydra"
summary: "Levar a ordenação para a rede e deixar a entrega confiável na aplicação: o multicast ordenado e não confiável do NOPaxos, os multi-stamps do Eris para transações entre shards e o Hydra, que combina relógios e números de sequência para dispensar um ponto único de serialização, sempre dentro de um datacenter."
---
## Objetivos de Aprendizagem

- Explicar o ordered unreliable multicast e por que ordenar sem garantir entrega é barato, enquanto ordenar garantindo entrega não é.
- Acompanhar o caso normal do NOPaxos e o seu gap agreement num número de sequência concreto.
- Explicar por que nem um contador global nem um contador por shard servem para transações, e como o multi-stamp do Eris resolve os dois problemas.
- Aplicar a regra de entrega do Hydra a um trace de dois sequenciadores, e dizer pelo que cada projeto continua pagando.

## Contexto e Motivação

`the-replicated-state-machine-approach` dividiu a replicação em Agreement e Order, e `paxos-the-original-consensus-protocol` resolveu os dois no protocolo, porque assume uma rede que pode perder ou reordenar qualquer coisa. `deterministic-transactions-calvin` levou o acordo para antes dos locks, com um sequenciador em software trabalhando em épocas de 10 ms.

Os papers aqui movem parte do trabalho para baixo da aplicação. Um atomic broadcast na rede tornaria a replicação trivial, mas ele equivale a consenso e só muda o custo de lugar. Então a pergunta é qual parte do trabalho sai barata para a rede, dentro de um datacenter, onde um dispositivo no caminho carimba um pacote em microssegundos.

## Teoria Central

### NOPaxos: ordem sim, confiabilidade não

O [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) (OSDI 2016) divide a replicação em duas propriedades: ordenação (se alguma réplica processa a antes de b, nenhuma processa b antes de a) e entrega confiável (uma requisição é processada por todas as réplicas ou por nenhuma). Só a ordenação vai para a rede, por meio do **ordered unreliable multicast** (OUM):

```text
Assincronia:      sem limite para a latência de entrega.
Não confiável:    nenhuma mensagem tem chegada garantida.
Ordenado:         quem recebe m e m' os recebe na mesma ordem.
Detecção de drop: cada receptor recebe m ou um DROP-NOTIFICATION,
                  ou nenhum receptor recebe um ou outro.
```

Todos os pacotes de um grupo passam por um sequenciador, que escreve um contador em cada um. Os receptores descartam o que chega fora de ordem e tratam um buraco como drop. O contador precisa subir exatamente de 1 em 1, porque um timestamp até cresceria, mas não revelaria um buraco. Um número de sessão cobre a falha do sequenciador, e quando a sessão termina os receptores recebem SESSION-TERMINATED.

Agora as réplicas só precisam concordar sobre quais requisições executar e quais pular:

```text
Caso normal: o cliente faz multicast; toda réplica registra e responde;
  só o líder executa. O cliente espera f + 1 respostas iguais, incluindo
  a do líder. Um round trip, sem mensagens entre réplicas.
Gap agreement: um não líder busca a requisição perdida com o líder.
  Se o líder não a tem, ele faz commit de um NO-OP naquele slot
  (GAP-COMMIT) e espera f respostas.
View change: troca o líder ou passa para uma nova sessão.
```

O Paxos precisa de 4 atrasos de mensagem e 2n mensagens no gargalo. O NOPaxos precisa de 2 de cada, e de uma maioria simples, onde Fast Paxos e Speculative Paxos precisam de quóruns maiores.

### Eris: ordem entre shards

O NOPaxos ordena um grupo de réplicas. O [Eris](/papers/eris-coordination-free-consistent-transactions) (SOSP 2017) mira um banco particionado, em que os shards veem transações diferentes e ainda assim precisam aplicar as compartilhadas de forma consistente. Seu sequenciador mantém um contador por grupo de destino, incrementa atomicamente os de uma mensagem e escreve o conjunto de contadores no pacote como um **multi-stamp**. O Exemplo 2 mostra por que os dois esquemas mais simples falham.

O modelo de transação é o que torna isso suficiente. Uma transação independente é um procedimento one-shot sem dependências de dados entre shards, em que cada shard chega sozinho à mesma decisão de commit. Executar essas transações em sequência em cada shard, na ordem dos carimbos, é serializável, então o caso normal é um round trip: o cliente espera uma maioria de cada shard, incluindo o Designated Learner, a única réplica que executa de forma síncrona. A aplicação continua dona da confiabilidade, por meio de um Failure Coordinator replicado que recupera ou descarta de vez transações perdidas. Transações gerais ficam em cima disso: uma transação preliminar reúne leituras e pega locks, e uma conclusiva faz o commit. Conjuntos de leitura e escrita desconhecidos usam consultas de reconhecimento, como no Calvin.

### Hydra: ordem sem ponto de serialização

Os dois projetos roteiam todo o tráfego por um único dispositivo, o que limita a vazão, restringe o roteamento e amarra a troca de sequenciador ao reroteamento da rede. O [Hydra](/papers/hydra-serialization-free-network-ordering) (NSDI 2023) roda vários sequenciadores ao mesmo tempo e dá as mesmas garantias. Contadores independentes sozinhos falham: dois sequenciadores podem escrever o mesmo número, e desempatar pelo ID do sequenciador deixa um receptor sem como notar a perda da mensagem que viria antes.

Por isso o Hydra usa dois dados, cada um para o que sabe fazer. **Relógios dão a ordem**: cada sequenciador carimba seu relógio, sincronizado de forma frouxa, e os receptores ordenam por (relógio, ID do sequenciador). **Números de sequência detectam buracos**: cada sequenciador mantém contadores por grupo. Um receptor acompanha o maior relógio visto de cada sequenciador e só entrega uma mensagem quando ela está no mínimo desses valores ou abaixo dele (`cmin`). Até lá, qualquer perda já apareceu como buraco. O skew de relógio pode atrasar a entrega, mas a segurança só exige relógios que não andem para trás.

Um sequenciador ocioso travaria todos os receptores, então os sequenciadores enviam mensagens de **flush** com seu relógio e seus últimos números de sequência. Um sequenciador que falhou também trava os receptores até que um serviço de configuração o remova, com quóruns de cada grupo receptor concordando sobre seus últimos números. O failover envolve só os receptores, não a rede.

### O que mudou de lugar, e o que ficou

```text
             A rede faz                     A aplicação ainda faz
NOPaxos      ordem total por grupo          gap agreement, view changes
Eris         ordem parcial entre shards     recuperar drops via FC, épocas,
                                            locks em transações gerais
Hydra        o mesmo, com N sequenciadores  o mesmo, mais flushes e
                                            remoção de sequenciador
```

O consenso não desaparece: o controlador SDN do NOPaxos é replicado com Paxos, e o Failure Coordinator do Eris também é replicado. A coordenação sai do caminho comum.

### Números e suas condições

- **NOPaxos.** Vazão a até 2% e latência a até 16 µs do sistema sem replicação, num middlebox Cavium com cinco réplicas. Latência de 111 µs contra 240 µs do Paxos. Depois de uma falha de sequenciador simulada avisando o controlador, a operação voltou em cerca de 110 ms e a vazão de pico em 270 ms. O hardware para um sequenciador dentro do switch ainda não estava disponível em 2016, então esse projeto ficou sem medição ali.
- **Eris.** 221K transações new-order TPC-C por segundo, 7,6× o Lock-Store, em 15 shards de 3 réplicas, com o particionamento do H-Store, que torna todas as transações independentes. Os 35× vêm da execução mais enviesada de uma carga própria. A capacidade do sequenciador foi de 6,19M pacotes por segundo no middlebox.
- **Hydra.** Num switch Tofino com dois sequenciadores e três réplicas, o HydraPaxos tem latência a até 5 µs e vazão a até 17% do NOPaxos. O HydraTxn consegue 47% a mais que o Eris numa execução que limita a taxa dos sequenciadores e usa transações de um só shard.

## Exemplos Resolvidos

### Exemplo 1: um gap do NOPaxos na sequência 6

Três réplicas (f = 1), líder R0. O sequenciador carimba as requisições de 1 a 7. A requisição 4 se perde a caminho de R1. A requisição 6 (`SET a=6`) se perde a caminho de R0.

```text
seq 4: R1 vê 5 depois de 3 -> DROP-NOTIFICATION
       R1 busca 4 com o líder. Sem rodada de acordo.
seq 6: R0 vê 7 depois de 5 -> DROP-NOTIFICATION
       Respostas até aqui: R1, R2. Sem a do líder, cliente não terminou.
       R0 registra NO-OP, envia GAP-COMMIT(6)
       R1, R2 sobrescrevem 'SET a=6' com NO-OP e respondem
       R0 tem f = 1 resposta, passa para 7
retry: o cliente reenvia e recebe a seq 8

Todos os logs: a=1 b=2 a=3 c=4 b=5 NO-OP d=7 a=6
```

Duas réplicas tinham a requisição e ela foi descartada mesmo assim, com segurança, porque o cliente nunca teve a resposta do líder. Como otimização, o líder pode antes pedir uma cópia às outras réplicas.

### Exemplo 2: três jeitos de numerar T1{A,B}, T2{B,C}, T3{A,C}, T4{A,B,C}

```text
Um contador global, enviado só aos participantes:
  A recebe 1 3 4 sem nada perdido.
  O 2 é um drop ou uma mensagem para outros shards? A não sabe dizer.

Um sequenciador por shard:
  A ordena T1 antes de T4, B ordena T4 antes de T1. Um ciclo.

Multi-stamp:
  T1 {A:1, B:1}   T2 {B:2, C:1}   T3 {A:2, C:2}   T4 {A:3, B:3, C:3}
  T3 perdida em A: A recebe 1, 3 e sabe que falta o número 2.
  O shard C registrou T3 como C:2, então a transação pode ser recuperada.
```

Cada receptor ganha um contador próprio sem buracos, e o incremento atômico ordena quaisquer duas transações que compartilhem um shard.

### Exemplo 3: a regra de entrega do Hydra

Este é o trace da Figura 1 do paper do Hydra, rodado num receptor do grupo 1. Cada entrada mostra (sequenciador, seu número para o grupo 1, relógio), e F é um flush.

```text
Entrada               cmin      buffer   entregue
M1 (1, 1, 42)         (0,2)     M1       -
M2 (2, 1, 42)         (42,1)    M2       M1
F1 (1, 3, 80)         (42,2)    -        DROP(seq 1, #2), M2
M3 (2, 2, 85)         (80,1)    M3       -
M4 (2, 4, 90)         (80,1)    M3 M4    DROP(seq 2, #3)
F2 (1, 3, 98)         (90,2)    -        M3, M4
```

M1 espera evidência do sequenciador 2. O número 3 de F1 revela que o #2 se perdeu. M3 espera porque o sequenciador 1 só chegou ao relógio 80. Se o sequenciador 1 não enviar mais nada depois de M1, M2, M3 e M4 ficam no buffer, e é por isso que um sequenciador ocioso ou caído é um ponto de parada.

## Equívocos Comuns e Armadilhas

- **"O NOPaxos substitui o consenso."** Ele substitui a coordenação no caminho comum. Gap agreement, view changes e o controlador continuam, e a segurança depende de as garantias do OUM valerem.
- **"Ordenar na rede sai de graça."** Os 16 µs e os 2% vêm de um middlebox num testbed de um datacenter. O sequenciador dentro do switch, que deveria custar menos, ficou sem medição nesse paper.
- **"O Eris não tem coordenação."** Isso descreve o caso normal de transações independentes. Uma falha de sequenciador para réplicas em todos os shards para uma troca de época.
- **"O Hydra elimina o problema de falha do sequenciador."** Ele encurta a interrupção. Todo sequenciador é um ponto de parada, e mais sequenciadores significam mais falhas.

## Resumo

Esses projetos entregam a ordenação à rede, onde um contador num pacote é barato, e mantêm a entrega confiável na aplicação. O NOPaxos reduz a replicação a decidir quais slots pular. O Eris estende a ordem entre shards com multi-stamps, para transações que cabem no modelo independente. O Hydra remove o dispositivo único ao ordenar com relógios e detectar drops com números por sequenciador, ao preço de tráfego de flush e de alguma vazão em relação à serialização. Os três mantêm um caminho lento para drops e falhas, e os três assumem um datacenter cuja rede o operador controla.

## Documentation Links

- [Li et al.: Just Say NO to Paxos Overhead: Replacing Consensus with Network Ordering (OSDI 2016)](https://www.usenix.org/system/files/conference/osdi16/osdi16-li.pdf): o OUM, as implementações de sequenciador, o protocolo NOPaxos e sua avaliação.
- [Li, Michael and Ports: Eris: Coordination-Free Consistent Transactions Using In-Network Concurrency Control (SOSP 2017)](https://syslab.cs.washington.edu/papers/eris-sosp17.pdf): multi-sequencing, transações independentes e gerais, e o Failure Coordinator.
- [Choi et al.: Hydra: Serialization-Free Network Ordering for Strongly Consistent Distributed Applications (NSDI 2023)](https://www.usenix.org/system/files/nsdi23-choi.pdf): múltiplos sequenciadores, a regra de entrega com relógio e número de sequência, flushes e failover.
