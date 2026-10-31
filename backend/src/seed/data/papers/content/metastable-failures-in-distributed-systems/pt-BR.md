---
title: "Metastable Failures in Distributed Systems"
summary: Um artigo de visão que dá nome a uma classe de incidentes em que um gatilho empurra o sistema para um estado ruim que um ciclo de realimentação mantém vivo depois que o gatilho acaba.
researchArea: Sistemas distribuídos
keywords: falhas metaestáveis, resiliência, sobrecarga, novas tentativas, cache, interrupções de serviço
version: 1.1
updatedAt: 2026-10-31
---

## Visão geral

Grandes incidentes costumam ser atribuídos a um gatilho: uma oscilação de rede, um cache perdido, um pico de tráfego. Este artigo de visão do HotOS 2021, escrito a partir da experiência de operar sistemas de hiperescala, diz que em muitos deles o gatilho não é a causa raiz.

Ele descreve as falhas metaestáveis: depois de um gatilho, o sistema continua num estado ruim, com goodput (trabalho útil por segundo) muito baixo, mesmo que o gatilho tenha acabado, porque algo dentro do próprio sistema o sustenta. Sair desse estado exige um empurrão forte, como um reinício ou um corte grande na carga.

## Contribuição

O artigo não propõe um sistema. Sua contribuição é um vocabulário e um modo de olhar para incidentes.

- Um sistema transita entre um estado **estável**, um estado **vulnerável** (saudável, mas um gatilho pode derrubá-lo) e um estado **metaestável** (preso).
- A **causa raiz** é o efeito de sustentação, em geral um ciclo de realimentação com amplificação de trabalho, e não o gatilho. Muitos gatilhos diferentes levam ao mesmo estado.
- Muitos sistemas em produção escolhem operar no estado vulnerável de propósito, porque ele é muito mais eficiente que o estável.

## Metodologia

O método é a análise de casos da experiência em produção, numa forma simplificada, seguida de um levantamento do que os profissionais fizeram.

Os casos são retentativas de requisições (uma aplicação web com um banco atrás), um cache look-aside que é perdido e não consegue se reencher, tratamento de erro lento e um desequilíbrio entre os enlaces de uma conexão de rede agregada. Para cada um, o artigo identifica o gatilho, o efeito de sustentação e o recurso que se esgota.

Em seguida lista técnicas usadas depois do fato: mudar políticas durante a sobrecarga (orçamento de retentativas, escalonamento LIFO, descarte de carga, circuit breakers), priorização e testes de estresse, e termina com perguntas de pesquisa.

## Resultados

Não há experimentos. Os números vêm de exemplos desenvolvidos no texto.

- No exemplo das retentativas, o banco atende 300 consultas por segundo. Com 280 consultas por segundo, uma queda de rede de 10 segundos seguida de requisições retransmitidas e retentativas dobra a carga para 560 e o sistema fica preso, sem goodput. A recuperação exige carga abaixo de 150 consultas por segundo ou retentativas limitadas a menos de 20.
- Com 90% de acerto no cache, a aplicação web aguenta 3.000 consultas por segundo, mas o banco sozinho aguenta cerca de 300. Se o cache for perdido numa carga acima disso, o cache vazio não consegue se reencher, e perder um cache com 90% de acerto multiplica por 10 as consultas ao banco.
- O artigo descreve uma falha de desequilíbrio de enlaces que levou mais de dois anos para ser explicada e teve correção de uma linha, uma mudança na política do pool de conexões.
- Um sistema georreplicado que acrescentou retentativas e failover para ganhar confiabilidade em regime normal chegou a uma amplificação de trabalho de mais de 100x no pior caso.

## Análise crítica

O enquadramento é útil porque desloca a atenção do gatilho para o ciclo que sustenta a falha, e porque mostra que recursos adicionados por confiabilidade (retentativas, caches, failover) podem ser a causa.

Limites para ter em mente:

- É um artigo de visão. Os exemplos são recontagens simplificadas, não dados, e o artigo não diz quão comuns as falhas metaestáveis são.
- A definição é ampla. Ela as separa de negação de serviço, limplock e livelock, mas na prática decidir se um incidente foi metaestável ainda exige julgamento depois do fato.
- As mitigações são pontuais e reativas, como os autores admitem, e várias têm custos próprios (por exemplo, a coordenação de políticas adaptativas pode virar um novo efeito de sustentação).
- A previsão fica em aberto: achar o estado vulnerável antes de um gatilho chegar é a parte difícil e não é resolvida aqui.

## Pesquisas futuras

Os autores listam perguntas em aberto.

- Formas sistemáticas de encontrar estados vulneráveis em sistemas existentes.
- Projetar sistemas cujos ciclos de realimentação sejam impossíveis ou ao menos descobríveis, por exemplo limitando a amplificação de trabalho.
- Usar uma métrica característica (como atraso de fila ou taxa de acerto do cache) que continua anormal até a falha se resolver.
- Se a capacidade elástica da nuvem pode encerrar uma falha metaestável, e quanto custa a reconfiguração.
- Modelos e testes que prevejam a próxima falha em vez de explicar a última.
