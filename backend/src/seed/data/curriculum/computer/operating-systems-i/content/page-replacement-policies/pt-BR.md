---
version: 1.0
updatedAt: 2026-09-06
title: Políticas de Substituição de Páginas
summary: "Quando a memória física está cheia e uma página nova precisa entrar, algo tem de ser despejado: FIFO, ótimo e LRU são três respostas diferentes para 'qual página', comparadas na mesmíssima sequência de referências para ver quantas faltas de página cada uma de fato causa."
---
## Objetivos de Aprendizagem

- Explicar por que a memória física ficar cheia obriga o SO a escolher uma página para despejar quando uma página nova precisa entrar.
- Acompanhar a substituição de páginas FIFO, ótima e LRU na mesma sequência de referências, e contar as faltas de página que cada uma produz.
- Explicar por que a política ótima (despejar a página que será usada mais longe no futuro) é um melhor caso teórico, e não implementável na prática.
- Explicar a intuição por trás do LRU como uma aproximação prática do ótimo, e por que ele normalmente (mas nem sempre) supera o FIFO.

## Contexto e Motivação

A paginação, como vista até aqui, supôs implicitamente que a memória física sempre tem espaço para as páginas de que um processo precisa no momento. Sistemas reais rodam muitos processos ao mesmo tempo, disputando uma quantidade finita, e normalmente muito menor, de memória física do que a soma dos espaços de endereçamento virtuais de todo mundo; então, em algum momento, trazer uma página nova exige despejar uma existente para abrir espaço. **Qual** página despejar é uma pergunta genuína de política, e respostas diferentes, de aparência razoável, produzem números mensuravelmente diferentes de faltas de página seguintes na mesmíssima sequência de referências à memória; precisamente análogo à pergunta de política de substituição de cache já vista para caches de dados na disciplina `computer-architecture` desta plataforma, agora aplicada um nível mais abaixo na hierarquia de memória, a quadros de página físicos em vez de linhas de cache.

## Teoria Central

### O problema, com precisão

Dado um número fixo de quadros físicos e uma sequência de referências a páginas (uma **sequência de referências**) que excede o que cabe ao mesmo tempo, é preciso tomar uma decisão de despejo toda vez que uma página referenciada não está residente no momento e não há quadro livre disponível. Cada evento desses, em que a página necessária não está já na memória, é uma **falta de página**: a métrica pela qual toda política de substituição deste conceito é julgada. Menos faltas de página para a mesma sequência de referências e o mesmo número de quadros significa uma política melhor para aquela carga de trabalho.

### FIFO: despejar a página que está residente há mais tempo

A substituição **primeiro a entrar, primeiro a sair (FIFO)** despeja a página residente que foi trazida para a memória primeiro, sem importar quão recentemente ou quão frequentemente ela foi de fato usada desde então. É simples de implementar (só uma fila de páginas residentes, na ordem de carregamento), mas pode se sair surpreendentemente mal, já que a mera idade de uma página na memória não diz nada sobre se ela ainda está sendo usada ativamente.

### Ótima: o melhor caso não implementável

A **substituição ótima (algoritmo de Bélády)** despeja a página residente que será referenciada mais longe no futuro (ou nunca mais). Isso minimiza de forma comprovada o número total de faltas de página para uma dada sequência de referências e um dado número de quadros, mas exige conhecer de antemão a sequência *futura* de referências, o que um sistema real em execução geralmente não consegue saber. A política ótima é usada exclusivamente como régua teórica: as políticas reais são comparadas pelo quão perto chegam do número de faltas do ótimo na mesma carga de trabalho, e não implementadas diretamente, no mesmo espírito em que a otimalidade de escalonamento do SJF (vista antes nesta disciplina) exigia conhecer de antemão o tamanho das tarefas e, por isso, também não era diretamente implementável em geral.

### LRU: aproximar o ótimo usando o passado em vez do futuro

O **menos recentemente usado (LRU)** despeja a página residente que passou mais tempo *sem* ser referenciada. A intuição: uma página usada recentemente provavelmente (pelo mesmo princípio de localidade já visto para o TLB e para caches em geral) vai ser usada de novo em breve, então a página que ficou parada sem uso por mais tempo é o melhor palpite disponível para "não vai ser necessária de novo tão cedo": um substituto prático e implementável para o conhecimento do futuro real que o ótimo exige e que não está disponível. O LRU nem sempre é tão bom quanto o ótimo (ele pode ser enganado por padrões de acesso que violam a localidade típica), mas é geralmente a política prática mais forte entre as vistas aqui, e sistemas reais o aproximam (rastrear o LRU exato tem sua própria sobrecarga, tratada por várias aproximações práticas além da profundidade desta disciplina).

## Exemplos Resolvidos

### Exemplo 1: FIFO numa sequência de referências concreta

Sequência de referências: `1, 2, 3, 4, 1, 2, 5, 1, 2, 3, 4, 5`, com 3 quadros físicos disponíveis.

```text
Ref:   1    2    3    4    1    2    5    1    2    3    4    5
       -----------------------------------------------------------
Q1:    1    1    1    4    4    4    5    5    5    5    4    4
Q2:         2    2    2    1    1    1    1    1    1    1    5
Q3:              3    3    3    2    2    2    2    3    3    3
Falta: F    F    F    F    F    F    F    F    -    F    F    F

Total de faltas no FIFO: 10 (de 12 referências)
```

(O FIFO despeja o quadro carregado há mais tempo toda vez que ocorre uma falta e não sobra quadro livre; por exemplo, na referência 4, o quadro 1, que guarda a página 1, é despejado, já que foi o primeiro carregado entre 1, 2, 3.)

### Exemplo 2: ótimo na mesmíssima sequência de referências

