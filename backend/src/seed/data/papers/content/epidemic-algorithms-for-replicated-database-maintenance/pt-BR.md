---
title: "Algoritmos epidêmicos para a manutenção de bancos de dados replicados"
summary: Demers e colegas do Xerox PARC mostram como manter centenas de réplicas de um banco convergindo sem coordenador, com três métodos aleatórios (direct mail, anti-entropy e rumor mongering) analisados com epidemiologia e ajustados nos servidores Clearinghouse da Xerox Corporate Internet.
researchArea: Sistemas distribuídos
keywords: algoritmos epidêmicos, banco de dados replicado, anti-entropy, rumor mongering, death certificates, distribuição espacial, consistência eventual, Clearinghouse
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

Quando um banco de dados é replicado em muitos sites, manter a consistência mútua entre eles diante de atualizações é um problema significativo. Este artigo descreve vários algoritmos aleatórios para distribuir atualizações e conduzir as réplicas à consistência. Os algoritmos são muito simples e exigem poucas garantias do sistema de comunicação subjacente, e mesmo assim asseguram que o efeito de toda atualização acabe refletido em todas as réplicas. O custo e o desempenho dos algoritmos são ajustados pela escolha de distribuições adequadas no passo de sorteio. Os algoritmos são muito análogos a epidemias, e a literatura de epidemiologia ajuda a entender seu comportamento. Um deles foi implementado nos servidores Clearinghouse da Xerox Corporate Internet, resolvendo problemas antigos de tráfego alto e de inconsistência do banco.

## Visão geral

O artigo (PODC 1987) parte do serviço de nomes Clearinghouse da Xerox Corporate Internet (CIN), com algumas centenas de Ethernets e de servidores. Alguns domínios ficavam em todos os servidores. No início de 1986, muitos problemas de desempenho observáveis da rede vinham do tráfego gasto para manter esses domínios consistentes. O anti-entropy deveria rodar uma vez por noite e muitas vezes não terminava. Depois dele havia uma etapa de reenvio: para um domínio em 300 sites, 90.000 mensagens de correio podiam ser introduzidas numa noite. Os autores a desligaram, viram que links-chave ainda ficariam sobrecarregados, e daí saiu o restante do trabalho.

O objetivo não é serializabilidade de cópia única, e sim concordância eventual: cada atualização entra em um site e deve chegar a todos os outros ou ser substituída por uma atualização posterior. Um par com timestamp maior sempre substitui um com timestamp menor. A alternativa que os autores rejeitam é um site primário que distribui as atualizações, que "sofre de controle centralizado", e os esquemas de entrega garantida ou em anel de trabalhos anteriores. Eles exigem apenas a entrega eventual de mensagens repetidas.

Vale conhecer antes: timestamps como ordem total das atualizações e os estados suscetível, infectado e removido de um modelo simples de epidemia. O próprio artigo fala em epidemias e nunca usa a palavra gossip, que sistemas posteriores adotaram para esse estilo. [Session Guarantees](/papers/session-guarantees-for-weakly-consistent-replicated-data), de um grupo que se sobrepõe no Xerox PARC, usa anti-entropy entre réplicas e acrescenta garantias sobre o que um cliente enxerga. [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store), [Cassandra](/papers/cassandra-decentralized-structured-storage-system) e [SWIM](/papers/swim-scalable-weakly-consistent-infection-style-process-group-membership-protocol) são sistemas posteriores que usam ideias de gossip ou de anti-entropy (veja a Análise crítica). O ensaio de Vogels, [Eventually Consistent](/papers/eventually-consistent-vogels), dá o vocabulário do modelo de consistência.

## Contribuição

