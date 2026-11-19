---
title: "Testes simples podem evitar a maioria das falhas críticas: uma análise de falhas de produção em sistemas distribuídos intensivos em dados"
summary: Um estudo do OSDI 2014 sobre 198 falhas reais de Cassandra, HBase, HDFS, MapReduce e Redis conclui que 92% das catastróficas vêm do tratamento incorreto de erros não fatais, muitas vezes triviais, e constrói o Aspirator, um verificador estático de três desses padrões que achou 121 bugs novos em 9 sistemas.
researchArea: Sistemas distribuídos
keywords: estudo de falhas, tratamento de erros, tratamento de exceções, análise estática, Aspirator, falhas catastróficas, reprodução de falhas, testes
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Sistemas distribuídos grandes e de qualidade de produção ainda falham periodicamente, às vezes de forma catastrófica, com a maioria ou todos os usuários sofrendo uma indisponibilidade ou perda de dados. Os autores apresentam um estudo abrangente de 198 falhas escolhidas ao acaso e reportadas por usuários em Cassandra, HBase, HDFS, Hadoop MapReduce e Redis, com o objetivo de entender como uma ou várias faltas evoluem até uma falha visível ao usuário. Do ponto de vista de testes, quase todas as falhas exigem 3 nós ou menos para serem reproduzidas. Porém, são necessárias várias entradas para disparar as falhas, e a ordem entre elas importa. Os logs de erro desses sistemas costumam conter dados suficientes sobre os erros e sobre os eventos de entrada que causaram a falha. A maioria das falhas catastróficas poderia ter sido evitada com testes simples do código de tratamento de erros, a última linha de defesa. Os autores extraíram três regras simples dos bugs por trás de algumas falhas catastróficas e construíram um verificador estático, o Aspirator, que os localiza. Mais de 30% das falhas catastróficas teriam sido evitadas se o Aspirator tivesse sido usado e os bugs corrigidos. Rodando em 9 sistemas distribuídos, ele localizou 143 bugs e más práticas que foram corrigidos ou confirmados pelos desenvolvedores.

## Visão geral

Sistemas como HDFS e HBase são projetados para sobreviver à falha de nós, e mesmo assim têm indisponibilidades. Este artigo do OSDI 2014 (Broomfield), de Ding Yuan, Yu Luo, Xin Zhuang, Guilherme Renna Rodrigues, Xu Zhao, Yongle Zhang, Pranay U. Jain e Michael Stumm, da University of Toronto, pergunta como uma falta vira uma falha que o usuário percebe. Estudos anteriores olharam um elo da cadeia (causas raiz, tipos de bug, sintomas). Os autores dizem que o seu é, até onde sabem, o primeiro a estudar a sequência completa de manifestação.

Termos como o artigo os usa: **falta** é a causa raiz (hardware, bug ou configuração errada); **erro** é um comportamento anormal, como uma exceção Java ou uma chamada de sistema que falha; **falha** é um mau funcionamento percebido por usuários ou operadores. Uma falha é **catastrófica** quando impede todos ou a maioria dos usuários de acessar o sistema normalmente: queda do cluster inteiro, cluster travado ou perda de todos ou da maior parte dos dados.

Contexto do catálogo, pareamento meu e não do artigo: os sistemas estudados são parentes de código aberto de [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters), [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) e [The Google File System](/papers/google-file-system). A preocupação com as causas das falhas complementa o [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems), sobre falhas que os detectores não percebem, e o [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems), sobre quedas sustentadas por laços de realimentação. Aqui o elo fraco é o tratador de erros.

## Contribuição

- **Um corpus de falhas com a sequência completa de manifestação de cada caso.** Para cada ticket os autores leram o relato, a discussão dos desenvolvedores, os logs, o código e o patch, e reproduziram manualmente 73 das 198 falhas.
- **Doze constatações** sobre complexidade, eventos de entrada, nós, temporização, logs, reprodutibilidade e falhas catastróficas.
- **O resultado sobre tratamento de erros.** 92% das falhas catastróficas vêm do tratamento incorreto de erros não fatais sinalizados explicitamente pelo software. 35% são erros triviais (tratador vazio ou só com log, abort dentro de um catch amplo demais, um "TODO" ou "FIXME" no tratador), e outros 23% seriam expostos por 100% de cobertura de instruções do tratador.
- **O Aspirator**, um verificador estático baseado em regras para os três padrões triviais, construído sobre o framework de análise Chord, sobre bytecode Java.
- **Uma recomendação** de abordagem bottom-up: partir do código de tratamento de erros e reconstruir casos de teste, em vez de apenas injetar falhas de cima para baixo.

## Metodologia

As falhas vêm dos issue trackers dos cinco sistemas. Os autores ficaram com tickets de prioridade Blocker, Critical ou Major, de 2010 em diante, confirmados pelos desenvolvedores e com patch ou correção de configuração, removeram duplicatas, filtraram por heurística as falhas de sistemas de teste (reporter igual ao assignee) e sortearam. A Tabela 1 traz reportadas, amostradas e catastróficas: Cassandra 3.923 / 40 / 2, HBase 5.804 / 41 / 21, HDFS 2.828 / 41 / 9, MapReduce 3.469 / 38 / 8, Redis 1.192 / 38 / 8; total 17.216 / 198 / 48. Cada falha foi investigada por dois inspetores com um método de classificação escrito.

Os próprios autores listam os limites. Só foram estudados sistemas distribuídos intensivos em dados (mistura de master-slave e peer-to-peer, Java e C), então sistemas de telecom ou científicos podem diferir. Os tickets documentam bugs, então configurações erradas ficam sub-representadas e o artigo não tira conclusão sobre a distribuição das faltas. Eles estimam uma margem de erro de 6,9% com 95% de confiança para 198 amostras.

