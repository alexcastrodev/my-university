---
version: 1.0
updatedAt: 2026-09-07
title: "Inserção e Divisão de Nós em Árvore B+"
summary: "Rastreia uma inserção completa em árvore B+ à mão numa pequena árvore real, cobrindo o caso que transborda uma folha e força uma divisão (redistribuir suas entradas uniformemente por duas folhas, copiar a chave do meio para cima no pai como separador) e o caso em que essa divisão se propaga para um nó interno (redistribuir uniformemente, mas empurrar a chave do meio para cima em vez de copiá-la, já que nós internos não armazenam dados), preservando o invariante meio-cheio em todo nível sem nunca rebalancear a árvore inteira."
---
## Objetivos de Aprendizagem

- Enunciar o algoritmo de inserção da árvore B+ precisamente: encontrar a folha, inserir em ordem ordenada, dividir se transbordar.
- Distinguir "copiar para cima" (divisão de folha) de "empurrar para cima" (divisão de nó interno) e explicar por que os dois casos diferem.
- Rastrear à mão uma sequência completa de inserções numa pequena árvore B+ real, incluindo ambos os tipos de divisão.
- Explicar por que uma divisão nunca precisa tocar mais que um único caminho raiz-para-folha, mantendo o custo de inserção logarítmico.

## Contexto e Motivação

O conceito anterior fixou a forma alvo da árvore B+ (perfeitamente balanceada, todo nó pelo menos meio-cheio, todos os dados nas folhas), mas não disse nada sobre como essa forma sobrevive a uma inserção de fato. Este conceito constrói exatamente isso: o algoritmo que insere uma nova chave sem nunca deixar a árvore em um estado que viole qualquer um dos três invariantes, mesmo temporariamente persistido em disco. A ideia central de design, e a razão pela qual uma árvore B+ nunca precisa do tipo de operação de rebalanceamento que percorre toda a árvore que uma inserção ingênua em BST não balanceada poderia exigir, é que uma **divisão só jamais afeta nós ao longo de um único caminho raiz-para-folha**: uma inserção que transborda uma folha conserta essa folha localmente, e só se propaga para cima se o próprio conserto fizer o pai transbordar também, um nível de cada vez.

## Teoria Central

### O algoritmo

Para inserir uma chave `k`: encontrar a folha correta `L` descendo pela árvore exatamente como em uma busca. Inserir `k` na lista ordenada de chaves de `L`. Se `L` ainda tiver no máximo `m − 1` chaves, a inserção está pronta, nenhum outro nó é tocado. Se `L` agora tiver `m` chaves (uma a mais), **dividir** `L` em duas folhas, redistribuindo suas `m` chaves uniformemente por elas, e inserir uma nova entrada separadora apontando para a nova folha direita no pai de `L`. Se essa inserção no pai ela mesma fizer o pai transbordar, a mesma lógica de divisão se repete um nível acima, e assim por diante, potencialmente até a raiz, caso em que a árvore ganha um novo nível (uma raiz totalmente nova) e cresce em altura em exatamente um pela primeira vez desde a sua criação.

### Copiar para cima vs. empurrar para cima

A lógica de divisão difere sutilmente entre folhas e nós internos, por uma razão diretamente ligada ao invariante do conceito anterior de que dados vivem apenas em folhas:

- **Divisão de folha**: redistribuir as chaves da folha uniformemente entre a folha original e uma nova folha irmã, depois **copiar** a primeira chave da nova folha direita para cima no pai como separador: copiar, não mover, porque essa chave ainda deve existir fisicamente na folha (são dados reais, ainda necessários ali para buscas e para a cadeia de folhas), mesmo que uma duplicata de seu valor agora também viva no pai puramente como uma placa de roteamento.
- **Divisão de nó interno**: redistribuir as chaves do nó uniformemente entre ele e um novo nó interno irmão, depois **empurrar** a chave do meio para cima no pai: empurrar, não copiar, porque as chaves de nó interno não carregam dados próprios, apenas informação de roteamento, então uma vez que o trabalho de roteamento de uma chave é entregue ao pai não há razão para manter uma cópia redundante no filho.

```mermaid
graph TD
    subgraph "Divisão de folha (copiar para cima)"
    L["Transbordo de folha: [5,10,15,20]"] --> L1["Folha esquerda: 5,10"]
    L --> L2["Folha direita: 15,20"]
    L2 -.->|"copiar 15"| P1["Pai ganha a chave 15"]
    end
```

## Exemplos Resolvidos

O rastreamento a seguir usa fanout `m = 4` (máximo de 3 chaves por nó, mínimo de 1 chave por nó não-raiz) e insere as chaves `5, 10, 15, 20, 25, 30, 35, 40, 45, 50` uma de cada vez em uma árvore inicialmente vazia.

### Exemplo 1: construindo até a primeira divisão de folha

Inserir `5, 10, 15` preenche o nó (atualmente único, raiz-como-folha) para exatamente `[5, 10, 15]`, 3 chaves, no máximo, mas ainda não transbordando. Inserir `20` o transborda para `[5, 10, 15, 20]` (4 chaves). **Divisão**: redistribuir uniformemente em folha esquerda `L1 = [5, 10]` e folha direita `L2 = [15, 20]`, depois copiar a primeira chave de `L2` (que é `15`) para cima para formar uma raiz totalmente nova. Resultado: raiz (interna) `= [15]`, com filhos `L1 = [5,10]` e `L2 = [15,20]`: a árvore cresceu de uma única folha para altura 2.

### Exemplo 2: uma segunda e terceira divisão de folha, raiz absorvendo novos separadores

