---
title: "Análise formal de falhas metaestáveis em sistemas de software"
summary: Dá às falhas metaestáveis uma definição matemática. Sistemas de requisição e resposta com timeouts e retentativas são descritos em uma pequena linguagem, abstraídos em uma cadeia de Markov de tempo contínuo calibrada contra um simulador, e analisados com uma imagem do fluxo do espaço de estados, tempos esperados de recuperação e uma caracterização da metaestabilidade por autovalores.
researchArea: Sistemas distribuídos
keywords: falhas metaestáveis, tempestades de retentativas, cadeias de Markov de tempo contínuo, filas com retentativa, tempo de recuperação, calibração, sistemas de requisição e resposta, modelagem de desempenho
version: 1.0
updatedAt: 2026-11-22
---

## Abstract

Muitos sistemas de software em grande escala apresentam falhas metaestáveis. Nessa classe de falhas, um estressor como um pico temporário de carga faz o desempenho do sistema cair e, em seguida, o desempenho continua baixo mesmo depois que o estressor é removido. Essas falhas foram relatadas por muitas grandes empresas e são consideradas uma fonte rara, mas catastrófica, de indisponibilidade em sistemas de nuvem. Neste artigo, apresentamos os fundamentos matemáticos da metaestabilidade em sistemas de servidores de requisição e resposta. Modelamos esses sistemas usando uma linguagem de domínio específico. Mostramos como construir cadeias de Markov de tempo contínuo (CTMCs) que aproximam a semântica dos programas por meio de modelagem e calibração orientada a dados. Usamos a estrutura dos modelos de CTMC para fornecer uma visualização do comportamento qualitativo do modelo. A visualização é uma forma surpreendentemente eficaz de identificar parametrizações do sistema que fazem com que ele apresente comportamentos metaestáveis. Complementamos a análise qualitativa com previsões quantitativas. Apresentamos uma noção formal de comportamentos metaestáveis baseada em probabilidades de escape e mostramos que os comportamentos metaestáveis estão relacionados à estrutura de autovalores da CTMC. Nossa caracterização leva a ferramentas algorítmicas para prever tempos de recuperação em modelos metaestáveis de sistemas de servidores. Implementamos nossa técnica em uma ferramenta para a modelagem e a análise de sistemas de servidores. Por meio de modelos inspirados em falhas de sistemas reais de requisição e resposta, mostramos que nossa análise visual qualitativa captura e prevê muitas instâncias de metaestabilidade que foram observadas em campo, em questão de milissegundos. Nossos algoritmos confirmam que os tempos de recuperação disparam à medida que os parâmetros do sistema se aproximam dos modos metaestáveis da dinâmica.

## Visão geral

As falhas metaestáveis são aquelas em que um gatilho (um pico de carga, a perda de um cache) já acabou, mas o sistema continua lento. Relatos de grandes operadores e os estudos empíricos que vieram depois as descrevem e classificam, como em [Falhas metaestáveis no mundo real](/papers/metastable-failures-in-the-wild), mas os autores observam que havia pouca teoria para prevê-las. As perguntas deles são práticas: para quais parâmetros uma falha metaestável pode acontecer, quanto tempo a recuperação vai levar e quanto ajudam mitigações comuns como o throttling.

É um preprint de pesquisadores da UC Santa Cruz, do Max Planck Institute for Software Systems, da University of Birmingham e da AWS. Faz parte de um esforço maior da AWS sobre falhas metaestáveis, e o próprio artigo diz que cobre só a parte formal. Não informa um veículo de publicação. Li a versão 2 no arXiv.

## Contribuição

