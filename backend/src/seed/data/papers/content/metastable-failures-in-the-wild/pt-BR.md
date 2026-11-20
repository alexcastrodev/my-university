---
title: "Falhas metaestáveis no mundo real"
summary: Um estudo do OSDI 2022 sobre postmortems públicos que encontra 21 falhas metaestáveis em 11 organizações, mostra que as retentativas são o efeito de sustentação mais comum e estende o modelo de metaestabilidade com dois tipos de gatilho e dois de amplificação, reproduzidos em três aplicações pequenas.
researchArea: Sistemas distribuídos
keywords: falhas metaestáveis, postmortems de incidentes, tempestade de retentativas, descarte de carga, coleta de lixo, cache look-aside
version: 1.0
updatedAt: 2026-11-20
---

## Abstract

Recentemente, Bronson et al. introduziram um arcabouço para entender uma classe de falhas em sistemas distribuídos chamada falhas metaestáveis. Os exemplos apresentados nesse trabalho são versões simplificadas de falhas observadas no Facebook. Neste trabalho, estudamos a prevalência dessas falhas no mundo real examinando relatórios de incidentes publicamente disponíveis de muitas organizações, de hiperescaladores a pequenas empresas. Nossas conclusões principais são três. Primeiro, falhas metaestáveis são observadas universalmente: apresentamos um estudo detalhado de 22 falhas metaestáveis em 11 organizações diferentes. Segundo, falhas metaestáveis são um padrão recorrente em muitas interrupções graves, por exemplo, pelo menos 4 de 15 grandes interrupções da última década na Amazon Web Services foram causadas por falhas metaestáveis. Terceiro, estendemos o modelo de Bronson et al. para refletir melhor as falhas metaestáveis vistas no mundo real, categorizando dois tipos de gatilhos e dois tipos de mecanismos de amplificação, o que confirmamos desenvolvendo várias aplicações de exemplo que reproduzem diferentes tipos de falhas metaestáveis em ambiente controlado.

## Visão geral

Uma falha metaestável é uma interrupção que sobrevive à própria causa. Um gatilho temporário sobrecarrega o sistema, um laço de realimentação interno mantém a sobrecarga, e o sistema continua degradado depois que o gatilho some. [Metastable Failures in Distributed Systems](/papers/metastable-failures-in-distributed-systems) (HotOS 2021) deu nome à classe a partir da experiência no Facebook, com exemplos simplificados e a afirmação de que o padrão é comum, mas sem dados sobre quanto.

Este artigo do OSDI 2022, de Penn State, da University of New Hampshire e do Twitter, traz os dados. Ele lê relatórios públicos de incidentes e pergunta se eles se encaixam no padrão. Também cita dois artigos do catálogo que ficam ao lado dele: [Gray Failure](/papers/gray-failure-achilles-heel-cloud-scale-systems), como um tipo de lentidão que pode agir como gatilho, e [Simple Testing Can Prevent Most Critical Failures](/papers/simple-testing-can-prevent-most-critical-failures), que os autores citam pela observação de que falhas críticas muitas vezes exigem uma sequência incomum de eventos, algo que, sugerem, pode ter sido falha metaestável.

Vale conhecer antes: goodput (trabalho útil por segundo), retentativa com timeout, caches look-aside, descarte de carga e coleta de lixo da JVM.

## Contribuição

- **Um estudo de incidentes reais.** 21 falhas metaestáveis de fontes públicas (Tabela 1), 4 cada na AWS, no Google Cloud e no Azure, além de IBM, Spotify, Elasticsearch, Wikimedia, CircleCI, Cassandra, Ably e Facebook.
- **Um modelo estendido.** Dois tipos de gatilho, pico de carga ou redução de capacidade, e dois tipos de amplificação: de carga de trabalho (mais requisições ou mais caras, como nas retentativas) e de degradação de capacidade (trabalho de fundo, como a coleta de lixo, reduz a capacidade). As combinações dão quatro cenários.
- **Graus de vulnerabilidade.** O estado vulnerável não é binário: se um gatilho derruba o sistema depende de quão perto a carga está da capacidade, do tamanho e da duração do gatilho e da amplificação. O artigo enuncia quatro teoremas sobre isso, provados em apêndice.
- **Um estudo de caso do Twitter.** Um laço de coleta de lixo visto em um teste de carga de pico, analisado com dados internos.
- **Três reproduções**, de código aberto: coleta de lixo, retentativas em um MongoDB replicado e um cache look-aside.

## Metodologia

Os autores pesquisaram postmortems públicos nas ferramentas de incidentes e interrupções de provedores de nuvem, que chamam de fonte principal, e em comunidades de postmortems e resumos semanais de interrupções, como o SRE Weekly. Examinaram centenas de incidentes e relatam um punhado. Procuraram sinais característicos: um gatilho temporário, amplificação de trabalho ou efeito de sustentação, e mitigação por descarte de carga. Cada incidente foi analisado quanto a impacto (duração e serviços afetados), gatilho, mecanismo de amplificação e mitigação, e classificado em categorias. O artigo diz que usou o melhor julgamento, porque os relatórios variam em formato e detalhe, e marca alguns incidentes em cinza quando o efeito de sustentação é plausível, mas não está claramente descrito. Não vi descrição de um segundo revisor nem de medida de concordância.

