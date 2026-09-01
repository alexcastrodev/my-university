---
version: 1.0
updatedAt: 2026-08-14
title: "Expressões Regulares via Simulação de NFA"
description: "Como Sedgewick e Wayne transformam uma expressão regular em um autômato finito não determinístico e o simulam rastreando o conjunto inteiro de estados alcançáveis em vez de fazer backtracking, garantindo tempo de matching O(NM) no pior caso — uma garantia mais forte que a abordagem de backtracking que o java.util.regex.Pattern de fato usa."
---
## Objetivo

Entenda como uma expressão regular pode ser transformada em uma máquina abstrata de pattern-matching — um autômato finito de estados não determinístico (NFA) — e como *simular* essa máquina (rastreando o conjunto inteiro de estados em que ela poderia possivelmente estar, em vez de chutar e fazer backtracking num chute errado) permite que o algoritmo de Sedgewick & Wayne decida se um texto de N caracteres casa com uma RE de M caracteres em tempo proporcional a `NM` no pior caso, garantido, não importa como a RE esteja estruturada.

## Casos de Uso

- **Busca de substring generalizada.** Buscar por uma substring literal `pat` em um texto `txt` (o problema da Seção 5.3) é exatamente o caso especial de perguntar se `txt` está na linguagem descrita pelo padrão `.*pat.*` — matching de RE engloba busca de substring em vez de ser um problema separado.
- **Checagem de validade de entrada estruturada** — números de telefone (`\([0-9]{3}\)\ [0-9]{3}-[0-9]{4}`), identificadores Java (`[$_A-Za-z][$_A-Za-z0-9]*`), ou endereços de email (`[a-z]+@([a-z]+\.)+(edu|com)`) — onde escrever uma RE que descreve o conjunto de todas as strings legais é mais preciso e conciso que codificar cada caso à mão.
- **grep e genômica.** O comando `grep` do Unix imprime toda linha que casa com uma RE dada; biólogos usam REs como `gcg(cgg)*ctg` para descrever regiões genômicas onde uma sequência curta se repete um número variável de vezes (uma contagem de repetição clinicamente associada a certas condições genéticas).

## Aprofundamento

### Expressões regulares como ferramenta de descrição de linguagem: concatenação, ou, closure

Uma expressão regular (RE) é construída a partir de três operações aplicadas a caracteres: **concatenação** (`AB` denota a linguagem de uma string `{AB}`), **ou** (`A|B` denota `{A, B}`, escrito com `|`), e **closure** (`A*` denota a linguagem formada concatenando `A` consigo mesma zero ou mais vezes, denotada com um `*` à direita). Concatenação tem precedência maior que ou, e closure tem precedência maior que concatenação, então `AB*` significa "um A seguido de zero ou mais Bs" enquanto `A*B` significa "zero ou mais As seguidos de um B"; parênteses sobrepõem a precedência padrão, então `C(AC|B)D` descreve `{CACD, CBD}`. Formalmente, uma RE é ou vazia, ou um único caractere, ou uma RE entre parênteses, ou duas ou mais REs concatenadas, ou duas ou mais REs separadas por `|`, ou uma RE seguida de `*` — e o *significado* de cada construção é definido recursivamente na mesma forma (a linguagem da concatenação é o produto cartesiano das linguagens das partes, a do ou é a união delas, a da closure é a união da concatenação de qualquer número de cópias incluindo zero).

REs práticas adicionam atalhos por cima desses três primitivos: `.` (curinga, qualquer caractere único), `[AEIOU]` (um conjunto especificado), `[A-Z]` (um intervalo), `[^AEIOU]` (um complemento), e atalhos de closure `+` (pelo menos uma cópia, ou seja, `(AB)+` é abreviação de `(AB)(AB)*`), `?` (zero ou uma cópia), e `{n}`/`{n-m}` (uma contagem exata ou em intervalo de cópias). Cada um deles é "simplesmente um atalho para uma sequência de operações ou" ou uma sequência de concatenação/closure — eles não adicionam poder expressivo, só conveniência.

