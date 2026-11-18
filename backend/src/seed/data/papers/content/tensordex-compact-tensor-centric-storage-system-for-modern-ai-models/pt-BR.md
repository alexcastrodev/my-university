---
title: "TensorDex: um sistema de armazenamento compacto e centrado em tensores para modelos de IA modernos"
summary: O TensorDex armazena modelos de linguagem ajustados (fine-tuned) sem perdas, comprimindo cada tensor como delta contra o tensor mais parecido de qualquer modelo anterior, encontrado por um sketch de 8 KB em nível de bits, um regressor que prevê a compressibilidade e um algoritmo de clusterização incremental, e reduz em 70,5% um corpus amostrado do Hugging Face sem precisar da linhagem dos model cards.
researchArea: Sistemas para aprendizado de máquina
keywords: armazenamento de modelos, compressão delta, tensores, compressão sem perdas, deduplicação, clusterização, hugging face
version: 1.0
updatedAt: 2026-11-18
---

## Visão geral

Os hubs de modelos guardam uma pilha crescente de modelos de linguagem grandes. O armazenamento acumulado do Hugging Face, modelos e datasets juntos, foi de 0,28 PB em 2023 para mais de 76 PB no fim de 2025, e a maior parte são derivados ajustados: em 2025 eles respondem por 99,1% do armazenamento e 99,6% dos modelos. Um fine-tune difere só um pouco do modelo de origem mas ocupa o tamanho inteiro, então a economia óbvia é a compressão delta: guardar um modelo base uma vez e, para cada variante, só a diferença comprimida.

Os autores argumentam que a compressão delta quebra na escala de um hub por três razões. A linhagem está ausente: de 2.751.212 repositórios do Hugging Face em março de 2026, só 25,8% trazem metadado utilizável de modelo base, e para os modelos mais frios a taxa de ausência passa de 88%, além de o metadado ser muitas vezes copiado ou editado de forma incorreta. A escolha da base é decisiva: em cinco variantes do Qwen2.5-3B, parear cada uma com a base pré-treinada dá 29% de redução, enquanto a melhor base empírica por modelo dá 47%. E a unidade certa é o tensor, não o modelo: embeddings, projeções de atenção e camadas MLP derivam de formas diferentes durante o fine-tuning, então a melhor base para um tensor de um modelo muitas vezes mora num modelo diferente da melhor base para outro tensor. O sistema de estado da arte com que eles se comparam, o ZipLLM, depende dos model cards e pareia modelos inteiros, e recorre a uma busca por força bruta de distância de bits quando o card falta, o que custa uma E/S quadrática no tamanho do hub.

Este artigo do SOSP 2026, vencedor do Distinguished Artifact Award, apresenta o TensorDex como um sistema de armazenamento sem perdas e centrado em tensores que encontra o pareamento a partir dos próprios dados.

Termos para não confundir: tensor base é guardado por inteiro e tensor delta é guardado como uma diferença comprimida contra exatamente uma base, razão de redução é a fração de bytes economizados num tensor ou num conjunto de tensores, distância de Hamming normalizada é a fração de bits que diferem entre dois tensores, e cluster é uma base mais os tensores comprimidos como delta contra ela.

Vale conhecer antes: como o fine-tuning muda os pesos só um pouco, o que a codificação delta por XOR e a codificação por entropia fazem com bytes que são quase todos iguais, a estrutura do formato de arquivo safetensors e a ideia de busca aproximada de vizinhos mais próximos com HNSW.

## Contribuição

- **TensorID e TensorSketch.** Todo tensor recebe um xxHash128 de 16 bytes sobre seus bytes brutos para a deduplicação exata e um fingerprint TensorSketch para a similaridade. O TensorSketch é um CountSketch construído sobre bits em vez de valores: cada posição de bit de cada elemento é mapeada por hash num bucket com um sinal, então o sketch acompanha a divergência em nível de bits, que é o que a compressibilidade do delta depende. Com profundidade 2 e largura 1.024 de contadores de 32 bits ele ocupa 8 KB por tensor, e a distância de Hamming entre dois tensores é estimada como a mediana, entre as linhas, da norma L2 ao quadrado da diferença dos sketches.
- **TensorPred.** Uma regressão pequena prevê a razão de redução de um par de tensores a partir da distância de Hamming normalizada estimada, da sua entropia binária e do produto das duas, com coeficientes ajustados offline. Isso fecha a lacuna entre similaridade e compressibilidade, já que dois tensores próximos em L2 ainda podem dar um delta pouco compressível.
- **FlexSplit.** Um algoritmo de clusterização incremental em duas fases que aproxima o problema NP-difícil de localização de instalações de escolher as bases. A Fase I anexa cada tensor que chega à base existente com a maior redução prevista, ou abre um novo cluster para uma forma e um nome nunca vistos, usando um índice HNSW sobre os sketches. A Fase II revisita os clusters, toma como candidatos a divisão os membros cuja redução prevista está bem abaixo da média do cluster e promove um deles a nova base só quando o ganho líquido é positivo, reatribuindo os membros que melhoram. A divisão é local ao cluster, e cada delta referencia exatamente uma base, então restaurar um tensor lê uma base e um delta.
- **Codecs plugáveis.** O TensorX estende o BitX do ZipLLM com paralelismo por chunk e separação por planos de bytes, voltado à vazão. O FM++ estende o FM-Delta com suporte nativo a BF16 e paralelismo por chunk, elevando sua velocidade de cerca de 100 MB/s para 9.821 MB/s, voltado à redução. O planejamento é desacoplado do codec.
- **Implementação.** Cerca de 12 mil linhas de Python e 3 mil de C e Rust com kernels SIMD/AVX2, um repositório de metadados em PostgreSQL, um índice HNSW e um formato de blob compatível com safetensors estendido com flags de compressão. A remoção é adiada: o tensor é marcado como removido e, se for uma base com dependentes vivos, uma transação offline posterior promove outro membro do cluster e recomprime os dependentes. O código é público (ds2-lab/TensorDex).

