---
title: "Reprodução eficiente de falhas induzidas por faults em sistemas distribuídos com injeção de faults guiada por feedback"
summary: O Anduril reproduz falhas de produção causadas por faults externos buscando fault sites e momentos de injeção, usando um grafo causal estático para propor candidatos e o log de cada injeção malsucedida para reordenar o que tentar a seguir.
researchArea: Sistemas distribuídos
keywords: reprodução de falhas, injeção de faults, análise causal estática, busca guiada por feedback, análise de logs, depuração, anduril
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Reproduzir uma falha costuma ser o primeiro passo para depurá-la, e em um sistema distribuído esse passo é muitas vezes o mais difícil. Este artigo do SOSP 2024 (Austin), de Jia Pan e Haoze Wu (Johns Hopkins University), Tanakorn Leesatapornwongsa e Suman Nath (Microsoft Research) e Peng Huang (University of Michigan), mira falhas que um workload sozinho não consegue disparar, porque o bug só aparece quando um fault externo, como um erro de disco, um problema de rede ou uma dependência quebrada, acontece em um momento específico. Neste texto, fault é a causa injetada (um erro de disco, uma exceção) e falha é o sintoma observado. Os autores citam um estudo anterior em que os desenvolvedores gastavam 69% do tempo de resolução reproduzindo a falha.

Os injetores de faults existentes são feitos para achar bugs, então perseguem cobertura. O espaço de busca é enorme, já que um fault pode atingir muitos pontos de execução e cada ponto pode rodar muitas vezes. As ferramentas de record and replay exigem instrumentação em produção e somam overhead, e o Pensieve, o trabalho anterior mais próximo, reconstrói entradas, não faults.

Cinco termos sustentam o artigo. Um **fault site** é um ponto do programa que pode lançar uma exceção, e uma **instância de fault** é uma execução dele. O **oráculo de falha** é uma verificação do sintoma escrita pelo usuário (uma mensagem de log, um stack trace, um arquivo corrompido). **Observables** são mensagens de log que aparecem no log de falha da produção, mas não em uma execução normal. O Anduril é a ferramenta.

Vale conhecer antes: exceções e logging em Java, e a pilha ZooKeeper, HDFS, HBase, Kafka e Cassandra de onde vem a avaliação. Um pareamento meu, não do artigo: [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) descreve interrupções sustentadas por loops de feedback depois que o gatilho termina. O Anduril mira faults que aparecem como exceções, e os autores listam atrasos e códigos de erro silenciosos como fora de alcance, então uma falha sustentada por retries ou sobrecarga pediria outra ferramenta.

## Contribuição

- **Definição do problema.** As entradas são o código do sistema (analisável, instrumentável, executável offline), um log de falha sem filtro de um sistema de produção não instrumentado, um workload que dirige a execução (um teste existente, um vindo de um ticket ou um montado a partir dos sintomas) e o oráculo. A saída é o fault causa-raiz, seu site e seu momento, mais um script que o injeta de forma determinística. O escopo são sistemas JVM e falhas com uma única exceção causa-raiz. Os autores amostraram 50 falhas dos cinco sistemas e encontraram 41 disparadas por faults externos, 39 delas por exatamente um.
- **Ideia central.** Faults têm efeitos correlacionados, como cair no mesmo bloco catch ou imprimir o mesmo log, então o log de uma injeção malsucedida indica quais faults ainda não tentados provavelmente são inúteis. Os autores tratam a reprodução como um problema de busca e distinguem esse feedback do feedback de cobertura do fuzzing.
- **Grafo causal estático.** O Instrumenter, construído sobre o Soot, parte das mensagens de log relevantes e anda para trás por nós de localização, condição e invocação, usando a estratégia de saltos do Pensieve. Os autores acrescentam nós de handler e três tipos de nó de exceção (interna, nova, externa), além de análise entre threads para futures. As fontes do grafo são os fault sites. Ele é conservador e imperfeito: no caso motivador do HBase tem 357.816 vértices e 868.373 arestas. O Instrumenter também insere código de tracing e de injeção em cada site.
- **Observables relevantes.** O Explorer roda o workload uma vez sem faults e compara esse log com o log de falha por nome de thread, depois de remover timestamps (diff de Myers). As mensagens que só existem no log de falha viram observables. Como o log de falha é fixo, o mesmo grafo serve a todas as rodadas.
- **Feedback.** Cada observable tem um contador, que começa em zero, em que menor significa prioridade maior. Depois de uma injeção malsucedida, o contador de cada observable presente naquela execução sobe em um, então faults ligados a observables ainda ausentes ganham posições. A prioridade de um site é o mínimo, entre os observables que ele alcança, da distância no grafo mais o contador, já que observables distantes são menos certos.
- **Instâncias e janela.** Uma instância é ordenada por tempo lógico, o número de mensagens de log entre ela e o observable, com a linha do tempo da execução normal alinhada ao log de falha pela subsequência comum mais longa. Escolhe-se primeiro o site e depois sua instância. Uma janela flexível guarda os k melhores candidatos (k começa em 10) e dobra depois de uma rodada em que nada foi injetado, limitando as rodadas desperdiçadas a O(log n).
- **Implementação.** Java, com cerca de 3.700 linhas no Instrumenter e 5.600 no Explorer, um parser de logs em Scala e o diff em C. Os formatos de log pedem duas configurações de regex nos cinco sistemas. O código é aberto.