### Representando um padrão como um NFA: um estado por caractere da RE, dois tipos de aresta

A ideia central, por analogia com o DFA de KMP da seção anterior: construa uma máquina abstrata a partir do padrão, depois simule-a contra o texto. A diferença é que os operadores `|` e `*` de uma RE fazem com que a máquina nem sempre consiga dizer, a partir de um único caractere, se o padrão poderia casar — então a máquina recebe o poder do **não determinismo**: quando encontra mais de uma transição possível, ela pode conceitualmente "chutar" a certa, e diz-se que ela reconhece um texto se *alguma* sequência de transições consome todo caractere do texto e termina no estado de aceite.

Por convenção, todo padrão é envolvido em parênteses. Considere a RE `((A*B|AC)D)`, cujo NFA tem um estado por caractere da RE (índices 0 a 10, para os 11 caracteres) mais um estado virtual de aceite 11:

```text
 0   1   2   3   4   5   6   7   8   9   10   11
 (   (   A   *   B   |   A   C   )   D   )   aceite
```

- Um estado correspondente a um caractere do alfabeto (como `A`, `B`, `C`, `D`) tem uma **transição de match** de saída — uma aresta preta nos diagramas do livro — para o próximo estado, tomada só quando o caractere atual do texto é igual ao caractere daquele estado; tomá-la consome (avança sobre) aquele caractere.
- Um estado correspondente a um metacaractere (`(`, `)`, `|`, `*`) tem uma ou mais **transições-ε** de saída — arestas vermelhas — para algum outro estado, tomadas sem consumir nenhum caractere de texto (ε representa casar com a string vazia).
- Nenhum estado tem mais de uma transição de match de saída, embora um estado possa ter várias transições-ε de saída.

Como transições-ε nunca dependem do texto, elas formam um digrafo fixo independente de qualquer entrada específica — Sedgewick & Wayne o chamam de `G`. Para `((A*B|AC)D)`, `G` consiste em exatamente nove arestas: `0→1, 1→2, 1→6, 2→3, 3→2, 3→4, 5→8, 8→9, 10→11`. (`2→3` permite que `A*` case com zero As pulando diretamente do estado `A` para o estado `*`; `3→2` volta para outro A; `1→2` e `1→6` são os dois ramos do `|`; `5→8` e `8→9` pulam além da maquinaria do ramo `|` até o `)` de fechamento; `10→11` alcança o estado de aceite depois do `)` final.) Transições de match *não* fazem parte de `G` — elas vivem implicitamente no array de caracteres da RE e só disparam ao varrer um caractere específico do texto.

### Simulando o NFA: rastreie o conjunto inteiro de estados alcançáveis, uma passada de alcançabilidade multi-origem por caractere de entrada

Em vez de chutar e fazer backtracking, o algoritmo mantém o controle de *todo* estado em que o NFA poderia possivelmente estar enquanto examina o caractere de entrada atual — o conjunto de todos os estados alcançáveis a partir dos estados que casaram até agora via zero ou mais transições-ε. Isso é exatamente o cálculo de alcançabilidade de múltiplas origens (`DirectedDFS`) usado antes para alcançabilidade em digrafo: inicialize o conjunto como tudo que é alcançável via transições-ε a partir do estado 0; para cada caractere de entrada, calcule quais dos estados atuais têm uma transição de match naquele caractere (dando um novo conjunto de estados logo depois do match), depois pegue o fecho-ε desse conjunto (tudo alcançável a partir dele via `G`) para obter os estados possíveis antes do próximo caractere. Se o estado de aceite alguma vez estiver no conjunto, o texto é reconhecido.

Traçando `((A*B|AC)D)` contra a entrada `AABD` reproduz exatamente o próprio exemplo trabalhado do livro:

