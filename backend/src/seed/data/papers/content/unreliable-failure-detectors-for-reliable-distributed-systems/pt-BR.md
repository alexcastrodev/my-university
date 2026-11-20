---
title: "Detectores de falha não confiáveis para sistemas distribuídos confiáveis"
summary: Chandra e Toueg acrescentam ao modelo assíncrono um detector de falhas abstrato que pode errar, classificam os detectores por completude e exatidão em oito classes (quatro, a menos de equivalência) e mostram que consenso e difusão atômica passam a ser solúveis com a classe eventualmente forte quando há maioria de processos corretos.
researchArea: Sistemas distribuídos
keywords: detectores de falha, consenso, difusão atômica, sistemas assíncronos, falhas por parada, completude, exatidão, sincronia parcial
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

We introduce the concept of unreliable failure detectors and study how they can be used to solve Consensus in asynchronous systems with crash failures. We characterise unreliable failure detectors in terms of two properties: completeness and accuracy. We show that Consensus can be solved even with unreliable failure detectors that make an infinite number of mistakes, and determine which ones can be used to solve Consensus despite any number of crashes, and which ones require a majority of correct processes. We prove that Consensus and Atomic Broadcast are reducible to each other in asynchronous systems with crash failures; thus, the above results also apply to Atomic Broadcast. A companion paper shows that one of the failure detectors introduced here is the weakest failure detector for solving Consensus [Chandra et al, 1992].

## Visão geral

O artigo (Journal of the ACM, 1996; uma versão preliminar saiu no PODC 1991) parte do [FLP](/papers/flp-impossibility-of-distributed-consensus): consenso e difusão atômica não têm solução determinística em um sistema assíncrono com uma única falha por parada. Os autores apontam como causa única a dificuldade de distinguir um processo que caiu de um processo "muito lento". As saídas anteriores eram aleatorização, problemas mais fracos e modelos de sincronia parcial (Dolev, Dwork e Stockmeyer, citados no texto, definem 32 modelos assim). Chandra e Toueg propõem outro caminho: manter o sistema assíncrono e dar a cada processo um módulo local que devolve uma lista de processos suspeitos, podendo incluir e retirar processos corretos à vontade.

O passo central é especificar o detector só por propriedades abstratas, sem timeouts nem parâmetros de rede. O algoritmo é provado contra essas propriedades e roda em qualquer sistema onde se consiga construir um detector com elas. Um detector errado pode custar a vivacidade, mas nunca a segurança: os processos podem deixar de decidir ou de entregar mensagens, mas nunca decidem valores diferentes nem entregam fora de ordem. É o vocabulário por trás dos temporizadores de eleição de líder e de troca de visão em implantações de [Paxos](/papers/paxos-made-simple) e [Raft](/papers/raft-understandable-consensus-algorithm), e de detectores como o [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol).

Vale saber antes: o modelo assíncrono, falhas por parada versus bizantinas e o problema do consenso (terminação, acordo, validade).

## Contribuição

- **A abstração de detector de falhas.** Um detector é uma função de padrões de falha para conjuntos de históricos, com uma lista de suspeitos por processo e instante. Dois processos podem discordar, e um detector pode suspeitar de processos corretos para sempre.
- **Duas propriedades de completude e quatro de exatidão.** Completude forte: a partir de certo ponto, todo processo que cai é suspeito permanentemente por todo processo correto. Completude fraca: por algum processo correto. Exatidão forte: nenhum processo é suspeito antes de cair. Exatidão fraca: algum processo correto nunca é suspeito. Exatidão eventual forte e eventual fraca: o mesmo, a partir de algum instante.
- **Oito classes.** Completude forte com as quatro exatidões dá Perfeito (P), Forte (S), Eventualmente Perfeito (◇P) e Eventualmente Forte (◇S). Completude fraca dá Q, Fraco (W), ◇Q e Eventualmente Fraco (◇W).
- **Redutibilidade.** Um algoritmo de redução transforma um detector em outro, de modo que tudo que se resolve com o segundo se resolve com o primeiro.
- **Algoritmos de consenso.** Um para S, que tolera qualquer número de quedas, e um para ◇S, com coordenador rotativo, que exige maioria de processos corretos.
- **Equivalência com difusão atômica** e uma hierarquia refinada de detectores "arrependidos", ordenada pelo número de erros (Apêndice).

## Metodologia

O modelo tem n processos com canais confiáveis entre cada par, sem limite para atraso de mensagem, deriva de relógio ou tempo de um passo, só falhas por parada (um processo que cai não se recupera) e ao menos um processo correto. Seguindo o FLP, um algoritmo é um conjunto de autômatos, e uma execução fixa um padrão de falhas, um histórico do detector e uma sequência infinita e justa de passos. O artigo é teórico e não tem experimentos: cada afirmação é lema ou teorema, com prova, esboço de prova ou citação explícita. A Difusão Confiável (retransmitir ao receber pela primeira vez) é usada como bloco de construção. As condições "eventualmente para sempre" são uma idealização que os autores justificam: na prática basta valerem por tempo suficiente para decidir ou progredir.

## Resultados

