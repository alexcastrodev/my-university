---
title: "Paxos vs Raft: chegamos a um consenso sobre o consenso distribuído?"
summary: Howard e Mortier reescrevem uma versão simplificada do Multi-Paxos com a terminologia do Raft e concluem que os dois algoritmos diferem apenas na eleição de líder, de modo que boa parte do apelo do Raft vem da apresentação, enquanto a eleição dele é surpreendentemente barata porque nenhuma entrada de log trafega durante o processo.
researchArea: Sistemas distribuídos
keywords: paxos, raft, consenso, eleição de líder, replicação de máquina de estados, compreensibilidade, multi-paxos
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

O consenso distribuído é uma primitiva fundamental para construir sistemas distribuídos tolerantes a falhas e com consistência forte. Embora muitos algoritmos de consenso tenham sido propostos, apenas dois dominam os sistemas em produção: o Paxos, o algoritmo tradicional e notoriamente sutil, e o Raft, mais recente e posicionado como alternativa mais compreensível ao Paxos.

Este artigo pergunta qual dos dois, Paxos ou Raft, é a melhor solução para o consenso distribuído. Os autores analisam ambos para determinar exatamente como diferem, descrevendo uma versão simplificada do Paxos com a terminologia e as abstrações pragmáticas do Raft.

Os dois algoritmos seguem uma abordagem muito parecida e diferem apenas na eleição de líder. Em especial, o Raft só deixa servidores com log atualizado virarem líder, enquanto o Paxos deixa qualquer servidor ser líder, desde que depois atualize o próprio log. A abordagem do Raft é surpreendentemente eficiente para o quão simples é, pois, ao contrário do Paxos, não exige troca de entradas de log durante a eleição. Os autores supõem que boa parte da compreensibilidade do Raft vem da apresentação clara do artigo, e não do algoritmo em si.

## Visão geral

Um artigo curto de workshop (PaPoC 2020, junto do EuroSys) da Universidade de Cambridge. Em 2020 os sistemas em produção estavam divididos: o artigo lista Megastore, Chubby, Omega, Azure Data Lake Store, Borg e PaxosStore do lado do Paxos, e Atomix, CockroachDB, Consul, etcd, Kubernetes, M3 e Trillian do lado do Raft. O Paxos vem de [The Part-Time Parliament](/papers/paxos-part-time-parliament) e de [Paxos Made Simple](/papers/paxos-made-simple), e as lacunas de engenharia aparecem em [Paxos Made Live](/papers/paxos-made-live-engineering-perspective). O Raft é o artigo [In Search of an Understandable Consensus Algorithm](/papers/raft-understandable-consensus-algorithm), com o tratamento completo na [tese do Raft](/papers/consensus-bridging-theory-and-practice-raft-thesis).

O cenário é a replicação de máquina de estados ([tutorial de Schneider](/papers/state-machine-approach-fault-tolerant-services-tutorial)): todo servidor aplica as mesmas operações na mesma ordem, e o cliente enxerga um serviço [linearizável](/papers/linearizability-correctness-condition-concurrent-objects). O artigo assume ausência de falhas bizantinas, sistema assíncrono e entrega de mensagens confiável e em ordem (TCP). Relógios não são necessários para a segurança, só para a vivacidade, como exige o [resultado FLP](/papers/flp-impossibility-of-distributed-consensus).

Vale saber antes: quóruns de maioria, termos (também chamados de views ou ballots) e o log replicado com líder.

## Contribuição

- **Um Paxos simplificado a partir de uma revisão.** Como o Paxos é uma família cujas descrições variam de artigo para artigo, os autores examinam a literatura e escrevem uma única versão multi-decreto, mais próxima do uso atual do que da descrição original.
- **O vocabulário do Raft aplicado ao Paxos.** A versão usa o estado, as RPCs (RequestVote, AppendEntries) e as regras do Raft, o que permite comparar os dois linha a linha (Apêndices A e B).
- **A tese central.** Os algoritmos diferem apenas na eleição de líder, de três maneiras (veja Resultados).
- **Um veredito sobre as três vantagens atribuídas ao Raft.** Apresentação, simplicidade e uma eleição nova: os autores atribuem a maior parte do apelo à primeira.
- **Um mapeamento para o Paxos clássico.** A Seção 5 relaciona o papel único de "servidor", os termos e as fases com proposer, acceptor e learner, ballots e fases 1 e 2.

## Metodologia

O artigo é uma comparação conceitual, não um experimento. Os dois protocolos partilham o mesmo esqueleto: servidores são seguidores, candidatos ou líderes; os termos crescem de forma monotônica; o líder anexa a operação com o seu termo ao log, envia AppendEntries aos demais e confirma (commit) quando uma maioria responde. Um seguidor só aceita entradas se a entrada anterior bater com o log do líder, o que mantém os logs em ordem e sem lacunas.

Em seguida os protocolos são comparados fase a fase.

