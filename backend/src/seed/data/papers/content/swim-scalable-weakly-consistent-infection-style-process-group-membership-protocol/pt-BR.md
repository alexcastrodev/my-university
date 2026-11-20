---
title: "SWIM: protocolo escalável e fracamente consistente de pertinência a grupos de processos em estilo de infecção"
summary: Das, Gupta e Motivala trocam o heartbeating todos-para-todos por um protocolo de pertinência que sonda um membro aleatório por período, pede a k outros que sondem em seu nome e espalha as mudanças de pertinência por piggyback nessas sondagens, de modo que a carga por membro e o tempo esperado de detecção ficam constantes à medida que o grupo cresce.
researchArea: Sistemas distribuídos
keywords: swim, pertinência a grupos, detector de falhas, gossip, disseminação epidêmica, suspeita, número de incarnation
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Several distributed peer-to-peer applications require weakly-consistent knowledge of process group membership information at all participating processes. SWIM is a generic software module that offers this service for large-scale process groups. The SWIM effort is motivated by the unscalability of traditional heart-beating protocols, which either impose network loads that grow quadratically with group size, or compromise response times or false positive frequency w.r.t. detecting process crashes. This paper reports on the design, implementation and performance of the SWIM sub-system on a large cluster of commodity PCs. Unlike traditional heartbeating protocols, SWIM separates the failure detection and membership update dissemination functionalities of the membership protocol. Processes are monitored through an efficient peer-to-peer periodic randomized probing protocol. Both the expected time to first detection of each process failure, and the expected message load per member, do not vary with group size. Information about membership changes, such as process joins, drop-outs and failures, is propagated via piggybacking on ping messages and acknowledgments. This results in a robust and fast infection style (also epidemic or gossip-style) of dissemination. The rate of false failure detections in the SWIM system is reduced by modifying the protocol to allow group members to suspect a process before declaring it as failed: this allows the system to discover and rectify false failure detections. Finally, the protocol guarantees a deterministic time bound to detect failures. Experimental results from the SWIM prototype are presented. We discuss the extensibility of the design to a WAN-wide scale.

## Visão geral

O problema é manter, em cada membro de um grupo grande, a lista dos membros que não falharam. O artigo (DSN 2002, Cornell) parte da observação de que a resposta usual, o heartbeating, não escala. Um servidor central vira ponto quente, difundir heartbeats a todos custa uma carga que cresce quadraticamente com o tamanho do grupo, e um anel lógico tem tempo de detecção imprevisível quando vários membros falham. O detector em estilo gossip de van Renesse e colegas, citado no artigo, também precisa de largura de banda que cresce com n e de uma lista de contadores que deixa de caber num pacote UDP. Os autores argumentam que o custo quadrático vem de fundir duas tarefas: detectar falhas e disseminar atualizações de pertinência. O SWIM as separa.

A pertinência oferecida é fraca de propósito: as listas dos membros não precisam concordar no mesmo ponto causal do tempo. Garantias mais fortes (sincronia virtual) ficam para camadas acima, e o artigo diz que elas podem ter limites fundamentais de escalabilidade. É o extremo oposto de serviços de coordenação como o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) e o [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems), onde a pertinência é mantida com consistência forte num núcleo replicado pequeno. Combina com a pertinência por gossip do [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) e com os grupos de réplicas de armazenamentos em anel como o [Chord](/papers/chord-scalable-peer-to-peer-lookup-service), que o artigo cita como alvos. Os limites do que um detector de falhas pode prometer vêm do [FLP](/papers/flp-impossibility-of-distributed-consensus), citado no artigo: um processo que perde mensagens não se distingue de um que falhou.

Vale saber antes: o que significa um timeout UDP num detector de falhas, por que "lento" e "morto" parecem iguais vistos de fora, e a ideia de uma epidemia que se espalha de forma exponencial.

## Contribuição

