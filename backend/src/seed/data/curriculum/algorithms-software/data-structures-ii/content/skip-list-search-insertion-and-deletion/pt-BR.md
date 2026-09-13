---
version: 1.0
updatedAt: 2026-09-13
title: Busca, Inserção e Remoção em Skip Lists
summary: Inserção e remoção reaproveitam a mesma passada descendente da busca, registrando em um array update o último nó visitado em cada nível, sem nenhuma fase de correção separada como rotação.
---
## Objetivos de Aprendizagem

- Implementar precisamente o procedimento de busca de uma skip list, incluindo a regra de "descer" em cada nível.
- Descrever inserção como duas passadas: uma busca que registra, em todo nível, o último nó visitado antes de descer (o array "update"), seguida por encaixar o novo nó em cada nível para o qual ele foi promovido aleatoriamente.
- Descrever remoção como a imagem espelhada da inserção: localizar o nó em todo nível em que ele aparece usando o mesmo array update, então desconectá-lo de cada um desses níveis.
- Explicar por que uma skip list nunca precisa de nada parecido com uma rotação, mesmo que sua forma mude a cada inserção e remoção.
- Rastrear as três operações manualmente em uma skip list pequena e concreta.

## Contexto e Motivação

O conceito anterior estabeleceu a aparência de uma skip list e de onde vêm seus níveis: uma pilha de listas encadeadas ordenadas cada vez mais esparsas, com a altura de cada elemento decidida por uma sequência independente de lançamentos de moeda no momento da inserção. Este conceito detalha a mecânica de fato: dada essa forma, como uma busca realmente se move por ela passo a passo, e, mais importante, como inserir ou remover um elemento atualiza todo nível que ele toca sem quebrar a ordem em nenhum deles. A surpresa agradável, comparada com árvores AVL e rubro-negras, é que não existe nenhuma fase separada de "correção": a mesma passada descendente única que uma busca executa é reaproveitada, quase sem alteração, para realizar tanto inserção quanto remoção.

## Teoria Central

### Busca: o mecanismo tornado preciso

A busca começa na cabeça do nível não vazio mais alto e repete uma regra até chegar ao nível 0: no nó atual, olhe para o próximo nó no nível atual; se a chave desse próximo nó for menor que o alvo, mova para a direita até ele; caso contrário (a chave do próximo nó é maior ou igual ao alvo, ou não há próximo nó), desça um nível a partir do nó atual e repita. Esse é exatamente o rastreamento já trabalhado no Exemplo 1 do conceito anterior, reafirmado aqui como uma regra explícita e mecânica em vez de um passo a passo ilustrado.

### Inserção: registrando o caminho, depois encaixando o novo nó

A inserção reaproveita a passada descendente da busca com um acréscimo: em todo nível, antes de descer, o nó atual (o último cuja chave ainda é menor que o valor sendo inserido) é registrado em um array convencionalmente chamado `update`, indexado por nível. No momento em que a busca chega ao nível 0, `update[i]` contém, para todo nível `i` de 0 até o nível mais alto pesquisado, exatamente o nó depois do qual o novo valor precisa ser encadeado, naquele nível.

Com o `update` totalmente preenchido, a altura do novo nó é decidida pelo mesmo processo de lançamento de moeda do conceito anterior (nível 0 garantido, depois lançamentos de moeda honesta repetidos decidindo promoções adicionais). Para todo nível `i` de 0 até a altura escolhida do novo nó, o novo nó é encaixado imediatamente depois de `update[i]` no nível `i`: seu ponteiro para frente no nível `i` é ajustado para o que quer que o ponteiro para frente de `update[i]` no nível `i` atualmente seja, e o ponteiro para frente de `update[i]` no nível `i` é então ajustado para o novo nó. Se a altura do novo nó exceder todo nível que atualmente existe na skip list, novos níveis vazios são criados primeiro (com o ponteiro para frente do nó cabeça nesses novos níveis inicialmente apontando diretamente para o novo nó, já que ainda não existe nada acima do antigo nível mais alto).

