---
title: "MSF-Model: análise e predição de falhas metaestáveis em sistemas de armazenamento replicados com base em teoria de filas"
summary: Reproduz uma falha metaestável causada por retentativas em um armazenamento replicado de três nós (Multi-Paxos sobre PostgreSQL) e constrói um modelo de filas com uma "órbita" de retentativas, uma cadeia de Markov bidimensional e simulação de Monte Carlo para prever quando um pico de carga deixa o sistema preso. O limiar de falha do modelo fica a 0,2 requisição por segundo do limiar do protótipo.
researchArea: Sistemas distribuídos
keywords: falhas metaestáveis, tempestades de retentativas, teoria de filas, cadeias de Markov, simulação de Monte Carlo, armazenamento replicado, Multi-Paxos, predição de falhas
version: 1.0
updatedAt: 2026-11-22
---

## Visão geral

Uma falha metaestável é um estado em que o sistema continua funcionando, mas entrega muito pouco trabalho útil, e permanece assim depois que o evento que a iniciou já acabou. O culpado habitual é a tempestade de retentativas: um pico de carga deixa as respostas lentas, os clientes estouram o tempo e tentam de novo, e as retentativas mantêm o sistema sobrecarregado depois que o tráfego volta ao normal. Um trabalho empírico anterior encontrou que mais da metade dos incidentes metaestáveis que estudou foi sustentada por retentativas. O que faltava, argumentam os autores, era uma forma de dizer com antecedência se uma dada configuração e um dado gatilho levam a uma delas.

Este artigo (SRDS 2024) faz duas coisas. Reproduz uma falha metaestável causada por retentativas em um protótipo de armazenamento replicado e propõe o MSF-Model, um modelo de teoria de filas que prevê o resultado. Li a versão do arXiv do artigo. A versão publicada pode diferir.

## Contribuição

- **Uma reprodução.** Uma implementação em Java do Multi-Paxos (veja [Paxos Made Simple](/papers/paxos-made-simple)) com armazenamento em PostgreSQL, três nós, dados particionados e batching, em que um pico de carga leva o sistema a um estado do qual ele não sai.
- **Um modelo de filas com memória.** A fila principal é uma fila M/M/1 com buffer infinito. Uma segunda estrutura, o espaço de órbita, guarda as requisições que estouraram o tempo e esperam para tentar de novo. A probabilidade de uma requisição tentar de novo é a probabilidade de a sua espera passar do timeout, então uma fila mais longa aumenta a probabilidade de retentativa, o que aumenta a órbita, o que alonga a fila. Esse laço é o efeito de sustentação.
- **Uma cadeia de Markov bidimensional.** Um estado é o par (requisições na órbita, requisições na fila). Chegadas, saídas e retentativas são transições com taxas construídas a partir da taxa de chegada, da taxa de processamento e da taxa de retentativa (o inverso do timeout). As probabilidades dos estados são estimadas com simulação de Monte Carlo.
- **Uma métrica de distância.** A distância dos estados ao estado vazio, ponderada pela probabilidade. Ela converge para um sistema estacionário e continua crescendo para um não estacionário. O artigo define um sistema de filas não estacionário como um sistema em falha metaestável.
- **O Algoritmo 1.** Dadas a configuração normal e o gatilho (uma taxa de chegada ou de processamento alterada, por uma duração), ele simula o gatilho a partir do estado vazio e soma a probabilidade de terminar em um estado do qual a configuração normal não consegue se recuperar. Essa soma é a probabilidade prevista de uma falha metaestável.

## Metodologia

O protótipo rodou em três nós do Chameleon Cloud. Os clientes enviam lotes de transações a cada 300 ms com timeout de 600 ms, reenviados na hora até três tentativas no total. O parâmetro de escala é o tamanho do lote, e o pico de carga é produzido aumentando-o.

Na validação, os autores comparam o modelo com o protótipo em picos de carga. A carga é de 30 requisições por segundo por três minutos, depois um pico a uma taxa maior por um minuto, depois 30 de novo por mais três minutos. As requisições chegam segundo uma distribuição exponencial, com timeout de 1 segundo e no máximo três retentativas. Isso é feito para lotes de 3 KB, 50 KB e 100 KB, em que a taxa de processamento difere. Para 3 KB a taxa de processamento é tomada como 40 requisições por segundo.

## Resultados

