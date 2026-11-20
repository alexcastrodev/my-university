---
title: "Consenso no commit de transações"
summary: Gray e Lamport rodam uma instância de Paxos por gerenciador de recursos para decidir se ele ficou prepared ou abortou, o que dá o Paxos Commit, um protocolo de commit que continua decidindo enquanto uma maioria de seus 2F + 1 coordenadores funciona, e mostram que o Two-Phase Commit é o caso F = 0.
researchArea: Sistemas distribuídos
keywords: commit atômico, two-phase commit, paxos commit, consenso, commit de transações, TLA+, tolerância a falhas
version: 1.0
updatedAt: 2026-11-20
---

## Resumo

O problema do commit de transações distribuídas exige chegar a um acordo sobre se uma transação é confirmada ou abortada. O clássico protocolo Two-Phase Commit bloqueia se o coordenador falha. Algoritmos de consenso tolerantes a falhas também chegam a um acordo, mas não bloqueiam enquanto qualquer maioria dos processos estiver funcionando. O algoritmo Paxos Commit roda um algoritmo de consenso Paxos sobre a decisão de commit/abort de cada participante, obtendo um protocolo de commit de transações que usa 2F + 1 coordenadores e progride se pelo menos F + 1 deles estiverem funcionando corretamente. O Paxos Commit tem o mesmo atraso de escrita em armazenamento estável, e pode ser implementado com o mesmo atraso de mensagens no caso sem falhas, do Two-Phase Commit, mas usa mais mensagens. O clássico Two-Phase Commit é obtido como o caso especial F = 0 do Paxos Commit.

## Visão geral

Uma transação distribuída envolve vários sites, chamados gerenciadores de recursos (RMs), e só pode ser confirmada se todos estiverem dispostos a isso. O Two-Phase Commit, a resposta dos livros-texto, usa um único gerenciador de transações (TM) para colher os votos. Se o TM falha logo depois de todos os RMs terem enviado Prepared, os RMs não têm como saber se ele confirmou ou abortou, e ficam bloqueados até o TM ser reparado. O artigo também examina os protocolos não bloqueantes, em geral chamados de Three-Phase Commit, e diz não conhecer nenhum com algoritmo completo provado contra uma condição de correção bem declarada. Esses protocolos assumem que dois processos nunca acreditam ao mesmo tempo ser o coordenador, o que um sistema assíncrono não consegue garantir.

O artigo (ACM Transactions on Database Systems 31(1), março de 2006, pp. 133-160, da Microsoft Research) trata o commit como um problema de consenso. Ele se apoia no [Paxos](/papers/paxos-made-simple), descrito primeiro em [O parlamento de meio período](/papers/paxos-part-time-parliament), e cita o resultado de [Fischer, Lynch e Paterson](/papers/flp-impossibility-of-distributed-consensus) para explicar por que o progresso só pode ser prometido sob hipóteses de pontualidade, como em [Dwork, Lynch e Stockmeyer](/papers/consensus-in-the-presence-of-partial-synchrony).

Vale conhecer antes: o Two-Phase Commit, quóruns por maioria, a estrutura de ballots do Paxos (fases 1a, 1b, 2a, 2b) e a diferença entre segurança e vivacidade. A cópia aberta lida aqui é o relatório técnico MSR-TR-2003-96, revisado em 2017, que diz diferir da versão publicada só na formatação e em um pequeno erro corrigido na última página.

## Contribuição

- **Commit como um consenso por RM.** O Paxos Commit roda uma instância separada de Paxos para escolher a decisão de cada RM, Prepared ou Aborted. A transação é confirmada se e somente se toda instância escolhe Prepared.
- **Aceitadores e líder compartilhados.** Todas as instâncias usam os mesmos 2F + 1 aceitadores e o mesmo líder atual. Cada RM faz o papel de proponente do ballot 0 da sua própria instância, enviando uma mensagem de fase 2a direto aos aceitadores, o que elimina o atraso de mensagem que um único consenso sobre "committed" exigiria.
- **O Two-Phase Commit como caso especial.** Com F = 0 há um aceitador e um possível líder, e os dois algoritmos são isomorfos pela tabela de correspondência da Seção 5: o TM é o aceitador/líder, e uma mensagem Prepared é uma mensagem de fase 2a Prepared.
- **Uma análise de custo.** Mensagens, atrasos de mensagem e escritas em armazenamento estável são contados para o Two-Phase Commit, o Paxos Commit e uma variante chamada Faster Paxos Commit (Figura 4).
- **Participantes dinâmicos.** Um processo registrador, cuja própria instância de Paxos escolhe o conjunto de RMs que entraram, trata de transações cujos participantes não são conhecidos de antemão (Seção 6).
- **Especificações em TLA+.** O apêndice especifica o problema do commit, o Two-Phase Commit e o Paxos Commit.

## Metodologia

O artigo é um projeto de protocolo com um argumento informal de correção e uma análise por contagem, não um experimento. O modelo são processos que trocam mensagens, cada um com armazenamento estável. Nós podem falhar parando, não executam ações erradas e não esquecem seu estado; mensagens podem ser perdidas ou duplicadas, mas não corrompidas sem detecção. A segurança não depende de temporização, e o progresso depende.

Os requisitos são Stability, Consistency, Non-Triviality e Non-Blocking. A Non-Triviality exige o commit só se toda a rede estiver sem falhas. O modelo de custo conta mensagens entre nós, atrasos de mensagem, escritas em armazenamento estável e atrasos dessas escritas, com e sem colocalização de processos no mesmo nó. A correção do Paxos Commit é argumentada como corolário da correção do Paxos, e o apêndice traz especificações formais de segurança em TLA+ (sem vivacidade) com teoremas de que o Two-Phase Commit e o Paxos Commit implementam a especificação de commit.