## Metodologia

O dataset reconstrói o trace aleatório usado pelo ZipLLM: 2.890 modelos com 961.509 tensores (44,86 TB), amostrados dentro de oito famílias representativas de modelos ajustados (Qwen2.5, Qwen3, Mistral, Llama-3, 3.1 e 3.2, Gemma-2 e Gemma-3) e não no hub inteiro. A deduplicação exata por TensorID deixa 741.689 tensores únicos (40,11 TB), e toda razão de redução do artigo, inclusive a de destaque, é medida contra esse tamanho pós-deduplicação. Os modelos são ingeridos na ordem de criação para imitar um hub que recebe uploads continuamente.

Os experimentos rodam numa Amazon EC2 c6a.48xlarge (AMD EPYC 7R13 de 96 núcleos e 192 threads, 384 GB de DRAM), com todos os dados em memória para a vazão e com o Amazon S3 e um volume EBS gp3 provisionado para o teste de recuperação em armazenamento real. As linhas de base de planejamento são o ZipLLM e um padrão que agrupa modelos pela família do model card e aplica o FM-Delta, com metadado dado aleatoriamente a 25,8% dos modelos para espelhar a realidade e o ZipNN como alternativa. As linhas de base de codec são BitX, FM-Delta puro, ZipNN, zstd e OpenZL. A busca por similaridade é comparada com a distância de bits exata, HNSW sobre os bytes brutos do tensor, hashing sensível à localidade e uma projeção aleatória de 2048 dimensões. O solucionador de escolha de bases é comparado com o programa linear inteiro do Gurobi e uma aproximação primal-dual em até 800 tensores do Qwen2.5-7B.

## Resultados

Estes são os resultados reportados pelos autores.

- **Armazenamento.** O TensorDex-FM++ reduz o corpus em 70,5% e o TensorDex-TX em 65,1%, contra 53,4% do ZipLLM e 37,1%, 33,3% e 21,9% de FM-Delta, ZipNN e OpenZL sozinhos. O destaque "37% menor que o estado da arte" é o que sobra do volume, cerca de 29,5% do tamanho deduplicado contra 46,6%. A redução continua subindo conforme chegam mais modelos, sem sinal de saturação, enquanto o ZipLLM estaciona.
- **Atribuição.** Com um codec comparável, só o planejador leva 53,4% a 65,1% (ZipLLM contra TensorDex-TX), e trocar o TensorX pelo FM++ sobre os mesmos pares soma 5,4 pontos. As maiores diferenças por família, de 20 a 25 pontos, estão no Qwen2.5, no Mistral-v0.1 e no Gemma-3, onde o ZipLLM cai abaixo de 50% e o TensorDex-FM++ fica acima de 65%.
- **Vazão.** Com todos os dados em memória e 192 threads, o TensorDex-TX ingere a 22.916 MB/s e recupera a 28.393 MB/s, contra o ZipLLM a 5.942 e 7.981 e o OpenZL a 753 e 19.068. São as 3,86 vezes e 1,49 vezes do resumo. O TensorDex-FM++ chega a 9.821 e 8.494 MB/s.
- **Armazenamento real.** A recuperação do S3 e do EBS roda a 1,96 a 4,26 GB/s, de 3 a 4,5 vezes abaixo do valor em memória, então é limitada por E/S e a descompressão não é o gargalo. A amplificação de leitura é de 1,2 a 1,4 vez, mediana de 1,27 vez.
- **Metadados.** TensorID e TensorSketch dos 741.689 tensores únicos ocupam cerca de 6,1 GB, 0,015% dos dados armazenados.
- **TensorSketch.** O Recall@1 é de cerca de 1,00 em Qwen, Llama e Gemma, contra 0,60 a 0,77 do HNSW sobre tensores brutos e do LSH e 0,32 a 0,41 da projeção aleatória. Ele sustenta mais de 25.000 consultas por segundo (500 a 800 vezes o HNSW sobre tensores brutos, até 20.082 vezes a distância de bits exata) e reduz a E/S por consulta de cerca de 35 MB para 8 KB. O HNSW sobre os sketches atinge Recall@1 de 0,9986 em relação à busca exata e dá o mesmo resultado no FlexSplit (65,1%, 6.482 bases) clusterizando 3,8 vezes mais rápido.
- **TensorPred.** Em 5,7 milhões de pares reservados a correlação de Pearson é de 0,993, com erro absoluto médio de 1,11%, mediana de 0,79%, P90 de 2,32% e P99 de 6,03%. Treinado em Qwen e Llama e testado em Gemma e Mistral nunca vistos, o erro sobe só de 0,0230 para 0,0265 e a correlação é de 0,978 contra 0,977.
- **FlexSplit.** O tempo de solução fica quase plano de 100 a 800 tensores enquanto o ILP passa de 70 segundos em 800 e o primal-dual cresce linearmente, com redução a poucos pontos do ótimo do ILP. No corpus inteiro, 58,9% dos clusters não precisam de divisão, e entre os 1.352 clusters divididos 98,8% melhoram, mediana de 0,469 para 0,650.