Inserir `25` cai em `L2` (`25 ≥ 15`): `L2 = [15, 20, 25]`, no máximo, sem divisão. Inserir `30` transborda `L2` para `[15,20,25,30]`; dividir em `L2 = [15,20]` e uma nova `L3 = [25,30]`, copiando `25` para cima. A raiz absorve este novo separador diretamente (ela atualmente tem apenas 1 chave, bem abaixo de seu próprio máximo de 3): raiz `= [15, 25]`, filhos `[L1, L2, L3]`. Continuando o mesmo padrão, inserir `35` preenche `L3` para `[25,30,35]` (sem divisão), e inserir `40` transborda `L3` para `[25,30,35,40]`; dividir em `L3=[25,30]` e nova `L4=[35,40]`, copiando `35` para cima. A raiz absorve isso também: raiz `= [15, 25, 35]`, filhos `[L1,L2,L3,L4]`: a raiz agora tem exatamente 3 chaves, no seu próprio máximo, sem transbordo ainda, mas sem espaço restante para absorver outro separador sem dividir ela mesma.

### Exemplo 3: uma divisão de nó interno (empurrar para cima), a raiz cresce uma nova raiz

Inserir `45` preenche `L4` para `[35,40,45]` (sem divisão). Inserir `50` transborda `L4` para `[35,40,45,50]`; dividir em `L4 = [35,40]` e nova `L5 = [45,50]`, copiando `45` para cima, mas a raiz, atualmente `[15,25,35]`, já está no seu máximo de 3 chaves, então inserir `45` transborda *ela* também, conceitualmente para `[15,25,35,45]` com filhos `[L1,L2,L3,L4,L5]`. Desta vez é uma **divisão de nó interno**: redistribuir as 4 chaves uniformemente, o nó interno esquerdo fica com `[15,25]` com filhos `[L1,L2,L3]`, o nó interno direito fica com `[45]` com filhos `[L4,L5]`, e **empurrar** a chave do meio `35` para cima para formar uma raiz totalmente nova, em vez de copiá-la (não há dados em nível de folha associados a `35` para preservar uma cópia; seu único trabalho sempre foi roteamento). Estrutura final: raiz `= [35]`, filho esquerdo (interno) `= [15,25]` → `[L1,L2,L3]`, filho direito (interno) `= [45]` → `[L4,L5]`: a árvore cresceu para altura 3, e toda folha ainda está em profundidade idêntica, exatamente como o invariante de balanceamento exige.

## Equívocos Comuns e Armadilhas

- **"Uma divisão rebalanceia a árvore inteira, como uma rotação cascateando por uma árvore AVL."** Uma divisão em árvore B+ só jamais toca nós no único caminho raiz-para-folha em que se está inserindo: a divisão de nó interno do Exemplo 3 tocou a folha transbordando, seu pai, e nada mais; as outras três folhas (`L1`, `L2`, `L3`, irmãs não afetadas) e suas posições na árvore nunca foram examinadas ou modificadas, diferente de uma rotação que inspeciona fatores de balanceamento de ancestrais ao longo do caminho mas pode reestruturar ponteiros em cada um que toca.
- **"A árvore cresce uma nova raiz a cada divisão."** Apenas uma divisão que alcança a raiz *atual* (porque todo ancestral no caminho já estava cheio) cria uma nova raiz e aumenta a altura; o caso muito mais comum, as duas divisões de folha do Exemplo 2, para assim que alcança um pai com capacidade de sobra, deixando a altura da árvore inalterada.
- **"Copiar para cima e empurrar para cima são apenas dois nomes para a mesma operação."** Elas diferem de uma maneira que importa para a correção, não apenas na terminologia: a chave copiada para cima de uma divisão de folha deve permanecer na folha (são dados reais e consultáveis, e a cadeia de folhas depende de toda folha manter seu próprio complemento completo de chaves), enquanto a chave empurrada para cima de uma divisão de nó interno é *removida* de ambos os filhos inteiramente, já que nós internos nunca armazenam dados, apenas chaves de roteamento, e manter uma duplicata obsoleta ali não serviria a nenhum propósito e desperdiçaria espaço.

## Resumo

A inserção na árvore B+ encontra a folha alvo exatamente como a busca faria, insere a nova chave em ordem ordenada, e, apenas se isso transbordar a capacidade da folha, a divide em duas, propagando uma nova chave separadora para cima um nível de cada vez até que algum ancestral tenha espaço de sobra, ou, no pior caso, até uma raiz totalmente nova. Divisões de folha copiam sua chave separadora para cima (já que ainda são dados reais de folha), enquanto divisões de nó interno a empurram para cima (já que chaves de nó interno não carregam dados a preservar), e porque uma divisão só jamais toca um caminho raiz-para-folha, o custo de inserção permanece exatamente o O(logₘ n) que a garantia de balanceamento do conceito anterior prometeu, nunca degradando em algo que lembre um rebalanceamento da árvore inteira.

## Documentation Links

- [CMU 15-445/645: Indexes & Filters I Slides](https://15445.courses.cs.cmu.edu/fall2025/slides/08-indexes1.pdf): cobre os invariantes da árvore B+ que o algoritmo de divisão deste conceito é construído para preservar, trazidos do conceito de estrutura-e-busca.
- [CMU 15-445/645: Indexes & Filters II Slides](https://15445.courses.cs.cmu.edu/fall2025/slides/09-indexes2.pdf): a fonte do próprio algoritmo de inserção deste conceito, incluindo a distinção copiar-para-cima (divisão de folha) vs. empurrar-para-cima (divisão de nó interno) trabalhada nos exemplos.