- **Fase 1 no Paxos.** Um seguidor que estoura o timeout assume o próximo termo t tal que t mod n = s (s é o seu id). Ele envia RequestVote com o termo e o índice de commit. Um servidor responde positivamente se o termo for maior que o seu, anexando as entradas de log posteriores ao índice de commit do candidato. Com respostas de uma maioria, o candidato preenche cada índice seguinte com a entrada de maior termo que viu, marca essas entradas com o novo termo e vira líder.
- **Fase 1 no Raft.** O candidato pode usar qualquer termo, incrementa-o e envia o termo e o índice da sua última entrada. O servidor vota se o termo não for menor, se ainda não votou naquele termo e se o log do candidato estiver pelo menos tão atualizado quanto o seu. Com votos de uma maioria o candidato vira líder na hora.
- **Fase 2 nos dois.** Replicação por AppendEntries, com uma regra de commit diferente (abaixo).

A segurança é argumentada com um esboço de prova de Leader Completeness por indução sobre os termos, apresentado no texto para o Paxos. Os autores afirmam que a prova do Raft usa a mesma indução, com detalhes diferentes. A comparação deixa de fora coleta de lixo, compactação de log, leituras e reconfiguração.

## Resultados

A Tabela 1 resume três diferenças, todas na eleição de líder.

- **Líderes por termo.** O Paxos dá a cada servidor os seus próprios termos (t mod n = s), então há no máximo um candidato por termo. No Raft qualquer seguidor pode ser candidato em qualquer termo, e cada seguidor vota em um único candidato por termo.
- **Levar as entradas confirmadas ao novo líder.** Os seguidores do Paxos votam em qualquer candidato e mandam de volta suas entradas de log, que o candidato adota. O Raft só concede o voto a um candidato com log pelo menos tão atualizado quanto o do seguidor, então o candidato só vence se o seu log estiver pelo menos tão atualizado quanto o de uma maioria.
- **Entradas de termos anteriores.** O Paxos as remarca com o termo do líder e as replica como se fossem novas, e por isso é seguro confirmá-las assim que estiverem em uma maioria. O Raft mantém o termo original, e o líder só pode confirmá-las depois de confirmar uma entrada posterior do seu próprio termo.

Sobre compreensibilidade, os autores sentem que o par único (índice, termo) por operação do Raft é um pouco mais intuitivo do que o Paxos, onde uma entrada pode ser remarcada (operações B e C na Figura 2b), mas concluem que o Raft é "um pouco mais compreensível, porém não de forma significativa". Sobre eficiência, esperam eleições mais lentas e mais variáveis no Raft, porque candidatos simultâneos podem dividir os votos e o Raft acrescenta uma espera aleatória. Em troca, a eleição é mais leve: nenhuma entrada de log vai nos votos, enquanto o Paxos pode reenviar uma entrada sob um novo termo. No saldo: sem diferença significativa de compreensibilidade, e a eleição do Raft é "surpreendentemente leve".

## Análise crítica

O que o artigo não afirma importa tanto quanto o que afirma.

- **Não é uma prova de equivalência.** A comparação é entre o Paxos simplificado pelos próprios autores e o Raft. Ela cobre só decisões em ordem, com papel único de servidor e sem preenchimento de lacunas no log, o que o artigo reconhece não ser necessário, mas evita complexidade. O Multi-Paxos com decisões fora de ordem fica fora da comparação.
- **Nenhuma medição de desempenho.** As afirmações de eficiência são raciocínio ("esperamos") e contagem de mensagens. Nenhum benchmark é executado, e os dois algoritmos são chamados de ingênuos por construção.
- **Compreensibilidade é um julgamento, não um estudo.** A evidência é o "sentimos". Em contraste, o resumo da tese do Raft relata um estudo com estudantes, e este artigo não o repete.
- **Escopo.** Compactação, leituras e reconfiguração, onde os sistemas reais mais divergem, ficam de fora.
- **Nenhuma variante é proposta.** O artigo apenas sugere que o Raft pode agora aproveitar décadas de otimizações do Paxos e vice-versa. Não propõe um Raft com quóruns flexíveis. O [Paxos flexível](/papers/flexible-paxos-quorum-intersection-revisited), também de Howard, é um vizinho do catálogo, mas não é citado aqui.
- **Literatura posterior:** não foi lida para esta nota.

## Pesquisas futuras

- Levar otimizações do Paxos, como o [EPaxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments), para apresentações no estilo do Raft, e trabalhos do lado Raft, como o de leitura "líder ou maioria" da referência [1], para o Paxos.
- Medir o tempo de eleição e sua variância, e os bytes movidos durante as eleições, que o artigo apenas prevê.
- Fazer estudos controlados de compreensibilidade, já que o artigo não traz nenhum.
- Estender a comparação linha a linha para compactação de log, leituras e reconfiguração. O [Viewstamped Replication Revisited](/papers/viewstamped-replication-revisited), parente com líder que o artigo não cita, é uma terceira coluna natural.
