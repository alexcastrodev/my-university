---
title: "Escalando o Memcache no Facebook"
summary: Como o Facebook transformou o memcached de código aberto em um cache chave-valor distribuído que atende mais de um bilhão de requisições por segundo, com lições organizadas por escala (cluster, região, várias regiões) e um modelo de consistência deliberadamente eventual.
researchArea: Sistemas distribuídos
keywords: memcached, cache, leases, invalidação, consistência eventual, replicação, armazenamento chave-valor
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

O memcached é uma solução de cache em memória conhecida e simples. Este artigo descreve como o Facebook usa o memcached como bloco de construção para montar e escalar um armazenamento chave-valor distribuído que sustenta a maior rede social do mundo. O sistema atende bilhões de requisições por segundo e guarda trilhões de itens para entregar uma experiência rica a mais de um bilhão de usuários no mundo todo.

## Visão geral

O artigo é um relato de experiência industrial do NSDI 2013 sobre a camada de cache baseada em memcached por trás do Facebook. A carga é dominada por leitura (os usuários consomem uma ordem de grandeza mais conteúdo do que criam) e busca dados em MySQL, HDFS e outros serviços de backend. Por isso a equipe usou o memcached, uma tabela hash em memória de uma única máquina com apenas set, get e delete, como cache look-aside preenchido sob demanda. O servidor web consulta o cache primeiro, vai ao banco em caso de miss e grava o valor; em uma escrita, atualiza o banco e depois apaga a chave. Apagar é preferido a atualizar porque o delete é idempotente.

Vale comparar com outros sistemas chave-valor do catálogo. O [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) é um armazenamento persistente que os autores do Facebook descrevem como otimizado para cargas pesadas em escrita, enquanto o sistema deles mira uma carga dominada por leitura e não garante persistência. O artigo também cita o [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) como parte da linhagem de trabalhos sobre chave-valor distribuído, e o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data) é um exemplo de armazenamento persistente e estruturado que um cache assim pode proteger (o próprio artigo cita o MySQL como armazenamento de apoio). Os autores organizam o texto em três escalas: um cluster (latência e carga), uma região com vários clusters de frontend (replicação) e várias regiões (consistência).

Vale saber antes: hash consistente, invalidação de cache, replicação do MySQL e a diferença entre um cache (que pode descartar dados) e um repositório de referência.

## Contribuição

- **Uma arquitetura que evolui com a escala.** Um cluster, depois vários clusters de frontend compartilhando um cluster de armazenamento em uma região, depois uma região mestre mais regiões réplica somente de leitura.
- **Cliente sem estado e um proxy.** Roteamento, agrupamento, serialização, compressão e tratamento de erros ficam em uma biblioteca cliente ou no proxy mcrouter, então os servidores memcached nunca conversam entre si.
- **Leases.** Um token de 64 bits ligado a uma chave, entregue ao cliente em um miss, resolve o stale set e o thundering herd. Uma opção de valor desatualizado de curta duração complementa o mecanismo.
- **Pools, replicação dentro de pools e Gutter.** As cargas são separadas em pools, conjuntos pequenos e quentes são replicados, e um pequeno pool reserva absorve o tráfego de servidores que falharam.
- **Um pipeline de invalidação.** O daemon mcsqueal lê o log de SQL já confirmado e transmite os deletes, e um marcador remoto trata a leitura após escrita feita em região não mestre.
- **Melhorias em um servidor e dados da carga real.** Alocador de slabs adaptativo, cache de itens transitórios, travas de granularidade fina, atualizações via memória compartilhada e medições de produção.

## Metodologia

É uma descrição de sistema apoiada em medições de produção, não um experimento controlado. Os autores apresentam cada mecanismo junto com o problema que o motivou e o sustentam com dados do site em funcionamento: operações de memcache amostradas nos servidores web, estatísticas por pool com médias em janelas de tempo, uma amostra de um em cada milhão de chaves para aproximar o conjunto de trabalho e um monitor que amostra um em cada milhão de deletes e depois verifica se a chave ainda existe em cada cluster de frontend. Os resultados de um único servidor vêm de uma bancada com quinze clientes e um servidor memcached de 24 threads em gigabit ethernet, medidos em dois minutos de carga sustentada. O artigo afirma que as prioridades de projeto foram que toda mudança resolva um problema visível ao usuário ou operacional, e que a probabilidade de ler dados transitoriamente desatualizados é um parâmetro a ajustar, como a responsividade.

## Resultados

Todos os números abaixo são do próprio artigo.