## Metodologia

Os autores vasculharam os trackers JIRA de ZooKeeper, HDFS, HBase, Kafka e Cassandra atrás de issues ligadas a faults, reuniram 40 que exigiam raciocínio não trivial, sortearam 22 e relatam todas as tentativas. Os sistemas vão de 120K a 1.649K linhas (ZooKeeper com 4 falhas, HDFS 7, HBase 6, Kafka 3, Cassandra 2). Os workloads são testes existentes em 13 falhas, fornecidos pelo ticket em 6 e escritos pelos autores em 3, com média de 185 linhas, e nenhum dispara a falha sem um fault injetado. Os oráculos vêm da verdade conhecida dessas issues já resolvidas, e quando um ticket não tinha log os autores reproduziram a falha antes para obter um.

As execuções usaram servidores de 20 cores a 2,20 GHz, 64 GB e Ubuntu 18.04, no CloudLab. As métricas são tempo real e rodadas de injeção, com limite de 24 horas. As comparações são CrashTuner e FATE, cinco variantes de ablação dentro do Anduril (busca exaustiva sobre o grafo causal, distância do fault site, a mesma com limite de 3 instâncias, feedback por fault site e uma combinação multiplicativa de feedbacks) e um injetor por stacktrace que os autores escreveram. O Pensieve não estava disponível. Outros experimentos variam k e o ajuste dos observables, e medem o custo do Explorer e da análise estática.

## Resultados

Estes são os resultados relatados pelos autores.

- **Reprodução.** As 22 falhas são reproduzidas, com o fault causa-raiz no momento certo. A mediana é de 8 minutos e 11 rodadas, 12 casos levam menos de 10 minutos e menos de 20 rodadas, e o mais longo leva 445 minutos (281 rodadas, HBase-16144). Em seis tickets que registram isso, a mediana da reprodução manual foi de 136 horas.
- **Espaço de faults.** O grafo mantém poucos sites, por exemplo uma média de 572 de 6.225 no ZooKeeper e 1.134 de 45.109 no Kafka. No caso motivador do HBase, o site causa-raiz roda mais de 1.000 vezes e só 2 instâncias satisfazem o oráculo. O Anduril o reproduziu na rodada 18, partindo de uma posição inicial acima de 130 e de 53 observables relevantes.
- **Contra outras ferramentas.** O CrashTuner reproduz 4 falhas e o FATE 3, e os autores relatam que, onde conseguem, levam de 6× a 280× mais tempo. O injetor por stacktrace reproduz 9, com média de 78 minutos e 230 rodadas, e só vai bem quando o fault causa-raiz aparece no log.
- **Ablação.** A melhor variante, o feedback multiplicativo, reproduz 15 falhas em 88 minutos e 71 rodadas em média. A busca exaustiva sobre o mesmo grafo é bem pior (6 falhas na Tabela 2), o que os autores leem como o feedback dinâmico ser essencial e a ordem em dois níveis, site e depois instância, superar um produto simples.
- **Caso mais difícil.** O HBase-16144 tem 3.075 sites candidatos e uma mensagem ABORT próxima ligada a mais de 2.500 deles. A posição do site causa-raiz só melhora de 342 para 187 pelo feedback, e a ordenação de instâncias termina o trabalho na rodada 281.
- **Sensibilidade.** O Anduril ainda reproduz a maioria das falhas em todas as configurações, e as diferenças são pequenas na maior parte dos casos.
- **Custo.** A latência por decisão vai de 0,2 a 29,10 µs. A inicialização por rodada vai de 6,7 s (ZooKeeper) a 124 s (Cassandra), e a análise estática de 11 s a 344 s.
- **Novas causas-raiz.** Em cinco casos o Anduril achou uma causa-raiz diferente e mais profunda que o diagnóstico dos desenvolvedores. Em quatro, o patch original não cobre o cenário, em um quinto os autores escreveram um patch mais eficiente, e os desenvolvedores confirmaram três como bugs novos, além do patch.

