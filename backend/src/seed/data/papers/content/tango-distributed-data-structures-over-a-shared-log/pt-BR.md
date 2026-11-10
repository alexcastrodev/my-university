---
title: "Tango: estruturas de dados distribuídas sobre um log compartilhado"
summary: O Tango oferece aos desenvolvedores estruturas de dados em memória cujo estado é um histórico em um log compartilhado, de modo que as réplicas obtêm linearizabilidade, durabilidade e transações entre objetos a partir de appends e leituras, enquanto streams permitem que cada cliente reproduza só a parte do log de que precisa.
researchArea: Sistemas distribuídos
keywords: log compartilhado, serviços de metadados, replicação de máquina de estados, controle de concorrência otimista, transações distribuídas, streams, CORFU
version: 1.0
updatedAt: 2026-11-03
---

## Visão geral

Metadados costumam viver em mapas, árvores, contadores e filas, e atualizá-los muitas vezes significa mudar várias estruturas de forma atômica, como mover um nó de uma lista de livres para uma tabela de alocação. Este artigo do SOSP 2013 lista os caminhos usuais para tornar um serviço assim altamente disponível: um protocolo próprio, uma reescrita como máquina de estados sobre Paxos, ou um serviço existente como o ZooKeeper, que impõe uma única estrutura de dados.

O Tango oferece outro caminho. Um objeto existe como um histórico de atualizações em um log compartilhado e como um número qualquer de views, a estrutura de dados convencional na RAM dos servidores de aplicação. Nas palavras do artigo, "the shared log is the object" (o log compartilhado é o objeto), e as views são estado descartável, reconstruído ao reproduzir o log. Os runtimes do Tango em máquinas diferentes nunca trocam mensagens entre si.

O log vem do [CORFU](/papers/corfu-shared-log-design-for-flash-clusters), usado em versão modificada. O CORFU fornece appends, leituras e um sequencer centralizado, cuja velocidade define o limite de appends do log; o Tango acrescenta o modelo de objetos, as transações e os streams. O artigo coloca isso ao lado do Percolator, do [Spanner](/papers/spanner-globally-distributed-database) e do [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) como fonte de ordenação global para estado particionado.

Vale conhecer antes: replicação de máquina de estados, controle de concorrência otimista, sharding e as chamadas append, check, read e trim do CORFU.

## Contribuição

- **O objeto Tango.** Uma view, um upcall apply que é o único autorizado a alterá-la e métodos construídos sobre dois helpers do runtime: um faz append de uma atualização, o outro reproduz o log até a cauda antes de uma leitura.
- **Propriedades tiradas do log.** Leituras linearizáveis vêm de verificar a cauda e alcançá-la, a durabilidade do replay, o rollback de reproduzir um prefixo e a escala de leitura de adicionar views.
- **Transações como registros no log.** Um registro de commit lista as versões lidas, e cada cliente que chega a ele decide commit ou abort de forma independente, mas determinística. O artigo reivindica o isolamento do 2-phase locking, idêntico ao do Spanner.
- **Streams e particionamento em camadas.** Cada objeto recebe um stream, e o `readnext` pula entradas de outros streams. Um `multiappend` coloca uma entrada em vários streams, então uma transação entre objetos mantém um único registro de commit. As entradas carregam backpointers para entradas anteriores do seu stream, que o sequencer agora acompanha.
- **Registros de decisão.** Um cliente que hospeda um objeto escrito, mas não o conjunto de leitura, não consegue julgar a transação, então o cliente que a gerou faz append do resultado.

## Metodologia

O testbed tem 36 máquinas de 8 núcleos em dois racks, com placas de rede gigabit. Dezoito rodam o CORFU em SSDs Intel X25V como 9 pares espelhados entre racks, as outras 18 são clientes que geram carga localmente, e o sequencer tem sua própria máquina de 32 núcleos. As entradas têm 4KB e cada cliente agrupa 4 registros de commit por entrada.

Os experimentos rodam o TangoRegister com uma, duas e N views, depois transações em TangoMap com três leituras e três escritas, sob chaves uniformes e zipf. Transações entre partições leem localmente e escrevem local e remotamente, comparadas a um protocolo simples de 2-phase locking distribuído, parecido com o do Percolator, construído dentro do `EndTX`. Implementações de ZooKeeper e BookKeeper são testadas sob o namenode do HDFS.

## Resultados

