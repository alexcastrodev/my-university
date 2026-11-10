---
title: "Hydra: ordenação na rede sem serialização para aplicações distribuídas fortemente consistentes"
summary: O Hydra troca o sequenciador único de rede de sistemas como NOPaxos e Eris por vários sequenciadores ativos, combinando números de sequência por sequenciador, relógios fracamente sincronizados e mensagens de flush para manter as mesmas garantias de ordenação e de detecção de perdas.
researchArea: Sistemas distribuídos
keywords: ordenação na rede, sequenciadores, groupcast, replicação de máquina de estados, transações distribuídas, switches programáveis, relógios fracamente sincronizados
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

O [NOPaxos](/papers/nopaxos-replacing-consensus-with-network-ordering) e o [Eris](/papers/eris-coordination-free-consistent-transactions) levaram a ordenação das operações para a rede: um sequenciador, em geral um switch programável, carimba cada pedido, e os receptores processam os pedidos na ordem dos carimbos e percebem lacunas. O problema é a serialização. Todo o tráfego precisa passar por um único dispositivo, o que limita a escala, restringe o roteamento e amarra a troca do sequenciador ao reroteamento da rede.

Este artigo do NSDI 2023 pergunta se o sequenciamento na rede funciona sem esse dispositivo único. A resposta é o Hydra, uma primitiva de comunicação em grupo em que vários sequenciadores rodam ao mesmo tempo e os receptores juntam seus fluxos em uma única ordem consistente, com as mesmas garantias das primitivas usadas por NOPaxos e Eris.

Vale conhecer antes: replicação de máquina de estados, o modelo de rede ordenada mas não confiável e por que números de sequência revelam lacunas e timestamps não revelam.

## Contribuição

- **Groupcast com três propriedades.** Mensagens com grupos de destino em comum são entregues em ordem consistente, a entrega é de melhor esforço e, para cada mensagem, ou todos os grupos de destino entregam a mensagem ou uma DROP-NOTIFICATION, ou nenhum entrega.
- **Relógios para a ordem, números de sequência para as lacunas.** Cada sequenciador escreve na mensagem, de forma atômica, o valor do seu relógio e um número de sequência por grupo. Os receptores ordenam pelo relógio, desempatam pelo ID do sequenciador e só entregam uma mensagem quando os valores de relógio recebidos de todos os sequenciadores a alcançam. Nesse ponto, qualquer mensagem que falte aparece como lacuna.
- **Mensagens de flush para o progresso.** Um sequenciador ocioso travaria todos os receptores, então os sequenciadores enviam flushes com seu relógio e seus últimos números de sequência. Os receptores podem pedi-los sob demanda, e switches ToR programáveis podem agregá-los.
- **Failover sem reroteamento.** Um serviço de configuração tolerante a falhas remove um sequenciador suspeito usando quóruns de cada grupo de receptores, então só os receptores se coordenam, não a camada de rede.
- **Dois sistemas.** O HydraPaxos se baseia no NOPaxos e o HydraTxn no Eris. A única mudança é desativar o tratamento de falhas de sequenciador que eles já têm.

## Metodologia

O Hydra roda em P4 em um switch Tofino e em C++ em end hosts, e uma especificação TLA+ do groupcast e da adição e remoção de sequenciadores passa por model checking contra as garantias de segurança. O ambiente de testes tem 10 nós em um único switch, e os vários sequenciadores em switch são feitos particionando-o de forma estática. Os microbenchmarks comparam o Hydra com um atomic multicast dos próprios autores e com uma linha de base sem ordenação. A replicação roda em três réplicas contra Paxos, Fast Paxos e NOPaxos. As transações rodam em 15 shards de três réplicas com YCSB+T de um único shard, contra Lock-Store, Granola e Eris. O Hydra usa dois sequenciadores, e NOPaxos e Eris usam um. O balanceamento de carga é simulado no NS3 em uma FatTree de 2560 servidores, e no teste de failover o reroteamento do Eris é um atraso simulado de 100 ms.

## Resultados

Estes são os resultados informados pelos autores.

