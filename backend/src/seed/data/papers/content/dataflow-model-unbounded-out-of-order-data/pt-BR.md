---
title: "O modelo Dataflow: uma abordagem prática para equilibrar correção, latência e custo no processamento de dados ilimitados e fora de ordem em escala massiva"
summary: Um modelo de programação para processamento em fluxo e em lote que trata os dados como ilimitados e atrasados, e separa o que é calculado, onde no tempo do evento, quando no tempo de processamento e como os resultados são refinados.
researchArea: Sistemas distribuídos
keywords: processamento de fluxo, tempo de evento, janelas, gatilhos, watermarks, dataflow
version: 1.0
updatedAt: 2026-11-01
---

## Visão geral

Muitos dados úteis nunca terminam: logs web, uso de celulares, sensores. Eles também chegam fora de ordem, porque telefones ficam offline e redes são lentas, então o momento em que um evento aconteceu (tempo de evento) é diferente do momento em que o sistema o vê (tempo de processamento). A prática mais antiga tratava esses dados como um lote que um dia estaria completo, ou usava um motor de fluxo rápido, mas aproximado, e segundo os autores as equipes acabavam com sistemas distintos para cada necessidade.

Este artigo do VLDB 2015, do Google, propõe o modelo Dataflow, uma forma de escrever essas computações que abre mão da ideia de completude e deixa quem programa escolher um ponto entre correção, latência e custo. É o modelo por trás do Google Cloud Dataflow e de seu SDK de código aberto, que depois virou o Apache Beam.

Vale conhecer antes: processamento em lote no estilo MapReduce, a diferença entre tempo de evento e tempo de processamento, e o que é uma janela (uma fatia finita de um fluxo, como os eventos de uma sessão ou de um minuto).

## Contribuição

O modelo faz quatro perguntas a cada pipeline:

- **O quê** é calculado (as transformações e agregações).
- **Onde** no tempo de evento (janelas, incluindo janelas que não se alinham entre chaves, como sessões por usuário).
- **Quando** no tempo de processamento os resultados são produzidos (gatilhos, guiados por watermarks, contagens ou temporizadores).
- **Como** os resultados posteriores se relacionam com os anteriores (acumulação: descartar, acumular, ou acumular e retratar).

Em torno disso o artigo oferece uma API de janelas com janelas não alinhadas no tempo de evento, um modelo declarativo de gatilhos, suporte a atualizações e retratações e uma lista de princípios de projeto. Seu ponto de vista declarado é que motores em lote, em micro-lote e em fluxo podem dar as mesmas respostas corretas, e a escolha entre eles deve se reduzir a latência e custo.

## Metodologia

O artigo é de projeto e semântica. Ele constrói o modelo com um exemplo contínuo, somar valores inteiros por chave com várias escolhas de janela, gatilho e acumulação, e mostra em figuras a saída de cada escolha sobre os mesmos dados de exemplo. Define o watermark como um limite inferior, muitas vezes heurístico, para os tempos de evento que ainda serão vistos.

A validação é por experiência e não por benchmark. O modelo foi implementado no FlumeJava com o MillWheel como motor de fluxo, com uma reimplementação externa para o Cloud Dataflow, e os autores descrevem como pipelines reais do Google (cobrança, estatísticas, detecção de abuso, recomendações) o moldaram.

## Resultados

Estes são os resultados relatados pelos autores, e são qualitativos.

- Watermarks sozinhos são um sinal de completude ruim. Um watermark heurístico pode deixar passar dados atrasados, e um lento, atrasado por retardatários, segura todos os resultados. Uma equipe de cobrança teve problemas com o atraso do watermark causado por retardatários, e uma equipe sem atualizações e retratações saiu da plataforma para construir sua própria solução, que acabou parecida com o modelo descrito.
- Gatilhos permitem que os mesmos dados produzam saídas diferentes sem mudar a computação. Pipelines de estatísticas e de detecção de abuso ficam satisfeitos com um gatilho de watermark ou de watermark por percentil, porque uma resposta quase completa mais cedo vale mais que uma resposta perfeita mais tarde.
- O lote é tratado como um caso especial: ideias como encerrar antecipadamente um job longo com base no progresso viram um gatilho comum.
- Boa parte do código de janelas e gatilhos é compartilhada pelas implementações de lote e de fluxo.

## Análise crítica

As ideias foram influentes, e muitos motores de fluxo de código aberto adotaram conceitos parecidos. Isso é parte do motivo para ler com algum distanciamento.

- **Sem medições.** O artigo não relata latência, vazão nem custo, e os detalhes de implementação ficam para artigos anteriores. A afirmação de que o modelo permite ajustar custo, latência e correção é defendida por exemplos, não demonstrada com dados.
- **Autores e sistema têm o mesmo dono.** As experiências vêm de equipes e produtos do Google, e o artigo também apresenta um serviço comercial. A evidência independente vem da adoção posterior fora do artigo.
- **Watermarks continuam sendo heurísticas.** O artigo admite que a maioria dos watermarks reais não pode ser exata. O modelo oferece ferramentas para lidar com dados atrasados (atraso permitido, retratações), mas a escolha do gatilho fica com quem programa e é fácil de errar.
- **Custo das retratações.** Emitir retratações e refinamentos empurra complexidade para a etapa seguinte, já que os consumidores precisam tratar atualizações, e o artigo não quantifica o estado mantido para sustentá-las.
- **Declaração de princípio.** Afirmações como "o futuro do processamento de dados são os dados ilimitados" são opiniões dos autores.

## Pesquisas futuras

- Medir o custo de estado, gatilhos e retratações sob carga real, e comparar motores que implementam o modelo.
- Estimativa de watermark melhor, possivelmente adaptativa, e orientação para escolher gatilhos e atraso permitido.
- Questões de exatamente-uma-vez e de consistência em destinos que não aceitam retratações.
- Um relato mais profundo do runtime compartilhado de lote e fluxo, que os autores dizem merecer uma análise própria.