```viz
type: graph
node 0 "0:(" 0 0
node 1 "1:(" 1 0
node 2 "2:A" 2 0
node 3 "3:*" 3 0
node 4 "4:B" 4 0
node 5 "5:|" 5 0
node 6 "6:A" 6 1
node 7 "7:C" 7 1
node 8 "8:)" 8 0
node 9 "9:D" 9 0
node 10 "10:)" 10 0
node 11 "11:acc" 11 0
edge 0 1 directed
edge 1 2 directed
edge 1 6 directed
edge 2 3 directed
edge 3 2 directed
edge 3 4 directed
edge 5 8 directed
edge 8 9 directed
edge 10 11 directed
---
mark 0 | Começa o NFA no estado 0, antes de ler qualquer parte do texto "AABD".
traverse 0 1 | epsilon 0->1.
traverse 1 2 | epsilon 1->2: tenta o ramo (A*B|...).
traverse 1 6 | epsilon 1->6: o NFA também pode tentar o ramo (...|AC) -- não determinismo significa que os dois são mantidos.
traverse 2 3 | epsilon 2->3: A* pode casar com zero As, então o estado 2 alcança o estado 3 sem consumir um caractere.
traverse 3 4 | epsilon 3->4: saindo do loop de A* pra B. O fecho-epsilon do estado 0 agora é {0,1,2,3,4,6} -- bate exatamente com o traço do livro.
mark 2 | Lendo text[0] = 'A'. O estado 2 tem 'A' e casa: transição de match 2->3 (não é uma aresta de grafo -- transições de match consomem um caractere e vivem fora do digrafo G).
mark 6 | O estado 6 também tem 'A' e casa: transição de match 6->7. O conjunto de estados logo depois de casar o primeiro A é {3,7}.
traverse 3 2 | epsilon 3->2: volta pro fecho de A* pra outro A.
traverse 3 4 | epsilon 3->4: ou sai do loop pra B. O fecho-epsilon de {3,7} é {2,3,4,7} -- bate com o traço do livro.
mark 2 | Lendo text[1] = 'A'. O estado 2 casa de novo: transição de match 2->3. O estado 7 tem 'C', não 'A' -- o ramo AC morre aqui.
traverse 3 2 | fecho-epsilon de {3}: 3->2...
traverse 3 4 | ...e 3->4, dando {2,3,4} -- bate com o traço do livro depois do segundo A.
mark 4 | Lendo text[2] = 'B'. O estado 4 tem 'B' e casa: transição de match 4->5. O conjunto vira {5}.
traverse 5 8 | epsilon 5->8.
traverse 8 9 | epsilon 8->9. O fecho-epsilon de {5} é {5,8,9} -- bate com o traço do livro.
mark 9 | Lendo text[3] = 'D'. O estado 9 tem 'D' e casa: transição de match 9->10. O conjunto vira {10}.
traverse 10 11 | epsilon 10->11. O fecho-epsilon de {10} é {10,11}.
visit 11 | O estado 11 é o estado de aceite, e todo "AABD" foi varrido: o NFA reconhece "AABD" -- exatamente o resultado que o próprio traço de Sedgewick & Wayne alcança.
```

O próprio traço manual do livro confirma cada conjunto intermediário ao longo do caminho: `{0,1,2,3,4,6}` (início), `{3,7}` depois `{2,3,4,7}` (depois do primeiro A), `{3}` depois `{2,3,4}` (depois do segundo A), `{5}` depois `{5,8,9}` (depois de B), `{10}` depois `{10,11}` (depois de D) — aceita. O mesmo NFA também consegue *travar* numa entrada que deveria reconhecer se tomar uma sequência de transições que parecia errada cedo demais — por exemplo, se pular para o estado 4 antes de varrer todos os As, a única saída do estado 4 é casar um B em seguida, então um A extra o deixa travado sem lugar para ir. Simular o *conjunto inteiro* de estados alcançáveis contorna isso completamente: uma sequência que trava simplesmente cai fora do conjunto rastreado, enquanto qualquer sequência sobrevivente que de fato alcança o estado de aceite continua sendo rastreada em paralelo.