A mesma sequência de referências, os mesmos 3 quadros, usando a regra de Bélády: despejar a página residente que será usada mais longe no futuro:

```text
Ref:   1    2    3    4    1    2    5    1    2    3    4    5
       -----------------------------------------------------------
Q1:    1    1    1    1    1    1    1    1    1    1    4    4
Q2:         2    2    2    2    2    2    2    2    2    2    5
Q3:              3    4    4    4    5    5    5    3    3    3
Falta: F    F    F    F    -    -    F    -    -    F    F    F

Total de faltas no ótimo: 8 (de 12 referências)
```

Na referência 4 (uma falta, já que os quadros guardam 1, 2, 3), o ótimo despeja a página 3 em vez da página 1, porque, olhando adiante, a página 3 só é referenciada de novo na posição 10, enquanto a página 1 é necessária de novo quase de imediato, na posição 5. O ótimo consegue 8 faltas contra 10 do FIFO na mesmíssima sequência de referências e com o mesmo número de quadros: uma demonstração direta e medida de que a escolha do despejo importa, usando nada além de uma regra diferente para qual página despejar.

### Exemplo 3: LRU na mesmíssima sequência de referências, e a comparação

A mesma sequência de referências, os mesmos 3 quadros, despejando a página residente referenciada há mais tempo:

```text
Ref:   1    2    3    4    1    2    5    1    2    3    4    5
       -----------------------------------------------------------
Q1:    1    1    1    4    4    4    5    5    5    5    4    4
Q2:         2    2    2    1    1    1    1    1    1    1    5
Q3:              3    3    3    2    2    2    2    3    3    3
Falta: F    F    F    F    F    F    F    -    -    F    F    F

Total de faltas no LRU: 9 (de 12 referências)
```

```text
Resumo nesta sequência de referências, 3 quadros:
  FIFO:   10 faltas
  Ótimo:   8 faltas  (melhor caso teórico, exige conhecer o futuro)
  LRU:     9 faltas  (prático, usa só as referências passadas)
```

O LRU fica entre o FIFO e o ótimo aqui: pior que o ideal não implementável, mas melhor que a regra ingênua do FIFO, baseada na idade, por usar o histórico real de referências (qual página passou mais tempo sem ser tocada) em vez de só quanto tempo atrás uma página foi carregada pela primeira vez.

## Equívocos Comuns e Armadilhas

- **"O FIFO despeja a página menos recentemente usada, só que rastreada pela ordem de carregamento."** O FIFO rastreia só *quando uma página foi carregada*, e não quando ela foi *referenciada* pela última vez; uma página carregada há muito tempo, mas referenciada sem parar desde então (e, portanto, claramente ainda necessária), ainda pode ser despejada pelo FIFO puramente por causa do seu instante de carregamento antigo, uma fraqueza real que o LRU foi projetado especificamente para evitar.
- **"A substituição ótima é uma política real e implementável que deveria simplesmente ser usada."** O ótimo exige conhecer de antemão a sequência futura de referências, informação que um sistema em execução não tem, e é precisamente por isso que ele existe só como uma régua teórica para julgar quão perto as políticas práticas (como o LRU) chegam do melhor resultado possível.
- **"O LRU sempre se sai pelo menos tão bem quanto o FIFO em qualquer sequência de referências."** O LRU é geralmente mais forte na prática porque a maioria das cargas reais exibe a localidade que ele explora, mas não há garantia matemática de que ele supere o FIFO em toda sequência de referências concebível; alguns padrões de acesso adversários ou incomuns podem favorecer um ou outro de formas diferentes; a superioridade geral é empírica e dependente da localidade, não uma garantia absoluta.
- **"Uma falta de página sempre significa que algo está quebrado ou que o programa tem um bug."** Uma falta de página, neste contexto, é simplesmente o evento de uma página referenciada não estar residente na memória no momento, uma parte totalmente comum e esperada da operação normal de paginação sempre que a memória física é menor que a soma de tudo o que está sendo usado, e não necessariamente sinal de erro (um acesso genuinamente inválido ou não mapeado é uma condição diferente).

## Resumo

Quando a memória física enche, trazer uma página nova exige despejar uma residente, e políticas de despejo diferentes produzem contagens de faltas de página mensuravelmente diferentes na mesmíssima sequência de referências. O **FIFO** despeja só pela ordem de carregamento, ignorando o uso real desde o carregamento, e pode se sair mal por isso. O **ótimo** (algoritmo de Bélády) despeja a página que será necessária mais longe no futuro, minimizando as faltas de forma comprovada, mas exige um conhecimento do futuro que nenhum sistema real tem, o que o torna uma régua teórica, e não uma política implementável. O **LRU** despeja a página residente que passou mais tempo sem ser referenciada, usando só o comportamento passado como substituto prático, baseado em localidade, para a presciência indisponível do ótimo, e geralmente supera o FIFO na prática, como as contagens concretas de faltas do exemplo resolvido (FIFO 10, LRU 9, ótimo 8) demonstram numa sequência de referências específica. O próximo conceito se volta para o que acontece em torno dessas faltas de página em nível de sistema: como a paginação sob demanda decide quando trazer páginas, e o que acontece quando a demanda por memória física de todos os processos em execução excede o que de fato está disponível.

## Documentation Links

- [Arpaci-Dusseau: Operating Systems: Three Easy Pieces, "Beyond Physical Memory: Policies"](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys-policy.pdf): o tratamento canônico da substituição de páginas FIFO, ótima e LRU a partir do qual este conceito é construído.
- [ACM/IEEE CS2013: Operating Systems Knowledge Area](https://csed.acm.org/knowledge-areas-operating-systems-os-cs2013-version/): diretrizes curriculares que estabelecem a comparação de políticas de substituição de páginas como conteúdo central de memória virtual.
