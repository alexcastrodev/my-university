---
title: "Zab: difusão de alto desempenho para sistemas primário-backup"
summary: O Zab é o protocolo de difusão atômica com recuperação de falhas do ZooKeeper. Em vez de instâncias independentes ao estilo do Paxos, ele usa um líder por época que executa as fases de descoberta, sincronização e difusão, de modo que o primário mantém várias mudanças de estado incrementais em andamento e a ordem de entrega ainda respeita a ordem dos primários.
researchArea: Sistemas distribuídos
keywords: zab, difusão atômica, primário-backup, zookeeper, ordem do primário, recuperação de falhas, épocas, quórum
version: 1.0
updatedAt: 2026-11-19
---

## Abstract

Zab é um algoritmo de difusão atômica com recuperação de falhas que projetamos para o serviço de coordenação ZooKeeper. O ZooKeeper implementa um esquema primário-backup em que um processo primário executa as operações dos clientes e usa o Zab para propagar as mudanças de estado incrementais correspondentes aos processos de backup. Como uma mudança de estado incremental depende da sequência de mudanças geradas antes dela, o Zab precisa garantir que, se entrega uma dada mudança, todas as outras mudanças das quais ela depende sejam entregues antes. Como primários podem falhar, o Zab precisa cumprir esse requisito apesar das falhas de primários.

As aplicações que usam o ZooKeeper exigem alto desempenho do serviço e, por isso, um objetivo importante é poder ter várias operações de clientes em andamento ao mesmo tempo. O Zab permite várias mudanças de estado em andamento ao garantir que no máximo um primário consegue difundir mudanças de estado e incorporá-las ao estado, e ao usar uma fase de sincronização ao estabelecer um novo primário. Antes de essa fase de sincronização terminar, um novo primário não difunde novas mudanças de estado. Por fim, o Zab usa um esquema de identificação das mudanças de estado que permite a um processo identificar facilmente as mudanças que faltam. Essa característica é essencial para uma recuperação eficiente.

Experimentos e a experiência até agora em produção mostram que o projeto permite uma implementação que atende aos requisitos de desempenho das aplicações. Nossa implementação do Zab consegue dezenas de milhares de difusões por segundo, o que basta para sistemas exigentes como nossas aplicações em escala de Web.

## Visão geral

O ZooKeeper, descrito em [ZooKeeper: coordenação sem espera](/papers/zookeeper-wait-free-coordination-internet-scale-systems), mantém as réplicas consistentes com um esquema primário-backup: um primário executa cada requisição do cliente e a transforma em uma mudança de estado incremental e não comutativa, chamada de transação, que ele envia aos backups. Este artigo, do Yahoo! Research e publicado no DSN 2011, é a especificação e a descrição do protocolo que transporta essas transações. Os autores observam que sistemas anteriores como o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) e o [Paxos Made Live](/papers/paxos-made-live-engineering-perspective) foram projetados para mudanças de estado duradouras e pouco frequentes, enquanto o ZooKeeper precisava atender aplicações que o usam de forma intensa.

O problema que motiva o trabalho é que cada mudança de estado é calculada sobre o estado produzido pela anterior. Se a mudança de A para B é entregue depois de uma mudança C, que não depende de A, ter ocupado o lugar de B na sequência, as réplicas aplicam B a um estado a partir do qual ela não foi calculada. O artigo mostra uma execução do Paxos, com uma instância por número de sequência, em que isso acontece quando há várias propostas em andamento. Uma solução conhecida, agrupar várias transações em uma única proposta com no máximo uma proposta em andamento, prejudica a vazão ou a latência, conforme o tamanho do lote.

Vale conhecer antes: o Paxos como em [Paxos simplificado](/papers/paxos-made-simple), a ideia de máquina de estados replicada por trás da [abordagem de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial), quóruns e a relação acontece-antes do [artigo dos relógios de Lamport](/papers/lamport-time-clocks-ordering-of-events).

## Contribuição