O código Java (o `NFA.recognizes` de Sedgewick & Wayne) é uma tradução direta dessa descrição — `pc` ("estados atuais possíveis") guarda o conjunto corrente, recalculado a cada iteração via um `DirectedDFS` novo:

```java
public boolean recognizes(String txt)
{ // O NFA reconhece txt?
    Bag<Integer> pc = new Bag<Integer>();
    DirectedDFS dfs = new DirectedDFS(G, 0);
    for (int v = 0; v < G.V(); v++)
       if (dfs.marked(v)) pc.add(v);

    for (int i = 0; i < txt.length(); i++)
    { // Calcula os estados possíveis do NFA para txt[i+1].
       Bag<Integer> match = new Bag<Integer>();
       for (int v : pc)
          if (v < M)
             if (re[v] == txt.charAt(i) || re[v] == '.')
                 match.add(v+1);
       pc = new Bag<Integer>();
       dfs = new DirectedDFS(G, match);
       for (int v = 0; v < G.V(); v++)
          if (dfs.marked(v)) pc.add(v);
    }
    for (int v : pc) if (v == M) return true;
    return false;
}
```

**Proposition Q**: determinar se um texto de N caracteres é reconhecido pelo NFA de uma RE de M caracteres leva tempo proporcional a `NM` no pior caso. Para cada um dos N caracteres do texto, o algoritmo itera por um conjunto de no máximo M estados e roda um DFS no digrafo de transições-ε, cuja contagem de arestas é no máximo `2M` (estabelecido pela construção abaixo), então cada DFS por caractere custa tempo proporcional a M.

### Construindo o NFA a partir da RE: uma única pilha, uma passada sobre os caracteres

Traduzir uma RE para seu digrafo de transições-ε lembra o algoritmo de duas pilhas de Dijkstra para avaliar expressões aritméticas (Seção 1.3), adaptado às particularidades das REs: não existe operador de concatenação explícito, `*` é um operador unário pós-fixado, e `|` é o único operador binário — então só *uma* pilha é necessária, rastreando as posições dos parênteses esquerdos e dos operadores `|`.

- **Concatenação** não precisa de nenhuma construção explícita — as transições de match entre estados de caracteres adjacentes a implementam automaticamente.
- **Parênteses**: empilhe o índice de cada `(`; cada `)` desempilha de volta até (eventualmente) o `(` correspondente.
- **Closure (`*`)**: depois de um único caractere no índice `i`, adicione transições-ε `i→i+1` (pular ele — zero ocorrências) e `i+1→i` (volta pro loop, pra mais ocorrências); depois de um `)` no índice `i`, adicione as mesmas duas arestas entre `i+1` e o `(` correspondente na pilha.
- **Ou (`A|B`)**: adicione uma transição-ε do índice do `(` até o primeiro caractere de `B`, e uma do índice do `|` até o índice do `)` — essas são as que permitem ao NFA escolher qualquer uma das alternativas. O próprio índice do `|` é empilhado junto com o `(` para que os dois estejam disponíveis quando o `)` correspondente for alcançado.