## Análise crítica

O artigo é explícito sobre onde o Anduril deixa de funcionar. Ele aponta estes limites.

- **Falhas não suportadas.** Atrasos e códigos de erro silenciosos que não lançam exceção, falhas que exigem vários faults causa-raiz causalmente independentes, workloads que não passam pelo caminho com defeito e logs fracos demais para distinguir execuções com e sem falha. Os sistemas avaliados registram o bastante, ponto que os autores afirmam de forma direta.
- **Concorrência e correção da análise.** Os interleavings precisam ser impostos pelo workload, e se a concorrência faz linhas cruciais do log sumirem o sucesso passa a ser probabilístico. A análise estática não é nem sound nem completa, e um sintoma reproduzido pode vir de um bug diferente do de produção.
- **Logs ruidosos de produção.** Os logs usados são pequenos porque vêm de workloads de teste, e os autores observam que logs reais serão maiores e mais ruidosos. Falhas que não são induzidas por faults não foram testadas, e rodariam até um limite como 2000 tentativas.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Entradas mais limpas que as de produção.** Toda falha é um ticket resolvido com verdade conhecida, e foi assim que o oráculo foi escrito, e o artigo não diz quantos logs os autores regeneraram. A afirmação sobre falhas de produção se apoia em logs e oráculos mais fáceis que os de um incidente real.
- **Um número por célula, sem dispersão.** O texto não relata repetições nem variância na Tabela 2, embora os sistemas sejam não determinísticos e a janela escolha o candidato que por acaso ocorre. Um caso como o HBase-19876, com 258 rodadas, poderia variar de execução para execução.
- **O custo das entradas fica fora do relógio.** Os 8 minutos excluem a construção do workload e do oráculo (um dos três workloads dos autores deu mais trabalho por causa de um interleaving de threads). As 136 horas vêm de seis tickets que o artigo não diz estarem entre as 22, então os dois números não são a mesma grandeza.
- **As bases de comparação não são equivalentes.** CrashTuner e FATE são caçadores de bugs, e os autores dizem isso. O texto não descreve como foram adaptados aos cinco sistemas, e o Pensieve está ausente. As ablações sobre um mesmo grafo causal são a comparação mais limpa.
- **Os parâmetros são ajustados no conjunto de teste.** Os valores padrão e o estudo de sensibilidade usam as mesmas 22 falhas. A variação é real: k=1 leva 715 rodadas no HBase-19876 contra 258, e subir o ajuste para 10 leva o HDFS-12248 de 16 para 649 rodadas e deixa HBase-20583 e HBase-25905 sem reprodução.
- **O modelo de faults é estreito.** Na Tabela 5, 19 dos 22 faults injetados são IOException, e uma injeção é um throw em um site. Quedas de máquina, partições e nós lentos não fazem parte dele.
- **Inconsistências internas.** A introdução diz que CrashTuner e FATE reproduziram "4 de 22 respectivamente", enquanto a Seção 8.4 e a Tabela 2 dão 4 e 3, e aqui se usam os números do corpo. A Seção 8.4 também dá 1.839 rodadas e 634 minutos para o HDFS-15032, enquanto a Tabela 5 os atribui ao Kafka-9374 (e dá 11 rodadas e 22 minutos ao HDFS-15032), a única leitura que produz as médias informadas. Os cinco casos de nova causa-raiz do apêndice (Tabela 6) têm IDs que não estão entre as 22 da Tabela 5.

## Pesquisas futuras

- Explorar interleavings de threads e faults em conjunto, para falhas que combinam um bug de concorrência com um fault, o que os autores citam como trabalho futuro.
- Falhas com vários faults causa-raiz. Os autores sugerem usar os logs quase corretos do Anduril para fixar um fault por vez no workload e rodar de novo.
- Faults que não são exceções, como atrasos, discos lentos e códigos de erro silenciosos, e sistemas em linguagens além da JVM.
- Uma avaliação mais completa, com logs de produção no tamanho real e ruidosos, execuções repetidas e o custo total de construir o workload e o oráculo contabilizado.
