---
title: "Ambulance: salvando o BFT por meio de corridas"
summary: O Ambulance troca os timeouts da replicação de máquina de estados bizantina por uma corrida entre réplicas, em que o líder executa um protocolo mais curto e as demais constroem os certificados de que precisam para a recuperação, de modo que uma lentidão é detectada pela falta de progresso do protocolo, e não por um relógio.
researchArea: Sistemas distribuídos
keywords: tolerância a falhas bizantinas, replicação de máquina de estados, tolerância a lentidões, protocol-rigged racing, hedging, timeouts, assinaturas threshold
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Sistemas de confiança distribuída, como serviços de recuperação de chaves e blockchains, mantêm um log totalmente ordenado com replicação de máquina de estados (SMR) tolerante a falhas bizantinas (BFT), mesmo quando até f de 3f+1 réplicas se comportam mal. Este artigo do OSDI 2026, da UC Berkeley, da Cornell University, da Sei Labs, da University of Stavanger e da Duke University, pergunta o que acontece quando o líder está apenas lento, e não parado. Uma lentidão (slowdown) é uma réplica correta cuja taxa de serviço cai abaixo do normal por causa de travamentos de fsync, coleta de lixo, sincronização de dados ou problemas de rede. Os autores relatam que Sei, etcd e Neo4j já viram lentidões de mais de sete segundos.

O detector usual é o timeout, e os autores o chamam de destrutivo (um agressivo dispara trocas de líder cujas propostas interferem com as do líder antigo) e bloqueante (um conservador deixa o sistema ocioso). Eles relatam padrões de produção entre 2 s e 30 s, e a recomendação de pelo menos dez vezes o tempo de ida e volta. O hedging escalona as propostas com um atraso de tempo, e os protocolos assíncronos deixam todos proporem, mas pagam no caso comum.

Os termos principais são protocol-rigged racing, o certificado sports car (a prova de não equivocação do líder) e o certificado truck (a prova mais lenta de uma réplica), o corte da corrida (race cutoff), o caminho de recuperação e a motorização, que reaproveita a camada de dados do Autobahn para obter throughput. A página da USENIX lista o artigo como vencedor do Distinguished Artifact Award.

Vale conhecer antes: SMR e interseção de quóruns, em [Paxos Made Simple](/papers/paxos-made-simple), a eleição de líder por timeout como no [Raft](/papers/raft-understandable-consensus-algorithm) (apenas falhas por parada, enquanto este artigo precisa de 3f+1 réplicas e assinaturas) e as duas fases do PBFT, não equivocação e depois persistência.

## Contribuição

- **Duas condições para detectar.** Um detector de lentidão deve ser cooperativo, para que propostas concorrentes não interfiram, e produtivo, para que a espera contribua com trabalho útil. Um terceiro requisito é não acusar réplicas saudáveis. Timeouts e hedging falham na segunda condição.
- **Protocol-rigged racing.** Cada réplica propõe em sua própria lane e corre contra o líder, mas apenas executando passos de que precisa de qualquer forma. A lane do líder constrói um certificado sports car em dois atrasos de mensagem, com uma troca todos-para-todos. A lane de uma réplica constrói um certificado truck em três, com um padrão linear. A corrida termina em uma réplica quando ela viu 2f+1 certificados truck, e o líder vence se seu certificado chegar antes desse corte.
- **Recuperação sem líder.** As réplicas podem discordar sobre quem venceu, então a recuperação primeiro escolhe um valor por lane: o valor do líder se existir um certificado sports car, ou, caso contrário, o próprio certificado truck da réplica, apoiado por um certificado de no-commit ou de no-lock. Uma fase opcional de exclusão da corrida impede que uma réplica bizantina equivoque entre as duas lanes, e uma fase de persistência vem em seguida.
- **Eleição de lane tardia e aleatória.** Só depois que 2f+1 lanes persistiram é que as réplicas escolhem um vencedor, usando uma assinatura threshold passada por hash e reduzida módulo n. Todas as réplicas concordam com ele, e ninguém consegue prevê-lo, então um adversário de rede não pode mirar o vencedor com antecedência. Se a lane escolhida não estiver pronta, a próxima view repete a recuperação.
- **Latência e garantias.** O caso normal leva três atrasos de mensagem, como o PBFT. Sob uma lentidão, os autores dão o valor esperado de 9,5 atrasos de mensagem se o líder nunca propõe e 10,5 caso contrário. Eles provam a segurança e a terminação com probabilidade 1, com cada view tendo sucesso com probabilidade acima de 2/3. Os slots são encadeados em pipeline como no Autobahn.

## Metodologia

Os autores construíram um protótipo em Rust sobre o código aberto do Autobahn, com TCP do Tokio, RocksDB e assinaturas ed25519. Ele inclui as notas de implementação deles, exceto a agregação de assinaturas. As bases de comparação são o Autobahn (timeouts), o ParBFT2 (hedging, com o HotStuff como caminho otimista) e o SMVBA (assíncrono), e os autores dizem ter validado os resultados do Autobahn e do ParBFT2 com os respectivos autores.

Os experimentos rodaram na AWS EC2 com 4 réplicas em us-east1, us-east2, us-west1 e us-west2 (tempos de ida e volta de 20 a 72 ms), transações no-op de 512 bytes e lotes de 500KB. As rodadas do caso comum duram 60 segundos sob carga crescente. Para as lentidões, uma réplica é pausada a partir de t = 3 s por 1, 2, 5, 7 ou 10 segundos. Cada ponto é a latência mediana em uma janela de 500 ms ao longo de 5 execuções. O Autobahn roda com um timeout acima e outro abaixo de cada duração, e o ParBFT2 roda apenas o caminho pessimista, com atraso de hedging de 75 ms. Um terceiro cenário é uma implantação de produção da Sei com 40 réplicas em 20 regiões, comparada com o Autobahn da própria Sei durante 24 horas.

