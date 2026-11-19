---
title: "Dapper, uma infraestrutura de tracing para sistemas distribuídos em larga escala"
summary: O Dapper é o sistema de tracing de produção do Google, construído sobre três metas (baixo overhead, transparência para a aplicação, escalabilidade) instrumentando poucas bibliotecas comuns, amostrando traces e modelando cada requisição como uma árvore de spans, com um relato de experiência depois de mais de dois anos em produção.
researchArea: Sistemas distribuídos
keywords: tracing distribuído, spans, amostragem de traces, instrumentação, observabilidade, RPC, depuração de desempenho
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Serviços modernos de Internet costumam ser implementados como sistemas distribuídos complexos e de grande escala. Essas aplicações são construídas a partir de coleções de módulos de software que podem ser desenvolvidos por times diferentes, talvez em linguagens diferentes, e que podem se estender por muitos milhares de máquinas em várias instalações físicas. Ferramentas que ajudam a entender o comportamento do sistema e a raciocinar sobre problemas de desempenho são inestimáveis nesse ambiente. Aqui apresentamos o projeto do Dapper, a infraestrutura de tracing de sistemas distribuídos em produção no Google, e descrevemos como nossas metas de baixo overhead, transparência no nível da aplicação e implantação ubíqua em um sistema de escala muito grande foram atingidas. O Dapper tem semelhanças conceituais com outros sistemas de tracing, em particular o Magpie e o X-Trace, mas certas escolhas de projeto foram decisivas para o seu sucesso em nosso ambiente, como o uso de amostragem e a restrição da instrumentação a um número bem pequeno de bibliotecas comuns. O objetivo principal deste artigo é relatar nossa experiência construindo, implantando e usando o sistema por mais de dois anos, já que a principal medida de sucesso do Dapper tem sido sua utilidade para os times de desenvolvimento e de operações. O Dapper começou como uma ferramenta de tracing autônoma, mas evoluiu para uma plataforma de monitoramento que permitiu a criação de muitas ferramentas diferentes, algumas delas não previstas por seus projetistas. Descrevemos algumas das ferramentas de análise construídas sobre o Dapper, compartilhamos estatísticas de uso dentro do Google, apresentamos exemplos de casos de uso e discutimos as lições aprendidas até agora.

## Visão geral

Quando uma busca na web se espalha por milhares de máquinas e vários serviços, um engenheiro que enxerga só a latência ponta a ponta não sabe qual serviço está lento nem por quê. A resposta do artigo é um sistema de tracing que registra o trabalho feito em nome de cada requisição em todos os processos que ela toca. É um relatório técnico do Google de abril de 2010, o primeiro artigo, nas palavras dos autores, a relatar um framework de tracing distribuído grande e em produção. Ele fica sobre a mesma pilha do Google que o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), o [GFS](/papers/google-file-system) e o [MapReduce](/papers/mapreduce-simplified-data-processing-large-clusters): o Bigtable guarda os traces, o MapReduce os processa em lote, e o artigo usa Bigtable, GFS e Chubby como exemplos de serviços em camadas a rastrear.

O artigo situa o Dapper entre os esquemas de caixa-preta (Project5, WAP5, Sherlock), que inferem a causalidade por estatística e precisam de mais dados, e os esquemas baseados em anotação (Pinpoint, Magpie, X-Trace), que marcam cada registro com um identificador global mas exigem instrumentação. O Dapper escolheu a anotação, escondida dentro de bibliotecas compartilhadas.

Vale conhecer antes: RPC, armazenamento thread-local e por que uma requisição que atravessa muitos servidores deixa a evidência espalhada em muitos logs.

## Contribuição