- **Uma nova propriedade de correção, a ordem do primário.** Ela tem duas partes, a ordem local do primário (ordem FIFO de um mesmo primário) e a ordem global do primário (as transações de um primário anterior vêm antes das de um posterior), além da integridade do primário, que obriga um novo primário a entregar o que os primários anteriores produziram antes de difundir.
- **Difusão atômica PO.** Os autores chamam o Zab de protocolo de difusão atômica PO e formulam o acordo como propriedade de segurança, e não como a propriedade de vivacidade usada em trabalhos anteriores.
- **Três fases.** O Zab executa descoberta, sincronização e difusão, com uma fase de sincronização a mais que o Paxos.
- **Identificadores de transação.** Um zxid é um par de época e contador, ordenado primeiro pela época e depois pelo contador, de modo que cada identificador corresponde a no máximo uma transação e os processos as aceitam em ordem.
- **Uma implementação.** O protocolo está em produção como parte do ZooKeeper, com um benchmark em um cluster de 13 servidores.

## Metodologia

O modelo de sistema é um conjunto de processos com armazenamento estável que podem falhar e se recuperar um número ilimitado de vezes, com um sistema de quóruns cujos quóruns se intersectam dois a dois. Os canais satisfazem as propriedades de integridade, prefixo e iteração única, que a implementação obtém abrindo uma conexão TCP no início de cada iteração. O progresso exige um quórum de processos ativos que consigam trocar mensagens por tempo suficiente. O artigo supõe um mecanismo externo que garante no máximo um primário ativo por vez, e na implementação esse mecanismo é fortemente acoplado à camada de difusão.

O protocolo é dado como passos de um líder e de seus seguidores. A Seção VI traz invariantes e esboços de prova para cada propriedade de segurança e para uma afirmação de vivacidade, e remete ao relatório técnico "Dissecting Zab" (Yahoo! Research, YL-2010-007) para a prova detalhada. A Seção VII mede a implementação em Java com um wrapper de benchmark especial que conversa diretamente com o Zab: o líder gera lotes de 250.000 requisições e mantém 1.000 em andamento, com lotes de aquecimento e cerca de 10 lotes cronometrados, em operações de 1024 bytes. O cluster tem até 13 servidores com CPUs Xeon dual quad-core de 2,50GHz, 16G de RAM, interface gigabit e um disco SATA de 1T dedicado ao histórico de propostas, rodando RHEL 5 e a JVM 1.6 da Sun.

## Resultados

**As três fases.** Cada processo executa uma iteração por vez e pode abandoná-la para recomeçar na Fase 1.
- **Fase 1, descoberta.** Os seguidores enviam CEPOCH com sua última promessa. Depois que um quórum responde, o líder em potencial propõe NEWEPOCH com uma época posterior a qualquer uma recebida. Os seguidores que aceitam respondem ACK-E com sua época atual e seu histórico, e o líder escolhe como histórico inicial o do seguidor com a época mais recente e, em caso de empate, o maior zxid.
- **Fase 2, sincronização.** O líder envia NEWLEADER com a nova época e o histórico inicial, os seguidores o aceitam e, após confirmações de um quórum, o líder faz o commit e fica estabelecido. Os seguidores então entregam o histórico inicial, e só depois disso o primário pode chamar ready(e) e difundir.
- **Fase 3, difusão.** O líder propõe transações em ordem crescente de zxid, faz o commit depois que um quórum confirma, e os seguidores entregam em ordem de zxid. O artigo descreve isso como parecido em espírito com o two-phase commit sem aborts.

**Ordem e causalidade.**
- O Zab não satisfaz a ordem causal clássica. A Figura 3 do artigo mostra uma execução em que uma transação nunca é entregue, embora outras, causalmente posteriores, sejam.
- O Zab satisfaz uma ordem causal PO mais fraca, definida por uma relação de precedência PO em que eventos de primários diferentes não são necessariamente relacionados, mesmo no mesmo processo, e uma propriedade chamada causalidade estrita.
- A Figura 4 do artigo mostra uma execução com ordem causal, mas sem causalidade estrita, e conclui que nenhuma das duas primitivas é mais forte que a outra.