- **Três métodos.** Direct mail: cada atualização nova é enviada de imediato pelo site de entrada a todos os outros, oportuna mas pouco confiável, pois os sites nem sempre conhecem todos os demais e o correio às vezes perde mensagens. Anti-entropy: cada site escolhe regularmente outro site ao acaso e resolve as diferenças trocando o conteúdo dos bancos, extremamente confiável mas caro. Rumor mongering: um site com um "boato quente" o compartilha periodicamente com sites aleatórios e deixa de tratá-lo como quente depois de tentar sites demais que já o conheciam, então pode falhar.
- **Vocabulário epidêmico.** Um site é infectado (disposto a compartilhar a atualização), suscetível (ainda não a recebeu) ou removido (a tem, mas não a compartilha mais). O anti-entropy é uma "epidemia simples" (sites só suscetíveis ou infectados), o rumor mongering uma "epidemia complexa".
- **Eixos de projeto do rumor mongering.** Blind ou feedback, counter ou coin, push ou pull, mais minimization, limite de conexões e hunting. O anti-entropy tem push, pull e push-pull.
- **Death certificates** para espalhar remoções, e **dormant death certificates** para guardá-los barato por muito tempo, com um segundo timestamp de ativação.
- **Distribuições espaciais** para escolher parceiros, com uma distribuição que depende do número acumulado de sites a distância d ou menos, Q(d).

## Metodologia

O artigo combina análise, simulação e uma implantação. A análise usa modelos determinísticos da epidemiologia (a fonte citada é o livro de Bailey): recorrências para o anti-entropy e um par de equações diferenciais para os boatos. As simulações usam 1000 sites nas tabelas de escolha uniforme e 250 execuções (anti-entropy) ou 200 tentativas (rumor mongering) na topologia real da CIN, cada uma propagando uma única atualização a partir de um site sorteado. As grandezas são o resíduo s (suscetíveis que sobram quando a epidemia acaba), o tráfego m (atualizações enviadas divididas pelos sites) e dois atrasos: t_ave (média sobre os sites) e t_last (último site alcançado). O tráfego por link é medido em comparações ou atualizações por link por ciclo, com o link transatlântico para Bushey, Inglaterra, acompanhado à parte. O anti-entropy com distribuição 1/Q(d)^2 foi então implementado e instalado na CIN; o artigo não tabula medições da implantação em si, apenas chama a melhora de "dramática" e repete na conclusão os fatores simulados (mais de 4 no tráfego médio por link, 30 nos links críticos).

## Resultados

- **O anti-entropy converge rápido.** A partir de um site infectado, uma epidemia simples alcança todos em tempo esperado proporcional ao log do tamanho da população. Para push a fórmula exata é log2(n) + ln(n) + O(1), citando Pittel. Como reserva depois do direct mail, com poucos suscetíveis restantes, o pull segue p(i+1) = p(i)^2, enquanto o push segue p(i+1) = p(i) (1 - 1/n)^(n(1-p(i))), cerca de p(i) e^-1, e por isso os autores esperam que pull ou push-pull sejam bem melhores que push nesse caso.
- **Resíduo dos boatos.** O modelo ds/dt = -si, di/dt = si - (1/k)(1-s)i dá i(s) = ((k+1)/k)(1-s) + (1/k) log s e um resíduo s = e^(-(k+1)(1-s)): cerca de 20% não ouvem o boato com k = 1 e 6% com k = 2. Para as variantes push o artigo afirma s = e^(-m) e diz ter verificado isso empiricamente, sem prova.
- **Boatos simulados (1000 sites).** Push com feedback e contadores: k = 1 dá resíduo 0,176 com m = 1,74, k = 5 dá 0,0012 com m = 6,68 (t_last em torno de 17). Blind e probabilístico (coin): k = 1 deixa 0,960, k = 5 deixa 0,008. Pull com feedback e contadores: k = 3 dá resíduo 4,0 x 10^-6 com m = 6,09, e o artigo relata s = e^(-Theta(m^3)) para sua recorrência.
- **Limite de conexões.** O artigo conclui que o push melhora e o pull piora com um limite de conexões, e que procurar outro site (hunting) ajuda.
- **Remoção.** Os dormant death certificates dão uma melhora O(n) no histórico retido para o mesmo espaço (de 30 dias para vários anos no sistema deles), mas o limiar de retenção tau1 precisa crescer como O(log n) com a rede, ou as reativações se acumulam em cascata.
- **Distribuições espaciais.** Em uma linha, probabilidade proporcional a d^-a dá tráfego por link O(log n) com a = 2, e d^-2 é sugerida. Na CIN com anti-entropy push-pull (Tabela 4), passar de uniforme para a = 2,0 eleva t_last de 7,81 para 13,32 ciclos, reduz o tráfego médio de comparação de 5,87 para 1,36 e o do link de Bushey de 75,74 para 2,38 (mais de 30 vezes). Com limite de conexões 1 (Tabela 5), o de Bushey vai de 47,54 para 0,94.
- **Boatos na CIN.** O rumor mongering push-pull iguala esses resultados quando k é aumentado (k = 6 com a = 2,0, Tabela 6). O push puro precisou de k = 36 com a = 1,2, e valores maiores de a não terminaram durante a noite.