- **Três metas de projeto.** Baixo overhead (impacto desprezível, ou os times desligam o tracing), transparência no nível da aplicação (o programador não precisa saber que ele existe) e escalabilidade. Os autores somam a meta de que os dados fiquem disponíveis para análise, idealmente em até um minuto.
- **Árvores, spans e anotações.** Um trace é uma árvore cujos nós são spans, unidades de trabalho com nome, span id, parent id, timestamps e anotações opcionais. Todos os spans de um trace compartilham um trace id. Os ids são inteiros de 64 bits probabilisticamente únicos. Um span sem pai é um root span.
- **Instrumentação em poucas bibliotecas.** O contexto de trace fica em armazenamento thread-local. Uma biblioteca comum de controle de fluxo faz os callbacks carregarem o contexto de quem os criou. O único framework de RPC, em C++ e Java, define spans em todos os RPCs e envia os ids de trace e de span do cliente ao servidor.
- **Anotações opcionais.** Uma API simples para anotações de texto e de chave-valor com timestamp, com um limite configurável de volume por span para que não desloquem os dados estruturais. Nenhum payload de RPC é registrado, só os nomes dos métodos.
- **Coleta fora de banda.** Os spans vão para arquivos de log locais, daemons do Dapper os puxam e coletores os gravam em um repositório Bigtable regional, com um trace por linha e uma coluna por span. A amostragem é a principal ferramenta para manter o overhead baixo.
- **Uma plataforma.** A Depot API (DAPI) oferece acesso por trace id, acesso em lote via MapReduce e acesso indexado, e há uma interface web por cima.

## Metodologia

É um relato de experiência, não um estudo controlado. As medições vêm do ambiente de produção do Google: microbenchmarks da biblioteca de runtime em um servidor x86 de 2,2 GHz, um teste de carga do daemon de coleta e um experimento em um cluster de busca web que varia a fração de traces amostrados. As estatísticas de uso vêm de logs e da contagem de ferramentas e aplicações conhecidas pelo time do Dapper. Os casos de uso (Ads Review, busca universal, dependências entre serviços, uso de rede, armazenamento compartilhado) são contados pelos times ou autores que trabalharam neles.

## Resultados

Estes são os resultados reportados pelos autores.

- **Geração de traces.** Criar e destruir um root span leva 204 ns em média e um span não raiz, 176 ns, sendo a diferença o custo de alocar um trace id globalmente único. Uma anotação custa cerca de 9 ns em um span não amostrado e 40 ns, para uma string literal, em um amostrado.
- **Coleta.** O daemon nunca usa mais de 0,3% de um núcleo em um teste irrealisticamente pesado (de 0,125% a 0,267% na Tabela 1). Um span ocupa 426 bytes em média, e os dados de trace são menos de 0,01% do tráfego de rede em produção.
- **Amostragem na busca web (Tabela 2).** Rastrear todas as requisições soma 16,3% de latência média e -1,48% de vazão. Com 1/16, são 2,12% e -0,08%, e com 1/1024, -0,20% e -0,06%. Abaixo de 1/16 as penalidades ficam dentro do erro experimental (2,5% na latência, 0,15% na vazão). A primeira versão em produção usava probabilidade uniforme de um trace em 1024, e os autores relatam que uma amostra de uma em milhares de requisições basta para muitos usos, até 0,01% em serviços de alto tráfego.
- **Segunda amostragem.** Mais de 1 TB de dados de trace amostrados por dia. O sistema de coleta mantém ou descarta traces inteiros pelo hash do trace id comparado a um único coeficiente. Os usuários querem os dados disponíveis por pelo menos duas semanas.
- **Atraso da coleta.** A mediana do tempo entre a aplicação e o repositório é menor que 15 segundos. O percentil 98 fica abaixo de dois minutos em cerca de 75% do tempo e pode chegar a muitas horas nos outros 25%.
- **Cobertura.** O daemon está na imagem base de virtualmente todo servidor, e 40 aplicações C++ e 33 Java precisaram de propagação manual, entre milhares. A instrumentação central tem menos de 1000 linhas de C++ e menos de 800 de Java. 70% dos spans e 90% dos traces têm ao menos uma anotação da aplicação.
- **Uso.** Cerca de 200 engenheiros distintos usam a interface em um dia útil e de 750 a 1000 em uma semana. A DAPI tem 3 aplicações persistentes, 8 ferramentas sob demanda e de 15 a 20 ferramentas descartáveis.
- **Experiências.** O time de Ads Review estima que a latência melhorou em duas ordens de grandeza. Os traces revelaram consultas enviadas sem necessidade ao banco mestre e requisições seriais desnecessárias no caminho crítico. Na busca universal, os traces lentos tinham em sua maioria degradação de rede no caminho crítico. Um projeto de dependências entre serviços as infere a partir das anotações, e um console de uso de rede foi construído sobre as APIs em menos de 2 semanas.