- **Separação entre detecção e disseminação.** Um detector de falhas (sondagem) e um componente de disseminação (atualizações de pertinência) são projetados de forma independente.
- **Sondagem aleatória com sondas indiretas.** A cada período de protocolo de duração T', um membro M_i envia ping a um membro aleatório M_j. Se o ack não chega a tempo, envia ping-req(M_j) a k membros aleatórios, cada um dos quais faz ping em M_j e repassa o ack. Se nada chega até o fim do período, M_j é declarado falho. O caminho indireto evita culpar M_j por congestionamento no enlace entre M_i e M_j. As propriedades (1) e (2) das cinco que o artigo lista vêm de um detector anterior de Gupta, Chandra e Goldszmidt (PODC 2001).
- **Disseminação em estilo de infecção.** As atualizações viajam em ping, ping-req e ack, num buffer em que cada atualização tem um contador local de envios, no máximo lambda log n, e as menos enviadas saem primeiro. Sem pacotes extras e sem multicast. Duas listas (ainda não falhos, falhos recentes) dividem igualmente os espaços de piggyback.
- **Subprotocolo de suspeita.** O membro que não recebe ack marca o alvo como Suspect e espalha isso. Um Confirm, depois de um time-out, declara o alvo falho, e um Alive vindo do próprio alvo limpa a suspeita.
- **Números de incarnation.** O número de um membro começa em 0 ao entrar e só ele pode aumentá-lo, ao saber que é suspeito, para emitir Alive(inc+1).
- **Alvos em round-robin.** Os alvos saem em ordem de uma lista que é reembaralhada a cada volta, e novos membros entram em posição aleatória, o que transforma o tempo médio de detecção em um limite de pior caso.

## Metodologia

A análise é em parte herdada e em parte nova. Os resultados de tempo de detecção e de falsos positivos do detector básico são resumidos do artigo anterior, e o texto manda o leitor deduzi-los ou consultá-lo ("The reader is encouraged to work out these results"). A análise da disseminação é nova e usa o modelo epidêmico determinístico de Bailey, para um grupo de mistura homogênea com um único infectado inicial.

O protótipo usa Winsock 2 no Windows 2000 sobre UDP. O cluster tem 16 Dell PII de 450 MHz, 16 IBM x220 de 1 GHz e nós duplos e quádruplos de 200 a 500 MHz, em Ethernet de 100 Mbps sem carga externa, com no máximo um membro por nó. Parâmetros: k = 1 alvo de ping-req, período de protocolo de 2 s, cada atualização enviada por piggyback no máximo 3 vezes ceil(log(N+1)), e o mesmo valor para o time-out de suspeita. Comparam-se três variantes: SWIM:Basic (disseminação por multicast, mas com round-robin), SWIM+Inf. (estilo de infecção) e SWIM+Inf.+Susp. (com suspeita). A carga de mensagens é medida ao longo de 40 períodos de protocolo.

## Resultados

