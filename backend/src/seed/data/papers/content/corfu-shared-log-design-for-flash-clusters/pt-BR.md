---
title: "CORFU: um projeto de log compartilhado para clusters de flash"
summary: O CORFU organiza um cluster de unidades flash como um único log compartilhado que os clientes leem e estendem diretamente, usando um sequencer para distribuir posições, chain replication conduzida pelo cliente para gravá-las e projeções seladas para sobreviver a falhas.
researchArea: Sistemas distribuídos
keywords: log compartilhado, armazenamento flash, replicação de máquina de estados, chain replication, sequencer, reconfiguração, consistência forte
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

Um log compartilhado dá a um sistema distribuído uma única ordem total de eventos que todo cliente pode ler e estender. Este artigo da Microsoft Research Silicon Valley e da UC San Diego argumenta que o flash torna a ideia prática na escala de um data center, porque o corpo do log atende leituras aleatórias rápidas e sem contenção, enquanto a cauda recebe escritas sequenciais rápidas.

Stores particionados espalham os dados por muitos logs independentes, então as operações fortes ficam dentro de uma partição. Um log em um servidor replicado mantém a ordem total, mas sua taxa de append para na banda desse servidor. O CORFU mapeia cada posição do log para páginas flash em unidades diferentes e deixa o mapeamento e a escrita com os clientes, de modo que o projeto "decouples ordering from I/O" (separa a ordenação da E/S). O artigo relaciona isso ao [Paxos](/papers/paxos-made-simple): cada cadeia de réplicas funciona como um motor de consenso, e o CORFU "scales SMR throughput by partitioning over time, not space" (escala o throughput de SMR particionando no tempo, não no espaço).

Vale conhecer antes: máquinas de estados replicadas, chain replication, trocas de visão e o próprio flash, em que cada apagamento desgasta o meio.

## Contribuição

- **Projeções.** Cada cliente guarda um mapa somente leitura que atribui intervalos do log a extents nas unidades flash, por padrão em round-robin.
- **Um sequencer fora do caminho dos dados.** Um contador em rede distribui posições do log como tokens, então os appends correm na velocidade em que os tokens saem, não na velocidade de escrita de uma unidade. O artigo o chama de "merely an optimization" (apenas uma otimização), dispensável para segurança e progresso.
- **Chain replication conduzida pelo cliente.** Os clientes gravam as réplicas em ordem fixa, em páginas write-once, então um de dois escritores em disputa recebe erro na primeira unidade. Uma escrita só conta quando a última unidade a tem, o que tolera f falhas com f + 1 réplicas.
- **Preenchimento de buracos.** Quando um cliente falha com um token na mão, outros completam seu append ou marcam a posição como lixo.
- **Reconfiguração.** Inspirada no Vertical Paxos: um cliente sela a época atual nas unidades afetadas e depois grava a nova projeção no próximo slot de um auxiliar, que só um proponente consegue vencer.
- **Um contrato estreito para as unidades flash.** Páginas write-once, um comando de seal e um espaço de endereços infinito apoiado em um hash map. Toda a funcionalidade do CORFU roda nos clientes.

## Metodologia

A implantação principal tem 32 drives Intel X25-V em 16 servidores em dois racks, mais 44 processos clientes em 22 máquinas, todos em links de 1 Gbps. Os appends são espelhados entre racks e as leituras vão para a réplica local.

As rodadas de throughput emulam as escritas nos SSDs para não desgastar os drives; as leituras vêm de SSDs reais. Um protótipo separado, um FPGA com dois SSDs que funciona como um par de unidades flash, é acessado por um único cliente. As rodadas de reconfiguração selam todos os drives, como limite superior, e usam um compartilhamento de arquivos em rede como auxiliar.

## Resultados

Estes são os resultados informados pelos autores.

- O throughput de leitura e de append cresce proporcionalmente ao número de drives. O cluster chega a 400K leituras de 4KB por segundo, e os appends param em torno de 180K por segundo, o limite do sequencer em espaço de usuário e um pouco abaixo dos 200K do resumo.
- Na unidade FPGA, as leituras levam menos de 0,5 ms, os appends terminam em até 750 microssegundos e os fills em até 650 microssegundos. A unidade consome cerca de 15 W, contra 250 W de um servidor.
- Em 32 drives, a mediana do seal fica em torno de 5 ms e a escrita no auxiliar leva mais 25 ms.
- O CORFU-Store, um key-value store, executa 40K multi-gets de 10 chaves e 20K multi-puts de 10 chaves por segundo, com valores de 4KB. Multi-puts pequenos são limitados pelo map-service e, acima de 4 chaves, pelo log.
- O CORFU-SMR, uma biblioteca de replicação de máquina de estados, executa 70K comandos de 512 bytes por segundo com 10 réplicas. Com mais réplicas, os clientes já não acompanham o log.
- Nessas taxas o CORFU pode desgastar 1 TB de flash MLC em cerca de 4 meses, o que os autores consideram aceitável diante de um cluster de drives de US$ 3 mil.

## Análise crítica

A arquitetura é o resultado duradouro: separar ordenação de E/S tira o limite de append da banda de armazenamento. Os números de destaque pedem mais cuidado.

Limites que o próprio artigo declara:

- **A contenção diminui, mas continua.** Um cliente lento disputando com quem preenche um buraco são dois escritores na mesma posição, então o sequencer "does not eliminate it entirely" (não a elimina por completo).
- **O playback é caro.** N réplicas a T comandos por segundo custam N * T leituras do log, e o CORFU-SMR para nos clientes, não no log.

Pontos que decorrem da leitura da avaliação:

- **Os 180K appends por segundo nunca chegaram ao flash.** As escritas foram emuladas, então esse número testa protocolo, rede e sequencer, não flash durável nessa taxa.
- **30 ms não é a indisponibilidade.** O seal e a escrita no auxiliar começam depois da detecção. Na rodada com falha, o cliente de append espera antes um timeout de 1 segundo, e o tempo para reconstruir uma réplica substituta não é informado.
- **Escala e eficiência não apareceram juntas.** Os números de cluster vêm de SSDs ligados a servidores, os de energia e latência de uma unidade FPGA. A conclusão fala em chips flash ligados diretamente à rede, enquanto o protótipo põe SSDs SATA atrás de um FPGA.
- **As comparações são argumentadas, não executadas.** Nenhum experimento testa o CORFU contra uma implementação de Paxos, um drive PCI-e hospedado em servidor ou o projeto de log do Hyder.
- **Um número discorda da fórmula do próprio artigo.** Um multi-put de k chaves custa k + 1 appends, então 10 chaves a 180K appends por segundo dão cerca de 16K, abaixo dos 20K da introdução. A Figura 9 para em 8 chaves.
- **O tratamento de falhas é exercitado só em parte.** O auxiliar avaliado é um compartilhamento de arquivos, e nenhuma rodada mede throughput com clientes falhando, embora os autores chamem os buracos de modo de falha mais comum.

O artigo seguinte, [Tango](/papers/tango-distributed-data-structures-over-a-shared-log), relata um sequencer refeito em torno de 570K requisições por segundo (só o sequencer), o que sugere que o teto de 180K vinha da implementação.

## Pesquisas futuras

- Formas de reproduzir o log sem que toda réplica leia toda entrada, já que foi aí que o CORFU-SMR parou de escalar.
- Até onde um sequencer consegue ir e o que deve substituí-lo quando ele saturar.
- Avaliação em escala de cluster de unidades conectadas à rede, com appends duráveis sustentados e desgaste medido.
- Throughput sob taxas realistas de clientes lentos e que falham, incluindo como os buracos são detectados.