- **Uma pequena linguagem para sistemas de requisição e resposta.** Um servidor tem uma fila e um pool de workers, e um cliente tem uma distribuição de chegadas, um timeout e uma política de retentativa. Os programas são grafos acíclicos de clientes e servidores. O significado deles é uma simulação de eventos discretos, um núcleo de cerca de 100 linhas de Python sobre asyncio, que o artigo trata como verdade de referência.
- **Uma cadeia de Markov abstrata.** O estado de um servidor é um par (u, v): requisições no sistema e requisições na órbita esperando para tentar de novo. Uma nova requisição entra na órbita com uma probabilidade que depende do tamanho da fila, o que captura a chance de ela não ser atendida antes do timeout. A construção se estende a vários threads de trabalho, vários tipos de requisição e cadeias de servidores em que um thread a montante bloqueia na chamada a jusante.
- **Calibração.** A abstração é aproximada, já que o simulador acompanha cada tentativa e a cadeia só acompanha médias. Os autores ajustam algumas constantes da cadeia (a taxa de chegada e o timeout, no exemplo) para que suas trajetórias médias combinem com muitas execuções curtas do simulador, usando o otimizador CMA-ES.
- **Uma imagem do fluxo.** No plano do tamanho da fila contra o tamanho da órbita, uma seta em cada estado aponta para a direção seguinte mais provável. Onde as setas passam de "rumo ao vazio" para "rumo ao cheio" é onde um sistema pode ficar preso. Calcular uma seta não depende do tamanho da cadeia.
- **Uma definição de metaestabilidade.** Baseada em probabilidades de escape, na linha de trabalhos anteriores sobre cadeias de Markov de tempo discreto: um conjunto de estados é metaestável se ir de um a outro leva muito mais tempo do que chegar a algum deles de fora. Um teorema liga k desses estados a k autovalores da matriz geradora perto de zero, e o segundo autovalor dá um limite inferior para o tempo de mistura.
- **Tempo de recuperação.** O tempo esperado para ir de uma fila cheia de volta à fila típica, calculado resolvendo sistemas lineares, ou estimado pelo espectro quando isso é numericamente instável.

## Metodologia

O exemplo corrente é um servidor com taxa de serviço de 10 requisições por segundo, um cliente enviando 9,5 requisições por segundo, timeout de 9 segundos, 3 retentativas e uma fila de 100. Um pico para 20 requisições por segundo entre 200 s e 400 s deixa a fila cheia por pelo menos 600 s depois que a carga volta ao normal. A cadeia limita a fila e a órbita em 100 e 20.

A calibração usa duas condições iniciais (vazia e cheia) e 100 execuções do simulador em cada uma. O artigo então faz três perguntas de pesquisa: se a cadeia calibrada é fiel ao simulador, se a análise explica como os parâmetros afetam a metaestabilidade e se ela ajuda a projetar políticas de recuperação. Um segundo exemplo tem dois servidores em série, o primeiro com 32 threads e o segundo com taxa de serviço de 2,8 requisições por segundo, com timeouts de 5 segundos e limites de retentativa de 5 e 3.

## Resultados

- **Uma fila simples nunca é metaestável.** Uma fila M/M/1 é estável ou instável. O comportamento metaestável só aparece quando se acrescentam retentativas.
- **A calibração importa.** A cadeia construída direto do programa se desvia do simulador, e depois da calibração as trajetórias se alinham de perto. Os valores ajustados são 9,43 requisições por segundo e um timeout de 10,54 segundos, contra os nominais 9,5 e 9.
- **Os parâmetros movem o sistema entre três regimes.** Reduzir a taxa de serviço ou o timeout, ou aumentar a taxa de chegada, produz metaestabilidade. No exemplo ela aparece para taxas de chegada entre 9 e 10,5, taxas de serviço entre 9,5 e 10,5 e timeouts entre 5 e 10 segundos. Uma fila mais longa, ao contrário, mantém o sistema metaestável a partir de certo ponto (acima de 90). O argumento do artigo é que metaestável difere de estável (só o estado vazio atrai) e de instável (só o estado cheio atrai): os dois são atratores.
- **As políticas de recuperação podem ser comparadas.** A recuperação de uma fila cheia é lenta a uma taxa de chegada de 9,5 (uma configuração metaestável) e rápida quando a taxa é limitada a 8 (uma configuração estável), o que uma execução simulada confirma. O tempo de recuperação cresce com taxas de serviço menores, timeouts mais curtos e taxas de chegada maiores.
- **Escala para uma cadeia de servidores.** No exemplo de dois servidores a imagem, calculada em milissegundos, mostra uma região em torno de um tamanho de órbita de 15 em que os fluxos quase se equilibram. O tempo de mistura é muito maior que a escala de tempo da cadeia e não é monotônico na taxa de serviço: taxas muito baixas e muito altas são instáveis ou estáveis, e valores intermediários são metaestáveis.
- **Custo.** A análise qualitativa leva milissegundos, e a quantitativa algumas horas nos maiores exemplos. Os autores relatam que, no uso industrial deles, modelar três servidores ou menos bastou para reproduzir muitos casos e achar efeitos em horas em vez de semanas.

