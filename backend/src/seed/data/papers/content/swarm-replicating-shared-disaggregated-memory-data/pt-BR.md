---
title: "SWARM: replicação de dados compartilhados em memória desagregada em tempo recorde"
summary: O SWARM replica objetos compartilhados em memória desagregada para que leituras e escritas normalmente levem um round trip, mantendo linearizabilidade e wait-freedom, ao adivinhar timestamps de escrita e conferi-los com timestamp locks, e ao atualizar buffers grandes em nós de memória que não executam código.
researchArea: Sistemas distribuídos
keywords: memória desagregada, replicação, linearizabilidade, wait-freedom, rdma, armazenamento chave-valor
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

A desagregação de memória coloca a memória em nós de memória separados, que os servidores acessam por uma rede rápida, hoje o RDMA e, no futuro, possivelmente o CXL. Ela melhora a utilização, mas a falha de um nó de memória pode agora tirar dados compartilhados por muitos servidores, então os dados precisam ser replicados. Os autores argumentam que os esquemas feitos para servidores comuns se encaixam mal nesse cenário por dois motivos. Eles precisam de vários round trips, o que no mínimo dobra a latência da memória desagregada, e muitas vezes executam código junto dos dados para controlar timestamps, filtrar mensagens antigas ou votar, algo que os nós de memória podem não conseguir fazer ou só fazer a um custo alto.

Este artigo do SOSP 2024 (Austin), de Antoine Murat, Clément Burgelin, Athanasios Xygkis, Igor Zablotchi, Marcos K. Aguilera e Rachid Guerraoui, da EPFL, da Oracle Labs, da Mysten Labs e do VMware Research Group, propõe o SWARM (Swift WAit-free Replication in disaggregated Memory). Ele mira usos de baixa latência, como sistemas de negociação e microsserviços em escala de microssegundos.

Cinco termos sustentam o artigo. Um **max register** é um objeto cuja leitura devolve um valor no mínimo igual ao de toda escrita concluída antes dela. O **Safe-Guess** é o protocolo de replicação. Os **timestamp locks** são os locks wait-free que tornam seguros os seus palpites. O **In-n-Out** é a técnica que constrói um max register para valores grandes em nós de memória sem computação. O **SWARM-KV** é o armazenamento chave-valor construído sobre tudo isso.

Vale conhecer antes: linearizabilidade, wait-freedom e o ABD, o protocolo clássico de quorum para replicar um registrador de leitura e escrita, do qual o artigo parte. O artigo contrasta sua abordagem com a replicação baseada em consenso, que cita por meio de [The Part-Time Parliament](/papers/paxos-part-time-parliament), de Lamport. Ele não cita [Paxos Made Simple](/papers/paxos-made-simple) nem o [Raft](/papers/raft-understandable-consensus-algorithm), que ficam aqui como contexto sobre essa alternativa baseada em leader.

## Contribuição

- **Um problema mais estreito.** O SWARM replica registradores de leitura e escrita, não máquinas de estado arbitrárias. Os autores argumentam que a replicação de máquina de estado exige consenso, que custa mais round trips e não é wait-free, enquanto registradores bastam para armazenamentos chave-valor. Premissas: só falhas por parada (crash), maioria dos nós de memória viva, qualquer número de clientes falhos, e wait-freedom apenas se o número de threads concorrentes for limitado.
- **Safe-Guess.** O ABD gasta um primeiro round trip buscando um timestamp novo. Um escritor do Safe-Guess, em vez disso, adivinha um a partir do relógio local, escreve sua tupla (timestamp, flag GUESSED, valor) no max register e lê o registrador em paralelo. Se não lê nada maior que o que escreveu, o palpite era novo e a escrita termina em um round trip, enquanto uma escrita em background troca a flag para VERIFIED, de modo que os leitores também terminem em um.
- **Timestamp locks.** Se o escritor lê algo maior, seu palpite pode estar velho, mas reescrever poderia expor o valor duas vezes. Um timestamp lock deixa um leitor e um escritor disputarem o mesmo timestamp de modo que no máximo um vença. Se o escritor vence, nenhum leitor pode devolver o valor adivinhado, e ele reescreve acima do timestamp que viu. Se perde, um leitor julgou o palpite novo e a escrita está concluída. Um leitor devolve um valor VERIFIED, ou trava em modo de leitura uma tupla que viu duas vezes, ou devolve depois de ver duas tuplas diferentes do mesmo escritor, o que o limita a 2 × (número de escritores) + 1 iterações. Cada lock é construído com objetos CAS nos nós de memória.
- **In-n-Out.** Os nós de memória oferecem leituras e escritas simples, um CAS de 64 bits e a execução em ordem de duas atualizações em pipeline. Uma entrada do max register combina buffers fora do lugar, 8 bytes de metadados (um timestamp e um ponteiro) e uma cópia no lugar protegida por um hash que cobre o ponteiro. Uma escrita preenche um buffer novo e atualiza os metadados em um round trip em pipeline, e depois renova a cópia no lugar em background. Uma leitura busca metadados e dados no lugar juntos e só segue o ponteiro se o hash não bater. A atualização de máximo é emulada com CAS, e um array de buffers de 8 bytes, um por escritor, reduz a contenção.
- **SWARM-KV.** Os clientes acessam as réplicas diretamente, com um índice de localização das réplicas (cerca de 24 bytes por chave) e o serviço de membership uKharon em servidores comuns. Gets, updates, inserts e deletes levam um round trip no caso comum, e um delete escreve o timestamp máximo para que as operações seguintes sobre a chave falhem. A reciclagem de memória pede aos clientes que parem de usar buffers, o que exige sincronia eventual.

