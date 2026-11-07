---
title: "Se não deu certo de primeira, tente, tente de novo...? Insights e ferramentas guiadas por LLM para detectar bugs de retry em sistemas de software"
summary: Um estudo de 70 bugs reais de retry em sistemas Java os classifica em se, quando e como tentar de novo, e o toolkit Wasabi encontra novos bugs combinando CodeQL e GPT-4 para localizar o código de retry com injeção de falhas nos testes de unidade existentes e oráculos específicos de retry.
researchArea: Sistemas distribuídos
keywords: bugs de retry, injeção de falhas, testes de unidade, análise estática, modelos de linguagem, sistemas em nuvem
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Retry, reexecutar uma tarefa depois que ela falha, é a resposta padrão para erros transitórios em software de nuvem, e muitas vezes a última defesa contra bugs, falhas de hardware e configurações erradas. Ele também raramente é testado: os erros que o disparam quase nunca acontecem em um ambiente de teste, e nenhum dos sistemas estudados tem uma API dedicada de retry, então é difícil encontrá-lo automaticamente.

Este artigo do SOSP 2024 (Austin), da University of Chicago e da Microsoft Research, pergunta o que dá errado no código de retry real e se esses bugs podem ser encontrados de forma automática. Os autores primeiro estudam relatos de bugs de sistemas Java de código aberto, depois constroem o Wasabi, que liberam junto com a descrição de cada bug que ele reporta.

Termos usados ao longo do texto: um bug é um problema de **IF** (este erro deveria ser tentado de novo?), de **WHEN** (o **delay** entre as tentativas ou o **cap** no número delas) ou de **HOW** (limpeza de estado e rastreamento de jobs). O retried method é o método cuja falha causa a reexecução, o coordinator method é o chamador que captura o erro e tenta de novo, o retry trigger é a exceção e o ponto de chamada é o retry location.

Vale conhecer antes: exceções e try/catch em Java, como funcionam os testes de unidade e a instrumentação de bytecode (AspectJ) e por que o backoff importa. Dois pareamentos meus, não do artigo. O [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) é citado aqui só nos trabalhos relacionados, como uma classe de bugs de nuvem pouco estudada, mas seu primeiro caso é o de retries que multiplicam a carga, que é o que bugs de delay ausente e cap ausente podem fazer. O [Atropos](/papers/targeted-task-cancellation-for-application-resource-overload) é posterior a este artigo, e o estudo aqui encontrou bugs em que uma tarefa cancelada é tentada de novo como se tivesse falhado.

## Contribuição

- **Uma taxonomia a partir de 70 issues.** Os autores buscaram nos issue trackers de Elasticsearch, Hadoop (Common, HDFS e Yarn), HBase, Hive, Kafka e Spark, oito aplicações no total, as palavras retry, resubmit, reattempt e reschedule, entre abril de 2018 e novembro de 2023, mantendo bugs válidos que foram corrigidos ou tinham patch aguardando merge. IF tem 25 issues (17 de política errada, 8 de retry ausente ou desabilitado), WHEN tem 23 (10 de delay, 13 de cap) e HOW tem 22 (12 de reset de estado inadequado, 8 de rastreamento de jobs quebrado ou com race, 2 outros).
- **Como o código de retry se parece.** Nenhum caso estudado usa uma API dedicada de retry. Cerca de 55% são loops simples e 45% não são: 25% reenfileiram uma tarefa em uma fila e 20% são máquinas de estado que reentram no estado atual. Comentários, mensagens de log, nomes de variáveis e códigos de erro são a evidência mais clara de retry. Os erros chegam ao coordinator como exceções em 70% dos casos e como códigos de erro em 30%.
- **Localizando o retry.** O CodeQL encontra loops cujo cabeçalho é alcançável a partir de um bloco catch dentro do loop e cujos nomes ou literais contêm "retry" ou "retries". O GPT-4 lê um arquivo por vez e diz se ele faz retry, o que também cobre filas e máquinas de estado, e o CodeQL então lista os métodos chamados e suas exceções. A saída são triplas de coordinator, retried method e exceção de trigger.
- **Testes de unidade reaproveitados.** Um handler do AspectJ lança a exceção de trigger antes de o retried method rodar, até K vezes, com K igual a 1 (para alcançar o código depois de um retry) e a 100 (para atingir caps e delays). Um planejador roda a suíte uma vez para descobrir a cobertura, depois cobre cada retry location em exatamente um teste, e um script restaura as configurações padrão de retry que os testes tinham reduzido.
- **Três oráculos.** Cap ausente: 100 injeções ou uma execução acima de 15 minutos. Delay ausente: nenhuma chamada de sleep do coordinator entre duas injeções consecutivas em um mesmo local. Exceção diferente: o teste falha com uma exceção que não é a injetada. Um teste que apenas relança a exceção injetada é aceito.
- **Verificações estáticas.** Para bugs de WHEN, o GPT-4 responde a prompts de sim ou não sobre delay e cap, com prompts que excluem spin locks e polling. Para bugs de IF, o CodeQL calcula, por exceção, a fração dos loops de retry que a tratam com retry, e marca os outliers.

