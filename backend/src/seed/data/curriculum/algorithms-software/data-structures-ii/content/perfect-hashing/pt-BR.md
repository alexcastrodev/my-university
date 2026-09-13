---
version: 1.0
updatedAt: 2026-09-13
title: Hashing Perfeito
summary: A construção de dois níveis FKS usa um hash universal de primeiro nível para separar chaves em n buckets, e para cada bucket busca uma função de segundo nível dimensionada quadraticamente até achar uma sem colisões internas, dando O(1) de pior caso com espaço total esperado O(n), mas só para um conjunto de chaves estático e conhecido de antemão.
---
## Objetivos de Aprendizagem

- Enunciar precisamente o que significa "hashing perfeito": zero colisões, busca O(1) de pior caso, para um conjunto de chaves fixo e conhecido.
- Explicar por que hashing perfeito só é possível para um conjunto de chaves *estático* conhecido de antemão, não para uma tabela que aceita inserções futuras arbitrárias.
- Descrever a construção de dois níveis (FKS): um hash universal de primeiro nível em `n` buckets, seguido por um hash universal de segundo nível dimensionado quadraticamente ao seu bucket, garantindo nenhuma colisão dentro de cada bucket.
- Calcular o espaço total esperado usado pelas tabelas de segundo nível, e explicar por que ele é O(n) apesar de a tabela de cada bucket ser quadrática em seu próprio tamanho.
- Identificar casos de uso realistas para hashing perfeito: busca de palavras-chave de compilador, tabelas de configuração somente leitura, e dicionários fixos semelhantes.

## Contexto e Motivação

Hashing universal, o conceito anterior, fez uma promessa específica: desempenho esperado O(1), mesmo contra um adversário, limitando o número esperado de colisões por chave. Ele não prometeu zero colisões, apenas um número esperado limitado delas, e para uma tabela hash genuinamente dinâmica (chaves inseridas e removidas de forma imprevisível ao longo da vida da tabela) isso é geralmente o melhor que se pode fazer. Mas uma grande quantidade de dicionários reais não é dinâmica nesse sentido: o conjunto de palavras-chave do compilador de uma linguagem de programação (`if`, `while`, `class`, e assim por diante) é fixo no momento em que a gramática da linguagem é finalizada; uma tabela de roteamento construída uma vez a partir de um arquivo de configuração estático, ou um índice em memória construído uma vez sobre um conjunto de dados fixo, nunca recebe uma inserção depois de construído. Exatamente para essa situação, uma garantia mais forte que "O(1) esperado" é alcançável: **hashing perfeito**, no qual toda busca é O(1) no *pior* caso, com zero colisões, garantido, não apenas provável.

## Teoria Central

### Por que perfeição exige um conjunto de chaves estático

A razão pela qual hashing perfeito não pode se aplicar a uma tabela totalmente dinâmica é estrutural, não uma limitação de engenhosidade: qualquer função hash que garanta zero colisões para um conjunto específico de `n` chaves é, por construção, feita sob medida para *aquele* conjunto. Insira uma chave adicional que não estava no conjunto original, e não há garantia alguma de que a mesma função continue mapeando tudo para slots distintos; a nova chave pode cair exatamente em cima de uma já existente. Construir uma função hash com zero colisões para um conjunto *conhecido* é um problema de busca (encontrar uma função, de alguma família, sob a qual esse conjunto específico não colide), e essa busca só é bem colocada se o conjunto estiver fixo enquanto a busca é realizada. É por isso que hashing perfeito é especificamente uma técnica para *dicionários estáticos*: um conjunto de chaves completamente conhecido antes de a tabela ser construída, sem inserções futuras esperadas.

### A construção de dois níveis (Fredman, Komlós e Szemerédi, 1984)

A construção FKS constrói uma tabela hash perfeita para um conjunto estático de `n` chaves em dois níveis, cada um uma tabela hash universal do conceito anterior, usada de uma forma específica e engenhosa:

**Primeiro nível.** Escolha uma função hash universal `h` (da família multiplicação-módulo-primo, por exemplo) mapeando as `n` chaves em `n` buckets. Como o conceito do paradoxo do aniversário já estabeleceu, esse nível sozinho tipicamente terá colisões, alguns buckets receberão mais de uma chave. A ideia central não é evitar essas colisões, mas isolá-las: as chaves colidentes de cada bucket se tornam seu próprio subproblema pequeno e separado.

