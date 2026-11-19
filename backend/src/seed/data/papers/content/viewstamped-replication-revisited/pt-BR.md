---
title: "Viewstamped Replication revisitada"
summary: Liskov e Cowling reescrevem a Viewstamped Replication como um protocolo autocontido de replicação de máquina de estados tolerante a falhas por parada, com operação normal, mudanças de visão, recuperação sem disco, otimizações e um protocolo de reconfiguração que pode mudar o grupo e o limite de falhas.
researchArea: Sistemas distribuídos
keywords: viewstamped replication, replicação de máquina de estados, mudança de visão, primário-backup, recuperação após falha, reconfiguração, quóruns
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Este artigo apresenta uma versão atualizada da Viewstamped Replication, uma técnica de replicação que lida com falhas em que os nós sofrem uma parada (crash). Ele descreve como as requisições dos clientes são tratadas, como o grupo se reorganiza quando uma réplica falha e como uma réplica que falhou consegue voltar ao grupo. O artigo também descreve várias otimizações importantes e apresenta um protocolo para tratar reconfigurações, capaz de mudar tanto os membros do grupo quanto o número de falhas que o grupo consegue tolerar.

## Visão geral

A Viewstamped Replication (VR) foi descrita pela primeira vez por Brian Oki e Barbara Liskov em 1988, mais ou menos na mesma época do Paxos ([O parlamento de meio período](/papers/paxos-part-time-parliament)), mas sem conhecimento dele. Este relatório técnico do MIT de 2012 (MIT-CSAIL-TR-2012-021) a reescreve para uma nova geração de leitores. Os artigos originais explicavam a VR dentro de um banco de dados e de um sistema de arquivos, o que dificultava separar o protocolo da aplicação. Aqui ela é apresentada isoladamente, em uma rede assíncrona onde os nós só falham por parada.

Os autores insistem que a VR é um protocolo de replicação, não de consenso: ela usa consenso, com um protocolo muito parecido com o Paxos, como parte do suporte a uma máquina de estados replicada, a abordagem descrita em [Implementing Fault-Tolerant Services Using the State Machine Approach](/papers/state-machine-approach-fault-tolerant-services-tutorial). Compare com o [Paxos Made Simple](/papers/paxos-made-simple) e o [Raft](/papers/raft-understandable-consensus-algorithm), que descrevem a mesma família de protocolos baseados em líder por outros ângulos. O artigo também credita ao trabalho posterior sobre tolerância a falhas bizantinas (veja [Practical Byzantine Fault Tolerance](/papers/practical-byzantine-fault-tolerance)) várias de suas melhorias.

Vale conhecer antes: replicação de máquina de estados (réplicas que começam no mesmo estado e executam as mesmas operações determinísticas na mesma ordem permanecem idênticas), quóruns por maioria e o modelo assíncrono, em que o silêncio de um nó não diz nada sobre ele ter falhado. Como contexto, o resultado de impossibilidade do [FLP](/papers/flp-impossibility-of-distributed-consensus) explica por que esses protocolos dependem de timeouts e por que uma mudança de visão pode começar sem necessidade.

## Contribuição

- **Um protocolo separado da aplicação.** A VR com 2f + 1 réplicas tolera f falhas por parada. Um primário ordena as requisições dos clientes e os backups aceitam essa ordem.
- **Três subprotocolos.** Processamento normal, mudanças de visão para escolher um novo primário e recuperação de uma réplica que parou.
- **Sem disco no caminho crítico.** O protocolo não exige escritas em disco durante o processamento das requisições nem durante as mudanças de visão. A persistência vem do estado replicado: o estado volátil de f + 1 réplicas é usado como estado estável.
- **Um protocolo de reconfiguração.** Uma requisição especial leva o sistema a uma nova época com um novo grupo, que pode mudar os membros e também o limite f.
- **Mecanismos práticos.** Checkpoints com árvores de Merkle para transferência de estado, witnesses, batching e duas formas de acelerar leituras.

## Metodologia

O relatório é uma especificação de protocolo com argumentos informais de correção. Primeiro fixa as premissas (apenas falhas por parada, mensagens podem ser perdidas, atrasadas, reordenadas ou duplicadas, sem atacante que forje mensagens) e explica por que 2f + 1 réplicas é o mínimo em uma rede assíncrona. Cada subprotocolo é então escrito como uma sequência numerada de mensagens (PREPARE, PREPAREOK, COMMIT, STARTVIEWCHANGE, DOVIEWCHANGE, STARTVIEW, RECOVERY, RECOVERYRESPONSE) e do estado que uma réplica mantém (número da visão, status, op-number, log, commit-number, tabela de clientes).