- **De completude fraca para forte.** O algoritmo da Figura 3 faz cada processo enviar periodicamente seus suspeitos a todos e mesclar o que recebe (retirando o remetente). Ele torna a completude fraca em forte e preserva a exatidão (Teorema 3.4), logo P = Q, S = W, ◇P = ◇Q e ◇S = ◇W (Corolário 3.5). Basta estudar quatro classes.
- **Consenso com S.** O algoritmo de três fases da Figura 5 (n - 1 rodadas assíncronas, depois troca de vetores) funciona com qualquer número de quedas (Teorema 6.1.8), então W e P também resolvem.
- **Consenso com ◇S.** O algoritmo da Figura 6 usa o coordenador (r mod n) + 1 em cada rodada, quatro fases e confirmações de ⌈(n+1)/2⌉ processos antes de difundir a decisão. Funciona com f < ⌈n/2⌉ (Teorema 6.2.3), isto é, com maioria de processos corretos.
- **A maioria é necessária.** Consenso não é solúvel com ◇P (e portanto nem com ◇S) quando f ≥ ⌈n/2⌉ (Teorema 6.3.1), por um argumento de partição com duas execuções que uma terceira torna indistinguíveis.
- **O mais fraco.** O Teorema 6.2.5 e o Corolário 6.2.6 afirmam que ◇W_0, o mais fraco da classe ◇W, é o detector mais fraco para consenso com f < ⌈n/2⌉. O artigo atribui a prova a Chandra, Hadzilacos e Toueg (1992), um artigo companheiro, e não a faz aqui.
- **Difusão atômica.** Consenso e difusão atômica são equivalentes em sistemas assíncronos (Corolário 7.1.7), então todo resultado de consenso vale para ela. A difusão atômica executa um consenso por lote de mensagens (Figura 7).
- **Hierarquia estrita.** P > S, ◇P > ◇S, P > ◇P, S > ◇S e P > ◇S, enquanto S e ◇P são incomparáveis (Teorema 8.1, provas omitidas). A Difusão Confiável com Terminação precisa de P (Teorema 8.2).
- **Apêndice.** Com f ≥ ⌈n/2⌉, o consenso é solúvel com um detector fortemente m-errante se e só se m ≤ n - f, e com um fracamente m-errante se e só se m = 0.

## Análise crítica

- **Modelo de falhas.** Só parada, canais confiáveis e sem recuperação. O artigo diz que consenso e difusão atômica também são equivalentes sob falhas bizantinas, mas omite essa redução. Consenso bizantino, como em [Byzantine Generals](/papers/byzantine-generals-problem), está fora do texto.
- **A implementação é magra.** Os detectores são abstratos. O único mecanismo concreto é um algoritmo de timeout (Figura 10, ideia de Dwork, Lynch e Stockmeyer; veja [Sincronia Parcial](/papers/consensus-in-the-presence-of-partial-synchrony)), com esboço de prova de que implementa ◇P em um modelo parcialmente síncrono com limites desconhecidos que valem após um GST desconhecido (Teorema 9.1). Não há projeto em nível de rede, ajuste de timeout nem medida de tempo de detecção ou taxa de erro. A nota 6 observa que nenhum algoritmo implementa ◇W em um sistema puramente assíncrono, pois resolveria consenso.
- **Eficiência é afirmada, não mostrada.** Os autores dizem que uma versão modificada do algoritmo de ◇S chega ao consenso em duas rodadas assíncronas na maioria das execuções, sem dados. O artigo diz tratar de solubilidade, não de eficiência.
- **Cobertura das provas.** As provas da Seção 8 foram omitidas e a do "mais fraco" está no artigo companheiro, então esses resultados dependem de citações aqui. Li o texto inteiro, mas não reverifiquei as provas.
- **Prática versus abstração.** O texto se compara ao Isis, que remove processos suspeitos por engano, e argumenta que os timeouts podem então ficar mais perto do caso médio.

Literatura posterior, não afirmada pelo artigo:

- **Raft.** O artigo do Raft (lido) usa um timeout de eleição nos seguidores e timeouts aleatórios para resolver votos divididos, e diz que a segurança não pode depender de tempo, ao contrário da disponibilidade. Isso espelha a separação entre segurança e vivacidade, mas o Raft não é descrito em classes de detectores de falha.
- **Falhas cinzentas.** Huang et al. (HotOS 2017, li o resumo e a seção de trabalhos relacionados) argumentam que detectores de falha podem não notar problemas que afetam as aplicações, e que os detectores confiáveis existentes visam falhas por parada; defendem monitoramento de saúde. Veja [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems).

## Pesquisas futuras

- Medir a qualidade dos detectores (tempo de detecção, taxa de erro) e projetá-los para redes reais, como o [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol) faz com sondagem e suspeição.
- Detectores para falhas parciais e cinzentas, além da suspeita ligado/desligado.
- Consenso que não dependa de timeouts calibrados, por exemplo o [QuePaxa](/papers/quepaxa-escaping-the-tyranny-of-timeouts-in-consensus).
- A abordagem de máquina de estados construída sobre difusão atômica: [State Machine Approach](/papers/state-machine-approach-fault-tolerant-services-tutorial).
- Estender o arcabouço a falhas bizantinas e a recuperação após queda, que o artigo deixa de fora.