## Análise crítica

É principalmente um artigo de teoria, e sua parte mais forte é a definição: ela separa o metaestável do meramente instável e dá um teste computável. A evidência para as afirmações práticas é mais estreita do que o resumo sugere.

Os pontos abaixo são uma leitura minha do artigo, não afirmações dele.

- **A verdade de referência é o simulador dos autores.** O resumo diz que a análise "captura e prevê muitas instâncias de metaestabilidade que foram observadas em campo". O que a avaliação compara é a cadeia contra um simulador escrito para o artigo, em um exemplo de livro-texto e um exemplo de dois servidores descrito como inspirado em um serviço industrial. Não encontrei comparação com medições de um sistema real, então a afirmação sobre o comportamento em campo depende de quão perto o simulador está dos serviços reais.
- **A calibração é um ajuste.** Duas constantes são ajustadas até a cadeia combinar com o simulador, e o timeout ajustado (10,54 s) fica cerca de 17% acima do real (9 s). Isso sugere que a correção absorve o erro da abstração em vez de recuperar parâmetros verdadeiros. O texto que li não diz se as constantes são ajustadas de novo para cada ponto das varreduras de parâmetros, nem até onde a cadeia calibrada continua precisa longe dos pontos de calibração. Também não dá um erro numérico, só gráficos.
- **Números que não são conciliados.** Para o mesmo exemplo corrente, a introdução coloca o ponto em que a dinâmica muda em um tamanho de fila de cerca de 100, a Seção 2 o coloca em cerca de 65, e o tempo esperado de recuperação salta perto de 75. Podem se referir a figuras ou definições diferentes, mas o texto não diz.
- **A evidência de mitigação é uma execução para cada caso.** O resultado do throttling é mostrado com uma única execução simulada, ao lado da predição da cadeia. É consistente, mas ainda é uma demonstração e não uma medição de com que frequência o throttling recupera o sistema.
- **O escopo são retentativas em sistemas síncronos de requisição e resposta.** A cadeia modela as retentativas a uma taxa média ligada ao timeout, então o backoff e o jitter, as mitigações usuais, não aparecem nela até onde li. Outros efeitos de sustentação, como caches ou trabalho de segundo plano, são citados como extensões esperadas e não são modelados. A cadeia é ergódica, então uma fila cheia sempre acaba esvaziando, e "metaestável" aqui significa uma escala de tempo longa, e quão longo conta como longo é um parâmetro da definição.
- **A reprodutibilidade ainda não é sustentada.** O texto chama a ferramenta de código aberto, mas não dá um link.
- **A comparação com o trabalho anterior é dos próprios autores.** O artigo diz que o modelo de filas do [MSF-Model](/papers/msf-model-queuing-based-prediction-of-metastable-failures) define metaestabilidade como uma grande distância média ao estado vazio, o que não a separa da instabilidade, e que um modelo sem calibração se desvia da simulação. É uma leitura justa da definição daquele artigo, e a afirmação sobre o desvio eu não testei aqui.

## Pesquisas futuras

- Comparar o modelo com medições de um serviço real, ou com o protótipo do [MSF-Model](/papers/msf-model-queuing-based-prediction-of-metastable-failures), no mesmo pico de carga.
- Relatar o erro de calibração, ajustá-la de novo ao longo das varreduras e testar até onde ela continua preditiva longe dos dados de calibração.
- Modelar backoff, jitter e orçamentos de retentativa e compará-los como políticas de recuperação, do modo como o throttling é comparado.
- Estender a abstração a caches e trabalho de segundo plano, os outros efeitos de sustentação encontrados em [Falhas metaestáveis no mundo real](/papers/metastable-failures-in-the-wild).
