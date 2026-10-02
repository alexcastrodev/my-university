---
version: 1.0
updatedAt: 2026-09-06
title: Tempo Médio de Acesso à Memória e Caches Multinível
summary: AMAT = Tempo de Acerto + Taxa de Falha × Penalidade de Falha, aplicado recursivamente numa hierarquia real L1/L2/L3/DRAM com números de latência representativos. É a única fórmula em direção à qual todo este bloco vem construindo, e a que o CS2013 nomeia diretamente como uma habilidade de cálculo obrigatória.
---
## Objetivos de Aprendizagem

- Enunciar a fórmula do AMAT e explicar o que cada termo (tempo de acerto, taxa de falha e penalidade de falha) representa.
- Calcular o AMAT de uma cache de um nível dados números realistas de tempo de acerto, taxa de falha e penalidade de falha.
- Estender a fórmula do AMAT recursivamente por uma hierarquia real L1/L2/L3/DRAM, em que a penalidade de falha de um nível é ela própria o AMAT de outro nível.
- Explicar por que a taxa de falha local e a taxa de falha global são quantidades diferentes e por que cálculos de AMAT multinível precisam tomar cuidado com qual delas usam.
- Explicar por que sistemas reais usam vários níveis de cache em vez de uma única cache grande e rápida, retomando as trocas de custo entre associatividade e tamanho vistas antes neste bloco.

## Contexto e Motivação

Todo conceito deste bloco até aqui (localidade, mapeamento, associatividade, substituição, política de escrita) vem construindo em direção a uma única pergunta: em média, quanto tempo um acesso à memória de fato leva, depois de levar em conta toda essa maquinaria? O Tempo Médio de Acesso à Memória (AMAT, Average Memory Access Time) é a fórmula que responde isso com precisão, e a área de conhecimento Architecture and Organization do ACM/IEEE CS2013 nomeia calculá-lo, "sob uma variedade de configurações de cache e memória", diretamente como resultado de aprendizagem obrigatório: uma confirmação, no nível curricular, de que esta fórmula, e não só um entendimento qualitativo de caches, é conteúdo central.

Este conceito também é onde a hierarquia de memória real da disciplina (não só uma cache, mas a pirâmide completa L1/L2/L3/DRAM de `the-memory-hierarchy-and-locality`) recebe pela primeira vez seu tratamento preciso e quantitativo: o AMAT se aplica de forma recursiva, com a "penalidade de falha" de cada nível sendo simplesmente o AMAT do nível abaixo dele, permitindo que exatamente a mesma fórmula descreva uma cache ou uma hierarquia multinível inteira.

## Teoria Central

### A fórmula do AMAT

```text
AMAT = Tempo de Acerto + Taxa de Falha × Penalidade de Falha
```

- **Tempo de Acerto**: quanto tempo leva para determinar um acerto e devolver o dado pedido, quando o acesso de fato acerta. Inclui a comparação de tags e, numa cache de associatividade maior, o tempo extra para verificar várias vias (de `set-associative-and-fully-associative-caches`).
- **Taxa de Falha**: a fração dos acessos que falham neste nível.
- **Penalidade de Falha**: o tempo *adicional* necessário, além do tempo de acerto já pago, para atender a uma falha, normalmente dominado pelo tempo de buscar o bloco no nível de baixo.

A intuição da fórmula: todo acesso paga o tempo de acerto, qualquer que seja o resultado (a cache sempre precisa ser verificada primeiro); por cima dessa linha de base, uma fração dos acessos (a taxa de falha) paga uma penalidade *adicional* por ter de descer mais na hierarquia.

### Estendendo o AMAT recursivamente pelos níveis

O movimento genuinamente poderoso é reconhecer que a penalidade de falha de um nível de cache não é uma constante dada de forma independente: ela é, ela própria, o tempo médio para acessar o *próximo* nível da hierarquia, que tem seu próprio tempo de acerto, sua própria taxa de falha e sua própria penalidade de falha em relação ao nível abaixo *dele*:

```text
AMAT(L1) = TempoAcerto(L1) + TaxaFalha(L1) × PenalidadeFalha(L1)
em que PenalidadeFalha(L1) = AMAT(L2)
então:   AMAT(L1) = TempoAcerto(L1) + TaxaFalha(L1) × AMAT(L2)

AMAT(L2) = TempoAcerto(L2) + TaxaFalha(L2) × AMAT(L3)
AMAT(L3) = TempoAcerto(L3) + TaxaFalha(L3) × (tempo de acesso à DRAM)
```

Essa estrutura recursiva é exatamente o motivo pelo qual a mesma fórmula simples, apresentada para uma única cache, escala de forma limpa para descrever uma hierarquia multinível inteira: cada nível é analisado com exatamente a mesma equação, só que com "penalidade de falha" entendida como "quanto tempo o próximo nível abaixo de fato leva, em média".

### Taxa de falha local vs. taxa de falha global

Uma sutileza que a fórmula recursiva acima depende de acertar: a **taxa de falha local** é a fração dos acessos *que chegam a um dado nível* que falham nele (por exemplo, a taxa de falha local da L2 é calculada só sobre os acessos que já falharam na L1 e foram encaminhados à L2). A **taxa de falha global** é a fração de *todos* os acessos originais (começando na L1) que acabam falhando num dado nível. A taxa de falha global da L2 é sempre menor que sua taxa de falha local, justamente porque a L1 já filtrou a maior parte dos acertos fáceis antes de qualquer coisa chegar à L2. A fórmula recursiva do AMAT acima usa taxas de falha **locais** em cada nível (a própria taxa de falha de cada nível, em relação aos acessos que ele de fato recebe), e é exatamente isso que torna a estrutura recursiva correta.

## Exemplos Resolvidos

### Exemplo 1: AMAT de um nível com números realistas

Uma cache L1 tem tempo de acerto de 1 ciclo, taxa de falha de 5% e penalidade de falha de 20 ciclos (o tempo para buscar na memória principal, num sistema sem L2):

```text
AMAT = 1 + 0.05 × 20 = 1 + 1.0 = 2.0 ciclos
```

Mesmo com uma taxa de acerto razoavelmente boa, de 95%, o acesso *médio* ainda custa o dobro do tempo de acerto puro, só porque os 5% de falhas são muito mais caros que um acerto: uma ilustração direta de por que até uma taxa de acerto "boa" deixa espaço real para mais otimização por meio de um segundo nível de cache.

### Exemplo 2: uma hierarquia completa de três níveis, calculada recursivamente

```text
L1: Tempo de Acerto = 1 ciclo,   Taxa de Falha Local = 5%
L2: Tempo de Acerto = 10 ciclos, Taxa de Falha Local = 20% (dos acessos que chegam à L2)
L3: Tempo de Acerto = 30 ciclos, Taxa de Falha Local = 40% (dos acessos que chegam à L3)
Tempo de acesso à DRAM = 200 ciclos
```

Trabalhando de baixo para cima:

```text
AMAT(L3)  = 30 + 0.40 × 200        = 30 + 80   = 110 ciclos
AMAT(L2)  = 10 + 0.20 × AMAT(L3)   = 10 + 0.20 × 110 = 10 + 22 = 32 ciclos
AMAT(L1)  = 1  + 0.05 × AMAT(L2)   = 1  + 0.05 × 32  = 1 + 1.6 = 2.6 ciclos
```

O AMAT geral percebido pelo processador (2.6 ciclos) é dominado pelo tempo de acerto da L1 (1 ciclo) mais uma contribuição relativamente pequena das falhas mais profundas e raras, justamente porque cada nível sucessivo pega a maior parte do que o nível acima dele deixou passar, e só uma fração cada vez menor dos acessos chega à DRAM lenta, de 200 ciclos.

### Exemplo 3: convertendo uma taxa de falha global na forma local recursiva

Suponha que um relatório dê a taxa de falha **global** da L2 (em relação a todos os acessos originais) como 1%, e a taxa de falha da L1 como 5%. Calcule a taxa de falha **local** da L2 (necessária para a fórmula recursiva):

