---
title: "Gerenciamento de memória em camadas: a latência de acesso é a chave!"
summary: O Colloid é um mecanismo de posicionamento de páginas para memória em camadas que iguala a latência de acesso carregada, medida, dos tiers em vez de empacotar as páginas mais quentes no default tier, lendo contadores de fila do hardware e aplicando a Lei de Little, e se encaixa no HeMem, no TPP e no MEMTIS.
researchArea: Sistemas operacionais
keywords: memória em camadas, posicionamento de páginas, contenção na interconexão de memória, cxl, latência de acesso, lei de little, numa
version: 1.0
updatedAt: 2026-11-07
---

## Visão geral

Os servidores estão ganhando tiers de memória: a memória comum ligada por DDR ao lado da memória de outro socket, da memória ligada por CXL ou da High Bandwidth Memory, todas coerentes em cache e acessadas por instruções comuns de load e store. Decidir quais páginas vivem em qual tier é o trabalho de um sistema de tiering. Os sistemas que este artigo estuda, HeMem, TPP e MEMTIS, inovam em rastreamento de acessos, migração de páginas e tamanho de página, mas compartilham uma única regra de posicionamento: empacotar o máximo possível das páginas mais quentes no default tier, ou seja, o tier de menor latência sem carga. A regra pressupõe que o default tier continua mais rápido que os tiers alternativos mesmo enquanto atende as páginas mais quentes.

Este artigo do SOSP 2024 (Austin), da Cornell University, argumenta que essa suposição cai assim que muitas requisições de memória estão em andamento, um regime que os autores chamam de contenção na interconexão de memória, e que a inflação de latência começa bem antes de a banda saturar. A resposta é o Colloid, um mecanismo que posiciona as páginas de modo que as latências médias carregadas dos tiers fiquem iguais.

Quatro termos merecem atenção. Latência sem carga (unloaded) é a que uma requisição isolada enxerga, e latência carregada (loaded) é a que uma requisição enxerga com muitas em andamento. O default tier é o de menor latência sem carga, e os tiers alternativos são os demais. O CHA (Caching and Home Agent) é a unidade do processador, dividida em fatias, que cuida da coerência de cache e enfileira as requisições que erram o L3, e é onde o Colloid faz suas medições. O posicionamento best-case é o ótimo encontrado manualmente pelos autores para uma carga de trabalho.

Vale conhecer antes: nós NUMA e tabelas de páginas, o fato de que um core só consegue manter um número limitado de cache misses em andamento, e a Lei de Little (a ocupação média da fila é igual à taxa de chegada vezes o tempo médio no sistema). O artigo não cita os dois pareamentos a seguir, eles são meus. O [cache-ext](/papers/cache-ext-customizing-the-page-cache-with-ebpf) coloca uma política de despejo no page cache do kernel, outro caso de política de memória que o kernel tradicionalmente fixa. O [CortenMM](/papers/cortenmm-efficient-memory-management-with-strong-correctness) reconstrói a camada de mapeamento onde uma política de posicionamento atuaria, e seus autores listam a política NUMA como ainda não suportada.

## Contribuição

- **O princípio de equilibrar latências de acesso.** O throughput por core é N vezes 64 bytes dividido pela latência média L, em que N é o número de requisições em andamento, limitado pelos line fill buffers. A latência média é p vezes LD mais (1 menos p) vezes LA, com p a fração dos acessos atendida pelo default tier. Se LD é menor que LA, aumenta-se p, se é maior, diminui-se p, e LD igual a LA é o equilíbrio. Os autores argumentam que isso captura as latências sem carga, a banda de cada tier e a contenção abaixo da saturação, e que se generaliza para mais de dois tiers.
- **Medição de latência com contadores de hardware.** Os contadores do CHA dão a ocupação média da fila O e a taxa de chegada de requisições R de cada tier, e a Lei de Little dá L como O dividido por R, em escalas de tempo de até 1 microssegundo. Os autores suavizam os dois sinais com uma EWMA e ignoram o trecho CPU até CHA (cerca de 5 ns dos aproximadamente 70 ns de latência sem carga). Só as leituras são medidas, já que um miss de store primeiro lê a linha.
- **O algoritmo de posicionamento.** A cada quantum ele calcula LD, LA e p, e então promove páginas quentes para o default tier se LD é menor e as rebaixa caso contrário. Uma regra no estilo de busca binária mantém uma marca d'água baixa e uma alta sobre p (começando em 0 e 1) e mira o ponto médio entre elas. Se as marcas colapsam enquanto as latências ainda são diferentes, elas são reiniciadas, o que trata um equilíbrio que se deslocou. Os limiares epsilon e delta trocam velocidade de detecção por estabilidade, e um limite dinâmico de migração, o menor entre o deslocamento de taxa desejado e o teto do próprio sistema, evita oscilação.
- **HeMem e MEMTIS.** No HeMem (520 linhas, quantum de 10 ms) as listas quente e fria viram cinco faixas de frequência, de modo que o Colloid escolhe páginas cujas probabilidades de acesso somam o deslocamento desejado. No MEMTIS (411 linhas, quantum de 500 ms) ele varre as listas quentes de cada tier e leva em conta o tamanho da página.
- **TPP.** Em cerca de 315 linhas no Linux 6.3, um módulo do kernel faz spin-polling dos contadores em um core dedicado. A probabilidade de acesso é estimada pelo time-to-fault, e o tratador de hint faults promove ou rebaixa uma página só se a probabilidade dela cabe no deslocamento desejado. Os hint faults também são ativados em páginas do default tier, para que páginas quentes possam ser rebaixadas.