Estes são os resultados informados pelos autores, do Tango sobre seu CORFU modificado, exceto o benchmark isolado do sequencer, que o artigo relata no histórico do CORFU.

- Com 18 clientes, 180K leituras linearizáveis por segundo rodam contra 10K escritas por segundo.
- Em um mapa totalmente replicado, o throughput atinge o pico com três nós e fica estável, o playback bottleneck. Com 3 nós, o goodput é baixo com dezenas ou centenas de chaves e a partir de 10K chaves chega a 99% do throughput com seleção uniforme e a 70% com zipf.
- Com um mapa por cliente, um log de 6 servidores satura em cerca de 150K transações por segundo, e um log de 18 servidores chega a 200K sem atingir seu teto.
- Mais de 100K transações por segundo se mantêm quando 16% cruzam objetos em clientes diferentes. Tango e 2PL degradam suavemente, com goodput em torno de 99%. Quando as transações leem e escrevem um objeto compartilhado, a vazão cai bruscamente de 0% para 1%, enquanto o goodput fica entre 98% e 99%.
- A versão do ZooKeeper tem menos de 1.000 linhas de Java contra mais de 13K do original, e a do BookKeeper cerca de 300.
- Um sequencer do CORFU reescrito se estabiliza em cerca de 570K requisições por segundo sem batching, e um sequencer que falha é substituído em até 10 ms com 18 nós.

## Análise crítica

A força do artigo está em quanto ele extrai de uma única primitiva. As evidências têm limites claros.

Limites que o próprio artigo declara:

- **A ordem global tem preço.** Existe "a cap on aggregate throughput across all partitions" (um teto para o throughput agregado de todas as partições) quando o log satura.
- **As transações são restritas.** Um cliente não pode executar transações com leituras remotas, uma entrada só alcança um número fixo de streams e os desenvolvedores marcam os registros de decisão à mão, esquema que os autores chamam de "simple but conservative and static" (simples, mas conservador e estático).
- **Os backpointers prendem o projeto a um único sequencer.** A Seção 2 o descreve como uma otimização removível, mas com backpointers "we can no longer tolerate the existence of multiple sequencers" (não podemos mais tolerar a existência de vários sequencers). Um novo sequencer reconstrói seu estado varrendo o log, e o artigo não informa a duração dessa reconstrução.

Pontos que decorrem da leitura da avaliação:

- **180K é carga oferecida.** São 18 views a 10K leituras cada, então o número mostra ausência de queda nessa carga, não a capacidade do log.
- **Transações por segundo não são appends por segundo.** Com 4 registros de commit por entrada, esses números não podem ser comparados aos appends por segundo do artigo do CORFU, que além disso usou outro cluster e outro sequencer.
- **O número de 10 ms para a troca parece não incluir a reconstrução.** O artigo dá o número para substituir um sequencer que falhou e só depois descreve a reconstrução, então uma recuperação completa provavelmente demora mais.
- **A contenção decide o goodput, não todo o custo.** Os 99% de goodput dos experimentos particionados usam chaves uniformes em mapas de 100K chaves. Em outros cenários a contenção custa bem mais: 70% com zipf em um mapa e goodput baixo com poucas chaves. O caso do objeto compartilhado perde vazão com goodput perto de 99%, então essa perda não é contenção.
- **A comparação com 2PL é parcial.** A linha de base é um protocolo simples construído dentro do Tango, e as rodadas entre partições só leem dados locais. A afirmação de "none of the fault-tolerance problems endemic to such protocols" (nenhum dos problemas de tolerância a falhas típicos desses protocolos) é um argumento: ali nenhuma falha é injetada, e o Tango tem seus próprios time-outs, como 100 ms por padrão antes de preencher um buraco.
- **O comportamento sob falha quase não é medido.** Paradas causadas por buracos e o tempo de reconstrução de views não são informados.
- **"Full fidelity" é uma afirmação estreita.** A contagem de linhas exclui exceções e interfaces de callback, a contagem de linhas do ZooKeeper deixa de fora o suporte a ACLs, o teste com HDFS é funcional e nenhum número de desempenho é comparado aos sistemas originais.

## Pesquisas futuras

- Transações com leituras remotas no cliente gerador, que os autores planejam explorar com um protocolo colaborativo.
- Recuperação mais rápida do sequencer, para a qual os autores planejam checkpoints periódicos no log.
- Como manter transações entre vários logs quando um log satura, sem perder a simplicidade defendida aqui.
- Medições sob falha e sob assimetria em escala maior.