## Análise crítica

Os próprios autores listam os limites.

- **Homogeneidade.** A transparência depende de um modelo de threads, uma biblioteca de controle de fluxo e um sistema de RPC únicos. O artigo chama seu ambiente de algo incomum nisso e oferece apenas condições suficientes para ambientes mais heterogêneos.
- **Coalescência e lotes.** O modelo supõe que os subsistemas trabalham para uma requisição rastreada por vez. Quando as requisições são agrupadas em lote, uma requisição rastreada pode ser culpada por uma unidade de trabalho enganosamente grande, e só uma das requisições do lote aparece como responsável, porque cada trace tem um único trace id. Cargas em lote como o MapReduce precisam associar o id a outra unidade, como uma faixa de chaves ou um shard.
- **Causa raiz.** O Dapper mostra onde está a lentidão, nem sempre por quê. Uma requisição pode ser lenta porque outras estavam na fila à frente dela. O artigo sugere anotações com o tamanho das filas e a amostragem em pares do ProfileMe, e nota que informação de nível de kernel é difícil de amarrar a um contexto em espaço de usuário.
- **Coleta fora de banda.** Escolhida para que os traces não inflem as respostas de RPC e porque os RPCs nem sempre são perfeitamente aninhados, já que um middleware pode responder antes de seus backends terminarem.
- **Combate a incêndios.** Enquanto a análise em lote não termina em até 10 minutos após o início de um evento, serviços de armazenamento compartilhado não conseguem aproveitar o Dapper por completo.
- **A amostragem adaptativa estava em andamento.** O texto a lista entre as características do projeto, mas a Seção 4.4 diz que ela estava sendo implantada. O que rodava em produção era uniforme, mais a segunda amostragem nos coletores.

Os pontos a seguir são leitura da evidência, não afirmações do artigo.

- **Sem números sobre o custo da amostragem para a análise.** O argumento de que padrões frequentes aparecem milhares de vezes vale para os casos comuns. O custo recai sobre requisições lentas e raras, justamente as que importam para a latência de cauda, e o artigo não traz dados de quantas se perdem.
- **Literatura posterior (fora do artigo).** O artigo do Canopy (Facebook, SOSP 2017) descreve o Dapper como um modelo de traces em árvores de spans e relata que usuários do Zipkin de código aberto tiveram dificuldade com filas, execuções assíncronas e causalidade com vários pais. O Canopy argumenta que fixar um modelo de alto nível na instrumentação, que é pervasiva, causa problemas para componentes legados e futuros, e descreve um pipeline que deriva dados de desempenho de traces gerados pelo sistema. A documentação do OpenTelemetry hoje descreve spans com um SpanContext e uma lista de Links para outros spans, que permitem relações fora de uma árvore estrita, e distingue a amostragem na cabeça (decidida o mais cedo possível, como no runtime do Dapper) da amostragem na cauda (decidida depois de inspecionar o trace inteiro).

## Pesquisas futuras

- Amostragem que preserve traces lentos e raros: o que decide manter um trace, e com qual contabilidade da probabilidade real, que o Dapper registra junto com o trace.
- Tracing de lotes e filas sem perder a causalidade: a questão em aberto que os autores citam para os efeitos de coalescência e para cargas MapReduce.
- Juntar traces a eventos de kernel e a dados de recursos, que o artigo só esboça.
- Agregação mais rápida durante incidentes, relevante para falhas difíceis de ver de um só nó, como a [falha cinza](/papers/gray-failure-achilles-heel-cloud-scale-systems) e as [falhas metaestáveis](/papers/metastable-failures-in-distributed-systems).