## Metodologia

O SWARM-KV tem 3.151 linhas de C++17 sobre RDMA, usando o framework do uKharon, xxHash3 para os hashes e o índice do FUSEE modificado para dar consistência forte. Os clientes adivinham timestamps a partir de um relógio TSC fracamente sincronizado e o ressincronizam após cada palpite velho. Escritas e leituras contatam primeiro uma maioria mínima de réplicas, e os dados no lugar ficam em uma réplica. Os autores dizem que não implementaram a reciclagem de memória.

O ambiente de testes tem 4 servidores clientes e 4 nós de memória atrás de um único switch de 100 Gbps. As bases de comparação são o RAW (sem replicação nem controle de concorrência, um limite inferior), o DM-ABD (o armazenamento dos autores baseado em ABD com atualizações fora do lugar) e o FUSEE, um armazenamento desagregado replicado de ponta. A comparação com o FUSEE se limita à latência ponta a ponta. As cargas padrão são YCSB A (50% de updates) e B (5% de updates) com chaves Zipfian 0,99, 3 réplicas, 100 mil chaves de 24 B, valores de 64 B e 4 clientes, após um aquecimento de 1 milhão de operações. Outros experimentos variam a carga, os clientes até 64, o tamanho do valor, o fator de replicação, o tamanho do cache, a queda de um nó de memória e a contenção em uma única chave. Os apêndices trazem provas de corretude e análises de round trips, marcados como não revisados por pares.

## Resultados

Estes são os resultados relatados pelos autores.

- **Contra o armazenamento sem replicação.** No YCSB B, os gets do SWARM-KV levam mediana de 2,4 µs contra 1,9 µs do RAW (+27%), com P1 em 2,2 µs e P99 em 2,8 µs. Os updates levam 3,1 µs contra 1,6 µs (+92%). O overhead fica abaixo de um round trip: 0,5 µs nos gets e 1,5 µs nos updates.
- **Contra as bases replicadas.** O DM-ABD leva dois round trips: 4,3 µs nos gets e 4,9 µs nos updates. Os gets do FUSEE levam 2,9 µs em 87% das operações e 4,8 µs no percentil 90, e seus updates levam de 8,5 µs (4 round trips) a 10,4 µs (5). Os autores resumem isso como gets até 2× mais rápidos e updates 3,4× mais rápidos que os do FUSEE.
- **Caches pequenos.** Com 1 milhão de chaves e 5 MiB de cache, o DM-ABD e o FUSEE guardam 21,8% das chaves e o SWARM-KV 16,4%, com taxas de miss de 42,5% e 45,6%, respectivamente. A latência média do SWARM-KV continua melhor nas duas operações.
- **Throughput e escala.** No YCSB A, um core vai de 2,7 µs e 264 kops com uma operação por vez a 499 kops com duas (2,8 µs) e 640 kops no máximo. Com uma operação por cliente, 64 clientes chegam a 15,9 Mops, com a latência dos gets subindo de 2,2 para 3,69 µs e a dos updates de 2,7 para 4,3 µs. Com 4 operações concorrentes o pico é de 28,3 Mops com 40 clientes, depois do qual a rede vira o gargalo.
- **Réplicas e tamanho do valor.** Cada 2 réplicas a mais somam 0,2 µs aos gets e 0,5 µs aos updates, e o throughput cai 9% de 3 para 5 réplicas e mais 7% de 5 para 7. Valores de até 8 KiB mantêm latência de um dígito em microssegundos, e os dados no lugar deixam os gets de 8 KiB 33% mais rápidos e, nesse tamanho, elevam o throughput do YCSB B em 50%.
- **Recursos.** Para 1 milhão de chaves de 1 KiB, o SWARM-KV usa 4,06 GiB de memória desagregada contra 3,00 do DM-ABD, 2,04 do FUSEE e 0,95 do RAW, cerca do dobro do FUSEE. Seu uso de CPU é 61,3%, contra 99,0% do DM-ABD e 74,2% do FUSEE, e o cache do cliente é 33% maior que o do DM-ABD.
- **Falha.** Derrubar um nó de memória não interrompe o serviço. A latência sobe por um tempo, pois as operações contatam mais nós e os dados no lugar se perdem, e as operações seguintes os reconstroem. Os autores dizem que sistemas síncronos como o FUSEE, segundo se relata, levam no mínimo dezenas de milissegundos para se recuperar.
- **Contenção.** Com 16 clientes em uma chave, o P99 dos gets chega a 30 µs, e só 14% dos gets terminam em um round trip. Os updates precisam de no máximo 4 round trips (73% em 1, 7% em 2, 14% em 3, 6% em 4), com P99 em 10 µs. Com 64 clientes, 99% dos updates do YCSB B levam um round trip com um buffer de metadados por cliente, contra 23% com um único buffer compartilhado.