Os experimentos rodam em Docker na AWS EC2: um programa Java 8 multithread com a coleta de lixo padrão (contêiner de 1 GB, m5.large), um cluster MongoDB 4.4.9 de 3 réplicas em instâncias m5a.large e uma aplicação web com banco MySQL de 15 GB (34,6 milhões de entradas) e cache memcached de 1 GB sob carga Zipf. Cada reprodução varia o tamanho e a duração do gatilho, a taxa de requisições e um parâmetro.

## Resultados

Todos os números são do artigo. Vêm de um conjunto pequeno, classificado à mão.

- **Escala e duração.** As interrupções duraram de 1,5 a 73,53 horas, e de 4 a 10 horas foi a faixa mais comum (35% dos incidentes que informam duração). O IBM1 durou mais de três dias.
- **Gatilhos.** Cerca de 45% dos gatilhos são erros de engenheiros (configuração ou código com defeito, bugs latentes) e cerca de 35% são picos de carga. 45% dos incidentes têm mais de um gatilho. Cerca de 50% têm envolvimento humano direto.
- **Efeitos de sustentação.** As retentativas sustentam mais de 50% dos incidentes (11 dos 21 listados). Outros são crescimento de fila, tratamento de erro caro, contenção de locks, instabilidade na eleição de líder e sobrecarga em cascata.
- **Mitigação.** O descarte de carga foi usado em mais de 50% dos incidentes (o texto também diz mais de 55%). Outros foram reinícios, mudanças de política, rollbacks e aumento de capacidade.
- **Twitter.** Um teste de carga de pico disparou um laço de fila, duração de GC, jobs mais lentos e mais fila. A taxa de sucesso ficou abaixo do SLO depois que a carga voltou ao normal, até um reinício.
- **Retentativas no MongoDB.** Com cerca de 6.200 requisições bem-sucedidas por segundo, um gatilho de 10 s que corta a CPU em 78% se recuperou, e com 80% não: a carga tentada chegou perto de 20.000 RPS (3x) e o goodput caiu cerca de 90%, para 600 RPS. Um gatilho de 9 s a 80% se recuperou, e uma carga base 30% menor também.
- **Cache.** A metaestabilidade apareceu em RPS maior e diminuiu com timeout de 2 s em vez de 1 s, e uma taxa de acerto de ~95% ainda deixou uma faixa ampla de vulnerabilidade.
- **Prevenção e mitigação.** O artigo diz para entender a vulnerabilidade do sistema, limitar retentativas (no máximo duas retentativas dão no máximo 3x), descartar carga, adicionar capacidade, encurtar gatilhos por automação e vigiar a sobrecarga em relação à fronteira metaestável. Também alerta para correções que pioram, como retentativas ilimitadas ou mais logging de erro.

## Análise crítica

O que o artigo não afirma, e onde é frágil:

- **Viés de seleção.** Os dados são postmortems que as empresas decidiram publicar, então o artigo não dá uma taxa de falhas metaestáveis, só mostra que elas ocorrem. Ele mesmo diz que a contagem parece baixa perto de outros estudos de falhas.
- **Julgamento, não prova.** A classificação é a leitura dos autores de textos públicos, e algumas entradas são plausíveis, não claras.
- **Números que não batem.** O resumo diz 22 incidentes, o corpo e a Tabela 1 dizem 21. O "4 de 15 grandes interrupções da AWS" aparece no resumo, e não achei no texto uma tabela com as 15.
- **Mitigações não são testadas.** Os experimentos mostram as falhas e sua sensibilidade, mas nenhuma mitigação é avaliada. O autoscaling é tratado como questão aberta.
- **Reproduções pequenas.** Cada reprodução é uma aplicação em escala pequena.

Leitura minha, não do artigo: os gatilhos se sobrepõem por construção, já que metade dos incidentes tem vários, então os percentuais não devem ser somados.

Literatura posterior, que conheço só pelo catálogo e não li nesta tarefa: [Mitigating Application Resource Overload with Targeted Task Cancellation](/papers/targeted-task-cancellation-for-application-resource-overload) (SOSP 2025) trata de sobrecarga, mas não de metaestabilidade, e [Retry Bugs](/papers/retry-bugs-insights-and-llm-informed-tooling) estuda o código de retentativa que este artigo mais culpa.

## Pesquisas futuras

- Detectar um sistema perto da fronteira metaestável antes que a cruze, como o artigo sugere ao monitorar a sobrecarga.
- Se o autoscaling reage rápido o bastante, dada uma amplificação como 100x para um cache com 99% de acerto.
- Políticas de retentativa que limitem a amplificação sem perder disponibilidade.
- Avaliar em ambiente controlado as mitigações que o artigo lista, o que ele deixa por fazer.