## Análise crítica

O artigo declara vários limites por conta própria.

- **Uma amostra dentro de famílias populares.** O trace é sorteado dentro de oito famílias de modelos ajustados, não no hub, e os autores dizem isso.
- **Condições de compatibilidade.** Um delta e sua base precisam compartilhar o dtype, e um tensor com forma e nome nunca vistos abre seu próprio cluster como base. Adaptadores LoRA e checkpoints quantizados são tratados como conjuntos de tensores comuns, e os fine-tunes de pesos completos e os checkpoints dominam o armazenamento.
- **A recuperação é limitada por E/S na prática.** Os próprios autores reportam isso a partir do teste com S3 e EBS.

Os pontos a seguir são uma leitura da evidência, não afirmações do artigo.

- **O destaque mistura duas configurações.** A redução de 70,5% é do TensorDex-FM++, enquanto os 22,9 GB/s e 28,4 GB/s pertencem ao TensorDex-TX, que chega a 65,1%. O FM++ ingere a 9.821 MB/s, 1,65 vez o ZipLLM, e recupera a 8.494 MB/s, só 1,06 vez. Além disso, o "melhor sistema seguinte" é o ZipLLM na ingestão e o OpenZL na recuperação, e o OpenZL economiza apenas 21,9%, então o ganho de recuperação é contra um compressor que economiza um terço do que o TensorDex economiza.
- **A vazão é um teto, não uma experiência.** Os números em memória usam todas as 192 threads de uma instância grande, e em armazenamento real a taxa de recuperação cai para alguns GB/s, o que um decodificador mais rápido não melhora. O argumento a favor do sistema passa a ser o armazenamento economizado, e o artigo não o traduz em custo.
- **A deduplicação fica fora do destaque.** Os 70,5% são medidos depois que a deduplicação exata já removeu cerca de 10,6% dos bytes (44,86 TB para 40,11 TB), então a economia de ponta a ponta contra o corpus bruto é maior, e os sistemas comparados partem do mesmo ponto.
- **Os custos de manutenção não aparecem.** A Fase II reanexa membros a novas bases e remover uma base recomprime seus dependentes, e o texto que li não mede nenhum dos dois, nem o efeito de uma rotatividade longa como muitas remoções num hub. O trace é ingerido uma vez, na ordem de criação.
- **A otimalidade é checada só em pequena escala.** A comparação com o ILP cobre até 800 tensores de dois tipos, enquanto o corpus tem 741.689, então a afirmação de quase ótimo é mostrada numa fatia. O teste reservado do TensorPred cobre famílias nunca vistas.
- **Justiça da linha de base de metadados.** O texto que li não diz quanto metadado de linhagem o ZipLLM recebeu na comparação, e a fraqueza reportada do ZipLLM é maior onde a linhagem falta, então a diferença depende dessa suposição.

## Pesquisas futuras

- Planejar no hub inteiro, não dentro de poucas famílias, incluindo arquiteturas sem parente anterior, e combinar deltas sem perdas com técnicas com perdas onde os usuários aceitarem.
- Medir o custo da operação contínua: recompressão depois de divisões e remoções, crescimento do índice e o efeito sobre a latência de cauda dos downloads de modelos.
- Colocar as bases populares num cache ou numa camada mais rápida para reduzir a amplificação de leitura, o que os autores sugerem.
- Estender a mesma visão em nível de tensor para datasets, estado do otimizador e checkpoints intermediários de treinamento, que os pipelines de produção costumam guardar por inteiro.