## Metodologia

A avaliação usa oito aplicações: Hadoop Common, HDFS, MapReduce, Yarn, HBase, Hive, Cassandra e Elasticsearch, nas versões mais recentes de março de 2023. O Kafka foi retirado porque seu retry é guiado por códigos de erro e estado, e o Spark por uma incompatibilidade com um plugin do AspectJ, e MapReduce e Cassandra foram incluídos. As rodadas usaram uma máquina Ubuntu 22.04 com 12 cores e 32 GB de RAM.

Os autores examinaram todos os relatos para classificar bugs verdadeiros e falsos positivos. Amostraram 40 loops do CodeQL e 100 locais do GPT-4 para verificar a identificação de retry, e fizeram ablações sem o filtro de palavras-chave e sem os oráculos.

## Resultados

Estes são os resultados relatados pelos autores.

- **Bugs encontrados.** O Wasabi reporta 191 problemas distintos, dos quais 109 são bugs verdadeiros e 82 falsos positivos. Os testes de unidade encontram 42 (20 de cap ausente, 17 de delay ausente, 5 de HOW) entre 63 relatos, com 21 falsos positivos. A análise estática encontra 87 (79 pelo GPT-4, 8 de IF pelo CodeQL) entre 148 relatos, 61 deles falsos, e 20 bugs são encontrados pelos dois. Os autores dão 2 bugs verdadeiros por falso positivo nos testes e 1,4 na análise estática.
- **Um exemplo de HOW.** Injetar uma única `SocketException` em um teste do HDFS causou uma `NullPointerException`: o bloco catch registra o estado de objetos que nunca foram construídos, porque o erro veio cedo demais.
- **Código de retry identificado.** 323 estruturas, 239 delas loops. O CodeQL encontra 205 loops (mais de 85% dos encontrados por qualquer um dos métodos), mas nenhum retry fora de loop. O GPT-4 encontra 140 loops e 84 outras estruturas, mas deixa passar cerca de 100 loops, em arquivos quase duas vezes maiores que aqueles em que ele encontra retry. Sem o filtro de palavras-chave, o CodeQL reportaria 725 loops em vez de 205. Nas amostras, 3 de 40 loops do CodeQL e 16 de 100 locais do GPT-4 estavam errados.
- **Cobertura.** Os testes de unidade alcançam de 32% a 75% das estruturas de retry em seis aplicações, e menos em Hive e Elasticsearch, onde o retry por código de erro é comum. Entre 4% e 27% dos testes de unidade cobrem algum retry location.
- **Custo.** Os testes de unidade levam cerca de 10 horas por aplicação e perto de 20 no HBase. O planejamento reduz as execuções de injeção em 27× a 170×, e o tempo de teste cresce de 2× a 5×. O GPT-4 precisa de uma mediana de cerca de 2.600 chamadas, 16 MB e 3,3 milhões de tokens por aplicação, em torno de 8 USD.
- **Os oráculos importam.** Sem eles, todos os bugs de delay ausente e a maioria dos de cap ausente passariam batido, e cerca de 90% das falhas de teste são exceções injetadas relançadas, que os oráculos ignoram corretamente.
- **Lado do estudo.** Os rótulos de severidade dão 5% blocker, 10% critical, 65% major e 5% minor, com 10% sem rótulo. Os desenvolvedores adicionaram testes de regressão para 42 dos 70 bugs.