Como `update[i]` já foi registrado corretamente durante a passada descendente de busca, essa inserção é inteiramente local em cada nível: nenhum outro nó acima ou abaixo do ponto de encaixe precisa ser tocado, e nenhuma comparação do tipo "esse nível está desbalanceado agora" é jamais realizada, porque tal invariante não existe para ser verificado.

### Remoção: o mesmo array update, usado para desconectar em vez de conectar

A remoção executa a mesma passada descendente de busca, preenchendo o mesmo array `update`, até localizar o nó alvo no nível 0 (ou determinar que ele está ausente, caso em que a remoção é simplesmente uma operação nula). Para todo nível `i` em que o nó alvo existe (do nível 0 até qualquer nível ao qual ele tenha sido promovido no momento da inserção), ele é desconectado exatamente como um nó de lista encadeada simples sempre é desconectado: o ponteiro para frente de `update[i]` no nível `i` é ajustado para pular o nó alvo, apontando diretamente para o que quer que fosse o próprio ponteiro para frente do nó alvo naquele nível.

Se remover o nó esvaziar completamente o nível mais alto (nenhum elemento restando naquele nível), esse nível agora inútil e vazio é descartado, encolhendo a altura da skip list. Nada mais precisa acontecer: não há passada de rebalanceamento, nenhuma recoloração, nenhuma rotação, porque a remoção, assim como a inserção, só toca o pequeno conjunto local de ponteiros imediatamente ao redor do nó afetado em cada nível em que ele existia.

### Por que não existe nenhuma fase de "correção"

Árvores AVL e rubro-negras exigem que inserção e remoção sejam seguidas por uma segunda fase, subindo de volta a partir do nó modificado e reparando qualquer invariante que a modificação tenha perturbado. Uma skip list não tem essa segunda fase porque não tem nenhum invariante para perturbar no sentido estrutural que essas árvores têm: o nível de um nó já foi decidido, uma vez, por lançamentos de moeda, antes mesmo da inserção acontecer, e desconectar um nó durante a remoção não pode de forma alguma violar nada sobre o nível de qualquer *outro* nó, já que o nível de todo nó é independente do nível de todo outro nó por construção. O único trabalho estrutural de contabilidade que inserção ou remoção fazem é o encaixe ou desencaixe comum de lista encadeada simples, repetido uma vez por nível que o nó afetado ocupa, uma operação de O(log n) níveis com O(1) de trabalho em cada nível, e nada mais.

## Exemplos Resolvidos

### Exemplo 1: inserindo um novo nó com um array update registrado

**Problema:** Usando a skip list do conceito anterior (níveis 0 a 3, com marcos 20 e 40 nos níveis mais altos), insira o valor `27`, que já havia sido determinado (no Exemplo 2 do conceito anterior) como promovido aos níveis 0, 1 e 2.

**Passada descendente, registrando update:** No nível 3, a partir da cabeça, o próximo é `40` (maior que `27`), então `update[3] = head`, desça. No nível 2, a partir da cabeça, o próximo é `20` (menor que `27`, mova para a direita); a partir de `20`, o próximo é `40` (maior que `27`), então `update[2] = 20`, desça. No nível 1, a partir de `20` (alcançado pelo ponteiro vertical), o próximo é `40` (maior que `27`), então `update[1] = 20`, desça. No nível 0, a partir de `20`, o próximo é `25` (menor que `27`, mova para a direita); a partir de `25`, o próximo é `30` (maior que `27`), então `update[0] = 25`.

**Encaixando `27`:** No nível 0, o ponteiro para frente de `27` é ajustado para o antigo ponteiro para frente de `25` (`30`), e o ponteiro para frente de `25` é ajustado para `27`. No nível 1, o ponteiro para frente de `27` é ajustado para o antigo ponteiro para frente de `20` no nível 1 (`40`), e o ponteiro para frente de `20` no nível 1 é ajustado para `27`. No nível 2, a mesma coisa acontece entre `20` e `40` no nível 2. `27` não é encaixado no nível 3, já que seus lançamentos de moeda pararam no nível 2.