O Aspirator varre o bytecode, acha o bloco catch de cada instrução que pode lançar exceção e avisa quando o tratador é vazio ou só imprime log, tem "TODO" ou "FIXME", ou captura Exception ou Throwable, podendo esconder várias exceções, e chama abort ou System.exit. Duas heurísticas reduzem falsos positivos: ele ignora tratadores vazios quando o try altera uma variável que é checada depois do catch, e os autores o configuraram para ignorar FileNotFound e exceções de métodos de shutdown, close e cleanup.

## Resultados

- **Complexidade.** 77% das falhas exigem mais de um evento de entrada, e 90% exigem no máximo 3 (Tabela 3: 1 evento 23%, 2 eventos 50%, 3 eventos 17%). A ordem importa em 88% das que têm vários eventos. Iniciar um serviço é necessário em 58%, uma escrita de cliente em 32%, um nó inalcançável em 24%, uma mudança de configuração em 23% e adicionar um nó em 15%.
- **Nós.** 98% se manifestam em no máximo 3 nós e 84% em no máximo 2. Uma falha precisou de mais de 1.024 nós.
- **Temporização.** 74% (147 de 198) são determinísticas. Das 51 não determinísticas, 53% têm restrições de tempo apenas sobre eventos de entrada; as demais são violações de atomicidade (13), deadlocks (3), contenção de lock (4) e outras (4).
- **Logs.** 76% imprimem mensagens explícitas de falha e 84% registram todos os eventos que a dispararam, mas os logs são ruidosos: a mediana é de 824 mensagens por falha.
- **Reprodutibilidade.** 77% (153 de 198) podem ser reproduzidas por um teste de unidade; o Redis é o menor, com 58%, porque seu framework de testes se limita a comandos.
- **Falhas catastróficas.** 48 de 198 (24%). Sintomas: perda ou potencial perda de dados 19 de 40, sistema travado 9 de 23, término inesperado 17 de 74. O tratamento incorreto de erros aparece em 92% delas, mas em apenas 25% das não catastróficas. Só quatro não foram causadas por ele.
- **Detalhe dos 35%.** 25% erros ignorados, 8% abort em exceção capturada de forma ampla, 2% "TODO". Dos outros 57%, 23% são facilmente detectáveis (a cobertura de instruções os exporia) e 34% são bugs complexos.
- **Aspirator.** Aplicado às falhas estudadas, teria evitado 33% das catastróficas de Cassandra, HBase, HDFS e MapReduce. Em 9 sistemas (36.745 blocos de tratamento na Tabela 9) ele reportou 121 bugs e 379 más práticas, mais 115 falsos positivos (19% dos avisos), em menos de 15 segundos por sistema. Os autores reportaram 171 casos: 143 confirmados ou corrigidos (73 corrigidos), 17 rejeitados. O Cassandra teve a menor razão entre bugs e blocos de tratamento.

## Análise crítica

O que o artigo não afirma. Ele não diz que o tratamento de erros causa a maioria das falhas em geral: os 25% das não catastróficas são o contraste. Não diz que sistemas distribuídos fora da categoria de intensivos em dados seguem o mesmo padrão. Não afirma que o Aspirator encontra os 34% complexos, e diz que detectá-los exige conhecimento do sistema. Não avalia o Aspirator no Redis, pois ele só lida com bytecode Java. O título diz "maioria", enquanto o resumo diz majoritária (58% somando as classes triviais e as facilmente detectáveis).

Minha leitura, não do artigo:
- As regras foram extraídas das mesmas falhas contra as quais o Aspirator é medido, então os 33% são um ajuste retrospectivo, não uma previsão. A execução nos 9 sistemas é a evidência independente.
- Os 23% "facilmente detectáveis" dependem do julgamento manual dos autores sobre cada tratador.
- Das 87 "más práticas" reportadas, 17 foram rejeitadas, e alguns desenvolvedores discordaram de tratar toda exceção. O valor depende das normas do time.
- Dados de issue tracker sobrerrepresentam bugs de software confirmados, como os autores reconhecem.

Literatura posterior, que não faz parte deste artigo e da qual li apenas os resumos: "Chaos Engineering" (Basiri et al., IEEE Software 2016, arXiv 1702.05843) defende experimentos em produção para verificar a confiabilidade, uma abordagem top-down no sentido usado aqui. "Elle" (Kingsbury e Alvaro, arXiv 2003.10554) infere anomalias de isolamento a partir de históricos observados por clientes com injeção de falhas, um alvo diferente (violações de isolamento, não tratadores de erro). Ambos são pareamentos meus, não afirmações deste artigo.

## Pesquisas futuras

- Os autores deixam em aberto como a idade do bug se relaciona com a idade do código (se o código com defeito foi adicionado recentemente) e observam que técnicas como execução simbólica poderiam ser estendidas para alcançar blocos de tratamento de erros de propósito.
- Estender o Aspirator além de Java: eles sugerem retornos de erro de chamadas de sistema, switch com fall-through e chamadas a abort como condições de erro prováveis.
- Análise interprocedural, que os autores apontam como a principal fonte de falsos positivos.
- Análise de logs que filtre as mensagens relevantes de erro e de eventos de entrada em meio a logs ruidosos.
- Desdobramentos do catálogo em temas próximos: [Efficient Reproduction of Fault-Induced Failures](/papers/efficient-reproduction-of-fault-induced-failures-in-distributed-systems) (reprodução de falhas por injeção de falhas, segundo a entrada do catálogo) e [Retry Bugs](/papers/retry-bugs-insights-and-llm-informed-tooling) (um estudo posterior de um tipo de código de tratamento de erros), ambos lidos aqui só pelos resumos do catálogo.