## Resultados

Estes são os resultados do próprio artigo, com os números da Figura 4 e do texto.

- **Atrasos.** No caso sem falhas, os RMs conhecem o resultado após 4 atrasos de mensagem no Two-Phase Commit, 5 no Paxos Commit e 4 no Faster Paxos Commit, que elimina a fase 3 fazendo os aceitadores enviarem as mensagens da fase 2b a todos os RMs. A Seção 3.2 observa que o Two-Phase Commit leva três quando o TM está no mesmo nó do RM iniciador. Se os RMs puderem fazer prepare espontaneamente, o artigo chega a dois atrasos, que ele chama de ótimo.
- **Mensagens.** O Two-Phase Commit usa 3N - 1 (3N - 3 colocalizado), o Paxos Commit (N + 1)(F + 3) - 4 (N(F + 3) - 3 colocalizado) e o Faster Paxos Commit N(2F + 3) - 1 ((N - 1)(2F + 3) colocalizado). Para N = 5 e F = 1, os valores colocalizados são 12, 17 e 20.
- **Armazenamento estável.** Os três têm os mesmos 2 atrasos de escrita (3 se os RMs não fazem prepare ao mesmo tempo). O total de escritas é N + 1 no Two-Phase Commit e N + F + 1 nas duas variantes Paxos, porque cada aceitador escreve uma vez para todas as instâncias.
- **Tolerância a falhas.** Com 2F + 1 aceitadores, até F podem falhar sem efeito. Com mais falhas, o protocolo bloqueia até F + 1 voltarem a funcionar.
- **Especificações.** O TLC verificou os teoremas do Two-Phase Commit com seis RMs (50.816 estados alcançáveis, pouco mais de um minuto num PC de 1 GHz). O teorema do Paxos Commit foi verificado só em configurações que os autores consideram pequenas demais para detectar erros sutis.
- **Consenso versus commit.** Os autores conciliam o resultado com a literatura que diz que o commit é estritamente mais difícil que o consenso: essa literatura exige o commit sempre que todos os RMs estão sem falhas e fazem prepare, mesmo com atrasos imprevisíveis, enquanto a Non-Triviality deles exige uma rede sem falhas.

## Análise crítica

O argumento é claro, e o isomorfismo com F = 0 é um bom teste do projeto. Alguns limites estão declarados no artigo e outros são leitura minha.

- **Sem medições.** O desempenho é deduzido de contagens de mensagens e escritas. A afirmação de que as mensagens extras custam pouco se apoia na frase de que, em redes locais modernas, mensagens são baratas e as escritas em armazenamento estável dominam. Nenhum sistema foi construído nem cronometrado.
- **Modelo de falhas.** Parada com recuperação a partir do armazenamento estável. O artigo não trata de falhas bizantinas, e a garantia vale desde que os processos não errem ao executar o algoritmo.
- **A correção é argumentada.** A prova do Paxos Commit é um esboço informal mais uma rodada de verificação de modelo em tamanhos pequenos. As especificações em TLA+ cobrem só a segurança, e a vivacidade (Non-Blocking) é explicada informalmente.
- **Uma pequena inconsistência.** A conclusão diz que o Paxos Commit precisa de cerca de 2FN mensagens a mais que o Two-Phase Commit, mas a Figura 4 dá cerca de FN a mais para o Paxos Commit e 2FN a mais para o Faster Paxos Commit.
- **Custo dos coordenadores extras.** A Seção 5 coloca o custo com F = 1 em cerca de 3N, 4N e 5N mensagens, então o protocolo não bloqueante custa mais mensagens em todos os casos.

Literatura posterior, que não faz parte do artigo. Não reli esses artigos para este texto e usei aqui só as suas entradas do catálogo. O [Spanner](/papers/spanner-globally-distributed-database) replica cada fragmento com Paxos e depois roda two-phase commit entre fragmentos, uma sobreposição dos dois protocolos e não as instâncias de Paxos por RM propostas aqui. O [Calvin](/papers/calvin-fast-distributed-transactions-for-partitioned-databases) evita um protocolo de commit distribuído combinando antes a ordem das transações. O [CockroachDB](/papers/cockroachdb-the-resilient-geo-distributed-sql-database) usa um registro de transação em staging com Parallel Commits e formaliza esse protocolo em TLA+. O [Percolator](/papers/percolator-large-scale-incremental-processing) roda um two-phase commit dirigido pelo cliente sobre o Bigtable. Se algum deles adota o Paxos Commit, essas entradas não dizem, então não traço essa ligação. O artigo [Sagas](/papers/sagas-garcia-molina-salem) é outra resposta para transações longas: ele abre mão do commit atômico.

## Pesquisas futuras

- Medir o Paxos Commit contra o Two-Phase Commit em um sistema real, com custo de armazenamento estável, custo de mensagens e latência de cauda sob falhas.
- Provas completas e verificação mecânica do teorema de segurança do Paxos Commit em configurações maiores, e um tratamento formal das propriedades de progresso.
- Tratar RMs que falham ou ficam lentos, e tornar mais baratas na prática as decisões de abort tomadas por líderes (ballots acima de 0).
- Uma variante tolerante a falhas bizantinas, para a qual o catálogo tem o [PBFT](/papers/practical-byzantine-fault-tolerance) como base sobre consenso nesse modelo.
- Detectores de falhas como abstração para a condição de rede sem falhas, como em [Detectores de falhas não confiáveis](/papers/unreliable-failure-detectors-for-reliable-distributed-systems).