**Resultado:** `27` agora aparece nos níveis 0, 1 e 2, cada encaixe feito puramente entre `27` e seu vizinho imediato `update[i]`, sem nenhum outro nó tocado.

### Exemplo 2: removendo um nó que existe em múltiplos níveis

**Problema:** Remova `40` da skip list resultante, dado que `40` existe nos níveis 0, 1, 2 e 3 (como mostrado no diagrama original).

**Passada descendente, registrando update:** O mesmo estilo de busca localiza o nó imediatamente antes de `40` em todo nível: `update[3] = head` (já que `40` é o primeiro nó no nível 3), `update[2] = 20`, `update[1] = 27` (depois da inserção no Exemplo 1), `update[0] = 35`.

**Desconectando `40`:** Em cada nível de 3 até 0, o ponteiro para frente de `update[i]` é redirecionado para pular `40`, apontando em vez disso para o que quer que fosse o próprio ponteiro para frente de `40` naquele nível (`head` no nível 3 agora aponta para o que vinha depois de `40` ali, `20` no nível 2 agora aponta além de `40`, e assim por diante até o nível 0). Se o nível 3 tivesse contido apenas `40`, ele agora estaria vazio e seria descartado, encolhendo a altura da skip list em um.

## Equívocos Comuns e Armadilhas

- **"A inserção precisa relançar uma moeda para cada nó existente para ver se a estrutura ainda está balanceada."** Apenas o novo nó sendo inserido recebe uma nova sequência de lançamentos de moeda para decidir sua própria altura; o nível de todo outro nó, já decidido no momento de sua própria inserção, permanece completamente intocado.
- **"O array update precisa de uma segunda passada pela skip list para ser construído."** Ele é construído durante exatamente a mesma passada descendente que localiza o ponto de inserção ou remoção, a custo zero de travessia extra, exatamente como os Exemplos 1 e 2 mostram.
- **"Remover um nó que existe no nível mais alto encolhe o nível de todo outro nó também."** O nível de todo nó é independente; remover o único nó no nível mais alto só afeta aquele nível vazio em si (que pode então ser descartado), nunca reatribui ou recalcula a altura de nenhum outro nó.
- **"Skip lists também precisam de rotações, só que com outro nome."** Não existe operação em uma skip list que desempenhe o papel de uma rotação. O único trabalho estrutural que inserção e remoção fazem é o encaixe de ponteiro padrão de lista encadeada simples, em cada nível que o nó afetado ocupa, e nada mais.

## Resumo

A busca move para a direita enquanto a próxima chave no nível atual ainda for menor que o alvo e desce um nível caso contrário, até pousar no nível 0. A inserção reaproveita exatamente essa passada descendente, registrando em um array `update` o último nó visitado em cada nível antes de descer, depois encaixa o novo nó imediatamente depois de `update[i]` em todo nível para o qual os lançamentos de moeda do novo nó o promoveram. A remoção reaproveita a passada descendente e o array `update` idênticos para localizar o nó alvo, depois o desconecta de todo nível em que existe redirecionando o ponteiro de cada `update[i]` ao redor dele. Nenhuma das operações precisa de fase de correção, porque nenhum invariante entre nós está em risco: o nível de todo nó foi decidido uma vez, de forma independente, em sua própria inserção, então conectar ou desconectar um nó nunca exige ajustar o nível de nenhum outro nó. O próximo conceito deriva, rigorosamente, por que esse processo de lançamento de moeda realmente mantém a altura esperada em O(log n).

## Documentation Links

- [Pugh, W. (1990). "Skip Lists: A Probabilistic Alternative to Balanced Trees." Communications of the ACM.](https://epaperpress.com/sortsearch/download/skiplist.pdf): paper
- [MIT 6.006 - Lecture Notes (OCW)](https://ocw.mit.edu/courses/6-006-introduction-to-algorithms-spring-2020/pages/lecture-notes/): doc
