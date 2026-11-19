---
title: "Consenso: unindo teoria e prática"
summary: A tese de doutorado de Diego Ongaro, a referência completa do Raft. Ela amplia o artigo curto de conferência com o algoritmo inteiro, mudanças de membros um servidor por vez, compactação de log, linearizabilidade para clientes, uma especificação em TLA+ com prova de segurança, um estudo com usuários contra o Paxos e avaliações de eleição de líder e de replicação.
researchArea: Sistemas distribuídos
keywords: raft, consenso, máquina de estados replicada, mudança de membros, compactação de log, linearizabilidade, verificação formal, estudo com usuários
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

O consenso distribuído é fundamental para construir sistemas tolerantes a falhas. Ele permite que um conjunto de máquinas funcione como um grupo coeso, capaz de sobreviver à falha de alguns de seus membros. Infelizmente, o algoritmo de consenso mais comum, o Paxos, é amplamente considerado difícil de entender e de implementar corretamente.

Esta tese apresenta um novo algoritmo de consenso chamado Raft, projetado para ser compreensível. O Raft primeiro elege um servidor como líder e depois concentra nele todas as decisões. Esses dois passos são relativamente independentes e formam uma estrutura melhor que a do Paxos, cujos componentes são difíceis de separar. O Raft elege o líder com votação e tempos limite aleatórios. A eleição garante que o líder já guarda toda a informação de que precisa, então os dados só fluem do líder para os demais servidores. Em comparação com outros algoritmos baseados em líder, isso reduz os mecanismos e simplifica o comportamento. Depois de eleito, o líder gerencia um log replicado. O Raft usa um invariante simples sobre como os logs crescem para reduzir o espaço de estados do algoritmo e cumprir essa tarefa com o mínimo de mecanismo.

O Raft também é mais adequado que os algoritmos anteriores para implementações reais. Seu desempenho é suficiente para uso prático, e ele trata todos os aspectos de um sistema completo: como lidar com os clientes, como mudar os membros do cluster e como compactar o log quando ele fica grande demais. Para mudar os membros, o Raft permite adicionar ou remover um servidor por vez (mudanças complexas se compõem desses passos básicos), e o cluster continua atendendo requisições durante a mudança. Acreditamos que o Raft é superior ao Paxos e a outros algoritmos de consenso, tanto para o ensino quanto como base de implementação. Os resultados de um estudo com usuários mostram que o Raft é mais fácil de aprender que o Paxos para estudantes. O algoritmo foi especificado e provado formalmente, sua eleição de líder funciona bem em vários ambientes e seu desempenho equivale ao do Multi-Paxos. Já existem muitas implementações de Raft, e várias empresas o estão colocando em produção.

## Visão geral

Esta é a tese por trás de [In Search of an Understandable Consensus Algorithm](/papers/raft-understandable-consensus-algorithm), o artigo curto do Raft (USENIX ATC 2014). Diego Ongaro a escreveu em Stanford, sob orientação de John Ousterhout, e diz que a maior parte do conteúdo daquele artigo está incluída de alguma forma. Leia o artigo curto primeiro para entender a ideia, e volte aqui quando precisar implementar o Raft ou conferir um detalhe que o artigo omitiu. O alvo é o Paxos, na forma recontada em [Paxos Made Simple](/papers/paxos-made-simple) e em suas muitas elaborações: a tese argumenta que ele é difícil de aprender e orienta pouco quem precisa de um log replicado de verdade (capítulo 2). Os parentes mais próximos são [Viewstamped Replication Revisited](/papers/viewstamped-replication-revisited) e o [Zab](/papers/zab-high-performance-broadcast-primary-backup-systems), e o capítulo 11 compara o Raft com eles.

Depois da introdução e da motivação (capítulos 1 e 2), os capítulos 3 a 6 apresentam o algoritmo, suas extensões e o lado do cliente. Os capítulos 7 a 10 o avaliam: compreensibilidade, correção, eleição de líder e desempenho. O capítulo 11 é o trabalho relacionado e o 12 fecha com as lições aprendidas. O apêndice A traz os materiais do estudo e o B, a especificação em TLA+ e a prova.

