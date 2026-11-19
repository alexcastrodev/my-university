---
title: "Paxos flexível: a interseção de quóruns revisitada"
summary: Howard, Malkhi e Spiegelman observam que o Paxos só precisa que quóruns de fases diferentes se intersectem, não todos os quóruns entre si, de modo que a fase de replicação pode usar um quórum pequeno se a fase de eleição de líder usar um maior, sem perder a segurança.
researchArea: Sistemas distribuídos
keywords: paxos, paxos flexível, quóruns, consenso, multi-paxos, eleição de líder, replicação
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

O consenso distribuído é parte integrante dos sistemas distribuídos modernos. O algoritmo Paxos, amplamente adotado, usa duas fases, cada uma exigindo acordo da maioria, para chegar a consenso de forma confiável. Neste artigo, mostramos que o Paxos, que está na base de muitos sistemas de produção, é conservador. Em particular, observamos que cada fase do Paxos pode usar quóruns que não se intersectam. Quóruns por maioria não são necessários, pois a interseção só é exigida entre as fases.

Com esse enfraquecimento dos requisitos da formulação original, propomos o Flexible Paxos, que generaliza o algoritmo Paxos para oferecer quóruns flexíveis. Mostramos que o Flexible Paxos é seguro, eficiente e fácil de usar em sistemas distribuídos existentes. Discutimos as amplas implicações desse resultado. Por exemplo, a disponibilidade melhora ao reduzir em um o tamanho dos quóruns da segunda fase quando o número de nós é par, mantendo quóruns por maioria na primeira fase. Outro exemplo é o ganho de vazão da replicação ao usar quóruns de fase 2 bem menores, aumentando os quóruns de eleição de líder (fase 1). Por fim, quóruns que não se intersectam em qualquer das fases podem tornar ambas mais eficientes.

## Visão geral

O Paxos, introduzido em [O parlamento de meio período](/papers/paxos-part-time-parliament) e recontado em [Paxos simplificado](/papers/paxos-made-simple), tem duas fases: a fase 1 (prepare e promise) e a fase 2 (propose e accept). Cada fase precisa do acordo de um quórum de aceitadores, e a escolha usual é a maioria. A segurança se apoia no fato de que duas maiorias quaisquer compartilham um aceitador. No Multi-Paxos, a fase 1 roda uma vez para eleger um líder e a fase 2 roda a cada comando, então a replicação é muito mais frequente que a eleição de líder. Entre os trabalhos que o artigo cita estão o resultado de impossibilidade do [FLP](/papers/flp-impossibility-of-distributed-consensus), a [Chain Replication](/papers/chain-replication-high-throughput-availability), o [EPaxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments) e o [serviço de locks Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems).

O artigo, da VMware Research e da Universidade de Cambridge, saiu no OPODIS 2016. Ele pergunta se a exigência de que "todos os quóruns se intersectam" é mesmo necessária. A resposta é que ela é mais forte que o preciso, e a condição mais fraca libera os tamanhos dos quóruns das duas fases um do outro.

Vale conhecer antes: as fases do Paxos e os números de proposta, o líder do Multi-Paxos e a ideia de sistema de quóruns.

## Contribuição

- **A observação.** Só um quórum de fase 1 (Q1) e um quórum de fase 2 (Q2) precisam se intersectar. Dois Q1 não precisam se intersectar, nem dois Q2. O protocolo resultante se chama Flexible Paxos (FPaxos). Ele é estritamente mais geral que o Paxos, e o FPaxos com quóruns que se intersectam é equivalente ao Paxos.
- **Quóruns simples.** Quando todo aceitador conta igual, a condição vira |Q1| + |Q2| > N, e o menor Q1 para um dado Q2 é N - |Q2| + 1. O artigo dá um exemplo com 10 nós: Q2 de 3 nós e Q1 de 8.
- **Exemplos de maioria e de grade.** Com número par de aceitadores, o Q2 pode cair de N/2 + 1 para N/2 enquanto o Q1 continua uma maioria. Em uma grade de N1 colunas por N2 linhas, o Q1 pode ser uma linha e o Q2 uma coluna, de modo que quóruns da mesma fase nunca se intersectam.
- **Um argumento de segurança.** O esboço de uma prova, mais uma especificação em TLA+ do protocolo de valor único verificada por model checking contra o requisito.
- **Um protótipo e um esboço de quóruns dinâmicos.** Uma modificação do LibPaxos3 e uma discussão sobre deixar os líderes anunciarem quais quóruns usam.

## Metodologia

O artigo é sobretudo um exercício de raciocínio seguido de um pequeno experimento. A seção 3 relê o Paxos e identifica qual parte do argumento original de fato usa a interseção. A seção 4 percorre três sistemas de quóruns (maioria, simples, grade) e conta tamanhos de quórum e falhas toleradas. A seção 5 traz a prova de segurança: toma o menor número de proposta p' maior que p para o qual é enviada uma proposta conflitante, escolhe um aceitador na interseção do quórum de fase 2 de p com o quórum de fase 1 de p' e mostra, por casos sobre a ordem das mensagens, que o valor conflitante não pode existir.

