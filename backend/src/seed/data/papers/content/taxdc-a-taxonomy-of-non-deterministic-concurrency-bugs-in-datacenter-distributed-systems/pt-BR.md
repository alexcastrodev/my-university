---
title: "TaxDC: uma taxonomia de bugs de concorrência não determinística em sistemas distribuídos de datacenter"
summary: Um estudo do ASPLOS 2016 com 104 bugs de concorrência distribuída em Cassandra, HBase, Hadoop MapReduce e ZooKeeper, classificados à mão em gatilho, erro e correção, que acha que a maioria nasce de uma única mensagem fora de hora, que 63% exigem uma falha e que a maioria é corrigida ignorando, adiando ou aceitando a mensagem.
researchArea: Distributed Systems
keywords: bugs de concorrência distribuída, taxonomia de bugs, violação de ordem, violação de atomicidade, tempo de mensagens, tempo de falhas, model checking, estudo de bugs
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Os autores apresentam o TaxDC, a maior e mais abrangente taxonomia de bugs de concorrência não determinística em sistemas distribuídos. Estudam 104 bugs de concorrência distribuída (DC) de quatro sistemas distribuídos de datacenter em escala de nuvem amplamente usados: Cassandra, Hadoop MapReduce, HBase e ZooKeeper. As características dos bugs são analisadas em vários eixos, como a condição de tempo do gatilho e as pré-condições de entrada, os sintomas de erro e de falha e as estratégias de correção, guardados juntos como 2.083 rótulos de classificação no banco TaxDC. Discutem como o estudo pode abrir muitas direções de pesquisa para combater bugs DC.

## Visão geral

O artigo (ASPLOS '16, Atlanta, abril de 2016, páginas 517 a 530) é de Tanakorn Leesatapornwongsa, Jeffrey F. Lukman, Shan Lu e Haryadi S. Gunawi, da Universidade de Chicago e da Surya University. O problema é um tipo de bug que as ferramentas de uma única máquina não enxergam. Um bug de concorrência local (LC) vem do entrelaçamento de threads em um nó. Um bug de concorrência distribuída (DC) vem do tempo não determinístico de eventos distribuídos: chegada de mensagens, quedas de nós, reinícios e timeouts, em máquinas sem relógio comum. Os autores argumentam que testes, model checking e verificação tinham poucos dados reais sobre esses bugs, porque os estudos de nuvem anteriores não separavam DC de LC.

O artigo é a continuação direta de [What Bugs Live in the Cloud?](/papers/what-bugs-live-in-the-cloud-a-study-of-3000-issues-in-cloud-systems): parte do banco público daquele estudo, filtra as issues de concorrência e aprofunda uma classe. Os quatro sistemas são parentes de código aberto de projetos do catálogo: [Cassandra](/papers/cassandra-decentralized-structured-storage-system), [ZooKeeper](/papers/zookeeper-wait-free-coordination-internet-scale-systems), [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters) e o HBase, que segue o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data). O método de ler falhas reais à mão também aparece em [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures) e, para partições de rede, em [Network-Partitioning Failures in Cloud Systems](/papers/analysis-of-network-partitioning-failures-in-cloud-systems).

## Contribuição

- **Uma taxonomia em três estágios** (Tabela 1): gatilho (condição de tempo, pré-condições de entrada, escopo), erros e falhas, e correção.
- **O banco TaxDC**: 2.083 rótulos de classificação e 4.528 linhas de redescrição escritas pelos autores, com os passos reenumerados de cada bug. Os autores o apresentam como o primeiro benchmark de bugs DC em larga escala.
- **Seis achados** sobre como os bugs DC disparam, aparecem e são corrigidos, mais uma lista de equívocos comuns dos desenvolvedores por trás deles.
- **Lições para ferramentas** (seção 8): model checkers, especificações, detecção, diagnóstico, prevenção e correção, frameworks verificáveis e uma comparação entre bugs LC e DC.

## Metodologia

Existem mais de 30.000 issues nos JIRAs dos quatro sistemas, e poucas usam palavras como "race". Por isso os autores partem do banco Cloud Bug Study (CBS), que já rotula issues de concorrência, removem os bugs LC, descartam os DC sem descrição clara e sorteiam 104 dos restantes: 19 do Cassandra, 30 do HBase, 36 do MapReduce (incluindo o Yarn) e 19 do ZooKeeper, reportados de janeiro de 2011 a 2014.

Para cada bug, conferem que os desenvolvedores o marcaram como real, reenumeram os passos em uma sequência curta e fazem todos os autores revisarem cada classificação. As ressalvas dos próprios autores: só entram bugs corrigidos e bem descritos, e as estatísticas não devem ser generalizadas, pois cada sistema tem propósito e projeto próprios. O artigo não reporta estatística de concordância.

Um bug DC é descrito pelo menor conjunto de eventos concorrentes cuja ordem garante a falha (a condição de tempo) e pelas entradas e falhas necessárias para chegar até ele (as pré-condições de entrada).

## Resultados