Vale saber antes: máquinas de estados replicadas, quóruns de maioria e o modelo de falhas (servidores param e podem reiniciar a partir de armazenamento estável, a rede pode perder, duplicar e reordenar mensagens, não há falhas bizantinas e a segurança nunca depende de tempo).

## Contribuição

- **Uma especificação completa (cap. 3).** Duas RPCs centrais, RequestVote e AppendEntries, cinco propriedades garantidas (Election Safety, Leader Append-Only, Log Matching, Leader Completeness e State Machine Safety), a restrição de eleição e a regra de que o líder nunca confirma entradas de termos antigos contando réplicas. Também cobre o estado persistido, o requisito de tempo e uma transferência de liderança opcional com a requisição TimeoutNow.
- **Mudanças de membros um servidor por vez (cap. 4).** RPCs AddServer e RemoveServer, configurações guardadas como entradas do log e usadas assim que são anexadas, rodadas de atualização com servidores sem voto e uma regra baseada em heartbeats para que servidores removidos não atrapalhem o líder. A seção 4.3 mantém a abordagem original de consenso conjunto para mudanças arbitrárias, mas recomenda a de um servidor por vez.
- **Compactação de log (cap. 5).** Cada servidor compacta o próprio prefixo já confirmado. Snapshots para máquinas de estados em memória com a RPC InstallSnapshot, além de esboços para máquinas em disco, limpeza de log e árvores LSM, e alternativas baseadas no líder que o autor rejeita.
- **Interação com clientes (cap. 6).** Achar o cluster, redirecionar ao líder, sessões com números de série para efeito exatamente uma vez e consultas de leitura que dispensam o log.
- **Evidências (cap. 7 a 10 e apêndice B).** O primeiro estudo com usuários de algoritmos de consenso baseado em ensino e aprendizado, uma especificação formal com prova de segurança, uma análise dos tempos de eleição e medições de uma implementação funcional chamada LogCabin.

## Metodologia

O método é projeto mais avaliação em quatro frentes. A compreensibilidade foi testada com um estudo intra-sujeitos: videoaulas e provas sobre Raft e Paxos, com ordem balanceada, aplicadas a estudantes de uma disciplina de Stanford (CS 240) e uma de Berkeley (CS 294-91) (cap. 7). A correção usa uma especificação em TLA+ de cerca de 450 linhas e uma prova de cerca de 3.500 palavras, baseada em variáveis de histórico e indução sobre execuções (cap. 8 e apêndice B). Tentativas anteriores com o verificador de modelos Murphi, o verificador de modelos do TLA e o sistema de provas do TLA também são relatadas.

A eleição de líder é analisada com modelos probabilísticos e conferida no LogCabin, uma implementação em C++ de cerca de 2.000 linhas, em cinco servidores com Ethernet de gigabit e SSDs (cap. 9). O comportamento em rede de longa distância vem de um simulador escrito pelo autor, o AvailSim. O desempenho da replicação é medido no LogCabin com um único processo cliente e escritas de um kilobyte (cap. 10). Ideias que não foram construídas, como snapshots em disco, árvores LSM e leituras baseadas em relógio, são descritas como especulação.

## Resultados

