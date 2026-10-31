---
title: "Efficient Memory Management for Large Language Model Serving with PagedAttention"
summary: Aplica a paginação dos sistemas operacionais ao cache chave-valor do serviço de LLMs, quase eliminando a memória de GPU desperdiçada e permitindo que requisições compartilhem blocos de cache.
version: 1.0
updatedAt: 2026-10-31
---

## Visão geral

Atender um modelo de linguagem grande a muitos usuários ao mesmo tempo exige lotes grandes, e o tamanho do lote é limitado pela memória da GPU. Boa parte dessa memória vai para o cache chave-valor (KV cache), que guarda o estado de atenção de cada token de cada requisição e cresce e diminui conforme cada requisição gera texto.

Este artigo do SOSP 2023 observa que os sistemas existentes gerenciam mal essa memória, desperdiçando-a em fragmentação e duplicação, e toma emprestada uma ideia dos sistemas operacionais para resolver isso.

## Contribuição

O artigo contribui com duas coisas.

- **PagedAttention**, um algoritmo de atenção que funciona sobre um KV cache guardado em blocos de tamanho fixo não contíguos, como páginas em memória virtual.
- **vLLM**, um motor de serviço construído sobre ele, com gerenciamento de memória em nível de bloco, escalonamento com preempção e execução distribuída, que desperdiça quase nada da memória do KV cache e compartilha blocos dentro de uma requisição e entre requisições.

## Metodologia

Os autores primeiro medem quanta memória do KV cache os sistemas existentes desperdiçam. Encontram três fontes: espaço reservado para tokens ainda não gerados, fragmentação interna e fragmentação externa.

O vLLM mantém uma tabela de blocos por requisição que mapeia blocos lógicos a blocos físicos, aloca blocos só à medida que os tokens são gerados e usa copy-on-write para blocos compartilhados entre sequências, como em amostragem paralela e beam search. Quando a memória acaba, ele pode fazer preempção de requisições, trocando blocos para a memória da CPU ou recomputando-os.

A avaliação compara o vLLM com o FasterTransformer e o Orca em vários modelos e cargas.

## Resultados

Estes são os resultados relatados pelos autores.

- Nos sistemas existentes, só 20,4% a 38,2% da memória do KV cache guardava estados reais de tokens, enquanto o vLLM usou 96,3%.
- O vLLM melhora a vazão de LLMs populares em 2 a 4x com o mesmo nível de latência em comparação com o FasterTransformer e o Orca.
- A melhora é maior com sequências mais longas, modelos maiores e algoritmos de decodificação mais complexos.
- O artigo relata isso sem afetar a acurácia do modelo, e o código-fonte é público.

## Análise crítica

A analogia com a paginação é útil porque é concreta: a tabela de blocos, o copy-on-write e a troca para a memória da CPU têm um equivalente direto nos sistemas operacionais, e o código-fonte é público.

Pontos para ler com cuidado:

- Os ganhos dependem de cargas em que a memória, e não a computação, limita o tamanho do lote. Com sequências curtas ou modelos pequenos a diferença diminui.
- Ler de blocos não contíguos tem um custo: os autores medem latência do kernel de atenção 20% a 26% maior que a do FasterTransformer e argumentam que ela é pequena porque afeta só o operador de atenção. O tamanho do bloco é um equilíbrio entre uso do hardware e fragmentação.
- A comparação é com os sistemas da época (FasterTransformer, Orca), e a área anda rápido, então linhas de base mais novas podem reduzir a diferença.
- A troca para a memória da CPU e a recomputação como formas de preempção têm um custo que depende do enlace de hardware e do modelo.

## Pesquisas futuras

- Compartilhar blocos de KV cache entre requisições com prefixos em comum, e políticas sobre quais blocos manter.
- Melhores políticas de escalonamento e preempção sob pressão de memória.
- Estender a abordagem a outros aceleradores e a modelos cujo estado de atenção não seja um KV cache simples.
- Interações entre paginação, quantização e decodificação especulativa.
