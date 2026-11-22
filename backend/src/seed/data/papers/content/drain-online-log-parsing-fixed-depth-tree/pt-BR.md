---
title: "Drain: uma abordagem online de parsing de logs com árvore de profundidade fixa"
summary: O Drain transforma linhas brutas de log em templates e grupos em uma única passada em fluxo, usando uma árvore de parsing de profundidade fixa que direciona cada linha pelo tamanho e pelos primeiros tokens antes de uma checagem de similaridade. Em cinco conjuntos públicos de logs, iguala ou supera parsers anteriores em acurácia e roda mais rápido que os outros parsers online.
researchArea: Engenharia de software
keywords: parsing de logs, templates de log, algoritmo online, árvore de parsing de profundidade fixa, análise de logs, detecção de anomalias, grupos de log
version: 1.0
updatedAt: 2026-11-22
---

## Visão geral

Logs costumam ser o único registro do que um sistema em execução fez, e a maioria das técnicas de análise (detecção de anomalias, diagnóstico de falhas, trabalho de desempenho) precisa de eventos estruturados, não de texto livre. O primeiro passo é o parsing de logs: separar cada linha em uma parte constante, o template, e campos variáveis. Escrever e manter expressões regulares à mão não escala. O artigo dá três razões: o volume de logs cresce rápido (um serviço grande pode escrever 50 GB, ou 120 a 200 milhões de linhas, por hora), os componentes são escritos por centenas de desenvolvedores que não conhecem o propósito de log uns dos outros, e as instruções de log mudam o tempo todo.

Os parsers anteriores orientados a dados eram quase todos offline. Precisam que os logs de um período sejam coletados antes, são limitados pela memória de uma máquina e não combinam com o modo como os logs são enviados, linha a linha para um servidor central. O Drain, da Universidade Chinesa de Hong Kong e da Universidade Sun Yat-sen, é um parser online: não precisa de etapa de treino nem de código-fonte e processa cada linha assim que ela chega. É um artigo de conferência do ICWS 2017.

## Contribuição

- **Uma árvore de parsing de profundidade fixa.** A árvore tem uma raiz, nós internos e folhas, e todas as folhas ficam na mesma profundidade, definida por um parâmetro. Os nós internos codificam regras de busca e não guardam grupos de log. As folhas guardam listas de grupos de log, cada um com um template (o evento de log) e os IDs das linhas que nele estão. Fixar a profundidade limita quantos nós são visitados para qualquer linha.
- **Duas regras codificadas.** A primeira camada direciona pelo tamanho da mensagem (número de tokens), supondo que linhas de um mesmo evento costumam ter o mesmo tamanho. As camadas seguintes direcionam pelos primeiros tokens, supondo que o início de uma linha é mais provavelmente constante. Tokens com dígitos vão para um nó curinga, e o parâmetro `maxChild` limita os filhos de um nó, de modo que linhas que começam com número não façam a árvore explodir.
- **Um procedimento em cinco passos.** Pré-processar com expressões regulares simples para variáveis conhecidas, como IPs e IDs de bloco; buscar pelo tamanho; buscar pelos tokens iniciais; escolher o grupo com a melhor similaridade token a token (aceito se estiver no limiar `st` ou acima); e então atualizar o template com curingas onde os tokens diferem ou criar um novo grupo e os nós que faltam na árvore.
- **Código liberado.** O código-fonte do Drain foi publicado.

## Metodologia

Os autores avaliam o Drain em cinco conjuntos reais de logs, com mais de 10 milhões de linhas no total, vindos de supercomputadores (BGL, do Lawrence Livermore, e um cluster HPC), de um sistema distribuído (HDFS em um cluster de 203 nós na Amazon EC2, e ZooKeeper em um cluster de 32 nós do laboratório deles) e de um programa isolado (Proxifier). Três dos conjuntos vieram de outros pesquisadores, porque empresas raramente liberam logs.

Quatro parsers existentes servem de comparação: LKE e IPLoM (offline), SHISO e Spell (online). A acurácia é uma medida F sobre pares de mensagens: duas mensagens do mesmo evento no mesmo grupo contam como verdadeiro positivo, duas de eventos diferentes no mesmo grupo como falso positivo, e duas do mesmo evento em grupos diferentes como falso negativo. As execuções usaram um servidor com Intel Xeon E5-2670v2 e 128 GB de RAM, repetidas 10 vezes, com cada parser reajustado pelos autores. Um estudo de caso alimenta então a saída de cada parser em um fluxo de detecção de anomalias sobre logs do HDFS, em que uma PCA sobre uma matriz de contagem de eventos marca blocos como normais ou anormais.

## Resultados

Os números abaixo vêm das tabelas III, IV e VI e do texto.