- **Achado 1, tempo (Tabela 2, Figura 3a).** Mensagens fora de hora disparam 64% dos bugs: violações de ordem 44% (46 bugs só dessas) e violações de atomicidade 20% (21 bugs). Falhas ou reinícios fora de hora disparam 32%, e 4% precisam dos dois. A razão ordem para atomicidade é 2:1 no geral, 1:2 no ZooKeeper e 6:1 no MapReduce. As violações de ordem são corridas entre duas mensagens ou entre uma mensagem e uma computação local.
- **Achado 2, pré-condições.** 63% dos bugs precisam de ao menos uma falha, 80% envolvem várias iniciações de protocolo e 81% envolvem protocolos de segundo plano. Os bugs tocam 39 protocolos distintos (10, 13, 10 e 6 por sistema). Só 18 bugs não precisam de falha e ocorrem em um protocolo, 8 deles em protocolos de primeiro plano (seção 8.1).
- **Achado 3, escopo.** Mais de 90% envolvem de uma a três mensagens, nós e protocolos, e 92% precisam de um único evento fora de hora. O máximo é 7 mensagens. Só oito bugs precisam de mais de um evento fora de hora; o bug c6023 do Cassandra precisa de três corridas de mensagens.
- **Achado 4, erros (Tabela 3).** Os primeiros erros são locais em 46% e globais em 54%; 53% são explícitos e 47% silenciosos. Locais: exceção de memória 5, erro semântico 21, travamento 10, silencioso 15. Globais: mensagem errada 33, mensagem ausente 10, silencioso 18 (contagens da Tabela 3; os percentuais do texto batem com uma base de 112 primeiros erros, conta minha). Falhas: operação falha 47%, perda ou corrupção de dados 28%, nó fora do ar 17%, lentidão 8%.
- **Achado 5, correções (Tabelas 4 e 5).** 30% são corrigidos mudando o tempo (Figura 3p) e 40% tratando a mensagem: tentar de novo depois 4, ignorar 12, aceitar com um tratador existente 18, outros 11. Para bugs de tempo de falha: 3 sincronizações globais e 5 locais, cancelar a operação 13 (Tabela 5).
- **Achado 6, equívocos.** "Um salto é mais rápido que dois", "nenhum salto é mais rápido que um", "blocos atômicos não podem ser quebrados", "as interações entre vários protocolos parecem seguras", "há estado suficiente guardado".
- **Outros (seção 7).** Mediana: 9 passos reenumerados, 172 linhas de patch, 14 dias para resolver, 18 comentários. 46% foram achados em produção e 10% por testes unitários que falharam.

## Análise crítica

Pontos fortes: a leitura manual de cada bug, as tabelas por sistema e um banco que outros podem reusar. Fraquezas que o artigo admite: cobre só bugs corrigidos e bem descritos, e os autores sugerem que o escopo pequeno do gatilho pode refletir que bugs complicados são mais difíceis de corrigir e por isso entram menos nos estudos. Um detalhe interno: a seção 5.1 diz que "apenas um quinto" dos bugs de tempo de mensagem é corrigido mudando o tempo, mas a Tabela 4 lista 4 correções globais e 19 locais. Não consegui reconciliar isso com cerca de 67 bugs de tempo de mensagem, então uso os 30% da Figura 3p.

O que o artigo não afirma: são bugs reportados e corrigidos de quatro sistemas de código aberto, classificados à mão, então não dá incidência em produção nem resultado para outros sistemas. Também não afirma que a taxonomia seja coberta por algum detector. A seção 8 discute implicações para model checkers (MaceMC, MoDist, Demeter, SAMC), inferência de especificações, gravação e replay e prevenção em tempo de execução, mas não executa nem mede nenhum deles, então são sugestões e não resultados.

Literatura posterior (lida nas entradas do catálogo, não nos originais, e não conferi se citam o TaxDC): [Efficient Reproduction of Fault-Induced Failures](/papers/efficient-reproduction-of-fault-induced-failures-in-distributed-systems) reproduz falhas injetando faltas, [Metastable Failures in the Wild](/papers/metastable-failures-in-the-wild) e [Chaos Engineering](/papers/chaos-engineering-basiri) tratam o lado da produção, e o [Elle](/papers/elle-inferring-isolation-anomalies-from-experimental-observations) é um verificador caixa-preta de isolamento. Esses pareamentos são meus, não dos autores.

## Pesquisas futuras

Os autores listam direções: model checkers que controlem todos os eventos necessários (mensagens, quedas, reinícios, timeouts, falhas de armazenamento) e escalem graças ao escopo pequeno do Achado 3; especificações de tempo inferidas de erros explícitos ou de invariantes aprendidas; testes em pares de ordens de mensagens e de protocolos; diagnóstico de falhas com depuração estatística e análise de dependência entre nós; prevenção em tempo de execução atrasando mensagens; correção automática reordenando envios, ignorando ou adiando mensagens; verificação de sistemas inteiros, incluindo protocolos de segundo plano; e novos bugs DC de 2014 e 2015 acrescentados ao TaxDC.

Pergunta em aberto, leitura minha e não do artigo: quanto da taxonomia vale para sistemas construídos depois de 2014 sobre pilhas de protocolo determinísticas ou verificadas.