- **A reprodução se comporta como a teoria diz.** Com um lote de 250 KB o sistema é vulnerável, mas funciona. Subir o lote para 300 KB o sobrecarrega, e voltar a 250 KB não o recupera: a vazão útil fica perto de zero. A recuperação exigiu um lote de 70 KB. Durante a falha a maioria das requisições precisa de retentativas, e as poucas que dão certo são lentas.
- **O backoff exponencial não é uma cura.** Com backoff adicionado e timeout inicial de 600 ms, a falha metaestável ainda aconteceu. Com 900 ms ela começou a uma carga maior.
- **O modelo mostra o laço.** No exemplo com taxa de processamento de 15 e timeout de 1 segundo, a probabilidade de retentativa chega a um quando a fila tem 24 requisições. Em uma linha do tempo, um aumento da taxa de chegada de 4 para 5 por 100 intervalos é absorvido, e um aumento de 4 para 6 deixa o sistema preso mesmo depois que a taxa volta a 4. A recuperação exige uma taxa de processamento bem maior ou o descarte das requisições da fila e da órbita.
- **A predição bate com o protótipo no limiar.** Para lotes de 3 KB o modelo diz que um pico acima de 35,5 requisições por segundo pode causar uma falha metaestável, e o protótipo falhou a partir de 35,7. Os casos de 50 KB e 100 KB são descritos como semelhantes, sem números no texto.

## Análise crítica

O modelo é simples o bastante para ser explicado, e sua ideia central, uma órbita de retentativas cujo tamanho realimenta a probabilidade de retentativa, é a parte que mais vale guardar. A validação, porém, é magra.

Os pontos abaixo são uma leitura minha do artigo, não afirmações dele.

- **A checagem é um número por configuração.** "Alta acurácia" se apoia em três comparações de limiar, com 35,5 contra 35,7 no caso de 3 KB. O texto que li não dá o número de execuções, nem a variância, nem o passo da grade de carga, então uma diferença de 0,2 não pode ser colocada em contexto. A taxa de processamento usada no modelo vem do próprio protótipo, de modo que o teste confere a estrutura do modelo e não uma predição independente.
- **O modelo e o protótipo diferem de modos que importam.** O protótipo para de tentar depois de três tentativas. Não encontrei um limite de retentativas nas transições da cadeia. O modelo também supõe tempos de serviço exponenciais e um único servidor, enquanto o protótipo são três nós rodando consenso com batching.
- **Metaestável é definido como não estacionário.** Isso iguala uma falha metaestável a uma fila que cresce sem limite. Um artigo posterior, [Formal Analysis of Metastable Failures in Software Systems](/papers/formal-analysis-of-metastable-failures-in-software-systems), argumenta que isso mistura comportamento metaestável com instável, porque uma fila estável também pode ser metaestável, e relata que um modelo sem calibração se desvia da simulação mesmo em sistemas simples. Não reproduzi nenhuma das duas afirmações. Vale conferi-las antes de confiar na métrica de distância para classificar um sistema real.
- **O escopo é mais estreito que o enquadramento.** O cenário de falha de nó é descrito mas não validado, e o pico de carga é o único gatilho testado. O modelo não inclui backoff, então não consegue explicar o experimento de backoff que está ao lado dele. O uso do Algoritmo 1 dentro de um sistema de monitoramento é descrito como um uso possível e não é avaliado.
- **Relação com a evidência de campo.** O estudo de incidentes reais em [Falhas metaestáveis no mundo real](/papers/metastable-failures-in-the-wild) encontrou as retentativas como um efeito de sustentação comum, e é por isso que este modelo se concentra nelas. Se ele prevê falhas em um sistema de produção com caches, várias camadas e retentativas limitadas fica em aberto.

## Pesquisas futuras

- Relatar execuções repetidas e intervalos de confiança, e varrer a carga com passo fino em torno do limiar, para medir com que frequência o modelo e o protótipo discordam.
- Acrescentar ao modelo um limite de retentativas, backoff e jitter e testá-los contra o protótipo, já que são as mitigações que os profissionais de fato usam.
- Validar o gatilho de falha de nó e um sistema com cache, que o artigo descreve mas não testa.
- Comparar a métrica de distância com a definição de metaestabilidade por probabilidade de escape de [Formal Analysis of Metastable Failures in Software Systems](/papers/formal-analysis-of-metastable-failures-in-software-systems) no mesmo protótipo.