A seção 8 argumenta segurança e vivacidade para mudanças de visão, recuperação e reconfiguração, incluindo um cenário com três réplicas que mostra por que uma única troca de mensagens DOVIEWCHANGE estaria errada. Não há implementação nem medição neste relatório: as afirmações de desempenho se apoiam nos sistemas anteriores citados (Harp e PBFT).

## Resultados

Estes são os pontos que o relatório estabelece.

- **O commit exige f + 1 cópias.** O primário considera uma operação confirmada quando recebe f mensagens PREPAREOK de backups diferentes, de modo que a operação está nos logs de pelo menos f + 1 réplicas.
- **Mudanças de visão preservam as operações confirmadas.** O novo primário reúne f + 1 mensagens DOVIEWCHANGE e adota o log com o maior número de última visão normal (depois o maior op-number). A interseção de quóruns garante que toda operação confirmada aparece ali, na mesma ordem. As réplicas precisam parar de aceitar PREPARE de visões antigas assim que iniciam uma mudança de visão, ou dois primários poderiam ficar ativos.
- **A recuperação usa estado volátil.** Uma réplica em recuperação precisa de f + 1 mensagens RECOVERYRESPONSE com o seu nonce, incluindo uma do primário da visão mais recente, então f + 2 réplicas precisam se comunicar. O artigo avisa que, se todas as réplicas falharem ao mesmo tempo, o estado se perde, por isso as réplicas devem falhar de forma independente (por exemplo com UPS, memória não volátil ou locais diferentes).
- **Checkpoints mantêm os logs pequenos.** A cada O operações (da ordem de 100 ou 1000) a aplicação tira um snapshot do estado, e uma árvore de Merkle indica a um nó em recuperação quais páginas diferem.
- **A reconfiguração pausa o serviço.** A requisição de reconfiguração é a última da época antiga, a nova época começa na visão 0 e os clientes não são atendidos até que f' + 1 réplicas novas terminem a transferência de estado. Aquecer os nós novos antes encurta a pausa.
- **Leituras podem ser mais baratas.** Leituras no primário (com leases e taxas de relógio aproximadamente sincronizadas) evitam o protocolo. Leituras nos backups dão causalidade, mas não consistência externa.

## Análise crítica

Esta é a descrição mais clara de um protocolo que antecede o Paxos e corre em paralelo a ele, e é a referência usual sobre a VR. Alguns limites merecem atenção.

- **A correção é argumentada de modo informal.** As seções de segurança e vivacidade são prosa cuidadosa, não provas, e nada é verificado por máquina.
- **"Mais simples e mais rápido" não é medido.** A introdução diz que o protocolo é mais simples e tem desempenho melhor que o original, mas este relatório não traz experimentos.
- **A recuperação sem disco depende de uma premissa.** A independência de falhas é uma propriedade da implantação que o protocolo não consegue verificar, e uma falha correlacionada de todas as réplicas perde estado.
- **Só falhas por parada.** Não há defesa contra comportamento bizantino nem contra mensagens forjadas, a menos que se adicionem canais seguros.
- **Lacunas práticas.** Os clientes têm uma requisição pendente por vez, o primário é escolhido em rodízio pela ordem dos endereços IP, localizar o grupo exige um mecanismo externo e a reconfiguração interrompe o processamento de requisições por um tempo.

Livro vs hoje: a estrutura de líder mais log descrita aqui é o que os praticantes hoje associam ao Multi-Paxos e ao Raft. O relatório diz que a VR não precisava de E/S de disco durante o seu protocolo de consenso, ao contrário do Paxos, mas a maioria dos sistemas em produção ainda persiste o log, então o projeto sem disco é melhor lido como uma opção do que como a norma.

## Pesquisas futuras

- Especificação formal e prova mecanizada dos protocolos de mudança de visão, recuperação e reconfiguração.
- Medições da VR contra sistemas no estilo Paxos e no estilo Raft, que este relatório deixa em aberto.
- Projetos de recuperação que toleram falhas correlacionadas ou combinam estado replicado com armazenamento durável.
- Reconfiguração com menos indisponibilidade do que parar o grupo antigo.
- Descendentes bizantinos da VR, como o PBFT, que a autora discute em um capítulo separado de 2010 sobre a história do protocolo.