## Resultados

Estes são os resultados relatados pelos autores.

- **Caso comum.** O Ambulance atinge o pico de 214k tx/s, igual ao Autobahn, com latência de 205 ms contra 203 ms. O ParBFT2 chega a 167k tx/s e 382 ms, e o SMVBA a 50,6k tx/s e 462 ms. Os autores ligam isso à latência de consenso no caso bom (três atrasos de mensagem no Ambulance, cinco no ParBFT2, seis no SMVBA) e a camadas de dados mais fracas e à falta de pipeline.
- **Lentidão de 1 s.** O Ambulance tem pico de 510,4 ms. O Autobahn chega a 796,1 ms com timeout de 500 ms e a 889,5 ms com um de 2 s, o SMVBA a 731 ms e o ParBFT2 a 1,58 s.
- **Lentidão de 2 s.** O Ambulance tem pico de 633,4 ms, contra 1,37 s e 1,89 s do Autobahn com timeouts de 1 s e 5 s, 766 ms do SMVBA e 1,58 s do ParBFT2.
- **Lentidões de 5, 7 e 10 s.** O Ambulance tem pico de 787,7, 810 e 932 ms, crescendo devagar à medida que mais views falham. Isso é de 3,1× a 10,8× melhor que o Autobahn. O SMVBA o acompanha de perto, e o ParBFT2 fica em 1,58 s.
- **Resumo das afirmações.** A latência de pico é de 1,6× a 3,0× menor que a do Autobahn em lentidões de 1 a 2 s e até 10,8× menor nas mais longas, e de 1,7× a 3,1× menor que a do ParBFT2.
- **Produção.** Com carga de 180k, e lentidões cerca de uma vez a cada mil slots, a mediana é de 244 ms contra 242 ms do Autobahn, e o p99 é de 662 ms contra 1,27 s (1,92× menor).

## Análise crítica

A ideia é limpa, já que o caminho da corrida reaproveita um trabalho de que o BFT precisa de qualquer forma. O artigo admite vários limites.

- **A vantagem inicial é pequena.** Por padrão, o líder sai com um atraso de mensagem de vantagem. Em uma LAN, onde os atrasos são minúsculos, um líder saudável pode ser tido como lento e disparar recuperações desnecessárias, então os autores propõem fases fictícias ou um atraso baseado em tempo (Apêndice C), que segundo eles continua produtivo porque as réplicas seguem construindo certificados nesse intervalo.
- **O ParBFT2 não é testado por completo.** Por causa de bugs na lógica de troca de caminho, os autores rodaram apenas o caminho pessimista e não injetaram lentidão, e dizem que isso não reflete a latência dele no caso comum.
- **Igualar, e não superar, os protocolos assíncronos.** O Ambulance acompanha o SMVBA durante as lentidões, e lentidões mais longas aumentam a chance de views extras. A agregação de assinaturas ficou de fora, e os autores dizem que ela só importa com n grande.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Um único tipo de lentidão.** Os experimentos pausam uma única réplica em um cluster de 4 nós, uma vez. Não há lentidões parciais, repetidas, réplicas bizantinas nem escalonamento adversarial, então a segurança e a vivacidade dependem das provas do Apêndice B.
- **Valores pontuais.** A latência de pico é o máximo de uma mediana em janelas de 500 ms, e o texto não dá a dispersão entre as 5 execuções. Uma diferença como 633,4 ms contra os 766 ms do SMVBA é difícil de avaliar sem ela.
- **Bases de comparação confundidas.** O ParBFT2 e o SMVBA usam outra camada de dados e não têm pipeline, e rodaram com carga de 10k contra 100k do Ambulance. Os autores atribuem a diferença de 1,3× em throughput principalmente à camada de dados, então o Autobahn, que compartilha o código, é a comparação limpa. O 1,7× a 3,1× contra o hedging se apoia em um ParBFT2 só pessimista, que fica em 1,58 s para toda duração.
- **Timeouts estáticos.** O Autobahn usa padrões fixos de produção. Os trabalhos relacionados notam que o monitoramento de desempenho no estilo do Aardvark dá proteção parcial, mas ele não é avaliado.
- **Evidência fina de escala e de produção.** As rodadas controladas usam n = 4, e n = 40 aparece apenas em uma rodada de 24 horas na implantação dos coautores, em que o p99 é dominado pelas lentidões. O texto não informa nem o número nem as durações delas, nem com que frequência um líder saudável perde a corrida.

## Pesquisas futuras

- Escolher a vantagem inicial do líder por implantação, com fases fictícias ou atrasos, e medir com que frequência líderes saudáveis são classificados errado.
- Agregação de assinaturas, que segundo os autores reduz a comunicação por um fator n, com throughput medido em dezenas de réplicas.
- Uma comparação com hedging quando a troca entre caminhos otimista e pessimista do ParBFT2 funcionar, o que os autores dizem estar resolvendo com os autores dele.
- Uma propriedade formal de tolerância a lentidões para BFT, como a s-slowdown-tolerance do Copilot para falhas por parada, testada com lentidões parciais, repetidas e bizantinas.