**Diferenças em relação ao Paxos.**
- O Zab acrescenta a fase de sincronização. O Paxos tem uma fase de leitura e uma de escrita, que correspondem à descoberta e à difusão do Zab, e no Paxos o novo líder escolhe um valor para cada número de sequência de forma independente.
- No Zab o novo líder escolhe um único histórico, o de maior zxid entre os seguidores com a época mais recente, e o replica. A recuperação então compara os últimos zxids em vez de executar a Fase 1 do Paxos para cada número de sequência anterior.
- O artigo diz que o Zab segue a descrição abstrata do Paxos de Lampson, com o direito de propor em uma época dado a exatamente um líder, e que o Vertical Paxos ainda permite que uma instância receba vários valores.

**Medições.** Vazão e latência vêm das Figuras 6 e 7, e os números abaixo foram lidos dos gráficos.
- Com cache de escrita do disco ou cache com bateria, a vazão só com rede e a vazão com rede mais disco são quase idênticas e saturam a rede, caindo de cerca de 38.000 operações por segundo com 3 servidores para cerca de 8.000 com 13.
- Com o cache de escrita desligado, o Zab fica limitado por E/S em cerca de 13.000 operações por segundo, quase constante até uns 7 servidores.
- A latência média de uma operação de 1K é de cerca de 4 a 5 ms só com rede, de 6 a 7 ms com disco e de 45 a 67 ms com o cache de escrita desligado. O ping era de 100 microssegundos.

## Análise crítica

- **A recuperação é afirmada, não medida.** A recuperação eficiente é um objetivo central, mas a avaliação cobre só vazão e latência de um wrapper de benchmark. Não há medição do tempo de eleição ou de recuperação, nem comparação direta com uma implementação de Paxos.
- **A correção é argumentada por esboços.** As provas completas estão em um relatório técnico, e a vivacidade é deixada propositalmente rasa: o artigo diz que uma comparação detalhada com Malkhi et al. está fora do escopo.
- **A crítica ao Paxos vale para um caso de uso específico.** A Figura 1 mira um cenário: mudanças de estado incrementais e dependentes de ordem, com várias propostas em andamento e sem lotes. O próprio artigo cita o agrupamento em lotes como solução conhecida e avalia seu custo, então o resultado não é que o Paxos esteja incorreto.
- **Suposições fortes no modelo.** Um conjunto estático de processos e uma garantia externa de no máximo um primário ativo, além de um protocolo cuja eleição, na implementação, está ligada à camada de difusão.
- **O hardware data os números.** RHEL 5, ext3, disco SATA e JVM 1.6 da Sun são de 2011, e o resultado com o cache de escrita mostra o quanto uma única configuração de disco move a curva. Trate os valores absolutos como históricos.
- **Literatura posterior, não vem deste artigo.** O artigo do Raft (versão estendida, conferida) cita este trabalho e diz que o algoritmo do ZooKeeper "foi publicado com mais detalhes, mas é bem diferente do Paxos" (tradução livre), e também aponta a liderança forte como a maior diferença entre o [Raft](/papers/raft-understandable-consensus-algorithm) e o Paxos. Uma comparação detalhada entre Paxos, Zab e Raft vai além do que foi conferido para esta nota.

## Pesquisas futuras

- Uma análise de vivacidade com suposições mais fracas, item em aberto que o artigo deixa.
- Reduzir a carga de rede do líder, já que o artigo menciona árvores de difusão ou [replicação em cadeia](/papers/chain-replication-high-throughput-availability) e não as explorou.
- Primitivas de eleição que devolvam o processo com a época mais recente e o maior zxid, o que, segundo o artigo, forneceria diretamente o histórico inicial.
- Reconfiguração do conjunto de servidores, já que o Zab supõe um conjunto estático de processos.
- Provas verificadas por máquina das propriedades de ordem do primário.