## Metodologia

A bancada é um servidor de dois sockets com CPUs Intel Xeon Platinum 8362 (32 cores, 8 canais DDR4-3200 por socket) ligados por UPI. Só um socket executa a aplicação. O default tier é a memória local dele (32 GB, 70 ns sem carga) e o tier alternativo é a memória do outro socket (96 GB, 135 ns sem carga, uma razão de 1,9 que os autores dizem casar aproximadamente com a do CXL).

A carga principal é o GUPS do artigo do HeMem: um buffer de 72 GB com um hot set aleatório de 24 GB que recebe 90% dos acessos, 15 threads de aplicação, objetos de 64 bytes com proporção de leitura/escrita de 1:1. Um antagonista de memória em 5, 10 ou 15 outros cores gera tráfego sequencial de leitura e escrita para um buffer fixado no default tier, o que dá as intensidades de contenção 1×, 2× e 3× (51%, 65% e 70% da banda quando roda sozinho) além do 0×. O best-case vem de posicionar manualmente de 0 a 100% do hot set no default tier em passos de 10 com `mbind`.

O Colloid roda com epsilon 0,01 e delta 0,05, nos três sistemas com seus parâmetros padrão, e os autores também variam a latência sem carga do tier alternativo, o tamanho dos objetos e a convergência sob mudança de padrão de acesso e de contenção. Três aplicações reais rodam em 15 cores com o default tier fixado em um terço do working set: PageRank do GAPBS sobre um grafo do Twitter, o Silo com YCSB-C e o CacheLib com a carga HeMemKV.

## Resultados

Estes são os resultados relatados pelos autores.

- **Os sistemas existentes ficam aquém.** Com contenção de 1×, HeMem, TPP e MEMTIS ficam 1,21×, 1,35× e 1,41× abaixo do best-case, e a diferença cresce para 2,3×, 2,36× e 2,46× com 3×. Com 0× ficam a 1,5%, 4,6% e 10,1% dele, e o MEMTIS perde mais porque divide as huge pages cedo demais e não consegue juntá-las de volta.
- **A suposição falha.** A latência do default tier sobe 2,5×, 3,8× e 5× com 1×, 2× e 3×, o que a deixa 1,2×, 1,8× e 2,4× acima da do tier alternativo. O best-case manda só 25%, 4,5% e 4% da banda para o default tier, enquanto os três sistemas mantêm lá mais de 90%, 75% e 85% em todas as intensidades.
- **O Colloid fecha a maior parte da diferença.** O throughput melhora de 1,2 a 2,3× no HeMem, de 1,35 a 2,35× no TPP e de 1,29 a 2,3× no MEMTIS, terminando a 3%, 8% e 13% do best-case. Com 0× ele iguala os sistemas sem modificação. Com 1× ele divide o hot set entre os tiers, e com 2× e 3× move o hot set inteiro para o tier alternativo, onde a latência do default tier ainda fica acima da do alternativo, mas a diferença é bem menor.
- **Latência e tamanho de objeto.** Com um tier alternativo 2,7× mais lento que o default, o Colloid ainda ganha de 1,01 a 1,76× (HeMem), de 1,03 a 1,76× (TPP) e de 1,01 a 1,63× (MEMTIS), com ganhos menores conforme a diferença de latência aumenta. Com objetos de 256 bytes ou mais ele ajuda até com 0× (de 1,17 a 1,35×), porque o prefetching aumenta o paralelismo por core e o default tier fica mais lento que o alternativo (1,77× com 4096 bytes). Os ganhos diminuem um pouco conforme os objetos crescem, já que o tier alternativo se aproxima da saturação (53% da banda dele com 64 bytes, 96% com 4096).
- **Custo e convergência.** O overhead de CPU fica abaixo de 2% no HeMem e no MEMTIS e entre 4 e 6,5% no TPP, que usa um core extra. Depois de uma mudança no hot set, o HeMem com Colloid leva cerca de 3 segundos a mais para convergir. Quando a contenção salta para 3×, ele chega ao throughput do best-case em cerca de 10 segundos, contra cerca de 25 s no MEMTIS e cerca de 250 s no TPP, velocidades que acompanham a reação de cada sistema a mudanças de acesso.
- **Aplicações reais.** Conforme a contenção cresce, o PageRank melhora de 1,05 a 1,92× (HeMem), de 1,05 a 1,48× (TPP) e de 1,12 a 2,12× (MEMTIS). O Silo iguala a base com pouca contenção e melhora de 1,13 a 1,25×, de 1,09 a 1,17× e de 1,08 a 1,17× com mais contenção. O CacheLib com 2× e 3× melhora de 1,37 a 1,74×, de 1,42 a 1,79× e de 1,48 a 1,93×.