## Análise crítica

O artigo é franco sobre o escopo e admite estes limites.

- **O estudo pode não generalizar.** Ele cobre sistemas Java de código aberto, issues com quatro palavras-chave, e pula relatos pouco claros.
- **O retry location não é nem sound nem completo.** Os oráculos absorvem seus falsos positivos, não suas omissões.
- **Pontos cegos de projeto.** O protótipo trata retry disparado por exceção, não por códigos de erro (30% dos casos estudados). Retry ausente ou desabilitado (8 de 70) não é coberto, e má configuração (cerca de 10%) passa batido, a menos que os testes usem a mesma configuração. As verificações estáticas geram mais falsos positivos que os testes e perdem bugs ligados ao estado em tempo de execução.
- **Os falsos negativos não são quantificados.** Os autores dizem que são difíceis de medir e listam as fontes: código não coberto, retry locations perdidos e os pontos cegos acima.
- **Falsos positivos custam tempo de revisão.** Os autores sugerem mostrar, junto de cada relato, o trecho tomado como retry.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Não há estimativa de recall.** A avaliação usa versões mais novas e troca duas aplicações, então os 109 bugs são novos e nada diz quantos dos 70 bugs estudados o Wasabi pegaria. O texto não diz quantos dos 109 os mantenedores confirmaram ou corrigiram, então verdadeiro e falso são rótulos dos próprios autores.
- **A mistura de bugs é desbalanceada.** O estudo acha as três categorias mais ou menos igualmente comuns, mas os 109 bugs se dividem em 8 de IF, 5 de HOW e 96 de WHEN (37 mais 79, menos os 20 encontrados pelos dois). "Os três tipos" vale, mas quase só um tipo é encontrado.
- **Os rótulos definem a taxa de falsos positivos.** Dos 21 falsos positivos dos testes de unidade, 8 são relatos de delay ausente em que, segundo os autores, o Wasabi estava certo, mas o delay parecia desnecessário (um retry do HDFS que contata outra réplica), então a razão de 2 para 1 depende desse julgamento.
- **A detecção de IF é fina.** Ela cobre só loops e produziu 9 relatos. O projeto diz que os outliers têm razões muito próximas de 1 ou de 0, enquanto a avaliação usa 2/3 e 1/3, com razões como 1/3, 2/3 e 2/9 vindas de poucos pontos de código.
- **O lado do GPT-4 é uma única configuração.** Os prompts foram ajustados por experimentação, e o texto não cita um snapshot do modelo nem relata execuções repetidas. Custo e precisão podem não valer para outros modelos ou linguagens.
- **Duas diferenças de redação.** A introdução diz que o Wasabi trata os três tipos de bug em retry com e sem loop, mas o corpo limita a detecção de IF a loops e a de HOW a testes de unidade disparados por exceção. Ela também diz que de 0,1% a 0,5% dos testes contêm um mecanismo para injetar erros transitórios, enquanto a Seção 2.5 dá a mesma faixa como testes rotulados como relacionados a retry (348 no total). Segue-se aqui o corpo do texto.

## Pesquisas futuras

- Retry disparado por código de erro, que o protótipo deixa de fora e que explica a baixa cobertura em Hive e Elasticsearch.
- Menos falsos positivos com contexto de chamada e de exceção (exceções encapsuladas, retries espalhados por tarefas), combinação dos resultados estáticos com os dos testes e envio de código dos métodos chamados ou de prompts comprimidos ao GPT-4, como sugerem os autores.
- Frameworks de teste com configuração de teste de retry embutida, e estruturas de retry e codificação de erros mais consistentes, que os autores defendem que ajudariam.
- Uma lacuna minha: medir o recall nos 70 bugs conhecidos e acrescentar oráculos de amplificação de carga, para ver se um delay ou cap ausente pode sustentar uma sobrecarga como no [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems).