- **Contra atomic multicast.** Com um grupo de três receptores e dois sequenciadores em switch, 378% mais vazão e 42% menos latência. Crescer o grupo até nove custou ao Hydra 8% de vazão e nenhuma latência.
- **Contra multicast sem ordenação.** Uma penalidade de 3 μs de latência e vazão a menos de 39% na configuração de três receptores.
- **Escala de sequenciadores.** A vazão cresce linearmente até oito sequenciadores em switch emulados, passando de 250 milhões de groupcasts por segundo, e de forma quase linear com sequenciadores em end host.
- **HydraPaxos.** 204% mais vazão que Paxos e 180% mais que Fast Paxos, com latência a menos de 5 μs e vazão a menos de 17% do NOPaxos.
- **HydraTxn.** 3,1× e 1,9× a vazão de Lock-Store e Granola, e 47% mais que o Eris, cujo sequenciador único é o gargalo.
- **Efeitos na rede, em simulação.** Um único sequenciador em ToR saturou vários enlaces de agregação, enquanto oito mantiveram todos os enlaces de núcleo e de agregação abaixo de 50%.
- **Failover.** Depois de um timeout de 30 ms, remover o sequenciador levou algumas centenas de microssegundos. A introdução resume o ganho como 5× menos tempo fora do ar.
- **Desvio de relógio.** Um desvio de 200 μs somou menos de 100 μs de latência, e a vazão não mudou.

## Análise crítica

O Hydra faz o que se propõe: vários sequenciadores, nenhuma coordenação entre eles no caminho crítico e as garantias das primitivas anteriores.

O próprio artigo admite estes custos:

- **Cada sequenciador é um ponto de parada.** Perder um deles para alguns ou todos os receptores até a reconfiguração, e mais sequenciadores significam mais falhas. O Hydra encurta a interrupção, não a elimina.
- **O tráfego de flush cresce com os sequenciadores.** Os flushes necessários por mensagem crescem linearmente, a menos que switches ToR os agreguem.
- **O desempenho é próximo ao da serialização, não igual.** O HydraPaxos fica 17% abaixo do NOPaxos em vazão, o que a introdução chama de "marginal performance cost".

O restante é uma leitura da avaliação:

- **A escala de sequenciadores é quase dada pelo experimento.** Os oito sequenciadores são emulados em um único switch, cada um limitado a 10 Gbps, com carga de grupos virtuais descartada na saída. Os 250 milhões medem a capacidade de carimbar, e esses sequenciadores não falham nem derivam de forma independente.
- **Os 47% sobre o Eris refletem um gargalo escolhido.** Essa execução também limita a taxa dos sequenciadores, e o artigo observa que sequenciadores em switch sustentam taxas muito maiores que as réplicas em servidores.
- **As transações são de um único shard.** Os números do HydraTxn não exercitam transações com vários shards nem acordo sobre perdas entre shards.
- **Os efeitos na rede não são medidos em hardware.** O sequenciador único da simulação fica em um ToR, embora o artigo diga que trabalhos anteriores pensavam em switches na raiz. A Seção 7.5 não mostra como os 5× são obtidos.
- **A verificação para no groupcast.** O modelo TLA+ trata cada grupo de receptores como uma entidade única, então a composição com NOPaxos e Eris é argumentada, não verificada.

## Pesquisas futuras

- Como o Hydra se comporta com sequenciadores em switches fisicamente separados, deriva real de relógio e carga completa chegando a receptores reais.
- Como transações com vários shards se saem quando o acordo sobre perdas precisa atravessar shards e sequenciadores.
- Quais timeouts de falha funcionam em produção, dado que uma falsa suspeita remove um sequenciador saudável.
- Se a entrega pode continuar para grupos não afetados por um sequenciador que falhou.
- Provas verificadas por máquina do Hydra composto com NOPaxos e Eris.
- Se juntar sequenciadores pelo relógio serviria a shared logs, que o artigo contrasta com o seu projeto por meio do [Scalog](/papers/scalog-seamless-reconfiguration-and-total-order).