## Análise crítica

O artigo declara seu escopo com clareza. Ele admite o seguinte.

- **Escopo do desenho.** O Colloid precisa de tiers que não compartilhem canais de memória e de um jeito de ler contadores de fila por tier. A motivação estuda contenção só no default tier, com o argumento de que a contenção no tier alternativo mantém a suposição antiga verdadeira. Ler a latência também custa um core dedicado no TPP, e os custos de CPU dos sistemas existentes ficam sem estudo porque nenhum core é sobrecarregado.
- **Limites dos ganhos.** Os ganhos caem quando o tier alternativo fica mais lento ou sua banda enche, e o Colloid não acelera rastreadores lentos, como mostram as centenas de segundos de adaptação do TPP. Ele também soma cerca de 3 segundos à convergência do HeMem. Subir a latência sem carga reduzindo a frequência de uncore do socket remoto também reduz a banda dele, o que os autores dizem tornar os ganhos conservadores.
- **Tiering gerenciado por hardware.** Os caches de memory mode e flat mode fazem a mesma suposição de latência, e integrar o Colloid a eles fica em aberto.

Os pontos a seguir são uma leitura das evidências, não afirmações do artigo.

- **Os números de destaque e o corpo diferem.** A diferença de latência de 2,5× do resumo não é medida: a bancada dá 2,4×, e 2,5× é derivado de uma inflação de 5× e de latências publicadas de CXL. O "2,3× pior que o ótimo" do resumo é o valor do HeMem, enquanto TPP e MEMTIS chegam a 2,36× e 2,46× no corpo. "Quase ótimo" significa 3%, 8% e 13%, e aqui uso os valores do corpo.
- **A otimalidade é mostrada para uma única carga.** O best-case vem de uma varredura manual só para o GUPS. As três aplicações relatam melhora sobre a base, não distância até um ótimo, e ganhos como os de 1,08 a 1,25× do Silo são modestos.
- **O tier alternativo é um nó NUMA.** Nenhum dispositivo CXL real é usado. O próprio artigo cita um estudo de hardware CXL real para dizer que a banda na saturação varia até 1,75× conforme a mistura de leitura e escrita, um comportamento que esta bancada não investiga.
- **A contenção é sintética e estável.** Um antagonista sequencial fixado no default tier, mantido constante ou trocado uma vez de 0× para 3×. Co-inquilinos em rajadas ou oscilantes não são testados, e tempos de reação de 10 s no HeMem e cerca de 250 s no TPP importariam nesse caso.
- **Um espaço de configuração estreito no texto principal.** A capacidade é fixa (o hot set cabe no default tier no GUPS, um terço do working set nas demais), e contagens de cores, proporções de leitura/escrita e sensibilidade de parâmetros foram para uma versão estendida que esta nota não cobre. O texto informa a dispersão entre execuções só para a Figura 1 (3 execuções).
- **As alternativas são argumentadas, não medidas.** Carrefour (equilibrar taxas de requisição) e BATMAN (equilibrar pela razão de banda) são descartados em texto, e as três bases compartilham a regra de posicionamento sob teste. A avaliação com apenas dois tiers deixa a afirmação sobre vários tiers sem teste, e só os contadores da Intel são implementados, embora os da AMD sejam citados.

## Pesquisas futuras

- Integrar o princípio ao tiering gerenciado por hardware, de modo que o posicionamento de dados equilibre a latência na granularidade de cacheline, o que os autores citam como interessante.
- Combiná-lo com os demais sistemas de tiering em software que os autores listam e com mais de dois tiers, onde o artigo só argumenta a generalização.
- Testar em dispositivos CXL reais, em processadores AMD e em máquinas virtuais, onde o acesso aos contadores não é discutido, com vários inquilinos cuja contenção sobe e desce.
- Comparar com um ótimo para aplicações reais, variando as razões de capacidade entre tiers e com contenção nos dois tiers ao mesmo tempo.