- **Tempo de detecção.** A chance de um dado membro ser escolhido como alvo por alguém em um período é 1 - (1 - q_f/n)^(n-1), que tende a 1 - e^(-q_f), sendo q_f a fração de membros não falhos. O tempo esperado entre a falha e a detecção por algum membro é, portanto, no máximo T' / (1 - e^(-q_f)). T' deve ser pelo menos três vezes a estimativa do tempo de ida e volta.
- **Falsos positivos.** Tomando q_ml como a probabilidade de entrega no prazo, independente entre pacotes, um membro não falho é detectado falsamente num período com probabilidade q_f (1 - q_ml^2) (1 - q_f q_ml^4)^k e^(q_f)/(e^(q_f) - 1), o que dá k a partir de uma taxa-alvo de falsos positivos. O artigo diz que essas propriedades não dependem de n, exceto assintoticamente.
- **Carga.** A carga esperada de mensagens por membro é constante e simétrica. Por período, um membro envia um ping e um ack e recebe o mesmo. O tamanho das mensagens é limitado: no máximo 15 B no SWIM:Basic e 135 B com no máximo 6 atualizações por piggyback, contra 250 B só para 50 heartbeats de 5 bytes.
- **Disseminação.** Com taxa de contato 2/n - 1/n^2, depois de lambda log n períodos o número esperado de infectados é de cerca de n - n^(-(2 lambda - 2)) membros. Um lambda pequeno e constante basta, "mesmo em grupos pequenos".
- **Completude com limite de tempo.** Com round-robin, escolhas sucessivas do mesmo alvo ficam a no máximo 2 n_i - 1 períodos de distância, então uma falha é detectada em cada membro em cerca de duas vezes o tamanho do grupo, em períodos.
- **Carga medida.** Até 55 membros, a sobrecarga média fica em torno de 2,0 mensagens por período. Com N = 28, as mensagens enviadas ficam abaixo de 5 por período com probabilidade 0,99.
- **Detecção e espalhamento medidos.** O tempo médio até a primeira detecção não teve correlação com o tamanho do grupo e acompanhou a estimativa analítica (plotada como e/(e-1) períodos). O tempo mediano de infecção fica em poucos períodos e sobe devagar com o tamanho do grupo.
- **Falsos positivos sob perda.** Com 10% de perda artificial de pacotes e 17 processos entrando em sequência, o SWIM+Inf.+Susp. estabilizou num grupo de 12, enquanto o SWIM:Basic terminou com 2 e o SWIM+Inf. com 4. As execuções da Figura 3 do SWIM+Inf.+Susp. geraram um número insignificante de detecções falsas.

## Análise crítica

- **Modelo de falhas e de rede.** As falhas são crashes. A análise supõe perda de pacotes independente e escolha aleatória uniforme, e a falha é julgada pela ausência do ack. Membros bizantinos, autenticação e perda correlacionada não são tratados. A suspeita "reduz (mas não elimina)" os falsos positivos, então a acurácia não é garantida.
- **Completude.** A completude forte é eventual no protocolo básico, e "é fácil ver" é a prova oferecida para as regras de preferência. Não há prova formal no artigo, e o caminho de suspeita pode prolongar a detecção.
- **Partições.** O artigo não analisa partições nem como curá-las. Relata que as execuções "não observaram evidência de" partições involuntárias nas configurações usadas. Entrar no grupo exige um contato, e a implementação mantém um coordenador.
- **Avaliação.** No máximo 55 membros, uma única rede de laboratório, e nenhuma comparação medida com um protocolo de heartbeat, só com as próprias variantes. O experimento de perda é uma execução, e os autores dizem que vale só para aquelas configurações. A extensão para WAN e a redução de uma ordem de grandeza para grupos de réplicas de DHT são afirmadas, não medidas. O compromisso do time-out de suspeita fica para um artigo futuro.
- **Números de incarnation.** O texto não discute o que acontece com mensagens antigas quando um membro sai e volta.

Literatura posterior, não afirmada pelo artigo:

- **Lifeguard.** Dadgar, Phillips e Currey (arXiv 1707.00788), de quem li só o resumo e não o artigo completo, dizem que o processamento lento de mensagens ainda pode fazer o SWIM marcar membros saudáveis como falhos apesar da suspeita, e propõem uma extensão de saúde local.
- **memberlist.** O README da HashiCorp (lido) diz que a biblioteca Go memberlist se baseia no SWIM com extensões, entre elas o Lifeguard. Não verifiquei o Serf e não faço afirmação sobre ele.

## Pesquisas futuras

- Autoajuste de k, do período e do time-out de suspeita sob carga variável, e o compromisso do time-out que os autores deixaram para depois.
- Ponderar os alvos de sondagem pela topologia em implantações WAN ou VPN (os autores estavam avaliando).
- Detectores que levem em conta um host local lento (ver Lifeguard acima) e falhas parciais como as do [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems).
- Provas formais das regras de preferência e do comportamento sob partições e reentradas.
- Uso do SWIM em grupos de réplicas de tamanho médio de uma DHT, como sugerem os autores.