## Análise crítica

O desenho em duas partes é claro, e o artigo é franco sobre onde ele para. Ele admite vários limites.

- **Um round trip é o caso comum.** Isso exige ausência de falhas, pouca contenção e relógios quase sincronizados, e o artigo lembra que é comprovadamente impossível levar sempre um round trip. A seção de trabalhos relacionados admite que o Gus, que exige réplicas no mesmo host dos clientes, tem pior caso de dois round trips, enquanto o Safe-Guess pode cair no caminho lento.
- **O wait-freedom tem condições.** Ele exige um número limitado de threads, a reciclagem não é wait-free em teoria, e o SWARM-KV depende de um índice e de um serviço de membership cuja indisponibilidade pode travar os clientes. O artigo diz que todos os sistemas têm latência de pior caso ilimitada porque seu índice é síncrono.
- **Custa memória e escalabilidade.** O SWARM-KV usa o dobro da memória desagregada do FUSEE, e os arrays de metadados que mantêm os updates rápidos crescem com o número de clientes, o que os autores dizem prejudicar a escalabilidade.
- **Partes inacabadas.** Durabilidade e verificação formal dos algoritmos e da implementação ficam para depois, e a reciclagem de memória está projetada, mas não implementada.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **A desagregação é aproximada com servidores RDMA.** Os nós de memória são servidores comuns com placas RDMA atrás de um switch, sem hardware CXL. Que mais saltos ampliariam o benefício é afirmado, não medido.
- **As bases de comparação são em parte dos próprios autores.** O RAW e o DM-ABD foram construídos para o artigo, e o FUSEE é comparado em latência e em uso de recursos calculado. A vantagem de disponibilidade sobre o FUSEE se apoia em tempos de recuperação que sistemas como ele "segundo se relata" têm, contra uma única queda de nó de memória no traço de um cliente, então não é um experimento no mesmo ambiente.
- **A redação de destaque difere do corpo.** O resumo fala em overhead marginal, enquanto os updates são 92% mais lentos que o RAW. As duas coisas valem, já que a diferença é menor que um round trip, mas o custo relativo dos updates é grande.
- **A Tabela 3 é calculada e supõe reciclagem.** O texto chama os valores de calculados, com garbage collection uma vez por segundo, enquanto a Seção 6 diz que a reciclagem não foi implementada. O custo do protocolo de reciclagem, portanto, não é medido de ponta a ponta.
- **O limite do caminho lento é frouxo.** O apêndice dá um limite de escrita que depende do valor do timestamp (até ts + 4 round trips), o que é um argumento de liveness, não uma garantia de latência para timestamps derivados de relógio. O caminho lento é exercitado principalmente pelo experimento de chave única, e o resultado do SWARM-KV com 32 clientes aparece só em texto.
- **A cobertura de cargas e de relógio é estreita.** Só o YCSB A e o B são executados, ambos Zipfian, com valores pequenos por padrão. Não encontrei experimento que varie o desvio dos relógios, embora o caminho rápido dependa dele. Com 5 e 7 réplicas em 4 nós, algumas réplicas dividem um nó.
- **Os protocolos mais próximos não são medidos.** O Gus e o Gryff são discutidos apenas em palavras.

## Pesquisas futuras

- Acrescentar durabilidade ao SWARM sem prejudicar sua latência, o que os autores chamam de atraente, mas nada trivial.
- Provar formalmente tanto os algoritmos quanto a implementação, no estilo do IronFleet, e implementar e medir a reciclagem de memória.
- Rodar em pools de memória CXL reais, em que uma operação nativa de máximo (que o hardware de hoje em geral não oferece) eliminaria as repetições do CAS.
- Medir a sensibilidade ao desvio dos relógios, a recuperação contra o FUSEE em um único ambiente e o comportamento com muito mais clientes que 64.