- **Acurácia.** O Drain obtém 0,99 no BGL, 0,84 no HPC, 0,99 no HDFS, 0,99 no ZooKeeper e 0,86 no Proxifier. O artigo diz que é o melhor em quatro conjuntos e o segundo no Proxifier, onde o Spell tem 0,87. O IPLoM, um parser offline, empata com o Drain em 0,99 no BGL, no HDFS e no ZooKeeper, então "melhor" ali inclui empate.
- **O LKE é avaliado em amostras.** O LKE é quadrático e não terminou em tempo razoável (dias ou semanas) em quatro dos conjuntos, então sua acurácia nesses é calculada sobre amostras de 2.000 linhas, como em trabalho anterior dos autores.
- **Velocidade.** O Drain leva 115,96 s no BGL (4.747.963 linhas) e 325,7 s no HDFS, contra 447,14 s e 676,45 s do Spell, o melhor parser online seguinte. O SHISO leva 10.964,55 s no BGL. Os autores relatam melhorias de pelo menos 51,85% sobre os parsers online nos cinco conjuntos, e de 81,47% no HPC. O IPLoM fica perto (140,57 s no BGL, 333,03 s no HDFS), mas carrega todos os logs na memória. O artigo argumenta que o custo é linear no número de linhas, O((d + cm)n), com d a profundidade, c os grupos candidatos em uma folha e m o tamanho da mensagem.
- **Escala.** Em 25 amostras de tamanho crescente, o LKE cresce mais rápido por ser quadrático, enquanto Drain, Spell e SHISO são lineares.
- **Estudo de caso.** Em 575.061 blocos do HDFS com 16.838 anomalias rotuladas, Drain e IPLoM dão ambos 10.998 anomalias reportadas, 10.720 detectadas (63%) e 278 falsos alarmes. A versão com parsing perfeito reporta 11.473, detecta 11.195 (66%) e tem os mesmos 278 falsos alarmes. O SHISO, com acurácia 0,93, reporta 13.050 e tem 1.907 falsos alarmes, cerca de 6 vezes mais que os outros. Maior acurácia de parsing não garantiu resultado melhor adiante, que é o ponto do estudo.

## Análise crítica

A avaliação é clara e usa cinco conjuntos de tipos diferentes de sistema. É também um retrato de um momento: os parâmetros ajustados diferem por conjunto (tabela II), os parsers de comparação foram reajustados pelos mesmos autores, e os conjuntos são logs de sistemas anteriores ao artigo, que dizem pouco sobre estilos de log atuais.

Os pontos abaixo são uma leitura minha do artigo, não afirmações dele.

- **As duas suposições são sobre o formato das linhas.** Direcionar pelo tamanho supõe que um evento mantém a mesma contagem de tokens, e direcionar pelos primeiros tokens supõe que o início da linha é constante. O artigo admite que pode haver tamanho variável e diz que um pós-processamento simples resolve, mas não mede com que frequência as suposições falham. Uma mensagem que começa com uma variável, ou cujo número de tokens depende de uma lista, vai para a subárvore errada até que a regra dos dígitos ou o `maxChild` a segure.
- **A fragmentação é o risco que o projeto troca por velocidade.** Um grupo que só se junta pelo limiar de similaridade `st` pode dividir um evento em vários templates, e a métrica conta isso como falsos negativos. É a mesma falha de agrupamento do problema do "segundo balde" que [Debugging in the (Very) Large](/papers/debugging-in-the-very-large-windows-error-reporting) mede para relatórios de falha, e o próprio estudo de caso do artigo mostra que pequenos erros de parsing chegam ao detector adiante.
- **O pré-processamento carrega conhecimento do domínio.** As expressões regulares para IPs e IDs de bloco são pequenas (no máximo duas por conjunto), mas são escolhidas por alguém que conhece o conjunto de dados. O resultado principal não é puramente não supervisionado.
- **A acurácia é sobre templates, não sobre significado.** A métrica checa o agrupamento, não se um template é uma unidade útil para diagnóstico. O estudo de caso é uma tarefa em um conjunto de dados.

## Pesquisas futuras

- Testar como a acurácia muda quando as instruções de log mudam com o tempo, já que parsers online precisam manter a árvore válida enquanto os templates evoluem.
- Medir a taxa de fragmentação em logs de sistemas atuais, com mensagens estruturadas e de várias linhas que os conjuntos de 2017 não cobrem.
- Comparar com parsers baseados em modelos de linguagem e com bibliotecas de log que já emitem eventos estruturados, o que tira o parsing do pipeline.
- Usar os grupos como chaves para deduplicar ou triar mensagens que falharam, e medir quantos grupos distintos uma mesma causa raiz produz.
