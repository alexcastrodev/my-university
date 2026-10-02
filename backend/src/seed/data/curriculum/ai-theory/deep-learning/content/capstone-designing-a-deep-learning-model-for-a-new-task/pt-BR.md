---
version: 1.0
updatedAt: 2026-09-07
title: "Capstone: Projetando um Modelo de Deep Learning para uma Nova Tarefa"
summary: Um roteiro de capstone que compara cada família de arquitetura vista nesta disciplina (redes multicamadas simples, CNNs, RNN/LSTM/GRU e Transformers) pela estrutura de dados que cada uma pressupõe (grade, sequência, conjunto) e pelas preocupações de treino (inicialização, regularização, otimizador, computação) que se aplicam a todas elas, estendendo o guia de decisão análogo que fechou `machine-learning` dos modelos clássicos para as arquiteturas profundas que esta disciplina acrescentou.
---
## Objetivos de Aprendizagem

- Comparar cada grande família de arquitetura vista nesta disciplina pela estrutura de dados que ela pressupõe: dados em grade, sequenciais ou do tipo conjunto.
- Aplicar o checklist de preocupações de treino (inicialização, regularização, otimizador, normalização, computação) desenvolvido ao longo desta disciplina a uma nova escolha de arquitetura, sem derivar nada disso de novo.
- Rastrear uma tarefa de exemplo concreta por todo o processo de decisão: escolha da arquitetura, configuração de treino e extensão generativa, se for relevante.
- Explicar como o guia de decisão desta disciplina estende o próprio capstone de `ai-theory/machine-learning` dos modelos clássicos para as arquiteturas profundas.

## Contexto e Motivação

`choosing-and-validating-a-model-a-decision-guide`, o capstone de `ai-theory/machine-learning`, fechou aquela disciplina comparando cada família de modelos clássicos que ela cobriu (regressão, classificadores generativos e discriminativos, árvores e ensembles, SVMs, clustering) em interpretabilidade, tamanho dos dados e não linearidade, e apontou as redes neurais como a fronteira que aquela disciplina deliberadamente não cruzou. Este capstone é a continuação direta: ele reúne as famílias desta disciplina (redes multicamadas simples, CNNs, RNN/LSTM/GRU e Transformers) em um guia de decisão igualmente concreto e percorre um exemplo completo pelas escolhas que esse guia de fato implica.

## Teoria Central

### Escolha da arquitetura pela estrutura dos dados

A primeira pergunta mais útil ao escolher entre as arquiteturas desta disciplina é: que estrutura os próprios dados têm?

- **Dados em grade** (imagens e outros dados com forte correlação espacial local): a convolução e o pooling de uma CNN, construídos especificamente em torno de filtros locais com pesos compartilhados e de invariância à translação, são o encaixe natural.
- **Dados sequenciais** (texto, áudio, séries temporais, em que a ordem e o comprimento variável importam): aplica-se uma RNN/LSTM/GRU ou um Transformer; entre os dois, o comprimento da sequência e a computação disponível pesam diretamente: o processamento sequencial (não paralelizável) de uma RNN serve para sequências mais curtas ou cenários com computação limitada, enquanto a self-attention paralelizável de um Transformer escala melhor com mais dados e computação e trata dependências de longo alcance de forma mais direta do que até uma RNN com portas normalmente consegue.
- **Vetores de features de tamanho fixo e sem estrutura** (dados tabulares sem estrutura espacial ou sequencial inerente): uma rede multicamadas simples (o primeiro conceito desta disciplina) costuma ser o encaixe mais simples, já que nem o compartilhamento espacial de pesos da convolução nem a estrutura temporal de uma recorrência têm o que explorar.

### Preocupações de treino que valem para qualquer arquitetura

Toda escolha de arquitetura acima ainda enfrenta o mesmo checklist de preocupações de treino desenvolvido no segundo bloco desta disciplina, independentemente da arquitetura escolhida: os pesos precisam de uma inicialização calibrada (Xavier/He) para evitar o problema do gradiente que desaparece/explode no início do treino; quase sempre se usa na prática um otimizador além do gradiente descendente simples (momentum ou Adam); é preciso regularização (dropout, weight decay) sempre que a capacidade da arquitetura escolhida arrisca fazer overfitting dos dados disponíveis, exatamente como `the-bias-variance-tradeoff` prevê para qualquer modelo suficientemente flexível; e a normalização (batch ou layer normalization) estabiliza o treino conforme a profundidade aumenta. Nenhuma dessas preocupações é específica de CNNs, RNNs ou Transformers individualmente; são propriedades de treinar *qualquer* rede suficientemente profunda por otimização baseada em gradiente, e é por isso que esta disciplina as cobriu uma única vez, em um bloco dedicado, antes de apresentar qualquer arquitetura específica.

### Quando recorrer a uma extensão generativa

Se a tarefa não é prever um rótulo ou um valor, mas produzir dados novos e realistas parecidos com um conjunto de treino, a pergunta sobre a arquitetura ganha uma segunda dimensão: um autoencoder simples basta quando o objetivo é compressão ou um baseline generativo de qualidade moderada baseado em reconstrução, enquanto GANs ou modelos de difusão (vistos em nível panorâmico) são o estado da arte atual para geração de alta fidelidade, ao custo da complexidade de treino e da computação adicionais que cada um, respectivamente, exige.

## Exemplos Resolvidos