**Segundo nível.** Para cada bucket `i` que recebeu `n_i` chaves (`n_i` pode ser 0, 1, ou mais), construa uma *segunda* tabela hash universal, independente, dimensionada com `m_i = n_i²` slots (quadrática na própria contagem de chaves do bucket, não em `n`), e busque entre escolhas aleatórias da função hash daquele bucket até encontrar uma sob a qual todas as `n_i` chaves caiam em slots distintos. Essa busca é garantida a terminar rapidamente: como a subtabela tem `n_i²` slots, a probabilidade de colisão ao estilo paradoxo-do-aniversário para `n_i` chaves caindo em `n_i²` slots é no máximo 1/2 para uma função hash universal sorteada ao acaso (uma consequência direta da propriedade universal aplicada a esse tamanho quadrático específico), então em média são necessárias apenas cerca de duas tentativas aleatórias para encontrar uma função sem colisões para aquele bucket, e testar "essa escolha específica de fato dá zero colisões" é uma verificação barata e única feita durante a construção da tabela.

Buscar uma chave no momento da consulta agora é um processo fixo de dois passos: aplique o hash de primeiro nível `h` para encontrar o bucket, aplique o hash de segundo nível daquele bucket para encontrar o slot exato dentro dele, pronto, com uma garantia (não apenas uma expectativa) de zero colisões no segundo nível por construção, então isso é O(1) de pior caso, não apenas O(1) esperado.

### Por que o espaço total permanece O(n), apesar das subtabelas quadráticas

Fazer a tabela de segundo nível de cada bucket ser quadrática em seu próprio tamanho parece caro: somar `n_i²` sobre todos os buckets poderia, em princípio, ser muito maior que `n`. A razão pela qual não é, em expectativa, é uma consequência direta do mesmo hash universal de primeiro nível, aplicado um nível acima: o número esperado de *colisões* no primeiro nível (pares de chaves caindo no mesmo bucket) é limitado pela propriedade universal a no máximo `C(n, 2)/n < n/2`, e uma identidade padrão relaciona `soma de n_i²` diretamente ao número de pares colidentes no primeiro nível (`soma n_i² = n + 2 · (número de pares colidentes no primeiro nível)`). Combinar isso dá um espaço total esperado de segundo nível de `O(n)`, não o pior caso ingênuo que somar tamanhos quadráticos de bucket poderia sugerir. Essa é a razão pela qual o primeiro nível especificamente usa `n` buckets (não menos): usar poucos buckets demais no primeiro nível empurraria chaves demais para buckets grandes, tornando o limite de `soma n_i²` frouxo demais para permanecer linear.

## Exemplos Resolvidos

### Exemplo 1: dimensionando a tabela de segundo nível de um bucket e estimando o número de tentativas

**Problema:** Um hash de primeiro nível envia 3 chaves para o mesmo bucket. Determine o tamanho da tabela de segundo nível, e estime quantas escolhas aleatórias de função são esperadas antes de encontrar uma sem colisões internas.

**Dimensionamento:** Com `n_i = 3` chaves nesse bucket, a tabela de segundo nível tem `m_i = n_i² = 9` slots.

**Estimativa de tentativas:** A propriedade universal limita a probabilidade de qualquer par específico das 3 chaves colidir em `1/9` para uma função sorteada ao acaso; somando sobre os `C(3, 2) = 3` pares dá um número esperado de pares colidentes de no máximo `3 · (1/9) = 1/3`, então a probabilidade de *nenhum* par colidir (um "sucesso" para essa tentativa aleatória) é de pelo menos `1 - 1/3 = 2/3`. Em média, cerca de `1 / (2/3) = 1,5` sorteios aleatórios de função são necessários antes de um ter sucesso com zero colisões nesse bucket, confirmando a intuição de "cerca de duas tentativas" da Teoria Central mesmo para um bucket pequeno e concreto.

### Exemplo 2: a tabela de palavras-chave de um compilador como caso de uso realista de hashing perfeito

**Problema:** Explique por que a busca de palavras-chave reservadas de um compilador (verificar se um identificador como `while` ou `minhaVariavel` é uma palavra-chave da linguagem) é um encaixe natural para hashing perfeito, e por que seria um mau encaixe para, digamos, o cache de sessões de usuário de uma aplicação de propósito geral.

**Por que palavras-chave se encaixam:** O conjunto completo de palavras-chave de uma linguagem (talvez de 30 a 60 palavras) é fixo no momento em que a especificação da linguagem é congelada, completamente conhecido de antemão, nunca cresce em tempo de execução, e é consultado um número enorme de vezes durante a compilação, tornando o custo único de construir uma tabela hash perfeita (feito uma vez, offline, quando o próprio compilador é construído) uma troca excelente por busca O(1) de pior caso garantida em todo identificador que o compilador verifica.