```text
Taxa de falha global da L2 = (fração que chega à L2) × (taxa de falha local da L2)
Fração que chega à L2      = taxa de falha da L1 = 0.05
0.01 = 0.05 × (taxa de falha local da L2)
Taxa de falha local da L2  = 0.01 / 0.05 = 0.20 (20%)
```

Isso confirma a relação usada implicitamente no Exemplo 2: a taxa de falha local da L2 (20%) é significativamente maior do que sua taxa de falha global (1%) sugeriria isoladamente, porque o número global é diluído pelos 95% de acessos que nem chegam à L2. É exatamente a distinção que a seção de Teoria Central deste conceito avisa que precisa ser acompanhada com cuidado.

## Equívocos Comuns e Armadilhas

- **"Uma taxa de falha global da L2 menor que a própria taxa de falha da L1 significa que a L2 é uma cache pior."** O Exemplo 3 mostra que a conclusão oposta é a provável: a baixa taxa de falha global da L2 reflete principalmente quão poucos acessos chegam até ela (a L1 já filtrou a maioria), e não necessariamente que a própria L2 seja ineficaz em pegar o que recebe; sua taxa de falha local é a medida justa da eficácia da própria L2.
- **"A penalidade de falha é uma constante fixa do hardware, sem relação com o resto da hierarquia."** O Exemplo 2 mostra o oposto: a penalidade de falha de um nível é precisamente o AMAT do nível abaixo dele, que depende do próprio tempo de acerto, da própria taxa de falha e da própria penalidade de falha desse nível, recursivamente. Nada nela é um número independente e isolado num projeto multinível.
- **"Como a L1 já atinge uma taxa de falha baixa, níveis adicionais de cache acrescentam pouco valor."** O Exemplo 1 mostra que até uma boa taxa de acerto de um nível (95%) deixa uma penalidade média significativa (AMAT de 2.0, o dobro do tempo de acerto puro); o Exemplo 2 mostra que acrescentar os níveis L2 e L3 reduz substancialmente esse AMAT geral (para 2.6 ciclos, apesar de a própria DRAM custar 200 ciclos) ao pegar a maior parte do que a L1 deixa passar antes que chegue ao nível realmente lento.
- **"AMAT é a mesma coisa que tempo de CPU."** O AMAT mede especificamente o custo do acesso à memória; ele alimenta o fator CPI da Lei de Ferro (as paradas por memória aumentam o CPI efetivo, como o bloco de pipelining desta disciplina já estabeleceu para os hazards de load-use), mas não é ele próprio o tempo de CPU: é um contribuinte específico e quantificável dele.

## Resumo

AMAT = Tempo de Acerto + Taxa de Falha × Penalidade de Falha é a fórmula em direção à qual todo este bloco vem construindo, e ela se estende recursivamente por uma hierarquia multinível completa tratando a penalidade de falha de cada nível simplesmente como o AMAT do nível abaixo dele, usando em cada passo a taxa de falha *local* de cada nível (em relação aos acessos que de fato chegam a ele, e não a fração global de todos os acessos originais). Uma hierarquia realista de três níveis (Exemplo 2) mostra como cada nível sucessivo de cache pega a maior parte do que o nível acima deixou passar, mantendo o AMAT geral perto do tempo de acerto do nível mais rápido, mesmo com o nível mais lento (DRAM) continuando ordens de grandeza mais lento por si só. O próximo conceito, Código Amigável à Cache e Localidade na Prática, tira essa fórmula do abstrato e a mostra agindo sobre código real e mensurável: o mesmo algoritmo, a mesma complexidade, rodando em velocidades genuinamente diferentes só por causa da ordem de acesso à memória.

## Documentation Links

- [ACM/IEEE CS2013: Architecture and Organization Knowledge Area](https://csed.acm.org/knowledge-areas-architecture-and-organization-ar-cs2013-version/): nomeia o cálculo do Tempo Médio de Acesso à Memória sob configurações variadas de cache como resultado de aprendizagem obrigatório.
- [Bryant & O'Hallaron: Computer Systems: A Programmer's Perspective (CS:APP)](https://csapp.cs.cmu.edu/): o Capítulo 6 desenvolve o AMAT e a análise de caches multinível com a mesma estrutura recursiva.