## Análise crítica

O artigo é franco sobre seus limites. O projeto aleatório impede afirmações como "converge em tempo proporcional ao diâmetro": o máximo que se afirma é que a probabilidade de não ter convergido decai exponencialmente. A lei s = e^(-m) é empírica quando o tráfego varia, o resultado do pull vem de uma recorrência, e os tempos de convergência espaciais são inferidos de "equações informais e simulações". Os modelos epidêmicos supõem mistura homogênea, e as simulações cobrem o Clearinghouse e a topologia da CIN. Os autores dizem que topologias patológicas causam problemas e dão dois exemplos pequenos em que o rumor mongering falha com distribuições espaciais, por isso o sustentam com anti-entropy.

Outros limites. As falhas são do tipo parada: correio perdido, sites fora do ar por horas ou dias, perda permanente de sites; nada arbitrário ou malicioso. Conflitos são resolvidos pelo timestamp maior, o que supõe relógios próximos do horário de Greenwich (senão os algoritmos "funcionam formalmente, mas não na prática"), então escritas concorrentes são decididas só pelo timestamp maior. Existe uma versão mais longa (28 páginas) como relatório Xerox CSL-89-1 e na ACM SIGOPS Operating Systems Review 22(1), 1988; esta análise segue a cópia do PODC, e o relatório serviu só para conferência.

Literatura posterior, fora do artigo. As próprias páginas do catálogo dizem que o Dynamo usa anti-entropy com árvores de Merkle e gossip, que o Cassandra usa o Scuttlebutt, um mecanismo de gossip com anti-entropy, para a participação no grupo, e que o SWIM espalha mudanças de participação embarcando-as nas suas sondas. Só conheço isso por essas páginas, não relendo os originais. O [Keeping CALM](/papers/keeping-calm-when-distributed-consistency-is-easy) menciona tombstones e sua reclamação preguiçosa, o mesmo problema de contabilidade que os death certificates resolvem, e os [CRDTs](/papers/conflict-free-replicated-data-types) oferecem regras de fusão em vez de vence-o-maior-timestamp.

## Pesquisas futuras

- Os autores listam o estudo de topologias patológicas, a análise e o projeto de epidemias e uma hierarquia dinâmica de servidores (cuja manutenção é a parte difícil).
- Uma prova da relação s = e^(-m) e do comportamento com limite de conexões.
- Análises posteriores de espalhamento de boatos, por exemplo Karp, Schindelhauer, Shenker e Vocking, "Randomized rumor spreading" (FOCS 2000); conferi só os metadados, não o conteúdo.
- Trocar timestamps de relógio de parede por relógios lógicos, como no [artigo de Lamport](/papers/lamport-time-clocks-ordering-of-events), é uma questão de projeto que o artigo não aborda.