- **O fan-out é grande.** Uma página popular busca em média 521 itens distintos, os lotes têm em média 24 chaves, 56% das requisições de página contatam menos de 20 servidores memcached e a maioria das requisições de uma página popular e intensiva em dados acessa mais de 100 servidores distintos.
- **UDP para gets, TCP para sets e deletes.** Os gets vão direto por UDP das threads do servidor web; sets e deletes vão por TCP por meio de um mcrouter local que agrega conexões. No pico, 0,25% dos gets são descartados (cerca de 80% por pacotes atrasados ou perdidos, o resto fora de ordem) e tratados como miss. O UDP dá cerca de 20% de redução de latência. Uma janela deslizante limita o incast congestion.
- **Latência.** Em 7 dias, a mediana do tempo de ida e volta é 333 microssegundos, o p75 é 475 microssegundos e o p95 é 1,135 ms. A partir de um servidor web ocioso, a mediana é 178 microssegundos.
- **Leases.** Com um token por chave a cada 10 segundos por padrão, o pico de consultas ao banco para um conjunto de chaves propensas a herd caiu de 17K/s para 1,3K/s.
- **Gutter.** Cerca de 1% dos servidores de um cluster. Reduz as falhas visíveis ao cliente em 99% e converte de 10% a 25% das falhas em hits por dia. Após a falha de um servidor, a taxa de acerto do gutter em geral passa de 35% em menos de 4 minutos.
- **Invalidação regional.** Apenas 4% dos deletes emitidos invalidam dados em cache. O agrupamento via mcrouter melhora 18 vezes a mediana de deletes por pacote. A banda entre clusters é 40% menor que dentro de um cluster. O Cold Cluster Warmup leva um cluster novo à capacidade total em horas, não em dias, usando uma espera de dois segundos nos deletes para evitar inconsistência.
- **Marcador remoto.** Uma escrita vinda de região não mestre cria o marcador rk, escreve no mestre com k e rk no comando SQL e apaga k localmente. Um miss posterior consulta rk e lê da região mestre se ele existir, trocando latência por menos dados desatualizados.
- **Confiabilidade dos deletes.** Dentro da região mestre, quatro noves em 1 segundo e cinco noves após uma hora; para deletes que partem de fora da região mestre, três noves em um segundo e quatro noves em 10 minutos.
- **Um servidor.** A trava de granularidade fina eleva o pico de gets com hit de 600k para 1,8M itens por segundo e de misses de 2,7M para 4,5M. O UDP supera o TCP em 13% nos gets simples e 8% nos multigets de 10 chaves. Dar expiração curta a uma família de chaves reduziu sua fatia de um pool de 6% para 0,3%.
- **Taxa de miss dos pools** (médias de pico): wildcard 1,76%, app 7,85%, replicated 0,053%, regional 6,35%.

Os autores listam cinco lições: separar cache de armazenamento persistente permite escalar cada um por conta própria, recursos de monitoramento e depuração importam tanto quanto desempenho, componentes com estado são mais difíceis de operar que os sem estado, funcionalidades precisam de implantação e reversão graduais, e a simplicidade é vital.

## Análise crítica

O artigo é franco ao dizer que a consistência é o ponto frágil: oferece "consistência eventual com melhor esforço" e trata a leitura desatualizada como um custo ajustável. Não afirma linearizabilidade, consistência causal nem qualquer limite para a defasagem. O marcador remoto pode induzir a erro quando há modificações concorrentes da mesma chave, e a espera do warmup a frio é reconhecida como uma proteção probabilística, não uma prova.

O que o artigo não traz: o número de servidores ou clusters (só "centenas" de servidores memcached por cluster e "milhares de servidores dentro de um cluster" como o desafio de escala), uma taxa de acerto global (só taxas de miss por pool) nem uma comparação controlada com alternativas; a escolha do memcached é justificada como a melhor opção com pouco tempo de engenharia. O resumo diz bilhões de requisições por segundo e a introdução diz mais de um bilhão, então o pico exato não fica fixado. Várias decisões, como mover uma família de chaves para um pool regional, são descritas como heurísticas manuais.

Literatura posterior, que não faz parte deste artigo e foi lida só em parte para esta nota: o TAO do Facebook (o artigo do Memcache diz que o TAO implementa um modelo de dados em grafo e assume a responsabilidade pela persistência, e cita o pôster do SIGMOD 2012; o artigo completo posterior, no USENIX ATC 13, foi confirmado apenas pela listagem, sem leitura); e o CacheLib (Berg et al., OSDI 2020), um motor de cache de uso geral que, segundo o resumo do OSDI, foi implantado no Facebook pela primeira vez em 2017. Só o resumo do CacheLib foi lido, então afirmações sobre sua relação com o memcache ficam de fora.

## Pesquisas futuras

- Projetos de cache com consistência mais forte e demonstrável, sem perder os ganhos de latência e carga relatados aqui.
- Trocar as heurísticas manuais de pools e regionalização por decisões automáticas guiadas pela carga.
- Medir com que frequência leituras desatualizadas ocorrem em produção, já que o artigo relata a confiabilidade da invalidação, mas não a defasagem percebida pelo usuário.
- Comparar o cache look-aside com caches integrados à camada de armazenamento, como em armazenamentos de grafos ou estruturados.