No experimento, os autores modificaram o LibPaxos3, uma implementação de Multi-Paxos em C sobre TCP/IP, para que os tamanhos de Q1 e Q2 fossem parâmetros. Os quóruns simples foram escolhidos ao acaso e as mensagens iam só para um quórum. Cada réplica era aceitadora, aprendiz e possível proponente. As requisições tinham 64 bytes, com 10 em andamento, todas enviadas primeiro à mesma réplica. Tudo rodou em uma única VM Linux (um núcleo, 1 GB de RAM), com o mininet simulando uma rede de 10 Mbps e 20 ms de tempo de ida e volta. Cada execução durou 120 segundos, descartando os 10 primeiros e os 10 últimos.

## Resultados

- **Interseção entre fases basta.** Para o protocolo de valor único, a prova só precisa que todo Q1 intersecte todo Q2 (equação 3 do artigo). O model checking em TLA+ do protocolo de valor único com quóruns disjuntos preservou o requisito de segurança.
- **A tolerância a falhas depende da fase.** Com quóruns simples, o FPaxos sempre lida com até |Q2| - 1 falhas. Se entre |Q2| e N - |Q2| aceitadores falharem, a replicação continua sob o líder atual, mas nenhum líder novo pode ser eleito até que aceitadores se recuperem.
- **Em grades, importa quais nós falham, não só quantos.** Nos exemplos do artigo (grade 5 por 4 com 20 aceitadores), se quatro falhas caírem em uma só coluna, o Paxos não progride, mas o FPaxos continua até que seja preciso um novo líder.
- **Extremos.** |Q1| = N e |Q2| = 1 permite que qualquer aceitador isolado confirme um valor, mas exige todos os aceitadores para eleger um líder. |Q1| = 1 e |Q2| = N tolera f falhas com f + 1 aceitadores, como trabalhos anteriores já haviam observado.
- **Números do protótipo.** Na Figura 1, a latência do LibPaxos3 sobe e a vazão cai conforme as réplicas passam de 3 para 14. Na Figura 4, Q2 menores reduzem mensagens, o que baixa a latência e eleva a vazão. Com 8 réplicas e Q2 de tamanho 4, o FPaxos tolera mais falhas que o Paxos e vai de 42 ms para 37 ms de latência e de 198 para 264 requisições por segundo.
- **Parte do ganho não vem do tamanho do quórum.** O FPaxos superou o LibPaxos original mesmo com quóruns do mesmo tamanho, porque envia mensagens só a um quórum, e não a todas as réplicas. Os autores também notam que um Q2 de tamanho 2 não elege líder depois de duas falhas de aceitadores.
- **Seleção dinâmica.** A segurança só exige que um Q1 intersecte os Q2 usados com números de proposta menores, então um líder que anuncie seu Q2 permitiria, com N = 100f nós, um Q2 fixo de tamanho f + 1 e a tolerância a N - f falhas. É um esboço, e os detalhes ficam explicitamente de fora.

## Análise crítica

A ideia é pequena, correta e muito útil, e por isso se espalhou. Os limites estão no que o artigo mostra e no que não mostra.

- **A prova cobre o protocolo de valor único.** O Multi-Paxos é tratado por argumento, sem prova separada, e a checagem em TLA+ cobre só a especificação de valor único. A vivacidade é argumentada de modo informal, não provada.
- **A avaliação é propositalmente ingênua.** Uma VM com um núcleo, um enlace simulado de 10 Mbps, escolha aleatória de quóruns e uma única carga. Os autores dizem isso. O resultado mostra a direção do efeito, não o ganho de um sistema de produção, e parte do ganho vem de enviar a menos réplicas.
- **O lado do custo não é avaliado.** O artigo não mede o tempo de eleição de líder nem a disponibilidade sob falhas com um Q1 grande, e as grades não têm experimento nenhum.
- **O trade-off é real.** Um Q2 pequeno implica um Q1 grande, então trocar de líder exige mais aceitadores vivos. O artigo diz isso, mas deixa a escolha dos tamanhos para o operador.
- **Quóruns dinâmicos e reconfiguração são só esboçados.** O artigo diz que o mecanismo precisa ser costurado à eleição de líder e aponta para o Vertical Paxos.
- **O que o artigo não afirma.** Ele não afirma um novo algoritmo de consenso, um novo modelo de falhas nem tolerância a falhas bizantinas, e não discute o Raft. O Raft, como descrito na [tese do Raft](/papers/consensus-bridging-theory-and-practice-raft-thesis), usa maiorias tanto na eleição quanto na replicação, então a mesma observação é relevante para ele, mas isso é uma inferência, não uma afirmação deste artigo.

Literatura posterior (fora deste artigo): o post de Sougoumarane, citado pelos autores como observação independente da mesma ideia, e o WPaxos (Ailijiang, Charapko, Demirbas e Kosar, arXiv 1703.08905), cujo resumo diz adotar quóruns flexíveis para que aceitadores da fase 2 fiquem perto de seus líderes em implantações de longa distância. O "Paxos vs Raft" de Howard e Mortier (arXiv 2004.05074) compara os dois algoritmos e conclui que diferem apenas na eleição de líder.

## Pesquisas futuras

- Provas e model checking para o Multi-Paxos com quóruns flexíveis e para quóruns escolhidos dinamicamente.
- Sistemas de quóruns da literatura de replicação (votação ponderada, hierarquias e crumbling walls, que o artigo lista) aplicados ao consenso.
- Combinar quóruns flexíveis com outras variantes, como Fast Paxos, EPaxos e a reconfiguração do Vertical Paxos.
- Experimentos em clusters reais, com falha de líder, aceitadores lentos e falhas correlacionadas por rack ou datacenter.
- Quóruns de fase configuráveis em implementações existentes de sistemas das famílias Paxos e Raft.