**Por que um cache de sessão não se encaixa:** O conjunto de chaves de um cache de sessão de usuário (IDs de sessão) é criado e destruído continuamente em tempo de execução, não é conhecido de antemão, e a construção inteira do hashing perfeito assume um conjunto de chaves *fixo* e *conhecido* sobre o qual buscar; usá-lo aqui exigiria reconstruir toda a estrutura de dois níveis do zero a cada nova sessão, anulando completamente o propósito de uma tabela rápida e atualizável de forma incremental. Essa é precisamente a fronteira que a Teoria Central traça: hashing perfeito para dicionários estáticos, hashing universal ou comum (suportando inserção incremental) para os dinâmicos.

## Equívocos Comuns e Armadilhas

- **"Hashing perfeito é só uma função hash melhor que por acaso não tem colisões."** Não é uma única fórmula de forma alguma, é uma *construção de tabela* de dois níveis, construída especificamente em torno de um conjunto de chaves fixo, envolvendo uma busca (tentando escolhas aleatórias de função por bucket) realizada uma vez durante a construção; não existe uma única fórmula que seja "perfeita" independente do conjunto de chaves específico para o qual foi construída.
- **"Já que hashing perfeito dá O(1) de pior caso, ele deveria substituir tabelas hash comuns em todo lugar."** Ele só se aplica quando o conjunto completo de chaves é conhecido de antemão e não muda; uma tabela hash que recebe inserções futuras arbitrárias (essencialmente todo dicionário dinâmico de propósito geral) não pode usar essa técnica de forma alguma sem uma reconstrução completa e cara a cada inserção, que é exatamente por que hashing universal (conceito anterior), não hashing perfeito, é a resposta para cargas de trabalho dinâmicas.
- **"As tabelas de segundo nível de tamanho quadrático fazem o hashing perfeito usar espaço quadrático."** O cálculo do Exemplo 1 e a identidade relacionando `soma n_i²` ao número de pares colidentes no primeiro nível mostram que o espaço *total esperado* através de todos os buckets é O(n), não O(n²); o dimensionamento quadrático é local a cada bucket individual, dimensionado para a contagem de chaves (tipicamente pequena) desse próprio bucket, não para `n` como um todo.
- **"Construir uma tabela hash perfeita é cara o suficiente para raramente valer a pena."** O custo de construção único (tempo esperado O(n), usando o argumento de tentativas do Exemplo 1 em cada bucket) é pago exatamente uma vez, offline, para uma tabela que depois é consultada um número enorme de vezes com um pior caso O(1) garantido; para um dicionário genuinamente estático e frequentemente consultado como o conjunto de palavras-chave de um compilador, essa é uma troca claramente favorável, não uma incomum.

## Resumo

Hashing perfeito alcança busca O(1) de pior caso com zero colisões, mas apenas para um conjunto de chaves estático e completamente conhecido de antemão, já que a construção é uma busca única feita sob medida para esse conjunto exato, não uma fórmula de propósito geral. A construção de dois níveis FKS usa um hash universal de primeiro nível para separar chaves em `n` buckets (aceitando que esse nível sozinho terá colisões), depois, para cada bucket com `n_i` chaves, busca entre funções hash universais aleatórias dimensionadas para uma subtabela de `n_i²` slots quadráticos até encontrar uma sem colisões internas, uma busca que tem sucesso depois de apenas um pequeno número constante de tentativas esperadas graças à propriedade universal aplicada nesse tamanho quadrático. Uma identidade padrão mostra que o espaço total esperado através de todas essas subtabelas quadráticas é, ainda assim, O(n), não O(n²), tornando a estrutura inteira prática. Isso encerra o arco de hashing desta disciplina: hashing comum arrisca colisões sem limite, hashing universal as limita em expectativa mesmo contra um adversário, e hashing perfeito as elimina completamente, ao custo de exigir o conjunto completo de chaves de antemão, exatamente a troca que a tabela fixa de palavras-chave de um compilador ou um dicionário estático semelhante faz de bom grado.

## Documentation Links

- [Fredman, M. L., Komlós, J., & Szemerédi, E. (1984). "Storing a Sparse Table with O(1) Worst Case Access Time." Journal of the ACM.](https://dl.acm.org/doi/10.1145/828.1884): paper
- [Stanford CS166 - Data Structures](https://web.stanford.edu/class/cs166): doc