```java
public class NFA
{
   private char[] re;                    // transições de match
   private Digraph G;                    // transições epsilon
   private int M;                        // número de estados
    public NFA(String regexp)
    { // Cria o NFA para a expressão regular dada.
       Stack<Integer> ops = new Stack<Integer>();
       re = regexp.toCharArray();
       M = re.length;
       G = new Digraph(M+1);
       for (int i = 0; i < M; i++)
       {
          int lp = i;
          if (re[i] == '(' || re[i] == '|')
             ops.push(i);
          else if (re[i] == ')')
          {
             int or = ops.pop();
             if (re[or] == '|')
             {
                lp = ops.pop();
                G.addEdge(lp, or+1);
                G.addEdge(or, i);
             }
             else lp = or;
          }
          if (i < M-1 && re[i+1] == '*') // lookahead
          {
             G.addEdge(lp, i+1);
             G.addEdge(i+1, lp);
          }
          if (re[i] == '(' || re[i] == '*' || re[i] == ')')
             G.addEdge(i, i+1);
       }
    }
    public boolean recognizes(String txt)
    // O NFA reconhece txt?
}
```

**Proposition R**: construir o NFA para uma RE de M caracteres leva tempo e espaço proporcionais a M no pior caso — para cada um dos M caracteres, o construtor adiciona no máximo três transições-ε e realiza no máximo uma ou duas operações de pilha.

Juntando as duas proposições, dá-se o quadro completo: um `NFA` é construído em tempo proporcional a M, e então `recognizes(txt)` roda em tempo proporcional a `NM` — o cliente clássico "GREP" (que envolve o padrão dado como `(.*padrão.*)` e imprime cada linha correspondente da entrada padrão) é exatamente esse pipeline de construção-depois-simulação aplicado linha por linha.

## Trade-offs

- **Pior caso garantido de `O(NM)` — sem explosão exponencial, nunca.** Como o algoritmo rastreia o conjunto *inteiro* de estados possíveis a cada passo (um cálculo de alcançabilidade multi-origem) em vez de se comprometer com um chute e fazer backtracking quando errado, o limite da Proposition Q vale incondicionalmente, para qualquer RE e qualquer texto: o custo é exatamente o produto do comprimento do texto pelo comprimento do padrão, o mesmo limite de pior caso da busca de substring por força bruta.
- **Não é assim que o `java.util.regex.Pattern` (ou a maioria dos motores de regex de produção) realmente funciona.** O motor de regex da biblioteca padrão Java é um matcher *backtracking*: ele se compromete com um caminho pelo padrão e só tenta alternativas depois de um beco sem saída, em vez de rastrear um conjunto de estados como essa simulação de NFA faz. Esse design de backtracking compra poder expressivo que a simulação de NFA sozinha não consegue oferecer — backreferences (casar "o que quer que o terceiro grupo tenha casado antes") exigem lembrar o histórico de match de um jeito que um conjunto fixo de estados de NFA não consegue representar — mas abre mão do limite de tempo incondicional: certos padrões adversários (repetição aninhada ou sobreposta contra uma entrada que não casa) podem fazer o tempo de execução de um motor backtracking explodir exponencialmente no comprimento da entrada, o fenômeno comumente chamado de catastrophic backtracking ou ReDoS. A abordagem de simulação de NFA traçada acima é imune a esse modo de falha por construção, ao custo de não suportar backreferences de forma alguma.
- **O espaço é modesto e previsível.** O digrafo de transições-ε para uma RE de M caracteres tem no máximo `2M` arestas (a prova da Proposition Q), e o próprio NFA é construído em tempo e espaço proporcionais a M (Proposition R) — ambos independentes do texto sendo buscado.
- **Não determinismo é resolvido rastreando um conjunto, não por busca.** O truque conceitual que torna um NFA simulável é se recusar a alguma vez de fato "chutar": em vez de escolher uma transição e torcer, o algoritmo carrega adiante todo estado atualmente possível junto, então uma sequência de transições que depois trava (como mostrado no traço trabalhado acima) simplesmente cai fora do conjunto rastreado, sem precisar ser detectada e desfeita.

## Documentation Links

- [Robert Sedgewick, Kevin Wayne — Algorithms, 4th Edition, Section 5.4 "Regular Expressions", pp. 788-809](https://algs4.cs.princeton.edu/54regexp/) — doc
- [Pattern — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html) — doc