- **Compreensibilidade (cap. 7).** As notas da prova de Raft ficaram em média em 25,7 de 60 contra 21,0 da de Paxos, 22,6% a mais (teste t unilateral, p = 0,009). Entre as 43 pessoas que fizeram as duas provas, 33 foram melhor em Raft (teste pareado, p = 0,001), e 33 de 41 disseram que o Raft seria mais fácil de implementar e de explicar. Uma regressão prevê 12,5 pontos a mais em Raft para quem não tinha experiência prévia com Paxos.
- **Prova de segurança (cap. 8).** Nove lemas levam a um teorema equivalente à State Machine Safety. Ela cobre apenas o algoritmo básico do capítulo 3. Mudança de membros, compactação, interação com clientes, vivacidade e disponibilidade ficam para trabalhos futuros.
- **Eleições (cap. 9).** Sem voto dividido, a eleição termina cerca de um terço adentro do intervalo de tempo limite. Recomenda-se um intervalo de 10 a 20 vezes a latência de ida, e o número esperado de termos é 1 / (1 - taxa de voto dividido). Na LAN, sem aleatoriedade passou de 10 s, com 5 ms de aleatoriedade a mediana foi 287 ms, e tempos limite de 12 a 24 ms deram 35 ms em média (o autor ainda sugere 150 a 300 ms). Na rede de longa distância simulada (30 a 40 ms de ida), 99,9% das eleições terminaram em até 1,5 s com um servidor falho e em até 3 s com dois.
- **Desempenho (cap. 10).** Um cluster de três servidores do LogCabin sustentou cerca de 19.500 escritas de um kilobyte por segundo com 100 threads de cliente, e uma escrita levou cerca de 1,0 ms com uma thread. Escrever no disco do líder em paralelo, agrupar em lotes e fazer pipelining são as principais otimizações.
- **Snapshots (cap. 5).** Tirar um snapshot quando o log chega a 4 vezes o tamanho do anterior usa cerca de 20% da banda de disco e cerca de 6 vezes o tamanho do estado em espaço de disco.
- **Leituras (cap. 6).** O líder atende uma leitura linearizável depois de confirmar um no-op no seu termo, registrar seu índice de commit (readIndex), confirmar a liderança com uma rodada de heartbeats e esperar a máquina de estados alcançar esse índice. Leituras com lease exigem um limite para a deriva dos relógios e não são recomendadas, salvo se necessárias.

## Análise crítica

Esta é a fonte de referência do Raft, e ela é incomumente franca sobre o que não foi feito. Limites que vale ter em mente:

- **O estudo tem limites.** Os autores fizeram as duas aulas e as duas provas, os estudantes de Stanford ganharam nota de curso e a versão de Paxos foi uma elaboração dos próprios autores. O texto diz que neutralizou as principais fontes de viés e chama a evidência de substancial, mas ele mede o aprendizado após cerca de uma hora, não a construção de um sistema.
- **O desempenho é preliminar.** Só foram medidos clusters de um a cinco servidores com máquina de estados em memória e sem compactação. Vazão de leituras, custo de reconfiguração e custo de compactação ficam como perguntas em aberto, e a primeira implementação de pipelining não chegou ao ramo principal do LogCabin, segundo a errata do autor.
- **Vários projetos nunca foram construídos.** Transferência de liderança, snapshots em disco, compactação por LSM ou limpeza de log e leituras em seguidores são esboços.
- **A prova existe só no papel.** O autor diz que ela pode conter erros e que só uma prova verificada por máquina resolveria a dúvida.
- **O Pre-Vote tem dois papéis.** A seção 4.2.3 mostra que comparar logs não impede que um servidor removido atrapalhe o cluster, enquanto a seção 9.6 recomenda o Pre-Vote apenas para um servidor isolado que volta.

Literatura posterior, que não faz parte do texto de 2014. A página de errata do próprio autor para a tese lista estes itens. Primeiro, um "bug importante" nas mudanças de um servidor por vez, descrito num post da lista raft-dev de 10 de julho de 2015 e achado por Huanchen Zhang ao formalizá-las com Brandon Amos na CMU. Mudanças concorrentes entre trocas de líder, a partir de um cluster de tamanho par, podem ter quóruns sem interseção e sobrescrever uma entrada já confirmada. A correção é que o líder não pode anexar uma entrada de configuração antes de confirmar uma entrada do seu termo atual (o no-op de sempre). O consenso conjunto não é afetado. Segundo, `lastApplied` deve ser tão persistente quanto a máquina de estados. Terceiro, a equipe do Verdi, da Universidade de Washington, concluiu uma prova em Coq, verificada por máquina, do Raft básico.

## Pesquisas futuras

- Provas de segurança e de vivacidade para mudança de membros, compactação e interação com clientes, de preferência verificadas por máquina.
- Escalonar snapshots para que os clientes nunca esperem por um servidor que esteja tirando snapshot, e compactação incremental com árvores LSM.
- Tempos limite de eleição dinâmicos e o comportamento da eleição com redes assimétricas, perda de pacotes e deriva de relógio.
- Reduzir o gargalo do líder e a latência em longa distância, por exemplo com as abordagens do [Egalitarian Paxos](/papers/egalitarian-paxos-more-consensus-in-egalitarian-parliaments), que a tese discute no capítulo 11.
- Maneiras mais baratas de estudar a compreensibilidade, como cursos online e testes A/B de explicações.