### Exemplo 1: escolhendo uma arquitetura para uma tarefa genuinamente nova

Considere uma tarefa: dada a sequência de registros de consultas hospitalares de um paciente (cada consulta descrita por um conjunto de códigos de diagnóstico, em ordem cronológica, com um número variável de consultas por paciente), prever o código de diagnóstico com mais chance de aparecer na próxima consulta. A estrutura dos dados é sequencial e de comprimento variável, o que descarta diretamente uma rede multicamadas simples (ela exige uma entrada de tamanho fixo) e uma CNN (não há localidade espacial/de grade significativa entre códigos de diagnóstico para explorar). Entre uma RNN/LSTM/GRU e um Transformer: com sequências normalmente curtas (dezenas de consultas por paciente, não milhares) e uma necessidade prática real de processar os registros de novos pacientes uma consulta de cada vez, conforme chegam, a capacidade de uma LSTM de processar uma sequência de forma incremental, um passo de tempo por vez, sem precisar da sequência inteira na memória de uma vez, é um motivo genuíno e específico da tarefa para considerá-la no lugar de um Transformer; embora um Transformer provavelmente alcançasse acurácia comparável ou melhor com dados de treino suficientes, o requisito de processamento incremental é um fator decisivo concreto que a pergunta sobre a estrutura dos dados, sozinha, não resolve, e precisa ser pesado contra o trade-off entre acurácia e paralelismo estabelecido no bloco de atenção.

### Exemplo 2: montando o checklist completo para a arquitetura escolhida

Continuando o Exemplo 1 com uma LSTM escolhida: o modelo precisa de uma inicialização de pesos adequada às suas funções de ativação (`weight-initialization-and-the-vanishing-exploding-gradient-problem`), do Adam como otimizador padrão prático, dados os gradientes ruidosos por batch vindos de sequências de pacientes de comprimento variável (`optimizers-beyond-gradient-descent-momentum-and-adam`), de dropout aplicado entre as camadas da LSTM para evitar overfitting no dataset de registros de pacientes disponível, normalmente muito menor que corpora de imagens ou de texto (`regularization-in-deep-networks-dropout-and-weight-decay`), e de loss de cross-entropy sobre a distribuição de saída normalizada por softmax entre os códigos de diagnóstico possíveis (`softmax-and-cross-entropy-loss`); cada peça desse checklist foi vista como um conceito próprio antes nesta disciplina, e nenhuma precisou ser derivada de novo para ser aplicada a esta tarefa nova e inédita.

## Equívocos Comuns e Armadilhas

- **"A arquitetura mais moderna (um Transformer) é sempre a escolha certa."** O Exemplo 1 mostra um caso concreto e legítimo em que o processamento incremental de uma LSTM é uma vantagem real e específica da tarefa que a melhor acurácia bruta de um Transformer não supera automaticamente; a escolha de arquitetura é um trade-off genuíno de engenharia, e não uma hierarquia estrita do "velho" ao "novo".
- **"Preocupações de treino como dropout ou Adam precisam ser derivadas ou justificadas de novo para cada nova arquitetura."** O Exemplo 2 demonstra o contrário: o checklist de treino desenvolvido uma vez, de forma genérica, no segundo bloco desta disciplina se aplica diretamente a uma tarefa e uma arquitetura totalmente novas, sem nenhuma derivação nova; é justamente esse o ganho de ter coberto essas preocupações separadamente de qualquer arquitetura específica.
- **"Uma extensão generativa só é relevante se a tarefa original fosse explicitamente de geração."** Autoencoders, GANs e modelos de difusão também podem servir a tarefas que não parecem generativas à primeira vista; por exemplo, a representação de gargalo de um autoencoder pode ser reaproveitada como um extrator de features aprendido (uma aplicação de `representation-learning-the-network-learns-its-own-features`) para uma tarefa supervisionada comum, que tem dados rotulados de menos para treinar uma rede grande do zero.

## Resumo

As arquiteturas desta disciplina se dividem de forma limpa pela estrutura de dados que pressupõem (em grade para CNNs, sequencial para RNN/LSTM/GRU e Transformers, vetores de tamanho fixo e sem estrutura para redes multicamadas simples), enquanto o checklist de treino (inicialização, otimizador, regularização, normalização) desenvolvido uma vez no bloco de treino desta disciplina se aplica de forma uniforme, qualquer que seja a arquitetura escolhida, exatamente como o exemplo resolvido deste capstone demonstra de ponta a ponta. Isso estende diretamente o próprio guia de decisão do capstone de `ai-theory/machine-learning`: onde aquela disciplina parou na fronteira das redes neurais, o capstone desta disciplina continua com um processo de decisão funcional entre as arquiteturas profundas (CNNs, RNNs, Transformers e suas extensões generativas) a que aquela fronteira levava.

## Documentation Links

- [CS231n: Course Schedule (Stanford, Spring 2026)](https://cs231n.stanford.edu/schedule.html): a progressão completa, aula por aula (backpropagation → CNNs → RNNs → atenção/Transformers → modelos generativos), que a comparação de arquiteturas deste capstone resume de ponta a ponta.
- [Dive into Deep Learning: Home](https://d2l.ai/): a segunda fonte âncora desta disciplina, cuja própria estrutura de capítulos (de perceptrons multicamadas a atenção/Transformers) confirma de forma independente a mesma progressão de arquiteturas que este capstone revisa.
